import type { MediaPlaceFacet } from './models'
import type { XDriveBaiduConvertedFeatureCollection } from './media-gallery-baidu-jsapi4-markers'

export const XDRIVE_BAIDU_CLUSTER_COVER_MAX = 12
const minimumSeparation = 74
const maximumSDKClusters = 128
const maximumSourceFeatures = 64

type Point = { lng: number; lat: number }
type Pixel = { x: number; y: number }
type MapProjection = { pointToPixel(point: Point): Pixel }
type Namespace = { Point: new (longitude: number, latitude: number) => Point }

export type XDriveBaiduClusterCover = Readonly<{
  id: string
  placeID: string
  nodeID: number
  placeCount: number
  photoCount: number
  name: string
  x: number
  y: number
}>

type Candidate = {
  id: string
  placeCount: number
  x: number
  y: number
  lng: number
  lat: number
  bbox: readonly [number, number, number, number]
  cover: MediaPlaceFacet | null
  distance: number
  matchedPoints: number
  matchedPhotos: number
  ambiguous: boolean
}

const safeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const safeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 2

function nativeCluster(raw: unknown): {
  bbox: [number, number, number, number]
  center: [number, number]
  count: number
  id: string
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.isCluster === false) return null
  const props = candidate.properties && typeof candidate.properties === 'object'
    ? candidate.properties as Record<string, unknown> : {}
  const count = candidate.pointCount ?? props.pointCount ?? props.point_count
  const bbox = candidate.bbox ?? props.bbox
  const geometry = candidate.geometry && typeof candidate.geometry === 'object'
    ? candidate.geometry as { type?: unknown; coordinates?: unknown } : null
  const point = candidate.point && typeof candidate.point === 'object'
    ? candidate.point as Point : null
  const center = point && safeNumber(point.lng) && safeNumber(point.lat)
    ? [point.lng, point.lat] : geometry?.type === 'Point' &&
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length === 2
      ? geometry.coordinates : null
  if (!safeCount(count) || !Array.isArray(bbox) || bbox.length !== 4 ||
      !bbox.every(safeNumber) || !Array.isArray(center) ||
      center.length !== 2 || !center.every(safeNumber)) return null
  const [west, south, east, north] = bbox
  if (Math.abs(west) > 180 || Math.abs(east) > 180 ||
      Math.abs(south) > 85 || Math.abs(north) > 85 ||
      south > north || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 85) return null
  const clusterId = candidate.clusterId ?? props.clusterId ?? props.cluster_id
  const id = (typeof clusterId === 'number' && Number.isSafeInteger(clusterId) &&
    clusterId >= 0 ? String(clusterId) : center.join(':')) + ':' + count
  return { bbox: [west, south, east, north],
    center: [center[0], center[1]], count, id }
}

function inside(lng: number, lat: number,
  [west, south, east, north]: readonly number[]): boolean {
  return lat >= south && lat <= north && (west <= east
    ? lng >= west && lng <= east
    : lng >= west || lng <= east)
}

/**
 * Read-only React cover overlay from official JSAPI4 ClusterLayer change
 * events. NEVER recalculate a cluster, its position or pointCount.
 * A photo is an authenticated Owner representative selected from source
 * BD09 features inside the SDK cluster bbox; without a bbox the native
 * bubble remains. No photo URL, Blob, Node ID or React DOM is sent to BMap.
 * pointCount is a count of GPS place features, NOT total photos.
 */
