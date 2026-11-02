import { contextBridge, ipcRenderer } from 'electron'

// Dedicated HTTPS guest: expose ONLY current expected username. No Agent,
// filesystem, saved password, Owner tokens, network proxy or arbitrary IPC.
contextBridge.exposeInMainWorld('xdrivePlacesEmbedBridge',Object.freeze({
  expectedOwner:():Promise<string|null> =>
    ipcRenderer.invoke('desktop:places-embed-expected-owner'),
  consume:(authenticatedUsername:string) =>
    ipcRenderer.invoke('desktop:places-embed-consume',authenticatedUsername),
}))
