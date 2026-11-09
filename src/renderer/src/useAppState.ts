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
    Promise.all([api.getData(), api.getLive(), api.getProgress(), api.getSettings(), api.getGoons(), api.getUpdate()]).then(
      ([data, live, progress, settings, goons, update]) => set({ data, live, progress, settings, goons, update })
    )
    const offs = [
      api.on('data', (data) => set({ data })),
      api.on('live', (live) => set({ live })),
      api.on('progress', (progress) => set({ progress })),
      api.on('settings', (settings) => set({ settings })),
      api.on('price', (price) => set({ price })),
      api.on('overlay-mode', (overlayMode) => set({ overlayMode })),
      api.on('goons', (goons) => set({ goons })),
      api.on('update', (update) => set({ update }))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return s
}
