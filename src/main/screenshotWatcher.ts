import { shell } from 'electron'
import { existsSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import { basename, join } from 'node:path'
import type { PlayerPosition } from '@shared/types'

// Игра пишет в имя скриншота позицию и поворот камеры:
// 2024-08-20[20-07]_-112.29, 1.41, 158.73_0.00000, -0.93066, 0.00000, 0.36587_10.80 (0).png
const NUM = '(-?\\d+(?:\\.\\d+)?)'
const NAME_RE = new RegExp(`_${NUM}, ${NUM}, ${NUM}_${NUM}, ${NUM}, ${NUM}, ${NUM}_`)

export function parseScreenshotName(name: string): Omit<PlayerPosition, 'map' | 'at'> | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [x, y, z, qx, qy, qz, qw] = m.slice(1).map(Number)
  // направление взгляда — проекция «вперёд» камеры на землю (Unity: Y вверх),
  // поэтому не зависит от того, смотрит игрок вверх или вниз; 0° — вдоль +z
  const yaw = (Math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qx * qx + qy * qy)) * 180) / Math.PI
  return { x, y, z, yaw }
}

/**
 * Отправляет скриншот в Корзину (его можно восстановить). Игра может ещё дописывать файл,
 * поэтому пробуем несколько раз с паузой.
 */
async function removeLater(path: string, attempt = 0): Promise<void> {
  await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
  if (!existsSync(path)) return
  try {
    await shell.trashItem(path)
  } catch (e: any) {
    if (attempt < 4) return removeLater(path, attempt + 1)
    console.warn('Не удалось убрать скриншот', path, e?.message)
  }
}

export class ScreenshotWatcher {
  private watcher: FSWatcher | null = null
  private retry: NodeJS.Timeout | null = null
  private seen = new Set<string>()

  constructor(
    private dir: () => string,
    private autoDelete: () => boolean,
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
    this.cleanup(dir)
    this.watcher = watch(dir, (_event, file) => {
      if (!file || !file.toString().endsWith('.png')) return
      const name = basename(file.toString())
      if (this.seen.has(name)) return
      this.seen.add(name)
      const pos = parseScreenshotName(name)
      if (!pos) return
      this.onPosition(pos)
      if (this.autoDelete()) removeLater(join(dir, name))
    })
    this.watcher.on('error', () => this.start())
  }

  /** Убирает скриншоты, оставшиеся с прошлых запусков (только игровые — с координатами в имени). */
  cleanup(dir = this.dir()): void {
    if (!this.autoDelete() || !existsSync(dir)) return
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.png') && NAME_RE.test(f)) removeLater(join(dir, f))
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }
}
