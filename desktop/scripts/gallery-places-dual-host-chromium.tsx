import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { XDriveMediaGalleryBaiduIsolatedPhotoSurface } from '@fixture/surface'
import { XDriveMediaGalleryViewer } from '@fixture/viewer'
import { XDriveMediaGalleryPage } from '@fixture/gallery-page'
import { XDriveMediaGalleryPlacesMap } from '../../ui/shared/src/mui/MediaGalleryPlacesMap'
import { xDriveNormalizeBaiduMapPhotoScope } from '../../ui/shared/src/media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from '../../ui/shared/src/media-gallery-baidu-map-photo-scope'
import { xDriveValidBaiduNativeCameraSnapshot } from '../../ui/shared/src/media-gallery-baidu-native-camera-session'
import type { XDriveBaiduNativeCameraSnapshot } from '../../ui/shared/src/media-gallery-baidu-native-camera-session'
import { xDriveTakeMapScopeHandoffFromURL, xDriveRestoreMapReferrerAfterScrub } from '../../web/src/mapScopeHandoff'
import { xDriveRememberPlacesDrawerViewerReturn } from '../../ui/shared/src/media-gallery-places-photo-drawer'
import { xDriveBaiduNativeCellRangeParams } from '../../ui/shared/src/media-gallery-baidu-jsapi4-cell-range'
import { xDriveBaiduNativeViewportRangeParams } from '../../ui/shared/src/media-gallery-baidu-jsapi4-viewport-range'
import { xDriveBaiduNativeCellsFilterParams } from '../../ui/shared/src/media-gallery-baidu-jsapi4-viewport-range'

type Bounds = {coordinate_space:'bd09ll';west:number;east:number;south:number;north:number}
type Scope = {albumKey:string;filters:{sort_by:'captured';sort_dir:'desc';favorite?:boolean}}
const mode = new URLSearchParams(location.search).get('mode') === 'isolated' ? 'isolated' : 'inline'
const childOrigin = 'https://map-isolated.example.org:' + location.port
const genuineGin = (window as any).__P04_REAL_GIN === true
const darkMapAppearance = new URLSearchParams(location.search).get('ui_scheme') === 'dark'
const darkMapTheme = createTheme({palette:{mode:'dark'}})
const lightMapTheme = createTheme({palette:{mode:'light'}})
const fullGalleryPage = new URLSearchParams(location.search).get('full_gallery') === '1'
const fullGalleryDirectPhoto = new URLSearchParams(location.search).get('full_gallery_direct') === '1'
const favoritesMapEntry = new URLSearchParams(location.search).get('start_favorites') === '1'
// Controlled Owner GPS -> BD-09 delayed derivative. The mounted SDK starts
// with no signed Cells, then the test completes indexing without remounting.
const delayedBD09 = new URLSearchParams(location.search).get('delayed_bd09') === '1'
const videoPosterMode = new URLSearchParams(location.search).get('map_h264') === '1'
const realHEICMode = genuineGin &&
  new URLSearchParams(location.search).get('map_real_heic') === '1'
const realLIVPMode = genuineGin &&
  new URLSearchParams(location.search).get('map_real_livp') === '1'
const realImageOwnerAccount = realHEICMode?'heic':realLIVPMode?'livp':
  genuineGin&&new URLSearchParams(location.search).get('handoff_foreign')==='1'
    ? 'foreign' : ''
// The genuine Web bootstrap must inspect and scrub the opaque one-use URL
// before a React map, SDK loader or private Owner Cell can mount.
const fullDocumentHandoff = genuineGin &&
  new URLSearchParams(location.search).get('handoff_doc') === '1'
const combinedAlbumHandoff = fullDocumentHandoff &&
  new URLSearchParams(location.search).get('handoff_combo') === '1'
const compactMapAppearance = fullDocumentHandoff &&
  new URLSearchParams(location.search).get('ios_compact') === '1'
const initialHandoff = fullDocumentHandoff
  ? xDriveTakeMapScopeHandoffFromURL(window) : {state:'none' as const}
