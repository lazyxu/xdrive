import { useCallback, useEffect, useRef, useState } from 'react'
import { Autocomplete, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type {
  MediaPlaceFacet,
  MediaPlacesViewportBounds,
  MediaPlacesViewportPage,
  XDriveBaiduMapProviderInfo,
  XDriveBaiduStaticMapRequest,
} from '../models'
import { XDriveMediaGalleryBaiduStaticMap } from './MediaGalleryBaiduStaticMap'
import { XDriveMediaGalleryBaiduJSAPI4Surface } from './MediaGalleryBaiduJSAPI4Surface'
import { XDriveMediaGalleryBaiduJSAPI4PhotoSurface } from './MediaGalleryBaiduJSAPI4PhotoSurface'
import type { XDriveBaiduJSAPI4AuthorizedMountPort, XDriveBaiduJSAPI4InitialPhotoCamera } from '../media-gallery-baidu-jsapi4-mount'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { useXDriveDeferredLoading } from './useDeferredLoading'
import { xDriveValidPlacesCameraSnapshot } from '../media-gallery-places-camera-session'
import type { XDrivePlacesCameraPosition, XDrivePlacesCameraSnapshot, XDrivePlacesViewportCamera } from '../media-gallery-places-camera-session'

function sameViewport(a: MediaPlacesViewportBounds | null, b: MediaPlacesViewportBounds) {
  return Boolean(a && a.west === b.west && a.south === b.south &&
    a.east === b.east && a.north === b.north)
}

/** Only the Baidu Server API image is rendered here. The local GPS SVG map,
 * its map projection, and all offline fallback UI have been retired. */
export function XDriveMediaGalleryPlacesMap({
  places,
  totalCount,
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
  mintBaiduJSAPI4Session,
  onOpenBaiduNativePhoto,
  onOpenBaiduNativeCell,
  onBaiduNativeCellInvalidated,
  onOpenSecureDesktopMap,
  authorizedJSAPI4Runtime,
  activePlaceID,
  focusPlaceID,
  onOpenPlace,
  onOpenNearby,
  onOpenViewportPhotos,
}: {
  places: MediaPlaceFacet[]
  totalCount?: number | null
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
  mintBaiduJSAPI4Session?: import('./MediaGallery').MediaGalleryDataSource['mintBaiduJSAPI4Session']
  onOpenBaiduNativePhoto?: (identity: { assetID: number; nodeID: number }) => void
  onOpenBaiduNativeCell?: (selection: import('../models').MediaBaiduNativeCellSelection) => void
  onBaiduNativeCellInvalidated?: () => void
  onOpenSecureDesktopMap?: () => void
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
  useEffect(() => {
    setServerNativeAuthorized(false)
    if (!getBaiduJSAPI4Status || !mintBaiduJSAPI4Session ||
        !listBaiduNativeViewport || !onOpenBaiduNativePhoto) return
    const signal = new AbortController()
    // A desired Browser AK is NOT a signed runtime; ask Server itself.
    void getBaiduJSAPI4Status(signal.signal).then(status => {
      if (!signal.signal.aborted && status?.provider === 'baidu-jsapi-4.0' &&
          status.enabled === true &&
          status.activation_state === 'authorized_signed_release') {
        setServerNativeAuthorized(true)
      }
    }).catch(() => { /* signed release absent: static Baidu map stays visible */ })
    return () => signal.abort()
  }, [getBaiduJSAPI4Status, mintBaiduJSAPI4Session,
    listBaiduNativeViewport, onOpenBaiduNativePhoto])
  const selectedPlace = (
    places.find((item) => item.id === selectedPlaceID) ??
    places.find((item) => item.id === focusPlaceID) ??
    places.find((item) => item.id === activePlaceID) ??
    places[0]
  )

  // Never supply a grid-center to the native SDK as if it were an original
  // photo position. The authorized mount must use official WGS84→BD-09.
  const nativeCamera = selectedPlace && Number.isFinite(selectedPlace.sample_latitude) &&
    Number.isFinite(selectedPlace.sample_longitude) &&
    Math.abs(selectedPlace.sample_latitude!) <= 85 &&
    Math.abs(selectedPlace.sample_longitude!) <= 180
    ? { latitude: selectedPlace.sample_latitude!, longitude: selectedPlace.sample_longitude!,
        zoom: xDriveValidPlacesCameraSnapshot(initialCamera) ? initialCamera.zoom : 12 }
    : null
  const nativePhotoCamera: XDriveBaiduJSAPI4InitialPhotoCamera | null =
    nativeRestoreRef.current ?? nativeCamera
  const canMountNativePhoto = Boolean(serverNativeAuthorized &&
    mintBaiduJSAPI4Session && listBaiduNativeViewport &&
    onOpenBaiduNativePhoto && nativePhotoCamera)
  const canMountLegacy = Boolean(authorizedJSAPI4Runtime && listPlacesViewport &&
    onOpenPlace && nativeCamera)
  const showingNative = (canMountNativePhoto || canMountLegacy) && nativeMapReady

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
      sx={{ borderRadius: 2, overflow: 'hidden' }}
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
            地点按约 0.01° GPS 网格分组；本页地图使用代表照片的真实坐标，仅使用百度地图 Server API
          </Typography>
        </Box>
        <Chip size="small" label={totalCount === null || totalCount === undefined
          ? `本页 ${places.length.toLocaleString('zh-CN')} 个地点`
          : `共 ${totalCount.toLocaleString('zh-CN')} 个地点 · 本页 ${places.length.toLocaleString('zh-CN')} 个`} />
      </Stack>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={1}
        sx={{ px: 1.5, pb: 1 }}
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
      {onOpenSecureDesktopMap ? (
        <Box sx={{ px: 1.5, pb: 1.25 }}>
          <Button variant="outlined" size="small" onClick={onOpenSecureDesktopMap}
            sx={{ minHeight: 44 }}>
            在独立安全窗口打开地图
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            使用独立 HTTPS 会话，首次需要登录；动态地图仍受 Server 签名发布门禁控制。
          </Typography>
        </Box>
      ) : null}
      {canMountNativePhoto && mintBaiduJSAPI4Session && listBaiduNativeViewport &&
        onOpenBaiduNativePhoto && nativePhotoCamera ? (
          <XDriveMediaGalleryBaiduJSAPI4PhotoSurface
            key={selectedPlace?.id}
            mintMapOnlySession={mintBaiduJSAPI4Session}
            listOwnerViewport={listBaiduNativeViewport}
            listOwnerCells={listBaiduNativeCells}
            loadThumbnail={loadPhotoCoverThumbnail}
            camera={nativePhotoCamera}
            onOpenPhoto={onOpenBaiduNativePhoto}
            onOpenCell={onOpenBaiduNativeCell}
            onCellInvalidated={onBaiduNativeCellInvalidated}
            onNativeCameraChange={onNativeCameraChange}
            onNativeCameraClear={clearNativeReturnCamera}
            onReady={setNativeMapReady}
          />
        ) : null}
      {!canMountNativePhoto && canMountLegacy && authorizedJSAPI4Runtime && listPlacesViewport &&
        onOpenPlace && nativeCamera ? (
          <XDriveMediaGalleryBaiduJSAPI4Surface
            key={selectedPlace?.id}
            authorizedRuntime={authorizedJSAPI4Runtime}
            listOwnerViewport={listPlacesViewport}
            camera={nativeCamera}
            onOpenPlace={onOpenPlace}
            onReady={setNativeMapReady}
          />
        ) : null}
      {!showingNative ? (
        <>
          <XDriveMediaGalleryBaiduStaticMap
        place={selectedPlace}
        getProvider={getBaiduMapProvider}
        loadStaticMap={loadBaiduStaticMap}
        onViewportChange={onCameraViewport}
        initialCamera={initialCamera}
        onCameraChange={onStaticCameraChange}
      />
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
          <Stack spacing={1} aria-busy={viewportLoading}>
            {viewportError ? (
              <Typography role="alert" variant="caption" color="error">
                {viewportError}
              </Typography>
            ) : null}
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
            ) : !viewportError ? (
              <Box data-xdrive-places-viewport-first-read sx={{ minHeight: 96 }} />
            ) : null}
          </Stack>
        )}
      </Box>
        </>
      ) : null}
    </Paper>
  )
}
