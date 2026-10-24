import { contextBridge, ipcRenderer } from 'electron'

/** Only loaded in the separately partitioned HTTPS map WebContents.
 * A logged-in first-party Parent must call /auth/me before consuming.
 * This bridge neither receives nor exposes Agent credentials, arbitrary IPC,
 * node/file APIs, private coordinates or a provider URL.
 */
contextBridge.exposeInMainWorld('xdriveSecureMapBridge', Object.freeze({
  consume: (authenticatedUsername: string) =>
    ipcRenderer.invoke('desktop:consume-baidu-map-scope', authenticatedUsername),
  onPending: (callback: () => void) => {
    const notify = () => callback()
    ipcRenderer.on('desktop:secure-baidu-map-pending', notify)
    return () => ipcRenderer.removeListener('desktop:secure-baidu-map-pending', notify)
  },
}))
