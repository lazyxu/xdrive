import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { XDriveBaiduJSAPI4MountLifecycle } from '../media-gallery-baidu-jsapi4-mount'
import type {
  XDriveBaiduJSAPI4AuthorizedMountPort,
  XDriveBaiduJSAPI4InitialPhotoCamera,
} from '../media-gallery-baidu-jsapi4-mount'
import type { XDriveBaiduJSAPI4OwnerListViewport } from '../media-gallery-baidu-jsapi4-viewport'
import type { MediaPlaceFacet } from '../models'

/**
 * One responsive native Map surface for shared Web/Mobile Web/Desktop Gallery.
 * NO script, Cookie, AK or external request is created here; without a
 * Server-authorized runtime port the containing Gallery uses Baidu Static PNG.
 */
export function XDriveMediaGalleryBaiduJSAPI4Surface({
  authorizedRuntime,
  listOwnerViewport,
  camera,
  onOpenPlace,
  onReady,
}: {
  authorizedRuntime: XDriveBaiduJSAPI4AuthorizedMountPort
  listOwnerViewport: XDriveBaiduJSAPI4OwnerListViewport
  camera: XDriveBaiduJSAPI4InitialPhotoCamera
  onOpenPlace: (place: MediaPlaceFacet) => void
  onReady: (ready: boolean) => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const onOpenPlaceRef = useRef(onOpenPlace)
  onOpenPlaceRef.current = onOpenPlace
  const [result, setResult] = useState('')

  useEffect(() => {
    const container = mountRef.current
    if (!container) return
    const lifecycle = new XDriveBaiduJSAPI4MountLifecycle()
    let active = true
    setResult('')
    onReady(false)
    void lifecycle.open(container, authorizedRuntime, listOwnerViewport, {
      onOpenPlace: place => onOpenPlaceRef.current(place),
      onResult: outcome => {
        if (active) {
          setResult(outcome.kind)
          if (outcome.kind === 'rendered' || outcome.kind === 'incomplete') onReady(true)
        }
      },
    }, camera).then(outcome => {
      if (!active) return
      setResult(outcome.kind)
      onReady(outcome.kind === 'rendered' || outcome.kind === 'incomplete')
    }).catch(() => {
      if (active) onReady(false)
    })
    return () => {
      active = false
      lifecycle.dispose()
      onReady(false)
    }
  }, [authorizedRuntime, listOwnerViewport, onReady,
    camera.latitude, camera.longitude, camera.zoom])

  return (
    <Box component="section" data-xdrive-baidu-jsapi4-surface
      sx={{ px: { xs: 1.25, sm: 1.5 }, pb: 1.5, minWidth: 0 }}>
      <Box ref={mountRef} role="region" aria-label="百度动态地图"
        data-xdrive-baidu-jsapi4-canvas
        sx={{ width: '100%', height: { xs: 320, sm: 400 },
          minHeight: 280, borderRadius: 1.5 }} />
      {result === 'incomplete' ? (
        <Typography role="status" variant="caption" color="text.secondary">
          当前范围的地点超过 100 个，请放大地图以完整显示；不显示误导性的部分聚合。
        </Typography>
      ) : result && result !== 'rendered' ? (
        <Typography role="status" variant="caption" color="text.secondary">
          百度动态地图当前不可用，仍可使用原有地点列表。
        </Typography>
      ) : null}
    </Box>
  )
}
