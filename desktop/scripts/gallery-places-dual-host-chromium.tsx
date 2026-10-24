import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveMediaGalleryBaiduIsolatedPhotoSurface } from '@fixture/surface'

type Bounds = {coordinate_space:'bd09ll';west:number;east:number;south:number;north:number}
type Scope = {albumKey:string;filters:{sort_by:'captured';sort_dir:'desc';favorite?:boolean}}
const mode = new URLSearchParams(location.search).get('mode') === 'isolated' ? 'isolated' : 'inline'
const childOrigin = 'https://map-isolated.example.org:' + location.port
const genuineGin = (window as any).__P04_REAL_GIN === true
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
function TestApp(){
  const [favorite,setFavorite]=useState(false)
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
  </div>
}
createRoot(document.getElementById('root')!).render(<TestApp />)
