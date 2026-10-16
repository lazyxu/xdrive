import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { xDriveBaiduStaticStepCenter, xDriveBaiduStaticViewportBounds, xDriveBaiduStaticPinchZoom } from '../media-gallery-baidu-camera'
import type { XDriveBaiduMapViewportBounds } from '../media-gallery-baidu-camera'
import { xDriveValidPlacesCameraPosition } from '../media-gallery-places-camera-session'
import type { XDrivePlacesCameraPosition } from '../media-gallery-places-camera-session'
import type {
  MediaPlaceFacet,
  XDriveBaiduMapProviderInfo,
  XDriveBaiduStaticMapRequest,
} from '../models'

type ProviderResult =
  | { kind: 'checking' }
  | { kind: 'available'; info: XDriveBaiduMapProviderInfo }
  | { kind: 'unavailable' }

/** Baidu is the only map renderer; there is deliberately no offline renderer
 * or emergency fallback. Neither the AK nor the upstream URL reaches clients. */
export function XDriveMediaGalleryBaiduStaticMap({
  place,
  location,
  getProvider,
  loadStaticMap,
  onViewportChange,
  initialCamera,
  onCameraChange,
}: {
  place?: MediaPlaceFacet
  /** Exact photo GPS supplied by Viewer, never a synthesized grid center. */
  location?: { latitude: number; longitude: number; name?: string }
  getProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
  onViewportChange?: (bounds: XDriveBaiduMapViewportBounds) => void
  initialCamera?: XDrivePlacesCameraPosition
  onCameraChange?: (camera: XDrivePlacesCameraPosition) => void
}) {
  const latitude = location?.latitude ?? (place?.sample_latitude ?? place?.latitude)
  const longitude = location?.longitude ?? (place?.sample_longitude ?? place?.longitude)
  const hasLocation = Boolean(location || place)
  const mapName = location?.name ?? place?.name ?? ''
  const originKey = location
    ? `photo:${location.name ?? ''}:${latitude}:${longitude}`
    : `place:${place?.id ?? ''}`
  const restoredCamera = xDriveValidPlacesCameraPosition(initialCamera) ? initialCamera : undefined
  const [provider, setProvider] = useState<ProviderResult>({ kind: 'checking' })
  const [imageURL, setImageURL] = useState('')
  const [zoom, setZoom] = useState(() => restoredCamera?.zoom ?? 12)
  const [requestID, setRequestID] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [camera, setCamera] = useState<{ key: string; latitude: number; longitude: number } | null>(
    () => restoredCamera ? {
      key: originKey, latitude: restoredCamera.latitude, longitude: restoredCamera.longitude,
    } : null,
  )
  const dragStart = useRef<{ pointer: number; x: number; y: number } | null>(null)

  useEffect(() => {
    let active = true
    setProvider({ kind: 'checking' })
    if (!getProvider) {
      setProvider({ kind: 'unavailable' })
    } else {
      void getProvider().then((info) => {
        if (active) setProvider({ kind: 'available', info })
      }).catch(() => {
        if (active) setProvider({ kind: 'unavailable' })
      })
    }
    return () => { active = false }
  }, [getProvider])

  const enabled = provider.kind === 'available' && provider.info.enabled
  // The existing latitude/longitude fields describe a GPS grid CENTER,
  // not a real photo. A1 adds an exact representative Node coordinate.
  const centerLatitude = camera?.key === originKey ? camera.latitude : latitude
  const centerLongitude = camera?.key === originKey ? camera.longitude : longitude
  const validCenter = centerLatitude !== undefined && centerLongitude !== undefined &&
    Number.isFinite(centerLatitude) && Math.abs(centerLatitude) <= 85 &&
    Number.isFinite(centerLongitude) && Math.abs(centerLongitude) <= 180

  // Committed static-camera movement only; never a JSAPI4/BD-09 pixel overlay.
  useEffect(() => {
    if (!enabled || !loadStaticMap || !validCenter ||
        centerLatitude === undefined || centerLongitude === undefined) return
    const bounds = xDriveBaiduStaticViewportBounds(
      { latitude: centerLatitude, longitude: centerLongitude }, zoom)
    if (bounds) {
      onViewportChange?.(bounds)
      onCameraChange?.({ latitude: centerLatitude, longitude: centerLongitude, zoom })
    }
  }, [enabled, loadStaticMap, validCenter, centerLatitude, centerLongitude, zoom, onViewportChange, onCameraChange])

  const pan = (eastPixels: number, southPixels: number) => {
    if (!enabled || !loadStaticMap || !validCenter ||
        centerLatitude === undefined || centerLongitude === undefined) return
    const next = xDriveBaiduStaticStepCenter(
      { latitude: centerLatitude, longitude: centerLongitude }, zoom, eastPixels, southPixels)
    setCamera({ key: originKey, ...next })
  }
  const onMapKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, [number, number]> = {
      ArrowUp: [0, -80], ArrowDown: [0, 80], ArrowLeft: [-80, 0], ArrowRight: [80, 0],
    }
    if (steps[event.key]) {
      if (!enabled || !loadStaticMap || !validCenter) return
      event.preventDefault()
      pan(...steps[event.key])
    } else if (event.key === '+' || event.key === '=') {
      if (!enabled || !validCenter) return
      event.preventDefault()
      setZoom(value => Math.min(18, value + 1))
    } else if (event.key === '-') {
      if (!enabled || !validCenter) return
      event.preventDefault()
      setZoom(value => Math.max(3, value - 1))
    }
  }
  const gesturePointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ distance: number } | null>(null)
  const suppressPan = useRef(false)
  const pointerDistance = () => {
    const [a, b] = Array.from(gesturePointers.current.values())
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  // A selected Place/Viewer return must never inherit the prior GPS gesture.
  useEffect(() => {
    gesturePointers.current.clear()
    dragStart.current = null
    pinchStart.current = null
    suppressPan.current = false
  }, [originKey, enabled])

  const onMapPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !loadStaticMap || !validCenter ||
        (event.pointerType === 'mouse' && event.button !== 0) ||
        gesturePointers.current.has(event.pointerId)) return
    gesturePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* browser may remove target */ }
    if (gesturePointers.current.size === 1) {
      suppressPan.current = false
      pinchStart.current = null
      dragStart.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
    } else {
      // A second finger always suppresses single-finger pan, including its
      // eventual trailing pointer-up event. More than two fingers never pan.
      suppressPan.current = true
      dragStart.current = null
      pinchStart.current = gesturePointers.current.size === 2
        ? { distance: pointerDistance() } : null
    }
  }
  const onMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesturePointers.current.has(event.pointerId)) {
      gesturePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
  }
  const onMapPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = gesturePointers.current
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const startPinch = pinchStart.current
    const startDrag = dragStart.current
    if (pointers.size === 2 && startPinch) {
      // Commit at most one integer zoom change at gesture release, never one
      // network request per finger movement. Existing effect aborts old PNG.
      const distance = pointerDistance()
      setZoom(value => xDriveBaiduStaticPinchZoom(value, startPinch.distance, distance))
      suppressPan.current = true
    } else if (pointers.size === 1 && !suppressPan.current &&
               startDrag && startDrag.pointer === event.pointerId) {
      const deltaX = event.clientX - startDrag.x
      const deltaY = event.clientY - startDrag.y
      // One Server request on release, none per pointer move.
      if (Math.hypot(deltaX, deltaY) < 18) {
        // Ignore taps, without leaving the gesture ref active.
      } else {
        pan(-deltaX * 480 / (event.currentTarget.clientWidth || 480),
          -deltaY * 280 / (event.currentTarget.clientHeight || 280))
      }
    }
    pointers.delete(event.pointerId)
    pinchStart.current = null
    dragStart.current = null
    if (pointers.size === 0) suppressPan.current = false
  }
  const onMapPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesturePointers.current.delete(event.pointerId)) return
    dragStart.current = null
    pinchStart.current = null
    suppressPan.current = gesturePointers.current.size > 0
  }


  useEffect(() => {
    const controller = new AbortController()
    let imageObjectURL = ''
    let active = true
    setImageURL('')
    setError('')
    setBusy(false)

    if (!enabled || !loadStaticMap ||
        centerLatitude === undefined || centerLongitude === undefined) {
      return () => { active = false; controller.abort() }
    }
    if (!Number.isFinite(centerLatitude) || Math.abs(centerLatitude) > 85 ||
        !Number.isFinite(centerLongitude) || Math.abs(centerLongitude) > 180) {
      setError('地点坐标超出百度地图支持范围。')
      return () => { active = false; controller.abort() }
    }

    setBusy(true)
    void loadStaticMap({
      latitude: centerLatitude,
      longitude: centerLongitude,
      zoom,
      width: 480,
      height: 280,
    }, controller.signal).then((png) => {
      if (!active || controller.signal.aborted) return
      imageObjectURL = URL.createObjectURL(png)
      setImageURL(imageObjectURL)
    }).catch(() => {
      if (active && !controller.signal.aborted) {
        setError('百度地图加载失败，请检查网络、Server AK 和配额后重试。')
      }
    }).finally(() => {
      if (active && !controller.signal.aborted) setBusy(false)
    })
    return () => {
      active = false
      controller.abort()
      if (imageObjectURL) URL.revokeObjectURL(imageObjectURL)
    }
  }, [enabled, centerLatitude, centerLongitude, loadStaticMap, zoom, requestID])

  const message =
    provider.kind === 'checking' ? '正在检查百度地图服务…'
      : provider.kind === 'unavailable' ? '无法连接百度地图服务，请检查 Server 和客户端版本。'
      : !provider.info.enabled ? '百度地图未启用，请管理员在 Server 配置有效的百度地图 AK。'
      : !loadStaticMap ? '当前客户端不支持百度地图图片传输，请更新客户端。'
      : !hasLocation ? '没有可显示的地点。'
      : error || (busy ? '正在加载百度地图…' : '百度地图暂无可显示的图片。')

  return (
    <Box component="section" data-xdrive-baidu-static-map sx={{ px: { xs: 1.25, sm: 1.5 }, pb: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">百度地图{mapName ? ` · ${mapName}` : ''}</Typography>
          <Typography variant="caption" color="text.secondary">
            百度地图 Server API · {provider.kind === 'available' ? provider.info.attribution : '© 百度地图'}
          </Typography>
        </Box>
        <Tooltip title="缩小百度地图">
          <span>
            <IconButton size="small" disabled={!enabled || !validCenter || !loadStaticMap || zoom <= 3}
              onClick={() => setZoom((value) => Math.max(3, value - 1))}
              aria-label="缩小百度地图">
              <ZoomOutRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="caption" color="text.secondary">{zoom}</Typography>
        <Tooltip title="放大百度地图">
          <span>
            <IconButton size="small" disabled={!enabled || !validCenter || !loadStaticMap || zoom >= 18}
              onClick={() => setZoom((value) => Math.min(18, value + 1))}
              aria-label="放大百度地图">
              <ZoomInRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="重新加载百度地图">
          <span>
            <IconButton size="small" disabled={!enabled || !validCenter || !loadStaticMap}
              onClick={() => setRequestID((value) => value + 1)}
              aria-label="重新加载百度地图">
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Stack data-xdrive-baidu-static-step-pan direction="row" spacing={0.25}
        justifyContent="center" alignItems="center" sx={{ mt: 0.75 }}>
        {([
          ['west', '地图向西移动', -80, 0, <ArrowBackRoundedIcon key="west" fontSize="small" />],
          ['north', '地图向北移动', 0, -80, <ArrowUpwardRoundedIcon key="north" fontSize="small" />],
          ['south', '地图向南移动', 0, 80, <ArrowDownwardRoundedIcon key="south" fontSize="small" />],
          ['east', '地图向东移动', 80, 0, <ArrowForwardRoundedIcon key="east" fontSize="small" />],
        ] as const).map(([direction, label, dx, dy, icon]) => (
          <Tooltip key={direction} title={label}>
            <span><IconButton aria-label={label} size="small"
              disabled={!enabled || !validCenter || !loadStaticMap}
              sx={{ minWidth: 44, minHeight: 44 }} onClick={() => pan(dx, dy)}>
              {icon}
            </IconButton></span>
          </Tooltip>
        ))}
      </Stack>
      <Box role="group" tabIndex={enabled && validCenter ? 0 : -1}
        aria-label="百度地图：方向键移动，按加号或减号缩放，拖动松开后更新"
        onKeyDown={onMapKeyDown} onPointerDown={onMapPointerDown}
        onPointerMove={onMapPointerMove} onPointerUp={onMapPointerUp}
        onPointerCancel={onMapPointerCancel}
        sx={{
        touchAction: enabled ? 'none' : 'auto', cursor: enabled ? 'grab' : 'default',
        bgcolor: 'action.hover',
        borderRadius: 1,
        mt: 1,
        mx: 'auto',
        width: '100%',
        maxWidth: 480,
        aspectRatio: '12 / 7',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}>
        {imageURL && !error ? (
          <Box component="img" src={imageURL} alt={`百度地图：${mapName}`}
            onError={() => setError('百度地图返回的图片无法显示，请重试。')}
            sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <Typography role="status" variant="body2" color="text.secondary" sx={{ px: 2, textAlign: 'center' }}>
            {message}
          </Typography>
        )}
      </Box>
      {provider.kind === 'available' && provider.info.enabled ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          拖动或按方向键后才重新请求百度静态底图；不等同于 JSAPI 4.0 连续动态地图。{' '}
          {provider.info.privacy}
        </Typography>
      ) : null}
    </Box>
  )
}
