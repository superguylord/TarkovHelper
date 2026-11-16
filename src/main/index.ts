import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GameData, GameMode, GoonsState, LiveState, OverlayMode, Profile, Progress, Settings, TaskStatus } from '@shared/types'
import { dataMode } from '@shared/types'
import { readJson, writeJson } from './store'
import { detectGamePath } from './gamePath'
import { fetchGameData, loadCached } from './tarkovData'
import { LogWatcher } from './logWatcher'
import { ScreenshotWatcher } from './screenshotWatcher'
import { scanPrice, warmUpOcr } from './priceScanner'
import { searchItems } from './priceMatch'
import { getGuide, getStory } from './tarkovHelp'
import { fetchGoons } from './goons'
import { initUpdater } from './updater'

// ---------- состояние ----------

const defaultSettings = (): Settings => ({
  mapStyle: 'scheme',
  gamePath: detectGamePath(),
  screenshotsPath: join(app.getPath('documents'), 'Escape from Tarkov', 'Screenshots'),
  gameMode: 'auto',
  hotkeys: { overlay: 'F8', price: 'F7' },
  settingsVersion: 2,
  deleteScreenshots: true
})

let settings: Settings
// У каждого персонажа (PvP, сезон, PvE) свой файл прогресса. До разделения был один progress.json —
// он достаётся обычному PvP, чтобы ничего не потерялось.
const emptyProgress = (): Progress => ({ playerLevel: 1, tasks: {}, objectives: {}, hideout: {} })
const progressFile = (p: Profile) => `progress-${p}.json`
function loadProgress(p: Profile): Progress {
  const own = readJson<Progress | null>(progressFile(p), null)
  if (own) return { ...emptyProgress(), ...own }
  return p === 'pvp' ? readJson<Progress>('progress.json', emptyProgress()) : emptyProgress()
}
let profile: Profile = 'pvp'
let progress: Progress = emptyProgress()
const saveProgress = () => writeJson(progressFile(profile), progress)
let data: GameData | null = null
let overlayMode: OverlayMode = 'hidden'
const live: LiveState = {
  currentMap: null,
  inRaid: false,
  detectedMode: null,
  position: null,
  logStatus: 'Логи ещё не прочитаны',
  dataStatus: 'Загрузка данных…',
  profile: 'pvp',
  hotkeyProblems: []
}

let mainWin: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null

const effectiveProfile = (): Profile => (settings.gameMode === 'auto' ? (live.detectedMode ?? profile) : settings.gameMode)
const effectiveMode = (): GameMode => dataMode(profile)

/** Переключает приложение на персонажа: его прогресс и данные его режима. */
function applyProfile(): void {
  const next = effectiveProfile()
  if (next !== profile) {
    profile = next
    progress = loadProgress(profile)
    writeJson('last-profile.json', { profile })
    send('progress', progress)
  }
  live.profile = profile
  pushLive()
  loadData()
}

/** Статус квеста для персонажа, который сейчас не открыт: правим его файл напрямую. */
function setTaskFor(p: Profile, id: string, status: TaskStatus): void {
  if (p === profile) {
    if (progress.tasks[id] !== status) setTask(id, status)
    return
  }
  const other = loadProgress(p)
  if (other.tasks[id] === status) return
  other.tasks[id] = status
  writeJson(progressFile(p), other)
}

