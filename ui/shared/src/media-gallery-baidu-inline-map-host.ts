import { loadBaiduJSAPI4 } from './mui/MediaGalleryBaiduPrototypeMap'
import type { XDriveBaiduJSAPIPrototypeConfig } from './models'
import type {
  XDriveBaiduIsolatedFrameOptions, XDriveTrustedIsolatedMapCell,
} from './media-gallery-baidu-isolated-frame-host'
import type {
  XDriveBaiduIsolatedBounds, XDriveBaiduIsolatedCamera,
} from './media-gallery-baidu-isolated-origin-protocol'
import { xDriveValidBaiduNativeCameraSnapshot } from './media-gallery-baidu-native-camera-session'

/**
 * The same-document SDK host implements the SAME signed BD09 Cell/Camera
 * contract as the independent HTTPS Child. The trusted React Parent owns all
 * filtering, counts, photo identity, thumbnails, Range and Viewer operations.
 *
 * SECURITY: this deliberately does NOT isolate provider JavaScript from the
 * Gallery DOM. It is only an opt-in product runtime alternative; never label it
 * an Origin security boundary. No raw WGS84/Convertor, private IDs or photo
 * URLs are intentionally passed to the native map.
 */
type NativePoint = { lng: number; lat: number }
type NativeLabel = {
  setStyle(style: Record<string, string>): void
  addEventListener(event: 'click', callback: () => void): void
  removeEventListener(event: 'click', callback: () => void): void
}
type NativeNamespace = {
  Map: new (container: HTMLElement) => NativeMap
  Point: new (lng: number, lat: number) => NativePoint
  Label: new (label: string, options: {
    position: NativePoint; offset?: { width: number; height: number }
  }) => NativeLabel
  Size?: new (width: number, height: number) => { width: number; height: number }
}
type NativeMap = {
  destroy?(): void
  centerAndZoom(point: NativePoint, zoom: number): void
  setViewport?(points: NativePoint[], options: { margins: number[] }): void
  enableScrollWheelZoom?(enabled: boolean): void
  enableDoubleClickZoom?(enabled: boolean): void
  enablePinchToZoom?(enabled: boolean): void
  getBounds(): { getSouthWest(): NativePoint; getNorthEast(): NativePoint }
  getCenter(): NativePoint
  getZoom(): number
  pointToPixel?(point: NativePoint): { x: number; y: number }
  addOverlay(label: NativeLabel): void
  removeOverlay(label: NativeLabel): void
  addEventListener(event: 'movestart' | 'zoomstart' | 'moveend' | 'zoomend',
    callback: () => void): void
  removeEventListener(event: 'movestart' | 'zoomstart' | 'moveend' | 'zoomend',
    callback: () => void): void
}
type EventName = 'movestart' | 'zoomstart' | 'moveend' | 'zoomend'
export type XDriveBaiduInlineMapOptions<T> =
  Omit<XDriveBaiduIsolatedFrameOptions<T>, 'childOrigin'> & {
    getPrototypeConfig(signal: AbortSignal): Promise<XDriveBaiduJSAPIPrototypeConfig>
    getSignedStatus(signal: AbortSignal): Promise<{
      provider:'baidu-jsapi-4.0';enabled:boolean;activation_state:string;
      isolated_child_origin?:string
    }>
  }

export interface XDriveBaiduInlineMapHost<T> {
  beginAuthorizedInlineSession(signal: AbortSignal): Promise<boolean>
  replaceAuthorizedCells(cells: readonly XDriveTrustedIsolatedMapCell<T>[]): boolean
  setPhotoCoverSelections(selections: readonly T[]): boolean
  restoreCamera(camera: XDriveBaiduIsolatedCamera): boolean
  dispose(): void
}

const maxCells = 64
const maxPhotoCovers = 24
function validCell<T>(cell: XDriveTrustedIsolatedMapCell<T>): boolean {
  return Boolean(cell && cell.selection !== undefined &&
    Number.isFinite(cell.latitude) && Math.abs(cell.latitude) <= 85 &&
    Number.isFinite(cell.longitude) && Math.abs(cell.longitude) <= 180 &&
    Number.isSafeInteger(cell.count) && cell.count > 0)
}

/** The SDK is deliberately loaded with the existing Browser AK, never a
 * forbidden Gallery-origin Map-only Cookie; Server-signed BD09 /cells remains
 * the ONLY map photo authority. */
