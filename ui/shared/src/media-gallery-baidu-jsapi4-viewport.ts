import type {
  MediaPlaceFacet, MediaPlacesViewportBounds, MediaPlacesViewportPage,
} from './models'
import {
  XDriveBaiduJSAPI4ClusterController,
} from './media-gallery-baidu-jsapi4-layer'
import type {
  XDriveBaiduJSAPI4AuthorizedRuntimePort,
  XDriveBaiduJSAPI4LayerResult,
} from './media-gallery-baidu-jsapi4-layer'

/**
 * A3b3a3c — ONE shared Web/Mobile Web/Desktop bounded Owner-viewport
 * coordinator for a FUTURE, independently licensed JSAPI4 renderer.
 *
 * There is no production caller, BMap loader, browser AK, map Cookie, generic
 * proxy or change to the Server's permanently closed release policy here.
 *
 * The map operates on Baidu BD-09; the Owner viewport API requires WGS84.
 * The future reviewed provider adapter must independently supply an accurate
 * WGS84 envelope. Never forward native BD-09 coordinates as WGS84.
 */
export type XDriveBaiduJSAPI4ViewportResult =
  | XDriveBaiduJSAPI4LayerResult
  | { kind: 'invalid-bounds' | 'query-unavailable' | 'cancelled' }

export type XDriveBaiduJSAPI4OwnerListViewport = (
  bounds: MediaPlacesViewportBounds,
  limit: number,
  offset: number,
  signal: AbortSignal,
) => Promise<MediaPlacesViewportPage>

/** This tag is a coordinate-contract assertion, NOT legal permission, cryptographic
 * provenance, or evidence that BD-09 coordinates were transformed into GPS.
 * A future reviewed adapter must supply truly original photo WGS84 bounds,
 * never relabel the native Baidu BD-09 viewport result. */
export type XDriveBaiduJSAPI4PhotoWGS84Window = {
  coordinate_space: 'photo-wgs84'
  bounds: MediaPlacesViewportBounds
}

export type XDriveBaiduJSAPI4TrustedWGS84Bounds = (
  signal: AbortSignal,
) => Promise<XDriveBaiduJSAPI4PhotoWGS84Window>

export interface XDriveBaiduJSAPI4ViewportCallbacks {
  /** Original shared Gallery's onOpenPlace -> Range/VirtualCollection/Viewer. */
  onOpenPlace(place: MediaPlaceFacet): void
  /** Render an error/zoom-more state, never a fabricated full cluster. */
  onResult?(result: XDriveBaiduJSAPI4ViewportResult): void
}

const requestTimeoutMs = 8000
const maxViewportCells = 100

/** A provider promise may ignore its signal. Still settle promptly on
 * cancellation/timeout, and ignore its eventual stale success/rejection. */
function awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('baidu_jsapi4_viewport_cancelled'))
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const done = (value: T | Error, failed: boolean) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (failed) reject(value)
      else resolve(value as T)
    }
    const onAbort = () => done(new Error('baidu_jsapi4_viewport_cancelled'), true)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(value => done(value, false), () =>
      done(new Error('baidu_jsapi4_viewport_unavailable'), true))
  })
}

/** Validate independently even if the future adapter has TS types. */
export function xDriveValidJSAPI4WGS84Bounds(value: unknown): value is XDriveBaiduJSAPI4PhotoWGS84Window {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  const outer = Object.keys(envelope)
  if (outer.length !== 2 || !outer.includes('coordinate_space') ||
      !outer.includes('bounds') || envelope.coordinate_space !== 'photo-wgs84' ||
      !envelope.bounds || typeof envelope.bounds !== 'object' ||
      Array.isArray(envelope.bounds)) return false
  const v = envelope.bounds as Record<string, unknown>
  const fields = Object.keys(v)
  if (fields.length !== 4 ||
      fields.some(key => !['west', 'south', 'east', 'north'].includes(key))) return false
  const { west, south, east, north } = v
  if (![west, south, east, north].every(x => typeof x === 'number' && Number.isFinite(x))) {
    return false
  }
  const w = west as number, s = south as number, e = east as number, n = north as number
  return w >= -180 && w <= 180 && e >= -180 && e <= 180 &&
    s >= -90 && n <= 90 && s < n && w !== e && !(w === 180 && e === -180)
}

