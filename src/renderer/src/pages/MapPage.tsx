import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../useAppState'
import { MapView, type MapMarker } from '../components/MapView'
import { QuestPage } from './QuestPage'
import { buildMarkers, questsOnMap, type Faction } from '../mapMarkers'

function loadFaction(): Faction {
  try {
    return localStorage.getItem('faction') === 'scav' ? 'scav' : 'pmc'
  } catch {
    return 'pmc'
  }
}

export function MapPage({ s }: { s: AppState }) {
  const { data, live, progress } = s
  const [selected, setSelected] = useState<string | null>(null)
  const [opts, setOpts] = useState({ quests: true, extracts: true })
  const [faction, setFaction] = useState<Faction>(loadFaction)
  const [taskId, setTaskId] = useState<string | null>(null) // квест, подсвеченный на карте
  const [pageTaskId, setPageTaskId] = useState<string | null>(null) // квест, открытый на отдельной странице

  // как только игра загрузила локацию — переключаемся на неё
  useEffect(() => {
    if (live?.currentMap) setSelected(live.currentMap)
  }, [live?.currentMap])

  // в начале рейда сразу показываем выходы
  useEffect(() => {
    if (live?.inRaid) setOpts((o) => ({ ...o, extracts: true }))
  }, [live?.inRaid])

  useEffect(() => {
    try {
      localStorage.setItem('faction', faction)
    } catch {
      /* без сохранения выбора — не страшно */
    }
  }, [faction])

  const map = data?.maps.find((m) => m.normalizedName === selected) ?? data?.maps[0]
  const quests = useMemo(
    () => (data && map ? questsOnMap(data, map, progress) : []),
    [data, map, progress]
  )
  const task = quests.find((t) => t.id === taskId) ?? null
  const markers = useMemo(
    () => (data && map ? buildMarkers(data, map, progress, { ...opts, faction, selectedTask: taskId }) : []),
    [data, map, progress, opts, faction, taskId]
  )
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
        <label className="check">
          <input type="checkbox" checked={opts.quests} onChange={() => toggle('quests')} /> Мои квесты
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.extracts} onChange={() => toggle('extracts')} /> Выходы
        </label>
        <div className="seg seg-small">
          <button className={faction === 'pmc' ? 'active' : ''} onClick={() => setFaction('pmc')}>
            ЧВК
          </button>
          <button className={faction === 'scav' ? 'active' : ''} onClick={() => setFaction('scav')}>
            Дикий
          </button>
        </div>

        <div className="eyebrow">Позиция</div>
        <p className="muted small">
          {pos
            ? `Обновлена ${new Date(pos.at).toLocaleTimeString('ru-RU')}. Конус показывает, куда вы смотрели.`
            : 'Сделайте скриншот в рейде (клавиша скриншота в игре, обычно PrtSc) — позиция появится на карте.'}
        </p>
      </aside>

      <div className="map-wrap">
        <MapView map={map} markers={markers} position={pos} focus={focus} onMarkerClick={onMarkerClick} />
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
