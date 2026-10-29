import type {
  XDriveIOSPhotoBackupHost,
  XDriveIOSPhotoBackupSession,
} from '../../ui/shared/src/mui/IOSPhotoBackupSettings'

/** An authenticated visible WKWebView can trigger best-effort foreground
 * checks. This is NOT iOS BGProcessingTask, background URLSession or a
 * promise to run when the app is closed, suspended or the phone is locked.
 * Native independently enforces user opt-in, due time and current Owner/root.
 */
export function xDriveStartIOSForegroundAutoScheduler(
  host: XDriveIOSPhotoBackupHost,
  readFreshOwner: () => Promise<XDriveIOSPhotoBackupSession | null>,
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => undefined
  }
  let active = true
  let inFlight = false
  const poll = () => {
    if (!active || inFlight || document.visibilityState !== 'visible' ||
        !host.foregroundAutoSupported) return
    inFlight = true
    void (async () => {
      const session = await readFreshOwner()
      if (!active || !session || document.visibilityState !== 'visible') return
      // Native verified consent + per-Owner stored schedule is the only
      // authority; local JS timing alone must never authorize a PhotoKit read.
      await host.autoTick(session)
    })().catch(() => {
      // A failed access refresh, Owner probe, transient network outage or
      // protected Keychain must never turn into an unscoped background retry.
      // The native due/cursor ledger remains authoritative.
    }).finally(() => { inFlight = false })
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') poll()
  }
  const interval = window.setInterval(poll, 60_000)
  document.addEventListener('visibilitychange', onVisibility)
  poll()
  return () => {
    active = false
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisibility)
    // The Owner-backed FileManager has unmounted or switched accounts.
    // A stale in-flight native foreground backup must not survive that.
    void host.cancel().catch(() => {})
  }
}
