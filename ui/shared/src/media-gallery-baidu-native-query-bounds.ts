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
