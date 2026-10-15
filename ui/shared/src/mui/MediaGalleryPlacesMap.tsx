import { useCallback, useEffect, useRef, useState } from 'react'
import { Autocomplete, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import type {
  MediaPlaceFacet,
  MediaPlacesViewportBounds,
  MediaPlacesViewportPage,
  XDriveBaiduMapProviderInfo,
  XDriveBaiduStaticMapRequest,
} from '../models'
import { XDriveMediaGalleryBaiduStaticMap } from './MediaGalleryBaiduStaticMap'
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
  getBaiduMapProvider,
  loadBaiduStaticMap,
  activePlaceID,
  focusPlaceID,
  onOpenPlace,
}: {
  places: MediaPlaceFacet[]
  totalCount?: number | null
  listPlacesViewport?: (bounds: MediaPlacesViewportBounds, limit?: number, offset?: number,
    signal?: AbortSignal) => Promise<MediaPlacesViewportPage>
  initialCamera?: XDrivePlacesCameraSnapshot
  onCameraChange?: (camera: XDrivePlacesViewportCamera) => void
  getBaiduMapProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadBaiduStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
  activePlaceID?: string
  focusPlaceID?: string
  onOpenPlace?: (place: MediaPlaceFacet) => void
}) {
  const [selectedPlaceID, setSelectedPlaceID] = useState<string | null>(null)
  const selectedPlace = (
    places.find((item) => item.id === selectedPlaceID) ??
    places.find((item) => item.id === focusPlaceID) ??
    places.find((item) => item.id === activePlaceID) ??
    places[0]
  )

  const [viewportBounds, setViewportBounds] = useState<MediaPlacesViewportBounds | null>(null)
  const [viewportOffset, setViewportOffset] = useState(
    () => xDriveValidPlacesCameraSnapshot(initialCamera) ? initialCamera.viewportOffset : 0,
  )
  const viewportOffsetRef = useRef(viewportOffset)
  const cameraRef = useRef<XDrivePlacesCameraPosition | null>(null)
  const [viewportResult, setViewportResult] = useState<{
    bounds: MediaPlacesViewportBounds
    page: MediaPlacesViewportPage
  } | null>(null)
  const [viewportLoading, setViewportLoading] = useState(false)
  const [viewportError, setViewportError] = useState('')
  const boundsRef = useRef<MediaPlacesViewportBounds | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const requestGeneration = useRef(0)

  const onCameraViewport = useCallback((bounds: MediaPlacesViewportBounds) => {
    if (sameViewport(boundsRef.current, bounds)) return
    const initialView = boundsRef.current === null
    boundsRef.current = bounds
    activeRequest.current?.abort()
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
    if (!listPlacesViewport || !viewportBounds) return
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
        setViewportResult({ bounds: viewportBounds, page })
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
  }, [listPlacesViewport, viewportBounds, viewportOffset])

  const changeViewportPage = (nextOffset: number) => {
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 ||
        nextOffset > 10_000_000 || nextOffset === viewportOffset) return
    activeRequest.current?.abort()
    viewportOffsetRef.current = nextOffset
    setViewportOffset(nextOffset)
    if (cameraRef.current) onCameraChange?.({ ...cameraRef.current, viewportOffset: nextOffset })
  }
  const currentViewportResult = viewportResult &&
    viewportBounds && sameViewport(viewportResult.bounds, viewportBounds) &&
    viewportResult.page.offset === viewportOffset
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
          onChange={(_event, place) => setSelectedPlaceID(place?.id ?? null)}
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
      <XDriveMediaGalleryBaiduStaticMap
        place={selectedPlace}
        getProvider={getBaiduMapProvider}
        loadStaticMap={loadBaiduStaticMap}
        onViewportChange={onCameraViewport}
        initialCamera={initialCamera}
        onCameraChange={onStaticCameraChange}
      />
      <Box component="section" data-xdrive-gallery-places-viewport sx={{ px: 1.5, pb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>当前地图视窗内的地点</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          由百度静态地图相机估算 WGS84 范围，Server 按照片真实 GPS 查询；
          不是 JSAPI 4.0 动态标记或精确瓦片叠加。
        </Typography>
        {!listPlacesViewport ? (
          <Typography role="status" variant="body2" color="text.secondary">
            此版本暂不支持视窗地点查询，请更新 Server/Agent。
          </Typography>
        ) : !viewportBounds ? (
          <Typography role="status" variant="body2" color="text.secondary">
            百度静态地图可用后显示相机视窗地点；原始地点列表仍可使用。
          </Typography>
        ) : (
          <Stack spacing={1}>
            {viewportLoading ? (
              <Typography role="status" variant="caption" color="text.secondary">
                正在更新视窗地点…
              </Typography>
            ) : null}
            {viewportError ? (
              <Typography role="alert" variant="caption" color="error">
                {viewportError}
              </Typography>
            ) : null}
            {viewportResult && !currentViewportResult ? (
              <Typography variant="caption" color="text.secondary">
                保留上一视窗结果，当前视窗尚未确认。
              </Typography>
            ) : null}
            {viewportResult && currentViewportResult ? (
              <>
                <Typography variant="caption" color="text.secondary"
                  data-xdrive-places-viewport-counts>
                  当前范围共 {viewportResult.page.total_count.toLocaleString('zh-CN')} 个地点网格、
                  {viewportResult.page.total_photo_count.toLocaleString('zh-CN')} 张照片；
                  本页 {viewportResult.page.items.length} 个地点
                </Typography>
                <Box data-xdrive-places-viewport-results sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                  gap: 0.75,
                }}>
                  {viewportResult.page.items.map((place) => (
                    <Button key={place.id} size="small" variant="outlined"
                      ref={place.id === focusPlaceID ? viewportReturnRef : undefined}
                      data-xdrive-places-viewport-return-anchor={place.id === focusPlaceID ? 'true' : undefined}
                      disabled={!onOpenPlace} onClick={() => onOpenPlace?.(place)}
                      sx={{ minHeight: 44, justifyContent: 'flex-start', textTransform: 'none' }}>
                      <Typography variant="body2" noWrap>{place.name}</Typography>
                    </Button>
                  ))}
                </Box>
                {viewportResult.page.items.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    此范围没有已索引的 GPS 地点，可移动地图查看其他范围。
                  </Typography>
                ) : null}
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button size="small" variant="outlined" sx={{ minHeight: 44 }}
                    disabled={viewportLoading || viewportOffset === 0}
                    onClick={() => changeViewportPage(Math.max(0, viewportOffset - 24))}>
                    上一页
                  </Button>
                  <Button size="small" variant="outlined" sx={{ minHeight: 44 }}
                    disabled={viewportLoading || !viewportResult.page.has_more ||
                      viewportResult.page.items.length === 0 ||
                      viewportOffset + viewportResult.page.items.length > 10_000_000}
                    onClick={() => changeViewportPage(
                      viewportOffset + viewportResult.page.items.length)}>
                    下一页
                  </Button>
                </Stack>
              </>
            ) : null}
          </Stack>
        )}
      </Box>
    </Paper>
  )
}
