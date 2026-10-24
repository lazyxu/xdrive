import { useEffect, useRef, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import type { MediaThumbnailLoader } from './MediaGallery'
import type { XDriveTrustedProjectedMapCells } from '../media-gallery-baidu-isolated-frame-host'
import type { MediaBaiduNativeCellsPage, MediaBaiduNativeCellSelection } from '../models'
import { xDriveMountBaiduIsolatedFrame } from '../media-gallery-baidu-isolated-frame-host'
import { xDriveMountBaiduInlineMap } from '../media-gallery-baidu-inline-map-host'
import type { XDriveBaiduJSAPIPrototypeConfig } from '../models'
import type { XDriveBaiduIsolatedBounds } from '../media-gallery-baidu-isolated-origin-protocol'
import { xDriveValidBaiduNativeCellsPage } from '../media-gallery-baidu-jsapi4-cells'
import { xDriveSelectBaiduNativeCell } from '../media-gallery-baidu-jsapi4-cell-range'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { xDriveCurrentMapPhotoCollections } from '../media-gallery-places-map-strip'
import {
  xDriveBaiduMapPhotoScopeKey, xDriveCopyBaiduMapPhotoScope,
} from '../media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from '../media-gallery-baidu-map-photo-scope'
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
  getInlinePrototypeConfig,
  getInlineSignedStatus,
  mode = 'isolated',
  listOwnerCells,
  loadThumbnail,
  edgeToEdge = false,
  onOpenCell,
  onOpenViewport,
  onInvalidated,
  onCamera,
  onCameraClear,
  onReady,
  onFailure,
  initialCamera,
  scope,
  mapPhotoScope,
}: {
  childOrigin: string
  mintChildTicket?: (signal: AbortSignal) => Promise<{provider:'baidu-jsapi-4.0';child_origin:string;ticket:string}>
  getInlinePrototypeConfig?: (signal: AbortSignal) => Promise<XDriveBaiduJSAPIPrototypeConfig>
  getInlineSignedStatus?: (signal: AbortSignal) => Promise<{
    provider:'baidu-jsapi-4.0';enabled:boolean;activation_state:string;
    isolated_child_origin?:string
  }>
  mode?: 'inline' | 'isolated'
  listOwnerCells: (bounds: Bounds, signal: AbortSignal,
    filters?: XDriveBaiduMapPhotoScope['filters'], albumKey?: string) => Promise<MediaBaiduNativeCellsPage>
  loadThumbnail?: MediaThumbnailLoader
  edgeToEdge?: boolean
  onOpenCell: (selection: MediaBaiduNativeCellSelection, scope: XDriveBaiduMapPhotoScope) => void
  onOpenViewport?: (bounds: Bounds, scope: XDriveBaiduMapPhotoScope) => void
  onInvalidated?: () => void
  onCamera?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onCameraClear?: () => void
  onReady: (ready: boolean) => void
  onFailure?: () => void
  initialCamera?: XDriveBaiduNativeCameraSnapshot
  scope?: string
  mapPhotoScope: XDriveBaiduMapPhotoScope
}) {
  const mount = useRef<HTMLDivElement | null>(null)
  const failureCallback = useRef(onFailure)
  failureCallback.current = onFailure
  const opened = useRef(onOpenCell)
  const openViewport = useRef(onOpenViewport)
  const latestAcceptedViewport = useRef<Bounds | null>(null)
  // Owner-approved cells, their camera and filter signature form one scope.
  const currentFilterKey = xDriveBaiduMapPhotoScopeKey(mapPhotoScope)
  const scopeSnapshot = xDriveCopyBaiduMapPhotoScope(mapPhotoScope)
  const filterRef = useRef({key:currentFilterKey,snapshot:scopeSnapshot})
  filterRef.current = {key:currentFilterKey,snapshot:scopeSnapshot}
  const acceptedScope = useRef<{key:string;scope:XDriveBaiduMapPhotoScope}|null>(null)
  const acceptedCells = useRef<MediaBaiduNativeCellSelection[]>([])
  const lastViewport = useRef<{bounds:Bounds;live:boolean}|null>(null)
  const refreshFilteredCells = useRef<(() => void) | null>(null)
  const lastFilterKey = useRef(currentFilterKey)
  const invalidated = useRef(onInvalidated)
  const cameraUpdate = useRef(onCamera)
  const cameraClear = useRef(onCameraClear)
  opened.current = onOpenCell
  openViewport.current = onOpenViewport
  invalidated.current = onInvalidated
  cameraUpdate.current = onCamera
  cameraClear.current = onCameraClear
  const [summary,setSummary] = useState<MediaBaiduNativeCellsPage | null>(null)
  const [acceptedViewport, setAcceptedViewport] = useState<Bounds | null>(null)
  const [accessible,setAccessible] = useState<Array<{label:string;selection:MediaBaiduNativeCellSelection}>>([])
  const [phase,setPhase] = useState<'loading'|'ready'|'unavailable'>('loading')
  // Only the trusted Gallery Parent owns photo identity and Blob URLs.
  const [projected,setProjected] = useState<
    XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection> | null>(null)
  const [error,setError] = useState(false)
  const scopeIsCurrent = acceptedScope.current?.key === currentFilterKey
  const trustedSummary = scopeIsCurrent ? summary : null
  // Refresh the existing isolated map: never remount its SDK for a filter.
  useEffect(() => {
    if(lastFilterKey.current===currentFilterKey)return
    lastFilterKey.current=currentFilterKey
    refreshFilteredCells.current?.()
  },[currentFilterKey])

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
    setAcceptedViewport(null)
    latestAcceptedViewport.current = null
    setAccessible([])
    setProjected(null)
    onReady(false)

    const cancel = () => {
      generation++
      // An SDK gesture invalidates the previous camera as well as its Cells.
      // A filter change during pan/zoom must not resurrect that old viewport.
      lastViewport.current = null
      activeQuery?.abort()
      activeQuery = null
      acceptedScope.current = null
      acceptedCells.current = []
      setAccessible([])
      setSummary(null)
      setAcceptedViewport(null)
      latestAcceptedViewport.current = null
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
    const commonMapOptions = {
      host:node,parentWindow:win,
      onActivateCell:(selection:MediaBaiduNativeCellSelection) => {
        const approved=acceptedScope.current
        if(!lifetime.signal.aborted && approved && approved.key===filterRef.current.key &&
          acceptedCells.current.some(cell=>cell.node_id===selection.node_id &&
            cell.asset_id===selection.asset_id && cell.node_revision===selection.node_revision &&
            cell.cell_x===selection.cell_x && cell.cell_y===selection.cell_y &&
            cell.photo_count===selection.photo_count)) {
          opened.current(selection,approved.scope)
        }
      },
      onCancel:cancel,
      onCamera:(camera:XDriveBaiduNativeCameraSnapshot) => { if(!lifetime.signal.aborted) cameraUpdate.current?.(camera) },
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
      onProjectedCells:(positions:XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection>) => {
        if (!lifetime.signal.aborted) setProjected(positions)
      },
      onViewport: (bounds:Bounds) => { void queryCells(bounds, true) },
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
    }
    // Business/Owner Cells/Wall/Viewer stay in this SAME trusted React Parent.
    // Only the map SDK host changes: same document or independent HTTPS Child.
    const frame = mode === 'inline'
      ? (getInlinePrototypeConfig && getInlineSignedStatus
        ? xDriveMountBaiduInlineMap<MediaBaiduNativeCellSelection>({
          ...commonMapOptions,
          getPrototypeConfig:getInlinePrototypeConfig,
          getSignedStatus:getInlineSignedStatus,
        })
        : null)
      : xDriveMountBaiduIsolatedFrame<MediaBaiduNativeCellSelection>({
        ...commonMapOptions,childOrigin,
      })
    if (!frame) { failure(); return }

    const queryCells = async (bounds: Bounds, liveCamera = false): Promise<boolean> => {
      if (lifetime.signal.aborted) return false
      // Cancel the previous query and invalidate its Camera before recording
      // the newly requested bounds for possible same-camera filter refresh.
      cancel()
      lastViewport.current={bounds:{...bounds},live:liveCamera}
      frame.replaceAuthorizedCells([])
      const approved=filterRef.current
      if(!approved.snapshot)return false
      const request = new AbortController()
      const onLifetime = () => request.abort()
      lifetime.signal.addEventListener('abort',onLifetime,{once:true})
      activeQuery=request
      const run = generation
      try {
        const page = await listOwnerCells(bounds,request.signal,
          approved.snapshot.filters,approved.snapshot.albumKey)
        if(request.signal.aborted || lifetime.signal.aborted || run!==generation ||
           approved.key!==filterRef.current.key)return false
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
        if(approved.key!==filterRef.current.key || run!==generation)return false
        acceptedScope.current={key:approved.key,scope:approved.snapshot}
        acceptedCells.current=cells.map(item=>item.selection)
        setAccessible(cells.map((item,index)=>({
          label:'区域 '+(page.cells[index].cell_y*8+page.cells[index].cell_x+1)+
            ' · '+page.cells[index].photo_count.toLocaleString('zh-CN'),
          selection:item.selection,
        })))
        setSummary(page)
        // Only a live, Owner-verified SDK viewport can open the full photo
        // wall. The bootstrapping worldwide /cells query is not a camera.
        const accepted = liveCamera ? { ...bounds } : null
        latestAcceptedViewport.current = accepted
        setAcceptedViewport(accepted)
        return true
      } catch {
        if(!request.signal.aborted && !lifetime.signal.aborted && run===generation) {
          frame.replaceAuthorizedCells([])
          setSummary(null)
          latestAcceptedViewport.current = null
          setAcceptedViewport(null)
          setAccessible([])
        }
        return false
      } finally {
        lifetime.signal.removeEventListener('abort',onLifetime)
        if(activeQuery===request)activeQuery=null
      }
    }
    refreshFilteredCells.current=()=>{
      if(lifetime.signal.aborted || failed || !lastViewport.current)return
      const last=lastViewport.current
      void queryCells({...last.bounds},last.live)
    }
    const acquireTicket=async() => {
      if(lifetime.signal.aborted || failed) return
      try {
        if(mode==='inline') {
          if(!frame || !('beginAuthorizedInlineSession' in frame) ||
              !await frame.beginAuthorizedInlineSession(lifetime.signal))
            throw new Error('map_session_denied')
          return
        }
        if(!mintChildTicket || !frame || !('bootstrapMapSession' in frame))
          throw new Error('map_session_denied')
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
      refreshFilteredCells.current=null
      cancel()
      lifetime.abort()
      if(refresh!==null)clearInterval(refresh)
      frame.dispose()
      onReady(false)
    }
  },[childOrigin,mintChildTicket,getInlinePrototypeConfig,getInlineSignedStatus,mode,listOwnerCells,onReady,scope])

  // Select the most informative visible covers and avoid overcrowding.
  // All 64 map numbers remain in the provider map; only 24 thumbnails load.
  const coverPins: Array<{selection:MediaBaiduNativeCellSelection;
    count:number;x:number;y:number}> = []
  if (scopeIsCurrent && projected?.width && projected.height && loadThumbnail && phase === 'ready') {
    for (const candidate of [...projected.cells].sort((a,b) => b.count-a.count)) {
      if (coverPins.length >= 24) break
      if (coverPins.some(pin => Math.hypot(pin.x-candidate.x,pin.y-candidate.y) < 72)) continue
      coverPins.push(candidate)
    }
  }
  // Only use a CURRENT Parent-owned /cells snapshot, never a Child-generated
  // key as private media authority. A pan/revoke clears both inputs.
  const photoStrip = scopeIsCurrent && phase === 'ready'
    ? xDriveCurrentMapPhotoCollections(trustedSummary, projected, accessible.map(cell => cell.selection)) : []
  const openVerifiedCell=(selection:MediaBaiduNativeCellSelection)=>{
    const approved=acceptedScope.current
    if(approved && approved.key===filterRef.current.key &&
        acceptedCells.current.some(cell=>cell.node_id===selection.node_id &&
          cell.asset_id===selection.asset_id && cell.node_revision===selection.node_revision &&
          cell.cell_x===selection.cell_x && cell.cell_y===selection.cell_y &&
          cell.photo_count===selection.photo_count))opened.current(selection,approved.scope)
  }
  return (
    <Box component="section" data-xdrive-baidu-isolated-photo-map
      sx={{px:edgeToEdge ? 0 : {xs:1.25,sm:1.5},pb:edgeToEdge ? 0 : 1.5,minWidth:0}}>
      <Box data-xdrive-places-cluster-overview role="region" aria-label="定位照片聚集地图"
        sx={{position:'relative',width:'100%',height:{
          xs:'max(460px, calc(100dvh - 190px))',
          sm:'max(540px, calc(100dvh - 185px))'},
          maxHeight:1024,borderRadius:edgeToEdge ? 0 : 1.5,
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
                onClick={() => openVerifiedCell(pin.selection)}
                sx={{position:'absolute',
                  left:`${pin.x/projected.width*100}%`,
                  top:`${pin.y/projected.height*100}%`,
                  transform:'translate(-50%,-50%)',width:60,height:60,p:0,
                  border:'2px solid white',borderRadius:2,overflow:'visible',
                  cursor:'pointer',pointerEvents:'auto',
                  bgcolor:'background.paper',boxShadow:'0 3px 12px rgba(15,23,42,.28)',
                  isolation:'isolate',
                  '&:focus-visible':{outline:'3px solid',outlineColor:'primary.main',
                    outlineOffset:3}}}>

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
                <Box component="span"
                  sx={{position:'absolute',bottom:-6,right:-6,minWidth:27,
                    maxWidth:100,px:0.75,display:'grid',placeItems:'center',
                    borderRadius:'999px',bgcolor:'rgba(15,23,42,.94)',
                    color:'#fff',boxShadow:1,fontSize:11,fontWeight:700,
                    lineHeight:'21px',whiteSpace:'nowrap',overflow:'hidden',
                    textOverflow:'ellipsis'}}>
                  {pin.count.toLocaleString('zh-CN')}张
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}
        {loadThumbnail && photoStrip.length > 0 ? (
          <Box data-xdrive-places-photo-collection-strip
            aria-label="地图照片区域封面"
            sx={{position:'absolute',left:{xs:8,sm:16},right:{xs:8,sm:16},
              bottom:{xs:10,sm:16},zIndex:5,pointerEvents:'none'}}>
            <Box sx={{pointerEvents:'auto',p:0.8,px:1,borderRadius:2,
              bgcolor:'background.paper',boxShadow:3,
              border:'1px solid',borderColor:'divider',maxWidth:560,
              mx:'auto',backdropFilter:'blur(14px)'}}>
              <Typography variant="caption" sx={{display:'block',mb:0.5,
                fontWeight:700}}>
                照片地点 · 当前区域 {trustedSummary?.total_count.toLocaleString('zh-CN')} 张
              </Typography>
              <Box component="nav" aria-label="浏览地图当前聚合区域照片"
                sx={{display:'flex',gap:0.75,overflowX:'auto',overflowY:'hidden',
                  pb:0.25,touchAction:'pan-x',scrollbarWidth:'thin'}}>
                {photoStrip.map(pin => (
                  <Button key={pin.selection.cell_x+':'+pin.selection.cell_y}
                    data-xdrive-places-collection-thumb={pin.selection.node_id}
                    aria-label={'查看区域 '+
                      (pin.selection.cell_y*8+pin.selection.cell_x+1)+
                      ' 的 '+pin.count.toLocaleString('zh-CN')+' 张照片'}
                    onClick={() => openVerifiedCell(pin.selection)}
                    sx={{position:'relative',display:'block',flex:'0 0 76px',
                      width:76,minWidth:76,height:78,p:0.5,
                      borderRadius:1.5,border:'1px solid',borderColor:'divider',
                      bgcolor:'action.hover',textTransform:'none',
                      '&:focus-visible':{outline:'3px solid',
                        outlineColor:'primary.main',outlineOffset:2}}}>
                    <Box sx={{width:'100%',height:52,borderRadius:1,
                      overflow:'hidden',bgcolor:'background.default'}}>
                      <XDriveMediaGalleryCoverThumbnail
                        nodeID={pin.selection.node_id}
                        revision={pin.selection.node_revision}
                        loadThumbnail={loadThumbnail}
                        alt={'区域 '+(pin.selection.cell_y*8+pin.selection.cell_x+1)+'代表照片'}
                        fallback={<PhotoLibraryOutlinedIcon fontSize="small"/>}/>
                    </Box>
                    <Typography variant="caption" component="span"
                      sx={{fontSize:10,fontWeight:700,display:'block',lineHeight:'16px'}}>
                      {pin.count.toLocaleString('zh-CN')} 张
                    </Typography>
                  </Button>
                ))}
              </Box>
            </Box>
          </Box>
        ) : null}
      </Box>
      {trustedSummary ? (
        <Box sx={{ px:edgeToEdge ? 1 : 0, display:'flex',alignItems:'center',
          justifyContent:'space-between',gap:1,flexWrap:'wrap',mt:0.75 }}>
          <Typography variant="caption" color="text.secondary">
            {trustedSummary.total_count > 0
              ? `当前地图可查看 ${trustedSummary.total_count.toLocaleString('zh-CN')} 张照片`
              : '当前没有可显示的定位照片，可在照片详情中查看地图权限。'}
          </Typography>
          {acceptedViewport && phase === 'ready' && openViewport.current && trustedSummary.total_count > 0 ? (
            <Button size="small" variant="outlined"
              data-xdrive-places-full-camera-wall
              sx={{minHeight:44,textTransform:'none'}}
              onClick={() => {
                const accepted = latestAcceptedViewport.current
                if (accepted && accepted.west===acceptedViewport.west &&
                    accepted.east===acceptedViewport.east &&
                    accepted.south===acceptedViewport.south &&
                    accepted.north===acceptedViewport.north) {
                  const approved=acceptedScope.current
                  if(approved && approved.key===filterRef.current.key)
                    openViewport.current?.({...accepted},approved.scope)
                }
              }}>
              查看此地图的全部照片
            </Button>
          ) : null}
        </Box>
      ):null}
      {phase==='unavailable' ? (
        <Typography role="alert" variant="caption" color="text.secondary">
          动态地图隔离会话不可用；地点列表与照片墙仍可使用。
        </Typography>
      ):null}
      {scopeIsCurrent && accessible.length>0 ? (
        <Box component="details" data-xdrive-places-cluster-list>
          <Box component="summary" sx={{cursor:'pointer',typography:'caption',
            color:'text.secondary',minHeight:36}}>
            聚集点列表（{accessible.length}）
          </Box>
        <Box component="nav" aria-label="当前地图聚合区域"
          sx={{display:'flex',flexWrap:'wrap',gap:0.5,mt:0.5}}>
          {accessible.map((cell,index)=>(
            <Button key={index} size="small" variant="text"
              onClick={()=>openVerifiedCell(cell.selection)} disabled={phase!=='ready'}>
              {cell.label}
            </Button>
          ))}
        </Box>
        </Box>
      ):null}
      {error ? <Typography role="alert" variant="caption" color="text.secondary">动态地图加载失败，请查看地图诊断并重试。</Typography> : null}
    </Box>
  )

}