if(fullDocumentHandoff)xDriveRestoreMapReferrerAfterScrub(window)
let derivedLocationReady = !delayedBD09
let savedSyntheticPoster: Blob | null = null
// An opt-in synthetic failure during a *post-ready* restricted Owner query.
// The next identical retry must recover without remounting either SDK Host.
const testCellsFailure = new URLSearchParams(location.search).get('cells_failure') === '1'
let failFavoriteCellsOnce = false
let ownerAccess: Promise<string> | undefined
const ownerToken = () => ownerAccess ??= fetch('/__fixture/map-owner'+
  (realImageOwnerAccount?'?account='+realImageOwnerAccount:''),
  {cache:'no-store'}).then(async response=>{
  if(!response.ok)throw Error('real Gin Owner not authenticated')
  const result=await response.json()
  if(typeof result.token!=='string')throw Error('real Gin JWT unavailable')
  return result.token as string
})
const geometry = (bounds:Bounds) => new URLSearchParams({
  west:String(bounds.west),south:String(bounds.south),
  east:String(bounds.east),north:String(bounds.north),
})
const ownerRequest = async (route:string,query:URLSearchParams,signal?:AbortSignal)=>{
  const token=await ownerToken()
  const response=await fetch('/api/v1/media/places/baidu-jsapi/'+route+
    '?'+query.toString(),{signal,cache:'no-store',
    headers:{Authorization:'Bearer '+token}})
  if(!response.ok)throw Error('real Gin Owner map range denied')
  return response.json()
}

