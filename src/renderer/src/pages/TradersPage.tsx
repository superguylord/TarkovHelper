import { useEffect, useMemo, useState } from 'react'
import type { AppState } from '../useAppState'
import { questState, type QuestState } from '../questLogic'
import { QuestPage } from './QuestPage'

function untilText(iso: string | null, now: number): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return 'обновился'
  const min = Math.ceil(ms / 60000)
  return min < 60 ? `через ${min} мин` : `через ${Math.floor(min / 60)} ч ${min % 60} мин`
}

/** Торговцы: прогресс заданий у каждого и время до обновления ассортимента. */
export function TradersPage({ s }: { s: AppState }) {
  const { data, progress, live } = s
  const [now, setNow] = useState(Date.now())
  const [pageTaskId, setPageTaskId] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    return data.traders
      .map((tr) => {
        const tasks = data.tasks.filter((t) => t.trader === tr.name)
        const count: Record<QuestState, number> = { active: 0, available: 0, locked: 0, completed: 0, failed: 0 }
        for (const t of tasks) count[questState(t, progress)]++
        const active = tasks.filter((t) => questState(t, progress) === 'active')
        return { tr, total: tasks.length, count, active }
      })
      .filter((r) => r.total > 0)
  }, [data, progress])

  if (!data) return <div className="empty">Данные ещё не загружены. {live?.dataStatus}</div>

  const pageTask = pageTaskId ? data.tasks.find((t) => t.id === pageTaskId) : null
  if (pageTask) return <QuestPage task={pageTask} progress={progress} onBack={() => setPageTaskId(null)} />

  return (
    <div className="page">
      <div className="eyebrow">Торговцы</div>
      <div className="traders">
        {rows.map(({ tr, total, count, active }) => (
          <div key={tr.id} className="trader">
            <div className="trader-head">
              <div className="trader-name">{tr.name}</div>
              <div className="trader-reset" title="Обновление ассортимента">
                Ассортимент: {untilText(tr.resetTime, now)}
              </div>
            </div>
            <div className="bar">
              <div style={{ width: `${(count.completed / total) * 100}%` }} />
            </div>
            <div className="trader-stats">
              <span>
                Выполнено <b>{count.completed}</b> из {total}
              </span>
              <span>
                Активно <b>{count.active}</b>
              </span>
              <span>
                Доступно <b>{count.available}</b>
              </span>
            </div>
            {active.length > 0 && (
              <div className="trader-quests">
                {active.map((t) => (
                  <button key={t.id} className="trader-quest" onClick={() => setPageTaskId(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
