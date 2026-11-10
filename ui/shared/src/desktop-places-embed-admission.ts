/**
 * A Desktop map URL is a reserved, map-only authentication route. Its mere
 * presence must NEVER fall through to the ordinary Web login form, even if a
 * stale Server snapshot has no matching Electron preload bridge.
 */
export function xDriveDesktopPlacesEmbedIntent(search: string): boolean {
  return new URLSearchParams(search).has('desktop_places_embed')
}

export type XDriveDesktopPlacesGuestProbeState =
  'ready' | 'login' | 'denied' | 'unavailable' | 'pending'

/**
 * Read-only, presentation-only health check executed in the sandboxed HTTPS
 * guest. This does not grant Owner access; Main/Server still enforce Owner,
 * one-use scope and signed media authorization independently.
 *
 * Recognize a nested login BEFORE a map root, since any later login
 * transition must also hide the embedded guest.
 */
export const XDRIVE_DESKTOP_PLACES_GUEST_PROBE = `(() => {
  const has = (selector) => document.querySelector(selector) !== null
  if (has('#web-login-username') || has('#web-login-password')) return 'login'
  if (has('[data-xdrive-desktop-places-auth-denied]')) return 'denied'
  const root = document.querySelector('[data-xdrive-desktop-places-web-page]')
  if (!root) return 'pending'
  // The authenticated React page can mount long before Baidu's actual map.
  // Never reveal an empty/black guest merely because the page root exists.
  const sdk = root.querySelector('[data-xdrive-baidu-isolated-photo-map]')
  const phase = sdk?.getAttribute('data-xdrive-places-sdk-phase')
  const unavailable = root.querySelector('[data-xdrive-baidu-map-unavailable]')
  if (unavailable || phase === 'unavailable') {
    // Only a short, code-owned reason crosses into the Desktop UI. Never read
    // provider text, HTTP bodies, keys, cookies or photo attributes.
    const code = unavailable?.getAttribute('data-xdrive-baidu-map-error-code')
    return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)
      ? 'unavailable:' + code : 'unavailable'
  }
  return phase === 'ready' ? 'ready' : 'pending'
})()`

const SAFE_MAP_CODES = new Set([
  'server_release_blocked','isolated_origin_unavailable','child_handshake_timeout',
  'client_version_mismatch',
  'status_access_denied','status_unavailable','session_denied',
  'session_rate_limited','session_timeout','session_unavailable',
  'sdk_script_failed','sdk_script_timeout','sdk_namespace_missing',
  'sdk_load_failed','sdk_map_initialization_failed','viewport_denied',
  'viewport_unavailable','map_binding_failed','session_renew_failed',
])
export function xDriveDesktopPlacesGuestFailureCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('unavailable:')) return null
  const code = raw.slice('unavailable:'.length)
  return SAFE_MAP_CODES.has(code) ? code : null
}
export function xDriveDesktopPlacesGuestProbeState(
  raw: unknown,
): XDriveDesktopPlacesGuestProbeState {
  if (raw === 'ready' || raw === 'login' || raw === 'denied') return raw
  return raw === 'unavailable' || xDriveDesktopPlacesGuestFailureCode(raw)
    ? 'unavailable' : 'pending'
}

// Electron <webview>.executeJavaScript may throw SYNCHRONOUSLY until the
// element is attached and dom-ready has fired. A Promise .catch alone cannot
// intercept it: the exception would escape React's useEffect and unmount
// the entire Desktop Renderer. A null result means pending navigation; the
// existing bounded probe timer and dom-ready listener will retry.
export function xDriveStartDesktopPlacesGuestProbe(
  guest: { executeJavaScript?: (script: string) => Promise<unknown> } | null | undefined,
  script: string,
): Promise<unknown> | null {
  if (!guest || typeof guest.executeJavaScript !== 'function') return null
  try {
    return Promise.resolve(guest.executeJavaScript(script))
  } catch {
    return null
  }
}
