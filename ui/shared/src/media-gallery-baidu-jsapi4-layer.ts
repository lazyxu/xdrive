import type { MediaPlaceFacet, MediaPlacesViewportPage } from './models'
import {
  xDrivePrepareBaiduJSAPI4MarkerWindow,
  xDriveConvertBaiduJSAPI4MarkerWindow,
} from './media-gallery-baidu-jsapi4-markers'
import type {
  XDriveBaiduOfficialConvertor,
  XDriveBaiduOfficialPoint,
  XDriveBaiduConvertedFeatureCollection,
} from './media-gallery-baidu-jsapi4-markers'

/**
 * A3b3a3b: a controller for an ALREADY authorized and isolated JSAPI4 Map.
 *
 * This module does NOT load a map, obtain a credential, issue a map session,
 * access the global map namespace, or change the production release gate. Production
 * still has NO caller. A future caller must independently prove an approved
 * Baidu license, complete code-owned child rules, and current Server authority.
 */
export interface XDriveBaiduJSAPI4ClusterLayerPort {
  setData(data: XDriveBaiduConvertedFeatureCollection): unknown
  clearData(): unknown
  addEventListener(type: 'click', handler: (event: { value?: unknown }) => void): void
  removeEventListener(type: 'click', handler: (event: { value?: unknown }) => void): void
}

export interface XDriveBaiduJSAPI4MapPort {
  addLayer(layer: XDriveBaiduJSAPI4ClusterLayerPort): void
  removeLayer(layer: XDriveBaiduJSAPI4ClusterLayerPort): void
  addEventListener(type: 'movestart' | 'zoomstart' | 'moveend' | 'zoomend', handler: () => void): void
  removeEventListener(type: 'movestart' | 'zoomstart' | 'moveend' | 'zoomend', handler: () => void): void
}

/** The official Baidu ClusterLayerOptions subset; no custom fake cluster. */
export type XDriveBaiduJSAPI4ClusterOptions = {
  clusterRadius: 60
  enablePicked: true
  fitViewOnClick: true
  updateRealTime: false
  idKey: 'id'
}

export interface XDriveBaiduJSAPI4AuthorizedRuntimePort {
  map: XDriveBaiduJSAPI4MapPort
  createClusterLayer(options: XDriveBaiduJSAPI4ClusterOptions): XDriveBaiduJSAPI4ClusterLayerPort
  convertor: XDriveBaiduOfficialConvertor
  createPoint(lng: number, lat: number): XDriveBaiduOfficialPoint
}

export type XDriveBaiduJSAPI4LayerResult =
  | { kind: 'rendered'; cells: number; photos: number }
  | { kind: 'incomplete'; totalCells: number; totalPhotoCount: number }
  | { kind: 'invalid' | 'cancelled' | 'out-of-map-range' | 'unavailable' }

export interface XDriveBaiduJSAPI4LayerCallbacks {
  /** Existing authorized Gallery Places navigation, never a new media stream. */
  onOpenPlace(place: MediaPlaceFacet): void
  /** Request an independently derived WGS84 viewport; map bounds are BD-09. */
  onViewportInvalidated(): void
}

function validClickPlace(value: unknown): value is {
  isCluster: false
  pointCount: 1
  properties: { place_id: string; photo_count: number }
} {
  if (!value || typeof value !== 'object') return false
  const v = value as {
    isCluster?: unknown
    pointCount?: unknown
    properties?: { place_id?: unknown; photo_count?: unknown }
  }
  return v.isCluster === false && v.pointCount === 1 &&
    v.properties !== null && typeof v.properties === 'object' &&
    typeof v.properties.place_id === 'string' &&
    typeof v.properties.photo_count === 'number' &&
    Number.isSafeInteger(v.properties.photo_count) && v.properties.photo_count > 0
}

export class XDriveBaiduJSAPI4ClusterController {
  private readonly map: XDriveBaiduJSAPI4MapPort
  private readonly layer: XDriveBaiduJSAPI4ClusterLayerPort
  private generation = 0
  private active: AbortController | null = null
  private disposed = false
  private viewportNotifyPending = false
  private committed = new Map<string, MediaPlaceFacet>()

  private readonly onClick = (event: { value?: unknown }) => {
    if (this.disposed || !validClickPlace(event?.value)) return
    const { place_id: placeID, photo_count: photoCount } = event.value.properties
    const place = this.committed.get(placeID)
    // Never trust user-controlled event properties or a stale/offscreen point.
    if (!place || place.item_count !== photoCount) return
    try { this.callbacks.onOpenPlace(place) } catch { /* no raw metadata */ }
  }

  private readonly onMapStarted = () => {
    if (!this.disposed) this.invalidate()
  }

  private readonly onMapSettled = () => {
    if (this.disposed) return
    // Abort old Server viewport / Convertor work synchronously on a map change.
    this.invalidate()
    if (this.viewportNotifyPending) return
    this.viewportNotifyPending = true
    Promise.resolve().then(() => {
      this.viewportNotifyPending = false
      if (this.disposed) return
      try { this.callbacks.onViewportInvalidated() } catch { /* no GPS in errors */ }
    })
  }