function send(channel: string, payload: unknown): void {
  for (const w of [mainWin, overlayWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
}
const pushLive = () => send('live', live)

// ---------- данные tarkov.dev ----------

let loading = false
async function loadData(force = false): Promise<void> {
  const mode = effectiveMode()
  if (!data || data.gameMode !== mode) {
    data = loadCached(mode)
    if (data) {
      send('data', data)
      resolveMap()
      syncFromQuests()
    }
  }
  const stale = !data || !!data.outdated || Date.now() - data.fetchedAt > 60 * 60 * 1000
  if ((!stale && !force) || loading) return
  loading = true
  live.dataStatus = 'Обновляю данные с tarkov.dev…'
  pushLive()
  try {
    const r = await fetchGameData(mode, data)
    data = r.data
    if (r.complete) {
      live.dataStatus = `Данные обновлены ${new Date(data.fetchedAt).toLocaleTimeString('ru-RU')}`
    } else {
      live.dataStatus = 'tarkov.dev отвечает с ошибками — часть данных из кэша, повторю через 5 минут'
      setTimeout(() => loadData(), 5 * 60 * 1000)
    }
    send('data', data)
    resolveMap()
    syncFromQuests()
  } catch (e) {
    console.error(e)
    live.dataStatus = data
      ? `tarkov.dev недоступен, использую кэш от ${new Date(data.fetchedAt).toLocaleString('ru-RU')}`
      : 'tarkov.dev недоступен и кэша нет — повторю через минуту'
    setTimeout(() => loadData(), data ? 5 * 60 * 1000 : 60 * 1000)
  } finally {
    loading = false
    pushLive()
  }
}

// ---------- обновления ----------

const updater = initUpdater((state) => send('update', state))

// ---------- Кочевники ----------

let goons: GoonsState = { last: null, history: [], fetchedAt: 0, error: null }

const normName = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '')

/** Карта из доклада tarkov.help -> карта приложения (по ключу или русскому названию). */
function resolveGoonMap(key: string, name: string): string | null {
  const maps = data?.maps ?? []
  const k = normName(key)
  return (
    maps.find((m) => normName(m.normalizedName) === k || m.nameIds.some((id) => normName(id) === k))?.normalizedName ??
    maps.find((m) => normName(m.name) === normName(name))?.normalizedName ??
    null
  )
}

async function refreshGoons(): Promise<void> {
  try {
    goons = await fetchGoons(resolveGoonMap)
  } catch (e) {
    goons = { ...goons, error: String((e as Error).message ?? e) }
  }
  send('goons', goons)
}

// ---------- прогресс ----------

function setTask(id: string, status: TaskStatus | null): void {
  if (status) progress.tasks[id] = status
  else delete progress.tasks[id]
  raiseFromQuests()
  saveProgress()
  send('progress', progress)
}

/**
 * Своего уровня и лояльности торговцев в логах игры нет. Но взятые и выполненные квесты там есть,
 * а квест нельзя взять без нужного уровня и лояльности — значит, они у игрока не ниже требований
 * таких квестов. Поднимаем значения до этой границы (вручную выставленное выше не трогаем).
 * Возвращает true, если что-то изменилось.
 */
function raiseFromQuests(): boolean {
  if (!data) return false
  let changed = false
  for (const t of data.tasks) {
    const st = progress.tasks[t.id]
    if (st !== 'active' && st !== 'completed') continue
    if (t.minPlayerLevel > progress.playerLevel) {
      progress.playerLevel = t.minPlayerLevel
      changed = true
    }
    for (const r of t.traderLevels ?? []) {
      if (r.level > (progress.traders?.[r.trader] ?? 1)) {
        progress.traders = { ...progress.traders, [r.trader]: Math.min(4, r.level) }
        changed = true
      }
    }
  }
  return changed
}
function syncFromQuests(): void {
  if (!raiseFromQuests()) return
  saveProgress()
  send('progress', progress)
}

// ---------- слежение за игрой ----------

// локация из логов может прийти раньше, чем загрузятся данные карт
let lastLocation: string | null = null
function resolveMap(): void {
  const map = lastLocation ? data?.maps.find((m) => m.nameIds.includes(lastLocation!)) : null
  if (map && live.currentMap !== map.normalizedName) live.currentMap = map.normalizedName
  pushLive()
}

const logs = new LogWatcher(() => settings.gamePath, {
  onMap(nameId) {
    lastLocation = nameId
    live.position = null // старая позиция относится к прошлому рейду
    resolveMap()
  },
  onRaid(inRaid) {
    live.inRaid = inRaid
    pushLive()
  },
  onMode(p) {
    if (live.detectedMode === p) return
    live.detectedMode = p
    applyProfile()
  },
  onTask(id, status, p) {
    setTaskFor(p, id, status)
  },
  onStatus(text) {
    if (live.logStatus === text) return
    live.logStatus = text
    pushLive()
  }
})

const shots = new ScreenshotWatcher(
  () => settings.screenshotsPath,
  () => settings.deleteScreenshots,
  (p) => {
    live.position = { ...p, map: live.currentMap, at: Date.now() }
    pushLive()
  }
)

// ---------- окна ----------

const preload = join(__dirname, '../preload/index.js')

function loadPage(win: BrowserWindow, view: 'main' | 'overlay'): void {
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=${view}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
}

function createMainWindow(): void {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0b0c08',
    title: 'TarkovHelper',
    autoHideMenuBar: true,
    webPreferences: { preload }
  })
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  loadPage(mainWin, 'main')
  mainWin.on('closed', () => {
    mainWin = null
    app.quit()
  })
}

