import type { GameData, MapInfo, Progress } from '@shared/types'
import type { MapMarker } from './components/MapView'
import { questState } from './questLogic'

const EXTRACT_KIND: Record<string, MapMarker['kind']> = {
  pmc: 'extract-pmc',
  scav: 'extract-scav',
  shared: 'extract-shared'
}

/** Маркеры для карты: точки активных квестов и выходы. */
export function buildMarkers(
  data: GameData,
  map: MapInfo,
  progress: Progress,
  opts: { quests: boolean; available: boolean; extracts: boolean }
): MapMarker[] {
  const out: MapMarker[] = []
  if (opts.quests) {
    for (const task of data.tasks) {
      const st = questState(task, progress)
      if (st !== 'active' && !(opts.available && st === 'available')) continue
      for (const obj of task.objectives) {
        obj.points.forEach((p, i) => {
          if (p.map !== map.normalizedName) return
          out.push({ id: `${obj.id}-${i}`, point: p, label: task.name, detail: obj.description, kind: 'quest' })
        })
      }
    }
  }
  if (opts.extracts) {
    map.extracts.forEach((e, i) => {
      if (!e.position) return
      out.push({
        id: `ex-${i}`,
        point: e.position,
        label: e.name,
        kind: EXTRACT_KIND[e.faction] ?? 'extract-shared'
      })
    })
  }
  return out
}
