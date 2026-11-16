import { useEffect, useState } from 'react'
import type { GameData, GoonsState, LiveState, OverlayMode, PriceResult, Progress, Settings, UpdateState } from '@shared/types'

export interface AppState {
  data: GameData | null
  live: LiveState | null
  progress: Progress
  settings: Settings | null
  price: PriceResult | null
  overlayMode: OverlayMode
  goons: GoonsState | null
  update: UpdateState | null
}

/** Состояние приложения из main-процесса с подпиской на обновления. */
export function useAppState(): AppState {
  const [s, setS] = useState<AppState>({
    data: null,
    live: null,
    progress: { playerLevel: 1, tasks: {}, objectives: {}, hideout: {} },
    settings: null,
    price: null,
    overlayMode: 'hidden',
    goons: null,
    update: null
  })

  useEffect(() => {
    const api = window.api
    const set = (patch: Partial<AppState>) => setS((prev) => ({ ...prev, ...patch }))
    // Стартовые значения грузим по отдельности: медленный запрос (доклад о Кочевниках идёт в сеть)
    // не задерживает остальные. Если событие с более свежим значением пришло раньше ответа,
    // ответ не применяем — иначе он затёр бы только что сделанное изменение.
    const fresh = new Set<keyof AppState>()
    const load = <K extends keyof AppState>(key: K, request: Promise<AppState[K]>) =>
      request.then((value) => {
        if (!fresh.has(key)) set({ [key]: value } as Partial<AppState>)
      })
    const listen = <K extends keyof AppState>(channel: Parameters<typeof api.on>[0], key: K) =>
      api.on(channel, (value) => {
        fresh.add(key)
        set({ [key]: value } as Partial<AppState>)
      })
    load('data', api.getData())
    load('live', api.getLive())
    load('progress', api.getProgress())
    load('settings', api.getSettings())
    load('goons', api.getGoons())
    load('update', api.getUpdate())
    const offs = [
      listen('data', 'data'),
      listen('live', 'live'),
      listen('progress', 'progress'),
      listen('settings', 'settings'),
      listen('price', 'price'),
      listen('overlay-mode', 'overlayMode'),
      listen('goons', 'goons'),
      listen('update', 'update')
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return s
}