function createOverlayWindow(): void {
  const { bounds } = screen.getPrimaryDisplay()
  overlayWin = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: { preload, backgroundThrottling: false }
  })
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  // оверлей не попадает в снимки экрана: иначе сканер цены читал бы собственную карточку прошлого предмета
  overlayWin.setContentProtection(true)
  overlayWin.setIgnoreMouseEvents(true, { forward: true })
  loadPage(overlayWin, 'overlay')
  overlayWin.once('ready-to-show', () => overlayWin?.showInactive())
}

function setOverlayMode(mode: OverlayMode): void {
  if (!overlayWin) return
  overlayMode = mode
  const interactive = mode === 'full'
  overlayWin.setIgnoreMouseEvents(!interactive, { forward: true })
  overlayWin.setFocusable(interactive)
  overlayWin.showInactive()
  if (interactive) overlayWin.focus()
  else overlayWin.blur()
  send('overlay-mode', mode)
}

async function checkPrice(): Promise<void> {
  if (!data) return
  try {
    const r = await scanPrice(data.items)
    send('price', { ...r, at: Date.now() })
  } catch (e) {
    console.error(e)
    send('price', { at: Date.now(), text: 'Ошибка распознавания: ' + String(e), item: null, candidates: [] })
  }
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const problems: string[] = []
  const bind = (key: string, fn: () => void) => {
    if (!key) return
    try {
      if (!globalShortcut.register(key, fn)) problems.push(`${key} — занята другой программой`)
    } catch {
      problems.push(`${key} — неверная запись клавиши`)
    }
  }
  bind(settings.hotkeys.overlay, () => setOverlayMode(overlayMode === 'full' ? 'hidden' : 'full'))
  bind(settings.hotkeys.price, () => checkPrice())
  // показываем в настройках, иначе непонятно, почему клавиша «не работает»
  live.hotkeyProblems = problems
  pushLive()
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle('data:get', () => data)
  ipcMain.handle('data:refresh', () => loadData(true))
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const prev = settings
    settings = { ...settings, ...patch, hotkeys: { ...settings.hotkeys, ...patch.hotkeys } }
    writeJson('settings.json', settings)
    if (prev.gamePath !== settings.gamePath) logs.start()
    if (prev.screenshotsPath !== settings.screenshotsPath) shots.start()
    else if (!prev.deleteScreenshots && settings.deleteScreenshots) shots.cleanup()
    if (prev.gameMode !== settings.gameMode) applyProfile()
    registerHotkeys()
    send('settings', settings)
    return settings
  })
  ipcMain.handle('progress:get', () => progress)
  ipcMain.handle('progress:task', (_e, id: string, status: TaskStatus | null) => {
    setTask(id, status)
    return progress
  })
  ipcMain.handle('progress:level', (_e, level: number) => {
    progress.playerLevel = level
    saveProgress()
    send('progress', progress)
    return progress
  })
  ipcMain.handle('progress:hideout', (_e, id: string, level: number) => {
    if (level > 0) progress.hideout[id] = level
    else delete progress.hideout[id]
    saveProgress()
    send('progress', progress)
    return progress
  })
  ipcMain.handle('progress:objective', (_e, id: string, done: boolean) => {
    if (done) progress.objectives[id] = true
    else delete progress.objectives[id]
    saveProgress()
    send('progress', progress)
    return progress
  })
  ipcMain.handle('goons:get', () => goons)
  ipcMain.handle('update:get', () => updater.get())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:install', () => updater.install())
  ipcMain.handle('progress:trader', (_e, trader: string, level: number) => {
    progress.traders = { ...progress.traders, [trader]: Math.max(1, Math.min(4, level)) }
    saveProgress()
    send('progress', progress)
    return progress
  })
  ipcMain.handle('story:get', async () => {
    try {
      return await getStory()
    } catch (e) {
      console.warn('Сюжет не загрузился:', e)
      return []
    }
  })
  ipcMain.handle('guide:get', async (_e, name: string, slug?: string) => {
    try {
      return await getGuide(name, slug)
    } catch (e) {
      console.warn('Гайд не загрузился:', e)
      return null
    }
  })
  ipcMain.handle('progress:import', () => {
    // у каждого персонажа свои квесты: в текущего — в память, остальным — в их файлы
    const found = logs.importAll()
    for (const p of Object.keys(found) as Profile[]) for (const [id, st] of found[p]) setTaskFor(p, id, st)
    raiseFromQuests()
    saveProgress()
    send('progress', progress)
    return found[profile].size
  })
  ipcMain.handle('live:get', () => live)
  ipcMain.handle('live:map', (_e, map: string | null) => {
    live.currentMap = map
    pushLive()
  })
  ipcMain.handle('price:check', () => checkPrice())
  ipcMain.handle('items:search', (_e, q: string) => (data ? searchItems(data.items, q, 12) : []))
  ipcMain.handle('overlay:mode', (_e, mode: OverlayMode) => setOverlayMode(mode))
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}

