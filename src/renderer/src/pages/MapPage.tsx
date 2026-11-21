import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../useAppState'
import { MapView, type MapMarker, type MapPoi } from '../components/MapView'
import { questState } from '../questLogic'
import type { MapLock, MapLoot } from '@shared/types'
import { QuestPage } from './QuestPage'
import { buildMarkers, loadFaction, questsOnMap, type Faction } from '../mapMarkers'
import type { Nav } from '../MainApp'
import { MAP_STYLES, availableLayers, layerOfPoint } from '../mapLayers'

const LAYER_TOGGLES = [
  ['quests', 'Квесты'],
  ['extracts', 'Выходы'],
  ['labels', 'Названия'],
  ['spawns', 'Спауны'],
  ['keys', 'Ключи'],
  ['loot', 'Редкий лут'],
  ['injectors', 'Инъекторы']
] as const

type LayerOpts = Record<(typeof LAYER_TOGGLES)[number][0], boolean>
const DEFAULT_LAYERS: LayerOpts = {
  quests: true,
  extracts: true,
  labels: true,
  spawns: true,
  keys: true,
  loot: true,
  injectors: true
}

// категории лута: какая кнопка включает, как называется и какой значок, если в одной точке их несколько
const LOOT_CATEGORIES = [
  { kind: 'loose', layer: 'loot', poi: 'loot', title: 'Редкий лут' },
  { kind: 'injector', layer: 'injectors', poi: 'injector', title: 'Инъекторы' }
] as const
// какие слои включены — помним между запусками
function loadLayers(): LayerOpts {
  try {
    return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem('mapLayers') ?? '{}') }
  } catch {
    return DEFAULT_LAYERS
  }
}

