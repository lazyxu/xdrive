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
    // Abort cannot retract a request already sent to Baidu. Keep the physical
    // conversion slot occupied until its callback or timeout, even if the
    // Gallery has navigated away and no longer accepts its result.
    let dispatched = false
    let cancelled = false
    const onAbort = () => {
      cancelled = true
      if (!dispatched) finish(new Error('baidu_map_conversion_cancelled'))
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish(new Error('baidu_map_conversion_timeout')),
      conversionTimeoutMs)
    try {
      // 1 = WGS84 GPS, 5 = official Baidu BD-09. Never approximate locally.
      dispatched = true
      convertor.translate(points, 1, 5, result => {
        if (cancelled || signal?.aborted) {
          finish(new Error('baidu_map_conversion_cancelled'))
        } else if (!convertedPointsValid(result, points.length)) {
          finish(new Error('baidu_map_conversion_unavailable'))
        } else {
          finish(null, result.points.map(p => ({ lng: p.lng, lat: p.lat })))
        }
      })
    } catch {
      finish(new Error('baidu_map_conversion_unavailable'))
    }
  })
}


/**
 * Browser-document/session-only derived-coordinate cache and Convertor gate.
 * No durable browser storage, cookie, raw-GPS log or persisted Baidu result.
 * One active scope (Owner/server) at a time; caller clears it on sign-out.
 *
 * The gate controls method invocations, NOT Baidu's account-wide QPS or the
 * underlying SDK's internal subrequests. No quota refund is assumed.
 */
export type XDriveBaiduConversionAudit = Readonly<{
  entry: 'places-prototype'
  anonymous_session: string
  cache_hit_rate_percent: number
  method_calls: number
  submitted_points: number
  converted_points: number
  peak_method_calls_per_second: number
  cache_hits: number
  cache_misses: number
  cancelled: number
  failed: number
  cache_entries: number
  in_flight: number
}>

function baiduConversionMonotonicMs(): number {
  // Wall clock jumps must never reduce the actual method-call interval.
  return typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now() : Date.now()
}

function ephemeralBaiduAuditSession(): string {
  // Displayable opaque identifier only; never used for auth, signing or quota.
  // Unsupported runtimes keep telemetry local and without a stable ID.
  try {
    return typeof crypto === 'object' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : ''
  } catch { return '' }
}

export class XDriveBaiduJSAPI4ConversionSession {
  private scope = ''
  private anonymousSession = ephemeralBaiduAuditSession()
  private epoch = 0
  private sourceRevision = 0
  private readonly cache = new Map<string, XDriveBaiduOfficialPoint>()
  private readonly sources = new Map<string, string>()
  private tail: Promise<void> = Promise.resolve()
  private queueDepth = 0
  private lastDispatch = -Infinity
  private second = -1
  private callsThisSecond = 0
  private poisoned = false
  private inFlight = 0
  private methodCalls = 0
  private submittedPoints = 0
  private convertedPoints = 0
  private peak = 0
  private hits = 0
  private misses = 0
  private cancelled = 0
  private failed = 0

