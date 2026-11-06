import type { QuestGuide } from '@shared/types'
import { readJson, writeJson } from './store'

// Гайды по квестам: раздел «Выполнение» со страницы квеста в русской вики Escape from Tarkov.
const WIKI = 'https://escapefromtarkov.fandom.com/ru'
const API = `${WIKI}/api.php`
const CACHE_FILE = 'guides.json'
const CACHE_DAYS = 7

type Cache = Record<string, { at: number; guide: QuestGuide | null }>
let cache: Cache | null = null

async function wiki(params: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', redirects: '1', ...params })}`)
  if (!res.ok) throw new Error(`вики: HTTP ${res.status}`)
  return res.json()
}

/** Название страницы: точное имя квеста, иначе первый результат поиска. */
async function findPage(taskName: string): Promise<string | null> {
  const direct = await wiki({ action: 'parse', page: taskName, prop: 'sections' })
  if (!direct.error) return direct.parse.title
  const search = await wiki({ action: 'opensearch', search: taskName, limit: '1' })
  return search?.[1]?.[0] ?? null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" }

function toText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(\w+|#39);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)])/g, '$1')
    .trim()
}

/** Абзацы и пункты списков из HTML раздела — без таблиц, навигации и подписей. */
function htmlToBlocks(html: string): QuestGuide['blocks'] {
  let s = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<h\d[\s\S]*?<\/h\d>/g, '')
  // таблицы бывают вложенными — вырезаем самые внутренние, пока не кончатся
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/<table(?:(?!<table)[\s\S])*?<\/table>/g, '')
  }
  s = s.replace(/<div class="navbox[\s\S]*$/, '') // навигационный блок «Квесты торговца» в конце
  const blocks: QuestGuide['blocks'] = []
  for (const m of s.matchAll(/<(p|li)([^>]*)>([\s\S]*?)<\/\1>/g)) {
    // пункты оглавления — не текст гайда (подписи к картинкам оставляем: там описаны места)
    if (/toclevel/.test(m[2])) continue
    const text = toText(m[3])
    if (text.length > 2) blocks.push({ kind: m[1] as 'p' | 'li', text })
  }
  return blocks
}

export async function getGuide(taskName: string): Promise<QuestGuide | null> {
  cache ??= readJson<Cache>(CACHE_FILE, {})
  const hit = cache[taskName]
  if (hit && Date.now() - hit.at < CACHE_DAYS * 86400_000) return hit.guide

  const title = await findPage(taskName)
  let guide: QuestGuide | null = null
  if (title) {
    const { parse } = await wiki({ action: 'parse', page: title, prop: 'sections' })
    const section = parse.sections.find((x: any) => /Выполнение|Прохождение|Руководство/i.test(x.line))
    const url = `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    if (section) {
      const text = await wiki({ action: 'parse', page: title, prop: 'text', section: section.index })
      guide = { url, blocks: htmlToBlocks(text.parse.text['*']) }
    } else {
      guide = { url, blocks: [] }
    }
  }
  cache[taskName] = { at: Date.now(), guide }
  writeJson(CACHE_FILE, cache)
  return guide
}
