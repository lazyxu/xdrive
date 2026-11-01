import {
  xDriveBrowserStorageRead, xDriveBrowserStorageWrite, xDriveBrowserStorageRemove,
} from './browserSafeStorage'

// Same-Origin public username hints only. This file must never store passwords,
// access/refresh tokens, Owner proof, device grants or cross-Origin credentials.
const KEY = 'xdrive.login_usernames.v1'
const MAX_SAVED = 8
const MAX_PARSE = 32

function validUsername(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 && value.length <= 128 && value === value.trim() &&
    !/[\u0000-\u001F\u007F]/.test(value)
}

export function xDriveReadWebLoginUsernames(): string[] {
  const raw = xDriveBrowserStorageRead(KEY)
  if (!raw || raw.length > 8192) return []
  try {
    const decoded: unknown = JSON.parse(raw)
    if (!Array.isArray(decoded) || decoded.length > MAX_PARSE) return []
    const unique = new Set<string>()
    for (const value of decoded) {
      if (validUsername(value)) unique.add(value)
      if (unique.size >= MAX_SAVED) break
    }
    return [...unique]
  } catch {
    return []
  }
}

/** Add only successful Server-confirmed usernames, never failed guesses. */
export function xDriveRememberWebLoginUsername(username: string): boolean {
  if (!validUsername(username)) return false
  const rows = [username, ...xDriveReadWebLoginUsernames().filter(item => item !== username)]
    .slice(0, MAX_SAVED)
  return xDriveBrowserStorageWrite(KEY, JSON.stringify(rows))
}

/** Remove one username suggestion. Does not revoke or erase a browser session. */
export function xDriveForgetWebLoginUsername(username: string): boolean {
  const rows = xDriveReadWebLoginUsernames().filter(item => item !== username)
  if (rows.length === 0) return xDriveBrowserStorageRemove(KEY)
  return xDriveBrowserStorageWrite(KEY, JSON.stringify(rows))
}
