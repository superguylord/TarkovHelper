import { useMemo, useState } from 'react'
import type { GameData, HideoutStation, Progress } from '@shared/types'
import type { AppState } from '../useAppState'
import {
  builtLevel,
  formatCount,
  hideoutNeeds,
  isMoney,
  maxLevel,
  missingStations,
  needName,
  nextLevel,
  shortCount
} from '../hideoutLogic'

const hours = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`
}

type ZoneState = 'ready' | 'locked' | 'done'

function zoneState(st: HideoutStation, data: GameData, progress: Progress): ZoneState {
  const next = nextLevel(st, progress)
  if (!next) return 'done'
  return missingStations(next, data, progress).length ? 'locked' : 'ready'
}

/** Плитка предмета как ячейка инвентаря: крупный значок и нужное количество, название — в подсказке. */
function ItemCube({ itemId, name, count, fir, icon }: { itemId: string; name: string; count: number; fir: number; icon?: string }) {
  const firLabel = fir > 0 && !isMoney(itemId) ? (fir === count ? 'FIR' : `${fir} FIR`) : ''
  return (
    <div className="cube" title={`${needName(itemId, name)} — ${formatCount(itemId, count)}${firLabel ? ` (${firLabel}: найдено в рейде)` : ''}`}>
      {icon ? <img src={icon} alt="" loading="lazy" /> : <span className="cube-noicon">{needName(itemId, name)}</span>}
      {firLabel && <span className="cube-fir">{firLabel}</span>}
      <span className="cube-count">{shortCount(itemId, count)}</span>
    </div>
  )
}

/** Убежище: зоны в том же порядке, что на панели убежища в игре; клик по зоне — что нужно на следующий уровень. */
export function HideoutPage({ s }: { s: AppState }) {
  const { data, progress, live } = s
  const [scope, setScope] = useState<'next' | 'all'>('next')
  const [selected, setSelected] = useState<string | null>(null)

  const icons = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i.iconLink])), [data])
  const needs = useMemo(() => (data ? hideoutNeeds(data, progress, scope) : []), [data, progress, scope])

  if (!data) return <div className="empty">Данные ещё не загружены. {live?.dataStatus}</div>
  if (!data.hideout?.length) return <div className="empty">Данные убежища ещё не загружены — обновите данные в настройках.</div>

  const stations = [...data.hideout].sort((a, b) => (a.area ?? 99) - (b.area ?? 99) || a.name.localeCompare(b.name, 'ru'))
  // по умолчанию открыта первая зона, которую можно строить
  const current =
    stations.find((st) => st.id === selected) ?? stations.find((st) => zoneState(st, data, progress) === 'ready') ?? stations[0]
  const totalLevels = data.hideout.reduce((n, st) => n + maxLevel(st), 0)
  const builtLevels = data.hideout.reduce((n, st) => n + builtLevel(st, progress), 0)
  const readyCount = stations.filter((st) => zoneState(st, data, progress) === 'ready').length
  const set = (st: HideoutStation, level: number) =>
    window.api.setHideoutLevel(st.id, Math.max(0, Math.min(maxLevel(st), level)))

  const built = builtLevel(current, progress)
  const max = maxLevel(current)
  const next = nextLevel(current, progress)

  return (
    <div className="page hideout">
      <div className="eyebrow">Убежище</div>
      <div className="hideout-head">
        <div>
          <div className="stat-num">
            {builtLevels} <span className="stat-of">/ {totalLevels}</span>
          </div>
          <div className="muted small">уровней построено · можно строить: {readyCount}</div>
        </div>
      </div>

      <div className="hideout-top">
        <div className="hz-grid">
          {stations.map((st) => {
            const state = zoneState(st, data, progress)
            return (
              <button
                key={st.id}
                className={`hz hz-${state}${st.id === current.id ? ' active' : ''}`}
                onClick={() => setSelected(st.id)}
                title={st.name}
              >
                <span className="hz-level">
                  {builtLevel(st, progress)}/{maxLevel(st)}
                </span>
                {st.image ? <img className="hz-icon" src={st.image} alt="" loading="lazy" /> : <span className="hz-icon" />}
                <span className="hz-name">{st.name}</span>
              </button>
            )
          })}
        </div>

        <div className="hz-detail">
          <div className="hz-detail-head">
            {current.image && <img src={current.image} alt="" />}
            <div className="hz-detail-title">
              <div className="station-name">{current.name}</div>
              <div className="muted small">{next ? `Следующий уровень: ${next.level}` : 'Построено полностью'}</div>
            </div>
            <div className="station-level">
              <button onClick={() => set(current, built - 1)} disabled={built <= 0} title="Уровень ниже">
                −
              </button>
              <span>
                {built} / {max}
              </span>
              <button onClick={() => set(current, built + 1)} disabled={built >= max} title="Построил следующий уровень">
                +
              </button>
            </div>
          </div>

          {next && (
            <>
              <div className="station-status">
                {(() => {
                  const missing = missingStations(next, data, progress)
                  return missing.length ? (
                    <span className="tag tag-locked">Сначала: {missing.map((m) => `${m.name} ур. ${m.level}`).join(', ')}</span>
                  ) : (
                    <span className="tag tag-available">Можно строить ур. {next.level}</span>
                  )
                })()}
                {next.constructionTime > 0 && <span className="muted small">Стройка: {hours(next.constructionTime)}</span>}
              </div>
              {next.items.length > 0 ? (
                <div className="cube-grid">
                  {next.items.map((it) => (
                    <ItemCube
                      key={it.itemId}
                      itemId={it.itemId}
                      name={it.name}
                      count={it.count}
                      fir={it.fir ? it.count : 0}
                      icon={icons.get(it.itemId)}
                    />
                  ))}
                </div>
              ) : (
                <p className="muted small">Предметы не нужны.</p>
              )}
              {(() => {
                // прошлый уровень этой же зоны — само собой разумеется, его не показываем
                const others = next.stations.filter((r) => r.stationId !== current.id)
                if (!others.length && !next.traders.length && !next.skills.length) return null
                return (
                <div className="station-req muted small">
                  {[
                    ...others.map((r) => `${r.name} ур. ${r.level}`),
                    ...next.traders.map((t) => `${t.name} — лояльность ${t.level}`),
                    ...next.skills.map((k) => `${k.name} — ур. ${k.level}`)
                  ].join(' · ')}
                </div>
                )
              })()}
            </>
          )}
        </div>
      </div>

      <section className="needs">
        <div className="needs-head">
          <div className="row-title">Нужно собрать</div>
          <div className="seg seg-small">
            <button className={scope === 'next' ? 'active' : ''} onClick={() => setScope('next')}>
              Ближайшие уровни
            </button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
              До конца
            </button>
          </div>
        </div>
        {needs.length === 0 ? (
          <p className="muted small">Ничего — всё построено.</p>
        ) : (
          <div className="cube-grid">
            {needs.map((n) => (
              <ItemCube key={n.itemId} itemId={n.itemId} name={n.name} count={n.count} fir={n.fir} icon={icons.get(n.itemId)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
