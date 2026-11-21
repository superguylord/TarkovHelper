import type { GameData, Task } from '@shared/types'
import { httpFetch } from './http'
import { readJson, writeJson } from './store'

// Сезонные квесты (сейчас — KORD BREACH). В данных tarkov.dev их нет, поэтому берём с tarkov.help:
// статья сезона даёт ссылки на квесты, у каждого квеста в API есть цели, торговец и связи
// «предыдущий / следующий» — по ним добираем квесты, которых в статье ещё нет.
// Игровых номеров квестов tarkov.help не даёт, поэтому по логам их не отследить — статус отмечается вручную.

const SITE = 'https://tarkov.help'
const HEADERS = { 'User-Agent': 'Mozilla/5.0 TarkovHelper' }
export const SEASON_NAME = 'KORD BREACH'
const ARTICLE = 'kord-breach-kvesty'
const isSeasonSlug = (s: string) => s.endsWith('-kord-breach') || s === 'boevoy-propusk'
const FILE = 'tarkovhelp-season.json'
const CACHE_MS = 24 * 3600_000

export interface SeasonQuest {
  slug: string
  name: string
  traderId: string
  goals: { name: string; qty: number }[]
  parents: string[] // предыдущие сезонные квесты
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

async function getJson(url: string): Promise<any> {
  const res = await httpFetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`tarkov.help: HTTP ${res.status}`)
  const j = await res.json()
  return j?.data ?? j
}

/** Квесты сезона: из кэша (сутки), иначе с tarkov.help; если сайт недоступен — прошлый кэш. */
export async function getSeasonQuests(): Promise<SeasonQuest[]> {
  const cache = readJson<{ at: number; quests: SeasonQuest[] }>(FILE, { at: 0, quests: [] })
  if (cache.quests.length && Date.now() - cache.at < CACHE_MS) return cache.quests
  try {
    const article = await getJson(`${SITE}/api/ru/article/${ARTICLE}`)
    const links = (text: string) => [...text.matchAll(/\/ru\/quest\/([a-z0-9-]+)/g)].map((m) => m[1])
    const queue = [...new Set(links(JSON.stringify(article)).filter(isSeasonSlug))]
    const seen = new Set<string>()
    const quests: SeasonQuest[] = []
    while (queue.length) {
      const slug = queue.shift()!
      if (seen.has(slug)) continue
      seen.add(slug)
      const q = await getJson(`${SITE}/api/ru/quests/${encodeURIComponent(slug)}`).catch(() => null)
      if (!q?.name) continue
      const rel = (list: any): string[] => (Array.isArray(list) ? list.map((x) => String(x.seo_link)).filter(isSeasonSlug) : [])
      const parents = rel(q.parent_quest)
      for (const s of [...rel(q.next_quest), ...parents]) if (!seen.has(s)) queue.push(s)
      quests.push({
        slug,
        name: decode(String(q.name)).replace(/\s*\[KORD BREACH\]\s*$/i, ''),
        traderId: String(q.trader_id ?? ''),
        goals: (Array.isArray(q.goal) ? q.goal : []).map((g: any) => ({ name: decode(String(g.name ?? '')), qty: Number(g.qty) || 1 })),
        parents
      })
    }
    if (!quests.length) throw new Error('tarkov.help: сезонные квесты не найдены')
    writeJson(FILE, { at: Date.now(), quests })
    return quests
  } catch (e) {
    if (cache.quests.length) return cache.quests
    throw e
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Сезонный квест в виде обычного квеста приложения. Карты цели находим по названию локации в тексте. */
export function toSeasonTask(q: SeasonQuest, data: GameData): Task {
  const mapsIn = (text: string) =>
    data.maps
      .filter((m) => new RegExp(`(^|[^а-яё])${escapeRe(m.name)}([^а-яё]|$)`, 'i').test(text))
      .map((m) => m.normalizedName)
  const objectives = q.goals.map((g, i) => ({
    id: `kord:${q.slug}:${i}`,
    type: 'season',
    description: g.qty > 1 ? `${g.name} (${g.qty})` : g.name,
    optional: false,
    maps: mapsIn(g.name),
    points: [],
    hints: [],
    bring: []
  }))
  const maps = [...new Set(objectives.flatMap((o) => o.maps))]
  return {
    id: `kord:${q.slug}`,
    name: q.name,
    trader: data.traders.find((t) => t.id === q.traderId)?.name ?? '',
    map: maps.length === 1 ? maps[0] : null,
    minPlayerLevel: 0,
    kappaRequired: false,
    wikiLink: `${SITE}/ru/quest/${q.slug}`,
    requires: q.parents.map((p) => ({ taskId: `kord:${p}`, status: ['complete'] })),
    neededKeys: [],
    objectives,
    season: SEASON_NAME,
    guideSlug: q.slug
  }
}
