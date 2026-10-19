import type { XDriveBaiduJSAPI4SessionGrant } from './media-gallery-baidu-jsapi4-browser-loader'

// The Server issues a 120-second Secure/HttpOnly, map-only Cookie. A native
// Baidu map stays mounted during pan/zoom, so it must renew while in use.
// Neither the Cookie nor any account Bearer is read or handled by this helper.
export const XDRIVE_BAIDU_SESSION_RENEW_AFTER_MS = 60_000
export const XDRIVE_BAIDU_SESSION_RENEW_POLL_MS = 30_000

/**
 * Keep ONE signed Owner map session alive for the mounted Gallery generation.
 * Reuse the exact authenticated Server Session POST supplied by the app.
 * Hidden iOS/PWA pages do not poll; resume attempts a new authorization.
 * Rejected/expired authority releases the native map instead of retrying
 * blindly or displaying an unauthorized photo overlay.
 */
export function xDriveKeepBaiduJSAPI4MapSessionAlive(
  mintMapOnlySession: (signal: AbortSignal) => Promise<XDriveBaiduJSAPI4SessionGrant>,
  signal: AbortSignal,
  ownerDocument: Document,
  onLost: () => void,
): () => void {
  if (!ownerDocument || signal.aborted || typeof mintMapOnlySession !== 'function' ||
      typeof onLost !== 'function') return () => {}

  let active = true
  let inFlight = false
  let lastGrantedAt = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  const ownerWindow = ownerDocument.defaultView

  const stop = () => {
    if (!active) return
    active = false
    if (timer !== null) clearInterval(timer)
    ownerDocument.removeEventListener('visibilitychange', onVisible)
    ownerWindow?.removeEventListener('pageshow', onVisible)
    signal.removeEventListener('abort', stop)
  }
  const revoke = () => {
    if (!active) return
    stop()
    if (!signal.aborted) onLost()
  }
  const renew = async () => {
    if (!active || signal.aborted || inFlight ||
        ownerDocument.visibilityState !== 'visible' ||
        Date.now() - lastGrantedAt < XDRIVE_BAIDU_SESSION_RENEW_AFTER_MS) return
    inFlight = true
    try {
      const grant = await mintMapOnlySession(signal)
      if (!active || signal.aborted) return
      if (grant?.provider !== 'baidu-jsapi-4.0' || grant.runtime_enabled !== true) {
        revoke()
        return
      }
      lastGrantedAt = Date.now()
    } catch {
      if (active && !signal.aborted) revoke()
    } finally {
      inFlight = false
    }
  }
  function onVisible() {
    if (ownerDocument.visibilityState === 'visible') void renew()
  }

  timer = setInterval(() => { void renew() }, XDRIVE_BAIDU_SESSION_RENEW_POLL_MS)
  ownerDocument.addEventListener('visibilitychange', onVisible)
  ownerWindow?.addEventListener('pageshow', onVisible)
  signal.addEventListener('abort', stop, { once: true })
  return stop
}
