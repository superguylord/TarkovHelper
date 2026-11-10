import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { MapInfo, MapLabel, MapStyle, PlayerPosition, Point3 } from '@shared/types'
import { availableLayers, layerOfPoint, usesTiles } from '../mapLayers'
import { paletteFor } from '../mapPalette'

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

export function makeCrs(map: MapInfo): L.CRS {
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

const toBounds = (b: number[][] | undefined) =>
  b && b.length >= 2 ? L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]]) : undefined

export function mapBounds(map: MapInfo): L.LatLngBounds | undefined {
  return toBounds(map.bounds)
}

/** Прямоугольник, на который растянута векторная подложка. */
export function svgBoundsOf(map: MapInfo): L.LatLngBounds | undefined {
  return toBounds(map.svgBounds) ?? mapBounds(map)
}

export interface MapMarker {
  id: string
  point: Point3
  outline?: { x: number; z: number }[] // контур зоны квеста
  label: string
  detail?: string
  kind: 'quest' | 'quest-selected' | 'extract' | 'extract-shared' | 'transit'
  taskId?: string
}

// ---------- иконки маркеров ----------

const PIN = (fill: string, w: number, h: number) =>
  `<svg viewBox="0 0 28 36" width="${w}" height="${h}"><path d="M14 1.5C7.1 1.5 1.8 6.8 1.8 13.4 1.8 22.6 14 34.5 14 34.5s12.2-11.9 12.2-21.1C26.2 6.8 20.9 1.5 14 1.5z" fill="${fill}" stroke="#0a0f0c" stroke-width="2"/><circle cx="14" cy="13.2" r="4.6" fill="#0a0f0c"/></svg>`