const probe = ((window as any).__mapProbe = {
  mode, ready:false, failed:false, queries:[] as any[],
  clicks:[] as any[], viewports:[] as any[], cameras:[] as any[],
  invalidations:0, realGin:genuineGin, ownerCellRange:null as any,
  ownerViewportRange:null as any, rangeError:false,
  viewerSourceItem:null as any, viewerOpened:0, viewerClosed:0,
  galleryPageReads:[] as any[], galleryPageErrors:[] as string[],
  galleryPageDirectOpens:[] as any[], galleryPageDirectClosed:0,
  photoPreviewRanges:[] as any[], photoOpens:[] as any[],
  bd09Completions:0,failedOwnerCellsReads:[] as any[],
  h264:{misses:0,warm:0,previewURLs:0,puts:0,putBytes:0},
  heic:{reads:0,bytes:0,mime:'',nodeID:0},
  livp:{reads:0,bytes:0,mime:'',nodeID:0},
  liveViewer:{stillTickets:0,motionTickets:0},
  handoff:{state:initialHandoff.state,issues:0,consumes:0},
})
const locationPoint = { latitude:30.135, longitude:119.975 }
const initialScope: Scope = {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'}}
const pageFor = (bounds:Bounds, favorite:boolean) => {
  const width = bounds.east > bounds.west ? bounds.east-bounds.west : bounds.east+360-bounds.west
  const offset = locationPoint.longitude >= bounds.west ?
    locationPoint.longitude-bounds.west : locationPoint.longitude+360-bounds.west
  const x = Math.min(7,Math.max(0,Math.floor(offset/(width/8))))
  const y = Math.min(7,Math.max(0,Math.floor((locationPoint.latitude-bounds.south)/
    ((bounds.north-bounds.south)/8))))
  const count = favorite ? 3 : 9
  return {coordinate_space:'bd09ll' as const,index_scope:'owner_gps_auto_index' as const,
    grid_columns:8,grid_rows:8,total_count:count,
    cells:[{cell_x:x,cell_y:y,photo_count:count,asset_id:33,node_id:75,
      node_revision:2,latitude:locationPoint.latitude,longitude:locationPoint.longitude,
      ...(videoPosterMode?{media_kind:'video' as const}:{})}]}
}
const listOwnerCells=async(bounds:Bounds,signal:AbortSignal,filters:any,albumKey:string)=>{
  if(signal.aborted)throw Error('aborted')
  if((albumKey!==''&&(!combinedAlbumHandoff||albumKey!=='manual:Family'))||
    (combinedAlbumHandoff&&albumKey!=='manual:Family')||
    (filters?.favorite!==undefined&&filters.favorite!==true))
    throw Error('unexpected Owner scope')
  const favorite=filters?.favorite===true
  if(testCellsFailure && !genuineGin && favorite && failFavoriteCellsOnce){
    failFavoriteCellsOnce=false
    probe.failedOwnerCellsReads.push({favorite,albumKey})
    throw Error('synthetic_post_ready_owner_cells_network_failure')
  }
  let data
  if(genuineGin){
    // Only the opt-in combined-scope test serializes every reviewed filter
    // through the SAME production Owner /cells adapter used by Web/PWA.
    const query=combinedAlbumHandoff
      ? xDriveBaiduNativeCellsFilterParams(bounds,filters,albumKey)
      : geometry(bounds)
    if(!query)throw Error('invalid combined Gallery PhotoScope')
    if(!combinedAlbumHandoff){
      query.set('sort_by','captured')
      query.set('sort_dir','desc')
      if(favorite)query.set('favorite','true')
    }
    data=await ownerRequest('cells',query,signal)
  }else{
    // Same strictly shaped signed Owner /cells DTO with no derived pins
    // until the synthetic background job finishes. Never substitute WGS84.
    data=derivedLocationReady ? pageFor(bounds,favorite) : {
      coordinate_space:'bd09ll',index_scope:'owner_gps_auto_index',
      grid_columns:8,grid_rows:8,total_count:0,cells:[],
    }
  }
  probe.queries.push({favorite,albumKey,count:data.total_count,
    filters:JSON.parse(JSON.stringify(filters??{})),
    bounds:JSON.parse(JSON.stringify(bounds))})
  return data
}
/** Preview/Viewer use the same Owner Cell Range as the real Gallery Page.
 * Non-Gin previews contain synthetic metadata and entirely local thumbnails. */
const listOwnerCellItems=async(selection:any,limit:number,offset:number,
  sort:any,signal:AbortSignal)=>{
  if(signal.aborted)throw Error('cancelled')
  let range:any
  if(genuineGin){
    const params=geometry(selection.bounds)
    for(const [key,value] of Object.entries({
      cell_x:selection.cell_x,cell_y:selection.cell_y,
      asset_id:selection.asset_id,node_id:selection.node_id,
      node_revision:selection.node_revision,photo_count:selection.photo_count,
      limit,offset,range:true,sort_by:sort.by,sort_dir:sort.dir,
    }))params.set(key,String(value))
    if(sort.filters?.favorite===true)params.set('favorite','true')
    if(sort.albumKey)params.set('album',sort.albumKey)
    range=await ownerRequest('cell-items',params,signal)
  }else{
    const count=selection.photo_count
    range={offset,limit,total_count:count,items:Array.from(
      {length:Math.min(limit,Math.max(0,count-offset))},(_,i)=>{
        const id=selection.node_id+offset+i
        return {node:{id,revision:selection.node_revision,type:'file',
          name:'test-photo-'+id+'.png',size:512,
          created_at:'2026-01-01T00:00:00Z',
          updated_at:'2026-01-01T00:00:00Z'},
          metadata:{mime_type:'image/png',has_thumbnail:true}}
      })}
  }
  probe.photoPreviewRanges.push({limit,offset,total:range.total_count,
    items:range.items?.length||0,realGin:genuineGin})
  return range
}
const loadThumbnail=async(_id:number,signal?:AbortSignal,revision?:number)=>{
  if(realHEICMode||realLIVPMode){
    const token=await ownerToken()
    if(signal?.aborted)throw Error('HEIC Owner thumbnail cancelled')
    const response=await fetch('/api/v1/media/items/'+_id+
      '/thumbnail?revision='+String(revision??1),{
      signal,cache:'no-store',headers:{Authorization:'Bearer '+token},
    })
    const mime=response.headers.get('Content-Type')||''
    if(!response.ok||!mime.startsWith('image/jpeg'))
      throw Error('real authenticated HEIC-derived JPEG unavailable')
    const blob=await response.blob()
    if(blob.size<=512||blob.type!=='image/jpeg')
      throw Error('HEIC-derived JPEG transport did not return image bytes')
    const evidence=realLIVPMode?probe.livp:probe.heic
    evidence.reads++
    evidence.bytes=blob.size
    evidence.mime=blob.type
    evidence.nodeID=_id
    return URL.createObjectURL(blob)
  }
  if(signal?.aborted)throw Error('cancelled')
  if(videoPosterMode&&_id===75){
    if(!savedSyntheticPoster){probe.h264.misses++;return null}
    probe.h264.warm++
    return URL.createObjectURL(savedSyntheticPoster)
  }
  return 'data:image/svg+xml,'+encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">'+
    '<rect width="96" height="96" fill="#3b82f6"/>'+
    '<circle cx="48" cy="48" r="22" fill="#e0f2fe"/></svg>')
}
const mapVideoPreviewURL=async(nodeID:number,kind:'image'|'video'|'live_photo',
  signal?:AbortSignal):Promise<string|null>=>{
  if(!videoPosterMode || nodeID!==75 || kind!=='video' || signal?.aborted) return null
  probe.h264.previewURLs++
  // Genuine 12-frame AVC1 bitstream is served by the local HTTPS fixture.
  // This URL is returned by the test's trusted Owner port, never by SDK Child.
  return location.origin+'/__fixture/h264.mp4'
}
const saveMapVideoPoster=async(nodeID:number,revision:number,
  poster:Blob,signal?:AbortSignal):Promise<void>=>{
  if(!videoPosterMode || nodeID!==75 || revision!==2 || signal?.aborted ||
     poster.type!=='image/jpeg' || poster.size<=200)
    throw Error('invalid synthetic Owner video Poster')
  savedSyntheticPoster=poster
  probe.h264.puts++
  probe.h264.putBytes+=poster.size
}
const onOpenCell=(selection:any,scope:Scope)=>{
  probe.clicks.push({node:selection.node_id,asset:selection.asset_id,
    revision:selection.node_revision,count:selection.photo_count,
    favorite:scope.filters.favorite===true})
  const detail=document.getElementById('trusted-cell-open')
  if(detail)detail.textContent='Trusted Cell opened '+selection.photo_count
  if(genuineGin){
    const params=geometry(selection.bounds)
    for(const [key,value] of Object.entries({
      cell_x:selection.cell_x,cell_y:selection.cell_y,
      asset_id:selection.asset_id,node_id:selection.node_id,
      node_revision:selection.node_revision,photo_count:selection.photo_count,
      limit:48,offset:0,range:true,sort_by:'captured',sort_dir:'desc',
    }))params.set(key,String(value))
    if(scope.filters.favorite)params.set('favorite','true')
    void ownerRequest('cell-items',params).then(page=>{
      probe.viewerSourceItem=(page.items||[])[0]||null
      probe.ownerCellRange={
        total:page.total_count,items:page.items?.length||0,
        consistent:(page.items||[]).every((item:any)=>item.node?.id>0),
      }
    }).catch(()=>{probe.rangeError=true})
  }
}
const onOpenViewport=(bounds:Bounds,scope:Scope)=>{
  probe.viewports.push({bounds:{...bounds},favorite:scope.filters.favorite===true})
  if(genuineGin){
    const params=geometry(bounds)
    params.set('limit','48')
    params.set('offset','0')
    params.set('range','true')
    params.set('sort_by','captured')
    params.set('sort_dir','desc')
    if(scope.filters.favorite)params.set('favorite','true')
    void ownerRequest('viewport-items',params).then(page=>{
      probe.ownerViewportRange={
        total:page.total_count,items:page.items?.length||0,
        consistent:(page.items||[]).every((item:any)=>item.node?.id>0),
      }
    }).catch(()=>{probe.rangeError=true})
  }
}
const onReady=(ready:boolean)=>{probe.ready=ready}
const onCamera=(camera:any)=>{probe.cameras.push({...camera})}
const onInvalidated=()=>{probe.invalidations++}
const onFailure=()=>{probe.failed=true}
const getInlinePrototypeConfig=async()=>({provider:'baidu-jsapi-4.0' as const,browser_ak:'TEST_ONLY_BROWSER_AK',revision:1})
const getInlineSignedStatus=async()=>({provider:'baidu-jsapi-4.0' as const,enabled:true,
  activation_state:'authorized_signed_release',isolated_child_origin:childOrigin})
