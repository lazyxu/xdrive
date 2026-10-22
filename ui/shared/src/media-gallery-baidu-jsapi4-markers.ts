import type { MediaPlacesViewportPage } from './models'

/**
 * A3b3a3a: inert, bounded data boundary for a FUTURE licensed Baidu JSAPI 4.0
 * ClusterLayer. No JSAPI load, AK access, network, or basemap rendering here.
 *
 * Source coordinates are the original photo's WGS84 sample pair, NEVER the
 * old 0.01-degree grid center. Only official Convertor may create BD-09 points.
 */
export const XDRIVE_BAIDU_JSAPI4_MAX_MARKER_CELLS = 100
export const XDRIVE_BAIDU_JSAPI4_CONVERSION_BATCH = 10
const conversionTimeoutMs = 3000

export type XDriveBaiduWGS84Marker = {
  placeID: string
  latitude: number
  longitude: number
  photoCount: number
}

export type XDriveBaiduMarkerPreparation =
  | { kind: 'ready'; markers: XDriveBaiduWGS84Marker[]; totalPhotoCount: number }
  | { kind: 'incomplete'; totalCells: number; totalPhotoCount: number }
  | { kind: 'invalid' | 'out-of-map-range' | 'cancelled' }

function safeCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
}

/** Only canonical A1 IDs; an ID is never a photo coordinate. */
function canonicalPlaceID(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false
  const match = /^place:(-?(?:0|[1-9]\d*)):(-?(?:0|[1-9]\d*))$/.exec(value)
  if (!match) return false
  const latCell = Number(match[1])
  const lonCell = Number(match[2])
  return Number.isSafeInteger(latCell) && latCell >= -9000 && latCell <= 9000 &&
    Number.isSafeInteger(lonCell) && lonCell >= -18000 && lonCell <= 18000 &&
    value === 'place:' + latCell + ':' + lonCell
}


// The bounded prototype may feed an 8x8 *Server-originated* WGS84
// region sample into official BMap.Convertor. Strict A1 place paging remains
// canonicalPlaceID-only; this never authorizes a new Owner API selection.
function boundedPrototypeRegionMarker(marker: XDriveBaiduWGS84Marker): boolean {
  if (typeof marker.placeID !== 'string' || marker.placeID.length > 180) return false
  // Legacy fixed-grid IDs are still accepted, including old deep links.
  // q: means an Owner-authenticated *coordinate-rank* cell, not a geometric
  // 8x8 rectangle: only the server knows membership; never use it as a
  // Media Range identity or attempt to reconstruct members in JavaScript.
  const parts = /^map-region:(q:)?(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?):([0-7]):([0-7])$/.exec(marker.placeID)
  if (!parts) return false
  const quantile = parts[1] === 'q:'
  const west=Number(parts[2]), south=Number(parts[3])
  const east=Number(parts[4]), north=Number(parts[5])
  const row=Number(parts[6]), col=Number(parts[7])
  const longitude=marker.longitude, latitude=marker.latitude
  if (![west,south,east,north,longitude,latitude].every(Number.isFinite) ||
      west < -180 || west > 180 || east < -180 || east > 180 ||
      south < -85 || north > 85 || south >= north ||
      west === east || (west === 180 && east === -180) ||
      latitude < south || latitude > north) return false
  const lonSpan = west < east ? east-west : 360-(west-east)
  const adjusted = west > east && longitude < west ? longitude+360 : longitude
  if (adjusted < west || adjusted > west+lonSpan) return false
  if (quantile) return true
  const mappedRow = Math.min(7,Math.max(0,Math.floor((latitude-south)/(north-south)*8)))
  const mappedCol = Math.min(7,Math.max(0,Math.floor((adjusted-west)/lonSpan*8)))
  return mappedRow === row && mappedCol === col
}

