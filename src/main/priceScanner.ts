import { app, desktopCapturer, nativeImage, screen } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import type { Item } from '@shared/types'
import { findMatches, type Match, type OcrLine } from './priceMatch'

// Цена по горячей клавише: снимок области экрана вокруг курсора -> OCR -> поиск предмета.
// Мы только смотрим на картинку экрана, в игру ничего не передаём.
//
// Читаем область вокруг курсора двумя способами (мягкая обработка и жёсткий порог): шрифт игры
// мелкий, фон бывает разный, и один способ читает то, что пропускает другой. Какая строка
// считается предметом — решает priceMatch.ts.

const SCALE = 2 // увеличение перед OCR: мелкий шрифт игры так читается заметно лучше
// область вокруг курсора, px экрана: подсказка игры появляется справа-снизу, у края экрана — слева
const AREA = { left: 330, up: 150, right: 470, down: 170 }
const CONFIDENT = 0.93 // такое совпадение второй проход уже не улучшит

let worker: Promise<Worker> | null = null

// языковые данные OCR лежат в самом приложении (resources/ocr) — интернет для проверки цены не нужен
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
      worker = null // не запустился — попробуем снова при следующем нажатии клавиши
      throw e
    })
  return worker
}

interface Capture {
  raw: Electron.NativeImage // цветной снимок области, как на экране
  gray: Uint8Array // яркость увеличенного снимка, по байту на пиксель
  width: number
  height: number
  scale: number // во сколько раз увеличенный снимок больше экранных пикселей
  cursor: { x: number; y: number } // положение курсора в области, px экрана
}

/** Снимок области вокруг курсора, увеличенный для OCR. */
async function captureAroundCursor(): Promise<Capture> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const sf = display.scaleFactor
  const full = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: full })
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  const img = src.thumbnail
  // если система отдала снимок другого размера, пересчитываем координаты под него
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
  const scaled = raw.resize({ width: Math.round((rect.width / k) * SCALE), quality: 'best' })
  const { width, height } = scaled.getSize()
  const bmp = scaled.toBitmap() // BGRA
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < bmp.length; i += 4, p++) gray[p] = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]
  return { raw, gray, width, height, scale: width / (rect.width / k), cursor: { x: (cx - rect.x) / k, y: (cy - rect.y) / k } }
}

function clampRect(r: Electron.Rectangle, size: Electron.Size): Electron.Rectangle {
  const x = Math.max(0, Math.min(r.x, size.width - 1))
  const y = Math.max(0, Math.min(r.y, size.height - 1))
  return { x, y, width: Math.min(r.width, size.width - x), height: Math.min(r.height, size.height - y) }
}

/** Картинка для OCR: тёмный текст на светлом. map переводит яркость экрана (0..255) в яркость картинки. */
function toPng(cap: Capture, map: (lum: number) => number): Buffer {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round(map(i))))
  const out = Buffer.alloc(cap.width * cap.height * 4)
  for (let p = 0, i = 0; p < cap.gray.length; p++, i += 4) {
    const v = lut[cap.gray[p]]
    out[i] = out[i + 1] = out[i + 2] = v
    out[i + 3] = 255
  }
  return nativeImage.createFromBitmap(out, { width: cap.width, height: cap.height }).toPNG()
}

// мягко: инверсия с растяжкой контраста — сохраняет сглаженные края букв, порог выбирает сам OCR
const soft = (lum: number) => 255 - (lum - 40) * (255 / 160)
// жёстко: всё, что светлее серого, — текст. Спасает, когда под текстом пёстрый фон
const hard = (lum: number) => (lum > 135 ? 0 : 255)

async function readLines(w: Worker, cap: Capture, png: Buffer): Promise<OcrLine[]> {
  const { data } = await w.recognize(png, {}, { blocks: true })
  return (data.blocks ?? [])
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
    .map((l) => ({
      text: l.text.trim(),
      x0: l.bbox.x0 / cap.scale,
      y0: l.bbox.y0 / cap.scale,
      x1: l.bbox.x1 / cap.scale,
      y1: l.bbox.y1 / cap.scale
    }))
    .filter((l) => l.text)
}

/** Отладка: что увидел сканер — цветной снимок с отметкой курсора, картинка для OCR и прочитанные строки. */
async function saveDebug(cap: Capture, png: Buffer, report: string[]): Promise<void> {
  const dir = app.getPath('userData')
  const { width, height } = cap.raw.getSize()
  const k = width / (cap.width / cap.scale)
  const bmp = cap.raw.toBitmap()
  const px = Math.round(cap.cursor.x * k)
  const py = Math.round(cap.cursor.y * k)
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
    writeFile(join(dir, 'last-scan.png'), png),
    writeFile(join(dir, 'last-scan.txt'), report.join('\n'), 'utf8')
  ]).catch(() => {})
}

export async function scanPrice(items: Item[]): Promise<{ text: string; item: Item | null; candidates: Item[] }> {
  const cap = await captureAroundCursor()
  const w = await getWorker()

  const softPng = toPng(cap, soft)
  let lines = await readLines(w, cap, softPng)
  let matches = findMatches(items, lines, cap.cursor)
  const passes = ['мягкая обработка']
  if (!matches.length || matches[0].score < CONFIDENT) {
    const more = await readLines(w, cap, toPng(cap, hard))
    lines = [...lines, ...more]
    matches = findMatches(items, lines, cap.cursor)
    passes.push('жёсткий порог')
  }

  const top: Match | undefined = matches[0]
  const report = lines.map((l) => `${l.text}  [${Math.round(l.x0)},${Math.round(l.y0)}]`)
  report.push('', `Проходы: ${passes.join(' + ')}`, `Курсор: ${Math.round(cap.cursor.x)},${Math.round(cap.cursor.y)}`)
  report.push(
    top
      ? `Выбрано: ${top.item.name} — строка «${top.text}», совпадение ${top.score.toFixed(2)} (${top.by === 'name' ? 'полное название' : 'короткое название'}), ${Math.round(top.dist)} px от курсора`
      : 'Выбрано: — (ни одна строка не совпала с названием предмета достаточно точно)'
  )
  for (const m of matches.slice(1, 5)) report.push(`  ещё: ${m.item.name} — «${m.text}», ${m.score.toFixed(2)}, ${Math.round(m.dist)} px`)
  saveDebug(cap, softPng, report)

  // ближайшие к курсору строки — чтобы в «не распознано» было видно, что прочитано
  const near = [...lines]
    .sort((a, b) => Math.hypot(a.x0 - cap.cursor.x, a.y0 - cap.cursor.y) - Math.hypot(b.x0 - cap.cursor.x, b.y0 - cap.cursor.y))
    .slice(0, 3)
    .map((l) => l.text)
    .join(' / ')
  if (!top) return { text: near, item: null, candidates: [] }
  return { text: top.text, item: top.item, candidates: matches.slice(0, 5).map((m) => m.item) }
}

/** Прогреваем OCR заранее, чтобы первая проверка цены не ждала загрузки. */
export function warmUpOcr(): void {
  getWorker().catch((e) => console.error('OCR не запустился:', e))
}
