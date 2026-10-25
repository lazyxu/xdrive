/** Browser storage is best-effort: Safari private/managed settings may deny even its getter. */
export function xDriveBrowserStorageRead(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

export function xDriveBrowserStorageWrite(key: string, value: string): boolean {
  try { window.localStorage.setItem(key, value); return true } catch { return false }
}

/** Attempt every key even when one removal fails; never block in-memory logout. */
export function xDriveBrowserStorageRemove(keys: readonly string[]): boolean {
  let removed = true
  for (const key of keys) {
    try { window.localStorage.removeItem(key) } catch { removed = false }
  }
  return removed
}
