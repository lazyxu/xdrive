import type { XDriveWebAppRoute } from '../../ui/shared/src'

/** A bare root is an implicit navigation request, never a verified deep link.
 * Mobile/PWA enter the cloud Gallery first; Desktop keeps its previous All route.
 * Preserve explicit hashes, including public shares and malformed/unknown links,
 * for the browser runtime's existing authoritative route handling.
 */
export function xDriveWebDefaultLandingRoute(
  rawHash: string,
  compactWeb: boolean,
): XDriveWebAppRoute {
  if (rawHash === '' && compactWeb) return { app: 'gallery', params: {} }
  return { app: 'overview', params: {} }
}
