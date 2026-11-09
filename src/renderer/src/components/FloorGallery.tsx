import { memo, useMemo } from 'react'
import type { MapArea, MapInfo, MapLayer, MapStyle, PlayerPosition, Point3 } from '@shared/types'
import { MapView, type MapMarker } from './MapView'
import { availableLayers, layerOfPoint } from '../mapLayers'

type Rect = [number, number, number, number]

export interface FloorPanel {
  key: string
  layer: MapLayer
  title: string // «2 этаж»
  rect: Rect | null // null — этаж на всю карту
}

export interface FloorGroup {
  name: string // здание
  panels: FloorPanel[]
}

const inRect = (p: Point3, r: Rect | null) =>
  !r || (p.x >= Math.min(r[0], r[2]) && p.x <= Math.max(r[0], r[2]) && p.z >= Math.min(r[1], r[3]) && p.z <= Math.max(r[1], r[3]))

const near = (a: Rect, b: Rect, gap = 30) =>
  Math.min(a[0], a[2]) - gap <= Math.max(b[0], b[2]) &&
  Math.min(b[0], b[2]) - gap <= Math.max(a[0], a[2]) &&
  Math.min(a[1], a[3]) - gap <= Math.max(b[1], b[3]) &&
  Math.min(b[1], b[3]) - gap <= Math.max(a[1], a[3])

const union = (a: Rect, b: Rect): Rect => [
  Math.min(a[0], a[2], b[0], b[2]),
  Math.min(a[1], a[3], b[1], b[3]),
  Math.max(a[0], a[2], b[0], b[2]),
  Math.max(a[1], a[3], b[1], b[3])
]

/**
 * Раскладка этажей: по зданиям, в каждом — его этажи по порядку.
 * detected — здания, найденные по рисунку этажа там, где в данных этаж «на всю карту».
 */
export function floorGroups(map: MapInfo, style: MapStyle, detected: Record<string, MapArea[]> = {}): FloorGroup[] {
  const groups = new Map<string, FloorPanel[]>()
  const add = (group: string, panel: FloorPanel) => {
    const list = groups.get(group) ?? []
    list.push(panel)
    groups.set(group, list)
  }
  for (const layer of availableLayers(map, style)) {
    // одно здание может быть описано несколькими прямоугольниками — соседние склеиваем
    const byName = new Map<string, Rect[]>()
    let whole = false
    for (const e of layer.extents) {
      const areas = e.areas.length ? e.areas : (detected[layer.name] ?? [])
      if (!areas.length) whole = true
      for (const a of areas) {
        const list = byName.get(a.name) ?? []
        const i = list.findIndex((r) => near(r, a.rect))
        if (i >= 0) list[i] = union(list[i], a.rect)
        else list.push(a.rect)
        byName.set(a.name, list)
      }
    }
    if (whole) add('Весь уровень', { key: `${layer.name}-all`, layer, title: layer.name, rect: null })
    for (const [name, rects] of byName) {
      rects.forEach((rect, i) =>
        add(name || 'Здание', {
          key: `${layer.name}-${name}-${i}`,
          layer,
          title: rects.length > 1 ? `${layer.name} · ${i + 1}` : layer.name,
          rect
        })
      )
    }
  }
  return [...groups].map(([name, panels]) => ({ name, panels }))
}

interface Props {
  map: MapInfo
  style: MapStyle
  groups: FloorGroup[]
  markers: MapMarker[]
  position: PlayerPosition | null
  active: string | null // key выбранной панели
  onSelect: (panel: FloorPanel) => void
}

/** Панели этажей рядом с основной картой — как раскладка зданий на tarkov.help. */
export const FloorGallery = memo(function FloorGallery({ map, style, groups, markers, position, active, onSelect }: Props) {
  const layers = useMemo(() => availableLayers(map, style), [map, style])
  // на панели — только квесты, которые стоят именно на этом этаже этого здания
  const panelMarkers = useMemo(() => {
    const out = new Map<string, MapMarker[]>()
    const quests = markers.filter((m) => m.kind === 'quest' || m.kind === 'quest-selected')
    for (const g of groups) {
      for (const p of g.panels) {
        out.set(p.key, quests.filter((m) => inRect(m.point, p.rect) && layerOfPoint(layers, m.point) === p.layer.name))
      }
    }
    return out
  }, [groups, markers, layers])

  if (!groups.length) return <div className="empty">У этой карты нет отдельных этажей.</div>

  return (
    <div className="floor-gallery">
      {groups.map((g) => (
        <section key={g.name} className="fg-group">
          <div className="fg-title">{g.name}</div>
          <div className="fg-panels">
            {g.panels.map((p) => {
              const pins = panelMarkers.get(p.key) ?? []
              const here = position && inRect(position, p.rect) && layerOfPoint(layers, position) === p.layer.name ? position : null
              return (
                <button key={p.key} className={p.key === active ? 'fg-panel active' : 'fg-panel'} onClick={() => onSelect(p)}>
                  <MapView map={map} markers={pins} position={here} style={style} layer={p.layer.name} inset={{ rect: p.rect }} />
                  <span className="fg-label">{p.title}</span>
                  {pins.length > 0 && <span className="fg-pins">{pins.length}</span>}
                  {here && <span className="fg-here">вы здесь</span>}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
})
