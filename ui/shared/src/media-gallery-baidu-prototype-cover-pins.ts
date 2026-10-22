import type { MediaPlaceFacet } from './models'
import type { XDriveBaiduConvertedFeatureCollection } from './media-gallery-baidu-jsapi4-markers'

export const XDRIVE_BAIDU_PROTOTYPE_COVER_MIN_ZOOM = 17
export const XDRIVE_BAIDU_PROTOTYPE_COVER_MAX = 16
const candidateLimit = 96
const minimumSeparation = 74

type Point = { lng: number; lat: number }
type Pixel = { x: number; y: number }
type Bounds = { getSouthWest(): Point; getNorthEast(): Point }
type MapProjection = {
  getZoom(): number
  pointToPixel(point: Point): Pixel
  getBounds?(): Bounds
}
type Namespace = { Point: new (lng: number, lat: number) => Point }

export type XDriveBaiduPrototypeCoverPin = {
  placeID: string
  nodeID: number
  photoCount: number
  name: string
  x: number
  y: number
}

function validPlace(place: MediaPlaceFacet): boolean {
  return !!place && /^place:-?\d+:-?\d+$/.test(place.id) &&
    Number.isSafeInteger(place.cover_node_id) && place.cover_node_id! > 0 &&
    Number.isSafeInteger(place.item_count) && place.item_count > 0
}

function insideBounds(point: [number, number], bounds: Bounds | undefined): boolean {
  if (!bounds) return true
  const a = bounds.getSouthWest(), b = bounds.getNorthEast()
  if (![a?.lng, a?.lat, b?.lng, b?.lat].every(Number.isFinite)) return true
  const [lng, lat] = point
  if (lat < a.lat || lat > b.lat) return false
  return a.lng <= b.lng
    ? lng >= a.lng && lng <= b.lng
    : lng >= a.lng || lng <= b.lng
}

function higherPriority(
  a: XDriveBaiduPrototypeCoverPin, b: XDriveBaiduPrototypeCoverPin,
): number {
  return b.photoCount - a.photoCount || a.placeID.localeCompare(b.placeID)
}

/**
 * BMap itself owns projection. A small, collision-free set of trusted React
 * thumbnails is placed only after zoom 16, when ClusterLayer stops clustering.
 *
 * No thumbnail URL, image Blob, Owner auth or original WGS84 coordinate is
 * added to the third-party GeoJSON, SDK, or a persisted camera snapshot.
 */
export function xDriveProjectBaiduPrototypeCoverPins(
  collection: XDriveBaiduConvertedFeatureCollection,
  places: readonly MediaPlaceFacet[],
  map: MapProjection,
  namespace: Namespace,
  width: number,
  height: number,
): XDriveBaiduPrototypeCoverPin[] {
  if (!collection || collection.type !== 'FeatureCollection' ||
      !Array.isArray(collection.features) || !Array.isArray(places) ||
      !map || typeof map.getZoom !== 'function' ||
      typeof map.pointToPixel !== 'function' ||
      !namespace || typeof namespace.Point !== 'function' ||
      !Number.isFinite(width) || !Number.isFinite(height) ||
      width < 120 || height < 120 ||
      !(map.getZoom() >= XDRIVE_BAIDU_PROTOTYPE_COVER_MIN_ZOOM)) return []

  const approved = new Map<string, MediaPlaceFacet>()
  for (const place of places) {
    if (validPlace(place) && !approved.has(place.id)) approved.set(place.id, place)
  }
  let bounds: Bounds | undefined
  try { bounds = map.getBounds?.() } catch { /* no optional prefilter */ }

  // Bounded top-N without sorting/allocating the complete 100k media index.
  const candidates: XDriveBaiduPrototypeCoverPin[] = []
  const seen = new Set<string>()
  for (const feature of collection.features) {
    const id = feature?.properties?.place_id
    const coordinates = feature?.geometry?.coordinates
    if (typeof id !== 'string' || seen.has(id) ||
        !Array.isArray(coordinates) || coordinates.length !== 2 ||
        !coordinates.every(Number.isFinite)) continue
    seen.add(id)
    const place = approved.get(id)
    if (!place || feature.properties.photo_count !== place.item_count ||
        !insideBounds(coordinates, bounds)) continue
    let pixel: Pixel
    try {
      pixel = map.pointToPixel(new namespace.Point(coordinates[0], coordinates[1]))
    } catch { continue }
    if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y) ||
        pixel.x < 35 || pixel.x > width - 35 ||
        pixel.y < 76 || pixel.y > height - 12) continue

    const pin: XDriveBaiduPrototypeCoverPin = {
      placeID: id, nodeID: place.cover_node_id!,
      photoCount: place.item_count, name: place.name,
      x: pixel.x, y: pixel.y,
    }
    // De-duplicate nearby candidates BEFORE top-N selection. Otherwise a
    // dense, high-count city can consume every candidate slot and hide
    // geographically separate photos elsewhere in the same viewport.
    const overlap = candidates.findIndex(existing =>
      Math.hypot(existing.x - pin.x, existing.y - pin.y) < minimumSeparation)
    if (overlap !== -1) {
      if (higherPriority(pin, candidates[overlap]) < 0) candidates[overlap] = pin
      continue
    }
    if (candidates.length < candidateLimit) {
      candidates.push(pin)
      continue
    }
    // Retain only the highest-count separated candidates. Stable by place ID.
    let worst = 0
    for (let i = 1; i < candidates.length; i++) {
      if (higherPriority(candidates[i], candidates[worst]) > 0) worst = i
    }
    if (higherPriority(pin, candidates[worst]) < 0) candidates[worst] = pin
  }

  const pins: XDriveBaiduPrototypeCoverPin[] = []
  for (const item of candidates.sort(higherPriority)) {
    if (pins.length >= XDRIVE_BAIDU_PROTOTYPE_COVER_MAX) break
    if (pins.some(p => Math.hypot(p.x - item.x, p.y - item.y) < minimumSeparation)) continue
    pins.push(item)
  }
  return pins
}
