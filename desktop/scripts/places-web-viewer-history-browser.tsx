import { useXDriveWebAppRuntime, xDriveCreateWebAppBrowseSession } from '../../web/src/webAppRuntime'
import { useViewerNode } from '../../web/src/useWebViewerNode'
import { xDriveWebViewerMediaFile } from '../../web/src/webViewerContext'
import { createRoot } from 'react-dom/client'
import type { MediaGalleryDataSource } from '@xdrive/ui/mui'
import type { XDriveApi } from '../../web/src/api'
import type { MediaItem, Node, XDriveWebAppBrowseContext } from '../../ui/shared/src'

// This is an actual Web route + Viewer Hook in a Chromium document, not a
// copy of their logic. Only the backend is a small, explicitly bounded mock.
const clock = '2026-01-01T00:00:00Z'
const node = (id: number): Node => ({
  id, name:'owner-photo-'+id+'.png', type:'file', revision:2, size:256,
  created_at:clock, updated_at:clock,
}) as Node
const item = (id: number): MediaItem => ({
  node:node(id), metadata:{mime_type:'image/png',media_kind:'image'}, favorite:false,
}) as MediaItem
const cell = {
  bounds:{coordinate_space:'bd09ll' as const,west:116,south:39,east:117,north:40},
  cell_x:1,cell_y:2,asset_id:5,node_id:101,node_revision:2,photo_count:2,
}
const snapshot = (kind: 'baidu-cell'|'baidu-viewport'): XDriveWebAppBrowseContext => ({
  kind:'gallery',
  target:kind==='baidu-cell'
    ? {kind,baiduCell:cell,query:{sort_by:'captured',sort_dir:'desc'}}
    : {kind,baiduViewport:cell.bounds,query:{sort_by:'captured',sort_dir:'desc'}},
  activeIndex:0,totalCount:2,
})
const probe = {
  rangeStarts:0,rangeFinishes:0,rangeDenials:0,aborts:0,
  pointReads:0,otherGalleryReads:0,requests:[] as string[],
}
;(window as unknown as {__scopeHistoryProbe:typeof probe}).__scopeHistoryProbe = probe
const requestRange = async (kind:string,signal:AbortSignal) => {
  probe.rangeStarts++
  probe.requests.push(kind)
  signal.addEventListener('abort',()=>{probe.aborts++},{once:true})
  const response=await fetch('/fixture/owner-range?kind='+encodeURIComponent(kind),
    {cache:'no-store',signal})
  if(!response.ok){probe.rangeDenials++;throw Error('OWNER_SCOPE_REVOKED')}
  const page=await response.json()
  probe.rangeFinishes++
  return page as {total_count:number;items:MediaItem[]}
}
const api = {
  node:async (id:number)=>{probe.pointReads++;return node(id)},
  mediaItem:async (id:number)=>{probe.pointReads++;return item(id)},
} as unknown as XDriveApi
const gallerySource = {
  listBaiduNativeCellItems:(_selection:unknown,_limit:number,_offset:number,
    _sort:unknown,signal:AbortSignal)=>requestRange('cell',signal),
  listBaiduNativeViewportItems:(_bounds:unknown,_limit:number,_offset:number,
    _query:unknown,signal:AbortSignal)=>requestRange('viewport',signal),
  listItemRange:async ()=>{
    probe.otherGalleryReads++
    throw Error('unscoped Gallery MUST NOT be read')
  },
} as unknown as MediaGalleryDataSource

function Viewer({nodeID,contextID,onClose,onNavigate,onSwitchViewport}: {
  nodeID:number;contextID?:string;onClose:()=>void;onNavigate:(id:number)=>void
  onSwitchViewport:()=>void
}) {
  const viewer=useViewerNode({api,gallerySource,nodeID,contextID,
    predicate:xDriveWebViewerMediaFile,wantsMedia:true,onNavigate})
  return <main data-testid="viewer">
    <button type="button" onClick={onClose}>返回地图</button>
    <button type="button" onClick={()=>viewer.goNext()}
      disabled={!viewer.next}>查看同 Cell 下一张照片</button>
    <button type="button" onClick={()=>onNavigate(103)}>尝试打开非成员照片</button>
    <button type="button" onClick={onSwitchViewport}>切换 Viewport 作用域</button>
    <output data-testid="viewer-status">
      {viewer.loading?'loading':viewer.error?'error':viewer.node?'authorized':'empty'}
    </output>
    <p data-testid="viewer-error">{viewer.error}</p>
    {viewer.node ? <p data-testid="authorized-photo">
      {'Owner photo '+viewer.node.id}
    </p> : null}
  </main>
}
function App(){
  const runtime=useXDriveWebAppRuntime()
  const route=runtime.route
  const openScope=(kind: 'baidu-cell'|'baidu-viewport')=>{
    const context=xDriveCreateWebAppBrowseSession(snapshot(kind))
    runtime.launch({app:'media-viewer',params:{node:101,context}},
      {viewerReturn:true})
  }
  if(route.app==='media-viewer')return <Viewer
    nodeID={route.params.node} contextID={route.params.context}
    onClose={()=>runtime.closeViewer({app:'gallery',params:{section:'places'}})}
    onNavigate={id=>runtime.launch({app:'media-viewer',params:{node:id,
      context:route.params.context}},{replace:true})}
    onSwitchViewport={()=>{
      const context=xDriveCreateWebAppBrowseSession(snapshot('baidu-viewport'))
      runtime.launch({app:'media-viewer',params:{node:101,context}},
        {replace:true})
    }}/>
  return <main data-testid="gallery">
    <button onClick={()=>openScope('baidu-cell')}>打开 Cell 地图照片</button>
    <button onClick={()=>openScope('baidu-viewport')}>打开 Viewport 地图照片</button>
    <button onClick={()=>runtime.launch({app:'media-viewer',params:{node:101}},
      {viewerReturn:true})}>普通直接打开照片</button>
  </main>
}
createRoot(document.getElementById('root')!).render(<App/>)
