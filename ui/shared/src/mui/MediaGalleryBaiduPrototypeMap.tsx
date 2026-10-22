import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import type { MediaThumbnailLoader } from './MediaGallery'
import {
  xDriveProjectBaiduPrototypeCoverPins,
} from '../media-gallery-baidu-prototype-cover-pins'
import type { XDriveBaiduPrototypeCoverPin } from '../media-gallery-baidu-prototype-cover-pins'
import type { MediaPlaceFacet, XDriveBaiduJSAPIPrototypeConfig } from '../models'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import {
  xDriveBaiduMapDiagnosticDetails, xDriveRecordBaiduMapDiagnostic,
  xDriveClearBaiduMapDiagnostic, xDriveClassifyBaiduPrototypeConfigFailure,
} from '../media-gallery-baidu-diagnostics'
import type { XDriveBaiduMapDiagnosticCode } from '../media-gallery-baidu-diagnostics'
import { xDriveCaptureBaiduNativeCamera, xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import {
  xDriveConvertBaiduJSAPI4MarkerWindow,
} from '../media-gallery-baidu-jsapi4-markers'
import type { XDriveBaiduConvertedFeatureCollection, XDriveBaiduWGS84Marker } from '../media-gallery-baidu-jsapi4-markers'

type Point = { lng: number; lat: number }
type Layer = {
  setData(data: XDriveBaiduConvertedFeatureCollection): void
  addEventListener(name: 'click', handler: (event: unknown) => void): void
  removeEventListener(name: 'click', handler: (event: unknown) => void): void
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
const loaded = new WeakMap<Document, {
  ak: string; promise: Promise<Namespace>
}>()
const validAK = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 &&
  /^[\x21-\x7e]+$/.test(value)


class XDriveBaiduPrototypeFailure extends Error {
  constructor(readonly code: XDriveBaiduMapDiagnosticCode) {
    super('baidu_prototype_runtime_failed')
  }
}

/** Real browser SDK loader; exported only for source-exact failure regressions. */
export function loadBaiduJSAPI4(doc: Document, ak: string): Promise<Namespace> {
  if (!validAK(ak)) return Promise.reject(
    new XDriveBaiduPrototypeFailure('prototype_config_invalid'))
  if (!doc.defaultView) return Promise.reject(
    new XDriveBaiduPrototypeFailure('prototype_document_unavailable'))
  const existing = loaded.get(doc)
  if (existing) {
    return existing.ak === ak ? existing.promise : Promise.reject(
      new XDriveBaiduPrototypeFailure('prototype_ak_rotated'))
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
      try { doc.removeEventListener('securitypolicyviolation', onPolicyViolation) }
      catch { /* some WebViews have no event API */ }
      script.onload = script.onerror = null
      if (error || !sdk) {
        script.remove()
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
      if (!bootstrapLoaded || settled) return
      if (missingCapability() === null) {
        try { cleanup(undefined, (doc.defaultView as Window & { BMap?: Namespace }).BMap) }
        catch { cleanup(new XDriveBaiduPrototypeFailure('prototype_sdk_namespace_missing')) }
      } else poll = setTimeout(ready, 100)
    }
    // Public Browser AK goes only to Baidu SDK, never into diagnostics.
    // This direct browser request is NOT the Admin fixed Server Loader probe.
    try {
      script.src = 'https://api.map.baidu.com/api?v=4.0&ak=' + encodeURIComponent(ak)
      script.async = true
      script.referrerPolicy = 'strict-origin-when-cross-origin'
      script.onload = () => { bootstrapLoaded = true; ready() }
      script.onerror = () => cleanup(
        new XDriveBaiduPrototypeFailure('prototype_sdk_script_failed'))
      timeout = setTimeout(() => cleanup(new XDriveBaiduPrototypeFailure(
        bootstrapLoaded ? (missingCapability() ?? 'prototype_sdk_namespace_missing')
          : 'prototype_sdk_script_timeout')), 12000)
      doc.head.appendChild(script)
    } catch {
      cleanup(new XDriveBaiduPrototypeFailure('prototype_sdk_script_injection_failed'))
    }
  })
  loaded.set(doc, { ak, promise })
  void promise.catch(() => {
    if (loaded.get(doc)?.promise === promise) loaded.delete(doc)
  })
  return promise
}

function validMarker(place: MediaPlaceFacet): place is MediaPlaceFacet & {
  sample_latitude: number; sample_longitude: number
} {
  return !!place && /^place:-?\d+:-?\d+$/.test(place.id) &&
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
  places,
  initialNativeCamera,
  onNativeCameraChange,
  onOpenPlace,
  loadThumbnail,
  diagnosticScope,
}: {
  getPrototypeConfig: (signal: AbortSignal) => Promise<XDriveBaiduJSAPIPrototypeConfig>
  places: readonly MediaPlaceFacet[]
  initialNativeCamera?: XDriveBaiduNativeCameraSnapshot
  onNativeCameraChange?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onOpenPlace?: (place: MediaPlaceFacet) => void
  loadThumbnail?: MediaThumbnailLoader
  diagnosticScope?: string
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const manualCamera = useRef(false)
  const openRef = useRef(onOpenPlace)
  const cameraRef = useRef(onNativeCameraChange)
  const placesRef = useRef(places)
  const refreshCoversRef = useRef<() => void>(() => {})
  const [coverPins, setCoverPins] = useState<XDriveBaiduPrototypeCoverPin[]>([])
  openRef.current = onOpenPlace
  cameraRef.current = onNativeCameraChange
  placesRef.current = places
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
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
    const userGesture = () => { manualCamera.current = true }
    node.addEventListener('pointerdown', userGesture)
    node.addEventListener('touchstart', userGesture, { passive: true })
    node.addEventListener('wheel', userGesture, { passive: true })
    node.addEventListener('keydown', userGesture)
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
      layer = new api.ClusterLayer({
        clusterRadius: 60, enablePicked: true,
        fitViewOnClick: true, updateRealTime: false,
        clusterMaxZoom: 16, idKey: 'id',
      })
      const activeLayer = layer
      const activeMap = map
      click = (event: unknown) => {
        if (abort.signal.aborted) return
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
        if (place) openRef.current?.(place)
      }
      saveCamera = () => {
        const snapshot = xDriveCaptureBaiduNativeCamera(activeMap)
        if (!abort.signal.aborted && snapshot) cameraRef.current?.(snapshot)
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

  useEffect(() => {
    if (!runtime) return
    const abort = new AbortController()
    let phase: 'conversion' | 'layer' = 'conversion'
    const update = async () => {
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
          abort.signal,
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
      phase = 'layer'
      runtime.layer.setData(collection)
      runtime.rendered = collection
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
    })
    return () => abort.abort()
  }, [runtime, places, reportFailure])

  useEffect(() => {
    if (!runtime || !loadThumbnail) {
      setCoverPins([])
      return
    }
    const refresh = () => {
      const node = container.current
      const map = runtime.map
      if (!node || !map.getZoom || !map.pointToPixel) {
        setCoverPins([])
        return
      }
      setCoverPins(xDriveProjectBaiduPrototypeCoverPins(
        runtime.rendered, places, {
          getZoom: () => map.getZoom!(),
          pointToPixel: (point) => map.pointToPixel!(point),
          getBounds: map.getBounds ? () => map.getBounds!() : undefined,
        }, runtime.namespace,
        node.clientWidth, node.clientHeight,
      ))
    }
    const hide = () => setCoverPins([])
    refreshCoversRef.current = refresh
    runtime.map.addEventListener('movestart', hide)
    runtime.map.addEventListener('zoomstart', hide)
    runtime.map.addEventListener('moveend', refresh)
    runtime.map.addEventListener('zoomend', refresh)
    refresh()
    return () => {
      refreshCoversRef.current = () => {}
      runtime.map.removeEventListener('movestart', hide)
      runtime.map.removeEventListener('zoomstart', hide)
      runtime.map.removeEventListener('moveend', refresh)
      runtime.map.removeEventListener('zoomend', refresh)
    }
  }, [runtime, places, loadThumbnail])

  return (
    <Box component="section" data-xdrive-gallery-baidu-prototype
      sx={{ px: { xs: 0, sm: 1.5 }, pb: 1.5, minWidth: 0 }}>
      <Box sx={{ position: 'relative' }}>
      <Box ref={container} role="region" aria-label="百度动态照片地图"
        data-xdrive-gallery-baidu-prototype-canvas
        sx={{ width: '100%', height: { xs: 'calc(100dvh - 215px)', sm: 540 },
          minHeight: 370, borderRadius: { xs: 0, sm: 1.5 }, overflow: 'hidden' }} />
      {loadThumbnail ? coverPins.map(pin => (
        <Box component="button" type="button" key={pin.placeID}
          data-xdrive-baidu-photo-cover={pin.placeID}
          aria-label={pin.name + '，' + pin.photoCount + ' 张照片'}
          title={pin.name}
          onClick={() => {
            const current = placesRef.current.find(p =>
              p.id === pin.placeID && p.cover_node_id === pin.nodeID &&
              p.item_count === pin.photoCount)
            if (current) openRef.current?.(current)
          }}
          sx={{
            position: 'absolute', zIndex: 4, left: pin.x - 30, top: pin.y - 66,
            width: 60, height: 62, display: 'block', p: 0,
            border: '3px solid white', borderRadius: '11px',
            backgroundColor: 'background.paper', cursor: 'pointer',
            boxShadow: 2, overflow: 'visible',
          }}>
          <Box sx={{ width: '100%', height: '100%', borderRadius: '8px',
            overflow: 'hidden' }}>
            <XDriveMediaGalleryCoverThumbnail
              nodeID={pin.nodeID} alt={pin.name} loadThumbnail={loadThumbnail}
              fallback={<PhotoLibraryOutlinedIcon color="disabled" />}
            />
          </Box>
          <Box component="span" sx={{
            position: 'absolute', bottom: -8, right: -10,
            bgcolor: 'background.paper', border: 1,
            borderColor: 'divider', borderRadius: '12px',
            fontSize: 11, fontWeight: 700, px: 0.7, lineHeight: '20px',
            minWidth: 22, textAlign: 'center',
          }}>{pin.photoCount}</Box>
        </Box>
      )) : null}
      </Box>
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
