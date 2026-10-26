/** Optional PWA shell: no background transfers, update auto-reloads or private caches. */
export function registerXDrivePwa(): void {
  if (import.meta.env.DEV) return
  try {
    // Registration is optional. A restricted WebKit context may deny both
    // the secure-context getter and even the Service Worker capability test.
    // Unknown security status must never become permission to register.
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return
  } catch {
    return
  }
  const register = () => {
    try {
      void navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }).then(() => {
        // A late first-time registration must become observable to S3 without polling.
        window.dispatchEvent(new Event('xdrive-pwa-registered'))
      }).catch(() => {
        // Registration is optional; rejection must not block normal Web browsing.
      })
    } catch {
      // Some restricted browsers can throw synchronously from the SW getter or
      // register() itself. The regular online Web app remains fully usable.
    }
  }
  // Do not compete with the first interactive Files/Gallery paint.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
