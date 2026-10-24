import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import type { MediaThumbnailLoader } from './MediaGallery'
import {
  xDriveProjectBaiduPrototypeCoverPins,
} from '../media-gallery-baidu-prototype-cover-pins'
import type { XDriveBaiduPrototypeCoverPin } from '../media-gallery-baidu-prototype-cover-pins'
import { xDriveProjectBaiduNativeClusterCovers } from '../media-gallery-baidu-native-cluster-covers'
import { xDriveCreateBaiduNativePhotoMarkerArt } from '../media-gallery-baidu-native-photo-marker-art'
import type { XDriveBaiduClusterCover } from '../media-gallery-baidu-native-cluster-covers'
import type { MediaPlaceFacet, MediaPlacesMapOverview, MediaPlacesViewportBounds, XDriveBaiduJSAPIPrototypeConfig } from '../models'
import {
  xDriveBaiduPrototypeOverviewQueryBounds, xDriveBaiduPrototypeNearbyActionBounds,
  XDRIVE_BAIDU_WORLD_OVERVIEW,
} from '../media-gallery-baidu-native-query-bounds'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import {
  xDriveBaiduMapDiagnosticDetails, xDriveRecordBaiduMapDiagnostic,
  xDriveClearBaiduMapDiagnostic, xDriveClassifyBaiduPrototypeConfigFailure,
} from '../media-gallery-baidu-diagnostics'
import type { XDriveBaiduMapDiagnosticCode } from '../media-gallery-baidu-diagnostics'
import { xDriveCaptureBaiduNativeCamera, xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { xDrivePlacesMapModeNavigationURL } from '../media-gallery-places-map-mode'
import {
  xDriveConvertBaiduJSAPI4MarkerWindow,
  xDriveBaiduConversionSessionForScope,
  XDriveBaiduJSAPI4ConversionSession,
} from '../media-gallery-baidu-jsapi4-markers'
import type { XDriveBaiduConversionAudit } from '../media-gallery-baidu-jsapi4-markers'
import type { XDriveBaiduConvertedFeatureCollection, XDriveBaiduWGS84Marker } from '../media-gallery-baidu-jsapi4-markers'

type Point = { lng: number; lat: number }
type Layer = {
  setData(data: XDriveBaiduConvertedFeatureCollection): void
  addEventListener(name: 'click' | 'change', handler: (event: unknown) => void): void
  removeEventListener(name: 'click' | 'change', handler: (event: unknown) => void): void
}
type NativeMap = {
  centerAndZoom(point: Point, zoom: number): void
  /** Official SDK camera framing; never calculate a pixel projection locally. */
  setViewport?(points: Point[], options: {
    margins: [number, number, number, number]
    enableAnimation: boolean
  }): void
  addLayer(layer: Layer): void
  removeLayer(layer: Layer): void
  enableScrollWheelZoom?(enable: boolean): void
  addEventListener(name: string, handler: () => void): void
  removeEventListener(name: string, handler: () => void): void
  getCenter?(): Point
  getZoom?(): number
  pointToPixel?(point: Point): { x: number; y: number }
  getBounds?(): { getSouthWest(): Point; getNorthEast(): Point }
  destroy?(): void
}
type Namespace = {
  Map: new (container: HTMLElement) => NativeMap
  Point: new (longitude: number, latitude: number) => Point
  ClusterLayer: new (config: {
    clusterRadius: number; enablePicked: boolean
    fitViewOnClick: boolean; updateRealTime: boolean; idKey: string
    clusterMaxZoom: number
    clusterIconSize?: () => [number, number]
    clusterIcon?: (properties: unknown) => HTMLCanvasElement
    singleStyle?: { icon: HTMLCanvasElement; iconSize: [number, number] }
  }) => Layer
  Convertor: new () => {
    translate(points: Point[], from: 1, to: 5,
      callback: (reply: unknown) => void): void
  }
}
type Runtime = {
  namespace: Namespace
  map: NativeMap
  layer: Layer
  // Converted BD09 points are reused when the Owner's paged Places list grows.
  converted: Map<string, {
    source: XDriveBaiduWGS84Marker
    feature: XDriveBaiduConvertedFeatureCollection['features'][number]
  }>
  rendered: XDriveBaiduConvertedFeatureCollection
}
type BaiduJSAPI4CapabilitySet = 'legacy-prototype' | 'authorized-cells'
const loaded = new WeakMap<Document, {
  ak: string; capabilities: BaiduJSAPI4CapabilitySet; promise: Promise<Namespace>
}>()
// Each browser document receives a one-shot, collision-free SDK callback.
// Baidu JSAPI4's async contract signals readiness via the callback query.
let nextJSAPI4CallbackID = 0
const validAK = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 &&
  /^[\x21-\x7e]+$/.test(value)


class XDriveBaiduPrototypeFailure extends Error {
  constructor(readonly code: XDriveBaiduMapDiagnosticCode) {
    super('baidu_prototype_runtime_failed')
  }
}

/** Real browser SDK loader; exported only for source-exact failure regressions. */
export function loadBaiduJSAPI4(
  doc: Document, ak: string,
  capabilities: BaiduJSAPI4CapabilitySet = 'legacy-prototype',
): Promise<Namespace> {
  if (!validAK(ak)) return Promise.reject(
    new XDriveBaiduPrototypeFailure('prototype_config_invalid'))
  if (!doc.defaultView) return Promise.reject(
    new XDriveBaiduPrototypeFailure('prototype_document_unavailable'))
  const existing = loaded.get(doc)
  if (existing) {
    if (existing.ak !== ak) return Promise.reject(
      new XDriveBaiduPrototypeFailure('prototype_ak_rotated'))
    // A document must never silently mix the historical WGS84/ClusterLayer
    // runtime with the new Owner-authorized BD-09 Cell-only SDK host.
    return existing.capabilities === capabilities ? existing.promise : Promise.reject(
      new XDriveBaiduPrototypeFailure('prototype_sdk_namespace_missing'))
  }
  const promise = new Promise<Namespace>((resolve, reject) => {
    let script: HTMLScriptElement
    try { script = doc.createElement('script') }
    catch {
      reject(new XDriveBaiduPrototypeFailure('prototype_sdk_script_injection_failed'))
      return
    }
    let settled = false
    let bootstrapLoaded = false
    let callbackObserved = false
    const browser = doc.defaultView as unknown as Window & Record<string, unknown> & { BMap?: Namespace }
    const callbackName = '__xDriveBaiduJSAPI4Ready' + (++nextJSAPI4CallbackID)
    let onProviderReady: () => void = () => {}
    let poll: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const missingCapability = (): XDriveBaiduMapDiagnosticCode | null => {
      try {
        const value = (doc.defaultView as Window & { BMap?: unknown }).BMap
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
          return 'prototype_sdk_namespace_missing'
        }
        const api = value as Partial<Namespace>
        if (typeof api.Map !== 'function') return 'sdk_missing_map'
        if (typeof api.Point !== 'function') return 'sdk_missing_point'
        // The current shared Gallery Cell/Camera/Viewer host consumes only
        // already-approved BD-09 points; it never converts raw WGS84 or
        // constructs a legacy client-side ClusterLayer.
        if (capabilities === 'authorized-cells') {
          return typeof (api as Partial<Namespace> & { Label?: unknown }).Label === 'function'
            ? null : 'sdk_missing_label'
        }
        if (typeof api.Convertor !== 'function') return 'sdk_missing_convertor'
        if (typeof api.ClusterLayer !== 'function') return 'sdk_missing_cluster_layer'
        return null
      } catch { return 'prototype_sdk_namespace_missing' }
    }
    const cleanup = (error?: Error, sdk?: Namespace) => {
      if (settled) return
      settled = true
      if (poll) clearTimeout(poll)
      if (timeout) clearTimeout(timeout)
      // An AK-bearing provider request must not leave global callbacks behind
      // after success, failure, timeout or a retry. Never remove another value.
      try {
        if (browser[callbackName] === onProviderReady) delete browser[callbackName]
      } catch { /* an embedded WebView may reject property deletion */ }
      try { doc.removeEventListener('securitypolicyviolation', onPolicyViolation) }
      catch { /* some WebViews have no event API */ }
      script.onload = script.onerror = null
      if (error || !sdk) {
        try { script.remove() } catch { /* detached or restricted document */ }
        reject(error ?? new XDriveBaiduPrototypeFailure('prototype_sdk_namespace_missing'))
      } else resolve(sdk)
    }
    // Do not store or return blockedURI: it can include the public Browser AK.
    const onPolicyViolation = (event: Event) => {
      const violation = event as SecurityPolicyViolationEvent
      if (violation.disposition !== 'enforce' ||
          !['script-src', 'script-src-elem'].includes(violation.effectiveDirective)) return
      try {
        if (new URL(violation.blockedURI).origin === 'https://api.map.baidu.com') {
          cleanup(new XDriveBaiduPrototypeFailure('prototype_csp_script_blocked'))
        }
      } catch { /* opaque URI: script.onerror remains a safe fallback */ }
    }
    try { doc.addEventListener('securitypolicyviolation', onPolicyViolation) }
    catch { /* script.onerror still reports SDK load failure */ }
    const ready = () => {
      if (!callbackObserved || settled) return
      if (missingCapability() === null) {
        try { cleanup(undefined, (doc.defaultView as Window & { BMap?: Namespace }).BMap) }
        catch { cleanup(new XDriveBaiduPrototypeFailure('prototype_sdk_namespace_missing')) }
      } else poll = setTimeout(ready, 100)
    }
    // script.onload only proves that the bootstrap response was fetched, NOT
    // that the asynchronous JSAPI runtime established window.BMap. Baidu's
    // documented callback fires when its initialization has completed.
    onProviderReady = () => {
      if (settled || callbackObserved) return
      callbackObserved = true
      ready()
    }
    // Public Browser AK goes only to Baidu SDK, never into diagnostics.
    // This direct browser request is NOT the Admin fixed Server Loader probe.
    try {
      if (Object.prototype.hasOwnProperty.call(browser, callbackName)) {
        throw new Error('callback_name_conflict')
      }
      // Register BEFORE setting src/inserting script; the SDK may invoke the
      // callback synchronously or before script.onload in some browsers.
      browser[callbackName] = onProviderReady
      if (browser[callbackName] !== onProviderReady) {
        throw new Error('callback_registration_failed')
      }
      script.src = 'https://api.map.baidu.com/api?v=4.0&ak=' +
        encodeURIComponent(ak) + '&callback=' + callbackName
      script.async = true
      script.referrerPolicy = 'strict-origin-when-cross-origin'
      script.onload = () => { bootstrapLoaded = true }
      script.onerror = () => cleanup(
        new XDriveBaiduPrototypeFailure('prototype_sdk_script_failed'))
      timeout = setTimeout(() => cleanup(new XDriveBaiduPrototypeFailure(
        !bootstrapLoaded && !callbackObserved ? 'prototype_sdk_script_timeout'
          : !callbackObserved ? 'prototype_sdk_callback_timeout'
            : (missingCapability() ?? 'prototype_sdk_namespace_missing'))), 12000)
      doc.head.appendChild(script)
    } catch {
      cleanup(new XDriveBaiduPrototypeFailure('prototype_sdk_script_injection_failed'))
    }
  })
  loaded.set(doc, { ak, capabilities, promise })
  void promise.catch(() => {
    if (loaded.get(doc)?.promise === promise) loaded.delete(doc)
  })
  return promise
}

