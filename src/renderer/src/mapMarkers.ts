import type { GameData, MapInfo, Progress, Task, TaskObjective } from '@shared/types'
import type { MapMarker } from './components/MapView'
import { questState } from './questLogic'

export type Faction = 'pmc' | 'scav'

export interface MarkerOptions {
  quests: boolean
  extracts: boolean
  faction: Faction
  selectedTask: string | null
}

// задания на убийство не привязаны к точке — маркер для них только мешает
const isKill = (o: TaskObjective) => o.type === 'shoot'

const objectiveOnMap = (o: TaskObjective, map: string) =>
  o.points.some((p) => p.map === map) || o.maps.includes(map)

/** Взятые квесты, по которым на этой карте есть что делать (с учётом отмеченных целей). */
export function questsOnMap(data: GameData, map: MapInfo, progress: Progress): Task[] {
  return data.tasks.filter((t) => {
    if (questState(t, progress) !== 'active') return false
    return t.objectives.some(
      (o) => !progress.objectives[o.id] && (objectiveOnMap(o, map.normalizedName) || t.map === map.normalizedName)
    )
  })
}

/** Маркеры для карты: точки квестов (кроме убийств и выполненных целей) и выходы. */
export function buildMarkers(data: GameData, map: MapInfo, progress: Progress, opts: MarkerOptions): MapMarker[] {
  const out: MapMarker[] = []
  if (opts.quests) {
    for (const task of questsOnMap(data, map, progress)) {
      const selected = task.id === opts.selectedTask
      for (const obj of task.objectives) {
        if (isKill(obj) || progress.objectives[obj.id]) continue
        obj.points.forEach((p, i) => {
          if (p.map !== map.normalizedName) return
          out.push({
            id: `${obj.id}-${i}`,
            point: p,
            outline: p.outline,
            label: task.name,
            detail: obj.description,
            kind: selected ? 'quest-selected' : 'quest',
            taskId: task.id
          })
        })
      }
    }
  }
  if (opts.extracts) {
    map.extracts.forEach((e, i) => {
      if (!e.position) return
      if (e.faction !== 'shared' && e.faction !== 'transit' && e.faction !== opts.faction) return
      out.push({
        id: `ex-${i}`,
        point: e.position,
        label: e.name,
        detail: e.note,
        kind: e.faction === 'transit' ? 'transit' : e.faction === 'shared' ? 'extract-shared' : 'extract'
      })
    })
  }
  return out
}
