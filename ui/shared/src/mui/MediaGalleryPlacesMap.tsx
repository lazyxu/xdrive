import { useCallback, useEffect, useRef, useState } from 'react'
import { Autocomplete, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type {
  MediaPlaceFacet,
  MediaPlacesPage,
  MediaPlacesViewportBounds,
  MediaPlacesViewportPage,
  XDriveBaiduMapProviderInfo,
  XDriveBaiduStaticMapRequest,
} from '../models'
import { XDriveMediaGalleryBaiduStaticMap } from './MediaGalleryBaiduStaticMap'
import { XDriveMediaGalleryBaiduPrototypeMap } from './MediaGalleryBaiduPrototypeMap'
import { XDriveMediaGalleryBaiduIsolatedPhotoSurface } from './MediaGalleryBaiduIsolatedPhotoSurface'
import type { XDriveBaiduJSAPI4AuthorizedMountPort } from '../media-gallery-baidu-jsapi4-mount'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { useXDriveDeferredLoading } from './useDeferredLoading'
import {
  xDriveRecordBaiduMapDiagnostic, xDriveClassifyBaiduMapRequestFailure,
  xDriveReadBaiduMapDiagnostic, xDriveSubscribeBaiduMapDiagnostics,
  xDriveBaiduMapDiagnosticDetails, XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS,
} from '../media-gallery-baidu-diagnostics'
import type { XDriveBaiduMapDiagnostic } from '../media-gallery-baidu-diagnostics'
import { xDriveValidPlacesCameraSnapshot } from '../media-gallery-places-camera-session'
import type { XDrivePlacesCameraPosition, XDrivePlacesCameraSnapshot, XDrivePlacesViewportCamera } from '../media-gallery-places-camera-session'

function sameViewport(a: MediaPlacesViewportBounds | null, b: MediaPlacesViewportBounds) {
  return Boolean(a && a.west === b.west && a.south === b.south &&
    a.east === b.east && a.north === b.north)
}

/** Gallery's direct prototype uses native Baidu JSAPI4 for all gestures,
 * projection and clustering; the legacy Static map remains only as a fallback. */
export function XDriveMediaGalleryPlacesMap({
  places,
  totalCount,
  listPlacesPage,
  listPlacesViewport,
  initialCamera,
  onCameraChange,
  initialNativeCamera,
  onNativeCameraChange,
  onNativeCameraClear,
  getBaiduMapProvider,
  loadBaiduStaticMap,
  listBaiduNativeViewport,
  listBaiduNativeCells,
  loadPhotoCoverThumbnail,
  getBaiduJSAPI4Status,
  getBaiduJSAPIPrototype,
  mintBaiduJSAPI4Session,
  mintBaiduIsolatedChildTicket,
  onOpenBaiduNativePhoto,
  onOpenBaiduNativeCell,
  selectedNativeCell,
  onBaiduNativeCellInvalidated,
  onOpenSecureDesktopMap,
  diagnosticScope,
  onOpenDiagnostics,
  authorizedJSAPI4Runtime,
  activePlaceID,
  focusPlaceID,
  onOpenPlace,
  onOpenNearby,
  onOpenViewportPhotos,
}: {
  places: MediaPlaceFacet[]
  totalCount?: number | null
  listPlacesPage?: (limit?: number,offset?: number) => Promise<MediaPlacesPage>
  listPlacesViewport?: (bounds: MediaPlacesViewportBounds, limit?: number, offset?: number,
    signal?: AbortSignal) => Promise<MediaPlacesViewportPage>
  initialCamera?: XDrivePlacesCameraSnapshot
  onCameraChange?: (camera: XDrivePlacesViewportCamera) => void
  initialNativeCamera?: XDriveBaiduNativeCameraSnapshot
  onNativeCameraChange?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onNativeCameraClear?: () => void
  getBaiduMapProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadBaiduStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
  listBaiduNativeViewport?: import('./MediaGallery').MediaGalleryDataSource['listBaiduNativeViewport']
  listBaiduNativeCells?: import('./MediaGallery').MediaGalleryDataSource['listBaiduNativeCells']
  loadPhotoCoverThumbnail?: import('./MediaGallery').MediaThumbnailLoader
  getBaiduJSAPI4Status?: import('./MediaGallery').MediaGalleryDataSource['getBaiduJSAPI4Status']
  getBaiduJSAPIPrototype?: import('./MediaGallery').MediaGalleryDataSource['getBaiduJSAPIPrototype']
  mintBaiduJSAPI4Session?: import('./MediaGallery').MediaGalleryDataSource['mintBaiduJSAPI4Session']
  mintBaiduIsolatedChildTicket?: import('./MediaGallery').MediaGalleryDataSource['mintBaiduIsolatedChildTicket']
  onOpenBaiduNativePhoto?: (identity: { assetID: number; nodeID: number }) => void
  onOpenBaiduNativeCell?: (selection: import('../models').MediaBaiduNativeCellSelection) => void
  selectedNativeCell?: import('../models').MediaBaiduNativeCellSelection
  onBaiduNativeCellInvalidated?: () => void
  onOpenSecureDesktopMap?: () => void
  diagnosticScope?: string
  onOpenDiagnostics?: () => void
  /** Only supplied by a future independently released Server-authorized proxy.
   * Production currently supplies NO runtime, so there are zero SDK requests. */
  authorizedJSAPI4Runtime?: XDriveBaiduJSAPI4AuthorizedMountPort
  activePlaceID?: string
  focusPlaceID?: string
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenNearby?: (place: MediaPlaceFacet, radiusKM: number) => void
  onOpenViewportPhotos?: (bounds: MediaPlacesViewportBounds) => void
}) {
  const [selectedPlaceID, setSelectedPlaceID] = useState<string | null>(null)
  // Prototype v0: the existing Owner-authenticated Places pages already
  // contain ALL valid-GPS PhotoAssets without per-photo Baidu opt-in.
  // Load bounded pages progressively so no independent HTTPS Child is needed.
  const prototypeMap = Boolean(listPlacesPage && getBaiduJSAPIPrototype)
  const [prototypeIndex, setPrototypeIndex] = useState<{
    scope:string;items:MediaPlaceFacet[];total:number;complete:boolean;error:string
  } | null>(null)
  useEffect(() => {
    if (!listPlacesPage || !prototypeMap) return
    let cancelled = false
    const scope = diagnosticScope ?? ''
    setPrototypeIndex({scope,items:[],total:0,complete:false,error:''})
    void (async () => {
      const items: MediaPlaceFacet[] = []
      let offset = 0
      let total = 0
      try {
        for (;;) {
          const page = await listPlacesPage(100,offset)
          if (cancelled) return
          if (!page || !Array.isArray(page.items) || page.items.length > 100 ||
              page.offset !== offset || !Number.isSafeInteger(page.total_count) ||
              page.total_count < 0 || typeof page.has_more !== 'boolean' ||
              (page.has_more && page.items.length === 0)) throw Error('invalid_places_page')
          total = page.total_count
          items.push(...page.items)
          offset += page.items.length
          const complete = !page.has_more || offset >= total
          if (items.length <= 100 || offset % 500 === 0 || complete) {
            setPrototypeIndex({scope,items:items.slice(),total,complete,error:''})
          }
          if (complete) return
          if (offset > 10_000_000) throw Error('places_index_too_large')
        }
      } catch {
        if (!cancelled) setPrototypeIndex({
          scope,items:items.slice(),total,complete:false,
          error:'部分 GPS 地点暂时无法读取，可重进地点继续加载。',
        })
      }
    })()
    return () => { cancelled = true }
  }, [listPlacesPage, prototypeMap, diagnosticScope])
  const currentPrototype = prototypeIndex?.scope === (diagnosticScope ?? '')
    ? prototypeIndex : null
  const prototypePlaces = currentPrototype?.items.length ? currentPrototype.items : places
  // Freeze the returning BD09 camera for THIS native mount. Parent state changes
  // on pan/zoom must never change initialCamera props and remount the SDK.
  const nativeRestoreRef = useRef<XDriveBaiduNativeCameraSnapshot | null>(
    xDriveValidBaiduNativeCameraSnapshot(initialNativeCamera)
      ? { ...initialNativeCamera } : null,
  )
  const clearNativeReturnCamera = useCallback(() => {
    nativeRestoreRef.current = null
    onNativeCameraClear?.()
  }, [onNativeCameraClear])
  const [nearbyRadiusKM, setNearbyRadiusKM] = useState(5)
  const [nativeMapReady, setNativeMapReady] = useState(false)
  const [serverNativeAuthorized, setServerNativeAuthorized] = useState(false)
  const [isolatedChildOrigin,setIsolatedChildOrigin] = useState('')
  const desktopHTTPSOnly = Boolean(onOpenSecureDesktopMap)
  const [nativeStatus, setNativeStatus] = useState<'checking' | 'authorized' |
    'blocked' | 'error' | 'unsupported'>('checking')
  // Scope the observation to the exact current account. Never show an old
  // account's transient diagnosis during the first render after account switch.
  const [diagnosticState, setDiagnosticState] = useState<{
    scope: string; item: XDriveBaiduMapDiagnostic | null
  }>({ scope: diagnosticScope ?? '', item: null })
  useEffect(() => {
    const scope = diagnosticScope ?? ''
    const read = () => setDiagnosticState({
      scope, item: xDriveReadBaiduMapDiagnostic(scope),
    })
    read()
    const unsubscribe = xDriveSubscribeBaiduMapDiagnostics(read)
    // Background-tab timers can be throttled; never surface a stale
    // diagnostic when the operator returns to the tab.
    // The real UI has a Window/Document; source-mounted React tests may not.
    // Read-only resume checks must never turn into production network probes.
    const browserWindow = typeof window === 'undefined' ? null : window
    const browserDocument = typeof document === 'undefined' ? null : document
    browserWindow?.addEventListener('focus', read)
    browserDocument?.addEventListener('visibilitychange', read)
    return () => {
      unsubscribe()
      browserWindow?.removeEventListener('focus', read)
      browserDocument?.removeEventListener('visibilitychange', read)
    }
  }, [diagnosticScope])
  const latestDiagnostic = diagnosticState.scope === (diagnosticScope ?? '')
    ? diagnosticState.item : null
  useEffect(() => {
    if (!latestDiagnostic) return
    const scope = diagnosticScope ?? ''
    const remaining = XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS -
      (Date.now() - latestDiagnostic.recordedAt)
    const timer = window.setTimeout(() => setDiagnosticState({
      scope, item: xDriveReadBaiduMapDiagnostic(scope),
    }), Math.max(1, remaining + 2))
    return () => window.clearTimeout(timer)
  }, [diagnosticScope, latestDiagnostic?.recordedAt])
  useEffect(() => {
    setServerNativeAuthorized(false)
    setIsolatedChildOrigin('')
    setNativeMapFailed(false)
    setNativeStatus('checking')
    if (prototypeMap) {
      // Same-origin Static Baidu API + trusted React markers: no Baidu SDK,
      // signed release or independent Cookie/Child session in this prototype.
      setNativeStatus('unsupported')
      return
    }
    if (!getBaiduJSAPI4Status || !mintBaiduIsolatedChildTicket || !listBaiduNativeCells ||
        !listBaiduNativeViewport || !onOpenBaiduNativePhoto) {
      // Desktop file: is intentionally denied the browser SDK and has its own
      // HTTPS window. It is not a failed browser JSAPI request.
      if (!desktopHTTPSOnly) {
        setNativeStatus('unsupported')
        if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(
          diagnosticScope, 'client_transport_missing')
      }
      return
    }
    const signal = new AbortController()
    // Only an actual signed Server release allows the native mount.
    void getBaiduJSAPI4Status(signal.signal).then(status => {
      if (signal.signal.aborted) return
      if (status?.provider === 'baidu-jsapi-4.0' && status.enabled === true &&
          status.activation_state === 'authorized_signed_release' &&
          typeof status.isolated_child_origin === 'string' && status.isolated_child_origin.startsWith('https://')) {
        setIsolatedChildOrigin(status.isolated_child_origin)
        setServerNativeAuthorized(true)
        setNativeStatus('authorized')
      } else {
        setNativeStatus('blocked')
        if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(
          diagnosticScope, 'server_release_blocked')
      }
    }).catch(error => {
      if (signal.signal.aborted) return
      setNativeStatus('error')
      if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(
        diagnosticScope, xDriveClassifyBaiduMapRequestFailure('status', error))
    })
    return () => signal.abort()
  }, [getBaiduJSAPI4Status, mintBaiduIsolatedChildTicket,
    listBaiduNativeCells, listBaiduNativeViewport, onOpenBaiduNativePhoto,
    desktopHTTPSOnly, diagnosticScope, prototypeMap])
  const selectedPlace = (
    places.find((item) => item.id === selectedPlaceID) ??
    places.find((item) => item.id === focusPlaceID) ??
    places.find((item) => item.id === activePlaceID) ??
    places[0] ??
    (prototypeMap ? prototypePlaces[0] : undefined)
  )

  // Normal entry uses the anonymous Owner-authorized worldwide BD-09 Cells,
  // not the first Places facet or any WGS84 grid center. Returning from Viewer
  // may restore only a separately validated BD-09 camera.
  const [nativeMapFailed, setNativeMapFailed] = useState(false)
  const canMountNativePhoto = Boolean(!prototypeMap && !nativeMapFailed && serverNativeAuthorized && isolatedChildOrigin &&
    mintBaiduIsolatedChildTicket && listBaiduNativeCells &&
    onOpenBaiduNativeCell && !desktopHTTPSOnly)
  // The in-document third-party JSAPI port is permanently disabled for Gallery.
  const showingNative = canMountNativePhoto && nativeMapReady

  const [viewportBounds, setViewportBounds] = useState<MediaPlacesViewportBounds | null>(null)
  const viewportLongitudeSpan = viewportBounds ? (viewportBounds.east > viewportBounds.west
    ? viewportBounds.east - viewportBounds.west
    : 360 - (viewportBounds.west - viewportBounds.east)) : Infinity
  // Native JSAPI4 bounds are BD-09, not the static WGS84 camera.
  // The last static viewport can remain cached after native mount: never
  // silently query that stale range as if it matched the live native map.
  const boundedWGS84Viewport = Boolean(!showingNative && viewportBounds && viewportLongitudeSpan > 0 &&
    viewportLongitudeSpan <= 20 && viewportBounds.north - viewportBounds.south > 0 &&
    viewportBounds.north - viewportBounds.south <= 20)
  const [viewportOffset, setViewportOffset] = useState(
    () => xDriveValidPlacesCameraSnapshot(initialCamera) ? initialCamera.viewportOffset : 0,
  )
  const viewportOffsetRef = useRef(viewportOffset)
  const cameraRef = useRef<XDrivePlacesCameraPosition | null>(null)
  const [viewportResult, setViewportResult] = useState<{
    // Current authorized Server/Agent port is the owner of these GPS results.
    // Do not show an old account's map list even for one initial frame.
    source: NonNullable<typeof listPlacesViewport>
    bounds: MediaPlacesViewportBounds
    page: MediaPlacesViewportPage
  } | null>(null)
  const [viewportLoading, setViewportLoading] = useState(false)
  const [loadFeedbackGeneration, setLoadFeedbackGeneration] = useState(0)
  const showDeferredViewportLoading = useXDriveDeferredLoading(
    viewportLoading, loadFeedbackGeneration,
  )
  const [viewportError, setViewportError] = useState('')
  const boundsRef = useRef<MediaPlacesViewportBounds | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const requestGeneration = useRef(0)

  const onCameraViewport = useCallback((bounds: MediaPlacesViewportBounds) => {
    if (sameViewport(boundsRef.current, bounds)) return
    const initialView = boundsRef.current === null
    boundsRef.current = bounds
    activeRequest.current?.abort()
    // Disarm a previous slow-request spinner before the next camera frame.
    setLoadFeedbackGeneration((generation) => generation + 1)
    setViewportBounds(bounds)
    // Restore the previously committed viewport page only on first map mount.
    if (!initialView) {
      viewportOffsetRef.current = 0
      setViewportOffset(0)
    }
  }, [])

  const onStaticCameraChange = useCallback((position: XDrivePlacesCameraPosition) => {
    cameraRef.current = position
    onCameraChange?.({ ...position, viewportOffset: viewportOffsetRef.current })
  }, [onCameraChange])

  useEffect(() => {
    if (showingNative || !listPlacesViewport || !viewportBounds) return
    const controller = new AbortController()
    const generation = ++requestGeneration.current
    activeRequest.current = controller
    setViewportLoading(true)
    setViewportError('')
    void listPlacesViewport(viewportBounds, 24, viewportOffset, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || generation !== requestGeneration.current) return
        if (page.offset !== viewportOffset || !Array.isArray(page.items) ||
            page.items.length > 24 || !Number.isSafeInteger(page.total_count) ||
            page.total_count < 0 || !Number.isSafeInteger(page.total_photo_count) ||
            page.total_photo_count < 0 || typeof page.has_more !== 'boolean') {
          throw new Error('invalid_viewport_response')
        }
        setViewportResult({ source: listPlacesViewport, bounds: viewportBounds, page })
      })
      .catch(() => {
        if (!controller.signal.aborted && generation === requestGeneration.current) {
          setViewportError('视窗地点暂不可用；请检查连接或更新 Server/Agent。')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && generation === requestGeneration.current) {
          setViewportLoading(false)
        }
      })
    return () => {
      controller.abort()
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [listPlacesViewport, viewportBounds, viewportOffset, showingNative])

  const changeViewportPage = (nextOffset: number) => {
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 ||
        nextOffset > 10_000_000 || nextOffset === viewportOffset) return
    activeRequest.current?.abort()
    setLoadFeedbackGeneration((generation) => generation + 1)
    viewportOffsetRef.current = nextOffset
    setViewportOffset(nextOffset)
    if (cameraRef.current) onCameraChange?.({ ...cameraRef.current, viewportOffset: nextOffset })
  }
  const displayedViewportResult = viewportResult?.source === listPlacesViewport
    ? viewportResult : null
  const currentViewportResult = viewportResult &&
    viewportResult.source === listPlacesViewport &&
    viewportBounds && sameViewport(viewportResult.bounds, viewportBounds) &&
    viewportResult.page.offset === viewportOffset
  const showingPreviousViewport = Boolean(displayedViewportResult && !currentViewportResult)
  const viewportReturnRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!currentViewportResult || !focusPlaceID || !viewportReturnRef.current) return
    const target = viewportReturnRef.current
    const frame = window.requestAnimationFrame(() => {
      if (target.isConnected) target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusPlaceID, viewportResult, viewportBounds, viewportOffset])

  return (
    <Paper
      variant="outlined"
      data-xdrive-gallery-places-map
      sx={{ borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden' }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={1}
        sx={{ px: 1.5, pt: 1.5, pb: 1 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>地图</Typography>
          <Typography variant="caption" color="text.secondary">
            {prototypeMap
              ? '当前账户全部有效 GPS 地点直接聚集，无需逐张授权；底图由百度 JSAPI 绘制。'
              : '聚集点代表已授权的定位照片，缩放展开并点击进入照片墙；仅使用百度地图 Server API。'}
          </Typography>
        </Box>
        <Chip size="small" label={totalCount === null || totalCount === undefined
          ? `本页 ${places.length.toLocaleString('zh-CN')} 个地点`
          : `共 ${totalCount.toLocaleString('zh-CN')} 个地点 · 本页 ${places.length.toLocaleString('zh-CN')} 个`} />
      </Stack>
      <Box component="details" data-xdrive-places-map-options
        sx={{ px: 1.5, pb: 1 }}>
        <Box component="summary" sx={{ cursor: 'pointer', color: 'text.secondary',
          typography: 'caption', minHeight: 36 }}>
          地点筛选与更多操作
        </Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={1}
        sx={{ pb: 1 }}
      >
        <Autocomplete
          size="small"
          options={places}
          getOptionLabel={(place) => place.name}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          value={selectedPlace ?? null}
          onChange={(_event, place) => {
            // Explicitly choosing a new place uses its trusted WGS84 sample,
            // not the old BD09 camera from a different location.
            clearNativeReturnCamera()
            setSelectedPlaceID(place?.id ?? null)
          }}
          renderInput={(params) => (
            <TextField {...params} label="选择地图地点" size="small" />
          )}
          sx={{ flex: 1, minWidth: 0 }}
        />
        {onOpenPlace ? (
          <Button variant="outlined" size="small" disabled={!selectedPlace} onClick={() => {
            if (selectedPlace) onOpenPlace(selectedPlace)
          }}>
            查看此地点照片
          </Button>
        ) : null}
      </Stack>
      {(onOpenNearby || onOpenViewportPhotos) ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
          alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ px: 1.5, pb: 1.5 }}
          data-xdrive-gallery-nearby-a4>
          {onOpenNearby ? (
            <>
              <TextField select size="small" label="附近半径" value={nearbyRadiusKM}
                onChange={(event) => setNearbyRadiusKM(Number(event.target.value))}
                sx={{ minWidth: 132 }}>
                {[1, 5, 25, 100].map(km => <MenuItem key={km} value={km}>{km} 公里</MenuItem>)}
              </TextField>
              <Button size="small" variant="contained" sx={{ minHeight: 44 }}
                disabled={!selectedPlace || !Number.isFinite(selectedPlace.sample_latitude) ||
                  !Number.isFinite(selectedPlace.sample_longitude) ||
                  Math.abs(selectedPlace.sample_latitude!) > 90 ||
                  Math.abs(selectedPlace.sample_longitude!) > 180}
                onClick={() => { if (selectedPlace) onOpenNearby(selectedPlace, nearbyRadiusKM) }}
                data-xdrive-gallery-nearby-photos>
                查看附近照片
              </Button>
            </>
          ) : null}
          {onOpenViewportPhotos ? (
            <Button size="small" variant="outlined" sx={{ minHeight: 44 }}
              disabled={!boundedWGS84Viewport} data-xdrive-gallery-bbox-photos
              onClick={() => { if (viewportBounds && boundedWGS84Viewport) onOpenViewportPhotos(viewportBounds) }}>
              当前地图范围照片
            </Button>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            仅筛选自己的真实 GPS 媒体；精确数量及 Viewer 使用同一 Server Range。范围太大时请放大地图。
          </Typography>
        </Stack>
      ) : null}
      </Box>
      {!prototypeMap && onOpenSecureDesktopMap ? (
        <Box sx={{ px: 1.5, pb: 1.25 }}>
          <Button variant="outlined" size="small" onClick={onOpenSecureDesktopMap}
            sx={{ minHeight: 44 }}>
            在独立安全窗口打开地图
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            使用独立 HTTPS 会话，首次需要登录；动态地图仍受 Server 签名发布门禁控制。
          </Typography>
          {onOpenDiagnostics ? (
            <Button size="small" variant="text" onClick={onOpenDiagnostics}
              data-xdrive-baidu-map-diagnostics-link>查看原因与修复建议</Button>
          ) : null}
        </Box>
      ) : null}
      {!prototypeMap && !desktopHTTPSOnly && !authorizedJSAPI4Runtime &&
        (nativeStatus === 'blocked' || nativeStatus === 'error' ||
          nativeStatus === 'unsupported' ||
          (nativeStatus === 'authorized' && !canMountNativePhoto)) ? (
        <Box data-xdrive-baidu-map-fallback sx={{ px: 1.5, pb: 1 }}>
          <Typography variant="caption" role="status" color="text.secondary">
            百度动态照片地图暂不可用，仍可使用原有地点与静态地图。
          </Typography>
          {latestDiagnostic ? (
            <Typography role="alert" variant="body2" color="text.secondary"
              data-xdrive-baidu-map-blocked-reason sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
              原因：{xDriveBaiduMapDiagnosticDetails[latestDiagnostic.code].title}
              {' · '}错误码：{latestDiagnostic.code}。
              {' '}处理：{xDriveBaiduMapDiagnosticDetails[latestDiagnostic.code].action}
            </Typography>
          ) : null}
          {onOpenDiagnostics ? (
            <Button size="small" variant="text" sx={{ ml: 0.5, minHeight: 36 }}
              data-xdrive-baidu-map-diagnostics-link onClick={onOpenDiagnostics}>
              查看原因与修复建议
            </Button>
          ) : null}
        </Box>
      ) : null}
      {canMountNativePhoto && mintBaiduIsolatedChildTicket && listBaiduNativeCells &&
        onOpenBaiduNativeCell ? (
          <XDriveMediaGalleryBaiduIsolatedPhotoSurface
            key={(diagnosticScope??'')+':'+isolatedChildOrigin}
            childOrigin={isolatedChildOrigin}
            mintChildTicket={mintBaiduIsolatedChildTicket}
            listOwnerCells={listBaiduNativeCells}
            loadThumbnail={loadPhotoCoverThumbnail}
            onOpenCell={onOpenBaiduNativeCell}
            onInvalidated={onBaiduNativeCellInvalidated}
            onCamera={onNativeCameraChange}
            onCameraClear={clearNativeReturnCamera}
            onReady={setNativeMapReady}
            onFailure={() => setNativeMapFailed(true)}
            initialCamera={nativeRestoreRef.current??undefined}
            scope={diagnosticScope}
          />
        ) : null}
      {!canMountNativePhoto ? (
        <>
          {prototypeMap ? (
            <Typography variant="caption" color="text.secondary"
              data-xdrive-places-prototype-progress
              sx={{display:'block',px:1.5,pb:0.5}}>
              {currentPrototype?.complete
                ? '已载入全部 ' + currentPrototype.total.toLocaleString('zh-CN') + ' 个 GPS 地点'
                : '正在逐页汇总 GPS 地点…已载入 ' +
                  (currentPrototype?.items.length ?? 0).toLocaleString('zh-CN') + ' 个'}
              {currentPrototype?.error ? ' · ' + currentPrototype.error : ''}
            </Typography>
          ) : null}
          {prototypeMap && getBaiduJSAPIPrototype ? (
            <XDriveMediaGalleryBaiduPrototypeMap
              key={diagnosticScope ?? ''}
              getPrototypeConfig={getBaiduJSAPIPrototype}
              places={prototypePlaces}
              initialNativeCamera={nativeRestoreRef.current ?? undefined}
              onNativeCameraChange={onNativeCameraChange}
              onOpenPlace={onOpenPlace}
            />
          ) : (
          <XDriveMediaGalleryBaiduStaticMap
        place={selectedPlace}
        getProvider={getBaiduMapProvider}
        loadStaticMap={loadBaiduStaticMap}
        onViewportChange={onCameraViewport}
        initialCamera={initialCamera}
        onCameraChange={onStaticCameraChange}
        prototypeMap={prototypeMap}
        prototypePlaces={prototypePlaces}
        loadThumbnail={loadPhotoCoverThumbnail}
        onOpenPlace={onOpenPlace}
        onOpenViewportPhotos={onOpenViewportPhotos}
      />
          )}
      {!prototypeMap ? (
      <Box component="section" data-xdrive-gallery-places-viewport
        sx={{ px: 1.5, pb: 1.5, minWidth: 0, position: 'relative' }}>
        <Typography variant="subtitle2" fontWeight={700}>当前地图视窗内的地点</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          由百度静态地图相机估算 WGS84 范围，Server 按照片真实 GPS 查询；
          不是 JSAPI 4.0 动态标记或精确瓦片叠加。
        </Typography>
        {listPlacesViewport && viewportBounds && showDeferredViewportLoading ? (
          <Box role="status" data-xdrive-places-viewport-loading sx={{
            position: 'absolute', top: 2, right: 12, zIndex: 1,
            pointerEvents: 'none', width: 18, height: 18,
          }}>
            <CircularProgress size={18} aria-label="正在更新视窗地点" />
          </Box>
        ) : null}
        {!listPlacesViewport ? (
          <Typography role="status" variant="body2" color="text.secondary">
            此版本暂不支持视窗地点查询，请更新 Server/Agent。
          </Typography>
        ) : !viewportBounds ? (
          <Typography role="status" variant="body2" color="text.secondary">
            百度静态地图可用后显示相机视窗地点；原始地点列表仍可使用。
          </Typography>
        ) : (
          <>
            {viewportError ? (
              <Typography data-xdrive-places-viewport-error role="alert"
                variant="caption" color="error" sx={{
                  position: 'absolute', top: 52, right: 12,
                  zIndex: 2, pointerEvents: 'none',
                  maxWidth: 'min(calc(100% - 24px), 520px)',
                  maxHeight: 'min(30dvh, 180px)', overflowY: 'auto',
                  px: 1, py: 0.75, borderRadius: 1,
                  bgcolor: 'background.paper', boxShadow: 2,
                  overflowWrap: 'anywhere',
                }}>
                {viewportError}
              </Typography>
            ) : null}
            {/* Error is a viewport sibling, not a normal-flow child of the
                result Stack. MUI Stack spacing counts absolute children too. */}
            <Stack spacing={1} aria-busy={viewportLoading}>
            {displayedViewportResult ? (
              <>
                <Typography variant="caption" color="text.secondary"
                  data-xdrive-places-viewport-counts>
                  {showingPreviousViewport ? '上次确认范围' : '当前范围'}共
                  {displayedViewportResult.page.total_count.toLocaleString('zh-CN')} 个地点网格、
                  {displayedViewportResult.page.total_photo_count.toLocaleString('zh-CN')} 张照片；
                  本页 {displayedViewportResult.page.items.length} 个地点
                </Typography>
                <Box data-xdrive-places-viewport-results
                  data-xdrive-places-viewport-stale={showingPreviousViewport ? 'true' : undefined}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                    gap: 0.75,
                  }}>
                  {displayedViewportResult.page.items.map((place) => (
                    <Button key={place.id} size="small" variant="outlined"
                      ref={place.id === focusPlaceID ? viewportReturnRef : undefined}
                      data-xdrive-places-viewport-return-anchor={place.id === focusPlaceID ? 'true' : undefined}
                      disabled={!onOpenPlace} onClick={() => onOpenPlace?.(place)}
                      sx={{ minHeight: 44, justifyContent: 'flex-start', textTransform: 'none' }}>
                      <Typography variant="body2" noWrap>{place.name}</Typography>
                    </Button>
                  ))}
                </Box>
                {displayedViewportResult.page.items.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {showingPreviousViewport
                      ? '上次确认范围没有已索引地点；当前视窗尚未确认。'
                      : '此范围没有已索引的 GPS 地点，可移动地图查看其他范围。'}
                  </Typography>
                ) : null}
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button size="small" variant="outlined" sx={{ minHeight: 44 }}
                    disabled={viewportLoading || !currentViewportResult || viewportOffset === 0}
                    onClick={() => changeViewportPage(Math.max(0, viewportOffset - 24))}>
                    上一页
                  </Button>
                  <Button size="small" variant="outlined" sx={{ minHeight: 44 }}
                    disabled={viewportLoading || !currentViewportResult || !displayedViewportResult.page.has_more ||
                      displayedViewportResult.page.items.length === 0 ||
                      viewportOffset + displayedViewportResult.page.items.length > 10_000_000}
                    onClick={() => changeViewportPage(
                      viewportOffset + displayedViewportResult.page.items.length)}>
                    下一页
                  </Button>
                </Stack>
              </>
            ) : (
              // Network failure is not a verified empty state; do not collapse
              // the original quiet 96px slot on a cold viewport read failure.
              <Box data-xdrive-places-viewport-first-read
                aria-busy={viewportLoading || undefined}
                sx={{ minHeight: 96 }} />
            )}
            </Stack>
          </>
        )}
      </Box>
      ) : null}
        </>
      ) : null}
    </Paper>
  )
}
