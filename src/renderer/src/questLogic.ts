import type { Progress, Task } from '@shared/types'

export type QuestState = 'active' | 'available' | 'locked' | 'completed' | 'failed'

export const QUEST_STATE_LABEL: Record<QuestState, string> = {
  active: 'Активен',
  available: 'Доступен',
  locked: 'Закрыт',
  completed: 'Выполнен',
  failed: 'Провален'
}

export function questState(task: Task, progress: Progress): QuestState {
  const own = progress.tasks[task.id]
  if (own) return own
  if (task.minPlayerLevel > progress.playerLevel) return 'locked'
  const ok = task.requires.every((r) => {
    const st = progress.tasks[r.taskId]
    // status — список допустимых состояний предыдущего квеста (complete / active / failed)
    return r.status.some(
      (need) =>
        (need === 'complete' && st === 'completed') ||
        (need === 'active' && (st === 'active' || st === 'completed')) ||
        (need === 'failed' && st === 'failed')
    )
  })
  return ok ? 'available' : 'locked'
}

export const rub = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU')} ₽`
