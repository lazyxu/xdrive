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
    create: (item, signal) => {
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
