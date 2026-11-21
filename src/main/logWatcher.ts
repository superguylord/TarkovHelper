import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, TaskStatus } from '@shared/types'

// Читает логи игры (<папка игры>/Logs/log_*/...) и сообщает о событиях.
// Память игры не трогаем — только текстовые файлы, которые игра пишет сама.

export interface LogEvents {
  onMap(nameId: string): void
  onRaid(inRaid: boolean): void
  onMode(profile: Profile): void
  onTask(taskId: string, status: TaskStatus, profile: Profile, ts: string): void
  onFlea(profile: Profile): void
  onStatus(text: string): void
}

// Типы сообщений в push-notifications: 10 — квест взят, 11 — провален, 12 — выполнен
const TASK_MESSAGE: Record<number, TaskStatus> = { 10: 'active', 11: 'failed', 12: 'completed' }

const LOCATION_RE = /TRACE-NetworkGameCreate profileStatus:.*Location: ([^,]+),/
// Персонаж виден по серверу, к которому обращается игра: gw-pvp, gw-pvp-season или gw-pve.
// Запрос /client/game/mode игра всегда шлёт на gw-pvp ещё до выбора персонажа — его не считаем.
const HOST_RE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\|.*?https?:\/\/gw-(pvp-season|pvp|pve)\.[^\s,]*/gm
const HOST_PROFILE: Record<string, Profile> = { pvp: 'pvp', 'pvp-season': 'season', pve: 'pve' }

/** Когда игра переключалась между персонажами: [время строки лога, персонаж], по порядку. */
type Switches = [string, Profile][]

function readSwitches(text: string, into: Switches): void {
  for (const m of text.matchAll(HOST_RE)) {
    if (m[0].includes('/client/game/mode')) continue
    const p = HOST_PROFILE[m[2]]
    if (into[into.length - 1]?.[1] !== p) into.push([m[1], p])
  }
}

// Запросы к барахолке: игра шлёт их, только когда барахолка открыта (с 15 уровня). Своего уровня
// в логах нет, а это надёжный знак, что персонаж уже не ниже 15-го.
const FLEA_RE = /https?:\/\/gw-(pvp-season|pvp|pve)\.escapefromtarkov\.com\/client\/ragfair\//g

function fleaProfiles(text: string): Profile[] {
  return [...new Set([...text.matchAll(FLEA_RE)].map((m) => HOST_PROFILE[m[1]]))]
}

/** Какой персонаж был активен в момент ts (время в логах сравнивается как строки). */
function profileAt(switches: Switches, ts: string): Profile {
  let cur: Profile = switches[0]?.[1] ?? 'pvp'
  for (const [at, p] of switches) {
    if (at > ts) break
    cur = p
  }
  return cur
}

function logDirs(gamePath: string): string[] {
  const root = join(gamePath, 'Logs')
  if (!existsSync(root)) return []
  // имена вида log_2026.11.05_9-56-21: час бывает без нуля впереди, поэтому сортируем по дополненному
  const key = (d: string) => d.replace(/_(\d)-/, '_0$1-')
  return readdirSync(root)
    .filter((d) => d.startsWith('log_'))
    .sort((a, b) => key(a).localeCompare(key(b)))
    .map((d) => join(root, d))
}

/**
 * Разбирает уведомления о квестах в куске текста push-notifications-лога.
 * Каждое уведомление — JSON-блок после строки со временем ("... Got notification | ChatMessageReceived").
 * lastTs — время последней строки из прошлого куска; возвращает время последней строки этого.
 */
export function parseTaskEvents(text: string, onTask: (id: string, status: TaskStatus, ts: string) => void, lastTs = ''): string {
  const re = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\||"type": (\d+),[^{}]*?"templateId": "([0-9a-f]{24})[ "]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[1]) lastTs = m[1]
    else {
      const status = TASK_MESSAGE[Number(m[2])]
      if (status) onTask(m[3], status, lastTs)
    }
  }
  return lastTs
}

export class LogWatcher {
  private dir: string | null = null
  private offsets = new Map<string, number>()
  private pending = new Map<string, string>() // недочитанный хвост файла без перевода строки
  private timer: NodeJS.Timeout | null = null
  private inRaid = false
  private switches: Switches = [] // смены персонажа в текущей сессии игры
  private fleaSeen = new Set<Profile>()
  private pushTs = ''

  constructor(
    private gamePath: () => string,
    private ev: LogEvents
  ) {}