// ---------- запуск ----------

if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(() => {
  const defaults = defaultSettings()
  const saved = readJson<Partial<Settings>>('settings.json', {})
  // берём только известные поля — так из старых настроек пропадают удалённые функции (мини-карта)
  const pick = <T extends object>(base: T, from: any): T =>
    Object.fromEntries(Object.keys(base).map((k) => [k, from?.[k] ?? (base as any)[k]])) as T
  settings = { ...pick(defaults, saved), hotkeys: pick(defaults.hotkeys, saved.hotkeys) }
  // версия 2: цена предмета переехала с F9 на F7 (меняем, только если клавишу не настраивали сами)
  if ((saved.settingsVersion ?? 1) < 2) {
    if (settings.hotkeys.price === 'F9') settings.hotkeys.price = 'F7'
    settings.settingsVersion = 2
    writeJson('settings.json', settings)
  }
  // раньше режимов было два (regular / pve) — теперь три персонажа
  if ((settings.gameMode as string) === 'regular') settings.gameMode = 'pvp'
  // открываем того персонажа, что был в прошлый раз (логи уточнят через секунду)
  const lastProfile = readJson<{ profile: Profile }>('last-profile.json', { profile: 'pvp' }).profile
  profile = settings.gameMode === 'auto' ? (['pvp', 'season', 'pve'].includes(lastProfile) ? lastProfile : 'pvp') : settings.gameMode
  // первое разделение: квесты сезона и PvE восстанавливаем из логов игры, PvP получает прежний общий прогресс
  const firstSplit = !existsSync(join(app.getPath('userData'), progressFile('pvp')))
  progress = loadProgress(profile)
  live.profile = profile
  if (firstSplit) {
    writeJson(progressFile('pvp'), loadProgress('pvp'))
    try {
      const found = logs.importAll()
      for (const p of ['season', 'pve'] as Profile[]) for (const [id, st] of found[p]) setTaskFor(p, id, st)
    } catch (e) {
      console.warn('Не удалось разобрать логи при разделении прогресса:', e)
    }
  }
  // убранные виды карты («Классика», «Хаки», «Тёмная») заменяем «Схемой»
  if (settings.mapStyle !== 'scheme' && settings.mapStyle !== 'detailed') settings.mapStyle = 'scheme'
  // игру переустановили или настройки перенесли с другого компьютера — ищем папку заново
  if (!existsSync(settings.gamePath)) {
    const found = detectGamePath()
    if (existsSync(found)) {
      settings.gamePath = found
      writeJson('settings.json', settings)
    } else live.logStatus = 'Папка игры не найдена — укажите её в настройках'
  }

  registerIpc()
  createMainWindow()
  createOverlayWindow()
  registerHotkeys()
  logs.start()
  shots.start()
  setInterval(() => loadData(), 15 * 60 * 1000) // цены меняются — освежаем раз в час (см. stale)
  warmUpOcr()
  // карты в докладах сопоставляются с данными игры — поэтому первый запрос после загрузки данных
  loadData().finally(refreshGoons)
  setInterval(refreshGoons, 2 * 60 * 1000) // доклады о Кочевниках приходят часто — проверяем каждые 2 минуты
})

app.on('second-instance', () => {
  if (mainWin?.isMinimized()) mainWin.restore()
  mainWin?.focus()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