export function xDriveMountBaiduInlineMap<T>(
  options: XDriveBaiduInlineMapOptions<T>,
): XDriveBaiduInlineMapHost<T> | null {
  const host = options?.host
  const doc = host?.ownerDocument
  const browser = doc?.defaultView
  if (!host || !doc || !browser || browser.location.protocol !== 'https:' ||
      typeof options.getPrototypeConfig !== 'function' ||
      typeof options.getSignedStatus !== 'function' ||
      typeof options.onActivateCell !== 'function') return null

  const canvas = doc.createElement('div')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
  host.appendChild(canvas)
  const lifetime = new AbortController()
  let alive = true
  let ready = false
  let generation = 0
  let map: NativeMap | null = null
  let sdk: NativeNamespace | null = null
  let browserAK: string | null = null
  let labels: Array<{ label: NativeLabel; click: () => void }> = []
  let cells: readonly XDriveTrustedIsolatedMapCell<T>[] = []
  let coveredSelections = new Set<T>()
  let pendingViewport: ReturnType<typeof setTimeout> | null = null
  let observedSize: {width:number;height:number} | null = null
  let sizeObserver: ResizeObserver | null = null
  let windowResizeFallback = false
  let resizeRevoked = false
  let starting: Promise<boolean> | null = null

  const clearLabels = () => {
    for (const {label, click} of labels) {
      try { label.removeEventListener('click', click) } catch { /* teardown */ }
      try { map?.removeOverlay(label) } catch { /* teardown */ }
    }
    labels = []
  }
  const clearProjection = () => {
    options.onProjectedCells?.({width:0,height:0,cells:[]})
  }
  const clearTimer = () => {
    if (pendingViewport !== null) clearTimeout(pendingViewport)
    pendingViewport = null
  }
  const invalidate = () => {
    generation++
    clearTimer()
    clearLabels()
    cells = []
    coveredSelections.clear()
    clearProjection()
    options.onCancel?.()
  }
  const emitProjections = () => {
    if (!alive || !ready || !map?.pointToPixel || !sdk) return
    const width = Math.round(canvas.clientWidth)
    const height = Math.round(canvas.clientHeight)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > 4096 || height > 4096) return
    const projected: Array<{selection:T;count:number;x:number;y:number}> = []
    for (const cell of cells) {
      try {
        const position = map.pointToPixel(new sdk.Point(cell.longitude,cell.latitude))
        const x = Math.round(position.x)
        const y = Math.round(position.y)
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
            x < 0 || y < 0 || x > width || y > height) continue
        projected.push({selection:cell.selection,count:cell.count,x,y})
      } catch { /* Optional SDK projection is not media authority. */ }
    }
    options.onProjectedCells?.({width,height,cells:projected})
  }
  const renderCells = (republishProjection = true): boolean => {
    clearLabels()
    if (republishProjection) clearProjection()
    if (!map || !sdk || !ready || !alive) return true
    const current = generation
    try {
      for (const cell of cells) {
        if (coveredSelections.has(cell.selection)) continue
        const position = new sdk.Point(cell.longitude,cell.latitude)
        const label = new sdk.Label(cell.count > 1
          ? '▣ ' + cell.count.toLocaleString('zh-CN') + '张' : '▣', {
          position,
          ...(sdk.Size ? { offset:new sdk.Size(-28,-28) } : {}),
        })
        label.setStyle({
          color:'#334155', backgroundColor:'#ffffff', borderColor:'#ffffff',
          borderWidth:'2px', padding:'9px 11px', borderRadius:'12px',
          boxShadow:'0 3px 12px rgba(15,23,42,.20)',
          cursor:'pointer', fontWeight:'700', fontSize:'12px', whiteSpace:'nowrap',
        })
        const click = () => {
          // Native SDK events are only navigation intents, never authorization.
          if (alive && ready && generation === current && cells.includes(cell))
            options.onActivateCell(cell.selection)
        }
        label.addEventListener('click',click)
        map.addOverlay(label)
        labels.push({label,click})
      }
      if (republishProjection) emitProjections()
      return true
    } catch {
      clearLabels()
      clearProjection()
      return false
    }
  }
  const emitViewport = () => {
    if (!alive || !ready || !map) return
    try {
      const sw = map.getBounds().getSouthWest()
      const ne = map.getBounds().getNorthEast()
      const bounds: XDriveBaiduIsolatedBounds = {
        coordinate_space:'bd09ll',west:sw.lng,south:sw.lat,
        east:ne.lng,north:ne.lat,
      }
      if ([bounds.west,bounds.south,bounds.east,bounds.north].some(n=>!Number.isFinite(n)) ||
          Math.abs(bounds.west)>180 || Math.abs(bounds.east)>180 ||
          Math.abs(bounds.south)>85 || Math.abs(bounds.north)>85 ||
          bounds.south>=bounds.north || bounds.west===bounds.east) return
      options.onViewport?.(bounds)
      const center = map.getCenter()
      const snapshot: XDriveBaiduIsolatedCamera = {
        coordinate_space:'bd09ll',latitude:center.lat,longitude:center.lng,
        zoom:map.getZoom(),
      }
      if (xDriveValidBaiduNativeCameraSnapshot(snapshot)) options.onCamera?.(snapshot)
      emitProjections()
    } catch { /* Never echo third-party errors or arbitrary coordinates. */ }
  }
  const scheduleViewport = () => {
    clearTimer()
    pendingViewport = setTimeout(() => {
      pendingViewport = null
      emitViewport()
    }, 500)
  }
  const stopViewport = () => { if (alive && ready) invalidate() }
  // A responsive container can change without Baidu firing move/zoom events
  // (orientation, 899/900 breakpoint or a Desktop sidebar resize). Old
  // pointToPixel results belong to the prior CSS viewport and MUST NOT stay
  // attached to current Owner photo buttons. Reuse the exact same bounded,
  // debounced authenticated Camera /cells flow as a native map gesture.
  const refreshChangedSize = () => {
    if (!alive || !ready || !map) return
    const width = Math.round(canvas.clientWidth)
    const height = Math.round(canvas.clientHeight)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 120 || height < 120 || width > 4096 || height > 4096) return
    if (!observedSize) { observedSize = {width,height}; return }
    if (observedSize.width === width && observedSize.height === height) return
    observedSize = {width,height}
    // Only one invalidation for a rapid resize sequence; the final size
    // still determines the single debounced authoritative camera Range.
    if (!resizeRevoked) { invalidate(); resizeRevoked = true }
    scheduleViewport()
  }
  const observeCanvasSize = () => {
    refreshChangedSize() // Seed first dimensions; never cancel on observe().
    const Observer = (browser as Window & {ResizeObserver?: typeof ResizeObserver}).ResizeObserver
    if (typeof Observer === 'function') {
      try {
        sizeObserver = new Observer(refreshChangedSize)
        sizeObserver.observe(canvas)
        return
      } catch {
        sizeObserver?.disconnect()
        sizeObserver = null
      }
    }
    if (typeof browser.addEventListener === 'function') {
      browser.addEventListener('resize',refreshChangedSize)
      windowResizeFallback = true
    }
  }
  const listeners: Array<{event:EventName; callback:()=>void}> = [
    {event:'movestart',callback:stopViewport},
    {event:'zoomstart',callback:stopViewport},
    {event:'moveend',callback:scheduleViewport},
    {event:'zoomend',callback:scheduleViewport},
  ]
  const dispose = () => {
    if (!alive) return
    alive = false
    lifetime.abort()
    generation++
    clearTimer()
    sizeObserver?.disconnect()
    sizeObserver = null
    if (windowResizeFallback) {
      browser.removeEventListener('resize',refreshChangedSize)
      windowResizeFallback = false
    }
    clearLabels()
    clearProjection()
    cells = []
    coveredSelections.clear()
    ready = false
    if (map) for (const {event,callback} of listeners) {
      try { map.removeEventListener(event,callback) } catch { /* teardown */ }
    }
    try { map?.destroy?.() } catch { /* teardown */ }
    map = null
    sdk = null
    canvas.remove()
  }

  // Match the Child "ready" handshake: the trusted Parent first obtains
  // its worldwide signed Cells; the provider script is not loaded yet.
  void Promise.resolve().then(() => { if (alive) options.onReady?.() })
  return {
    async beginAuthorizedInlineSession(signal) {
      if (!alive || signal.aborted) return false
      if (starting) return starting
      const run = (async () => {
        try {
          // Refresh BOTH signed Owner map release and Browser AK authorization.
          // Server /baidu-jsapi/session intentionally rejects Gallery-origin
          // map-only Cookies; this host never attempts that forbidden path.
          const status = await options.getSignedStatus(signal)
          if (!alive || signal.aborted || status?.provider !== 'baidu-jsapi-4.0' ||
              !status.enabled || status.activation_state !== 'authorized_signed_release') return false
          const config = await options.getPrototypeConfig(signal)
          if (!alive || signal.aborted || config?.provider !== 'baidu-jsapi-4.0' ||
              typeof config.browser_ak !== 'string' || !config.browser_ak) return false
          if (ready) return config.browser_ak === browserAK
          // This is intentionally NOT an isolated/privileged SDK Loader.
          // Only the signed BD09 Cell DTO reaches native map labels.
          const namespace = await loadBaiduJSAPI4(doc,config.browser_ak,'authorized-cells')
          if (!alive || signal.aborted) return false
          const nativeSDK = namespace as unknown as NativeNamespace
          if (typeof nativeSDK.Map !== 'function' ||
              typeof nativeSDK.Point !== 'function' ||
              typeof nativeSDK.Label !== 'function') return false
          const nativeMap = new nativeSDK.Map(canvas)
          if (!alive || signal.aborted ||
              typeof nativeMap.addOverlay !== 'function' ||
              typeof nativeMap.getBounds !== 'function' ||
              typeof nativeMap.pointToPixel !== 'function') {
            try { nativeMap.destroy?.() } catch { /* teardown */ }
            return false
          }
          map = nativeMap
          sdk = nativeSDK
          browserAK = config.browser_ak
          map.centerAndZoom(new sdk.Point(0,20),3)
          // Fit only the finite, Server-authorized BD09 Owner overview.
          // No WGS84 representative is sent through BMap.Convertor.
          if (cells.length === 1) {
            map.centerAndZoom(new sdk.Point(cells[0].longitude,cells[0].latitude),12)
          } else if (cells.length > 1) {
            if (map.setViewport) {
              map.setViewport(cells.map(c=>new nativeSDK.Point(c.longitude,c.latitude)),
                {margins:[64,64,64,64]})
            } else {
              // Match the isolated HTTPS Child when JSAPI lacks setViewport.
              const latitude = cells.reduce((sum,cell) => sum+cell.latitude,0)/cells.length
              const longitude = cells.reduce((sum,cell) => sum+cell.longitude,0)/cells.length
              map.centerAndZoom(new sdk.Point(longitude,latitude),3)
            }
          }
          try {
            map.enableScrollWheelZoom?.(true)
            map.enableDoubleClickZoom?.(true)
            map.enablePinchToZoom?.(true)
          } catch { /* Unsupported optional gesture is not an auth failure. */ }
          for (const {event,callback} of listeners) map.addEventListener(event,callback)
          ready = true
          if (!renderCells()) return false
          options.onMapReady?.()
          scheduleViewport()
          observeCanvasSize()
          return true
        } catch { return false }
      })()
      starting = run
      const ok = await run
      if (starting === run) starting = null
      if (!ok) { options.onMapFailure?.(); dispose() }
      return ok
    },
    replaceAuthorizedCells(next) {
      if (!alive || !Array.isArray(next) || next.length > maxCells ||
          next.some(cell=>!validCell(cell))) {
        cells = []
        coveredSelections.clear()
        generation++
        clearLabels()
        clearProjection()
        return false
      }
      generation++
      cells = [...next]
      coveredSelections.clear()
      resizeRevoked = false
      return renderCells()
    },
    setPhotoCoverSelections(selections) {
      if (!alive || !ready || !map || !Array.isArray(selections) ||
          selections.length > maxPhotoCovers) return false
      const accepted = new Set(cells.map(cell => cell.selection))
      const next = new Set<T>()
      for (const selection of selections) {
        if (!accepted.has(selection) || next.has(selection)) return false
        next.add(selection)
      }
      if (next.size === coveredSelections.size &&
          [...next].every(item => coveredSelections.has(item))) return true
      coveredSelections = next
      // Cosmetic change only: do not clear/re-publish trusted projections.
      return renderCells(false)
    },
    restoreCamera(camera) {
      if (!alive || !ready || !map || !sdk ||
          !xDriveValidBaiduNativeCameraSnapshot(camera)) return false
      try {
        map.centerAndZoom(new sdk.Point(camera.longitude,camera.latitude),camera.zoom)
        scheduleViewport()
        return true
      } catch { return false }
    },
    dispose,
  }
}