const LOCK_KIND: Record<MapLock['kind'], string> = { door: 'дверь', trunk: 'багажник', container: 'контейнер' }
const shortRub = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₽` : `${Math.round(n / 1000)} тыс ₽`

export function MapPage({ s, nav }: { s: AppState; nav: Nav }) {
  const { data, live, progress } = s
  const [selected, setSelected] = useState<string | null>(null)
  const [opts, setOpts] = useState<LayerOpts>(loadLayers)
  const [faction, setFaction] = useState<Faction>(loadFaction)
  const [taskId, setTaskId] = useState<string | null>(null) // квест, подсвеченный на карте
  const [pageTaskId, setPageTaskId] = useState<string | null>(null) // квест, открытый на отдельной странице
  const [floor, setFloor] = useState<string | null>(null) // этаж; null — основной уровень
  const style = s.settings?.mapStyle ?? 'scheme'

  // как только игра загрузила локацию — переключаемся на неё
  useEffect(() => {
    if (live?.currentMap) setSelected(live.currentMap)
  }, [live?.currentMap])

  // переход из брифинга — открываем нужную карту (после автоматического выбора текущей карты)
  useEffect(() => {
    if (nav.mapRequest) setSelected(nav.mapRequest.map)
  }, [nav.mapRequest])

  // в начале рейда сразу показываем выходы
  useEffect(() => {
    if (live?.inRaid) setOpts((o) => ({ ...o, extracts: true }))
  }, [live?.inRaid])

  useEffect(() => {
    try {
      localStorage.setItem('mapLayers', JSON.stringify(opts))
    } catch {
      /* без сохранения — слои вернутся к обычным при следующем запуске */
    }
  }, [opts])

  useEffect(() => {
    try {
      localStorage.setItem('faction', faction)
    } catch {
      /* без сохранения выбора — не страшно */
    }
  }, [faction])

  const map = data?.maps.find((m) => m.normalizedName === selected) ?? data?.maps[0]
  const floors = useMemo(() => (map ? availableLayers(map, style) : []), [map, style])

  // новая карта или стиль без такого этажа — возвращаемся на основной уровень
  useEffect(() => {
    if (floor && !floors.some((l) => l.name === floor)) setFloor(null)
  }, [floors, floor])
  useEffect(() => setFloor(null), [map?.normalizedName])

  // после скриншота переключаемся на этаж, где стоит игрок
  const position = live?.position ?? null
  useEffect(() => {
    if (position && map && (position.map === map.normalizedName || !position.map)) setFloor(layerOfPoint(floors, position))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.at, map, floors]) // только при новом скриншоте, чтобы не сбивать выбранный вручную этаж
  const quests = useMemo(
    () => (data && map ? questsOnMap(data, map, progress) : []),
    [data, map, progress]
  )
  const task = quests.find((t) => t.id === taskId) ?? null
  const markers = useMemo(
    () => (data && map ? buildMarkers(data, map, progress, { ...opts, faction, selectedTask: taskId }) : []),
    [data, map, progress, opts, faction, taskId]
  )
  // ключи (выделены — нужные для взятых квестов) и редкий лут
  const pois = useMemo(() => {
    if (!data || !map) return []
    const items = new Map(data.items.map((i) => [i.id, i]))
    const price = (id: string) => {
      const it = items.get(id)
      return it?.avg24hPrice ?? it?.lastLowPrice ?? null
    }
    const out: MapPoi[] = []
    if (opts.keys) {
      const questKeys = new Map<string, string[]>()
      for (const t of data.tasks) {
        if (questState(t, progress) !== 'active') continue
        for (const k of t.neededKeys ?? []) {
          if (k.map && k.map !== map.normalizedName) continue
          for (const name of k.keys) questKeys.set(name, [...(questKeys.get(name) ?? []), t.name])
        }
      }
      for (const l of map.locks ?? []) {
        const quests = questKeys.get(l.keyName)
        const p = price(l.key)
        out.push({
          point: l,
          kind: quests ? 'key-quest' : 'key',
          label: l.keyName,
          detail: [
            LOCK_KIND[l.kind],
            l.power ? 'нужно включить электричество' : '',
            p ? `~${shortRub(p)} на барахолке` : '',
            quests ? `нужен для: ${quests.join(', ')}` : ''
          ]
            .filter(Boolean)
            .join(' · ')
        })
      }
    }
    if (opts.loot) for (const x of map.loot ?? []) if (x.kind === 'container') out.push({ point: x, kind: 'container', label: x.name })
    // рассыпной лут: в одной точке может быть и редкая находка, и инъектор — показываем одну
    // отметку (значок — по первой категории) с общей подсказкой, чтобы значки не лежали друг на друге
    const spots = new Map<string, { point: MapLoot; cats: { poi: MapPoi['kind']; title: string; items: string[] }[] }>()
    for (const x of map.loot ?? []) {
      const cat = LOOT_CATEGORIES.find((c) => c.kind === x.kind)
      if (!cat || !opts[cat.layer]) continue
      const key = `${x.x.toFixed(1)}:${x.y.toFixed(1)}:${x.z.toFixed(1)}`
      const spot = spots.get(key) ?? { point: x, cats: [] }
      spot.cats.push({ poi: cat.poi, title: cat.title, items: x.items })
      spots.set(key, spot)
    }
    const order = LOOT_CATEGORIES.map((c) => c.poi as string)
    for (const { point, cats } of spots.values()) {
      cats.sort((a, b) => order.indexOf(a.poi) - order.indexOf(b.poi))
      const ids = [...new Set(cats.flatMap((c) => c.items))]
      const what = ids.map((id) => {
        const p = price(id)
        return `${items.get(id)?.name ?? id}${p ? ` ~${shortRub(p)}` : ''}`
      })
      out.push({ point, kind: cats[0].poi, label: cats.map((c) => c.title).join(' · '), detail: `Может лежать: ${what.join(', ')}` })
    }
    return out
  }, [data, map, progress, opts.keys, opts.loot, opts.injectors])

  // приближаем к точкам выбранного квеста
  const focus = useMemo(
    () => (task && map ? task.objectives.flatMap((o) => o.points.filter((p) => p.map === map.normalizedName)) : null),
    [task, map]
  )
  const onMarkerClick = useCallback((mk: MapMarker) => mk.taskId && setTaskId(mk.taskId), [])

  if (!data || !map) return <div className="empty">Данные карт ещё не загружены. {live?.dataStatus}</div>

  const pageTask = pageTaskId ? data.tasks.find((t) => t.id === pageTaskId) : null
  if (pageTask) {
    return (
      <QuestPage
        task={pageTask}
        progress={progress}
        map={map.normalizedName}
        onBack={() => setPageTaskId(null)}
        onShowOnMap={() => {
          setTaskId(pageTask.id)
          setPageTaskId(null)
        }}
      />
    )
  }

  const pos = live?.position && (live.position.map === map.normalizedName || !live.position.map) ? live.position : null
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }))
  const pointsCount = (id: string) =>
    data.tasks
      .find((t) => t.id === id)!
      .objectives.filter((o) => o.type !== 'shoot' && !progress.objectives[o.id])
      .reduce((n, o) => n + o.points.filter((p) => p.map === map.normalizedName).length, 0)

  return (
    <div className="map-page">
      <aside className="side">
        <div className="eyebrow">Локация</div>
        <div className="map-grid">
          {data.maps.map((m) => (
            <button
              key={m.normalizedName}
              className={m.normalizedName === map.normalizedName ? 'map-btn active' : 'map-btn'}
              onClick={() => {
                setSelected(m.normalizedName)
                setTaskId(null)
              }}
            >
              {m.name}
              {m.normalizedName === live?.currentMap && <span className="dot" title="Вы здесь" />}
            </button>
          ))}
        </div>

        <div className="eyebrow">Квесты на этой карте · {quests.length}</div>
        {quests.length === 0 && (
          <p className="muted small">Нет активных квестов на этой карте. Отметьте взятые квесты во вкладке «Квесты».</p>
        )}
        <div className="map-quests">
          {quests.map((t) => {
            const n = pointsCount(t.id)
            return (
              <button
                key={t.id}
                className={t.id === taskId ? 'mq active' : 'mq'}
                onClick={() => {
                  setTaskId(t.id)
                  setPageTaskId(t.id)
                }}
              >
                <span className="mq-name">{t.name}</span>
                <span className="mq-meta">{n ? `${n} на карте` : 'без маркера'}</span>
              </button>
            )
          })}
        </div>

        <div className="eyebrow">Слои</div>
        {/* слои включаются независимо: каждая кнопка — переключатель */}
        <div className="seg seg-small seg-wrap">
          {LAYER_TOGGLES.map(([key, label]) => (
            <button key={key} className={opts[key] ? 'active' : ''} aria-pressed={opts[key]} onClick={() => toggle(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="seg seg-small">
          <button className={faction === 'pmc' ? 'active' : ''} onClick={() => setFaction('pmc')}>
            ЧВК
          </button>
          <button className={faction === 'scav' ? 'active' : ''} onClick={() => setFaction('scav')}>
            Дикий
          </button>
        </div>

        <div className="eyebrow">Вид карты</div>
        <div className="seg seg-small">
          {MAP_STYLES.map(([key, label]) => (
            <button key={key} className={style === key ? 'active' : ''} onClick={() => window.api.setSettings({ mapStyle: key })}>
              {label}
            </button>
          ))}
        </div>
        {style === 'detailed' && !map.tilePath && (
          <p className="muted small">Для этой карты подробной подложки нет — показана схема.</p>
        )}
        <div className="eyebrow">Позиция</div>
        <p className="muted small">
          {pos
            ? `Обновлена ${new Date(pos.at).toLocaleTimeString('ru-RU')}. Конус показывает, куда вы смотрели.`
            : 'Сделайте скриншот в рейде (клавиша скриншота в игре, обычно PrtSc) — позиция появится на карте.'}
        </p>
      </aside>

      <div className="map-wrap">
        <MapView
          map={map}
          markers={markers}
          position={pos}
          focus={focus}
          style={style}
          layer={floor}
          labels={opts.labels ? map.labels : undefined}
          spawns={opts.spawns ? map.spawns : undefined}
          pois={pois}
          onMarkerClick={onMarkerClick}
        />
        {floors.length > 0 && (
          <div className="floors">
            <div className="floors-title">Этаж</div>
            <button className={floor === null ? 'active' : ''} onClick={() => setFloor(null)}>
              Основной
            </button>
            {floors.map((l) => (
              <button key={l.name} className={floor === l.name ? 'active' : ''} onClick={() => setFloor(l.name)}>
                {l.name}
              </button>
            ))}
          </div>
        )}
        {task && (
          <div className="quest-chip">
            <span className="quest-chip-name">{task.name}</span>
            <button className="btn btn-brass" onClick={() => setPageTaskId(task.id)}>
              Как выполнить
            </button>
            <button className="drawer-close" onClick={() => setTaskId(null)} title="Снять выделение">
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
