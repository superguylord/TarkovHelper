import { useEffect, useMemo, useState } from 'react'
import type { AppState } from '../useAppState'
import { MapView } from '../components/MapView'
import { buildMarkers } from '../mapMarkers'

export function MapPage({ s, compactSidebar }: { s: AppState; compactSidebar?: boolean }) {
  const { data, live, progress } = s
  const [selected, setSelected] = useState<string | null>(null)
  const [opts, setOpts] = useState({ quests: true, available: false, extracts: true })

  // как только игра загрузила локацию — переключаемся на неё
  useEffect(() => {
    if (live?.currentMap) setSelected(live.currentMap)
  }, [live?.currentMap])

  const map = data?.maps.find((m) => m.normalizedName === selected) ?? data?.maps[0]
  const markers = useMemo(
    () => (data && map ? buildMarkers(data, map, progress, opts) : []),
    [data, map, progress, opts]
  )
  if (!data || !map) return <div className="empty">Данные карт ещё не загружены. {live?.dataStatus}</div>

  const pos = live?.position && (live.position.map === map.normalizedName || !live.position.map) ? live.position : null
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }))

  return (
    <div className="map-page">
      <aside className={compactSidebar ? 'side side-compact' : 'side'}>
        <div className="eyebrow">Локации</div>
        <div className="map-list">
          {data.maps.map((m) => (
            <button
              key={m.normalizedName}
              className={m.normalizedName === map.normalizedName ? 'map-btn active' : 'map-btn'}
              onClick={() => setSelected(m.normalizedName)}
            >
              {m.name}
              {m.normalizedName === live?.currentMap && <span className="dot" title="Вы здесь" />}
            </button>
          ))}
        </div>
        <div className="eyebrow">Слои</div>
        <label className="check">
          <input type="checkbox" checked={opts.quests} onChange={() => toggle('quests')} /> Активные квесты
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.available} onChange={() => toggle('available')} /> Доступные квесты
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.extracts} onChange={() => toggle('extracts')} /> Выходы
        </label>
        <div className="eyebrow">Позиция</div>
        <p className="muted small">
          {pos
            ? `Обновлена ${new Date(pos.at).toLocaleTimeString('ru-RU')}`
            : 'Сделайте скриншот в рейде (клавиша скриншота в игре, обычно PrtSc) — позиция появится на карте.'}
        </p>
      </aside>
      <MapView map={map} markers={markers} position={pos} />
    </div>
  )
}