const mintChildTicket=async()=>({provider:'baidu-jsapi-4.0' as const,child_origin:childOrigin,
  ticket:'b'.repeat(64)})

const signedPreviewURL=async(nodeID:number,kind:'image'|'video'|'live_photo',
  signal?:AbortSignal):Promise<string|null>=>{
  if(!genuineGin||(kind!=='image'&&!(kind==='live_photo'&&realLIVPMode)))return null
  const token=await ownerToken()
  const response=await fetch(kind==='live_photo'
    ? '/api/v1/media/items/'+nodeID+'/live-photo-still-ticket'
    : '/api/v1/files/'+nodeID+'/preview-ticket',{
    method:'POST',signal,cache:'no-store',
    headers:{Authorization:'Bearer '+token}})
  if(!response.ok)throw Error('real Gin preview ticket denied')
  const receipt=await response.json()
  const prefix=kind==='live_photo'?'/api/v1/media-live-photo-still/':'/api/v1/file-preview/'
  if(typeof receipt.url!=='string'||!receipt.url.startsWith(prefix)||
      receipt.url.startsWith('//'))throw Error('untrusted preview URL')
  if(kind==='live_photo')probe.liveViewer.stillTickets++
  return receipt.url
}


const signedLiveMotion=async(nodeID:number,_progress?:unknown,signal?:AbortSignal)
  :Promise<string|null>=>{
  if(!genuineGin||!realLIVPMode||signal?.aborted)return null
  const token=await ownerToken()
  const response=await fetch('/api/v1/media/items/'+nodeID+
    '/live-photo-motion-ticket',{method:'POST',signal,cache:'no-store',
    headers:{Authorization:'Bearer '+token}})
  if(!response.ok)throw Error('Owner Live Photo motion ticket denied')
  const receipt=await response.json()
  if(typeof receipt.url!=='string'||
    !receipt.url.startsWith('/api/v1/media-live-photo-motion/')||
    receipt.url.startsWith('//'))throw Error('invalid Owner Live Photo motion URL')
  probe.liveViewer.motionTickets++
  return receipt.url
}

