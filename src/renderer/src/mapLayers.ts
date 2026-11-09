import type { MapInfo, MapLayer, MapStyle, Point3 } from '@shared/types'

export const MAP_STYLES: [MapStyle, string][] = [
  ['classic', 'Классика'],
  ['scheme', 'Схема'],
  ['khaki', 'Хаки'],
  ['night', 'Тёмная'],
  ['detailed', 'Подробная']
]

/** Рисуем ли карту растровыми тайлами (а не векторной схемой SVG). */
export const usesTiles = (map: MapInfo, style: MapStyle) =>
  !!map.tilePath && (style === 'detailed' || !map.svgPath)

/** Этажи, которые можно показать в выбранном стиле: у SVG и у тайлов свои наборы. */
export function availableLayers(map: MapInfo, style: MapStyle): MapLayer[] {
  const tiles = usesTiles(map, style)
  return (map.layers ?? []).filter((l) => (tiles ? !!l.tilePath : !!l.svgLayer))
}

/** На каком этаже точка: по высоте y и зонам этажа; null — основной уровень. */
export function layerOfPoint(layers: MapLayer[], p: Point3): string | null {
  for (const layer of layers) {
    for (const e of layer.extents) {
      if (p.y < e.height[0] || p.y > e.height[1]) continue
      if (!e.areas.length) return layer.name
      for (const { rect } of e.areas) {
        const [x1, z1, x2, z2] = rect
        if (p.x >= Math.min(x1, x2) && p.x <= Math.max(x1, x2) && p.z >= Math.min(z1, z2) && p.z <= Math.max(z1, z2)) {
          return layer.name
        }
      }
    }
  }
  return null
}