  start(): void {
    this.stop()
    this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Персонажи, которые хоть раз пользовались барахолкой, — по всем сохранённым логам. */
  fleaHistory(): Set<Profile> {
    const result = new Set<Profile>()
    for (const dir of logDirs(this.gamePath())) {
      for (const f of readdirSync(dir).filter((f) => f.includes('backend'))) {
        for (const p of fleaProfiles(readTail(join(dir, f), 0).text)) result.add(p)
      }
    }
    return result
  }

  /**
   * Проходит по сохранённым логам и возвращает итоговые статусы квестов — отдельно для каждого персонажа.
   * since — время из логов: события до него (включительно) пропускаются. lastTs — время последнего события.
   */
  importAll(since = ''): { byProfile: Record<Profile, Map<string, TaskStatus>>; lastTs: string } {
    const byProfile: Record<Profile, Map<string, TaskStatus>> = { pvp: new Map(), season: new Map(), pve: new Map() }
    let lastTs = since
    for (const dir of logDirs(this.gamePath())) {
      const files = readdirSync(dir)
      const switches: Switches = []
      for (const f of files.filter((f) => f.includes('backend'))) readSwitches(readTail(join(dir, f), 0).text, switches)
      for (const f of files.filter((f) => f.includes('push-notifications'))) {
        parseTaskEvents(readTail(join(dir, f), 0).text, (id, st, ts) => {
          if (since && ts <= since) return
          byProfile[profileAt(switches, ts)].set(id, st)
          if (ts > lastTs) lastTs = ts
        })
      }
    }
    return { byProfile, lastTs }
  }

  private tick(): void {
    const dirs = logDirs(this.gamePath())
    const latest = dirs[dirs.length - 1]
    if (!latest) {
      this.ev.onStatus('Логи не найдены — проверьте путь к игре в настройках')
      return
    }
    if (latest !== this.dir) {
      // новая сессия игры: читаем её логи с начала, чтобы узнать текущую карту и режим
      this.dir = latest
      this.offsets.clear()
      this.pending.clear()
      this.switches = []
      this.pushTs = ''
      this.fleaSeen.clear()
      this.ev.onStatus(`Слежу за логами: ${latest.split(/[\\/]/).pop()}`)
    }
    let files: string[]
    try {
      files = readdirSync(latest)
    } catch {
      return
    }
    for (const f of files) {
      const kind = f.includes('application')
        ? 'app'
        : f.includes('push-notifications')
          ? 'push'
          : f.includes('backend')
            ? 'backend'
            : null
      if (!kind) continue
      const path = join(latest, f)
      const { text, size } = readTail(path, this.offsets.get(path) ?? 0)
      this.offsets.set(path, size)
      if (!text) continue
      // обрабатываем только целые строки (для уведомлений — целые JSON-блоки),
      // хвост откладываем до следующего чтения
      const full = (this.pending.get(path) ?? '') + text
      const cut = kind === 'push' ? lastBlockEnd(full) : full.lastIndexOf('\n') + 1
      this.pending.set(path, full.slice(cut))
      this.handle(kind, full.slice(0, cut))
    }
  }

  private handle(kind: 'app' | 'push' | 'backend', text: string): void {
    if (kind === 'push') {
      // квест относится к персонажу, который был активен в момент уведомления (backend-лог читается раньше)
      this.pushTs = parseTaskEvents(text, (id, st, ts) => this.ev.onTask(id, st, profileAt(this.switches, ts), ts), this.pushTs)
      return
    }
    if (kind === 'backend') {
      const before = this.switches.length
      readSwitches(text, this.switches)
      if (this.switches.length > before) this.ev.onMode(this.switches[this.switches.length - 1][1])
      for (const p of fleaProfiles(text)) {
        if (this.fleaSeen.has(p)) continue
        this.fleaSeen.add(p)
        this.ev.onFlea(p)
      }
      return
    }
    for (const line of text.split('\n')) {
      const loc = LOCATION_RE.exec(line)
      if (loc) this.ev.onMap(loc[1].trim().toLowerCase())
      if (line.includes('|GameStarted:')) this.setRaid(true)
      if (this.inRaid && line.includes('PrepareSelectedProfileLocally')) this.setRaid(false)
    }
  }

  private setRaid(v: boolean): void {
    if (this.inRaid === v) return
    this.inRaid = v
    this.ev.onRaid(v)
  }
}

/** Позиция сразу после последней строки "}" — конца JSON-блока уведомления. */
function lastBlockEnd(text: string): number {
  let end = 0
  for (const m of text.matchAll(/\n\}\r?\n/g)) end = m.index + m[0].length
  return end
}

function readTail(path: string, from: number): { text: string; size: number } {
  let size: number
  try {
    size = statSync(path).size
  } catch {
    return { text: '', size: from }
  }
  if (size < from) from = 0 // файл пересоздан
  if (size === from) return { text: '', size }
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(size - from)
    readSync(fd, buf, 0, buf.length, from)
    return { text: buf.toString('utf8'), size }
  } finally {
    closeSync(fd)
  }
}
