import type { MapStyle } from '@shared/types'

// Свои цвета для векторных карт tarkov.dev. В их SVG все элементы размечены классами
// (земля, деревья, вода, асфальт, здания, полы, лестницы...), поэтому карту можно перерисовать
// целиком — переопределив стили этих классов, без фильтров поверх картинки.
//
// «Схема»: трава — холодный тёмно-зелёный (не оливковый, чтобы не сливаться с хаки интерфейса),
// грунт и грунтовки — коричневые, асфальт — серый, здания — приглушённый тёплый светло-серый.

const SCHEME = `
  .land { fill: #26392c }
  .trees { fill: #1b3022 }
  .water { fill: #284257 }
  .rock { fill: #4a4237 }
  .wood { fill: #5a432d }
  .cement { fill: #3c3e40 }
  .tarmac { fill: #474a4e }
  .gravel { fill: #4e3e2b }
  .building { fill: #a3a199; stroke: #18191a; stroke-width: 0.6 }
  .floor { fill: #b6b4ab; stroke: #18191a; stroke-width: 0.5 }
  .locked { fill: #74766f }
  .stairs { fill: #c9a04a }
  .fence { stroke: #6b7268; stroke-width: 0.8 }
  .road_tarmac { stroke: #53575b }
  .road_gravel { stroke: #5e4932 }
  .railroad { stroke: #6e5a4c; stroke-dasharray: 5 }
  .powerline { stroke: #a8924a; stroke-width: 1.2; stroke-dasharray: 4, 6 }
  .danger, .danger_small { fill: #c0392b; fill-opacity: 0.25; stroke: #d0574a }
  .map_border { stroke: #0f1110 }
  .task { fill: #18191a }
  .shadow { filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.7)) }
  /* классы отдельных карт: корпус ТЦ на Развязке, мелочь на Резерве, самолёты на Лесу и Береге */
  .structure { fill: #96948d; stroke: #18191a; stroke-width: 0.6 }
  .misc { fill: #74766f }
  .chopper { fill: #18191a }
  .plane { fill: #b6b4ab }
  .wall { stroke: #18191a }
`

/** CSS, которое подмешивается в SVG карты для выбранного стиля (пусто — исходные цвета). */
export function paletteFor(style: MapStyle): string {
  return style === 'scheme' ? SCHEME : ''
}