  constructor(private readonly capacity = 512) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024) {
      throw new Error('baidu_map_conversion_capacity_invalid')
    }
  }

  useScope(scope: string): this {
    if (!scope || scope.length > 256) {
      this.clear()
      return this
    }
    if (scope !== this.scope) {
      this.clear()
      this.scope = scope
    }
    return this
  }

  clear(): void {
    this.epoch++
    this.scope = ''
    this.anonymousSession = ephemeralBaiduAuditSession()
    this.cache.clear()
    this.sources.clear()
    this.methodCalls = this.submittedPoints = this.convertedPoints = this.peak = 0
    this.hits = this.misses = this.cancelled = this.failed = 0
    // Retain the scheduler's last dispatch and any unknown in-flight status;
    // a logout must not accidentally make another Baidu call simultaneous.
  }

  private key(p: XDriveBaiduOfficialPoint): string {
    return p.lat.toString() + ':' + p.lng.toString()
  }

  observeSource(marker: XDriveBaiduWGS84Marker): void {
    const key = this.key({ lng: marker.longitude, lat: marker.latitude })
    const old = this.sources.get(marker.placeID)
    if (old && old !== key) {
      this.cache.delete(old)
      // A translation already dispatched for the old point must NEVER
      // reinsert it after this source changes. Invalidate queued/in-flight
      // translation generations without assuming provider request refunds.
      this.sourceRevision++
    }
    this.sources.delete(marker.placeID)
    this.sources.set(marker.placeID, key)
    if (this.sources.size > 1024) {
      const first = this.sources.keys().next().value
      if (first !== undefined) this.sources.delete(first)
    }
  }

  private read(key: string): XDriveBaiduOfficialPoint | undefined {
    const value = this.cache.get(key)
    if (!value) { this.misses++; return undefined }
    this.hits++
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  private write(key: string, value: XDriveBaiduOfficialPoint): void {
    this.cache.delete(key)
    this.cache.set(key, { lng: value.lng, lat: value.lat })
    if (this.cache.size > this.capacity) {
      const first = this.cache.keys().next().value
      if (first !== undefined) this.cache.delete(first)
    }
  }

  audit(): XDriveBaiduConversionAudit {
    return {
      entry:'places-prototype', anonymous_session:this.anonymousSession,
      cache_hit_rate_percent:this.hits + this.misses === 0
        ? 0 : Math.round(10000 * this.hits / (this.hits + this.misses)) / 100,
      method_calls:this.methodCalls,
      submitted_points:this.submittedPoints,
      converted_points:this.convertedPoints,
      peak_method_calls_per_second:this.peak,
      cache_hits:this.hits, cache_misses:this.misses,
      cancelled:this.cancelled, failed:this.failed,
      cache_entries:this.cache.size, in_flight:this.inFlight,
    }
  }

  async translate(
    convertor: XDriveBaiduOfficialConvertor,
    points: XDriveBaiduOfficialPoint[],
    signal?: AbortSignal,
  ): Promise<XDriveBaiduOfficialPoint[]> {
    if (signal?.aborted) throw new Error('baidu_map_conversion_cancelled')
    if (!Array.isArray(points) || points.length < 1 ||
        points.length > XDRIVE_BAIDU_JSAPI4_CONVERSION_BATCH ||
        !points.every(p => p && Number.isFinite(p.lng) && Number.isFinite(p.lat) &&
          Math.abs(p.lng) <= 180 && Math.abs(p.lat) <= 85)) {
      throw new Error('baidu_map_conversion_unavailable')
    }
    if (this.queueDepth >= 16) throw new Error('baidu_map_conversion_queue_full')
    this.queueDepth++
    const epoch = this.epoch
    const sourceRevision = this.sourceRevision
    // Re-check the cache *inside* the gate: competing viewport updates must
    // not each charge the same source point while waiting their turn.
    const job = this.tail.then(async () => {
      const check = () => {
        if (signal?.aborted || epoch !== this.epoch ||
            sourceRevision !== this.sourceRevision) {
          throw new Error('baidu_map_conversion_cancelled')
        }
      }
      try {
        check()
        const keys = points.map(p => this.key(p))
        const answers = keys.map(key => this.read(key))
        const unseen = new Map<string, XDriveBaiduOfficialPoint>()
        keys.forEach((key, i) => {
          if (!answers[i] && !unseen.has(key)) unseen.set(key, points[i])
        })
        if (unseen.size) {
          if (this.poisoned) throw new Error('baidu_map_conversion_unavailable')
          const delay = Math.max(0, 1000 - (baiduConversionMonotonicMs() - this.lastDispatch))
          if (delay) {
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                clearTimeout(timer)
                reject(new Error('baidu_map_conversion_cancelled'))
              }
              const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort)
                resolve()
              }, delay)
              if (signal?.aborted) onAbort()
              else signal?.addEventListener('abort', onAbort, { once: true })
            })
          }
          check()
          const missing = [...unseen.entries()]
          this.lastDispatch = baiduConversionMonotonicMs()
          const second = Math.floor(Date.now() / 1000)
          this.callsThisSecond = this.second === second
            ? this.callsThisSecond + 1 : 1
          this.second = second
          this.peak = Math.max(this.peak, this.callsThisSecond)
          this.methodCalls++
          this.submittedPoints += missing.length
          this.inFlight++
          try {
            const result = await officialTranslate(convertor,
              missing.map(([,p]) => p), signal)
            check()
            this.convertedPoints += result.length
            result.forEach((value, i) => this.write(missing[i][0], value))
          } catch (error) {
            // SDK timeout does NOT prove its provider request has ended:
            // fail closed for the remainder of this document session.
            if (error instanceof Error && error.message === 'baidu_map_conversion_timeout') {
              this.poisoned = true
            }
            throw error
          } finally { this.inFlight-- }
        }
        check()
        return keys.map(key => {
          const value = this.cache.get(key)
          if (!value) throw new Error('baidu_map_conversion_unavailable')
          return { lng:value.lng, lat:value.lat }
        })
      } catch (error) {
        if (epoch === this.epoch) {
          if (signal?.aborted || sourceRevision !== this.sourceRevision ||
              (error instanceof Error && error.message === 'baidu_map_conversion_cancelled')) {
            this.cancelled++
          } else this.failed++
        }
        // Never attribute an old Owner's late rejection to the new anonymous
        // audit session created after a scope switch or logout.
        throw error
      }
    })
    this.tail = job.then(() => {}, () => {})
    try { return await job }
    finally { this.queueDepth-- }
  }
}