  constructor(
    runtime: XDriveBaiduJSAPI4AuthorizedRuntimePort,
    private readonly callbacks: XDriveBaiduJSAPI4LayerCallbacks,
  ) {
    if (!runtime || !runtime.map || typeof runtime.createClusterLayer !== 'function' ||
        !runtime.convertor || typeof runtime.convertor.translate !== 'function' ||
        typeof runtime.createPoint !== 'function' ||
        !callbacks || typeof callbacks.onOpenPlace !== 'function' ||
        typeof callbacks.onViewportInvalidated !== 'function') {
      throw new Error('baidu_jsapi4_runtime_unavailable')
    }
    this.map = runtime.map
    // Does NOT load a JSAPI script. Only a fully reviewed future caller can
    // provide a functioning official layer factory and isolated Map instance.
    this.runtime = runtime
    this.layer = runtime.createClusterLayer({
      clusterRadius: 60, enablePicked: true, fitViewOnClick: true,
      updateRealTime: false, idKey: 'id',
    })
    try {
      this.map.addLayer(this.layer)
      this.layer.addEventListener('click', this.onClick)
      this.map.addEventListener('movestart', this.onMapStarted)
      this.map.addEventListener('zoomstart', this.onMapStarted)
      this.map.addEventListener('moveend', this.onMapSettled)
      this.map.addEventListener('zoomend', this.onMapSettled)
    } catch {
      this.dispose()
      throw new Error('baidu_jsapi4_layer_unavailable')
    }
  }

  private readonly runtime: XDriveBaiduJSAPI4AuthorizedRuntimePort

  /** Invalidate before new WGS84 bounds are supplied by an authorized caller. */
  invalidate(): void {
    this.generation += 1
    this.active?.abort()
    this.active = null
    this.committed.clear()
    try { this.layer.clearData() } catch { /* fail closed */ }
  }

  /**
   * Caller supplies exactly one current Owner-authenticated /places/viewport
   * page (limit <=100), NOT the old 24-place Preview or arbitrary DOM points.
   */
  async applyAuthorizedViewport(
    page: MediaPlacesViewportPage,
    externalSignal?: AbortSignal,
  ): Promise<XDriveBaiduJSAPI4LayerResult> {
    if (this.disposed) return { kind: 'unavailable' }
    this.invalidate()
    const version = this.generation
    const abort = new AbortController()
    this.active = abort
    const onAbort = () => abort.abort()
    if (externalSignal?.aborted) abort.abort()
    else externalSignal?.addEventListener('abort', onAbort, { once: true })
    try {
      const prepared = xDrivePrepareBaiduJSAPI4MarkerWindow(page, abort.signal)
      if (prepared.kind !== 'ready') return prepared
      let geojson: XDriveBaiduConvertedFeatureCollection
      try {
        geojson = await xDriveConvertBaiduJSAPI4MarkerWindow(
          prepared, this.runtime.convertor, (lng, lat) => this.runtime.createPoint(lng, lat),
          abort.signal,
        )
      } catch {
        return abort.signal.aborted ? { kind: 'cancelled' } : { kind: 'unavailable' }
      }
      if (abort.signal.aborted || this.disposed || version !== this.generation) {
        return { kind: 'cancelled' }
      }
      // The converter returns only successful official WGS84 -> BD-09 points.
      // Install a complete window atomically or clear the entire layer.
      try {
        this.layer.setData(geojson)
        // Official layer callbacks can synchronously trigger a camera change.
        // Do not commit or report success after reentrant cancellation.
        if (abort.signal.aborted || this.disposed || version !== this.generation) {
          this.committed.clear()
          try { this.layer.clearData() } catch { /* fail closed */ }
          return { kind: 'cancelled' }
        }
        this.committed = new Map(
          page.items.map(item => [item.id, item]),
        )
      } catch {
        this.committed.clear()
        try { this.layer.clearData() } catch { /* fail closed */ }
        return { kind: 'unavailable' }
      }
      return { kind: 'rendered', cells: prepared.markers.length,
        photos: prepared.totalPhotoCount }
    } finally {
      externalSignal?.removeEventListener('abort', onAbort)
      if (this.active === abort) this.active = null
    }
  }

  /** Idempotent teardown on Gallery/Viewer navigation or logout. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.invalidate()
    try { this.map.removeEventListener('movestart', this.onMapStarted) } catch { /* cleanup */ }
    try { this.map.removeEventListener('zoomstart', this.onMapStarted) } catch { /* cleanup */ }
    try { this.map.removeEventListener('moveend', this.onMapSettled) } catch { /* cleanup */ }
    try { this.map.removeEventListener('zoomend', this.onMapSettled) } catch { /* cleanup */ }
    try { this.layer.removeEventListener('click', this.onClick) } catch { /* cleanup */ }
    try { this.map.removeLayer(this.layer) } catch { /* cleanup */ }
  }
}
