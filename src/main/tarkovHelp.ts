import type { QuestGuide } from '@shared/types'
import { readJson, writeJson } from './store'
import { similarity } from './similarity'

// Гайды по квестам с tarkov.help: пошаговое прохождение со скриншотами мест.
// Ссылки на квесты берём со страниц торговцев, сам гайд — из их API (/api/ru/quests/<slug>).
const SITE = 'https://tarkov.help'
const TRADERS = [
  'prapor', 'therapist', 'fence', 'skier', 'peacemaker', 'mechanic',
  'ragman', 'jaeger', 'lightkeeper', 'ref', 'btr_driver', 'storyteller'
]
const INDEX_FILE = 'tarkovhelp-index.json'
const GUIDES_FILE = 'tarkovhelp-guides.json'
const INDEX_DAYS = 3
const GUIDE_DAYS = 3

type Index = { at: number; slugs: Record<string, string> } // нормализованное название -> slug
type Guides = Record<string, { at: number; guide: QuestGuide | null }>

let index: Index | null = null
let guides: Guides | null = null

const HEADERS = { 'User-Agent': 'Mozilla/5.0 TarkovHelper' }

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\[pvp zone\]/g, '')
    .replace(/[^a-zа-я0-9]+/g, '')

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

async function loadIndex(force = false): Promise<Index> {
  index ??= readJson<Index>(INDEX_FILE, { at: 0, slugs: {} })
  if (!force && Date.now() - index.at < INDEX_DAYS * 86400_000 && Object.keys(index.slugs).length) return index
  // сайт иногда отдаёт страницу торговца не полностью — старые записи не выбрасываем
  const slugs: Record<string, string> = { ...index.slugs }
  const pages = await Promise.all(
    TRADERS.map((t) =>
      fetch(`${SITE}/ru/trader/${t}/quests`, { headers: HEADERS })
        .then((r) => (r.ok ? r.text() : ''))
        .catch(() => '')
    )
  )
  for (const html of pages) {
    for (const m of html.matchAll(/<a[^>]*href="\/ru\/quest\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const name = decode(m[2])
      if (name && name !== 'Читать далее') slugs[norm(name)] = m[1]
    }
  }
  if (!Object.keys(slugs).length) throw new Error('tarkov.help: список квестов не загрузился')
  index = { at: Date.now(), slugs }
  writeJson(INDEX_FILE, index)
  return index
}

/** slug квеста по названию: сначала точное совпадение, потом самое похожее. */
function findSlug(idx: Index, taskName: string): string | null {
  const key = norm(taskName)
  if (idx.slugs[key]) return idx.slugs[key]
  let best: [number, string] | null = null
  for (const [name, slug] of Object.entries(idx.slugs)) {
    const s = similarity(key, name)
    if (s >= 0.85 && (!best || s > best[0])) best = [s, slug]
  }
  return best?.[1] ?? null
}

export async function getGuide(taskName: string): Promise<QuestGuide | null> {
  guides ??= readJson<Guides>(GUIDES_FILE, {})
  const hit = guides[taskName]
  if (hit && Date.now() - hit.at < GUIDE_DAYS * 86400_000) return hit.guide

  let idx = await loadIndex()
  let slug = findSlug(idx, taskName)
  // квест мог появиться на сайте недавно — один раз обновляем список (не чаще раза в час)
  if (!slug && Date.now() - idx.at > 3600_000) {
    idx = await loadIndex(true)
    slug = findSlug(idx, taskName)
  }
  let guide: QuestGuide | null = null
  if (slug) {
    const res = await fetch(`${SITE}/api/ru/quests/${encodeURIComponent(slug)}`, { headers: HEADERS })
    if (!res.ok) throw new Error(`tarkov.help: HTTP ${res.status}`)
    const { data } = await res.json()
    guide = { url: `${SITE}/ru/quest/${slug}`, html: data?.guide || data?.guides || '' }
  }
  guides[taskName] = { at: Date.now(), guide }
  writeJson(GUIDES_FILE, guides)
  return guide
}
