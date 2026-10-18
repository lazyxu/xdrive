import type { MediaBaiduNativeViewportPage, MediaBaiduNativeCellsPage } from './models'
import { XDriveBaiduJSAPI4NativeCellOverlays, xDriveValidBaiduNativeCellsPage } from './media-gallery-baidu-jsapi4-cells'
import type { XDriveBaiduNativePhotoCellsRequest } from './media-gallery-baidu-jsapi4-cells'
import type {
  XDriveBaiduJSAPI4AuthorizedRuntimePort,
  XDriveBaiduJSAPI4ClusterLayerPort,
  XDriveBaiduJSAPI4MapPort,
} from './media-gallery-baidu-jsapi4-layer'

/** This only accepts CURRENT opt-in photo positions already derived as BD09LL.
 * The official coordinate converter MUST NOT run a second time. It is not
 * authority to load any SDK, call an upstream or display private photos. */
export const XDRIVE_BAIDU_NATIVE_PHOTO_WINDOW_MAX = 100

export type XDriveBaiduNativePhotoIdentity = Readonly<{
  assetID: number
  nodeID: number
}>
export type XDriveBaiduNativePhotoCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    id: string
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { asset_id: number; node_id: number }
  }>
}
export type XDriveBaiduNativePhotoWindowResult =
  | { kind: 'ready'; count: number; collection: XDriveBaiduNativePhotoCollection;
      identities: ReadonlyMap<number, XDriveBaiduNativePhotoIdentity> }
  | { kind: 'incomplete'; totalPhotos: number }
  | { kind: 'invalid' | 'out-of-map-range' | 'cancelled' }

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function positive(value: unknown): value is number {
  return nonnegative(value) && value > 0
}

/** Never display a partial window as a complete ClusterLayer.
 * A 100k library yields no more than 100 current Server points at a time. */
export function xDrivePrepareBaiduNativePhotoWindow(
  page: MediaBaiduNativeViewportPage, signal?: AbortSignal,
): XDriveBaiduNativePhotoWindowResult {
  if (signal?.aborted) return { kind: 'cancelled' }
  if (!page || page.coordinate_space !== 'bd09ll' ||
      page.index_scope !== 'explicit_opt_in_only' || !Array.isArray(page.items) ||
      !nonnegative(page.total_count) || !nonnegative(page.offset) ||
      !nonnegative(page.limit) || page.limit < 1 ||
      page.limit > XDRIVE_BAIDU_NATIVE_PHOTO_WINDOW_MAX ||
      page.items.length > page.limit || typeof page.has_more !== 'boolean' ||
      page.has_more !== (page.total_count > page.offset + page.items.length)) {
    return { kind: 'invalid' }
  }
  if (page.offset !== 0 || page.total_count > XDRIVE_BAIDU_NATIVE_PHOTO_WINDOW_MAX ||
      page.has_more || page.items.length !== page.total_count) {
    return { kind: 'incomplete', totalPhotos: page.total_count }
  }
  const identities = new Map<number, XDriveBaiduNativePhotoIdentity>()
  const seenNodes = new Set<number>()
  const features: XDriveBaiduNativePhotoCollection['features'] = []
  for (const item of page.items) {
    if (signal?.aborted) return { kind: 'cancelled' }
    if (!item || !positive(item.asset_id) || !positive(item.node_id) ||
        identities.has(item.asset_id) || seenNodes.has(item.node_id) ||
        !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude) ||
        Math.abs(item.latitude) > 90 || Math.abs(item.longitude) > 180) {
      return { kind: 'invalid' }
    }
    if (Math.abs(item.latitude) > 85) return { kind: 'out-of-map-range' }
    identities.set(item.asset_id, { assetID: item.asset_id, nodeID: item.node_id })
    seenNodes.add(item.node_id)
    features.push({ type: 'Feature', id: 'asset:' + item.asset_id,
      geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] },
      properties: { asset_id: item.asset_id, node_id: item.node_id },
    })
  }
  return { kind: 'ready', count: features.length,
    collection: { type: 'FeatureCollection', features }, identities }
}

export type XDriveBaiduNativePhotoLayerResult =
  | { kind: 'rendered'; photos: number }
  | { kind: 'incomplete'; totalPhotos: number }
  | { kind: 'invalid' | 'out-of-map-range' | 'cancelled' | 'unavailable' }
