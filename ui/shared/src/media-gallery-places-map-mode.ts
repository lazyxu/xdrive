/** Map runtime selection requires a clean document when leaving the old SDK. */
export type XDrivePlacesMapMode = 'prototype' | 'isolated'
export const XDRIVE_PLACES_MAP_MODE_QUERY = 'places_map_mode'

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
    return url.href
  } catch {
    return null
  }
}
