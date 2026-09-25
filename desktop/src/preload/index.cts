import { contextBridge, ipcRenderer } from 'electron'

const agent = Object.freeze({
  getState: () => ipcRenderer.invoke('agent:get-state'),
  getTransfers: () => ipcRenderer.invoke('agent:get-transfers'),
  getDiagnostics: () => ipcRenderer.invoke('agent:get-diagnostics'),
  reconnect: () => ipcRenderer.invoke('agent:reconnect'),
  repairSyncRoot: () => ipcRenderer.invoke('agent:repair-sync-root'),
  openLogs: () => ipcRenderer.invoke('agent:open-logs'),
  exportDiagnostics: () => ipcRenderer.invoke('agent:export-diagnostics'),
  retry: () => ipcRenderer.invoke('agent:retry'),
  restart: () => ipcRenderer.invoke('agent:restart'),
  login: (input: { server: string; username: string; password: string; mount_path?: string }) => ipcRenderer.invoke('agent:login', input),
  logout: () => ipcRenderer.invoke('agent:logout'),
  changePassword: (input: { current_password: string; new_password: string }) => ipcRenderer.invoke('agent:change-password', input),
  setPaused: (paused: boolean) => ipcRenderer.invoke('agent:set-paused', paused),
  syncNow: () => ipcRenderer.invoke('agent:sync-now'),
  getSettings: () => ipcRenderer.invoke('agent:get-settings'),
  updateSettings: (input: { mount_path?: string; cache_limit_bytes?: number }) => ipcRenderer.invoke('agent:update-settings', input),
  setSyncRule: (path: string, mode: 'exclude' | 'always-local' | 'default') => ipcRenderer.invoke('agent:set-sync-rule', path, mode),
  getFileAvailability: (path: string) => ipcRenderer.invoke('agent:get-file-availability', path),
  setFileAvailability: (path: string, action: 'keep' | 'release' | 'online' | 'sync') =>
    ipcRenderer.invoke('agent:set-file-availability', path, action),
  getConflicts: () => ipcRenderer.invoke('agent:get-conflicts'),
  openConflict: (id: string, both = false) => ipcRenderer.invoke('agent:open-conflict', id, both),
  resolveConflict: (id: string, choice: 'server' | 'local') => ipcRenderer.invoke('agent:resolve-conflict', id, choice),
  retryTransfer: (id: string) => ipcRenderer.invoke('agent:retry-transfer', id),
  openFolder: () => ipcRenderer.invoke('agent:open-folder'),
  onState: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('agent:state', handler)
    return () => ipcRenderer.removeListener('agent:state', handler)
  },
  onTransfers: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('agent:transfers', handler)
    return () => ipcRenderer.removeListener('agent:transfers', handler)
  },
})

contextBridge.exposeInMainWorld('xdriveDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  getStartup: () => ipcRenderer.invoke('desktop:get-startup'),
  setStartup: (enabled: boolean) => ipcRenderer.invoke('desktop:set-startup', enabled),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('desktop:select-directory', defaultPath),
  hide: () => ipcRenderer.send('desktop:hide'),
  quit: () => ipcRenderer.send('desktop:quit'),
  agent,
}))