export function xDriveProjectBaiduNativeClusterCovers(
  change: unknown,
  collection: XDriveBaiduConvertedFeatureCollection,
  places: readonly MediaPlaceFacet[],
  map: MapProjection,
  namespace: Namespace,
  width: number,
  height: number,
): XDriveBaiduClusterCover[] {
  const frame = change && typeof change === 'object' && 'value' in change
    ? (change as { value: unknown }).value : change
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return []
  const value = frame as { zoom?: unknown; clusters?: unknown; singles?: unknown }
  if (!safeNumber(value.zoom) || value.zoom < 3 || value.zoom > 16 ||
      !Array.isArray(value.clusters) ||
      value.clusters.length > maximumSDKClusters ||
      !Array.isArray(value.singles) || value.singles.length > maximumSDKClusters ||
      !Array.isArray(collection?.features) ||
      collection.features.length > maximumSourceFeatures ||
      !Array.isArray(places) || !map ||
      typeof map.pointToPixel !== 'function' ||
      !namespace || typeof namespace.Point !== 'function' ||
      !safeNumber(width) || !safeNumber(height) ||
      width < 120 || height < 120) return []

  // Preserve ALL official bbox results for ambiguity checks, including
  // visually colliding/off-screen clusters that won't receive a cover.
  const sdkClusters = value.clusters.map(nativeCluster).filter(
    (data): data is NonNullable<ReturnType<typeof nativeCluster>> => data !== null,
  )
  const candidates: Candidate[] = []
  for (const data of sdkClusters) {
    let pixel: Pixel
    try {
      pixel = map.pointToPixel(
        new namespace.Point(data.center[0], data.center[1]))
    } catch { continue }
    if (!pixel || !safeNumber(pixel.x) || !safeNumber(pixel.y) ||
        pixel.x < 38 || pixel.x > width - 38 ||
        pixel.y < 75 || pixel.y > height - 12) continue
    const projected: Candidate = {
      id: data.id, x: pixel.x, y: pixel.y,
      bbox: data.bbox, placeCount: data.count,
      lng: data.center[0], lat: data.center[1],
      cover: null, distance: Infinity,
      matchedPoints: 0, matchedPhotos: 0, ambiguous: false,
    }
    const collision = candidates.findIndex(c =>
      Math.hypot(c.x - projected.x, c.y - projected.y) < minimumSeparation)
    if (collision !== -1) {
      if (projected.placeCount > candidates[collision].placeCount) {
        candidates[collision] = projected
      }
      continue
    }
    if (candidates.length < XDRIVE_BAIDU_CLUSTER_COVER_MAX) {
      candidates.push(projected)
      continue
    }
    let least = 0
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].placeCount < candidates[least].placeCount) least = i
    }
    if (projected.placeCount > candidates[least].placeCount) candidates[least] = projected
  }
  const validOwner = new Map<string, MediaPlaceFacet>()
  for (const place of places) {
    if (place && (/^place:-?\d+:-?\d+$/.test(place.id) ||
        (place.id.startsWith('map-region:') && place.id.length <= 200)) &&
        Number.isSafeInteger(place.cover_node_id) && place.cover_node_id! > 0 &&
        Number.isSafeInteger(place.item_count) && place.item_count > 0) {
      validOwner.set(place.id, place)
    }
  }
  // SDK clusters own membership/position. A bbox is only usable as a
  // trustworthy photo-count proof if EXACTLY pointCount current Owner
  // features lie in it and no feature overlaps two displayed clusters.
  // Otherwise keep the SDK's ordinary bubble; never substitute "N places"
  // for "N photos".
  const visited = new Set<string>()
  for (const feature of collection.features) {
    const id = feature?.properties?.place_id
    const coords = feature?.geometry?.coordinates
    if (typeof id !== 'string' || !Array.isArray(coords) ||
        coords.length !== 2 || !coords.every(safeNumber)) continue
    const membership = candidates.filter(candidate =>
      inside(coords[0], coords[1], candidate.bbox))
    if (!membership.length) continue
    // A hidden SDK cluster may still overlap this bbox. Never infer a true
    // member total merely because visible candidates happen to be disjoint.
    const nativeMatches = sdkClusters.filter(cluster =>
      inside(coords[0], coords[1], cluster.bbox)).length
    const place = validOwner.get(id)
    if (membership.length > 1 || nativeMatches !== 1 || visited.has(id) ||
        !place || place.item_count !== feature.properties.photo_count) {
      membership.forEach(candidate => { candidate.ambiguous = true })
      continue
    }
    visited.add(id)
    const candidate = membership[0]
    candidate.matchedPoints++
    candidate.matchedPhotos += place.item_count
    const distance = (coords[0] - candidate.lng) ** 2 +
      (coords[1] - candidate.lat) ** 2
    const old = candidate.cover
    if (!old || place.item_count > old.item_count ||
        (place.item_count === old.item_count &&
          (distance < candidate.distance ||
           (distance === candidate.distance && place.id < old.id)))) {
      candidate.cover = place
      candidate.distance = distance
    }
  }
  const projected: XDriveBaiduClusterCover[] = candidates
    .filter((c): c is Candidate & { cover: MediaPlaceFacet } =>
      c.cover !== null && !c.ambiguous && c.matchedPoints === c.placeCount &&
      Number.isSafeInteger(c.matchedPhotos) && c.matchedPhotos >= c.placeCount)
    .sort((a, b) => b.matchedPhotos - a.matchedPhotos || a.id.localeCompare(b.id))
    .map(c => ({
      id: c.id, placeID: c.cover.id,
      nodeID: c.cover.cover_node_id!, placeCount: c.placeCount,
      photoCount: c.matchedPhotos,
      name: c.cover.name, x: c.x, y: c.y,
    }))

  // Official ClusterLayer.change.singles are SDK-unclustered points. An
  // Owner-verified single region can represent many photos even at zoom 3.
  // Draw its real cover without calculating a cluster or changing the SDK hit
  // target. Only accept a point with exactly matching current GeoJSON and
  // Owner photo count; malformed/stale SDK data is ignored.
  const rendered = new Map(collection.features.map(feature =>
    [feature.properties.place_id, feature]))
  for (const item of value.singles) {
    if (projected.length >= XDRIVE_BAIDU_CLUSTER_COVER_MAX) break
    if (!item || typeof item !== 'object') continue
    const candidate = item as {
      properties?: { place_id?: unknown; photo_count?: unknown }
      geometry?: { type?: unknown; coordinates?: unknown }
    }
    const id = candidate.properties?.place_id
    const xy = candidate.geometry?.coordinates
    if (typeof id !== 'string' || !Array.isArray(xy) || xy.length !== 2 ||
        !xy.every(safeNumber)) continue
    const owner = validOwner.get(id)
    const original = rendered.get(id)
    const originalXY = original?.geometry.coordinates
    if (!owner || !original || owner.item_count !== candidate.properties?.photo_count ||
        original.properties.photo_count !== owner.item_count ||
        !Array.isArray(originalXY) ||
        Math.abs(originalXY[0] - xy[0]) > 1e-7 ||
        Math.abs(originalXY[1] - xy[1]) > 1e-7) continue
    let pixel: Pixel
    try { pixel = map.pointToPixel(new namespace.Point(xy[0], xy[1])) }
    catch { continue }
    if (!pixel || !safeNumber(pixel.x) || !safeNumber(pixel.y) ||
        pixel.x < 38 || pixel.x > width - 38 ||
        pixel.y < 75 || pixel.y > height - 12 ||
        projected.some(p => Math.hypot(p.x-pixel.x, p.y-pixel.y) < minimumSeparation)) continue
    projected.push({
      id: 'single:' + id, placeID: id,
      nodeID: owner.cover_node_id!, placeCount: 1, photoCount: owner.item_count,
      name: owner.name, x: pixel.x, y: pixel.y,
    })
  }
  return projected
}
