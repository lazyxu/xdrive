import { xDriveNormalizeLoginDraft, xDriveEmptyLoginDraft } from '@xdrive/shared'
import type { XDriveLoginDraft } from '@xdrive/shared'

const KEY = 'xdrive.desktop.login-draft.v1'

/** Renderer owns only non-secret edits; Main/Agent own encrypted credentials. */
export function readDesktopLoginDraft(): XDriveLoginDraft {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? xDriveNormalizeLoginDraft(JSON.parse(raw)) : xDriveEmptyLoginDraft()
  } catch {
    // Opaque/file origins and locked-down profiles may deny browser storage.
    return xDriveEmptyLoginDraft()
  }
}

export function saveDesktopLoginDraft(value: XDriveLoginDraft): void {
  const draft = xDriveNormalizeLoginDraft(value)
  // A malformed URL may embed a password or bearer query. Never persist it.
  // Retain the last valid draft until the user finishes editing the address.
  if (value.server.trim() && !draft.server) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      version: 1, ...draft,
    }))
  } catch { /* Best effort: never block login when storage is denied. */ }
}