export type XDriveBaiduNativePhotoCallbacks = {
  /** Viewer must independently authorize the resolved Node/Asset via existing
   * Owner Gallery Range/VirtualCollection; SDK click is not a media permission. */
  onOpenPhoto(identity: XDriveBaiduNativePhotoIdentity): void
  onViewportInvalidated(): void
}

/** Native ClusterLayer for verified BD09 positions, no synthetic conversion. */
export class XDriveBaiduJSAPI4NativePhotoController {
  private readonly map: XDriveBaiduJSAPI4MapPort
  private readonly layer: XDriveBaiduJSAPI4ClusterLayerPort
  private generation = 0
  private disposed = false
  private abort: AbortController | null = null
  private notifyPending = false
  private committed = new Map<number, XDriveBaiduNativePhotoIdentity>()

  private readonly onClick = (event: { value?: unknown }) => {
    if (this.disposed || !event || !event.value ||
        typeof event.value !== 'object') return
    const value = event.value as {
      isCluster?: unknown; pointCount?: unknown
      properties?: { asset_id?: unknown; node_id?: unknown }
    }
    if (value.isCluster !== false || value.pointCount !== 1 ||
        !positive(value.properties?.asset_id) ||
        !positive(value.properties?.node_id)) return
    const identity = this.committed.get(value.properties.asset_id)
    if (!identity || identity.nodeID !== value.properties.node_id) return
    try { this.callbacks.onOpenPhoto(identity) } catch { /* no raw SDK errors */ }
  }
  private readonly onMapStarted = () => { if (!this.disposed) this.invalidate() }
  private readonly onMapSettled = () => {
    if (this.disposed) return
    this.invalidate()
    if (this.notifyPending) return
    this.notifyPending = true
    Promise.resolve().then(() => {
      this.notifyPending = false
      if (this.disposed) return
      try { this.callbacks.onViewportInvalidated() } catch { /* opaque */ }
    })
  }

  constructor(
    runtime: Pick<XDriveBaiduJSAPI4AuthorizedRuntimePort, 'map' | 'createClusterLayer'>,
    private readonly callbacks: XDriveBaiduNativePhotoCallbacks,
  ) {
    if (!runtime || !runtime.map || typeof runtime.createClusterLayer !== 'function' ||
        !callbacks || typeof callbacks.onOpenPhoto !== 'function' ||
        typeof callbacks.onViewportInvalidated !== 'function') {
      throw new Error('baidu_native_photo_layer_unavailable')
    }
    this.map = runtime.map
    this.layer = runtime.createClusterLayer({ clusterRadius: 60, enablePicked: true,
      fitViewOnClick: true, updateRealTime: false, idKey: 'id' })
    try {
      this.map.addLayer(this.layer)
      this.layer.addEventListener('click', this.onClick)
      this.map.addEventListener('movestart', this.onMapStarted)
      this.map.addEventListener('zoomstart', this.onMapStarted)
      this.map.addEventListener('moveend', this.onMapSettled)
      this.map.addEventListener('zoomend', this.onMapSettled)
    } catch {
      this.dispose()
      throw new Error('baidu_native_photo_layer_unavailable')
    }
  }
  invalidate(): void {
    this.generation++
    this.abort?.abort()
    this.abort = null
    this.committed.clear()
    try { this.layer.clearData() } catch { /* fail closed */ }
  }
  /** Page must come from the separately authorized Owner BD09 endpoint. */
  applyOwnerBD09Page(page: MediaBaiduNativeViewportPage,
    signal?: AbortSignal): XDriveBaiduNativePhotoLayerResult {
    if (this.disposed) return { kind: 'unavailable' }
    this.invalidate()
    const generation = this.generation
    const abort = new AbortController()
    this.abort = abort
    const onAbort = () => abort.abort()
    if (signal?.aborted) abort.abort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const prepared = xDrivePrepareBaiduNativePhotoWindow(page, abort.signal)
      if (prepared.kind !== 'ready') return prepared
      if (abort.signal.aborted || generation !== this.generation || this.disposed) {
        return { kind: 'cancelled' }
      }
      try {
        this.layer.setData(prepared.collection)
        if (abort.signal.aborted || generation !== this.generation || this.disposed) {
          this.committed.clear()
          try { this.layer.clearData() } catch {}
          return { kind: 'cancelled' }
        }
        this.committed = new Map(prepared.identities)
      } catch {
        this.committed.clear()
        try { this.layer.clearData() } catch {}
        return { kind: 'unavailable' }
      }
      return { kind: 'rendered', photos: prepared.count }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (this.abort === abort) this.abort = null
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.invalidate()
    try { this.map.removeEventListener('movestart', this.onMapStarted) } catch {}
    try { this.map.removeEventListener('zoomstart', this.onMapStarted) } catch {}
    try { this.map.removeEventListener('moveend', this.onMapSettled) } catch {}
    try { this.map.removeEventListener('zoomend', this.onMapSettled) } catch {}
    try { this.layer.removeEventListener('click', this.onClick) } catch {}
    try { this.map.removeLayer(this.layer) } catch {}
  }
}

