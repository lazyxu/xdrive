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
  let negotiated = false
  const poll = () => {
    if (!active || inFlight || document.visibilityState !== 'visible') return
    inFlight = true
    void (async () => {
      // A fresh WebView creates a fresh host adapter; capability state is
      // not available until negotiated. Do this automatically so a saved
      // opt-in resumes on the next authenticated foreground app launch.
      if (!negotiated) {
        const supported = await host.capabilities()
        if (!active || !supported) return
        negotiated = true
      }
      if (!host.foregroundAutoSupported) return
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
  // Native configuration succeeds only after explicit user confirmation.
  // Make the first opted-in scan eligible without needing a route change.
  window.addEventListener('xdrive-ios-auto-config-changed', poll)
  poll()
  return () => {
    active = false
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('xdrive-ios-auto-config-changed', poll)
    // The Owner-backed FileManager has unmounted or switched accounts.
    // A stale in-flight native foreground backup must not survive that.
    void host.cancel().catch(() => {})
    // Clear the RAM-only short-lived bearer on sign-out, account change,
    // or unmount. The user's local interval preference remains opt-in.
    void host.disarmBackground().catch(() => {})
  }
}
