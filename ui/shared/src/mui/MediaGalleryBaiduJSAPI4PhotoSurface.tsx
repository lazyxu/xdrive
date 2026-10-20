import { useEffect, useRef, useState } from 'react'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import { Box, Button, Typography } from '@mui/material'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import type { MediaThumbnailLoader } from './MediaGallery'
import { xDriveProjectBaiduPhotoCoverPins } from '../media-gallery-baidu-jsapi4-cover-pins'
import type { XDriveBaiduPhotoCoverPin } from '../media-gallery-baidu-jsapi4-cover-pins'
import { xDriveKeepBaiduJSAPI4MapSessionAlive } from '../media-gallery-baidu-jsapi4-session-lifecycle'
import {
  xDriveCreateBaiduJSAPI4IndexedBD09Mount,
} from '../media-gallery-baidu-jsapi4-browser-loader'
import type { XDriveBaiduJSAPI4SessionGrant } from '../media-gallery-baidu-jsapi4-browser-loader'
import type { XDriveBaiduJSAPI4InitialPhotoCamera } from '../media-gallery-baidu-jsapi4-mount'
import type { MediaBaiduNativeCellsPage, MediaBaiduNativeCellSelection, MediaBaiduNativeViewportBounds } from '../models'
import { xDriveSelectBaiduNativeCell } from '../media-gallery-baidu-jsapi4-cell-range'
import type { XDriveBaiduNativePhotoCellsRequest } from '../media-gallery-baidu-jsapi4-cells'
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
  listOwnerCells,
  loadThumbnail,
  camera,
  onOpenPhoto,
  onOpenCell,
  onCellInvalidated,
  onReady,
}: {
  mintMapOnlySession: (signal: AbortSignal) => Promise<XDriveBaiduJSAPI4SessionGrant>
  listOwnerViewport: XDriveBaiduNativePhotoViewportRequest
  listOwnerCells?: XDriveBaiduNativePhotoCellsRequest
  loadThumbnail?: MediaThumbnailLoader
  camera: XDriveBaiduJSAPI4InitialPhotoCamera
  onOpenPhoto: (identity: XDriveBaiduNativePhotoIdentity) => void
  onOpenCell?: (selection: MediaBaiduNativeCellSelection) => void
  onCellInvalidated?: () => void
  onReady: (ready: boolean) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const latestOpenPhoto = useRef(onOpenPhoto)
  latestOpenPhoto.current = onOpenPhoto
  const latestOpenCell = useRef(onOpenCell)
  latestOpenCell.current = onOpenCell
  const latestInvalidation = useRef(onCellInvalidated)
  latestInvalidation.current = onCellInvalidated
  // Capture the exact authenticated /cells result and the bounds of its query.
  // Provider clicks may never reconstruct these from a later camera frame.
  const currentAcceptedCellFrame = useRef<{
    page: MediaBaiduNativeCellsPage
    bounds: MediaBaiduNativeViewportBounds
  } | null>(null)
  const openTrustedCell = (clicked: MediaBaiduNativeCellsPage['cells'][number]) => {
    if (!latestOpenCell.current) {
      latestBridge.current?.focusCell(clicked)
      return
    }
    const frame = currentAcceptedCellFrame.current
    if (!frame) return
    const cell = xDriveSelectBaiduNativeCell(frame.page, frame.bounds, clicked)
    if (cell) latestOpenCell.current(cell)
  }
  const [result, setResult] = useState('')
  const [cellSummary, setCellSummary] = useState<MediaBaiduNativeCellsPage | null>(null)
  const [coverPins, setCoverPins] = useState<XDriveBaiduPhotoCoverPin[]>([])
  const [showCellList, setShowCellList] = useState(false)
  const latestBridge = useRef<XDriveBaiduJSAPI4IndexedViewportBridge | null>(null)

  useEffect(() => {
    const container = host.current
    if (!container) return
    let active = true
    const pending = new AbortController()
    const mount = xDriveCreateBaiduJSAPI4IndexedBD09Mount({ mintMapOnlySession })
    let native: Awaited<ReturnType<typeof mount.acquire>> | null = null
    let bridge: XDriveBaiduJSAPI4IndexedViewportBridge | null = null
    let clock: ReturnType<typeof setTimeout> | null = setTimeout(() => pending.abort(), 8000)
    let stopRenewal: (() => void) | null = null
    let resize: ResizeObserver | null = null
    let currentCells: MediaBaiduNativeCellsPage | null = null
    currentAcceptedCellFrame.current = null
    setResult('')
    setCellSummary(null)
    setCoverPins([])
    setShowCellList(false)
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
      const map = bound.map as XDriveBaiduNativeMapWithBounds & {
        pointToPixel?: (point: { lng: number; lat: number }) => { x: number; y: number }
      }
      if (typeof map.getBounds !== 'function') throw new Error('map_unavailable')
      // Third-party provider gets ONLY BD09 Point coordinates. Its Label/Layer
      // never receives a thumbnail URL, HTML, secret or photo pixels.
      const supportsCovers = Boolean(loadThumbnail && listOwnerCells &&
        typeof map.pointToPixel === 'function')
      const projectCovers = (page: MediaBaiduNativeCellsPage): XDriveBaiduPhotoCoverPin[] =>
        supportsCovers && map.pointToPixel
          ? xDriveProjectBaiduPhotoCoverPins(
              page, map as typeof map & { pointToPixel: NonNullable<typeof map.pointToPixel> },
              native!.namespace, container.clientWidth, container.clientHeight) ?? []
          : []
      bridge = new XDriveBaiduJSAPI4IndexedViewportBridge({
        ...bound, map,
      }, listOwnerViewport, {
        onOpenPhoto: identity => {
          if (active && !pending.signal.aborted) latestOpenPhoto.current(identity)
        },
        onViewportInvalidated: () => {},
        onCells: (page, bounds) => {
          if (!active || pending.signal.aborted) return
          if (!page) latestInvalidation.current?.()
          // A new pan/zoom invalidates the old selectable collection BEFORE paint.
          currentAcceptedCellFrame.current = page && bounds ? {
            page: { ...page, cells: page.cells.map(cell => ({ ...cell })) },
            bounds: { ...bounds },
          } : null
          currentCells = page
          setCellSummary(page)
          setCoverPins(page ? projectCovers(page) : [])
          if (!page) setShowCellList(false)
        },
        onResult: response => {
          if (!active || pending.signal.aborted) return
          setResult(response.kind)
          // A truncated result may show a licensed map but no invented cluster.
          onReady(response.kind === 'rendered' || response.kind === 'aggregated' ||
            response.kind === 'incomplete')
        },
      }, listOwnerCells, native.namespace, supportsCovers)
      latestBridge.current = bridge
      if (supportsCovers && typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(() => {
          if (active && !pending.signal.aborted && currentCells)
            setCoverPins(projectCovers(currentCells))
        })
        resize.observe(container)
      }
      const first = await bridge.refresh()
      if (!active || pending.signal.aborted) return
      setResult(first.kind)
      const ready = first.kind === 'rendered' || first.kind === 'aggregated' ||
        first.kind === 'incomplete'
      onReady(ready)
      if (ready) {
        stopRenewal = xDriveKeepBaiduJSAPI4MapSessionAlive(
          mintMapOnlySession, pending.signal, container.ownerDocument, () => {
            if (!active || pending.signal.aborted) return
            // The 2-minute map Cookie was revoked or could not be renewed.
            // Tear down BMap/ClusterLayer NOW; static Baidu remains available.
            pending.abort()
            bridge?.dispose()
            bridge = null
            latestBridge.current = null
            native?.dispose()
            native = null
            currentCells = null
            currentAcceptedCellFrame.current = null
            resize?.disconnect()
            setCellSummary(null)
            setCoverPins([])
            setResult('unavailable')
            onReady(false)
          })
      }
    }
    void opened().catch(() => {
      // A failed SDK bind, revoked Session or unusable viewport must release
      // the native map immediately, not only after a later component unmount.
      bridge?.dispose()
      bridge = null
      latestBridge.current = null
      native?.dispose()
      native = null
      if (active && !pending.signal.aborted) {
        setResult('unavailable')
        onReady(false)
      }
    })
    return () => {
      currentAcceptedCellFrame.current = null
      stopRenewal?.()
      resize?.disconnect()
      active = false
      pending.abort()
      if (clock !== null) clearTimeout(clock)
      bridge?.dispose()
      latestBridge.current = null
      native?.dispose()
      onReady(false)
    }
  }, [mintMapOnlySession, listOwnerViewport, listOwnerCells, loadThumbnail, onReady,
    camera.latitude, camera.longitude, camera.zoom])

  return (
    <Box component="section" data-xdrive-baidu-jsapi4-bd09-photo-surface
      sx={{ px: { xs: 1.25, sm: 1.5 }, pb: 1.5, minWidth: 0 }}>
      <Box sx={{ position: 'relative', width: '100%', minWidth: 0 }}>
        <Box ref={host} role="region" aria-label="百度动态照片地图"
          data-xdrive-baidu-jsapi4-bd09-photo-canvas
          sx={{ width: '100%', height: { xs: 320, sm: 400 },
            minHeight: 280, borderRadius: 1.5, overflow: 'hidden' }} />
        {coverPins.length > 0 && loadThumbnail ? (
          <Box data-xdrive-baidu-photo-cover-pins aria-label="地图照片缩略图标记"
            sx={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 4,
              pointerEvents: 'none', borderRadius: 1.5 }}>
            {coverPins.map(({ key, cell, x, y }) => (
              <Box component="button" type="button" key={key}
                data-xdrive-baidu-photo-cover-pin={cell.cell_x + ':' + cell.cell_y}
                aria-label={cell.photo_count.toLocaleString('zh-CN') +
                  (onOpenCell ? ' 张照片，打开区域照片墙' : ' 张照片，放大此处')}
                onClick={() => openTrustedCell(cell)}
                sx={{ position: 'absolute', left: x, top: y,
                  transform: 'translate(-50%, -100%)', width: 60, height: 64,
                  border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer',
                  pointerEvents: 'auto', touchAction: 'manipulation',
                  '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main',
                    outlineOffset: 2, borderRadius: 1 } }}>
                <Box sx={{ width: 54, height: 54, borderRadius: 1.5,
                  border: '3px solid #fff', bgcolor: 'background.paper',
                  overflow: 'hidden', boxShadow: 3 }}>
                  <XDriveMediaGalleryCoverThumbnail nodeID={cell.node_id}
                    revision={cell.node_revision} loadThumbnail={loadThumbnail}
                    alt="当前位置代表照片"
                    fallback={<Box sx={{ width: '100%', height: '100%',
                      display: 'grid', placeItems: 'center', color: 'text.secondary',
                      bgcolor: 'action.hover' }}><PhotoLibraryOutlinedIcon fontSize="small" /></Box>} />
                </Box>
                <Box component="span" sx={{ position: 'absolute', top: -5, right: -6,
                  minWidth: 24, height: 23, px: 0.5, borderRadius: 10,
                  bgcolor: 'primary.main', color: 'primary.contrastText',
                  border: '2px solid #fff', display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 800, lineHeight: 1, boxShadow: 2 }}>
                  {cell.photo_count.toLocaleString('zh-CN')}
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
      {result === 'aggregated' && cellSummary ? (
        <Box data-xdrive-baidu-true-cell-aggregation sx={{mt: 1, px: 0.5}}>
          <Typography role="status" variant="caption" color="text.secondary">
            当前范围共 {cellSummary.total_count.toLocaleString('zh-CN')} 张已授权照片，
            按 {cellSummary.cells.length} 个区域显示真实计数。
            数字标记使用真实照片位置；选择多张区域将放大地图；
            查看单张照片需经图库重新鉴权。
          </Typography>
          {coverPins.length > 0 ? (
            <Button size="small" variant="text" color="inherit"
              aria-expanded={showCellList}
              onClick={() => setShowCellList(value => !value)}>
              {showCellList ? '收起区域列表' : '查看全部区域（含重叠位置）'}
            </Button>
          ) : null}
          {(coverPins.length === 0 || showCellList) && (
          <Box sx={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(112px, 1fr))',
            gap:0.75,maxHeight:158,overflowY:'auto',mt:1}}
            aria-label="当前地图照片聚合区域">
            {cellSummary.cells.map(cell => (
              <Box component="button" type="button" key={cell.cell_x+':'+cell.cell_y}
                data-xdrive-baidu-owner-cell-button
                onClick={() => openTrustedCell(cell)}
                sx={{font:'inherit',color:'text.primary',border:'1px solid',
                  borderColor:'divider',borderRadius:1,background:'background.paper',
                  minHeight:44,cursor:'pointer',px:1}}>
                区域 {cell.cell_y*8+cell.cell_x+1} · {cell.photo_count.toLocaleString('zh-CN')} 张
              </Box>
            ))}
          </Box>
          )}
        </Box>
      ) : null}
      {result === 'incomplete' ? (
        <Typography role="status" variant="caption" color="text.secondary">
          当前地图范围内的已授权照片超过 100 张，请放大地图；不显示不完整的聚合结果。
        </Typography>
      ) : result && result !== 'rendered' && result !== 'aggregated' && result !== 'cancelled' ? (
        <Typography role="status" variant="caption" color="text.secondary">
          百度动态照片地图暂不可用，仍可使用原有地点与静态地图。
        </Typography>
      ) : null}
    </Box>
  )
}