function validMarker(place: MediaPlaceFacet): place is MediaPlaceFacet & {
  sample_latitude: number; sample_longitude: number
} {
  return !!place && (/^place:-?\d+:-?\d+$/.test(place.id) ||
    (place.id.startsWith('map-region:') && place.id.length <= 200)) &&
    Number.isFinite(place.sample_latitude) && Number.isFinite(place.sample_longitude) &&
    Math.abs(place.sample_latitude!) <= 85 && Math.abs(place.sample_longitude!) <= 180 &&
    Number.isSafeInteger(place.item_count) && place.item_count > 0
}

/** The map engine owns gestures, projection and ClusterLayer. xDrive owns only
 * Owner-scoped GPS facets and opening the existing photo wall/Viewer.
 * No static PNG overlay, CSS-pixel Mercator or separate HTTPS Child.
 * Prototype: third-party JS runs in this Gallery document by user decision. */
export function XDriveMediaGalleryBaiduPrototypeMap({
  getPrototypeConfig,
  listPlacesMapOverview,
  initialNativeCamera,
  onNativeCameraChange,
  onOpenPlace,
  onOpenViewportPhotos,
  onInvalidated,
  loadThumbnail,
  diagnosticScope,
}: {
  getPrototypeConfig: (signal: AbortSignal) => Promise<XDriveBaiduJSAPIPrototypeConfig>
  listPlacesMapOverview: (bounds: MediaPlacesViewportBounds, detail?: boolean,
    signal?: AbortSignal) => Promise<MediaPlacesMapOverview>
  initialNativeCamera?: XDriveBaiduNativeCameraSnapshot
  onNativeCameraChange?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenViewportPhotos?: (bounds: MediaPlacesViewportBounds) => void
  onInvalidated?: () => void
  loadThumbnail?: MediaThumbnailLoader
  diagnosticScope?: string
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const manualCamera = useRef(false)
  const openRef = useRef(onOpenPlace)
  const viewportPhotosRef = useRef(onOpenViewportPhotos)
  const invalidateRef = useRef(onInvalidated)
  const openMapItemRef = useRef<(place: MediaPlaceFacet, map: NativeMap, api: Namespace) => void>(() => {})
  const cameraRef = useRef(onNativeCameraChange)
  // Entering the default same-document Places mode starts a bounded,
  // Owner-scoped representative GPS conversion without another opt-in click.
  // Keep the on-map third-party disclosure and a full-document isolated exit.
  const [places, setPlaces] = useState<readonly MediaPlaceFacet[]>([])
  const [dataError, setDataError] = useState('')
  const [dataLoading, setDataLoading] = useState(true)
  const [overviewRetry, setOverviewRetry] = useState(0)
  const [canBrowseNearby, setCanBrowseNearby] = useState(false)
  const placesRef = useRef(places)
  const renderedRef = useRef<XDriveBaiduConvertedFeatureCollection>({
    type: 'FeatureCollection', features: [],
  })
  const refreshCoversRef = useRef<() => void>(() => {})
  const clusterFrameRef = useRef<unknown>(null)
  // Gesture-start can precede map moveend by many frames. Prevent an old
  // official Convertor callback from resurrecting past-camera thumbnails.
  const conversionAbort = useRef<AbortController | null>(null)
  // A server-accepted, converted Owner frame is clickable ONLY until the
  // next viewport query or user gesture. Keep stale SDK click callbacks inert.
  const committedOwnerFrame = useRef(false)
  const [coverPins, setCoverPins] = useState<XDriveBaiduPrototypeCoverPin[]>([])
  const [clusterCovers, setClusterCovers] = useState<XDriveBaiduClusterCover[]>([])
  openRef.current = onOpenPlace
  viewportPhotosRef.current = onOpenViewportPhotos
  invalidateRef.current = onInvalidated
  openMapItemRef.current = (place, map, api) => {
    if (!committedOwnerFrame.current) return
    if (!place.id.startsWith('map-region:')) {
      openRef.current?.(place)
      return
    }
    const feature = renderedRef.current.features.find(f =>
      f.properties.place_id === place.id &&
      f.properties.photo_count === place.item_count)
    if (!feature) return
    const [lng,lat] = feature.geometry.coordinates
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    const zoom = map.getZoom?.() ?? 3
    if (zoom >= 20 && viewportPhotosRef.current) {
      // Never pass raw BD09 camera bounds or an invalid global fallback to the
      // trusted Gallery WGS84 query. This action is approximate, not exact Range.
      const envelope = xDriveBaiduPrototypeNearbyActionBounds(map.getBounds?.(), zoom)
      if (envelope) viewportPhotosRef.current(envelope)
    } else {
      map.centerAndZoom(new api.Point(lng,lat),
        Math.min(21, Math.max(4, zoom + 3)))
    }
  }
  cameraRef.current = onNativeCameraChange
  placesRef.current = places
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [conversionAudit, setConversionAudit] = useState<XDriveBaiduConversionAudit | null>(null)
  const [failureCode, setFailureCode] = useState<XDriveBaiduMapDiagnosticCode | null>(null)
  const reportFailure = useCallback((code: XDriveBaiduMapDiagnosticCode) => {
    setFailureCode(code)
    setStatus('failed')
    if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(diagnosticScope, code)
  }, [diagnosticScope])

  useEffect(() => {
    const node = container.current
    if (!node) return
    const abort = new AbortController()
    let map: NativeMap | null = null
    let layer: Layer | null = null
    let click: ((event: unknown) => void) | null = null
    let saveCamera: (() => void) | null = null
    // Only actual in-map gestures end automatic photo overview framing.
    // SDK camera events also fire from setViewport, so they are not enough.
    manualCamera.current = xDriveValidBaiduNativeCameraSnapshot(initialNativeCamera)
    const userGesture = () => {
      manualCamera.current = true
      setCanBrowseNearby(false)
      invalidateRef.current?.()
    }
    node.addEventListener('pointerdown', userGesture)
    node.addEventListener('touchstart', userGesture, { passive: true })
    node.addEventListener('wheel', userGesture, { passive: true })
    node.addEventListener('keydown', userGesture)
    committedOwnerFrame.current = false
    setRuntime(null)
    setStatus('loading')
    setFailureCode(null)
    const start = async () => {
      let config: XDriveBaiduJSAPIPrototypeConfig
      try { config = await getPrototypeConfig(abort.signal) }
      catch (error) {
        throw new XDriveBaiduPrototypeFailure(xDriveClassifyBaiduPrototypeConfigFailure(error))
      }
      if (abort.signal.aborted) return
      if (!config || config.provider !== 'baidu-jsapi-4.0' ||
          !validAK(config.browser_ak)) {
        throw new XDriveBaiduPrototypeFailure('prototype_config_invalid')
      }
      const api = await loadBaiduJSAPI4(node.ownerDocument, config.browser_ak)
      if (abort.signal.aborted) return
      try {
      map = new api.Map(node)
      // Camera returned from Viewer is already BD-09LL; never treat it as WGS84.
      const restored = xDriveValidBaiduNativeCameraSnapshot(initialNativeCamera)
        ? initialNativeCamera : null
      if (restored) {
        map.centerAndZoom(new api.Point(restored.longitude, restored.latitude), restored.zoom)
      } else {
        // The JSAPI owns the projection. A default overview is a BD09 camera,
        // not a fabricated coordinate for any photograph.
        map.centerAndZoom(new api.Point(105, 35), 3)
      }
      map.enableScrollWheelZoom?.(true)
      const markerArt = xDriveCreateBaiduNativePhotoMarkerArt(node.ownerDocument)
      layer = new api.ClusterLayer({
        clusterRadius: 60, enablePicked: true,
        fitViewOnClick: true, updateRealTime: false,
        clusterMaxZoom: 16, idKey: 'id',
        // The full photo-card face must sit INSIDE the official 64px
        // hit target; pointer passthrough then preserves native click-zoom.
        clusterIconSize: () => [64, 64],
        // Override the SDK's yellow/red bubble without replacing its
        // authoritative clustering, native click target or fitViewOnClick.
        clusterIcon: markerArt.clusterIcon,
        singleStyle: { icon: markerArt.singleIcon, iconSize: [64, 64] },
      })
      const activeLayer = layer
      const activeMap = map
      click = (event: unknown) => {
        if (abort.signal.aborted || !committedOwnerFrame.current) return
        const value = (event as { value?: unknown } | null)?.value
        if (!value || typeof value !== 'object') return
        const selected = value as {
          isCluster?: unknown; pointCount?: unknown
          properties?: { place_id?: unknown; photo_count?: unknown }
        }
        // Let fitViewOnClick expand a native cluster. Only an unclustered
        // point with the exact current Owner count may open the photo wall.
        if (selected.isCluster !== false || selected.pointCount !== 1 ||
            !selected.properties ||
            typeof selected.properties.place_id !== 'string' ||
            !Number.isSafeInteger(selected.properties.photo_count) ||
            (selected.properties.photo_count as number) < 1) return
        const place = placesRef.current.find(p =>
          p.id === selected.properties?.place_id &&
          p.item_count === selected.properties?.photo_count)
        if (place) openMapItemRef.current(place, activeMap, api)
      }
      saveCamera = () => {
        if (abort.signal.aborted) return
        const snapshot = xDriveCaptureBaiduNativeCamera(activeMap)
        if (snapshot) cameraRef.current?.(snapshot)
        setCanBrowseNearby(Boolean(committedOwnerFrame.current && manualCamera.current &&
          xDriveBaiduPrototypeNearbyActionBounds(
            activeMap.getBounds?.(), activeMap.getZoom?.() ?? NaN)))
      }
      activeLayer.addEventListener('click', click)
      activeMap.addLayer(activeLayer)
      activeMap.addEventListener('moveend', saveCamera)
      activeMap.addEventListener('zoomend', saveCamera)
      if (abort.signal.aborted) return
      setRuntime({ namespace: api, map: activeMap, layer: activeLayer,
        converted: new Map(),
        rendered: { type: 'FeatureCollection', features: [] } })
      setFailureCode(null)
      if (diagnosticScope) xDriveClearBaiduMapDiagnostic(diagnosticScope)
      setStatus('ready')
      } catch {
        throw new XDriveBaiduPrototypeFailure('prototype_sdk_map_init_failed')
      }
    }
    void start().catch(error => {
      if (abort.signal.aborted) return
      reportFailure(error instanceof XDriveBaiduPrototypeFailure
        ? error.code : 'prototype_sdk_map_init_failed')
    })
    return () => {
      abort.abort()
      node.removeEventListener('pointerdown', userGesture)
      node.removeEventListener('touchstart', userGesture)
      node.removeEventListener('wheel', userGesture)
      node.removeEventListener('keydown', userGesture)
      if (map && saveCamera) {
        map.removeEventListener('moveend', saveCamera)
        map.removeEventListener('zoomend', saveCamera)
      }
      if (layer && click) layer.removeEventListener('click', click)
      if (map && layer) { try { map.removeLayer(layer) } catch { /* disposed */ } }
      try { map?.destroy?.() } catch { /* disposed */ }
    }
  }, [getPrototypeConfig, diagnosticScope, reportFailure])

  // Start the bounded Owner overview when the current map SDK is ready.
  // Subsequent gestures query bounded WGS84 envelopes for local grouping.
  useEffect(() => {
    if (!runtime) return
    let disposed = false
    let request: AbortController | null = null
    let delayed: ReturnType<typeof setTimeout> | undefined
    let lastKey = ''
    const update = (immediate = false) => {
      if (disposed) return
      if (delayed) clearTimeout(delayed)
      const zoom = runtime.map.getZoom?.() ?? 3
      const detail = manualCamera.current && zoom >= 15
      const bounds = manualCamera.current
        ? xDriveBaiduPrototypeOverviewQueryBounds(runtime.map.getBounds?.(), zoom)
        : { ...XDRIVE_BAIDU_WORLD_OVERVIEW }
      // Do not quantize the camera to 0.001 degrees: at zoom 20 that would
      // conceal genuine movements across multiple photo cell boundaries.
      const key = (bounds ? Object.values(bounds).join(':') : 'invalid-camera') +
        ':' + (detail ? '1' : '0')
      if (key === lastKey) return
      request?.abort()
      lastKey = key
      // Invalidate prior camera data immediately, not only after a slow
      // query succeeds. No old Owner/viewport markers survive a pan.
      committedOwnerFrame.current = false
      setCanBrowseNearby(false)
      setPlaces([])
      clusterFrameRef.current = null
      setCoverPins([])
      setClusterCovers([])
      const empty: XDriveBaiduConvertedFeatureCollection = {
        type: 'FeatureCollection', features: [],
      }
      // Only CURRENT Owner markers are cleared. Validated BD-09 derived points
      // remain in the bounded session cache across pan/zoom/Viewer return.
      runtime.converted.clear()
      runtime.rendered = empty
      renderedRef.current = empty
      runtime.layer.setData(empty)
      if (!bounds) {
        setDataLoading(false)
        setDataError('当前地图视窗暂不可读取；请完成拖动或缩放后重试。')
        return
      }
      const load = () => {
        const controller = new AbortController()
        request = controller
        setDataLoading(true)
        setDataError('')
        void listPlacesMapOverview(bounds, detail, controller.signal).then(page => {
          if (disposed || controller.signal.aborted) return
          const ids = new Set<string>()
          if (!page || !Array.isArray(page.items) || page.items.length > 64 ||
              !Number.isSafeInteger(page.total_photo_count) ||
              page.total_photo_count < 0 || typeof page.aggregated !== 'boolean' ||
              page.items.some(item => {
                if (!item || typeof item.id !== 'string' || ids.has(item.id) ||
                    !Number.isSafeInteger(item.item_count) || item.item_count <= 0) return true
                ids.add(item.id)
                return false
              }) || page.items.reduce((n, item) => n + item.item_count, 0) !==
                page.total_photo_count) {
            throw Error('invalid_map_overview')
          }
          setPlaces(page.items)
        }).catch(() => {
          if (!disposed && !controller.signal.aborted) {
            lastKey = ''
            setDataError('当前地图区域加载失败，请移动或缩放后重试。')
          }
        }).finally(() => {
          if (!disposed && !controller.signal.aborted) setDataLoading(false)
        })
      }
      if (immediate) load()
      else delayed = setTimeout(load, 500)
    }
    const refresh = () => update(false)
    const stopOnGesture = () => {
      // SDK may also move the camera programmatically at initial fit, when
      // no user gesture has occurred. Don't cancel the first world summary.
      if (!manualCamera.current) return
      invalidateRef.current?.()
      if (delayed) clearTimeout(delayed)
      delayed = undefined
      request?.abort()
      conversionAbort.current?.abort()
      // SDK-driven cluster/fitView moves are not always preceded by a DOM
      // pointer gesture; cancel the old Owner singleton Viewer intention too.
      invalidateRef.current?.()
      committedOwnerFrame.current = false
      setCanBrowseNearby(false)
      lastKey = ''
      setDataLoading(false)
      // Never mutate ClusterLayer during its own click/fitViewOnClick.
      // The low/high zoom cover observers hide stale thumbnails separately.
    }
    runtime.map.addEventListener('movestart', stopOnGesture)
    runtime.map.addEventListener('zoomstart', stopOnGesture)
    runtime.map.addEventListener('moveend', refresh)
    runtime.map.addEventListener('zoomend', refresh)
    update(true)
    return () => {
      disposed = true
      if (delayed) clearTimeout(delayed)
      request?.abort()
      runtime.map.removeEventListener('movestart', stopOnGesture)
      runtime.map.removeEventListener('zoomstart', stopOnGesture)
      runtime.map.removeEventListener('moveend', refresh)
      runtime.map.removeEventListener('zoomend', refresh)
    }
  }, [runtime, listPlacesMapOverview, overviewRetry])

  // Register the native ClusterLayer change observer before setData:
  // some SDK builds publish the first aggregation synchronously.
  useEffect(() => {
    if (!runtime || !loadThumbnail) {
      setCoverPins([])
      setClusterCovers([])
      clusterFrameRef.current = null
      return
    }
    const refresh = () => {
      const node = container.current
      const map = runtime.map
      if (!committedOwnerFrame.current || !node || !map.getZoom || !map.pointToPixel) {
        setCoverPins([])
        setClusterCovers([])
        return
      }
      const zoom = map.getZoom()
      const projection = {
        pointToPixel: (point: Point) => map.pointToPixel!(point),
      }
      if (zoom >= 17) {
        setClusterCovers([])
        setCoverPins(xDriveProjectBaiduPrototypeCoverPins(
          runtime.rendered, places, {
            getZoom: () => zoom,
            pointToPixel: projection.pointToPixel,
            getBounds: map.getBounds ? () => map.getBounds!() : undefined,
          }, runtime.namespace,
          node.clientWidth, node.clientHeight,
        ))
      } else {
        setCoverPins([])
        setClusterCovers(xDriveProjectBaiduNativeClusterCovers(
          clusterFrameRef.current, runtime.rendered, places,
          projection, runtime.namespace, node.clientWidth, node.clientHeight,
        ))
      }
    }
    const hide = () => {
      setCoverPins([])
      setClusterCovers([])
      clusterFrameRef.current = null
    }
    // The official ClusterLayer change event is the ONLY source of
    // low-zoom visible cluster coordinates and membership extents.
    const onNativeClusters = (event: unknown) => {
      clusterFrameRef.current = event
      refresh()
    }
    const onCameraSettled = () => {
      // SDK change and moveend ordering is not fixed. move/zoom START has
      // already invalidated the old frame; refresh either the newly received
      // native change or the safe empty state, never erase a fresh result.
      refresh()
    }
    refreshCoversRef.current = refresh
    runtime.layer.addEventListener('change', onNativeClusters)
    runtime.map.addEventListener('movestart', hide)
    runtime.map.addEventListener('zoomstart', hide)
    runtime.map.addEventListener('moveend', onCameraSettled)
    runtime.map.addEventListener('zoomend', onCameraSettled)
    refresh()
    return () => {
      refreshCoversRef.current = () => {}
      clusterFrameRef.current = null
      runtime.layer.removeEventListener('change', onNativeClusters)
      runtime.map.removeEventListener('movestart', hide)
      runtime.map.removeEventListener('zoomstart', hide)
      runtime.map.removeEventListener('moveend', onCameraSettled)
      runtime.map.removeEventListener('zoomend', onCameraSettled)
    }
  }, [runtime, places, loadThumbnail])

  useEffect(() => {
    // The same-document mode starts conversion on the current validated Owner
    // overview automatically. A new gesture or teardown cancels stale work.
    if (!runtime) return
    const abort = new AbortController()
    conversionAbort.current = abort
    let phase: 'conversion' | 'layer' = 'conversion'
    // No trusted scope: do NOT share a process-wide cache under a generic
    // fallback key that could accidentally span independent accounts.
    const conversionSession = diagnosticScope
      ? xDriveBaiduConversionSessionForScope(diagnosticScope)
      : new XDriveBaiduJSAPI4ConversionSession()
    const update = async () => {
      committedOwnerFrame.current = false
      const source = places.filter(validMarker)
      const seen = new Set<string>()
      const pending: XDriveBaiduWGS84Marker[] = []
      for (const item of source) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        const marker = { placeID: item.id, latitude: item.sample_latitude,
          longitude: item.sample_longitude, photoCount: item.item_count }
        const old = runtime.converted.get(item.id)
        if (old && old.source.latitude === marker.latitude &&
            old.source.longitude === marker.longitude &&
            old.source.photoCount === marker.photoCount) continue
        pending.push(marker)
      }
      // The existing official Convertor adapter batches 10 WGS84 points at a
      // time, validates BD09 results and cancels on Gallery navigation.
      const convertor = new runtime.namespace.Convertor()
      for (let start = 0; start < pending.length; start += 100) {
        if (abort.signal.aborted) return
        const markers = pending.slice(start, start + 100)
        const total = markers.reduce((sum, item) => sum + item.photoCount, 0)
        const converted = await xDriveConvertBaiduJSAPI4MarkerWindow(
          { kind: 'ready', markers, totalPhotoCount: total },
          convertor,
          (lng, lat) => new runtime.namespace.Point(lng, lat),
          abort.signal, conversionSession,
        )
        if (abort.signal.aborted) return
        converted.features.forEach((feature, i) => runtime.converted.set(
          markers[i].placeID, { source: markers[i], feature },
        ))
      }
      if (abort.signal.aborted) return
      const features = [...runtime.converted.entries()]
        .filter(([id]) => seen.has(id)).map(([, entry]) => entry.feature)
      const collection: XDriveBaiduConvertedFeatureCollection = {
        type: 'FeatureCollection', features,
      }
      // The previous SDK viewport clusters must never accompany a new Owner
      // GeoJSON generation while Baidu is still recalculating the layer.
      clusterFrameRef.current = null
      setClusterCovers([])
      runtime.rendered = collection
      renderedRef.current = collection
      for (const key of runtime.converted.keys()) {
        if (!seen.has(key)) runtime.converted.delete(key)
      }
      phase = 'layer'
      runtime.layer.setData(collection)
      if (abort.signal.aborted) return
      committedOwnerFrame.current = true
      // A gesture's moveend can precede the Owner overview + official
      // Convertor. Enable the nearby Range action only after BOTH succeed.
      setCanBrowseNearby(Boolean(manualCamera.current && features.length > 0 &&
        xDriveBaiduPrototypeNearbyActionBounds(
          runtime.map.getBounds?.(), runtime.map.getZoom?.() ?? NaN)))
      refreshCoversRef.current()
      // Opening Places should show the photo distribution, not an arbitrary
      // hardcoded city. Defer all projection/fit calculations to Baidu JSAPI.
      // Progressive pages can expand the overview until the user takes over;
      // a Viewer-return BD09 camera is already user-controlled and stays put.
      if (!manualCamera.current && features.length) {
        const points = features.map(f => new runtime.namespace.Point(
          f.geometry.coordinates[0], f.geometry.coordinates[1]))
        if (points.length === 1) {
          runtime.map.centerAndZoom(points[0], 12)
        } else {
          runtime.map.setViewport?.(points, {
            margins: [20, 20, 20, 20], enableAnimation: false,
          })
        }
      }
    }
    void update().catch(() => {
      if (abort.signal.aborted) return
      reportFailure(phase === 'conversion'
        ? 'prototype_sdk_convert_failed' : 'prototype_sdk_layer_update_failed')
    }).finally(() => {
      if (!abort.signal.aborted) setConversionAudit(conversionSession.audit())
    })
    return () => {
      abort.abort()
      if (conversionAbort.current === abort) conversionAbort.current = null
    }
  }, [runtime, places, reportFailure, diagnosticScope])

  return (
    <Box component="section" data-xdrive-gallery-baidu-prototype
      sx={{ px: { xs: 0, sm: 1.5 }, pb: 1.5, minWidth: 0 }}>
      <Stack data-xdrive-baidu-prototype-auto-gps-notice direction={{ xs: 'column', sm: 'row' }}
        spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}
        sx={{ px: { xs: 1, sm: 1.5 }, py: 0.75 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          已自动启用同页定位照片聚合。xDrive 会通过百度官方 Convertor 向百度发送
          当前视窗最多 64 组原始 WGS84 GPS 代表坐标；平移、缩放可能继续发送，
          已发送的定位无法撤回。第三方脚本运行在图库主文档，不具备独立 Origin 安全隔离。
        </Typography>
        <Button data-xdrive-baidu-prototype-gps-stop
          size="small" variant="text" onClick={() => {
            // A reload would immediately restart the default GPS conversion.
            // Use a new document in the isolated mode to stop the old SDK.
            if (typeof window === 'undefined') return
            const target = xDrivePlacesMapModeNavigationURL(window.location.href, 'isolated')
            if (target) window.location.replace(target)
          }}>停止共享并切换安全隔离版</Button>
      </Stack>
      <Box sx={{ position: 'relative' }}>
      <Box ref={container} role="region" aria-label="百度动态照片地图"
        data-xdrive-gallery-baidu-prototype-canvas
        sx={{ width: '100%', height: { xs: 'calc(100dvh - 215px)', sm: 540 },
          minHeight: 370, borderRadius: { xs: 0, sm: 1.5 }, overflow: 'hidden' }} />
      {loadThumbnail ? clusterCovers.map(pin => (
        // Verified Owner cover sits exactly ON TOP of its native pick target.
        // Unknown memberships display the neutral SDK marker, never fake N 张.
        <Box key={pin.id} data-xdrive-baidu-native-cluster-cover={pin.id}
          aria-hidden="true"
          sx={{
            position: 'absolute', pointerEvents: 'none', zIndex: 4,
            left: pin.x - 30, top: pin.y - 30,
            width: 60, height: 60,
            border: '2px solid white', borderRadius: 2,
            bgcolor: 'background.paper',
            boxShadow: '0 3px 12px rgba(15,23,42,.28)',
          }}>
          <Box sx={{ width: '100%', height: '100%', borderRadius: 1.5,
            overflow: 'hidden' }}>
            <XDriveMediaGalleryCoverThumbnail
              nodeID={pin.nodeID} alt="" loadThumbnail={loadThumbnail}
              fallback={<PhotoLibraryOutlinedIcon color="disabled" />}
            />
          </Box>
          <Box component="span" sx={{
            position: 'absolute', right: -6, bottom: -6,
            bgcolor: 'rgba(15,23,42,.94)', color: '#fff',
            borderRadius: '999px', px: 0.75, minWidth: 27, maxWidth: 100,
            fontSize: 11, fontWeight: 700, lineHeight: '21px',
            textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{pin.photoCount.toLocaleString('zh-CN')}张</Box>
        </Box>
      )) : null}
      {loadThumbnail ? coverPins.map(pin => (
        <Box component="button" type="button" key={pin.placeID}
          data-xdrive-baidu-photo-cover={pin.placeID}
          aria-label={pin.name + '，' + pin.photoCount + ' 张照片'}
          title={pin.name}
          onClick={() => {
            if (!committedOwnerFrame.current) return
            const current = placesRef.current.find(p =>
              p.id === pin.placeID && p.cover_node_id === pin.nodeID &&
              p.item_count === pin.photoCount)
            if (current && runtime) openMapItemRef.current(current, runtime.map, runtime.namespace)
          }}
          sx={{
            position: 'absolute', zIndex: 4, left: pin.x - 30, top: pin.y - 30,
            width: 60, height: 60, display: 'block', p: 0,
            border: '2px solid white', borderRadius: 2,
            backgroundColor: 'background.paper', cursor: 'pointer',
            boxShadow: '0 3px 12px rgba(15,23,42,.28)',
          }}>
          <Box sx={{ width: '100%', height: '100%', borderRadius: 1.5,
            overflow: 'hidden' }}>
            <XDriveMediaGalleryCoverThumbnail
              nodeID={pin.nodeID} alt={pin.name} loadThumbnail={loadThumbnail}
              fallback={<PhotoLibraryOutlinedIcon color="disabled" />}
            />
          </Box>
          <Box component="span" sx={{
            position: 'absolute', right: -6, bottom: -6,
            bgcolor: 'rgba(15,23,42,.94)', color: '#fff',
            borderRadius: '999px', px: 0.75, minWidth: 27, maxWidth: 100,
            fontSize: 11, fontWeight: 700, lineHeight: '21px',
            textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{pin.photoCount.toLocaleString('zh-CN')}张</Box>
        </Box>
      )) : null}
      </Box>
      {onOpenViewportPhotos ? (
        <Stack direction="row" spacing={1} alignItems="center"
          sx={{ px: { xs: 1, sm: 1.5 }, py: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined"
            data-xdrive-baidu-prototype-nearby
            disabled={!canBrowseNearby || !runtime ||
              !committedOwnerFrame.current}
            onClick={() => {
              if (!runtime || !manualCamera.current || !committedOwnerFrame.current) return
              const bounds = xDriveBaiduPrototypeNearbyActionBounds(
                runtime.map.getBounds?.(), runtime.map.getZoom?.() ?? NaN,
              )
              if (bounds) viewportPhotosRef.current?.(bounds)
            }}>查看当前地图附近照片</Button>
          <Typography variant="caption" color="text.secondary">
            {canBrowseNearby
              ? '使用当前视窗的保守 GPS 附近范围，可能包含画面外的照片。'
              : '放大地图并停止拖动后，可查看附近照片。'}
          </Typography>
        </Stack>
      ) : null}
      {conversionAudit ? (
        <Box component="details" data-xdrive-baidu-conversion-audit
          sx={{ mx: { xs: 1, sm: 1.5 }, my: 0.5 }}>
          <Box component="summary" sx={{ typography: 'caption', color:'text.secondary',
            cursor:'pointer', minHeight: 32 }}>
            本次地图会话转换统计
          </Box>
          <Typography variant="caption" color="text.secondary">
            方法调用 {conversionAudit.method_calls} 次，
            提交坐标点 {conversionAudit.submitted_points} 个，
            成功转换 {conversionAudit.converted_points} 个，
            缓存命中 {conversionAudit.cache_hits} 次
            （{conversionAudit.cache_hit_rate_percent}%），
            取消 {conversionAudit.cancelled} 次，
            失败 {conversionAudit.failed} 次，
            每秒峰值 {conversionAudit.peak_method_calls_per_second} 次。
            仅统计本窗口 JS Convertor；不代表百度账号的全局请求数量。
          </Typography>
        </Box>
      ) : null}
      {dataLoading && status === 'ready' ? (
        <Typography role="status" variant="caption" sx={{ px: 1.5 }}>
          正在读取当前地图区域照片…
        </Typography>
      ) : null}
      {dataError ? (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap"
          sx={{ px: 1.5, py: 1 }}>
          <Typography role="alert" variant="caption">{dataError}</Typography>
          <Button size="small" variant="outlined"
            data-xdrive-baidu-prototype-retry
            disabled={!runtime || dataLoading}
            onClick={() => setOverviewRetry(n => n + 1)}>
            重试当前视窗
          </Button>
        </Stack>
      ) : null}
      {status === 'failed' ? (
        <Box data-xdrive-baidu-prototype-error sx={{ px: 1.5, py: 1 }}>
          <Typography role="alert" variant="body2" color="error">
            百度动态地图不可用；地点列表和照片墙仍可使用。
          </Typography>
          {failureCode ? (
            <>
              <Typography variant="body2" data-xdrive-baidu-prototype-error-code
                sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                原因：{xDriveBaiduMapDiagnosticDetails[failureCode].title}
                {' · '}错误码：{failureCode}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                处理：{xDriveBaiduMapDiagnosticDetails[failureCode].action}
              </Typography>
            </>
          ) : null}
        </Box>
      ) : status === 'loading' ? (
        <Typography role="status" variant="caption" sx={{ px: 1.5 }}>
          正在加载百度动态地图…
        </Typography>
      ) : null}
    </Box>
  )
}
