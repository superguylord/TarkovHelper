import { useEffect, useState } from 'react'
import type { Progress, QuestGuide, Task } from '@shared/types'
import { QUEST_STATE_LABEL, questState } from '../questLogic'

const guideCache = new Map<string, Promise<QuestGuide | null>>()

function loadGuide(name: string): Promise<QuestGuide | null> {
  let p = guideCache.get(name)
  if (!p) {
    p = window.api.getGuide(name)
    guideCache.set(name, p)
  }
  return p
}

/** Карточка квеста: цели с отметками, подсказки, ключи и гайд из вики. */
export function QuestDetails({ task, progress, map }: { task: Task; progress: Progress; map?: string }) {
  const st = questState(task, progress)
  const [guide, setGuide] = useState<QuestGuide | null | 'loading'>('loading')
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    if (!showGuide) return
    let alive = true
    setGuide('loading')
    loadGuide(task.name).then((g) => alive && setGuide(g))
    return () => {
      alive = false
    }
  }, [task.name, showGuide])

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
          <span className="tag tag-brass">Ключи</span> {[...new Set(task.neededKeys)].join(', ')}
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

      <div className="qd-guide">
        {!showGuide ? (
          <button className="btn" onClick={() => setShowGuide(true)}>
            Как выполнить (гайд из вики)
          </button>
        ) : guide === 'loading' ? (
          <div className="muted small">Загружаю гайд…</div>
        ) : guide && guide.blocks.length ? (
          <>
            <div className="eyebrow">Как выполнить</div>
            <div className="guide-text">
              {guide.blocks.map((b, i) =>
                b.kind === 'li' ? (
                  <div key={i} className="guide-li">
                    • {b.text}
                  </div>
                ) : (
                  <p key={i}>{b.text}</p>
                )
              )}
            </div>
            <a href={guide.url} target="_blank" rel="noreferrer" className="small">
              Открыть страницу в вики
            </a>
          </>
        ) : (
          <div className="muted small">
            Гайд в вики не найден.{' '}
            {task.wikiLink && (
              <a href={task.wikiLink} target="_blank" rel="noreferrer">
                Английская вики
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
