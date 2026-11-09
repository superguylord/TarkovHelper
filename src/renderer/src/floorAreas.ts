import L from 'leaflet'
import type { MapArea, MapInfo, MapLayer } from '@shared/types'
import { loadSvg, makeCrs, svgBoundsOf } from './components/MapView'

// У части карт этаж описан «на всю карту», без деления на здания (Эпицентр, Улицы, Завод, Берег).
// Тогда находим здания сами: рисуем слой этажа из SVG вне экрана, склеиваем соседние фигуры
// в группы — каждая группа и есть здание. Название берём из ближайшей подписи района.

type Box = { x1: number; y1: number; x2: number; y2: number }

const W = 2000 // ширина, в которой меряем SVG (в пикселях)
const cache = new Map<string, Promise<MapArea[]>>()

export function detectAreas(map: MapInfo, layer: MapLayer): Promise<MapArea[]> {
  const key = `${map.normalizedName}:${layer.name}`
  let p = cache.get(key)
  if (!p) {
    p = measure(map, layer).catch(() => [])
    cache.set(key, p)
  }
  return p
}

async function measure(map: MapInfo, layer: MapLayer): Promise<MapArea[]> {
  if (!map.svgPath || !layer.svgLayer) return []
  const bounds = svgBoundsOf(map)
  if (!bounds) return []
  const text = await loadSvg(map.svgPath)
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement as unknown as SVGSVGElement
  const vb = svg.viewBox.baseVal
  if (!vb || !vb.width) return []

  // На карте SVG растянут на прямоугольник bounds в проекции карты, а внутри вписан по своему
  // viewBox (с полями, если пропорции не совпадают). Меряем в тех же пропорциях — поля совпадут.
  const crs = makeCrs(map)
  const a = crs.latLngToPoint(bounds.getNorthWest(), 0)
  const b = crs.latLngToPoint(bounds.getSouthEast(), 0)
  const [minX, maxX, minY, maxY] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)]
  const H = (W * (maxY - minY)) / (maxX - minX)
  svg.setAttribute('width', String(W))
  svg.setAttribute('height', String(H))
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-${W + 100}px;top:0;width:${W}px;height:${H}px;visibility:hidden;pointer-events:none`
  host.appendChild(svg)
  document.body.appendChild(host)
  try {
    const group = svg.querySelector(`[id="${layer.svgLayer}"]`) as SVGGraphicsElement | null
    if (!group) return []
    group.setAttribute('display', 'inline')
    const origin = svg.getBoundingClientRect()

    // габариты всех фигур этажа; огромные (подложки, рамки) пропускаем
    const boxes: Box[] = []
    for (const el of Array.from(group.querySelectorAll('path, rect, polygon, polyline, ellipse, circle'))) {
      const r = el.getBoundingClientRect()
      if (r.width < 0.5 && r.height < 0.5) continue
      if (r.width * r.height > W * H * 0.2) continue
      boxes.push({ x1: r.left - origin.left, y1: r.top - origin.top, x2: r.right - origin.left, y2: r.bottom - origin.top })
    }

    // Здание бывает нарисовано одной большой фигурой неправильной формы — тогда габариты соседних
    // зданий перекрываются, хотя дома не касаются. Поэтому крупные фигуры склеиваем, только если они
    // заметно перекрываются, а мелкие детали (комнаты, лестницы) прилипают к зданию, которого касаются.
    const gap = W * 0.006
    const area = (b: Box) => (b.x2 - b.x1) * (b.y2 - b.y1)
    const touch = (a: Box, b: Box) => a.x1 - gap <= b.x2 && b.x1 - gap <= a.x2 && a.y1 - gap <= b.y2 && b.y1 - gap <= a.y2
    const overlap = (a: Box, b: Box) => {
      const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
      const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
      return w > 0 && h > 0 ? (w * h) / Math.min(area(a), area(b)) : 0
    }
    const small = W * H * 0.004
    let clusters: Box[] = []
    for (const b of [...boxes].sort((p, q) => area(q) - area(p))) {
      const hit = clusters.find((c) => (area(b) < small ? touch(c, b) : overlap(c, b) > 0.5))
      if (hit) {
        hit.x1 = Math.min(hit.x1, b.x1)
        hit.y1 = Math.min(hit.y1, b.y1)
        hit.x2 = Math.max(hit.x2, b.x2)
        hit.y2 = Math.max(hit.y2, b.y2)
      } else clusters.push({ ...b })
    }
    // мелочь (отдельные лестницы, ящики) зданием не считаем
    clusters = clusters.filter((c) => area(c) > W * H * 0.0006)

    // пиксели замера -> игровые координаты через тот же прямоугольник bounds
    const toGame = (px: number, py: number) => {
      const ll = crs.pointToLatLng(L.point(minX + (px / W) * (maxX - minX), minY + (py / H) * (maxY - minY)), 0)
      return { x: ll.lng, z: ll.lat }
    }

    const rects = clusters.map((c) => {
      const p1 = toGame(c.x1, c.y1)
      const p2 = toGame(c.x2, c.y2)
      return [Math.min(p1.x, p2.x), Math.min(p1.z, p2.z), Math.max(p1.x, p2.x), Math.max(p1.z, p2.z)] as MapArea['rect']
    })
    const names = nameAreas(map, rects)
    const areas = rects.map((rect, i) => ({ name: names[i] ?? `Здание ${i + 1}`, rect }))
    return areas.sort((p, q) => p.name.localeCompare(q.name, 'ru'))
  } finally {
    host.remove()
  }
}

/**
 * Названия зданий по подписям районов. Подпись часто стоит на улице рядом с домом, поэтому берём
 * ближайшую к краю здания (не дальше 35 м) и отдаём каждую подпись только одному зданию.
 */
function nameAreas(map: MapInfo, rects: MapArea['rect'][]): (string | null)[] {
  const pairs: { i: number; text: string; d: number }[] = []
  rects.forEach(([x1, z1, x2, z2], i) => {
    for (const l of map.labels ?? []) {
      const dx = Math.max(x1 - l.x, 0, l.x - x2)
      const dz = Math.max(z1 - l.z, 0, l.z - z2)
      const d = Math.hypot(dx, dz)
      if (d <= 35) pairs.push({ i, text: l.text, d })
    }
  })
  pairs.sort((a, b) => a.d - b.d)
  const names: (string | null)[] = rects.map(() => null)
  const used = new Set<string>()
  for (const p of pairs) {
    if (names[p.i] || used.has(p.text)) continue
    names[p.i] = p.text
    used.add(p.text)
  }
  return names
}
