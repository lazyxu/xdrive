/** Map runtime selection requires a clean document when leaving the old SDK. */
export type XDrivePlacesMapMode = 'prototype' | 'isolated'
export const XDRIVE_PLACES_MAP_MODE_QUERY = 'places_map_mode'
/** A nonsensitive fail-closed marker: a reloaded page MUST redeem a fresh
 * ticket or explicitly acknowledge losing its restricted Gallery scope. */
export const XDRIVE_PLACES_MAP_SCOPE_REQUIRED_QUERY = 'places_map_scope_required'

export function xDrivePlacesMapModeFromHref(href: string): XDrivePlacesMapMode {
  try {
    const url = new URL(href)
    // No selector is the product's explicit legacy default. Any malformed,
    // repeated or unknown selector must never silently downgrade a secure link.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'isolated'
    const selections = url.searchParams.getAll(XDRIVE_PLACES_MAP_MODE_QUERY)
    if (selections.length === 0) return 'prototype'
    return selections.length === 1 && selections[0] === 'prototype'
      ? 'prototype' : 'isolated'
  } catch {
    return 'isolated'
  }
}

/** Used with location.replace(), never a React-only hot swap. */
export function xDrivePlacesMapModeNavigationURL(href: string, mode: XDrivePlacesMapMode):
  string | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (mode === 'isolated') url.searchParams.set(XDRIVE_PLACES_MAP_MODE_QUERY, 'isolated')
    else url.searchParams.delete(XDRIVE_PLACES_MAP_MODE_QUERY)
    // A deliberate unrestricted switch never inherits a stale opaque nonce or
    // a previous one-time scope requirement from another document.
    url.searchParams.delete(XDRIVE_PLACES_MAP_HANDOFF_QUERY)
    url.searchParams.delete(XDRIVE_PLACES_MAP_SCOPE_REQUIRED_QUERY)
    return url.href
  } catch {
    return null
  }
}

/** A random, one-use map scope bridge nonce is opaque and never includes
 * Album/Owner/Filter/GPS. The NEW document removes it before mounting SDKs.
 * Only the authenticated Server can redeem it for the same Owner. */
export const XDRIVE_PLACES_MAP_HANDOFF_QUERY = 'places_map_handoff'
export function xDrivePlacesMapScopeHandoffURL(
  href: string, target: XDrivePlacesMapMode, ticket: string,
): string | null {
  if (!/^[a-f0-9]{64}$/.test(ticket)) return null
  // A second untrusted handoff token in the CURRENT URL is not permission
  // to mint or replace a fresh one. Deny rather than overriding the hint.
  try {
    if (new URL(href).searchParams.has(XDRIVE_PLACES_MAP_HANDOFF_QUERY)) return null
  } catch { return null }
  const next = xDrivePlacesMapModeNavigationURL(href, target)
  if (!next) return null
  try {
    const url = new URL(next)
    if (url.protocol !== 'https:' ||
        url.searchParams.has(XDRIVE_PLACES_MAP_HANDOFF_QUERY)) return null
    url.searchParams.set(XDRIVE_PLACES_MAP_HANDOFF_QUERY, ticket)
    url.searchParams.set(XDRIVE_PLACES_MAP_SCOPE_REQUIRED_QUERY, '1')
    return url.href
  } catch { return null }
}