/** A paginated/top-N viewport must not masquerade as a complete ClusterLayer. */
export function xDrivePrepareBaiduJSAPI4MarkerWindow(
  page: MediaPlacesViewportPage,
  signal?: AbortSignal,
): XDriveBaiduMarkerPreparation {
  if (signal?.aborted) return { kind: 'cancelled' }
  if (!page || typeof page !== 'object' || !Array.isArray(page.items) ||
      page.items.length > XDRIVE_BAIDU_JSAPI4_MAX_MARKER_CELLS ||
      !safeCount(page.total_count) || !safeCount(page.total_photo_count) ||
      !safeCount(page.offset) || !safeCount(page.limit) ||
      page.limit < 1 || page.limit > XDRIVE_BAIDU_JSAPI4_MAX_MARKER_CELLS ||
      page.items.length > page.limit || typeof page.has_more !== 'boolean') return { kind: 'invalid' }

  // A 100k-cell dataset is O(100) here: require a narrower Server viewport,
  // never fetch the entire library or invent cluster counts from a sample.
  if (page.total_count > XDRIVE_BAIDU_JSAPI4_MAX_MARKER_CELLS ||
      page.offset !== 0 || page.has_more || page.items.length !== page.total_count) {
    return { kind: 'incomplete', totalCells: page.total_count,
      totalPhotoCount: page.total_photo_count }
  }

  const markers: XDriveBaiduWGS84Marker[] = []
  const seen = new Set<string>()
  let sum = 0
  for (const item of page.items) {
    if (signal?.aborted) return { kind: 'cancelled' }
    if (!item || !canonicalPlaceID(item.id) || seen.has(item.id) ||
        item.coordinate_kind !== 'grid_cell_center' ||
        typeof item.sample_latitude !== 'number' ||
        typeof item.sample_longitude !== 'number' ||
        !Number.isFinite(item.sample_latitude) || !Number.isFinite(item.sample_longitude) ||
        Math.abs(item.sample_latitude) > 90 || Math.abs(item.sample_longitude) > 180 ||
        !safeCount(item.item_count) || item.item_count < 1 ||
        !Number.isSafeInteger(sum + item.item_count)) {
      return { kind: 'invalid' }
    }
    // The sample point must actually belong to its own Server grid cell.
    // Never render mismatched place IDs/real GPS as if they were trustworthy.
    const cell = item.id.split(':')
    const latCell = Number(cell[1])
    const lonCell = Number(cell[2])
    // Preserve source-vs-PostgreSQL floating-point boundary differences.
    // The tolerance is far smaller than a 0.01-degree cell.
    const epsilon = 1e-10
    const inCell = (coordinate: number, index: number) =>
      coordinate >= index / 100 - epsilon && coordinate <= (index + 1) / 100 + epsilon
    if (!inCell(item.sample_latitude, latCell) ||
        !inCell(item.sample_longitude, lonCell)) {
      return { kind: 'invalid' }
    }
    // Legal poles stay valid GPS. This Baidu rendering mode cannot show them.
    if (Math.abs(item.sample_latitude) > 85) return { kind: 'out-of-map-range' }
    seen.add(item.id)
    sum += item.item_count
    markers.push({ placeID: item.id, latitude: item.sample_latitude,
      longitude: item.sample_longitude, photoCount: item.item_count })
  }
  if (sum !== page.total_photo_count) return { kind: 'invalid' }
  return { kind: 'ready', markers, totalPhotoCount: sum }
}

export interface XDriveBaiduOfficialPoint {
  lng: number
  lat: number
}

/** Injection of the official JSAPI4 BMap.Convertor, never a local algorithm. */
export interface XDriveBaiduOfficialConvertor {
  translate(
    points: XDriveBaiduOfficialPoint[],
    from: 1, to: 5,
    callback: (result: unknown) => void,
  ): void
}

export interface XDriveBaiduConvertedFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    id: string
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { place_id: string; photo_count: number }
  }>
}

function convertedPointsValid(value: unknown, expectedLength: number): value is {
  status: 0
  points: XDriveBaiduOfficialPoint[]
} {
  if (!value || typeof value !== 'object') return false
  const result = value as { status?: unknown; points?: unknown }
  return result.status === 0 && Array.isArray(result.points) &&
    result.points.length === expectedLength && result.points.every(point => (
      !!point && typeof point.lng === 'number' && typeof point.lat === 'number' &&
      Number.isFinite(point.lng) && Number.isFinite(point.lat) &&
      Math.abs(point.lng) <= 180 && Math.abs(point.lat) <= 85
    ))
}

