import type { Progress, Task } from '@shared/types'
import { QuestDetails } from '../components/QuestDetails'
import { GuideView } from '../components/GuideView'

interface Props {
  task: Task
  progress: Progress
  map?: string
  onBack: () => void
  onShowOnMap?: () => void
}

/** Отдельная страница квеста: цели с подсказками слева, гайд со скриншотами мест справа. */
export function QuestPage({ task, progress, map, onBack, onShowOnMap }: Props) {
  return (
    <div className="quest-page">
      <div className="quest-page-bar">
        <button className="btn" onClick={onBack}>
          ← Назад
        </button>
        {onShowOnMap && (
          <button className="btn btn-brass" onClick={onShowOnMap}>
            Показать на карте
          </button>
        )}
      </div>
      <div className="quest-page-body">
        <section className="quest-page-side">
          <QuestDetails task={task} progress={progress} map={map} />
        </section>
        <section className="quest-page-guide">
          <div className="eyebrow">Как выполнить · tarkov.help</div>
          <GuideView taskName={task.name} />
        </section>
      </div>
    </div>
  )
}
