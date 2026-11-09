import { useMemo, useState } from 'react'
import type { HideoutStation } from '@shared/types'
import type { AppState } from '../useAppState'
import { builtLevel, formatCount, hideoutNeeds, isMoney, maxLevel, missingStations, needName, nextLevel } from '../hideoutLogic'

const hours = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`
}

/** Убежище: уровни модулей и что нужно собрать на следующие. */
export function HideoutPage({ s }: { s: AppState }) {
  const { data, progress, live } = s
  const [scope, setScope] = useState<'next' | 'all'>('next')

  const icons = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i.iconLink])), [data])
  const needs = useMemo(() => (data ? hideoutNeeds(data, progress, scope) : []), [data, progress, scope])

  if (!data) return <div className="empty">Данные ещё не загружены. {live?.dataStatus}</div>
  if (!data.hideout?.length) return <div className="empty">Данные убежища ещё не загружены — обновите данные в настройках.</div>

  // сначала то, что можно строить, потом заблокированное, достроенные — в конце
  const rank = (st: HideoutStation) => {
    const next = nextLevel(st, progress)
    if (!next) return 2
    return missingStations(next, data, progress).length ? 1 : 0
  }
  const stations = [...data.hideout].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'))
  const totalLevels = data.hideout.reduce((n, st) => n + maxLevel(st), 0)
  const builtLevels = data.hideout.reduce((n, st) => n + builtLevel(st, progress), 0)
  const set = (st: HideoutStation, level: number) =>
    window.api.setHideoutLevel(st.id, Math.max(0, Math.min(maxLevel(st), level)))

  return (
    <div className="page hideout">
      <div className="eyebrow">Убежище</div>
      <div className="hideout-head">
        <div>
          <div className="stat-num">
            {builtLevels} <span className="stat-of">/ {totalLevels}</span>
          </div>
          <div className="muted small">уровней построено — отметьте свои кнопками − и +</div>
        </div>
      </div>

      <div className="hideout-body">
        <div className="stations">
          {stations.map((st) => {
            const built = builtLevel(st, progress)
            const max = maxLevel(st)
            const next = nextLevel(st, progress)
            const missing = next ? missingStations(next, data, progress) : []
            return (
              <div key={st.id} className={`station ${!next ? 'done' : missing.length ? 'locked' : 'ready'}`}>
                <div className="station-head">
                  <div className="station-name">{st.name}</div>
                  <div className="station-level">
                    <button onClick={() => set(st, built - 1)} disabled={built <= 0} title="Уровень ниже">
                      −
                    </button>
                    <span>
                      {built} / {max}
                    </span>
                    <button onClick={() => set(st, built + 1)} disabled={built >= max} title="Построил следующий уровень">
                      +
                    </button>
                  </div>
                </div>

                {!next ? (
                  <div className="station-status">Построено полностью</div>
                ) : (
                  <>
                    <div className="station-status">
                      {missing.length ? (
                        <span className="tag tag-locked">
                          Сначала: {missing.map((m) => `${m.name} ур. ${m.level}`).join(', ')}
                        </span>
                      ) : (
                        <span className="tag tag-available">Можно строить ур. {next.level}</span>
                      )}
                      {next.constructionTime > 0 && <span className="muted small">{hours(next.constructionTime)}</span>}
                    </div>
                    <ul className="station-items">
                      {next.items.map((it) => (
                        <li key={it.itemId}>
                          {icons.get(it.itemId) ? <img src={icons.get(it.itemId)} alt="" loading="lazy" /> : <span className="noicon" />}
                          <span className="si-name">{needName(it.itemId, it.name)}</span>
                          {it.fir && <span className="fir" title="Найдено в рейде">FIR</span>}
                          <span className="si-count">{formatCount(it.itemId, it.count)}</span>
                        </li>
                      ))}
                    </ul>
                    {(next.traders.length > 0 || next.skills.length > 0) && (
                      <div className="station-req muted small">
                        {[
                          ...next.traders.map((t) => `${t.name} — лояльность ${t.level}`),
                          ...next.skills.map((k) => `${k.name} — ур. ${k.level}`)
                        ].join(' · ')}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        <aside className="needs">
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
          {needs.length === 0 && <p className="muted small">Ничего — всё построено.</p>}
          <ul className="needs-list">
            {needs.map((n) => (
              <li key={n.itemId} title={n.uses.map((u) => `${u.station} ур. ${u.level}: ${u.count}`).join('\n')}>
                {icons.get(n.itemId) ? <img src={icons.get(n.itemId)} alt="" loading="lazy" /> : <span className="noicon" />}
                <div className="need-text">
                  <div className="need-name">{needName(n.itemId, n.name)}</div>
                  <div className="need-uses">{n.uses.map((u) => `${u.station} ${u.level}`).join(', ')}</div>
                </div>
                <div className="need-count">
                  {formatCount(n.itemId, n.count)}
                  {n.fir > 0 && !isMoney(n.itemId) && <span className="fir">{n.fir === n.count ? 'FIR' : `${n.fir} FIR`}</span>}
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
