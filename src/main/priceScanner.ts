import { app, desktopCapturer, nativeImage, screen } from 'electron'
import { createWorker, type Worker } from 'tesseract.js'
import type { Item } from '@shared/types'

// Цена по горячей клавише: снимок области экрана вокруг курсора -> OCR -> поиск предмета.
// Мы только смотрим на картинку экрана, в игру ничего не передаём.

let worker: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  // языковые данные скачиваются один раз и кэшируются в папке приложения
  worker ??= createWorker(['rus', 'eng'], 1, { cachePath: app.getPath('userData') })
  return worker
}

/** Снимок области вокруг курсора, подготовленный для OCR (светлый текст -> тёмный на белом). */
async function captureAroundCursor(): Promise<Buffer> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const sf = display.scaleFactor
  const full = { width: display.size.width * sf, height: display.size.height * sf }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: full })
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  const img = src.thumbnail

  // подсказка с названием предмета появляется рядом с курсором
  const cx = (cursor.x - display.bounds.x) * sf
  const cy = (cursor.y - display.bounds.y) * sf
  const rect = clampRect(
    { x: Math.round(cx - 60 * sf), y: Math.round(cy - 70 * sf), width: Math.round(520 * sf), height: Math.round(120 * sf) },
    img.getSize()
  )
  const crop = img.crop(rect).resize({ width: rect.width * 2, quality: 'best' })

  // ч/б + инверсия: OCR лучше читает тёмный текст на светлом фоне
  const { width, height } = crop.getSize()
  const bmp = crop.toBitmap() // BGRA
  for (let i = 0; i < bmp.length; i += 4) {
    const lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]
    const v = lum > 140 ? 0 : 255
    bmp[i] = bmp[i + 1] = bmp[i + 2] = v
    bmp[i + 3] = 255
  }
  return nativeImage.createFromBitmap(bmp, { width, height }).toPNG()
}

function clampRect(r: Electron.Rectangle, size: Electron.Size): Electron.Rectangle {
  const x = Math.max(0, Math.min(r.x, size.width - 1))
  const y = Math.max(0, Math.min(r.y, size.height - 1))
  return { x, y, width: Math.min(r.width, size.width - x), height: Math.min(r.height, size.height - y) }
}

export async function scanPrice(items: Item[]): Promise<{ text: string; item: Item | null; candidates: Item[] }> {
  const png = await captureAroundCursor()
  const w = await getWorker()
  const { data } = await w.recognize(png)
  const text = data.text.trim()
  const candidates = matchItems(items, text.split('\n'))
  return { text, item: candidates[0] ?? null, candidates }
}

/** Прогреваем OCR заранее, чтобы первая проверка цены не ждала загрузки. */
export function warmUpOcr(): void {
  getWorker().catch((e) => console.error('OCR не запустился:', e))
}

// ---------- поиск предмета по тексту ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1))
      last = tmp
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length)
}

/** Лучшие совпадения для строк текста (OCR или ручной поиск), по убыванию качества. */
export function matchItems(items: Item[], lines: string[], limit = 5): Item[] {
  const queries = lines.map(norm).filter((l) => l.length >= 2)
  if (!queries.length) return []
  const scored: { item: Item; score: number }[] = []
  for (const item of items) {
    const name = norm(item.name)
    const short = norm(item.shortName)
    let best = 0
    for (const q of queries) {
      let s = Math.max(similarity(q, name), similarity(q, short))
      if (name.includes(q) || q.includes(name)) s = Math.max(s, 0.8 + 0.2 * (Math.min(q.length, name.length) / Math.max(q.length, name.length)))
      best = Math.max(best, s)
    }
    if (best >= 0.55) scored.push({ item, score: best })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item)
}
