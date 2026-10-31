import {
  xDriveEmptyLoginDraft, xDriveNormalizeLoginDraft,
} from '../../ui/shared/src/login-draft'
import type { XDriveLoginDraft } from '../../ui/shared/src/login-draft'
import { xDriveBrowserStorageRead, xDriveBrowserStorageWrite } from './browserSafeStorage'

// DSM page JSX must never manipulate raw browser storage or hold Agent secrets.
// This adapter persists only bounded, validated public login hints.
const DSM_LOGIN_DRAFT_KEY = 'xdrive.dsm.login-draft.v1'

export function readDSMLoginDraft(): XDriveLoginDraft {
  const raw = xDriveBrowserStorageRead(DSM_LOGIN_DRAFT_KEY)
  if (!raw) return xDriveEmptyLoginDraft()
  try { return xDriveNormalizeLoginDraft(JSON.parse(raw)) }
  catch { return xDriveEmptyLoginDraft() }
}

export function saveDSMLoginDraft(server: string, username: string): void {
  const draft = xDriveNormalizeLoginDraft({ server, lanIp: '', username })
  // Never serialize a URL embedding a user:password, tokens or query secrets.
  // Keep the last valid draft while an incomplete/invalid URL is being edited.
  if (server.trim() && !draft.server) return
  xDriveBrowserStorageWrite(DSM_LOGIN_DRAFT_KEY, JSON.stringify({
    version: 1, ...draft,
  }))
}
