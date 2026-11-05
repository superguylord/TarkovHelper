import { existsSync, watch, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import type { PlayerPosition } from '@shared/types'

// Игра пишет в имя скриншота позицию и поворот камеры:
// 2024-08-20[20-07]_-112.29, 1.41, 158.73_0.00000, -0.93066, 0.00000, 0.36587_10.80 (0).png
const NUM = '(-?\\d+(?:\\.\\d+)?)'
const NAME_RE = new RegExp(`_${NUM}, ${NUM}, ${NUM}_${NUM}, ${NUM}, ${NUM}, ${NUM}_`)

export function parseScreenshotName(name: string): Omit<PlayerPosition, 'map' | 'at'> | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [x, y, z, qx, qy, qz, qw] = m.slice(1).map(Number)
  // поворот вокруг вертикальной оси (Unity: Y вверх), 0° смотрит вдоль +z
  const yaw = (Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qx * qx + qy * qy)) * 180) / Math.PI
  return { x, y, z, yaw }
}

export class ScreenshotWatcher {
  private watcher: FSWatcher | null = null
  private retry: NodeJS.Timeout | null = null
  private seen = new Set<string>()

  constructor(
    private dir: () => string,
    private onPosition: (p: Omit<PlayerPosition, 'map' | 'at'>) => void
  ) {}

  start(): void {
    this.stop()
    const dir = this.dir()
    if (!existsSync(dir)) {
      // папка появляется после первого скриншота в игре — ждём её
      this.retry = setTimeout(() => this.start(), 5000)
      return
    }
    this.watcher = watch(dir, (_event, file) => {
      if (!file || !file.toString().endsWith('.png')) return
      const name = basename(file.toString())
      if (this.seen.has(name)) return
      this.seen.add(name)
      const pos = parseScreenshotName(name)
      if (pos) this.onPosition(pos)
    })
    this.watcher.on('error', () => this.start())
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }
}
