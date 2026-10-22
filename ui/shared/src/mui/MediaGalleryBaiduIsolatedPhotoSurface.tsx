import { useEffect, useRef, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import type { MediaThumbnailLoader } from './MediaGallery'
import type { XDriveTrustedProjectedMapCells } from '../media-gallery-baidu-isolated-frame-host'
import type { MediaBaiduNativeCellsPage, MediaBaiduNativeCellSelection } from '../models'
import { xDriveMountBaiduIsolatedFrame } from '../media-gallery-baidu-isolated-frame-host'
import type { XDriveBaiduIsolatedBounds } from '../media-gallery-baidu-isolated-origin-protocol'
import { xDriveValidBaiduNativeCellsPage } from '../media-gallery-baidu-jsapi4-cells'
import { xDriveSelectBaiduNativeCell } from '../media-gallery-baidu-jsapi4-cell-range'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'

type Bounds = XDriveBaiduIsolatedBounds

/**
 * Third-party Baidu code and map DOM live only under the separate HTTPS Child.
 * The trusted Parent performs every Owner/Consent/revision-gated /cells query,
 * and an activation only opens the original authorized /cell-items Range.
 * Neither JWT, image URLs, blobs, PhotoAsset IDs nor original WGS84 coordinates
 * enter the iframe. All navigation/unmount/query cancellations abort requests.
 */
export function XDriveMediaGalleryBaiduIsolatedPhotoSurface({
  childOrigin,
  mintChildTicket,
  listOwnerCells,
  loadThumbnail,
  onOpenCell,
  onInvalidated,
  onCamera,
  onCameraClear,
  onReady,
  onFailure,
  initialCamera,
  scope,
}: {
  childOrigin: string
  mintChildTicket: (signal: AbortSignal) => Promise<{provider:'baidu-jsapi-4.0';child_origin:string;ticket:string}>
  listOwnerCells: (bounds: Bounds, signal: AbortSignal) => Promise<MediaBaiduNativeCellsPage>
  loadThumbnail?: MediaThumbnailLoader
  onOpenCell: (selection: MediaBaiduNativeCellSelection) => void
  onInvalidated?: () => void
  onCamera?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onCameraClear?: () => void
  onReady: (ready: boolean) => void
  onFailure?: () => void
  initialCamera?: XDriveBaiduNativeCameraSnapshot
  scope?: string
}) {
  const mount = useRef<HTMLDivElement | null>(null)
  const failureCallback = useRef(onFailure)
  failureCallback.current = onFailure
  const opened = useRef(onOpenCell)
  const invalidated = useRef(onInvalidated)
  const cameraUpdate = useRef(onCamera)
  const cameraClear = useRef(onCameraClear)
  opened.current = onOpenCell
  invalidated.current = onInvalidated
  cameraUpdate.current = onCamera
  cameraClear.current = onCameraClear
  const [summary,setSummary] = useState<MediaBaiduNativeCellsPage | null>(null)
  const [accessible,setAccessible] = useState<Array<{label:string;selection:MediaBaiduNativeCellSelection}>>([])
  const [phase,setPhase] = useState<'loading'|'ready'|'unavailable'>('loading')
  // Only the trusted Gallery Parent owns photo identity and Blob URLs.
  const [projected,setProjected] = useState<
    XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection> | null>(null)
  const [error,setError] = useState(false)

  useEffect(() => {
    const node = mount.current
    const win = node?.ownerDocument.defaultView
    if (!node || !win) return
    const lifetime = new AbortController()
    let generation = 0
    let activeQuery: AbortController | null = null
    let refresh: ReturnType<typeof setInterval> | null = null
    let failed = false
    // Freeze the Owner-local camera return hint for this iframe lifetime.
    let returnCamera = xDriveValidBaiduNativeCameraSnapshot(initialCamera)
      ? { coordinate_space: 'bd09ll' as const,
          latitude: initialCamera.latitude, longitude: initialCamera.longitude,
          zoom: initialCamera.zoom }
      : null
    setPhase('loading')
    setError(false)
    setSummary(null)
    setAccessible([])
    setProjected(null)
    onReady(false)

    const cancel = () => {
      generation++
      activeQuery?.abort()
      activeQuery = null
      setAccessible([])
      setSummary(null)
      setProjected(null)
      invalidated.current?.()
    }
    const failure = () => {
      if (lifetime.signal.aborted || failed) return
      failed = true
      cancel()
      lifetime.abort()
      if (refresh !== null) clearInterval(refresh)
      setPhase('unavailable')
      setError(true)
      setSummary(null)
      frame?.dispose()
      cameraClear.current?.()
      onReady(false)
      failureCallback.current?.()
    }
    const frame = xDriveMountBaiduIsolatedFrame<MediaBaiduNativeCellSelection>({
      host:node,parentWindow:win,childOrigin,
      onActivateCell:selection => { if(!lifetime.signal.aborted)opened.current(selection) },
      onCancel:cancel,
      onCamera:camera => { if(!lifetime.signal.aborted) cameraUpdate.current?.(camera) },
      onMapReady:() => {
        if(lifetime.signal.aborted)return
        if (returnCamera) {
          const camera = returnCamera
          returnCamera = null
          if (!frame?.restoreCamera(camera)) { failure(); return }
        }
        setPhase('ready')
        onReady(true)
      },
      onMapFailure:failure,
      onProjectedCells:positions => {
        if (!lifetime.signal.aborted) setProjected(positions)
      },
      onViewport: bounds => { void queryCells(bounds) },
      onReady:() => {
        const world: Bounds = {coordinate_space:'bd09ll',west:-180,south:-85,east:180,north:85}
        // An initial viewport request must not race away the worldwide
        // anonymous Owner/Consent summary before the SDK can fit to it.
        void queryCells(world).then(ok => {
          if (lifetime.signal.aborted || failed) return
          if (!ok) { failure(); return }
          void acquireTicket()
        })
      },
    })
    if (!frame) { failure(); return }

    const queryCells = async (bounds: Bounds): Promise<boolean> => {
      if (lifetime.signal.aborted) return false
      cancel()
      frame.replaceAuthorizedCells([])
      const request = new AbortController()
      const onLifetime = () => request.abort()
      lifetime.signal.addEventListener('abort',onLifetime,{once:true})
      activeQuery=request
      const run = generation
      try {
        const page = await listOwnerCells(bounds,request.signal)
        if(request.signal.aborted || lifetime.signal.aborted || run!==generation) return false
        if(!xDriveValidBaiduNativeCellsPage(page,bounds) ||
            page.cells.some(cell => !Number.isSafeInteger(cell.node_revision) || (cell.node_revision ?? 0)<=0)) {
          throw new Error('map_cells_invalid')
        }
        const cells: Array<{latitude:number;longitude:number;count:number;selection:MediaBaiduNativeCellSelection}> = []
        for(const cell of page.cells) {
          const selection=xDriveSelectBaiduNativeCell(page,bounds,cell)
          if(!selection)throw new Error('map_cell_revoked')
          cells.push({latitude:cell.latitude,longitude:cell.longitude,
            count:cell.photo_count,selection})
        }
        if(!frame.replaceAuthorizedCells(cells)) throw new Error('map_cells_unavailable')
        setAccessible(cells.map((item,index)=>({
          label:'区域 '+(page.cells[index].cell_y*8+page.cells[index].cell_x+1)+
            ' · '+page.cells[index].photo_count.toLocaleString('zh-CN'),
          selection:item.selection,
        })))
        setSummary(page)
        return true
      } catch {
        if(!request.signal.aborted && !lifetime.signal.aborted && run===generation) {
          frame.replaceAuthorizedCells([])
          setSummary(null)
          setAccessible([])
        }
        return false
      } finally {
        lifetime.signal.removeEventListener('abort',onLifetime)
        if(activeQuery===request)activeQuery=null
      }
    }
    const acquireTicket=async() => {
      if(lifetime.signal.aborted || failed) return
      try {
        const receipt=await mintChildTicket(lifetime.signal)
        if(lifetime.signal.aborted || receipt?.provider!=='baidu-jsapi-4.0' ||
            receipt.child_origin!==childOrigin || !/^[a-f0-9]{64}$/.test(receipt.ticket) ||
            !frame.bootstrapMapSession(receipt.ticket)) throw new Error('map_session_denied')
      } catch { failure() }
    }
    // Restore only the validated BD-09 camera after Child map-ready.
    // Original WGS84 photo EXIF never enters the isolated document.
    refresh=setInterval(() => { if(!lifetime.signal.aborted)void acquireTicket() },65_000)
    return () => {
      cancel()
      lifetime.abort()
      if(refresh!==null)clearInterval(refresh)
      frame.dispose()
      onReady(false)
    }
  },[childOrigin,mintChildTicket,listOwnerCells,onReady,scope])

  // Select the most informative visible covers and avoid overcrowding.
  // All 64 map numbers remain in the provider map; only 24 thumbnails load.
  const coverPins: Array<{selection:MediaBaiduNativeCellSelection;
    count:number;x:number;y:number}> = []
  if (projected?.width && projected.height && loadThumbnail && phase === 'ready') {
    for (const candidate of [...projected.cells].sort((a,b) => b.count-a.count)) {
      if (coverPins.length >= 24) break
      if (coverPins.some(pin => Math.hypot(pin.x-candidate.x,pin.y-candidate.y) < 72)) continue
      coverPins.push(candidate)
    }
  }
  return (
    <Box component="section" data-xdrive-baidu-isolated-photo-map
      sx={{px:{xs:1.25,sm:1.5},pb:1.5,minWidth:0}}>
      <Box data-xdrive-places-cluster-overview role="region" aria-label="定位照片聚集地图"
        sx={{position:'relative',width:'100%',height:{
          xs:'max(460px, calc(100dvh - 190px))',
          sm:'max(540px, calc(100dvh - 185px))'},
          maxHeight:1024,borderRadius:1.5,
          overflow:'hidden',backgroundColor:'background.default'}}>
        <Box ref={mount} sx={{position:'absolute',inset:0,
          '& iframe':{width:'100%',height:'100%',display:'block',border:0}}}/>
        {coverPins.length > 0 && projected ? (
          <Box data-xdrive-places-trusted-photo-cover-pins
            sx={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2}}>
            {coverPins.map((pin) => (
              <Box key={pin.selection.node_id} component="button" type="button"
                data-xdrive-places-trusted-photo-cover={pin.selection.node_id}
                aria-label={`查看该区域 ${pin.count} 张照片`}
                onClick={() => opened.current(pin.selection)}
                sx={{position:'absolute',
                  left:`${pin.x/projected.width*100}%`,
                  top:`${pin.y/projected.height*100}%`,
                  transform:'translate(-50%,-50%)',width:58,height:58,p:0,
                  border:'3px solid white',borderRadius:1.5,overflow:'visible',
                  cursor:'pointer',pointerEvents:'auto',
                  bgcolor:'background.paper',boxShadow:'0 4px 14px rgba(0,0,0,.25)',
                  isolation:'isolate',
                  '&:focus-visible':{outline:'3px solid',outlineColor:'primary.main',
                    outlineOffset:3}}}>
                {pin.count > 1 ? (
                  <Box component="span" aria-hidden="true" sx={{position:'absolute',
                    inset:0,transform:'translate(4px,3px) rotate(9deg)',
                    borderRadius:1.5,bgcolor:'background.paper',
                    border:'2px solid white',boxShadow:2,zIndex:-1}}/>
                ) : null}
                <Box sx={{width:'100%',height:'100%',borderRadius:1,overflow:'hidden',
                  bgcolor:'action.hover'}}>
                  {loadThumbnail ? (
                    <XDriveMediaGalleryCoverThumbnail
                      nodeID={pin.selection.node_id}
                      revision={pin.selection.node_revision}
                      alt="地图聚集点代表照片" loadThumbnail={loadThumbnail}
                      fallback={<Box sx={{width:'100%',height:'100%',display:'grid',
                        placeItems:'center',color:'text.secondary'}}>
                        <PhotoLibraryOutlinedIcon fontSize="small"/>
                      </Box>}/>
                  ) : null}
                </Box>
                {pin.count > 1 ? <Box component="span"
                  sx={{position:'absolute',top:-9,right:-11,minWidth:25,height:23,
                    px:0.6,display:'grid',placeItems:'center',borderRadius:3,
                    bgcolor:'primary.main',color:'primary.contrastText',
                    border:'2px solid white',boxShadow:1,
                    fontSize:11,fontWeight:800,lineHeight:1}}>
                  {pin.count.toLocaleString('zh-CN')}
                </Box> : null}
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
      {summary ? (
        <Typography variant="caption" color="text.secondary">
          {summary.total_count > 0
            ? `当前授权地图区域 ${summary.total_count.toLocaleString('zh-CN')} 张，`+
              `${summary.cells.length} 个聚集标记；点击后由图库重新验证权限。`
            : '当前没有获准在百度地图中显示的照片；照片具有 GPS 并不代表已授予地图使用许可。可在照片详情中授权后重新打开地点。'}
        </Typography>
      ):null}
      {phase==='unavailable' ? (
        <Typography role="alert" variant="caption" color="text.secondary">
          动态地图隔离会话不可用，请使用原有静态地图和地点列表。
        </Typography>
      ):null}
      {accessible.length>0 ? (
        <Box component="details" data-xdrive-places-cluster-list>
          <Box component="summary" sx={{cursor:'pointer',typography:'caption',
            color:'text.secondary',minHeight:36}}>
            聚集点列表（{accessible.length}）
          </Box>
        <Box component="nav" aria-label="当前地图聚合区域"
          sx={{display:'flex',flexWrap:'wrap',gap:0.5,mt:0.5}}>
          {accessible.map((cell,index)=>(
            <Button key={index} size="small" variant="text"
              onClick={()=>opened.current(cell.selection)} disabled={phase!=='ready'}>
              {cell.label}
            </Button>
          ))}
        </Box>
        </Box>
      ):null}
      {error ? <Box data-xdrive-baidu-isolated-static-fallback /> : null}
    </Box>
  )

}
