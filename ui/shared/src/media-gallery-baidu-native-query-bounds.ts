import type { MediaPlacesViewportBounds } from './models'

export const XDRIVE_BAIDU_WORLD_OVERVIEW: Readonly<MediaPlacesViewportBounds> = {
  west: -180, south: -85, east: 180, north: 85,
}

type Point = { lng: number; lat: number }
type Bounds = { getSouthWest(): Point; getNorthEast(): Point }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const normalize = (n: number) => ((n + 180) % 360 + 360) % 360 - 180

/**
 * BD09 SDK camera -> conservative WGS84 QUERY ENVELOPE, NOT a coordinate
 * transformation. Pad beyond the provider displacement and viewport margin;
 * this envelope may include extra photos, and is NEVER used as an exact
 * media membership/Viewer filter or written back as source GPS.
 */
export function xDriveBaiduConservativeOwnerQueryBounds(raw: Bounds | null | undefined):
  MediaPlacesViewportBounds {
  if (!raw) return { ...XDRIVE_BAIDU_WORLD_OVERVIEW }
  try {
    const sw = raw.getSouthWest(), ne = raw.getNorthEast()
    if (!sw || !ne || ![sw.lng,sw.lat,ne.lng,ne.lat].every(finite) ||
        Math.abs(sw.lat) > 90 || Math.abs(ne.lat) > 90 || ne.lat <= sw.lat ||
        Math.abs(ne.lng-sw.lng) > 360) return { ...XDRIVE_BAIDU_WORLD_OVERVIEW }
    let span = ne.lng - sw.lng
    if (span < 0) span += 360
    if (span >= 359.7 || span <= 0) return { ...XDRIVE_BAIDU_WORLD_OVERVIEW }
    const pad = 0.08 + Math.min(0.5, span * 0.04)
    const west = normalize(sw.lng - pad)
    const east = normalize(ne.lng + pad)
    if (span + 2 * pad >= 359.7) return { ...XDRIVE_BAIDU_WORLD_OVERVIEW }
    const south = clamp(sw.lat - pad, -85, 85)
    const north = clamp(ne.lat + pad, -85, 85)
    if (north <= south || west === east) return { ...XDRIVE_BAIDU_WORLD_OVERVIEW }
    return { west, south, east, north }
  } catch { return { ...XDRIVE_BAIDU_WORLD_OVERVIEW } }
}

/** Legacy direct-map prototype only. The SDK camera is BD09LL; this derives a
 * deliberately conservative WGS84 QUERY envelope, not precise photo membership.
 * Unlike the compatibility helper above, malformed/out-of-range provider
 * bounds return null instead of silently turning a user pan into WORLDWIDE SQL.
 */
export function xDriveBaiduPrototypeCameraQueryBounds(
  raw: Bounds | null | undefined,
): MediaPlacesViewportBounds | null {
  if (!raw) return null
  try {
    const sw = raw.getSouthWest(), ne = raw.getNorthEast()
    if (!sw || !ne || ![sw.lng, sw.lat, ne.lng, ne.lat].every(finite) ||
        Math.abs(sw.lng) > 180 || Math.abs(ne.lng) > 180 ||
        Math.abs(sw.lat) > 85 || Math.abs(ne.lat) > 85 ||
        ne.lat <= sw.lat) return null
    let span = ne.lng - sw.lng
    if (span < 0) span += 360
    if (span <= 0 || span >= 359.7) return null
    const area = xDriveBaiduConservativeOwnerQueryBounds(raw)
    const width = area.east > area.west
      ? area.east - area.west : 360 - (area.west - area.east)
    if (!Number.isFinite(width) || width <= 0 || width >= 359.7 ||
        area.north <= area.south ||
        (area.west === -180 && area.east === 180 &&
         area.south === -85 && area.north === 85)) return null
    return area
  } catch { return null }
}

/** Only expose a bounded "nearby" photo-wall action after a real zoom.
 * The padded envelope may include GPS photos outside the rendered BD09 area,
 * so it must not be called an exact Map Camera Range or authorized Cell count.
 */
export function xDriveBaiduPrototypeNearbyActionBounds(
  raw: Bounds | null | undefined, zoom: number,
): MediaPlacesViewportBounds | null {
  if (!Number.isFinite(zoom) || zoom < 15 || zoom > 21) return null
  const area = xDriveBaiduPrototypeCameraQueryBounds(raw)
  if (!area) return null
  const longitudeSpan = area.east > area.west
    ? area.east - area.west : 360 - (area.west - area.east)
  if (longitudeSpan <= 0 || longitudeSpan > 20 ||
      area.north - area.south <= 0 || area.north - area.south > 20) return null
  return area
}

/** Keep native, low-zoom world overview after a genuine user pan when the
 * Baidu camera spans the whole longitude circle. Unlike the old compatibility
 * helper, this never interprets a missing, throwing or malformed SDK camera
 * as permission to query the full Owner library. The result is display-only:
 * NOT an exact photo Wall/Viewer membership or a BD09->WGS84 conversion. */
export function xDriveBaiduPrototypeOverviewQueryBounds(
  raw: Bounds | null | undefined, zoom: number,
): MediaPlacesViewportBounds | null {
  if (!Number.isInteger(zoom) || zoom < 3 || zoom > 21) return null
  const bounded = xDriveBaiduPrototypeCameraQueryBounds(raw)
  if (bounded) return bounded
  if (zoom > 4 || !raw) return null
  try {
    const sw = raw.getSouthWest(), ne = raw.getNorthEast()
    if (!sw || !ne || ![sw.lng, sw.lat, ne.lng, ne.lat].every(finite) ||
        sw.lng !== -180 || ne.lng !== 180 ||
        sw.lat < -85 || ne.lat > 85 || ne.lat <= sw.lat) return null
    return { ...XDRIVE_BAIDU_WORLD_OVERVIEW }
  } catch { return null }
}