export type XDriveBaiduNativePhotoBounds = {
  coordinate_space: 'bd09ll'
  west: number
  south: number
  east: number
  north: number
}
type NativePoint = { lng: number; lat: number }
type NativeBounds = { getSouthWest(): NativePoint; getNorthEast(): NativePoint }
export type XDriveBaiduNativeMapWithBounds = XDriveBaiduJSAPI4MapPort & {
  getBounds(): NativeBounds
}
export type XDriveBaiduNativePhotoViewportRequest = (
  bounds: XDriveBaiduNativePhotoBounds, limit: number, offset: number,
  signal: AbortSignal,
) => Promise<MediaBaiduNativeViewportPage>
export type XDriveBaiduIndexedViewportResult = XDriveBaiduNativePhotoLayerResult |
  { kind: 'aggregated'; totalPhotos: number; cells: number } |
  { kind: 'invalid-bounds' | 'cancelled' | 'query-unavailable' }

/** BMap.getBounds is already BD09, never forward it as photo WGS84. */
export function xDriveReadBaiduNativePhotoBounds(
  map: XDriveBaiduNativeMapWithBounds,
): XDriveBaiduNativePhotoBounds | null {
  try {
    const bounds = map?.getBounds?.()
    const sw = bounds?.getSouthWest?.()
    const ne = bounds?.getNorthEast?.()
    if (!sw || !ne || ![sw.lng, sw.lat, ne.lng, ne.lat].every(Number.isFinite) ||
        sw.lng < -180 || sw.lng > 180 || ne.lng < -180 || ne.lng > 180 ||
        sw.lat < -90 || ne.lat > 90 || sw.lat >= ne.lat ||
        sw.lng === ne.lng || (sw.lng === 180 && ne.lng === -180)) return null
    return { coordinate_space: 'bd09ll', west: sw.lng, south: sw.lat,
      east: ne.lng, north: ne.lat }
  } catch {
    return null
  }
}

/** Shared Web/Mobile/Desktop coordinator: pan/zoom AbortSignal propagates
 * through the existing Owner viewport adapter to Go request cancellation. */
export class XDriveBaiduJSAPI4IndexedViewportBridge {
  private readonly controller: XDriveBaiduJSAPI4NativePhotoController
  private readonly overlays: XDriveBaiduJSAPI4NativeCellOverlays | null
  private generation = 0
  private request: AbortController | null = null
  private disposed = false
  private readonly onMapStarted = () => { if (!this.disposed) this.cancel() }

