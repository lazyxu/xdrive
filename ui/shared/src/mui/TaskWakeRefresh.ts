/**
 * Read-only Server task reconciliation when a Web/PWA window returns to the
 * foreground. Event hints never restart browser transfers or cancel durable
 * Server work. The owning React hook still fences late/auth-scoped results.
 */
export const xDriveTaskWakeMinIntervalMs = 1500

type WakeWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>
type WakeDocument = Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>

export function xDriveBindTaskWakeRefresh(
  requestRefresh: () => void,
  options: {
    win?: WakeWindow | null
    doc?: WakeDocument | null
    now?: () => number
    minGapMs?: number
  } = {},
): () => void {
  const win = options.win ?? (typeof window === 'undefined' ? null : window)
  const doc = options.doc ?? (typeof document === 'undefined' ? null : document)
  if (!win || !doc || typeof win.addEventListener !== 'function' ||
      typeof doc.addEventListener !== 'function') return () => {}

  const now = options.now ?? Date.now
  const minGapMs = Math.max(250, options.minGapMs ?? xDriveTaskWakeMinIntervalMs)
  let lastWake: number | null = null
  let detached = false
  const onWake = () => {
    if (detached || doc.visibilityState !== 'visible') return
    const current = now()
    if (!Number.isFinite(current)) return
    // Date.now may move backwards; allow a fresh snapshot after clock changes.
    if (lastWake !== null && current >= lastWake && current - lastWake < minGapMs) return
    lastWake = current
    requestRefresh()
  }

  win.addEventListener('pageshow', onWake)
  win.addEventListener('focus', onWake)
  win.addEventListener('online', onWake)
  doc.addEventListener('visibilitychange', onWake)
  return () => {
    detached = true
    win.removeEventListener('pageshow', onWake)
    win.removeEventListener('focus', onWake)
    win.removeEventListener('online', onWake)
    doc.removeEventListener('visibilitychange', onWake)
  }
}
