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
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      version: 1, ...xDriveNormalizeLoginDraft(value),
    }))
  } catch { /* Best effort: never block login when storage is denied. */ }
}