// Use the actual shipped Gallery page and sparse VirtualCollection, not a
// second Photo Wall. Every media-bearing range goes through the real Gin
// router and the same owner JWT; only ancillary place-card/albums indexes are
// empty in this isolated map-only database fixture.
const galleryQuery=(query:any={})=>{
  const params=new URLSearchParams()
  for(const key of ['anchor_node_id','sort_by','sort_dir','time_zone',
    'favorite','asset_kind','captured_from','captured_to','fold_duplicates',
    'initial_position','unknown_first']){
    const value=query?.[key]
    if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value))
  }
  return params
}
const ownerGalleryGet=async(path:string,signal?:AbortSignal)=>{
  const token=await ownerToken()
  const response=await fetch(path,{signal,cache:'no-store',
    headers:{Authorization:'Bearer '+token}})
  if(!response.ok)throw Error('genuine Gin Gallery HTTP '+response.status)
  return response.json()
}
const listOwnerGalleryRange=async(limit:number,offset:number,query:any={},signal?:AbortSignal)=>{
  const params=galleryQuery(query)
  params.set('range','true');params.set('limit',String(limit))
  params.set('offset',String(offset))
  const page=await ownerGalleryGet('/api/v1/media/items?'+params,signal)
  probe.galleryPageReads.push({kind:'ordinary',offset,limit,total:page.total_count,
    favorite:query?.favorite===true})
  return page
}
const galleryDataSource={
  listItems:async(limit:number,offset:number,query:any={})=>
    (await listOwnerGalleryRange(limit,offset,query)).items,
  listItemRange:listOwnerGalleryRange,
  listAlbums:async()=>[],
  listPlaces:async()=>[],
  listBaiduNativeCells:listOwnerCells,
  listBaiduNativeCellItems:async(selection:any,limit:number,offset:number,
    sort:any,signal:AbortSignal)=>{
    const params=xDriveBaiduNativeCellRangeParams(selection,limit,offset,sort)
    if(!params)throw Error('invalid trusted Cell Range parameters')
    const page=await ownerRequest('cell-items',params,signal)
    // Store only test-local Owner member IDs to compare a fresh Gin Range
    // after returning to the map. Do not expose IDs to the untrusted SDK.
    probe.galleryPageReads.push({kind:'cell',offset,limit,total:page.total_count,
      nodeIDs:(page.items||[]).map((item:any)=>item.node?.id)})
    return page
  },
  listBaiduNativeViewportItems:async(bounds:Bounds,limit:number,offset:number,
    query:any,signal:AbortSignal,albumKey?:string)=>{
    // Use the production Web adapter's exact signed BD09 Range serializer.
    // A generic Gallery query adds fold_duplicates=false, which this Server
    // endpoint intentionally rejects even though the Gallery wall uses it.
    const params=xDriveBaiduNativeViewportRangeParams(
      bounds,limit,offset,query,albumKey ?? '')
    if(!params)throw Error('invalid trusted Camera Range parameters')
    const page=await ownerRequest('viewport-items',params,signal)
    probe.galleryPageReads.push({kind:'viewport',offset,limit,total:page.total_count})
    return page
  },
  getBaiduJSAPI4Status:getInlineSignedStatus,
  getBaiduJSAPIPrototype:getInlinePrototypeConfig,
  mintBaiduIsolatedChildTicket:mintChildTicket,
  loadThumbnail:realLIVPMode?loadThumbnail:async()=>null,
  loadPreviewURL:signedPreviewURL,
}
function FullGalleryPage(){
  const [directViewer,setDirectViewer]=useState<{item:any;context:any}|null>(null)
  if(fullGalleryDirectPhoto && directViewer){
    // Use the shipped shared Viewer; the map and untrusted Child unmount.
    return <XDriveMediaGalleryViewer
      item={directViewer.item}
      positionLabel={String(directViewer.context.activeIndex+1)+' / '+
        String(directViewer.context.totalCount)}
      canPrevious={false} canNext={false}
      filmstripEntries={[]} activeIndex={directViewer.context.activeIndex}
      loadThumbnail={realLIVPMode?loadThumbnail:async()=>null}
      loadPreviewURL={signedPreviewURL}
      loadLivePhotoMotion={realLIVPMode?signedLiveMotion:undefined}
      onPrevious={()=>{}} onNext={()=>{}} onFilmstripSelect={()=>{}}
      onClose={()=>{probe.galleryPageDirectClosed++;setDirectViewer(null)}}/>
  }
  return <XDriveMediaGalleryPage source={galleryDataSource as any}
    preferenceScope="p04-authenticated-full-gallery"
    initialSection={favoritesMapEntry ? 'favorites' : 'places'} pageSize={48}
    initialMapPhotoScope={{albumKey:'',filters:{
      sort_by:'captured',sort_dir:'desc',...(realLIVPMode?{}:{favorite:true})}}}
    onOpenViewer={fullGalleryDirectPhoto ? (item,context)=>{
      // Production Page checks fresh Owner Cell Range before this callback.
      probe.galleryPageDirectOpens.push({
        nodeID:item.node.id,revision:item.node.revision,
        kind:context.target.kind,index:context.activeIndex,
        total:context.totalCount,
        live:Boolean(item.live_photo||item.asset_kind==='live_photo'),
      })
      setDirectViewer({item,context})
    } : undefined}
    onError={(error)=>{probe.galleryPageErrors.push(
      error instanceof Error?error.name:'GalleryError')}}/>
}
function TestApp(){
  const [favorite,setFavorite]=useState(false)
  const [viewerItem,setViewerItem]=useState<any|null>(null)
  const [drawerViewer,setDrawerViewer]=useState<number|null>(null)
  const scope:Scope={albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',
    ...(favorite?{favorite:true}:{})}}
  const openDrawerPhoto=async(selection:any,approved:Scope,nodeID:number,
    revision:number,presentation:any)=>{
    try{
      // Test fixture's second Owner authorization; production Gallery also
      // performs its own revalidation before opening the real Viewer.
      const range=await listOwnerCellItems(selection,48,0,{
        by:approved.filters.sort_by,dir:approved.filters.sort_dir,
        filters:approved.filters,albumKey:approved.albumKey,
      },new AbortController().signal)
      const valid=range.total_count===selection.photo_count &&
        range.items.some((item:any)=>item.node?.id===nodeID &&
          item.node?.revision===revision)
      if(valid)xDriveRememberPlacesDrawerViewerReturn(
        'synthetic-private-owner',selection,approved,Date.now(),presentation)
      probe.photoOpens.push({valid,expanded:presentation.expanded,
        scrollTop:presentation.scrollTop,scrollLeft:presentation.scrollLeft})
      if(valid)setDrawerViewer(nodeID)
    }catch{probe.rangeError=true}
  }
  return <div>
    {delayedBD09 ? (
      <button type="button" id="fixture-finish-bd09"
        onClick={()=>{derivedLocationReady=true;probe.bd09Completions++}}>
        Complete synthetic Owner BD-09 indexing
      </button>
    ) : null}
    {testCellsFailure ? (
      <button type="button" id="fixture-arm-cells-failure"
        onClick={()=>{failFavoriteCellsOnce=true}}>
        Fail next signed Owner Favorites Cells request
      </button>
    ) : null}
    <button type="button" id="toggle-favorite" onClick={()=>setFavorite(x=>!x)}>
      Switch Owner favorite scope
    </button>
    <div id="private-parent">PRIVATE_PARENT_DOM_SENTINEL</div>
    {drawerViewer!==null ? <section id="fixture-viewer" aria-label="Fixture photo viewer">
      <button type="button" id="fixture-viewer-back" onClick={()=>setDrawerViewer(null)}>
        Return to Map
      </button>
    </section> : <XDriveMediaGalleryBaiduIsolatedPhotoSurface
      mode={mode} childOrigin={childOrigin} mapPhotoScope={scope}
      scope="synthetic-private-owner" getInlinePrototypeConfig={getInlinePrototypeConfig}
      getInlineSignedStatus={getInlineSignedStatus}
      mintChildTicket={mintChildTicket} listOwnerCells={listOwnerCells}
      listOwnerCellItems={listOwnerCellItems} loadThumbnail={loadThumbnail}
      loadPreviewURL={videoPosterMode?mapVideoPreviewURL:undefined}
      saveVideoPoster={videoPosterMode?saveMapVideoPoster:undefined}
      onOpenCell={onOpenCell} onOpenCellPhoto={openDrawerPhoto}
      initialCamera={probe.cameras.at(-1)}
      onOpenViewport={onOpenViewport}
      onCamera={onCamera} onInvalidated={onInvalidated}
      onReady={onReady} onFailure={onFailure}/>}
    <output id="trusted-cell-open"/>
    {genuineGin ? (
      <>
        <button id="open-real-viewer" type="button"
          disabled={Boolean(viewerItem)}
          onClick={()=>{
            if(!probe.viewerSourceItem)return
            probe.viewerOpened++
            setViewerItem(probe.viewerSourceItem)
          }}>Open verified Cell original in shared Viewer</button>
        <XDriveMediaGalleryViewer
          item={viewerItem} positionLabel="1 / 3"
          canPrevious={false} canNext={false}
          filmstripEntries={[]} activeIndex={0}
          loadThumbnail={async()=>null} loadPreviewURL={signedPreviewURL}
          onPrevious={()=>{}} onNext={()=>{}} onFilmstripSelect={()=>{}}
          onClose={()=>{setViewerItem(null);probe.viewerClosed++}}/>
      </>
    ) : null}
  </div>
}

