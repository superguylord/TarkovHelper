import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } from 'electron'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GameData, GameMode, GoonsState, LiveState, OverlayMode, Progress, Settings, TaskStatus } from '@shared/types'
import { readJson, writeJson } from './store'
import { fetchGameData, loadCached } from './tarkovData'
import { LogWatcher } from './logWatcher'
import { ScreenshotWatcher } from './screenshotWatcher'
import { matchItems, scanPrice, warmUpOcr } from './priceScanner'
import { getGuide } from './tarkovHelp'
import { fetchGoons } from './goons'

// ---------- состояние ----------

function detectGamePath(): string {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov" /v InstallLocation',
      { encoding: 'utf8' }
    )
    const m = /InstallLocation\s+REG_SZ\s+(.+)/.exec(out)
    if (m) return m[1].trim()
  } catch {
    /* игра не найдена в реестре */
  }
  return 'C:\\Battlestate Games\\Escape from Tarkov'
}

const defaultSettings = (): Settings => ({
  gamePath: detectGamePath(),
  screenshotsPath: join(app.getPath('documents'), 'Escape from Tarkov', 'Screenshots'),
  gameMode: 'auto',
  hotkeys: { overlay: 'F8', price: 'F9' },
  deleteScreenshots: true
})

let settings: Settings
let progress: Progress = readJson<Progress>('progress.json', { playerLevel: 1, tasks: {}, objectives: {} })
let data: GameData | null = null
let overlayMode: OverlayMode = 'hidden'
const live: LiveState = {
  currentMap: null,
  inRaid: false,
  detectedMode: null,
  position: null,
  logStatus: 'Логи ещё не прочитаны',
  dataStatus: 'Загрузка данных…'
}

let mainWin: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null

const effectiveMode = (): GameMode =>
  settings.gameMode === 'auto' ? (live.detectedMode ?? 'regular') : settings.gameMode

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
    }
  }
  const stale = !data || Date.now() - data.fetchedAt > 60 * 60 * 1000
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
  writeJson('progress.json', progress)
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
  onMode(mode) {
    if (live.detectedMode === mode) return
    live.detectedMode = mode
    pushLive()
    loadData()
  },
  onTask(id, status) {
    if (progress.tasks[id] !== status) setTask(id, status)
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
  const bind = (key: string, fn: () => void) => {
    if (!key) return
    try {
      if (!globalShortcut.register(key, fn)) console.warn(`Клавиша ${key} занята`)
    } catch (e) {
      console.warn(`Неверная клавиша ${key}:`, e)
    }
  }
  bind(settings.hotkeys.overlay, () => setOverlayMode(overlayMode === 'full' ? 'hidden' : 'full'))
  bind(settings.hotkeys.price, () => checkPrice())
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
    if (prev.gameMode !== settings.gameMode) loadData()
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
    writeJson('progress.json', progress)
    send('progress', progress)
    return progress
  })
  ipcMain.handle('progress:objective', (_e, id: string, done: boolean) => {
    if (done) progress.objectives[id] = true
    else delete progress.objectives[id]
    writeJson('progress.json', progress)
    send('progress', progress)
    return progress
  })
  ipcMain.handle('goons:get', () => goons)
  ipcMain.handle('guide:get', async (_e, name: string) => {
    try {
      return await getGuide(name)
    } catch (e) {
      console.warn('Гайд не загрузился:', e)
      return null
    }
  })
  ipcMain.handle('progress:import', () => {
    const found = logs.importAll()
    for (const [id, st] of found) progress.tasks[id] = st
    writeJson('progress.json', progress)
    send('progress', progress)
    return found.size
  })
  ipcMain.handle('live:get', () => live)
  ipcMain.handle('live:map', (_e, map: string | null) => {
    live.currentMap = map
    pushLive()
  })
  ipcMain.handle('price:check', () => checkPrice())
  ipcMain.handle('items:search', (_e, q: string) => (data ? matchItems(data.items, [q], 12) : []))
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
  if (!existsSync(settings.gamePath)) live.logStatus = 'Папка игры не найдена — укажите её в настройках'

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
