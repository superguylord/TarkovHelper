import type { GameData, HideoutLevel, HideoutStation, Progress } from '@shared/types'

export const ROUBLES = '5449016a4bdc2d6f028b456f'
const MONEY: Record<string, (n: number) => string> = {
  [ROUBLES]: (n) => `${n.toLocaleString('ru-RU')} ₽`,
  '5696686a4bdc2da3298b456a': (n) => `$${n.toLocaleString('ru-RU')}`,
  '569668774bdc2da2298b4568': (n) => `€${n.toLocaleString('ru-RU')}`
}
const MONEY_NAMES: Record<string, string> = {
  [ROUBLES]: 'Рубли',
  '5696686a4bdc2da3298b456a': 'Доллары',
  '569668774bdc2da2298b4568': 'Евро'
}
export const isMoney = (itemId: string) => itemId in MONEY
/** «×3» для предметов и сумма для валюты. */
export const formatCount = (itemId: string, count: number) => (MONEY[itemId] ? MONEY[itemId](count) : `×${count}`)
export const needName = (itemId: string, name: string) => MONEY_NAMES[itemId] ?? name

export const builtLevel = (station: HideoutStation, progress: Progress) => progress.hideout?.[station.id] ?? 0
export const maxLevel = (station: HideoutStation) => station.levels[station.levels.length - 1]?.level ?? 0
export const nextLevel = (station: HideoutStation, progress: Progress): HideoutLevel | null =>
  station.levels.find((l) => l.level === builtLevel(station, progress) + 1) ?? null

/** Требования к другим модулям, которые ещё не выполнены. */
export function missingStations(level: HideoutLevel, data: GameData, progress: Progress) {
  return level.stations.filter((r) => {
    const st = data.hideout.find((s) => s.id === r.stationId)
    return !st || builtLevel(st, progress) < r.level
  })
}

export interface HideoutNeed {
  itemId: string
  name: string
  count: number
  fir: number // сколько из них нужно «найденными в рейде»
  uses: { station: string; level: number; count: number }[]
}

/**
 * Сколько каких предметов нужно на оставшиеся уровни.
 * scope: 'next' — только ближайший уровень каждого модуля, 'all' — все до максимума.
 */
export function hideoutNeeds(data: GameData, progress: Progress, scope: 'next' | 'all'): HideoutNeed[] {
  const needs = new Map<string, HideoutNeed>()
  for (const st of data.hideout ?? []) {
    const built = builtLevel(st, progress)
    for (const lvl of st.levels) {
      if (lvl.level <= built || (scope === 'next' && lvl.level !== built + 1)) continue
      for (const it of lvl.items) {
        const cur = needs.get(it.itemId) ?? { itemId: it.itemId, name: it.name, count: 0, fir: 0, uses: [] }
        cur.count += it.count
        if (it.fir) cur.fir += it.count
        cur.uses.push({ station: st.name, level: lvl.level, count: it.count })
        needs.set(it.itemId, cur)
      }
    }
  }
  // деньги — в конце списка, предметы — по убыванию количества
  return [...needs.values()].sort((a, b) => Number(isMoney(a.itemId)) - Number(isMoney(b.itemId)) || b.count - a.count)
}
