import type { XDriveClipboardDataPort } from '../../ui/shared/src/mui/ClipboardPage'
import { xDriveBrowserCopyText } from './browserClipboard'
import type { XDriveApi } from './api'

/** Only this authenticated Browser Host has the browser clipboard capability.
 * No native Device, Agent/Root, Share bearer or background privilege is implied.
 */
export function createXDriveWebClipboardPort(api: XDriveApi, ownerScopeKey: string): XDriveClipboardDataPort {
  const requireActive = (signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('Clipboard 导入已取消', 'AbortError')
  }
  const uploadThroughFiles = async (file: File, signal: AbortSignal) => {
    requireActive(signal)
    if (!file.name.trim() || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error('请选择非空、大小有效的本机文件；文件大小由现有 Files 上传及 Owner 配额控制。')
    }
    // Only the existing Owner-verified Files writer performs UploadSession/
    // CAS chunking and finalization. Clipboard cannot mint a blob grant.
    const root = await api.root(signal)
    requireActive(signal)
    if (!Number.isSafeInteger(root.id) || root.id <= 0 || root.type !== 'dir')
      throw new Error('当前 Owner 的文件根目录不可用。')
    const result = await api.uploadWithConflictPolicy(
      root.id, file, 'fail', undefined, '', '', '', signal,
    )
    requireActive(signal)
    if (result.skipped || result.node.type !== 'file' ||
        result.node.parent_id !== root.id || !Number.isSafeInteger(result.node.id) ||
        result.node.id <= 0 || result.node.revision <= 0 ||
        result.node.name !== file.name || result.node.size !== file.size) {
      throw new Error('文件已上传但未收到可用于 Clipboard 的有效节点收据，请到文件页面核对。')
    }
    return { node_id: result.node.id }
  }

  const importImageFromClipboard = async (signal: AbortSignal) => {
    requireActive(signal)
    if (!window.isSecureContext || typeof navigator.clipboard?.read !== 'function')
      throw new Error('此浏览器不支持用户授权读取本机剪贴板图片。')
    // Begin the permission-gated read synchronously inside the user's click,
    // BEFORE any Owner/API request can consume the browser gesture.
    const reading = navigator.clipboard.read()
    const items = await reading
    requireActive(signal)
    const imageFormats = [
      ['image/png', 'png'], ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'], ['image/gif', 'gif'],
      ['image/avif', 'avif'], ['image/heic', 'heic'], ['image/heif', 'heif'],
    ] as const
    const chosen = imageFormats.flatMap(([mime, ext]) =>
      items.filter(item => item.types.includes(mime)).map(item => ({ mime, ext, item })))[0]
    if (!chosen) throw new Error('本机剪贴板没有可读取的图片格式。')
    const blob = await chosen.item.getType(chosen.mime)
    requireActive(signal)
    if (!Number.isSafeInteger(blob.size) || blob.size <= 0)
      throw new Error('剪贴板图片为空或大小无效。')
    // The existing streaming Files/CAS writer enforces Server quota and
    // allowed resource sizes; Clipboard does not impose a 64 MiB ceiling.
    const file = new File([blob], 'Clipboard-' + crypto.randomUUID() + '.' + chosen.ext, {
      type: chosen.mime, lastModified: Date.now(),
    })
    return uploadThroughFiles(file, signal)
  }

  return {
    ownerScopeKey,
    list: (before, signal) => api.clipboardItems(before, signal),
    create: (item, signal) => api.clipboardCreate(item, signal),
    remove: (id, signal) => api.clipboardRemove(id, signal),
    clear: signal => api.clipboardClear(signal),
    listDevices: signal => api.clipboardDevices(signal),
    revokeDevice: (id, signal) => api.clipboardRevokeDevice(id, signal),
    uploadLocalFile: (file, signal) => uploadThroughFiles(file, signal),
    importImageFromClipboard,
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