// дверь со стрелкой наружу — знак эвакуации
const EXIT = (fill: string) =>
  `<svg viewBox="0 0 26 26" width="26" height="26"><rect x="1" y="1" width="24" height="24" rx="6" fill="${fill}" stroke="#0a0f0c" stroke-width="1.5"/><path d="M7.5 5.5h7v15h-7z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 13h8.5M17.5 10l3 3-3 3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const icon = (html: string, size: [number, number], anchor: [number, number]) =>
  L.divIcon({ className: 'map-icon', html, iconSize: size, iconAnchor: anchor })

const ICONS: Record<MapMarker['kind'], L.DivIcon> = {
  quest: icon(PIN('#c4a665', 28, 36), [28, 36], [14, 35]),
  'quest-selected': icon(PIN('#ff9d3c', 36, 46), [36, 46], [18, 45]),
  extract: icon(EXIT('#3f9a52'), [26, 26], [13, 13]),
  'extract-shared': icon(EXIT('#5f8fa3'), [26, 26], [13, 13]),
  transit: icon(EXIT('#8a6fc0'), [26, 26], [13, 13])
}

// подпись появляется над иконкой: у пина точка внизу, у выхода — в центре
const TIP_OFFSET: Record<MapMarker['kind'], [number, number]> = {
  quest: [0, -34],
  'quest-selected': [0, -44],
  extract: [0, -12],
  'extract-shared': [0, -12],
  transit: [0, -12]
}

interface Props {
  map: MapInfo
  markers: MapMarker[]
  position: PlayerPosition | null
  focus?: Point3[] | null // показать эти точки целиком (например, выбранный квест)
  style: MapStyle
  layer: string | null // активный этаж; null — основной уровень
  labels?: MapLabel[] // подписи районов поверх карты
  onMarkerClick?: (marker: MapMarker) => void
}

const svgCache = new Map<string, Promise<string>>()

/** Текст SVG-подложки (один запрос на карту за сеанс). */
export function loadSvg(path: string): Promise<string> {
  let p = svgCache.get(path)
  if (!p) {
    p = fetch(path).then((r) => r.text())
    p.catch(() => svgCache.delete(path))
    svgCache.set(path, p)
  }
  return p
}

export function MapView({ map, markers, position, focus, style, layer, labels, onMarkerClick }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const lmap = useRef<L.Map | null>(null)
  const markerLayer = useRef<L.LayerGroup | null>(null)
  const playerLayer = useRef<L.LayerGroup | null>(null)
  const labelLayer = useRef<L.LayerGroup | null>(null)
  const declutterRef = useRef<() => void>(() => {}) // перераскладка подписей, когда меняются значки
  const svgRef = useRef<SVGElement | null>(null) // векторная подложка (все этажи внутри)
  const baseTiles = useRef<L.TileLayer | null>(null)
  const floorTiles = useRef<L.TileLayer | null>(null)
  const [baseReady, setBaseReady] = useState(0) // SVG грузится асинхронно — после загрузки применяем этаж
  const tiles = usesTiles(map, style)
  const layers = availableLayers(map, style)

  // создание карты при смене локации
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, {
      crs: makeCrs(map),
      zoomSnap: 0.25,
      minZoom: (map.minZoom ?? 1) - 2,
      maxZoom: (map.maxZoom ?? 6) + 2
    })
    m.attributionControl?.setPrefix(false).addAttribution('Карты: tarkov.dev (CC BY-NC-SA 4.0)')
    const bounds = mapBounds(map)
    if (bounds) m.fitBounds(bounds)
    else m.setView([0, 0], 2)

    let cancelled = false
    svgRef.current = null
    baseTiles.current = null
    floorTiles.current = null
    if (!tiles && map.svgPath && bounds) {
      loadSvg(map.svgPath).then((text) => {
        if (cancelled) return
        const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement as unknown as SVGElement
        // подложка — в слой тайлов, иначе SVG ляжет поверх маркеров (он грузится позже них)
        L.svgOverlay(svg, svgBoundsOf(map) ?? bounds, { className: 'map-svg', pane: 'tilePane' }).addTo(m)
        svgRef.current = svg
        setBaseReady((n) => n + 1)
      }).catch(() => {})
    } else if (map.tilePath) {
      baseTiles.current = L.tileLayer(map.tilePath, {
        tileSize: map.tileSize ?? 256,
        bounds,
        maxNativeZoom: map.maxZoom ?? 6,
        maxZoom: (map.maxZoom ?? 6) + 2
      }).addTo(m)
      setBaseReady((n) => n + 1)
    }

    labelLayer.current = L.layerGroup().addTo(m)
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
  }, [map, tiles])

  // свои цвета карты: стиль подмешивается внутрь SVG и перекрывает исходные классы
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    let el = svg.querySelector('style#th-palette')
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      el.id = 'th-palette'
      svg.appendChild(el)
    }
    el.textContent = paletteFor(style)
  }, [style, baseReady])

  // подписи районов. Крупные важнее мелких; подпись, которая налезла бы на уже показанную подпись,
  // значок или табличку выхода, прячем — при отдалении остаются главные районы, при приближении
  // появляются здания и магазины
  useEffect(() => {
    const m = lmap.current
    const group = labelLayer.current
    if (!m || !group) return
    group.clearLayers()
    const placed = [...(labels ?? [])]
      .sort((a, b) => (b.size ?? 100) - (a.size ?? 100))
      .map((l) => {
        const minor = (l.size ?? 100) < 100
        const font = (8 + (3 * (l.size ?? 100)) / 100).toFixed(1)
        const turn = l.rotation ? ` rotate(${l.rotation}deg)` : ''
        const marker = L.marker(L.latLng(l.z, l.x), {
          icon: L.divIcon({
            className: `map-label${minor ? ' map-label-minor' : ''}`,
            html: `<span style="font-size:${font}px;transform:translate(-50%,-50%)${turn}">${escapeHtml(l.text)}</span>`,
            iconSize: [0, 0]
          }),
          interactive: false,
          keyboard: false
        })
        group.addLayer(marker)
        return marker
      })
    const declutter = () => {
      // значки на карте и постоянные таблички выходов — подписи их не перекрывают
      const obstacles = [
        ...m.getPane('markerPane')!.querySelectorAll(':scope > :not(.map-label)'),
        ...m.getPane('tooltipPane')!.children
      ].map((e) => e.getBoundingClientRect())
      const taken: DOMRect[] = []
      const near = (r: DOMRect, t: DOMRect, gx: number, gy: number) =>
        r.left < t.right + gx && r.right > t.left - gx && r.top < t.bottom + gy && r.bottom > t.top - gy
      for (const marker of placed) {
        const span = marker.getElement()?.firstElementChild as HTMLElement | null
        if (!span) continue
        const r = span.getBoundingClientRect()
        const hit = taken.some((t) => near(r, t, 18, 10)) || obstacles.some((t) => near(r, t, 4, 2))
        span.style.visibility = hit ? 'hidden' : ''
        if (!hit) taken.push(r)
      }
    }
    declutterRef.current = declutter
    declutter()
    m.on('zoomend', declutter)
    return () => {
      m.off('zoomend', declutter)
      declutterRef.current = () => {}
    }
  }, [labels, map, baseReady])

  // этаж: показываем его слой поверх основного уровня, основной приглушаем
  useEffect(() => {
    const m = lmap.current
    if (!m) return
    const active = layers.find((l) => l.name === layer) ?? null
    const svg = svgRef.current
    if (svg) {
      for (const l of map.layers ?? []) {
        if (!l.svgLayer) continue
        svg.querySelector(`[id="${l.svgLayer}"]`)?.setAttribute('display', l === active ? 'inline' : 'none')
      }
      if (map.svgLayer) svg.querySelector(`[id="${map.svgLayer}"]`)?.setAttribute('opacity', active ? '0.3' : '1')
    }
    floorTiles.current?.remove()
    floorTiles.current = null
    baseTiles.current?.setOpacity(active ? 0.35 : 1)
    if (tiles && active?.tilePath) {
      floorTiles.current = L.tileLayer(active.tilePath, {
        tileSize: map.tileSize ?? 256,
        bounds: mapBounds(map),
        maxNativeZoom: map.maxZoom ?? 6,
        maxZoom: (map.maxZoom ?? 6) + 2,
        zIndex: 2
      }).addTo(m)
    }
  }, [layer, map, tiles, baseReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // маркеры квестов и выходов
  useEffect(() => {
    const group = markerLayer.current
    if (!group) return
    group.clearLayers()
    const isQuest = (k: MapMarker['kind']) => k === 'quest' || k === 'quest-selected'
    // выходы под квестами, выбранный квест — поверх всех
    const weight = (k: MapMarker['kind']) => (k === 'quest-selected' ? 2 : isQuest(k) ? 1 : 0)
    const sorted = [...markers].sort((a, b) => weight(a.kind) - weight(b.kind))
    for (const mk of sorted) {
      // точки с другого этажа приглушаем, но не прячем — видно, что там что-то есть
      const pointLayer = layerOfPoint(layers, mk.point)
      const other = pointLayer !== (layers.some((l) => l.name === layer) ? layer : null)
      if (mk.outline) {
        group.addLayer(
          L.polygon(
            mk.outline.map((p) => L.latLng(p.z, p.x)),
            { className: `zone zone-${mk.kind}${other ? ' zone-dim' : ''}`, interactive: false }
          )
        )
      }
      const marker = L.marker(toLatLng(mk.point), {
        icon: ICONS[mk.kind],
        zIndexOffset: weight(mk.kind) * 1000 - (other ? 500 : 0),
        riseOnHover: true,
        opacity: other ? 0.4 : 1
      })
      const detail = mk.detail ? (isQuest(mk.kind) ? `<br>${escapeHtml(mk.detail)}` : `<br><small>${escapeHtml(mk.detail)}</small>`) : ''
      const floor = pointLayer ? `<br><small>${escapeHtml(pointLayer)}</small>` : ''
      marker.bindTooltip(`<b>${escapeHtml(mk.label)}</b>${detail}${floor}`, {
        className: `mk-tip${isQuest(mk.kind) ? '' : ' mk-tip-exit'}`,
        direction: 'top',
        offset: TIP_OFFSET[mk.kind],
        permanent: !isQuest(mk.kind)
      })
      if (onMarkerClick) marker.on('click', () => onMarkerClick(mk))
      group.addLayer(marker)
    }
    const frame = requestAnimationFrame(() => declutterRef.current())
    return () => cancelAnimationFrame(frame)
  }, [markers, map, layer, tiles, onMarkerClick]) // eslint-disable-line react-hooks/exhaustive-deps

  // приблизить к выбранным точкам
  useEffect(() => {
    const m = lmap.current
    if (!m || !focus?.length) return
    const b = L.latLngBounds(focus.map(toLatLng))
    // сразу после открытия раздела контейнер карты ещё не получил размер — ждём кадр
    const t = setTimeout(() => {
      m.invalidateSize()
      m.flyToBounds(b.pad(0.15), { maxZoom: (map.maxZoom ?? 6) - 1, duration: 0.6 })
    }, 80)
    return () => clearTimeout(t)
  }, [focus, map])

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
    // конус обзора: широкий сектор в сторону взгляда, его не спутать с точкой
    const icon = L.divIcon({
      className: 'player-icon',
      html: `<div class="player-cone" style="transform: rotate(${angle}deg)">${CONE_SVG}</div>`,
      iconSize: [96, 96],
      iconAnchor: [48, 48]
    })
    layer.addLayer(L.marker(here, { icon, interactive: false }))
    m.panTo(here)
  }, [position, map])

  return <div ref={el} className={`map style-${style}${tiles ? ' map-tiles' : ''}`} />
}

const CONE_SVG = `<svg viewBox="0 0 96 96" width="96" height="96">
  <defs><radialGradient id="cone-g" cx="48" cy="48" r="46" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#dfbd70" stop-opacity="0.85"/><stop offset="1" stop-color="#dfbd70" stop-opacity="0"/>
  </radialGradient></defs>
  <path d="M48 48 L21 6 A46 46 0 0 1 75 6 Z" fill="url(#cone-g)"/>
  <circle cx="48" cy="48" r="8" fill="#dfbd70" stroke="#0a0f0c" stroke-width="2.5"/>
  <path d="M48 36 L53 45 L43 45 Z" fill="#0a0f0c"/>
</svg>`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