export class XDriveBaiduJSAPI4OwnerViewportBridge {
  readonly native: XDriveBaiduJSAPI4ClusterController
  private generation = 0
  private request: AbortController | null = null
  private disposed = false

  /** Capture move start before any new Server response can be applied. */
  private readonly onViewportStarted = () => {
    if (this.disposed) return
    this.cancel()
  }

  constructor(
    runtime: XDriveBaiduJSAPI4AuthorizedRuntimePort,
    private readonly listOwnerViewport: XDriveBaiduJSAPI4OwnerListViewport,
    private readonly trustedWGS84Bounds: XDriveBaiduJSAPI4TrustedWGS84Bounds,
    private readonly callbacks: XDriveBaiduJSAPI4ViewportCallbacks,
  ) {
    if (!runtime || !runtime.map || typeof listOwnerViewport !== 'function' ||
        typeof trustedWGS84Bounds !== 'function' || !callbacks ||
        typeof callbacks.onOpenPlace !== 'function') {
      throw new Error('baidu_jsapi4_viewport_unavailable')
    }
    this.native = new XDriveBaiduJSAPI4ClusterController(runtime, {
      onOpenPlace: (place) => {
        if (!this.disposed) callbacks.onOpenPlace(place)
      },
      onViewportInvalidated: () => { void this.refresh() },
    })
    try {
      runtime.map.addEventListener('movestart', this.onViewportStarted)
      runtime.map.addEventListener('zoomstart', this.onViewportStarted)
    } catch {
      this.native.dispose()
      throw new Error('baidu_jsapi4_viewport_unavailable')
    }
    this.map = runtime.map
  }

  private readonly map: XDriveBaiduJSAPI4AuthorizedRuntimePort['map']

  /** Immediate abort of a transient Map/Server query, never durable transfers. */
  cancel(): void {
    this.generation++
    this.request?.abort()
    this.request = null
    this.native.invalidate()
  }

  async refresh(): Promise<XDriveBaiduJSAPI4ViewportResult> {
    if (this.disposed) return { kind: 'query-unavailable' }
    this.cancel()
    const generation = this.generation
    const request = new AbortController()
    this.request = request
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      timer = setTimeout(() => request.abort(), requestTimeoutMs)
      const envelope = await awaitAbortable(this.trustedWGS84Bounds(request.signal), request.signal)
      if (this.disposed || request.signal.aborted || this.generation !== generation) {
        return { kind: 'cancelled' }
      }
      if (!xDriveValidJSAPI4WGS84Bounds(envelope)) {
        const failed: XDriveBaiduJSAPI4ViewportResult = { kind: 'invalid-bounds' }
        this.deliver(failed, generation)
        return failed
      }
      const bounds = envelope.bounds
      // Read no more than one 100-cell page: Server supplies exact counts;
      // native ClusterLayer can only display a COMPLETE current viewport.
      const page = await awaitAbortable(
        this.listOwnerViewport(bounds, maxViewportCells, 0, request.signal), request.signal,
      )
      if (this.disposed || request.signal.aborted || this.generation !== generation) {
        return { kind: 'cancelled' }
      }
      const result = await this.native.applyAuthorizedViewport(page, request.signal)
      if (this.disposed || request.signal.aborted || this.generation !== generation) {
        return { kind: 'cancelled' }
      }
      this.deliver(result, generation)
      return result
    } catch {
      if (this.disposed || request.signal.aborted || this.generation !== generation) {
        return { kind: 'cancelled' }
      }
      const failed: XDriveBaiduJSAPI4ViewportResult = { kind: 'query-unavailable' }
      this.deliver(failed, generation)
      return failed
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (this.request === request) this.request = null
    }
  }

  private deliver(result: XDriveBaiduJSAPI4ViewportResult, generation: number) {
    if (this.disposed || this.generation !== generation) return
    try { this.callbacks.onResult?.(result) } catch { /* no private data/errors */ }
  }

  /** Unmount / logout: stop Server work and release official GPU layer. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
    try { this.map.removeEventListener('movestart', this.onViewportStarted) } catch { /* cleanup */ }
    try { this.map.removeEventListener('zoomstart', this.onViewportStarted) } catch { /* cleanup */ }
    this.native.dispose()
  }
}
