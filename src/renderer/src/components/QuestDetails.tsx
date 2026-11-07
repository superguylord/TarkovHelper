import type { Progress, Task } from '@shared/types'
import { QUEST_STATE_LABEL, questState } from '../questLogic'

/** Карточка квеста: цели с отметками, подсказки и нужные ключи. */
export function QuestDetails({ task, progress, map }: { task: Task; progress: Progress; map?: string }) {
  const st = questState(task, progress)
  // на карте сначала цели этой локации, потом остальные
  const objectives = [...task.objectives].sort((a, b) => {
    if (!map) return 0
    const here = (o: typeof a) => Number(o.maps.includes(map) || o.points.some((p) => p.map === map))
    return here(b) - here(a)
  })

  return (
    <div className="quest-details">
      <div className="qd-head">
        <span className={`tag tag-${st}`}>{QUEST_STATE_LABEL[st]}</span>
        {task.kappaRequired && <span className="tag tag-brass">Kappa</span>}
        <span className="muted small">{task.trader}</span>
      </div>
      <div className="qd-name">{task.name}</div>

      {task.neededKeys.length > 0 && (
        <div className="qd-keys">
          <span className="tag tag-brass">Ключи</span> {[...new Set(task.neededKeys.flatMap((k) => k.keys))].join(', ')}
        </div>
      )}

      <ul className="qd-objectives">
        {objectives.map((o) => {
          const done = !!progress.objectives[o.id]
          return (
            <li key={o.id} className={done ? 'done' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={done}
                  onChange={(e) => window.api.setObjectiveDone(o.id, e.target.checked)}
                />
                <span>
                  {o.description}
                  {o.optional && <span className="muted"> (необязательно)</span>}
                </span>
              </label>
              {!done && (o.hints ?? []).length > 0 && (
                <ul className="qd-hints">
                  {o.hints.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
              {!done && o.type === 'shoot' && <div className="muted small qd-nomark">Убийства на карте не отмечаются</div>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
