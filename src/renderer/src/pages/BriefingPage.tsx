import { useEffect, useMemo, useState } from 'react'
import type { GoonsState } from '@shared/types'
import type { AppState } from '../useAppState'
import type { Nav } from '../MainApp'
import { questState } from '../questLogic'
import { buildPlan, mapPriority } from '../raidPlan'

const KIND_LABEL = { key: 'Ключ', mark: 'Пометить', plant: 'Заложить', questItem: 'Квестовый предмет', use: 'Использовать' }

export function timeAgo(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60000))
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  return `${h} ч ${min % 60} мин назад`
}

function GoonsCard({ goons }: { goons: GoonsState | null }) {
  // перерисовываем раз в минуту, чтобы «N мин назад» не застывало
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const last = goons?.last
  // в истории оставляем по одному (последнему) докладу на карту
  const recent = (goons?.history ?? []).filter((r, i, all) => all.findIndex((x) => x.mapName === r.mapName) === i).slice(0, 4)
  return (
    <div className="stat-card">
      <div className="stat-label">Кочевники</div>
      {last ? (
        <>
          <div className="stat-big">{last.mapName.toUpperCase()}</div>
          <div className="stat-sub">
            Доклад {timeAgo(last.at)} · {last.reporter}
          </div>
          {recent.length > 1 && (
            <div className="goons-history">
              {recent.slice(1).map((r) => (
                <span key={r.mapName}>
                  {r.mapName} — {timeAgo(r.at)}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="stat-big">НЕТ ДАННЫХ</div>
      )}
      <div className="stat-foot">
        {goons?.error ? `Не обновилось: ${goons.error}` : 'tarkov.help · обновляется каждые 2 минуты'}
      </div>
    </div>
  )
}

export function BriefingPage({ s, nav }: { s: AppState; nav: Nav }) {
  const { data, progress, live, goons } = s
  const priority = useMemo(() => (data ? mapPriority(data, progress) : []), [data, progress])
  const [selected, setSelected] = useState<string | null>(null)

  // по умолчанию — карта, на которой игрок сейчас, иначе самая выгодная
  const mapKey = selected ?? nav.plan?.map ?? (live?.inRaid ? live.currentMap : null) ?? priority[0]?.map.normalizedName ?? null
  const map = data?.maps.find((m) => m.normalizedName === mapKey)

  if (!data || !map) return <div className="empty">Данные ещё не загружены. {live?.dataStatus}</div>

  const active = data.tasks.filter((t) => questState(t, progress) === 'active').length
  const kappa = data.tasks.filter((t) => t.kappaRequired)
  const kappaDone = kappa.filter((t) => progress.tasks[t.id] === 'completed').length
  const kappaActive = kappa.filter((t) => questState(t, progress) === 'active').length
  const kappaAvailable = kappa.filter((t) => questState(t, progress) === 'available').length
  const questsHere = priority.find((p) => p.map.normalizedName === map.normalizedName)?.quests ?? 0
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  const makePlan = () => nav.setPlan(buildPlan(data, map, progress))
  const shownPlan = nav.plan && nav.plan.map === map.normalizedName ? nav.plan : null

  return (
    <div className="page briefing">
      <div className="briefing-head">
        <div>
          <div className="eyebrow">
            Оперативный штаб · {today} · {data.gameMode === 'pve' ? 'PvE' : 'PvP'}
          </div>
          <h1 className="briefing-title">Следующий рейд начинается здесь</h1>
        </div>
        <button className="btn btn-brass" onClick={() => nav.go('map')}>
          Открыть карту
        </button>
      </div>

      <div className="stats">
        <div className="stat-card">
          <div className="stat-label">Текущие задания</div>
          <div className="stat-num">{active}</div>
          <div className="stat-sub">взято и не выполнено</div>
          <button className="btn stat-btn" onClick={() => nav.go('quests')}>
            Задания
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-label">Задания для Каппы</div>
          <div className="stat-num">
            {kappaDone} <span className="stat-of">/ {kappa.length}</span>
          </div>
          <div className="bar">
            <div style={{ width: `${kappa.length ? (kappaDone / kappa.length) * 100 : 0}%` }} />
          </div>
          <div className="stat-sub">
            выполнено {kappaDone} из {kappa.length} · взято {kappaActive} · можно взять {kappaAvailable}
          </div>
        </div>
        <GoonsCard goons={goons} />
      </div>

      <div className="panel-row">
        <div className="row-title">Приоритет карт</div>
        <div className="priority">
          {priority.map((p, i) => (
            <button
              key={p.map.normalizedName}
              className={
                (p.map.normalizedName === map.normalizedName ? 'prio active' : 'prio') + (p.quests ? '' : ' prio-empty')
              }
              onClick={() => setSelected(p.map.normalizedName)}
            >
              <span className="prio-idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="prio-name">{p.map.name}</span>
              <span className="prio-count">{p.quests}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="plan">
        <div className="plan-head">
          <div>
            <div className="eyebrow">План рейда · {data.gameMode === 'pve' ? 'PvE' : 'PvP'}</div>
            <div className="plan-map">{map.name.toUpperCase()}</div>
            <div className="muted">
              {questsHere ? `Квестов с целями на этой карте: ${questsHere}` : 'На этой карте нет целей по взятым квестам'}
            </div>
          </div>
          <div className="plan-actions">
            <button className="btn btn-brass" onClick={makePlan} disabled={!questsHere}>
              {shownPlan ? 'Обновить план' : 'Создать план'}
            </button>
            {shownPlan && (
              <button className="btn" onClick={() => nav.openMap(map.normalizedName)}>
                Квесты на карте
              </button>
            )}
          </div>
        </div>

        {shownPlan && (
          <div className="plan-body">
            <div className="row-title">Взять с собой · {shownPlan.bring.length}</div>
            {shownPlan.bring.length === 0 ? (
              <p className="muted small">Для этих заданий ничего особенного брать не нужно.</p>
            ) : (
              <div className="bring">
                {shownPlan.bring.map((b) => (
                  <div key={b.kind + b.name} className="bring-item">
                    <div className="bring-name">
                      {b.name}
                      {b.count > 1 && <span className="bring-count"> ×{b.count}</span>}
                    </div>
                    <div className="bring-meta">
                      {KIND_LABEL[b.kind]} · {b.purposes.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="muted small">
              Только то, что нужно для заданий: ключи, закладки, маркеры и используемые предметы. Предметы «найти и
              вынести» сюда не входят. Квесты: {shownPlan.quests.join(', ')}.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
