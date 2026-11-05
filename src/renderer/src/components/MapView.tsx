import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { MapInfo, PlayerPosition, Point3 } from '@shared/types'

// Проекция карт как на tarkov.dev: игровые координаты (x, z) -> lat/lng с поворотом
// и линейным преобразованием из maps.json.

function applyRotation(latLng: L.LatLng, rotation: number): L.LatLng {
  if (!latLng.lng && !latLng.lat) return L.latLng(0, 0)
  if (!rotation) return latLng
  const a = (rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const { lng: x, lat: y } = latLng
  return L.latLng(x * sin + y * cos, x * cos - y * sin)
}

function makeCrs(map: MapInfo): L.CRS {
  const [scaleX, marginX, scaleY, marginY] = map.transform
  return L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(scaleX, marginX, -scaleY, marginY),
    projection: L.extend({}, L.Projection.LonLat, {
      project: (ll: L.LatLng) => L.Projection.LonLat.project(applyRotation(ll, map.coordinateRotation)),
      unproject: (p: L.Point) => applyRotation(L.Projection.LonLat.unproject(p), -map.coordinateRotation)
    })
  }) as L.CRS
}

const toLatLng =(p: Point3) => L.latLng(p.z, p.x)

function mapBounds(map: MapInfo): L.LatLngBounds | undefined {
  const b = map.bounds
  if (b.length < 2) return undefined
  return L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]])
}

export interface MapMarker {
  id: string
  point: Point3
  label: string
  detail?: string
  kind: 'quest' | 'extract-pmc' | 'extract-scav' | 'extract-shared'
}

interface Props {
  map: MapInfo
  markers: MapMarker[]
  position: PlayerPosition | null
  compact?: boolean // мини-карта: без управления, центр на игроке
}

const svgCache = new Map<string, Promise<string>>()

export function MapView({ map, markers, position, compact }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const lmap = useRef<L.Map | null>(null)
  const markerLayer = useRef<L.LayerGroup | null>(null)
  const playerLayer = useRef<L.LayerGroup | null>(null)

  // создание карты при смене локации
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, {
      crs: makeCrs(map),
      zoomControl: !compact,
      attributionControl: !compact,
      zoomSnap: 0.25,
      minZoom: (map.minZoom ?? 1) - 2,
      maxZoom: (map.maxZoom ?? 6) + 2
    })
    m.attributionControl?.setPrefix(false).addAttribution('Карты: tarkov.dev (CC BY-NC-SA 4.0)')
    const bounds = mapBounds(map)
    if (bounds) m.fitBounds(bounds)
    else m.setView([0, 0], 2)

    let cancelled = false
    if (map.svgPath && bounds) {
      let p = svgCache.get(map.svgPath)
      if (!p) {
        p = fetch(map.svgPath).then((r) => r.text())
        svgCache.set(map.svgPath, p)
      }
      p.then((text) => {
        if (cancelled) return
        const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement as unknown as SVGElement
        // в одном SVG лежат все этажи — оставляем только основной уровень
        for (const id of map.hiddenSvgLayers ?? []) {
          svg.querySelector(`[id="${id}"]`)?.setAttribute('display', 'none')
        }
        L.svgOverlay(svg, bounds, { className: 'map-svg' }).addTo(m)
      }).catch(() => svgCache.delete(map.svgPath!))
    } else if (map.tilePath) {
      L.tileLayer(map.tilePath, {
        tileSize: map.tileSize ?? 256,
        bounds,
        maxNativeZoom: map.maxZoom ?? 6,
        maxZoom: (map.maxZoom ?? 6) + 2
      }).addTo(m)
    }

    markerLayer.current = L.layerGroup().addTo(m)
    playerLayer.current = L.layerGroup().addTo(m)
    lmap.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      cancelled = true
      ro.disconnect()
      m.remove()
      lmap.current = null
    }
  }, [map, compact])

  // маркеры квестов и выходов
  useEffect(() => {
    const layer = markerLayer.current
    if (!layer) return
    layer.clearLayers()
    for (const mk of markers) {
      const marker = L.circleMarker(toLatLng(mk.point), {
        radius: mk.kind === 'quest' ? 7 : 6,
        className: `mk mk-${mk.kind}`
      })
      marker.bindTooltip(
        `<b>${escapeHtml(mk.label)}</b>${mk.detail ? `<br>${escapeHtml(mk.detail)}` : ''}`,
        { className: 'mk-tip', direction: 'top', permanent: mk.kind !== 'quest' && !compact }
      )
      layer.addLayer(marker)
    }
  }, [markers, map, compact])

  // позиция игрока: стрелка, повёрнутая по направлению взгляда
  useEffect(() => {
    const m = lmap.current
    const layer = playerLayer.current
    if (!m || !layer) return
    layer.clearLayers()
    if (!position) return
    const here = toLatLng(position)
    // направление считаем через проекцию, чтобы учесть поворот конкретной карты
    const rad = (position.yaw * Math.PI) / 180
    const ahead = toLatLng({ x: position.x + Math.sin(rad) * 10, y: 0, z: position.z + Math.cos(rad) * 10 })
    const a = m.latLngToLayerPoint(here)
    const b = m.latLngToLayerPoint(ahead)
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90
    const icon = L.divIcon({
      className: 'player-icon',
      html: `<div class="player-arrow" style="transform: rotate(${angle}deg)"></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    })
    layer.addLayer(L.marker(here, { icon, interactive: false }))
    if (compact) m.setView(here, Math.max(m.getZoom(), (map.maxZoom ?? 6) - 2))
    else m.panTo(here)
  }, [position, map, compact])

  return <div ref={el} className={compact ? 'map map-compact' : 'map'} />
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
