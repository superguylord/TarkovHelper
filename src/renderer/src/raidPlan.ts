import type { BringItem, Extract, GameData, MapInfo, MapPoint, Point3, Progress, TaskObjective } from '@shared/types'
import { questsOnMap, type Faction } from './mapMarkers'

export interface PlanStop {
  taskId: string
  taskName: string
  objective: TaskObjective
  point: MapPoint
  distance: number // от предыдущей точки маршрута, м
}

export interface PlanItem extends BringItem {
  purposes: string[] // названия квестов
}

export interface RaidPlan {
  map: string
  mapName: string
  stops: PlanStop[] // точки маршрута по порядку
  extract: (Extract & { distance: number }) | null // ближайший выход к последней точке
  alongTheWay: { taskName: string; description: string }[] // цели без точки на карте: убийства, выход и т.п.
  bring: PlanItem[]
  total: number // длина маршрута, м
  startFromPlayer: boolean
}

const dist = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.z - b.z)

/** Сколько взятых квестов и незакрытых целей на каждой карте — по убыванию. */
export function mapPriority(data: GameData, progress: Progress): { map: MapInfo; quests: number }[] {
  return data.maps
    .map((map) => ({ map, quests: questsOnMap(data, map, progress).length }))
    .sort((a, b) => b.quests - a.quests)
}

interface Candidate {
  taskId: string
  taskName: string
  objective: TaskObjective
  points: MapPoint[]
}

/** Жадный маршрут «к ближайшей следующей цели» от заданной точки. */
function greedy(cands: Candidate[], start: Point3 | null): PlanStop[] {
  const left = [...cands]
  const out: PlanStop[] = []
  let here = start
  while (left.length) {
    let best = { i: 0, p: left[0].points[0], d: Infinity }
    left.forEach((c, i) => {
      for (const p of c.points) {
        const d = here ? dist(here, p) : 0
        if (d < best.d) best = { i, p, d }
      }
    })
    const c = left.splice(best.i, 1)[0]
    out.push({ taskId: c.taskId, taskName: c.taskName, objective: c.objective, point: best.p, distance: here ? best.d : 0 })
    here = best.p
  }
  return out
}

const length = (stops: PlanStop[]) => stops.reduce((n, s) => n + s.distance, 0)

/**
 * План на рейд: порядок целей (короткий обход), выход в конце и что взять с собой.
 * Если известна позиция игрока на этой карте — маршрут начинается от неё.
 */
export function buildPlan(
  data: GameData,
  map: MapInfo,
  progress: Progress,
  faction: Faction,
  player: Point3 | null
): RaidPlan {
  const cands: Candidate[] = []
  const alongTheWay: RaidPlan['alongTheWay'] = []
  const bring = new Map<string, PlanItem>()
  const addBring = (item: BringItem, taskName: string) => {
    const key = `${item.kind}:${item.name}`
    const cur = bring.get(key)
    if (!cur) bring.set(key, { ...item, purposes: [taskName] })
    else {
      // ключ нужен один, а закладки и маркеры складываются
      if (item.kind !== 'key') cur.count += item.count
      if (!cur.purposes.includes(taskName)) cur.purposes.push(taskName)
    }
  }

  for (const task of questsOnMap(data, map, progress)) {
    for (const o of task.objectives) {
      if (progress.objectives[o.id]) continue
      const points = o.points.filter((p) => p.map === map.normalizedName)
      const onThisMap = points.length > 0 || o.maps.includes(map.normalizedName) || (!o.maps.length && task.map === map.normalizedName)
      if (!onThisMap) continue
      if (o.type !== 'shoot' && points.length) cands.push({ taskId: task.id, taskName: task.name, objective: o, points })
      else if (!['giveItem', 'giveQuestItem', 'traderLevel', 'skill', 'taskStatus', 'sellItem'].includes(o.type)) {
        alongTheWay.push({ taskName: task.name, description: o.description })
      }
      for (const b of o.bring ?? []) addBring(b, task.name)
    }
    for (const k of task.neededKeys ?? []) {
      if (k.map && k.map !== map.normalizedName) continue
      for (const key of k.keys) {
        if (![...bring.values()].some((b) => b.kind === 'key' && b.name.split(' или ').includes(key))) {
          addBring({ name: key, count: 1, kind: 'key' }, task.name)
        }
      }
    }
  }

  // старт: от игрока, если он на этой карте; иначе пробуем начать с каждой цели и берём самый короткий обход
  let stops: PlanStop[] = []
  if (player) stops = greedy(cands, player)
  else {
    let best = Infinity
    for (let i = 0; i < cands.length; i++) {
      const order = greedy([cands[i], ...cands.filter((_, j) => j !== i)].slice(1), cands[i].points[0])
      const route: PlanStop[] = [
        { taskId: cands[i].taskId, taskName: cands[i].taskName, objective: cands[i].objective, point: cands[i].points[0], distance: 0 },
        ...order
      ]
      if (length(route) < best) {
        best = length(route)
        stops = route
      }
    }
  }

  const last = stops[stops.length - 1]?.point ?? player
  let extract: RaidPlan['extract'] = null
  if (last) {
    for (const e of map.extracts) {
      if (!e.position || e.faction === 'transit') continue
      if (e.faction !== 'shared' && e.faction !== faction) continue
      const d = dist(last, e.position)
      if (!extract || d < extract.distance) extract = { ...e, distance: d }
    }
  }

  const order: Record<BringItem['kind'], number> = { key: 0, mark: 1, plant: 2, questItem: 3, use: 4 }
  return {
    map: map.normalizedName,
    mapName: map.name,
    stops,
    extract,
    alongTheWay,
    bring: [...bring.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)),
    total: length(stops) + (extract?.distance ?? 0),
    startFromPlayer: !!player
  }
}
