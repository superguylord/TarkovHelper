import type { BringItem, GameData, MapInfo, Progress } from '@shared/types'
import { questsOnMap } from './mapMarkers'

export interface PlanItem extends BringItem {
  purposes: string[] // названия квестов
}

export interface RaidPlan {
  map: string
  mapName: string
  quests: string[] // взятые квесты с целями на этой карте
  bring: PlanItem[]
}

/** Сколько взятых квестов с незакрытыми целями на каждой карте — по убыванию. */
export function mapPriority(data: GameData, progress: Progress): { map: MapInfo; quests: number }[] {
  return data.maps
    .map((map) => ({ map, quests: questsOnMap(data, map, progress).length }))
    .sort((a, b) => b.quests - a.quests)
}

/** План на рейд: что взять с собой для взятых квестов на этой карте. */
export function buildPlan(data: GameData, map: MapInfo, progress: Progress): RaidPlan {
  const bring = new Map<string, PlanItem>()
  const add = (item: BringItem, taskName: string) => {
    const key = `${item.kind}:${item.name}`
    const cur = bring.get(key)
    if (!cur) bring.set(key, { ...item, purposes: [taskName] })
    else {
      // ключ нужен один, а закладки и маркеры складываются
      if (item.kind !== 'key') cur.count += item.count
      if (!cur.purposes.includes(taskName)) cur.purposes.push(taskName)
    }
  }

  const quests = questsOnMap(data, map, progress)
  for (const task of quests) {
    for (const o of task.objectives) {
      if (progress.objectives[o.id]) continue
      const here = o.points.some((p) => p.map === map.normalizedName) || o.maps.includes(map.normalizedName) || (!o.maps.length && task.map === map.normalizedName)
      if (here) for (const b of o.bring ?? []) add(b, task.name)
    }
    for (const k of task.neededKeys ?? []) {
      if (k.map && k.map !== map.normalizedName) continue
      for (const key of k.keys) {
        // ключ мог уже попасть в список как один из вариантов («А или Б»)
        if (![...bring.values()].some((b) => b.kind === 'key' && b.name.split(' или ').includes(key))) {
          add({ name: key, count: 1, kind: 'key' }, task.name)
        }
      }
    }
  }

  const order: Record<BringItem['kind'], number> = { key: 0, mark: 1, plant: 2, questItem: 3, use: 4 }
  return {
    map: map.normalizedName,
    mapName: map.name,
    quests: quests.map((t) => t.name),
    bring: [...bring.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
  }
}
