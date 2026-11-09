import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'

// Автообновление через GitHub Releases: приложение само проверяет новую версию,
// скачивает её в фоне и ставит при перезапуске (или сразу — по кнопке).
const CHECK_EVERY = 3 * 60 * 60 * 1000

export function initUpdater(onState: (s: UpdateState) => void) {
  const current = app.getVersion()
  let state: UpdateState = { status: app.isPackaged ? 'idle' : 'dev', current }
  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch }
    onState(state)
  }

  const check = () => {
    if (!app.isPackaged) return // в режиме разработки обновлять нечего
    autoUpdater.checkForUpdates().catch((e) => set({ status: 'error', error: String(e?.message ?? e) }))
  }

  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
    autoUpdater.on('update-not-available', () => set({ status: 'none' }))
    autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }))
    autoUpdater.on('error', (e) => set({ status: 'error', error: String(e?.message ?? e) }))
    setTimeout(check, 10_000) // не мешаем запуску
    setInterval(check, CHECK_EVERY)
  }

  return {
    get: () => state,
    check,
    install: () => {
      if (state.status === 'ready') autoUpdater.quitAndInstall(true, true)
    }
  }
}
