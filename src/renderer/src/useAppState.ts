import { useEffect, useState } from 'react'
import type { GameData, LiveState, OverlayMode, PriceResult, Progress, Settings } from '@shared/types'

export interface AppState {
  data: GameData | null
  live: LiveState | null
  progress: Progress
  settings: Settings | null
  price: PriceResult | null
  overlayMode: OverlayMode
}

/** Состояние приложения из main-процесса с подпиской на обновления. */
export function useAppState(): AppState {
  const [s, setS] = useState<AppState>({
    data: null,
    live: null,
    progress: { playerLevel: 1, tasks: {} },
    settings: null,
    price: null,
    overlayMode: 'hidden'
  })

  useEffect(() => {
    const api = window.api
    const set = (patch: Partial<AppState>) => setS((prev) => ({ ...prev, ...patch }))
    Promise.all([api.getData(), api.getLive(), api.getProgress(), api.getSettings()]).then(
      ([data, live, progress, settings]) => set({ data, live, progress, settings })
    )
    const offs = [
      api.on('data', (data) => set({ data })),
      api.on('live', (live) => set({ live })),
      api.on('progress', (progress) => set({ progress })),
      api.on('settings', (settings) => set({ settings })),
      api.on('price', (price) => set({ price })),
      api.on('overlay-mode', (overlayMode) => set({ overlayMode }))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return s
}
