import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  xDriveCreateBaiduJSAPI4IndexedBD09Mount,
} from '../media-gallery-baidu-jsapi4-browser-loader'
import type { XDriveBaiduJSAPI4SessionGrant } from '../media-gallery-baidu-jsapi4-browser-loader'
import type { XDriveBaiduJSAPI4InitialPhotoCamera } from '../media-gallery-baidu-jsapi4-mount'
import { xDriveBindBaiduJSAPI4NativeMap } from '../media-gallery-baidu-jsapi4-native'
import {
  XDriveBaiduJSAPI4IndexedViewportBridge,
} from '../media-gallery-baidu-jsapi4-bd09-photo'
import type {
  XDriveBaiduNativeMapWithBounds,
  XDriveBaiduNativePhotoIdentity,
  XDriveBaiduNativePhotoViewportRequest,
} from '../media-gallery-baidu-jsapi4-bd09-photo'

/**
 * One responsive Web/Mobile Web native BD09 photo map. This component cannot
 * enable the SDK: it runs ONLY after a current Server signed-release status
 * and a real authenticated Owner map-only Session grant. No AK is provided
 * to the browser. Desktop file: never supplies this feature port.
 *
 * All photograph results are already Server-derived BD09LL; native bounds
 * MUST NOT be relabeled original WGS84 or converted a second time.
 */
export function XDriveMediaGalleryBaiduJSAPI4PhotoSurface({
  mintMapOnlySession,
  listOwnerViewport,
  camera,
  onOpenPhoto,
  onReady,
}: {
  mintMapOnlySession: (signal: AbortSignal) => Promise<XDriveBaiduJSAPI4SessionGrant>
  listOwnerViewport: XDriveBaiduNativePhotoViewportRequest
  camera: XDriveBaiduJSAPI4InitialPhotoCamera
  onOpenPhoto: (identity: XDriveBaiduNativePhotoIdentity) => void
  onReady: (ready: boolean) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const latestOpenPhoto = useRef(onOpenPhoto)
  latestOpenPhoto.current = onOpenPhoto
  const [result, setResult] = useState('')

  useEffect(() => {
    const container = host.current
    if (!container) return
    let active = true
    const pending = new AbortController()
    const mount = xDriveCreateBaiduJSAPI4IndexedBD09Mount({ mintMapOnlySession })
    let native: Awaited<ReturnType<typeof mount.acquire>> | null = null
    let bridge: XDriveBaiduJSAPI4IndexedViewportBridge | null = null
    let clock: ReturnType<typeof setTimeout> | null = setTimeout(() => pending.abort(), 8000)
    setResult('')
    onReady(false)
    const opened = async () => {
      native = await mount.acquire(container, pending.signal, camera)
      if (clock !== null) {
        clearTimeout(clock)
        clock = null
      }
      if (!active || pending.signal.aborted) {
        // A provider may complete after navigation/logout: never leak WebGL
        // Map/ClusterLayer resources or keep an authorized view alive.
        native.dispose()
        native = null
        return
      }
      const bound = xDriveBindBaiduJSAPI4NativeMap(native.map, native.namespace)
      const map = bound.map as XDriveBaiduNativeMapWithBounds
      if (typeof map.getBounds !== 'function') throw new Error('map_unavailable')
      bridge = new XDriveBaiduJSAPI4IndexedViewportBridge({
        ...bound, map,
      }, listOwnerViewport, {
        onOpenPhoto: identity => {
          if (active && !pending.signal.aborted) latestOpenPhoto.current(identity)
        },
        onViewportInvalidated: () => {},
        onResult: response => {
          if (!active || pending.signal.aborted) return
          setResult(response.kind)
          // A truncated result may show a licensed map but no invented cluster.
          onReady(response.kind === 'rendered' || response.kind === 'incomplete')
        },
      })
      const first = await bridge.refresh()
      if (!active || pending.signal.aborted) return
      setResult(first.kind)
      onReady(first.kind === 'rendered' || first.kind === 'incomplete')
    }
    void opened().catch(() => {
      // A failed SDK bind, revoked Session or unusable viewport must release
      // the native map immediately, not only after a later component unmount.
      bridge?.dispose()
      bridge = null
      native?.dispose()
      native = null
      if (active && !pending.signal.aborted) {
        setResult('unavailable')
        onReady(false)
      }
    })
    return () => {
      active = false
      pending.abort()
      if (clock !== null) clearTimeout(clock)
      bridge?.dispose()
      native?.dispose()
      onReady(false)
    }
  }, [mintMapOnlySession, listOwnerViewport, onReady,
    camera.latitude, camera.longitude, camera.zoom])

  return (
    <Box component="section" data-xdrive-baidu-jsapi4-bd09-photo-surface
      sx={{ px: { xs: 1.25, sm: 1.5 }, pb: 1.5, minWidth: 0 }}>
      <Box ref={host} role="region" aria-label="百度动态照片地图"
        data-xdrive-baidu-jsapi4-bd09-photo-canvas
        sx={{ width: '100%', height: { xs: 320, sm: 400 },
          minHeight: 280, borderRadius: 1.5 }} />
      {result === 'incomplete' ? (
        <Typography role="status" variant="caption" color="text.secondary">
          当前地图范围内的已授权照片超过 100 张，请放大地图；不显示不完整的聚合结果。
        </Typography>
      ) : result && result !== 'rendered' && result !== 'cancelled' ? (
        <Typography role="status" variant="caption" color="text.secondary">
          百度动态照片地图暂不可用，仍可使用原有地点与静态地图。
        </Typography>
      ) : null}
    </Box>
  )
}
