/**
 * A Desktop map URL is a reserved, map-only authentication route. Its mere
 * presence must NEVER fall through to the ordinary Web login form, even if a
 * stale Server snapshot has no matching Electron preload bridge.
 */
export function xDriveDesktopPlacesEmbedIntent(search: string): boolean {
  return new URLSearchParams(search).has('desktop_places_embed')
}

export type XDriveDesktopPlacesGuestProbeState =
  'ready' | 'login' | 'denied' | 'pending'

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
  if (has('[data-xdrive-desktop-places-web-page]')) return 'ready'
  return 'pending'
})()`

export function xDriveDesktopPlacesGuestProbeState(
  raw: unknown,
): XDriveDesktopPlacesGuestProbeState {
  return raw === 'ready' || raw === 'login' || raw === 'denied'
    ? raw : 'pending'
}