// A single browser-document gate, shared by all Gallery remounts. The owning
// Web/Desktop auth lifecycle clears it immediately on logout/server switch.
const sharedConversionSession = new XDriveBaiduJSAPI4ConversionSession()
export function xDriveBaiduConversionSessionForScope(
  scope: string,
): XDriveBaiduJSAPI4ConversionSession {
  return sharedConversionSession.useScope(scope)
}
export function xDriveClearBaiduConversionSession(): void {
  sharedConversionSession.clear()
}
export function xDriveBaiduConversionAuditSnapshot(): XDriveBaiduConversionAudit {
  return sharedConversionSession.audit()
}

/** Only official successful BD-09 points may enter the legacy active
 * browser prototype's ClusterLayer. The isolated HTTPS Child instead uses
 * Server-authorized BD09 cells without running this Convertor. */
export async function xDriveConvertBaiduJSAPI4MarkerWindow(
  prepared: XDriveBaiduMarkerPreparation,
  convertor: XDriveBaiduOfficialConvertor,
  createPoint: (lng: number, lat: number) => XDriveBaiduOfficialPoint,
  signal?: AbortSignal,
  // Only the owning Gallery explicitly supplies a document-scoped shared session.
  // Other callers (including the inert legacy Controller) must not inherit
  // an unscoped cache across unrelated Owner sessions or test fixtures.
  session: XDriveBaiduJSAPI4ConversionSession = new XDriveBaiduJSAPI4ConversionSession(),
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
  for (const marker of prepared.markers) session.observeSource(marker)

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
    const converted = await session.translate(convertor, input, signal)
    if (signal?.aborted) throw new Error('baidu_map_conversion_cancelled')
    batch.forEach((item, i) => {
      features.push({ type: 'Feature', id: item.placeID,
        geometry: { type: 'Point', coordinates: [converted[i].lng, converted[i].lat] },
        properties: { place_id: item.placeID, photo_count: item.photoCount } })
    })
  }
  return { type: 'FeatureCollection', features }
}
