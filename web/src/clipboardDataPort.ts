import type { XDriveClipboardDataPort } from '../../ui/shared/src/mui/ClipboardPage'
import { xDriveBrowserCopyText } from './browserClipboard'
import type { XDriveApi } from './api'

/** Only this authenticated Browser Host has the browser clipboard capability.
 * No native Device, Agent/Root, Share bearer or background privilege is implied.
 */
export function createXDriveWebClipboardPort(api: XDriveApi, ownerScopeKey: string): XDriveClipboardDataPort {
  return {
    ownerScopeKey,
    vault: signal => api.clipboardVault(signal),
    initializeCheck: (check, signal) => api.clipboardInitializeCheck(check, signal),
    list: (before, signal) => api.clipboardItems(before, signal),
    create: (item, signal) => api.clipboardCreate(item, signal),
    remove: (id, signal) => api.clipboardRemove(id, signal),
    clear: signal => api.clipboardClear(signal),
    listDevices: signal => api.clipboardDevices(signal),
    revokeDevice: (id, signal) => api.clipboardRevokeDevice(id, signal),
    browseFiles: {
      root: async signal => {
        const root = await api.root(signal)
        return { id: root.id, name: root.name, type: root.type, size: root.size }
      },
      page: async (folderID, cursor, signal) => {
        const result = await api.listPageAbortable(
          folderID, { limit: 50, cursor, sort: 'name', order: 'asc' }, signal)
        return {
          items: result.items.map(item => ({
            id: item.id, name: item.name, type: item.type, size: item.size,
          })),
          next_cursor: result.next_cursor,
        }
      },
    },
    copyText: text => xDriveBrowserCopyText(text),
    watchChanges: (onChange, signal) => api.clipboardWatchChanges(onChange, signal),
    readText: async () => {
      if (!navigator.clipboard?.readText || !window.isSecureContext) {
        throw new Error('浏览器不允许读取系统剪贴板')
      }
      return navigator.clipboard.readText()
    },
  }
}
