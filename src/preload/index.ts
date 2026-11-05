import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/types'

const api: Api = {
  getData: () => ipcRenderer.invoke('data:get'),
  refreshData: () => ipcRenderer.invoke('data:refresh'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getProgress: () => ipcRenderer.invoke('progress:get'),
  setTaskStatus: (id, status) => ipcRenderer.invoke('progress:task', id, status),
  setPlayerLevel: (level) => ipcRenderer.invoke('progress:level', level),
  importFromLogs: () => ipcRenderer.invoke('progress:import'),
  getLive: () => ipcRenderer.invoke('live:get'),
  setCurrentMap: (map) => ipcRenderer.invoke('live:map', map),
  checkPrice: () => ipcRenderer.invoke('price:check'),
  searchItems: (q) => ipcRenderer.invoke('items:search', q),
  setOverlayMode: (mode) => ipcRenderer.invoke('overlay:mode', mode),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  on(channel, cb) {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
