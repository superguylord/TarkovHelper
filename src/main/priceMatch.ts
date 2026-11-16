import type { Item } from '@shared/types'
import { similarity } from './similarity'

// Подбор предмета по тексту, прочитанному с экрана. Главное правило: лучше ответить
// «не распознано», чем показать цену другого предмета. Поэтому совпадение засчитывается, только если
//  — строка почти полностью совпала с полным названием (подсказка игры возле курсора), или
//  — короткая надпись рядом с курсором точно совпала с коротким названием (подпись на ячейке).
// Строка, которая лишь немного похожа на какое-то название, предметом не считается.

export interface OcrLine {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Match {
  item: Item
  score: number // 0..1, насколько текст совпал с названием
  dist: number // расстояние от курсора до строки, px экрана
  text: string
  by: 'name' | 'short'
}

const FULL_MIN = 0.82 // полное название: допускаем пару ошибок OCR на строку
const FULL_MAX_DIST = 420 // подсказка игры всегда рядом с курсором
const SHORT_MAX_DIST = 150 // подпись на ячейке — над курсором, в пределах самой ячейки

// латинские буквы, которые OCR путает с кириллицей, приводим к одному виду
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у'
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[abcehkmoptxy]/g, (c) => LOOKALIKE[c])
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()

const letters = (s: string) => (s.match(/[a-zа-я]/g) ?? []).length

interface Indexed {
  item: Item
  name: string
  short: string
}

const indexCache = new WeakMap<Item[], Indexed[]>()
function indexOf(items: Item[]): Indexed[] {
  let idx = indexCache.get(items)
  if (!idx) {
    idx = items.map((item) => ({ item, name: norm(item.name), short: norm(item.shortName) }))
    indexCache.set(items, idx)
  }
  return idx
}

/** Насколько строка совпала с полным названием. Учитываем лишние слова по краям (соседняя надпись в той же строке). */
function fullScore(q: string, name: string): number {
  if (q === name) return 1
  let s = similarity(q, name)
  // название целиком внутри строки (или строка — почти всё название): OCR захватил или обрезал край
  const short = Math.min(q.length, name.length)
  const long = Math.max(q.length, name.length)
  if (short >= 8 && (q.includes(name) || name.includes(q)) && short / long >= 0.6) s = Math.max(s, 0.86 + 0.14 * (short / long))
  // строка длиннее названия: ищем название среди подряд идущих слов
  if (q.length > name.length + 3 && name.length >= 8) {
    const words = q.split(' ')
    const n = name.split(' ').length
    for (let i = 0; i + n <= words.length; i++) s = Math.max(s, similarity(words.slice(i, i + n).join(' '), name) - 0.02)
  }
  return s
}

/**
 * Все правдоподобные совпадения, лучшие первыми.
 * lines — строки OCR в координатах экрана (px), cursor — положение курсора там же.
 */
export function findMatches(items: Item[], lines: OcrLine[], cursor: { x: number; y: number }): Match[] {
  const idx = indexOf(items)

  // длинное название подсказка переносит на вторую строку — пробуем и склейку соседних строк
  const cands: OcrLine[] = [...lines]
  for (const a of lines) {
    for (const b of lines) {
      if (a === b) continue
      const h = a.y1 - a.y0
      const below = b.y0 >= a.y0 + h * 0.5 && b.y0 - a.y1 <= h * 1.2
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0
      if (below && overlap) {
        cands.push({ text: `${a.text} ${b.text}`, x0: Math.min(a.x0, b.x0), y0: a.y0, x1: Math.max(a.x1, b.x1), y1: b.y1 })
      }
    }
  }

  const found = new Map<string, Match>()
  const keep = (m: Match) => {
    const cur = found.get(m.item.id)
    if (!cur || rank(m) > rank(cur)) found.set(m.item.id, m)
  }
  for (const line of cands) {
    const q = norm(line.text)
    if (letters(q) < 3) continue // цифры или мусор
    const dx = Math.max(line.x0 - cursor.x, 0, cursor.x - line.x1)
    const dy = Math.max(line.y0 - cursor.y, 0, cursor.y - line.y1)
    const dist = Math.hypot(dx, dy)
    for (const { item, name, short } of idx) {
      // Название из одного короткого слова («Болты») выглядит так же, как подпись на ячейке соседнего
      // предмета. Такое совпадение считаем подписью: только рядом с курсором и слабее настоящей подсказки.
      const labelLike = name === short || (!name.includes(' ') && name.length <= 12)
      if (labelLike) {
        if (dist <= SHORT_MAX_DIST) {
          const s = q === name ? 1 : name.length >= 6 ? similarity(q, name) : 0
          if (s >= 0.85) keep({ item, score: 0.8 * s, dist, text: line.text.trim(), by: 'short' })
        }
      } else if (dist <= FULL_MAX_DIST && Math.abs(q.length - name.length) <= Math.max(q.length, name.length) * 0.6) {
        const s = fullScore(q, name)
        if (s >= FULL_MIN) keep({ item, score: s, dist, text: line.text.trim(), by: 'name' })
      }
      if (dist <= SHORT_MAX_DIST && short.length >= 3 && short !== name) {
        const s = q === short ? 1 : short.length >= 5 && q.length >= 5 ? similarity(q, short) : 0
        if (s >= 0.85) keep({ item, score: 0.8 * s, dist, text: line.text.trim(), by: 'short' })
      }
    }
  }
  return [...found.values()].sort((a, b) => rank(b) - rank(a))
}

// ближняя строка важнее: каждые 100 px от курсора снимают 0,05
const rank = (m: Match) => m.score - Math.min(m.dist / 2000, 0.25)

/** Ручной поиск по названию на странице «Цены»: тут ищем и по части слова. */
export function searchItems(items: Item[], query: string, limit = 12): Item[] {
  const q = norm(query)
  if (letters(q) < 2) return []
  const scored: [Item, number][] = []
  for (const { item, name, short } of indexOf(items)) {
    let s = Math.max(similarity(q, name), q === short ? 0.95 : 0)
    if (name.includes(q)) s = Math.max(s, 0.75 + 0.25 * (q.length / name.length))
    else if (short.includes(q)) s = Math.max(s, 0.7)
    if (s >= 0.6) scored.push([item, s])
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, limit).map(([item]) => item)
}
