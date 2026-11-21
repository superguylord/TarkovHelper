import { useMemo, useState } from 'react'
import type { RebuildPlan, TaskStatus } from '@shared/types'
import { PROFILE_LABEL } from '@shared/types'
import type { AppState } from '../useAppState'
import { QUEST_STATE_LABEL, questState, type QuestState } from '../questLogic'
import { QuestDetails } from '../components/QuestDetails'
import { QuestPage } from './QuestPage'

type Filter = 'active' | 'available' | 'completed' | 'all'
const STATUS_LABEL: Record<string, string> = { '': 'не отмечен', active: 'активен', completed: 'выполнен', failed: 'провален' }
const FILTERS: [Filter, string][] = [
  ['active', 'Активные'],
  ['available', 'Доступные'],
  ['completed', 'Выполненные'],
  ['all', 'Все']
]

export function QuestsPage({ s }: { s: AppState }) {
  const { data, progress, live } = s
  const [filter, setFilter] = useState<Filter>('active')
  const [mapFilter, setMapFilter] = useState('')
  const [kappa, setKappa] = useState(false)
  const [seasonOnly, setSeasonOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [pageTaskId, setPageTaskId] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState('')
  const [rebuild, setRebuild] = useState<RebuildPlan | null>(null)

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.tasks
      .map((t) => ({ t, st: questState(t, progress) }))
      .filter(({ t, st }) => {
        if (filter !== 'all' && st !== filter) return false
        if (kappa && !t.kappaRequired) return false
        if (seasonOnly && !t.season) return false
        if (mapFilter && t.map !== mapFilter && !t.objectives.some((o) => o.maps.includes(mapFilter))) return false
        if (q && !t.name.toLowerCase().includes(q) && !t.trader.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => a.t.minPlayerLevel - b.t.minPlayerLevel || a.t.trader.localeCompare(b.t.trader))
  }, [data, progress, filter, mapFilter, kappa, seasonOnly, query])

  if (!data) return <div className="empty">Квесты ещё не загружены. {live?.dataStatus}</div>

  const pageTask = pageTaskId ? data.tasks.find((t) => t.id === pageTaskId) : null
  if (pageTask) return <QuestPage task={pageTask} progress={progress} onBack={() => setPageTaskId(null)} />

  const counts = data.tasks.reduce<Record<QuestState, number>>(
    (acc, t) => ((acc[questState(t, progress)]++, acc)),
    { active: 0, available: 0, locked: 0, completed: 0, failed: 0 }
  )
  // сезонные квесты есть только у сезонного персонажа
  const seasonName = data.tasks.find((t) => t.season)?.season ?? null
  const mapName = (n: string | null) => data.maps.find((m) => m.normalizedName === n)?.name ?? 'Любая'

  // пересборка квестов персонажа: сначала показываем, что изменится, потом применяем
  // квесты, которых нет в данных tarkov.dev (новые или событийные), показываем без кода целиком
  const taskName = (id: string) => data?.tasks.find((t) => t.id === id)?.name ?? `квест не из базы tarkov.dev (…${id.slice(-6)})`
  const previewRebuild = async () => {
    setImportMsg('')
    setRebuild(await window.api.rebuildFromLogs(false))
  }
  const applyRebuild = async () => {
    const r = await window.api.rebuildFromLogs(true)
    setRebuild(null)
    setImportMsg(`Готово: обновлено ${r.update.length}. Прежний прогресс — в %APPDATA%\\TarkovHelper\\${r.backup ?? ''}`)
  }

  return (
    <div className="page">
      <div className="toolbar">
        <div className="seg">
          {FILTERS.map(([f, label]) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {label}
              {f !== 'all' && <span className="count">{counts[f]}</span>}
            </button>
          ))}
        </div>
        <select value={mapFilter} onChange={(e) => setMapFilter(e.target.value)}>
          <option value="">Все карты</option>
          {data.maps.map((m) => (
            <option key={m.normalizedName} value={m.normalizedName}>
              {m.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={kappa} onChange={() => setKappa(!kappa)} /> Только для Kappa
        </label>
        {seasonName && (
          <label className="check">
            <input type="checkbox" checked={seasonOnly} onChange={() => setSeasonOnly(!seasonOnly)} /> Только {seasonName}
          </label>
        )}
        <input className="search" placeholder="Поиск квеста или торговца" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="level">
          Уровень
          <input
            type="number"
            min={1}
            max={79}
            value={progress.playerLevel}
            onChange={(e) => window.api.setPlayerLevel(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button
          className="btn"
          onClick={previewRebuild}
          title="Сверить статусы квестов этого персонажа со всеми сохранёнными логами игры"
        >
          Пересобрать из логов
        </button>
        {importMsg && <span className="muted small">{importMsg}</span>}
      </div>

      {rebuild && (
        <div className="rebuild">
          <div className="row-title">Пересборка квестов · {PROFILE_LABEL[rebuild.profile]}</div>
          {rebuild.update.length === 0 ? (
            <p className="muted small">По логам менять нечего: статусы {rebuild.same} квестов уже совпадают с логами.</p>
          ) : (
            <>
              <p>
                По логам этого персонажа у <b>{rebuild.update.length}</b> квестов статус другой — обновлю:
              </p>
              <ul className="rebuild-list">
                {rebuild.update.map((u) => (
                  <li key={u.id}>
                    {taskName(u.id)} — <span className="muted">{STATUS_LABEL[u.from ?? '']}</span> →{' '}
                    <b>{STATUS_LABEL[u.to]}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">
            Квесты без событий в логах (отмечены вручную или старше самых ранних логов) не меняются, ничего не удаляется.
            Уровень, лояльность, убежище и сюжет тоже не меняются. Прежний прогресс сохранится в отдельный файл.
          </p>
          <div className="row-buttons">
            {rebuild.update.length > 0 && (
              <button className="btn btn-brass" onClick={applyRebuild}>
                Пересобрать
              </button>
            )}
            <button className="btn" onClick={() => setRebuild(null)}>
              {rebuild.update.length > 0 ? 'Отмена' : 'Закрыть'}
            </button>
          </div>
        </div>
      )}

      <div className="quest-list">
        {rows.map(({ t, st }) => (
          <div key={t.id} className={`quest st-${st}`}>
            <div className="quest-row" onClick={() => setOpen(open === t.id ? null : t.id)}>
              <span className={`tag tag-${st}`}>{QUEST_STATE_LABEL[st]}</span>
              <span className="quest-name">{t.name}</span>
              {t.kappaRequired && <span className="tag tag-brass">Kappa</span>}
              {t.season && <span className="tag tag-season">{t.season}</span>}
              <span className="muted">{t.trader}</span>
              <span className="muted">{mapName(t.map)}</span>
              <span className="muted">{t.minPlayerLevel > 1 ? `ур. ${t.minPlayerLevel}` : ''}</span>
              <select
                value={progress.tasks[t.id] ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => window.api.setTaskStatus(t.id, (e.target.value || null) as TaskStatus | null)}
              >
                <option value="">— авто —</option>
                <option value="active">Активен</option>
                <option value="completed">Выполнен</option>
                <option value="failed">Провален</option>
              </select>
            </div>
            {open === t.id && (
              <div className="quest-body">
                <QuestDetails task={t} progress={progress} />
                <button className="btn btn-brass qd-open" onClick={() => setPageTaskId(t.id)}>
                  Как выполнить (гайд со скриншотами)
                </button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="empty">Нет квестов под этот фильтр.</div>}
      </div>
    </div>
  )
}
