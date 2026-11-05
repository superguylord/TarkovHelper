import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { GameMode, TaskStatus } from '@shared/types'

// Читает логи игры (<папка игры>/Logs/log_*/...) и сообщает о событиях.
// Память игры не трогаем — только текстовые файлы, которые игра пишет сама.

export interface LogEvents {
  onMap(nameId: string): void
  onRaid(inRaid: boolean): void
  onMode(mode: GameMode): void
  onTask(taskId: string, status: TaskStatus): void
  onStatus(text: string): void
}

// Типы сообщений в push-notifications: 10 — квест взят, 11 — провален, 12 — выполнен
const TASK_MESSAGE: Record<number, TaskStatus> = { 10: 'active', 11: 'failed', 12: 'completed' }

const LOCATION_RE = /TRACE-NetworkGameCreate profileStatus:.*Location: ([^,]+),/
const MODE_RE = /https?:\/\/gw-(pvp|pve)\./

function logDirs(gamePath: string): string[] {
  const root = join(gamePath, 'Logs')
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((d) => d.startsWith('log_'))
    .sort() // имена вида log_2026.11.05_20-11-13 сортируются по времени
    .map((d) => join(root, d))
}

/** Разбирает уведомления о квестах в куске текста push-notifications-лога. */
export function parseTaskEvents(text: string, onTask: LogEvents['onTask']): void {
  // каждое уведомление — JSON-блок после строки "Got notification | ChatMessageReceived"
  const re = /"type": (\d+),[^{}]*?"templateId": "([0-9a-f]{24})[ "]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const status = TASK_MESSAGE[Number(m[1])]
    if (status) onTask(m[2], status)
  }
}

export class LogWatcher {
  private dir: string | null = null
  private offsets = new Map<string, number>()
  private pending = new Map<string, string>() // недочитанный хвост файла без перевода строки
  private timer: NodeJS.Timeout | null = null
  private inRaid = false

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

  /** Проходит по всем сохранённым логам и возвращает итоговые статусы квестов. */
  importAll(): Map<string, TaskStatus> {
    const result = new Map<string, TaskStatus>()
    for (const dir of logDirs(this.gamePath())) {
      for (const f of readdirSync(dir).filter((f) => f.includes('push-notifications'))) {
        const text = readTail(join(dir, f), 0).text
        parseTaskEvents(text, (id, st) => result.set(id, st))
      }
    }
    return result
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
      parseTaskEvents(text, this.ev.onTask)
      return
    }
    if (kind === 'backend') {
      const m = MODE_RE.exec(text)
      if (m) this.ev.onMode(m[1] === 'pve' ? 'pve' : 'regular')
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
