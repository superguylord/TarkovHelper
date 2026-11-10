import { app, desktopCapturer, nativeImage, screen } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import type { Item } from '@shared/types'
import { similarity } from './similarity'

// Цена по горячей клавише: снимок области экрана вокруг курсора -> OCR -> поиск предмета.
// Мы только смотрим на картинку экрана, в игру ничего не передаём.
//
// Вокруг курсора в инвентаре много текста: короткие названия соседних предметов, оверлеи
// Discord и т.п. Поэтому читаем все строки с их координатами и берём ту, что ближе всего
// к курсору и при этом похожа на название предмета (подсказка игры появляется рядом с курсором).

const SCALE = 2 // увеличение перед OCR: мелкий шрифт игры так читается заметно лучше
const AREA = { left: 120, up: 110, right: 520, down: 110 } // область вокруг курсора, px экрана

let worker: Promise<Worker> | null = null

// языковые данные OCR лежат в самом приложении (resources/ocr) — интернет для F9 не нужен
const ocrDataDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'ocr') : join(app.getAppPath(), 'resources', 'ocr')

function getWorker(): Promise<Worker> {
  // Только русский: вместе с английским OCR путает похожие буквы (В/B, а/a).
  // Распакованная копия кэшируется в папке данных приложения.
  worker ??= createWorker('rus', 1, {
    langPath: ocrDataDir(),
    cachePath: app.getPath('userData'),
    // без обработчика tesseract.js бросает ошибку прямо в главный процесс и роняет приложение
    errorHandler: (e: unknown) => console.error('OCR:', e)
  })
    .then(async (w) => {
      // разреженный текст: отдельные надписи без абзацев, как в интерфейсе игры
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      return w
    })
    .catch((e) => {
      worker = null // не запустился — попробуем снова при следующем нажатии F9
      throw e
    })
  return worker
}

interface Capture {
  png: Buffer
  raw: Electron.NativeImage
  cursor: { x: number; y: number } // положение курсора на подготовленной картинке
}

/** Снимок области вокруг курсора, подготовленный для OCR (светлый текст -> тёмный на белом). */
async function captureAroundCursor(): Promise<Capture> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const sf = display.scaleFactor
  const full = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: full })
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  const img = src.thumbnail
  // если система отдала снимок меньшего размера, пересчитываем координаты под него
  const k = img.getSize().width / display.size.width

  const cx = (cursor.x - display.bounds.x) * k
  const cy = (cursor.y - display.bounds.y) * k
  const rect = clampRect(
    {
      x: Math.round(cx - AREA.left * k),
      y: Math.round(cy - AREA.up * k),
      width: Math.round((AREA.left + AREA.right) * k),
      height: Math.round((AREA.up + AREA.down) * k)
    },
    img.getSize()
  )
  const raw = img.crop(rect)
  const scaled = raw.resize({ width: Math.round(rect.width * SCALE), quality: 'best' })

  // ч/б + инверсия: OCR лучше читает тёмный текст на светлом фоне
  const { width, height } = scaled.getSize()
  const bmp = scaled.toBitmap() // BGRA
  for (let i = 0; i < bmp.length; i += 4) {
    const lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]
    const v = lum > 140 ? 0 : 255
    bmp[i] = bmp[i + 1] = bmp[i + 2] = v
    bmp[i + 3] = 255
  }
  const png = nativeImage.createFromBitmap(bmp, { width, height }).toPNG()
  const scale = width / rect.width
  return { png, raw, cursor: { x: (cx - rect.x) * scale, y: (cy - rect.y) * scale } }
}

function clampRect(r: Electron.Rectangle, size: Electron.Size): Electron.Rectangle {
  const x = Math.max(0, Math.min(r.x, size.width - 1))
  const y = Math.max(0, Math.min(r.y, size.height - 1))
  return { x, y, width: Math.min(r.width, size.width - x), height: Math.min(r.height, size.height - y) }
}

/** Отладка: что увидел сканер — цветной снимок с отметкой курсора и список прочитанных строк. */
async function saveDebug(cap: Capture, lines: string[]): Promise<void> {
  const dir = app.getPath('userData')
  const { width, height } = cap.raw.getSize()
  const bmp = cap.raw.toBitmap()
  const px = Math.round(cap.cursor.x / SCALE)
  const py = Math.round(cap.cursor.y / SCALE)
  for (let d = -8; d <= 8; d++) {
    for (const [x, y] of [[px + d, py], [px, py + d]]) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const i = (y * width + x) * 4
      bmp[i] = 0
      bmp[i + 1] = 0
      bmp[i + 2] = 255 // красный крестик (BGRA)
    }
  }
  await Promise.all([
    writeFile(join(dir, 'last-scan-raw.png'), nativeImage.createFromBitmap(bmp, { width, height }).toPNG()),
    writeFile(join(dir, 'last-scan.png'), cap.png),
    writeFile(join(dir, 'last-scan.txt'), lines.join('\n'), 'utf8')
  ]).catch(() => {})
}

