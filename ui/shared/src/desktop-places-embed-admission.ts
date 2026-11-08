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
  if (root.querySelector('[data-xdrive-baidu-map-unavailable]') ||
      phase === 'unavailable') return 'unavailable'
  return phase === 'ready' ? 'ready' : 'pending'
})()`

export function xDriveDesktopPlacesGuestProbeState(
  raw: unknown,
): XDriveDesktopPlacesGuestProbeState {
  return raw === 'ready' || raw === 'login' || raw === 'denied' ||
    raw === 'unavailable' ? raw : 'pending'
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
