import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveMediaGalleryBaiduIsolatedPhotoSurface } from '@fixture/surface'
import { XDriveMediaGalleryViewer } from '@fixture/viewer'
import { XDriveMediaGalleryPage } from '@fixture/gallery-page'
import { xDriveBaiduNativeCellRangeParams } from '../../ui/shared/src/media-gallery-baidu-jsapi4-cell-range'

type Bounds = {coordinate_space:'bd09ll';west:number;east:number;south:number;north:number}
type Scope = {albumKey:string;filters:{sort_by:'captured';sort_dir:'desc';favorite?:boolean}}
const mode = new URLSearchParams(location.search).get('mode') === 'isolated' ? 'isolated' : 'inline'
const childOrigin = 'https://map-isolated.example.org:' + location.port
const genuineGin = (window as any).__P04_REAL_GIN === true
const fullGalleryPage = new URLSearchParams(location.search).get('full_gallery') === '1'
let ownerAccess: Promise<string> | undefined
const ownerToken = () => ownerAccess ??= fetch('/__fixture/map-owner',
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
  return {coordinate_space:'bd09ll' as const,index_scope:'explicit_opt_in_only' as const,
    grid_columns:8,grid_rows:8,total_count:count,
    cells:[{cell_x:x,cell_y:y,photo_count:count,asset_id:33,node_id:75,
      node_revision:2,latitude:locationPoint.latitude,longitude:locationPoint.longitude}]}
}
const listOwnerCells=async(bounds:Bounds,signal:AbortSignal,filters:any,albumKey:string)=>{
  if(signal.aborted)throw Error('aborted')
  if(albumKey!=='' || (filters?.favorite!==undefined && filters.favorite!==true))
    throw Error('unexpected Owner scope')
  const favorite=filters?.favorite===true
  let data
  if(genuineGin){
    const query=geometry(bounds)
    query.set('sort_by','captured')
    query.set('sort_dir','desc')
    if(favorite)query.set('favorite','true')
    data=await ownerRequest('cells',query,signal)
  }else{
    data=pageFor(bounds,favorite)
  }
  probe.queries.push({favorite,albumKey,count:data.total_count,
    bounds:JSON.parse(JSON.stringify(bounds))})
  return data
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
  if(!genuineGin||kind!=='image')return null
  const token=await ownerToken()
  const response=await fetch('/api/v1/files/'+nodeID+'/preview-ticket',{
    method:'POST',signal,cache:'no-store',
    headers:{Authorization:'Bearer '+token}})
  if(!response.ok)throw Error('real Gin preview ticket denied')
  const receipt=await response.json()
  if(typeof receipt.url!=='string'||
      !receipt.url.startsWith('/api/v1/file-preview/')||
      receipt.url.startsWith('//'))throw Error('untrusted preview URL')
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
  probe.galleryPageReads.push({kind:'ordinary',offset,limit,total:page.total_count})
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
    const params=geometry(bounds)
    params.set('range','true');params.set('offset',String(offset))
    params.set('limit',String(limit))
    for(const [key,value] of galleryQuery(query))params.set(key,value)
    if(albumKey)params.set('album',albumKey)
    const page=await ownerRequest('viewport-items',params,signal)
    probe.galleryPageReads.push({kind:'viewport',offset,limit,total:page.total_count})
    return page
  },
  getBaiduJSAPI4Status:getInlineSignedStatus,
  getBaiduJSAPIPrototype:getInlinePrototypeConfig,
  mintBaiduIsolatedChildTicket:mintChildTicket,
  loadThumbnail:async()=>null,
  loadPreviewURL:signedPreviewURL,
}
function FullGalleryPage(){
  return <XDriveMediaGalleryPage source={galleryDataSource as any}
    preferenceScope="p04-authenticated-full-gallery"
    initialSection="places" pageSize={48}
    initialMapPhotoScope={{albumKey:'',filters:{
      sort_by:'captured',sort_dir:'desc',favorite:true}}}
    onError={(error)=>{probe.galleryPageErrors.push(
      error instanceof Error?error.name:'GalleryError')}}/>
}
function TestApp(){
  const [favorite,setFavorite]=useState(false)
  const [viewerItem,setViewerItem]=useState<any|null>(null)
  const scope:Scope={albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',
    ...(favorite?{favorite:true}:{})}}
  return <div>
    <button type="button" id="toggle-favorite" onClick={()=>setFavorite(x=>!x)}>
      Switch Owner favorite scope
    </button>
    <div id="private-parent">PRIVATE_PARENT_DOM_SENTINEL</div>
    <XDriveMediaGalleryBaiduIsolatedPhotoSurface
      mode={mode} childOrigin={childOrigin} mapPhotoScope={scope}
      scope="synthetic-private-owner" getInlinePrototypeConfig={getInlinePrototypeConfig}
      getInlineSignedStatus={getInlineSignedStatus}
      mintChildTicket={mintChildTicket} listOwnerCells={listOwnerCells}
      onOpenCell={onOpenCell} onOpenViewport={onOpenViewport}
      onCamera={onCamera} onInvalidated={onInvalidated}
      onReady={onReady} onFailure={onFailure}/>
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
createRoot(document.getElementById('root')!).render(fullGalleryPage ? <FullGalleryPage /> : <TestApp />)