type FullDocumentMapState =
  | {phase:'pending'|'denied'}
  | {phase:'ready';scope:XDriveBaiduMapPhotoScope;camera?:XDriveBaiduNativeCameraSnapshot}
const freshFavoritesScope:XDriveBaiduMapPhotoScope={
  albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',favorite:true},
}
const combinedFamilyScope:XDriveBaiduMapPhotoScope={
  albumKey:'manual:Family',filters:{
    sort_by:'added',sort_dir:'asc',favorite:true,asset_kind:'image',
    captured_from:'2026-10-19',captured_to:'2026-10-22',
    time_zone:'Asia/Tokyo',
  },
}
const handoffAPI='/api/v1/media/places/baidu-jsapi/scope-handoff'
const postAuthenticatedMapHandoff=async (
  suffix:string,payload:unknown,signal?:AbortSignal,
):Promise<any>=>{
  const token=await ownerToken()
  if(signal?.aborted)throw Error('cancelled')
  const response=await fetch(handoffAPI+suffix,{
    method:'POST',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify(payload),
  })
  if(!response.ok)throw Error('actual Gin Owner map handoff denied')
  return response.json()
}

/** Entire-document map mode transition using the ORIGINAL trusted Gallery
 * Parent and Web startup scrubber, backed by actual Gin/PostgreSQL one-use
 * handoff. A pending, revoked or reused nonce never mounts either SDK host. */
