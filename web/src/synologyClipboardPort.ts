import type { XDriveClipboardDataPort } from '../../ui/shared/src/mui/ClipboardPage'
import type { XDriveSynologyBackupLocalClient } from '../../ui/shared/src/synology-backup-adapter'
import { xDriveBrowserCopyText } from './browserClipboard'

/** DSM shares the one canonical React Clipboard UI but never borrows the
 * NAS Agent's system clipboard or Desktop renderer privilege. Each operation
 * passes through the HTTPS same-origin CGI, existing Agent and revocable Owner.
 */
export function createXDriveDSMClipboardPort(
  cgi: XDriveSynologyBackupLocalClient, expectedOwnerScope: string,
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
    if (ownerScope && (ownerScope !== status.owner_scope || server !== status.server)) {
      throw new Error('DSM Owner 已变化，必须重新进入并解锁剪贴板')
    }
    signal?.throwIfAborted()
    return status
  }
  const checked = async <T,>(run: (scope: string) => Promise<T>, signal?: AbortSignal) => {
    const now = await current(signal)
    if (!ownerScope) {
      ownerScope = now.owner_scope
      server = now.server!
    }
    const result = await run(ownerScope)
    await current(signal)
    return result
  }
  return {
    // A single DSM browser Host instance never persists a key; Server/Owner
    // scope is checked on every request. This key is UI lifecycle-only.
    ownerScopeKey: 'dsm:' + window.location.origin,
    claimScope(vault) {
      if (!Number.isSafeInteger(vault.owner_id) || !vault.owner_id || !server) {
        throw new Error('未取得经过认证的 DSM Clipboard Owner ID')
      }
      return new URL(server).origin + ':' + String(vault.owner_id)
    },
    vault: signal => checked(() => cgi.clipboardVault(signal), signal),
    initializeCheck: (value, signal) => checked(
      scope => cgi.clipboardCheck(scope, value, signal), signal),
    list: (before, signal) => checked(() => cgi.clipboardList(before, signal), signal),
    create: (item, signal) => checked(
      scope => cgi.clipboardCreate(scope, item, signal), signal),
    remove: (id, signal) => checked(
      scope => cgi.clipboardDelete(scope, id, signal), signal),
    clear: signal => checked(scope => cgi.clipboardClear(scope, signal), signal),
    readText: async () => {
      await current()
      if (!window.isSecureContext || typeof navigator.clipboard?.readText !== 'function') {
        throw new Error('DSM 浏览器未允许读取系统剪贴板')
      }
      return navigator.clipboard.readText()
    },
    copyText: async text => {
      await current()
      await xDriveBrowserCopyText(text)
    },
  }
}
