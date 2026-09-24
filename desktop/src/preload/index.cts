import { contextBridge, ipcRenderer } from 'electron'

const agent = Object.freeze({
  getState: () => ipcRenderer.invoke('agent:get-state'),
  retry: () => ipcRenderer.invoke('agent:retry'),
  login: (input: { server: string; username: string; password: string; mount_path?: string }) => ipcRenderer.invoke('agent:login', input),
  logout: () => ipcRenderer.invoke('agent:logout'),
  changePassword: (input: { current_password: string; new_password: string }) => ipcRenderer.invoke('agent:change-password', input),
  setPaused: (paused: boolean) => ipcRenderer.invoke('agent:set-paused', paused),
  syncNow: () => ipcRenderer.invoke('agent:sync-now'),
  getSettings: () => ipcRenderer.invoke('agent:get-settings'),
  updateSettings: (input: { mount_path?: string; cache_limit_bytes?: number }) => ipcRenderer.invoke('agent:update-settings', input),
  getConflicts: () => ipcRenderer.invoke('agent:get-conflicts'),
  openConflict: (id: string, both = false) => ipcRenderer.invoke('agent:open-conflict', id, both),
  resolveConflict: (id: string, choice: 'server' | 'local') => ipcRenderer.invoke('agent:resolve-conflict', id, choice),
  openFolder: () => ipcRenderer.invoke('agent:open-folder'),
  onState: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('agent:state', handler)
    return () => ipcRenderer.removeListener('agent:state', handler)
  },
})

contextBridge.exposeInMainWorld('xdriveDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('desktop:select-directory', defaultPath),
  hide: () => ipcRenderer.send('desktop:hide'),
  quit: () => ipcRenderer.send('desktop:quit'),
  agent,
}))
