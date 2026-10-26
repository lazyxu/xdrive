/** Browser storage is best-effort: Safari private/managed settings may deny even its getter. */
export function xDriveBrowserStorageRead(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

export function xDriveBrowserStorageWrite(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true } catch { return false }
}

/** Attempt every key even when one removal fails; never block in-memory logout. */
export function xDriveBrowserStorageRemove(keys: readonly string[] | string): boolean {
  let removed = true
  // A single key must be removed once, never iterated character by character.
  // Accept both shapes for callers and for older runtime contracts.
  for (const key of typeof keys === 'string' ? [keys] : keys) {
    try { window.localStorage.removeItem(key) } catch { removed = false }
  }
  return removed
}