  constructor(
    private readonly runtime: Pick<XDriveBaiduJSAPI4AuthorizedRuntimePort,
      'map' | 'createClusterLayer'> & { map: XDriveBaiduNativeMapWithBounds },
    private readonly listViewport: XDriveBaiduNativePhotoViewportRequest,
    private readonly callbacks: XDriveBaiduNativePhotoCallbacks & {
      onResult?(result: XDriveBaiduIndexedViewportResult): void
      onCells?(page: MediaBaiduNativeCellsPage | null): void
    },
    private readonly listCells?: XDriveBaiduNativePhotoCellsRequest,
    nativeNamespace?: unknown,
  ) {
    if (!runtime || typeof runtime.map?.getBounds !== 'function' ||
        typeof listViewport !== 'function') throw new Error('baidu_indexed_viewport_unavailable')
    this.overlays = listCells ? new XDriveBaiduJSAPI4NativeCellOverlays(
      runtime.map, nativeNamespace, id => callbacks.onOpenPhoto(id)) : null
    this.controller = new XDriveBaiduJSAPI4NativePhotoController(runtime, {
      onOpenPhoto: identity => callbacks.onOpenPhoto(identity),
      onViewportInvalidated: () => { void this.refresh() },
    })
    try {
      runtime.map.addEventListener('movestart', this.onMapStarted)
      runtime.map.addEventListener('zoomstart', this.onMapStarted)
    } catch {
      this.dispose()
      throw new Error('baidu_indexed_viewport_unavailable')
    }
  }
  cancel(): void {
    this.generation++
    this.request?.abort()
    this.request = null
    this.controller.invalidate()
    this.overlays?.clear()
    try { this.callbacks.onCells?.(null) } catch {}
  }
  async refresh(): Promise<XDriveBaiduIndexedViewportResult> {
    if (this.disposed) return { kind: 'query-unavailable' }
    this.cancel()
    const generation = this.generation
    const abort = new AbortController()
    this.request = abort
    const timeout = setTimeout(() => abort.abort(), 8000)
    try {
      const bounds = xDriveReadBaiduNativePhotoBounds(this.runtime.map)
      if (!bounds) return this.deliver({ kind: 'invalid-bounds' }, generation)
      let priorCount: number | null = null
      if (this.listCells && this.overlays) {
        // Dense view: 1 bounded /cells request rather than 100k points to DOM.
        const summary = await new Promise<MediaBaiduNativeCellsPage>((resolve,reject) => {
          let settled=false
          const cancel=()=>finish(false)
          const finish=(ok:boolean, value?:MediaBaiduNativeCellsPage)=>{
            if(settled)return
            settled=true
            abort.signal.removeEventListener('abort',cancel)
            if(ok && value)resolve(value)
            else reject(new Error('baidu_cells_unavailable'))
          }
          if(abort.signal.aborted)return cancel()
          abort.signal.addEventListener('abort',cancel,{once:true})
          try { this.listCells!(bounds,abort.signal).then(
            value=>finish(true,value),()=>finish(false)) } catch {finish(false)}
        })
        if(this.disposed || abort.signal.aborted || generation!==this.generation)
          return {kind:'cancelled'}
        if(!xDriveValidBaiduNativeCellsPage(summary,bounds))
          return this.deliver({kind:'query-unavailable'},generation)
        priorCount=summary.total_count
        if(priorCount>XDRIVE_BAIDU_NATIVE_PHOTO_WINDOW_MAX) {
          if(!this.overlays.apply(summary,bounds,abort.signal))
            return this.deliver({kind:'query-unavailable'},generation)
          try {this.callbacks.onCells?.(summary)} catch {}
          return this.deliver({kind:'aggregated',totalPhotos:priorCount,
            cells:summary.cells.length},generation)
        }
      }
      const page = await new Promise<MediaBaiduNativeViewportPage>((resolve, reject) => {
        let settled = false
        const finish = (ok: boolean, value?: MediaBaiduNativeViewportPage) => {
          if (settled) return
          settled = true
          abort.signal.removeEventListener('abort', cancelled)
          if (ok && value) resolve(value)
          else reject(new Error('baidu_indexed_viewport_unavailable'))
        }
        const cancelled = () => finish(false)
        if (abort.signal.aborted) return cancelled()
        abort.signal.addEventListener('abort', cancelled, { once: true })
        try {
          this.listViewport(bounds, XDRIVE_BAIDU_NATIVE_PHOTO_WINDOW_MAX, 0, abort.signal)
            .then(value => finish(true, value), () => finish(false))
        } catch { finish(false) }
      })
      if (this.disposed || abort.signal.aborted || generation !== this.generation) {
        return { kind: 'cancelled' }
      }
      // A consent/index update between the two independent authenticated GETs
      // cannot turn a partial 100-point window into a fake complete cluster.
      if (priorCount !== null && page.total_count !== priorCount)
        return this.deliver({kind:'query-unavailable'},generation)
      return this.deliver(this.controller.applyOwnerBD09Page(page,abort.signal),generation)
    } catch {
      if (this.disposed || abort.signal.aborted || generation !== this.generation) {
        return { kind: 'cancelled' }
      }
      return this.deliver({ kind: 'query-unavailable' }, generation)
    } finally {
      clearTimeout(timeout)
      if (this.request === abort) this.request = null
    }
  }
  private deliver(result: XDriveBaiduIndexedViewportResult,
    generation: number): XDriveBaiduIndexedViewportResult {
    if (!this.disposed && generation === this.generation) {
      try { this.callbacks.onResult?.(result) } catch {}
    }
    return result
  }
  focusCell(cell: MediaBaiduNativeCellsPage['cells'][number]) {
    this.overlays?.focusCell(cell)
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
    this.overlays?.dispose()
    try { this.runtime.map.removeEventListener('movestart', this.onMapStarted) } catch {}
    try { this.runtime.map.removeEventListener('zoomstart', this.onMapStarted) } catch {}
    this.controller.dispose()
  }
}