export async function scanPrice(items: Item[]): Promise<{ text: string; item: Item | null; candidates: Item[] }> {
  const cap = await captureAroundCursor()
  const w = await getWorker()
  const { data } = await w.recognize(cap.png, {}, { blocks: true, text: true })
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))

  // для каждой строки: насколько она похожа на предмет и как далеко от курсора
  const ranked = lines
    .map((line) => {
      const { x0, y0, x1, y1 } = line.bbox
      const dx = Math.max(x0 - cap.cursor.x, 0, cap.cursor.x - x1)
      const dy = Math.max(y0 - cap.cursor.y, 0, cap.cursor.y - y1)
      const dist = Math.hypot(dx, dy) / SCALE // в пикселях экрана
      const best = scoreItems(items, line.text, 5)
      const score = best[0]?.score ?? 0
      // ближняя строка важнее: каждые 100 px от курсора снимают 0,1 (но не больше 0,3)
      return { text: line.text.trim(), dist, best, rank: score - Math.min(dist / 1000, 0.3) }
    })
    .filter((l) => l.best.length)
    .sort((a, b) => b.rank - a.rank)

  const top = ranked[0]
  const debugLines = lines.map((l) => `${l.text.trim()}  [${Math.round(l.bbox.x0 / SCALE)},${Math.round(l.bbox.y0 / SCALE)}]`)
  debugLines.push('', `Курсор: ${Math.round(cap.cursor.x / SCALE)},${Math.round(cap.cursor.y / SCALE)}`)
  debugLines.push(`Выбрано: ${top ? `${top.best[0].item.name} (${top.best[0].score.toFixed(2)}, ${Math.round(top.dist)} px)` : '—'}`)
  saveDebug(cap, debugLines)

  if (!top) return { text: data.text.trim(), item: null, candidates: [] }
  const candidates = [...top.best.map((b) => b.item)]
  for (const l of ranked.slice(1, 3)) if (!candidates.includes(l.best[0].item)) candidates.push(l.best[0].item)
  return { text: top.text, item: top.best[0].item, candidates }
}

/** Прогреваем OCR заранее, чтобы первая проверка цены не ждала загрузки. */
export function warmUpOcr(): void {
  getWorker().catch((e) => console.error('OCR не запустился:', e))
}

// ---------- поиск предмета по тексту ----------

// латинские буквы, которые OCR путает с кириллицей, приводим к одному виду
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у'
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[abcehkmoptxy]/g, (c) => LOOKALIKE[c])
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()

/** Предметы, похожие на строку текста, с оценкой 0..1 (по убыванию). */
function scoreItems(items: Item[], text: string, limit: number, minSubstring = 6): { item: Item; score: number }[] {
  const q = norm(text)
  // в строке должно быть хотя бы 3 буквы, иначе это цифры или мусор
  if ((q.match(/[a-zа-я]/g) ?? []).length < 3) return []
  const scored: { item: Item; score: number }[] = []
  for (const item of items) {
    const name = norm(item.name)
    let s = similarity(q, name)
    // подстрока: OCR мог захватить лишнее слово или обрезать край
    if (Math.min(q.length, name.length) >= minSubstring && (name.includes(q) || q.includes(name))) {
      s = Math.max(s, 0.75 + 0.25 * (Math.min(q.length, name.length) / Math.max(q.length, name.length)))
    }
    // короткое название (как на иконке в инвентаре) засчитываем только при точном совпадении
    if (q === norm(item.shortName)) s = Math.max(s, q.length >= 4 ? 0.85 : 0.7)
    if (s >= 0.6) scored.push({ item, score: s })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Ручной поиск по названию на странице «Цены»: тут ищем и по части слова. */
export function matchItems(items: Item[], lines: string[], limit = 5): Item[] {
  const best = new Map<Item, number>()
  for (const line of lines) {
    for (const { item, score } of scoreItems(items, line, limit, 3)) best.set(item, Math.max(best.get(item) ?? 0, score))
  }
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([item]) => item)
}