function FullDocumentHandoffMap(){
  const [closed,setClosed]=useState(false)
  const [snapshot,setSnapshot]=useState<FullDocumentMapState>(()=>
    initialHandoff.state==='none'
      ? {phase:'ready',scope:combinedAlbumHandoff?combinedFamilyScope:freshFavoritesScope}
      : {phase:initialHandoff.state==='pending'?'pending':'denied'})
  const claimed=useRef(false)
  useEffect(()=>{
    if(initialHandoff.state!=='pending'||claimed.current)return
    claimed.current=true
    let mounted=true
    void postAuthenticatedMapHandoff('/consume',{
      target_mode:initialHandoff.target,ticket:initialHandoff.ticket,
    }).then(receipt=>{
      if(!mounted)return
      const scope=xDriveNormalizeBaiduMapPhotoScope(receipt?.scope)
      const camera=receipt?.camera==null ? undefined :
        xDriveValidBaiduNativeCameraSnapshot(receipt.camera)
          ? receipt.camera as XDriveBaiduNativeCameraSnapshot : null
      if(!scope||camera===null||receipt?.target_mode!==initialHandoff.target)
        throw Error('invalid Owner handoff receipt')
      probe.handoff.consumes++
      probe.handoff.state='ready'
      setSnapshot({phase:'ready',scope,camera})
    }).catch(()=>{
      if(!mounted)return
      probe.handoff.state='denied'
      setSnapshot({phase:'denied'})
    })
    return()=>{mounted=false}
  },[])
  if(closed) return <main data-xdrive-ios-map-closed="1">Returned to Owner Gallery</main>
  if(snapshot.phase!=='ready')
    return <main data-xdrive-map-handoff-denied={snapshot.phase==='denied'?'1':undefined}
      data-xdrive-map-handoff-pending={snapshot.phase==='pending'?'1':undefined}>
      {snapshot.phase==='denied'?'Owner map scope expired or already consumed':
        'Validating authenticated map handoff'}
    </main>
  return <XDriveMediaGalleryPlacesMap
    compact={compactMapAppearance}
    onCloseMap={compactMapAppearance ? ()=>setClosed(true) : undefined}
    places={[]} totalCount={null}
    diagnosticScope="p04-authenticated-full-document"
    listBaiduNativeCells={listOwnerCells}
    listBaiduNativeCellItems={listOwnerCellItems}
    getBaiduJSAPI4Status={getInlineSignedStatus}
    getBaiduJSAPIPrototype={getInlinePrototypeConfig}
    mintBaiduIsolatedChildTicket={mintChildTicket}
    loadPhotoCoverThumbnail={loadThumbnail}
    onOpenBaiduNativeCell={onOpenCell}
    onBaiduNativeCellInvalidated={onInvalidated}
    initialNativeCamera={snapshot.camera}
    mapPhotoScope={snapshot.scope}
    onMapPhotoScopeChange={scope=>setSnapshot(previous=>
      previous.phase==='ready'?{...previous,scope}:previous)}
    onMapModeHandoff={async(scope,target,signal,camera)=>{
      probe.handoff.issues++
      const receipt=await postAuthenticatedMapHandoff('',{
        target_mode:target,scope,...(camera?{camera}:{}),
      },signal)
      if(typeof receipt?.ticket!=='string'||
        !/^[a-f0-9]{64}$/.test(receipt.ticket))
        throw Error('invalid one-use Owner handoff ticket')
      return receipt.ticket as string
    }}
    onNativeCameraChange={onCamera} onNativeCameraClear={()=>{}}/>
}
createRoot(document.getElementById('root')!).render(
  fullDocumentHandoff ? (
    compactMapAppearance ?
      <ThemeProvider theme={darkMapAppearance ? darkMapTheme : lightMapTheme}>
        <FullDocumentHandoffMap/>
      </ThemeProvider> : <FullDocumentHandoffMap/>
  ) :
  fullGalleryPage ? <FullGalleryPage /> :
    darkMapAppearance ? <ThemeProvider theme={darkMapTheme}><TestApp /></ThemeProvider> :
    <TestApp />)
