import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('xdriveDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  hide: () => ipcRenderer.send('desktop:hide'),
  quit: () => ipcRenderer.send('desktop:quit'),
}))
