/** Optional PWA shell: no background transfers, update auto-reloads or private caches. */
export function registerXDrivePwa(): void {
  if (import.meta.env.DEV || !window.isSecureContext || !('serviceWorker' in navigator)) return
  const register = () => {
    void navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => {
      // A blocked Service Worker must not stop the regular online Web app.
    })
  }
  // Do not compete with the first interactive Files/Gallery paint.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
