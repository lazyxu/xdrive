import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import type { MediaPlaceFacet, MediaPlacesMapOverview, MediaPlacesViewportBounds } from '../models'
import {
  xDriveOwnerGPSBoundsValid, xDriveOwnerGPSCanOpenPlace, xDriveOwnerGPSPan,
  xDriveOwnerGPSPoint, xDriveOwnerGPSWorld, xDriveOwnerGPSZoom,
} from '../media-gallery-owner-gps-viewport'

type Request = (bounds: MediaPlacesViewportBounds, detail?: boolean,
  signal?: AbortSignal) => Promise<MediaPlacesMapOverview>
type Loaded = { scope: string; key: string; page: MediaPlacesMapOverview }
const keyOf = (bounds: MediaPlacesViewportBounds): string =>
  [bounds.west, bounds.south, bounds.east, bounds.north].join(':')
const world = (): MediaPlacesViewportBounds => ({ ...xDriveOwnerGPSWorld })

/** Same shared Gallery / Owner Range / Viewer. DSM supplies a bounded WGS84
 * overview when it cannot honestly mount the authenticated BD09 SDK Host.
 * This is explicitly a coordinate distribution, NOT a map basemap. */
export function XDriveMediaGalleryOwnerGPSOverview({
  listPage, onOpenPlace, scope, compact,
}: {
  listPage: Request
  onOpenPlace: (place: MediaPlaceFacet) => void
  scope: string
  compact: boolean
}) {
  const [camera, setCamera] = useState<{ scope: string; bounds: MediaPlacesViewportBounds }>(
    () => ({scope, bounds: world()}))
  // Never reuse the last Owner's camera/markers while a new Owner mounts.
  const bounds = camera.scope === scope ? camera.bounds : world()
  const key = keyOf(bounds)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(true)
  const [retry, setRetry] = useState(0)
  const start = useRef<{ id: number; x: number; y: number; width: number; height: number } | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoaded(null)
    setError('')
    if (!scope || !xDriveOwnerGPSBoundsValid(bounds)) {
      setPending(false)
      setError('请先确认当前 Owner 地图来源。')
      return () => controller.abort()
    }
    setPending(true)
    void listPage(bounds, true, controller.signal).then(page => {
      if (controller.signal.aborted) return
      // The DSM adapter validates every representative/count against the
      // exact requested viewport. Keep a display fence against bad Hosts.
      if (!page || !Array.isArray(page.items) || page.items.length > 64 ||
        !Number.isSafeInteger(page.total_photo_count) ||
        typeof page.aggregated !== 'boolean') throw new Error('无效的 Owner 地图响应')
      setLoaded({ scope, key, page })
    }).catch(() => {
      if (!controller.signal.aborted) setError('当前视窗的 GPS 照片读取失败，请重试。')
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false)
    })
    return () => controller.abort()
  // A new Owner or Camera bounds always cancels the old authenticated GET.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, key, listPage, retry])
  const current = !pending && loaded?.scope === scope && loaded.key === key ? loaded.page : null
  const moveTo = (next: MediaPlacesViewportBounds | null) => {
    if (!next || !xDriveOwnerGPSBoundsValid(next) || keyOf(next) === key) return
    setLoaded(null)
    setCamera({ scope, bounds: next })
  }
  const zoom = (factor: number) => {
    const lat = (bounds.south + bounds.north) / 2
    const lon = (bounds.west + bounds.east) / 2
    if (factor < 1) moveTo(xDriveOwnerGPSZoom(bounds, lat, lon, factor))
    else {
      // Zoom-out grows the geographic span; the zoom helper only shrinks.
      const wide = Math.min(360, (bounds.east - bounds.west) * factor)
      const tall = Math.min(180, (bounds.north - bounds.south) * factor)
      const west = Math.min(180 - wide, Math.max(-180, lon - wide / 2))
      const south = Math.min(90 - tall, Math.max(-90, lat - tall / 2))
      moveTo({ west, east: west + wide, south, north: south + tall })
    }
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const previous = start.current
    if (!previous || previous.id !== event.pointerId) return
    start.current = null
    setDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (cancelled) return
    const dx = (event.clientX - previous.x) / previous.width
    const dy = (event.clientY - previous.y) / previous.height
    if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) >= 8) {
      moveTo(xDriveOwnerGPSPan(bounds, dx, dy))
    }
  }
  return (
    <Paper variant="outlined" data-xdrive-owner-gps-map sx={{ p: 1, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between"
        gap={1} flexWrap="wrap" sx={{ mb: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">真实 WGS84 GPS 位置概览</Typography>
          <Typography variant="caption" color="text.secondary">
            经纬度坐标示意（无地图底图）。移动后重新查询当前 Owner；聚合区域可继续放大。
          </Typography>
        </Box>
        <Stack direction="row" gap={0.5} alignItems="center">
          <Button size="small" variant="outlined" onClick={() => zoom(0.5)}
            sx={{minWidth:44,minHeight:44}} aria-label="放大 GPS 地图">＋</Button>
          <Button size="small" variant="outlined" onClick={() => zoom(2)}
            sx={{minWidth:44,minHeight:44}} aria-label="缩小 GPS 地图">－</Button>
          <Button size="small" variant="outlined" onClick={() => moveTo(world())}
            sx={{minHeight:44}}>全图</Button>
        </Stack>
      </Stack>
      <Box data-xdrive-owner-gps-canvas role="group"
        aria-label="可拖动的 WGS84 照片位置分布，非百度地图底图"
        onPointerDown={event => {
          if (event.button !== 0 || start.current) return
          const rect = event.currentTarget.getBoundingClientRect()
          start.current = {
            id: event.pointerId, x: event.clientX, y: event.clientY,
            width: Math.max(rect.width, 1), height: Math.max(rect.height, 1),
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const previous = start.current
          if (previous?.id === event.pointerId) {
            setDrag({ x: event.clientX - previous.x, y: event.clientY - previous.y })
          }
        }}
        onPointerUp={event => endDrag(event)}
        onPointerCancel={event => endDrag(event, true)}
        sx={{position:'relative',height:compact ? 'min(65dvh,660px)' : 520,
          minHeight:280,overflow:'hidden',touchAction:'none',
          borderRadius:2,border:1,borderColor:'divider',
          bgcolor:'action.hover',
          backgroundImage:'linear-gradient(to right, transparent 24.8%, currentColor 25%, transparent 25.2%, transparent 49.8%, currentColor 50%, transparent 50.2%, transparent 74.8%, currentColor 75%, transparent 75.2%), linear-gradient(to bottom, transparent 24.8%, currentColor 25%, transparent 25.2%, transparent 49.8%, currentColor 50%, transparent 50.2%, transparent 74.8%, currentColor 75%, transparent 75.2%)',
          color:'divider',opacity:1,cursor:drag ? 'grabbing' : 'grab'}}>
        <Box sx={{position:'absolute',inset:0,
          transform:drag ? `translate(${drag.x}px,${drag.y}px)` : 'none',
          pointerEvents:drag ? 'none' : 'auto'}}>
          {current?.items.map(item => {
            const latitude = item.sample_latitude
            const longitude = item.sample_longitude
            if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
              !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
            const point = xDriveOwnerGPSPoint(bounds, latitude, longitude)
            if (!point) return null
            const realPlace = xDriveOwnerGPSCanOpenPlace(current, item)
            return (
              <Button key={item.id} variant="contained" size="small"
                data-xdrive-owner-gps-point={item.id}
                onPointerDown={event => event.stopPropagation()}
                onClick={() => {
                  if (!current) return
                  if (realPlace) onOpenPlace(item)
                  else moveTo(xDriveOwnerGPSZoom(
                    bounds, latitude, longitude, 0.3))
                }}
                aria-label={realPlace
                  ? item.name + '，' + item.item_count + ' 张照片，打开地点照片'
                  : item.item_count + ' 张照片的聚合区域，放大查看'}
                sx={{position:'absolute',left:(point.x * 100)+'%',top:(point.y * 100)+'%',
                  transform:'translate(-50%,-50%)',minHeight:44,minWidth:44,
                  borderRadius:'999px',px:1.25,whiteSpace:'nowrap',
                  boxShadow:3}}>
                {item.item_count.toLocaleString('zh-CN')}
              </Button>
            )
          })}
        </Box>
        {pending ? <Stack direction="row" gap={1} role="status"
          sx={{position:'absolute',bottom:8,left:8,p:1,borderRadius:1,
            bgcolor:'background.paper',color:'text.primary',pointerEvents:'none'}}>
          <CircularProgress size={18}/><Typography variant="body2">正在读取当前视窗…</Typography>
        </Stack> : null}
        {!pending && !error && current?.items.length === 0 ? (
          <Typography role="status" variant="body2"
            sx={{position:'absolute',bottom:8,left:8,p:1,borderRadius:1,
              bgcolor:'background.paper',color:'text.primary'}}>
            此视窗暂无已索引的 GPS 照片。
          </Typography>
        ) : null}
      </Box>
      {error ? (
        <Stack direction="row" gap={1} alignItems="center" role="alert" sx={{mt:1}}>
          <Typography variant="body2" color="error">{error}</Typography>
          <Button size="small" onClick={() => setRetry(x => x + 1)}>重试</Button>
        </Stack>
      ) : null}
      {current ? <Typography variant="caption" sx={{display:'block',mt:1}}
        color="text.secondary" data-xdrive-owner-gps-count>
        当前视窗共 {current.total_photo_count.toLocaleString('zh-CN')} 张 GPS 照片；
        {current.aggregated ? '位置仍为聚合代表项，放大后才可打开真实地点。'
          : '点击真实地点进入已有的 Owner 照片墙与 Viewer。'}
      </Typography> : null}
    </Paper>
  )
}
