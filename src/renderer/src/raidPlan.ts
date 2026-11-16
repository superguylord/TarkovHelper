import type { BringItem, GameData, Item, MapInfo, Progress } from '@shared/types'
import { questsOnMap } from './mapMarkers'
import { rub } from './questLogic'

export interface PlanItem extends BringItem {
  purposes: string[] // названия квестов
  source: string // где взять: торговец, барахолка или «уже есть»
}

/** Квест, который сейчас не выполнить: нужный предмет негде купить. */
export interface BlockedQuest {
  quest: string
  items: { name: string; reason: string }[]
}

export interface RaidPlan {
  map: string
  mapName: string
  quests: string[] // взятые квесты с целями на этой карте, которые можно делать
  bring: PlanItem[]
  blocked: BlockedQuest[]
}

export const FLEA_LEVEL = 15 // с этого уровня открывается барахолка

/** Сколько взятых квестов с незакрытыми целями на каждой карте — по убыванию. */
export function mapPriority(data: GameData, progress: Progress): { map: MapInfo; quests: number }[] {
  return data.maps
    .map((map) => ({ map, quests: questsOnMap(data, map, progress).length }))
    .sort((a, b) => b.quests - a.quests)
}

/** Торговцы, у которых вообще что-то продаётся, — для выбора уровней лояльности. */
export function sellingTraders(data: GameData): string[] {
  const names = new Set<string>()
  for (const i of data.items) for (const o of i.buyFrom) if (o.trader) names.add(o.trader)
  return data.traders.map((t) => t.name).filter((n) => names.has(n))
}

type Availability = { ok: true; source: string } | { ok: false; reason: string }

/** Можно ли сейчас купить предмет: у торговца (уровень лояльности, квест-открытие) или на барахолке. */
export function availability(item: Item, data: GameData, progress: Progress): Availability {
  const level = (trader: string) => progress.traders?.[trader] ?? 1
  const unlocked = (taskName: string | null) =>
    !taskName || data.tasks.some((t) => t.name === taskName && progress.tasks[t.id] === 'completed')
  const offer = item.buyFrom.find((o) => o.level <= level(o.trader) && unlocked(o.taskUnlock))
  if (offer) return { ok: true, source: `${offer.trader}, ур. ${offer.level} · ${rub(offer.priceRUB)}` }
  const flea = item.avg24hPrice ?? item.lastLowPrice
  if (flea != null && progress.playerLevel >= FLEA_LEVEL) return { ok: true, source: `Барахолка · ~${rub(flea)}` }

  const reasons: string[] = []
  const nearest = [...item.buyFrom].sort((a, b) => a.level - b.level)[0]
  if (nearest) {
    reasons.push(
      nearest.level > level(nearest.trader)
        ? `${nearest.trader} с ур. ${nearest.level}`
        : `${nearest.trader} после квеста «${nearest.taskUnlock}»`
    )
  }
  if (flea != null) reasons.push(`барахолка с ${FLEA_LEVEL} уровня`)
  return { ok: false, reason: reasons.length ? reasons.join(' или ') : 'не продаётся — только найти в рейде' }
}

/**
 * План на рейд: что взять с собой для взятых квестов на этой карте.
 * Квест, для которого нужный предмет сейчас не купить, в план не идёт (и его предметы тоже) —
 * он попадает в blocked. owned — названия предметов, которые у игрока уже есть.
 */
export function buildPlan(data: GameData, map: MapInfo, progress: Progress, owned: ReadonlySet<string> = new Set()): RaidPlan {
  const itemByName = new Map(data.items.map((i) => [i.name, i]))
  const checked = new Map<string, Availability>()
  // предмет «А или Б» доступен, если доступен любой из вариантов; чего нет в базе — не проверяем
  const check = (b: BringItem): Availability => {
    const key = `${b.kind}:${b.name}`
    let res = checked.get(key)
    if (!res) {
      if (owned.has(b.name)) res = { ok: true, source: 'уже есть' }
      else if (b.kind === 'questItem') res = { ok: true, source: 'квестовый предмет' }
      else {
        const variants = b.name.split(' или ').map((n) => itemByName.get(n))
        const results = variants.map((i) => (i ? availability(i, data, progress) : ({ ok: true, source: '' } as Availability)))
        res = results.find((r) => r.ok) ?? results[0]
      }
      checked.set(key, res)
    }
    return res
  }

  // что нужно каждому квесту на этой карте
  const perQuest: { quest: string; items: BringItem[] }[] = []
  for (const task of questsOnMap(data, map, progress)) {
    const items: BringItem[] = []
    for (const o of task.objectives) {
      if (progress.objectives[o.id]) continue
      const here = o.points.some((p) => p.map === map.normalizedName) || o.maps.includes(map.normalizedName) || (!o.maps.length && task.map === map.normalizedName)
      if (here) items.push(...(o.bring ?? []))
    }
    for (const k of task.neededKeys ?? []) {
      if (k.map && k.map !== map.normalizedName) continue
      for (const key of k.keys) {
        // ключ мог уже попасть в список как один из вариантов («А или Б»)
        if (!items.some((b) => b.kind === 'key' && b.name.split(' или ').includes(key))) items.push({ name: key, count: 1, kind: 'key' })
      }
    }
    perQuest.push({ quest: task.name, items })
  }

  const bring = new Map<string, PlanItem>()
  const blocked: BlockedQuest[] = []
  const quests: string[] = []
  for (const { quest, items } of perQuest) {
    const missing = items.flatMap((b) => {
      const a = check(b)
      return a.ok ? [] : [{ name: b.name, reason: a.reason }]
    })
    if (missing.length) {
      blocked.push({ quest, items: missing.filter((m, i) => missing.findIndex((x) => x.name === m.name) === i) })
      continue
    }
    quests.push(quest)
    for (const item of items) {
      const key = `${item.kind}:${item.name}`
      const cur = bring.get(key)
      const a = check(item)
      if (!cur) bring.set(key, { ...item, purposes: [quest], source: a.ok ? a.source : '' })
      else {
        // ключ нужен один, а закладки и маркеры складываются
        if (item.kind !== 'key') cur.count += item.count
        if (!cur.purposes.includes(quest)) cur.purposes.push(quest)
      }
    }
  }

  const order: Record<BringItem['kind'], number> = { key: 0, mark: 1, plant: 2, questItem: 3, use: 4 }
  return {
    map: map.normalizedName,
    mapName: map.name,
    quests,
    bring: [...bring.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)),
    blocked
  }
}