function officialTranslate(
  convertor: XDriveBaiduOfficialConvertor,
  points: XDriveBaiduOfficialPoint[],
  signal?: AbortSignal,
): Promise<XDriveBaiduOfficialPoint[]> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error: Error | null, converted?: XDriveBaiduOfficialPoint[]) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(converted ?? [])
    }
    const onAbort = () => finish(new Error('baidu_map_conversion_cancelled'))
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish(new Error('baidu_map_conversion_unavailable')),
      conversionTimeoutMs)
    try {
      // 1 = WGS84 GPS, 5 = official Baidu BD-09. Never approximate locally.
      convertor.translate(points, 1, 5, result => {
        if (!convertedPointsValid(result, points.length)) {
          finish(new Error('baidu_map_conversion_unavailable'))
          return
        }
        finish(null, result.points.map(p => ({ lng: p.lng, lat: p.lat })))
      })
    } catch {
      finish(new Error('baidu_map_conversion_unavailable'))
    }
  })
}

/** Fail closed: ONLY official successful BD-09 points may enter a FUTURE
 * licensed ClusterLayer.setData(). This function has NO active UI caller. */
export async function xDriveConvertBaiduJSAPI4MarkerWindow(
  prepared: XDriveBaiduMarkerPreparation,
  convertor: XDriveBaiduOfficialConvertor,
  createPoint: (lng: number, lat: number) => XDriveBaiduOfficialPoint,
  signal?: AbortSignal,
): Promise<XDriveBaiduConvertedFeatureCollection> {
  if (prepared.kind !== 'ready' || !Array.isArray(prepared.markers) ||
      prepared.markers.length > XDRIVE_BAIDU_JSAPI4_MAX_MARKER_CELLS ||
      !safeCount(prepared.totalPhotoCount) || !convertor ||
      typeof convertor.translate !== 'function' || typeof createPoint !== 'function' ||
      signal?.aborted) throw new Error('baidu_map_markers_unavailable')
  let sum = 0
  const seen = new Set<string>()
  for (const item of prepared.markers) {
    if (!item || !(canonicalPlaceID(item.placeID) || boundedPrototypeRegionMarker(item)) ||
        seen.has(item.placeID) ||
        !Number.isFinite(item.latitude) || Math.abs(item.latitude) > 85 ||
        !Number.isFinite(item.longitude) || Math.abs(item.longitude) > 180 ||
        !safeCount(item.photoCount) || item.photoCount === 0 ||
        !Number.isSafeInteger(sum + item.photoCount)) {
      throw new Error('baidu_map_markers_unavailable')
    }
    seen.add(item.placeID)
    sum += item.photoCount
  }
  if (sum !== prepared.totalPhotoCount) throw new Error('baidu_map_markers_unavailable')

  const features: XDriveBaiduConvertedFeatureCollection['features'] = []
  for (let offset = 0; offset < prepared.markers.length;
    offset += XDRIVE_BAIDU_JSAPI4_CONVERSION_BATCH) {
    if (signal?.aborted) throw new Error('baidu_map_conversion_cancelled')
    const batch = prepared.markers.slice(offset, offset + XDRIVE_BAIDU_JSAPI4_CONVERSION_BATCH)
    let input: XDriveBaiduOfficialPoint[]
    try {
      input = batch.map(item => createPoint(item.longitude, item.latitude))
      if (!input.every((p, i) => p && Number.isFinite(p.lng) && Number.isFinite(p.lat) &&
        p.lng === batch[i].longitude && p.lat === batch[i].latitude)) {
        throw new Error('invalid_point')
      }
    } catch {
      throw new Error('baidu_map_conversion_unavailable')
    }
    const converted = await officialTranslate(convertor, input, signal)
    if (signal?.aborted) throw new Error('baidu_map_conversion_cancelled')
    batch.forEach((item, i) => {
      features.push({ type: 'Feature', id: item.placeID,
        geometry: { type: 'Point', coordinates: [converted[i].lng, converted[i].lat] },
        properties: { place_id: item.placeID, photo_count: item.photoCount } })
    })
  }
  return { type: 'FeatureCollection', features }
}
