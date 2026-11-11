import type { XDriveClipboardDataPort } from '../../ui/shared/src/mui/ClipboardPage'
import type { XDriveSynologyBackupLocalClient, XDriveSynologyClipboardFileReference } from '../../ui/shared/src/synology-backup-adapter'
import { xDriveBrowserCopyText } from './browserClipboard'

/** DSM shares the one canonical React Clipboard UI but never borrows the
 * NAS Agent's system clipboard or Desktop renderer privilege. Each operation
 * passes through the HTTPS same-origin CGI, existing Agent and revocable Owner.
 */
export function createXDriveDSMClipboardPort(
  cgi: XDriveSynologyBackupLocalClient, expectedOwnerScope: string,
  openVerifiedFile?: (reference: XDriveSynologyClipboardFileReference, signal: AbortSignal) => Promise<void>,
): XDriveClipboardDataPort {
  if (!/^[0-9a-f]{64}$/.test(expectedOwnerScope)) {
    throw new Error('DSM Owner 尚未通过身份检查')
  }
  let ownerScope = expectedOwnerScope
  let server = ''
  const current = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const status = await cgi.serverConnection(signal)
    if (!status.configured || status.must_change_password ||
        !status.server || !status.username || !status.owner_scope) {
      throw new Error('DSM Owner 未授权，剪贴板已不可用')
    }
    if (ownerScope !== status.owner_scope || (server && server !== status.server)) {
      throw new Error('DSM Owner 已变化，必须重新进入剪贴板')
    }
    signal?.throwIfAborted()
    return status
  }
  const checked = async <T,>(run: (scope: string) => Promise<T>, signal?: AbortSignal) => {
    const now = await current(signal)
    if (!server) server = now.server!
    const result = await run(ownerScope)
    await current(signal)
    return result
  }
  const uploadLocalFile = async (file: File, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (!file || !file.name.trim() || !Number.isSafeInteger(file.size) ||
        file.size <= 0) {
      throw new Error('请选择有效的本机文件')
    }
    const root = await checked(() => cgi.ownerFilesRoot(signal), signal)
    if (root.type !== 'dir' || !Number.isSafeInteger(root.id) || root.id <= 0)
      throw new Error('DSM Owner 文件根目录不可用')
    // Existing DSM Owner -> Agent -> canonical Files/CAS single-file uploader.
    const node = await checked(scope => file.size > 4 * 1_048_576
      ? cgi.ownerUploadLargeFile(root.id, file, scope, signal)
      : cgi.ownerUploadSmallFile(root.id, file, scope, signal), signal)
    if (node.type !== 'file' || node.parent_id !== root.id ||
        !Number.isSafeInteger(node.id) || node.id <= 0 || node.revision <= 0 ||
        node.name !== file.name || node.size !== file.size) {
      throw new Error('DSM CAS 上传回执未确认；请到 Files 核对')
    }
    return { node_id: node.id }
  }
  return {
    // A single DSM browser Host instance never persists a key; Server/Owner
    // scope is checked on every request. This key is UI lifecycle-only.
    ownerScopeKey: 'dsm:' + expectedOwnerScope,
    list: (before, signal) => checked(() => cgi.clipboardList(before, signal), signal),
    listDevices: signal => checked(() => cgi.clipboardDevices(signal), signal),
    revokeDevice: (id, signal) => checked(scope => cgi.clipboardRevokeDevice(scope, id, signal), signal),
    enableDeviceRecipient: signal => checked(scope => cgi.clipboardEnableDevice(scope, signal), signal),
    openReferencedFile: openVerifiedFile ? async (id, signal) => {
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error('Invalid current Owner Clipboard file identity')
      const reference = await checked(() => cgi.clipboardFileReference(id, signal), signal)
      // The Host callback synchronously commits its Viewer selection. A
      // *post*-commit network Owner check can reject after showing stale
      // metadata from the previous account. Finish the final Owner/session
      // proof before asking the Host to stage any preview.
      await current(signal)
      signal.throwIfAborted()
      await openVerifiedFile(reference, signal)
    } : undefined,
    create: async (item, signal) => {
      const media = item.kind === 'image/x-xdrive-node-ref' ||
        item.kind === 'application/x-xdrive-node-ref'
      if ((media && (!item.target_device_id || !item.node_id ||
          item.content !== 'asset:' + item.node_id)) || (!media && !!item.node_id)) {
        throw new Error('DSM Clipboard 内容与文件引用不匹配')
      }
      return checked(scope => cgi.clipboardCreate(scope, item, signal), signal)
    },
    remove: (id, signal) => checked(
      scope => cgi.clipboardDelete(scope, id, signal), signal),
    clear: signal => checked(scope => cgi.clipboardClear(scope, signal), signal),
    browseFiles: {
      root: signal => checked(() => cgi.ownerFilesRoot(signal), signal).then(root => ({
        id: root.id, name: root.name, type: root.type, size: root.size,
      })),
      page: async (folderID, cursor, signal) => {
        if (!Number.isSafeInteger(folderID) || folderID <= 0) {
          throw new Error('无效的 DSM Owner 文件目录')
        }
        const page = await checked(() => cgi.ownerFilesPage(
          folderID, 50, 'name', 'asc', cursor || '', signal), signal)
        return {
          items: page.items.map(node => ({
            id: node.id, name: node.name, type: node.type, size: node.size,
          })),
          next_cursor: page.next_cursor,
        }
      },
    },
    uploadLocalFile,
    importImageFromClipboard: async signal => {
      signal.throwIfAborted()
      if (!window.isSecureContext || typeof navigator.clipboard?.read !== 'function')
        throw new Error('DSM 浏览器不允许用户主动读取剪贴板图片')
      const reading = navigator.clipboard.read()
      const items = await reading
      signal.throwIfAborted()
      const formats = [
        ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
        ['image/gif', 'gif'], ['image/avif', 'avif'],
      ] as const
      const match = formats.flatMap(([mime, ext]) =>
        items.filter(item => item.types.includes(mime)).map(item => ({ mime, ext, item })))[0]
      if (!match) throw new Error('剪贴板没有可读取的图片')
      const blob = await match.item.getType(match.mime)
      signal.throwIfAborted()
      if (!Number.isSafeInteger(blob.size) || blob.size <= 0)
        throw new Error('无效的本机剪贴板图片')
      return uploadLocalFile(new File(
        [blob], 'Clipboard-' + crypto.randomUUID() + '.' + match.ext,
        { type: match.mime, lastModified: Date.now() }), signal)
    },
    // The DSM CGI waits on the owning Agent's authenticated Server SSE.
    // Only an Owner-scoped invalidation cursor reaches the browser.
    watchChanges: async (onChange, signal) => {
      let cursor = 0
      let previous: string | undefined
      let failedAt = 0
      let wasHidden = false
      const delay = (ms: number) => new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return }
        const onAbort = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
      })
      while (!signal.aborted) {
        signal.throwIfAborted()
        if (document.visibilityState !== 'visible') {
          wasHidden = true
          previous = undefined
          await delay(1000)
          continue
        }
        if (wasHidden) { wasHidden = false; onChange() }
        if (failedAt === 0 || Date.now() - failedAt >= 15000) {
          try {
            const event = await checked(() => cgi.clipboardNextEvent(cursor, signal), signal)
            if (!Number.isSafeInteger(event.cursor) || event.cursor < cursor ||
                (event.changed && event.cursor <= cursor)) {
              throw new Error('无效的 DSM Clipboard 云端事件')
            }
            cursor = event.cursor
            failedAt = 0
            previous = undefined
            if (!signal.aborted && document.visibilityState === 'visible' && event.changed) onChange()
            continue
          } catch (error) {
            signal.throwIfAborted()
            // Old Agent/CGI deployments retain existing bounded foreground
            // poll and the shared page's independent 15s GET fallback.
            failedAt = Date.now()
          }
        }
        const page = await checked(() => cgi.clipboardList(undefined, signal), signal)
        const version = page.items.map(item => item.id + ':' + item.client_event_id).join('|')
        if (previous !== undefined && previous !== version &&
            document.visibilityState === 'visible') onChange()
        previous = version
        await delay(1800)
      }
    },
    readText: async () => {
      if (!window.isSecureContext || typeof navigator.clipboard?.readText !== 'function') {
        throw new Error('DSM 浏览器未允许读取系统剪贴板')
      }
      // Start the permission-gated read synchronously in the user's click;
      // the awaited Owner proof gates whether its bytes may enter React.
      const read = navigator.clipboard.readText()
      const text = await read
      await current()
      return text
    },
    copyText: async text => {
      // Clipboard API may lose transient user activation after an async CGI
      // proof. The parent Host already verified this Owner and removes its
      // page on focus/session drift. Finish by re-checking Owner afterwards.
      const write = xDriveBrowserCopyText(text)
      await write
      await current()
    },
  }
}
