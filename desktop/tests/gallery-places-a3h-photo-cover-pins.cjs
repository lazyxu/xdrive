'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p), 'utf8')
function loadTs(p, modules = {}) {
  const source=read(p)
  const compiled=ts.transpileModule(source,{fileName:p,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
      jsx:ts.JsxEmit.ReactJSX}})
  assert.deepEqual((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error)
    .map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\n')),[])
  const m={exports:{}}
  new Function('module','exports','require',compiled.outputText)(m,m.exports,id=>{
    if (Object.prototype.hasOwnProperty.call(modules,id)) return modules[id]
    throw Error('unexpected A3h runtime module '+id)
  })
  return m.exports
}
const cells=loadTs('ui/shared/src/media-gallery-baidu-jsapi4-cells.ts')
const cover=loadTs('ui/shared/src/media-gallery-baidu-jsapi4-cover-pins.ts')
const bridgeCode=loadTs('ui/shared/src/media-gallery-baidu-jsapi4-bd09-photo.ts',{
  './media-gallery-baidu-jsapi4-cells':cells,
})
const bounds={coordinate_space:'bd09ll',west:116,south:39,east:117,north:41}
const sample={cell_x:1,cell_y:1,photo_count:99999,
  asset_id:9,node_id:19,node_revision:7,latitude:39.4,longitude:116.2}
const page=list=>({coordinate_space:'bd09ll',index_scope:'explicit_opt_in_only',
  grid_columns:8,grid_rows:8,total_count:list.reduce((n,p)=>n+p.photo_count,0),cells:list})
class Point {constructor(lng,lat){this.lng=lng;this.lat=lat}}
const projection={
  pointToPixel(p){return{x:(p.lng-116)*640,y:(41-p.lat)*240}}
}
function fixture(){
  const numbers=[],layers=[],opened=[],zoomed=[],events=new Map()
  let zoom=12
  class Label{
    constructor(text){this.text=text;this.handlers=new Map()}
    setStyle() {}
    addEventListener(name,cb){this.handlers.set(name,cb)}
    removeEventListener(name){this.handlers.delete(name)}
  }
  class Cluster{
    setData(data){this.data=data}
    clearData(){this.data=undefined}
    addEventListener(){}
    removeEventListener(){}
  }
  const map={
    ...projection,
    addOverlay(l){numbers.push(l)},removeOverlay(l){const i=numbers.indexOf(l);if(i>=0)numbers.splice(i,1)},
    addLayer(l){layers.push(l)},removeLayer(l){const i=layers.indexOf(l);if(i>=0)layers.splice(i,1)},
    centerAndZoom(p,z){zoomed.push({point:p,zoom:z});zoom=z},
    getZoom(){return zoom},
    getBounds(){return{getSouthWest:()=>new Point(116,39),getNorthEast:()=>new Point(117,41)}},
    addEventListener(name,cb){const set=events.get(name)||new Set();set.add(cb);events.set(name,set)},
    removeEventListener(name,cb){events.get(name)?.delete(cb)},
  }
  return{map,numbers,layers,opened,zoomed,events,namespace:{Point,Label},
    runtime:{map,createClusterLayer:()=>new Cluster()}}
}
test('A3h only projects original Server-approved BD09 point; fixed CSS bounds and finite pixels',()=>{
  const valid=page([sample])
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(valid,bounds),true)
  const pins=cover.xDriveProjectBaiduPhotoCoverPins(valid,projection,{Point},640,480)
  assert.equal(pins.length,1)
  assert.equal(pins[0].cell.node_id,19)
  assert.equal(pins[0].cell.photo_count,99999)
  assert.ok(Math.abs(pins[0].x-128)<1e-8)
  assert.ok(pins[0].y>300)
  for(const bad of [
    page([{...sample,node_revision:0}]),
    page([{...sample,node_revision:Number.MAX_SAFE_INTEGER+1}]),
    page([{...sample,latitude:Infinity}]),
    {...valid,coordinate_space:'wgs84'},
  ]) assert.equal(cover.xDriveProjectBaiduPhotoCoverPins(bad,projection,{Point},640,480),null)
  assert.equal(cover.xDriveProjectBaiduPhotoCoverPins(valid,{}, {Point},640,480),null)
  assert.equal(cover.xDriveProjectBaiduPhotoCoverPins(valid,{pointToPixel(){return {x:NaN,y:7}}},{Point},640,480),null)
  assert.equal(cover.xDriveProjectBaiduPhotoCoverPins(valid,projection,{Point},0,480),null)
  assert.deepEqual(cover.xDriveProjectBaiduPhotoCoverPins(page([]),projection,{Point},640,480),[])
})

test('A3h 100k Owner cells remain bounded to 24 nonoverlapping true-cover pixels',()=>{
  const many=Array.from({length:64},(_,i)=>({
    ...sample,cell_x:i%8,cell_y:Math.floor(i/8),
    asset_id:100+i,node_id:200+i,node_revision:10+i,photo_count:i===0?99937:1,
    longitude:116+(i%8+0.5)/8,
    latitude:39+(Math.floor(i/8)+0.5)/4,
  }))
  const source=page(many)
  assert.equal(source.total_count,100000)
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(source,bounds),true)
  const pins=cover.xDriveProjectBaiduPhotoCoverPins(source,projection,{Point},640,480)
  assert.ok(pins.length>3)
  assert.ok(pins.length<=cover.XDRIVE_BAIDU_PHOTO_COVER_MAX)
  assert.equal(pins[0].cell.photo_count,99937)
  for(let i=0;i<pins.length;i++) for(let j=i+1;j<pins.length;j++)
    assert.ok(Math.hypot(pins[i].x-pins[j].x,pins[i].y-pins[j].y)>=
      cover.XDRIVE_BAIDU_PHOTO_COVER_MIN_SEPARATION)
})

test('A3h true photo-cover mode uses /cells even below 100, never passes private img URL into BMap labels',async()=>{
  const f=fixture(),seen=[]
  let rawCalls=0,cellCalls=0
  const bridge=new bridgeCode.XDriveBaiduJSAPI4IndexedViewportBridge(
    f.runtime,async()=>{rawCalls++;throw Error('must not fetch 100 photos')},
    {onOpenPhoto:id=>seen.push(id),onViewportInvalidated(){},
      onCells:p=>{if(p)assert.equal(p.total_count,1)}},
    async (_bounds,signal)=>{cellCalls++;assert.equal(signal.aborted,false);
      return page([{...sample,photo_count:1}])},f.namespace,true)
  const r=await bridge.refresh()
  assert.deepEqual(r,{kind:'aggregated',totalPhotos:1,cells:1})
  assert.equal(rawCalls,0)
  assert.equal(cellCalls,1)
  assert.equal(f.numbers.length,0)
  bridge.focusCell({...sample,photo_count:1})
  assert.deepEqual(seen,[{assetID:9,nodeID:19}])
  bridge.cancel()
  bridge.focusCell({...sample,photo_count:1})
  assert.equal(seen.length,1,'old committed photo click must be invalidated')
  bridge.dispose()
  assert.equal(f.layers.length,0)
})

test('A3h old Agent lacking paired node_revision keeps existing 100k numeric map',async()=>{
  const f=fixture()
  const b=new bridgeCode.XDriveBaiduJSAPI4IndexedViewportBridge(
    f.runtime,async()=>{throw Error('no /viewport needed')},
    {onOpenPhoto(){},onViewportInvalidated(){}},
    async()=>page([{cell_x:1,cell_y:1,photo_count:100000,
      asset_id:9,node_id:19,latitude:39.4,longitude:116.2}]),
    f.namespace,true)
  const result=await b.refresh()
  assert.equal(result.kind,'aggregated')
  assert.equal(f.numbers.length,1)
  assert.equal(f.numbers[0].text,'100,000')
  b.dispose()
})

test('A3h stale/cancelled Owner replies cannot publish markers or thumbnail identities',async()=>{
  const f=fixture(),seen=[]
  let resolveLate, request
  const b=new bridgeCode.XDriveBaiduJSAPI4IndexedViewportBridge(
    f.runtime,async()=>{throw Error('no viewport')},
    {onOpenPhoto(){},onViewportInvalidated(){},onCells:page=>{if(page)seen.push(page)}},
    (_bounds,signal)=>{request=signal;return new Promise(resolve=>{resolveLate=resolve})},
    f.namespace,true)
  const pending=b.refresh()
  assert.equal(request.aborted,false)
  for(const fn of f.events.get('movestart'))fn()
  assert.equal(request.aborted,true)
  resolveLate(page([sample]))
  assert.equal((await pending).kind,'cancelled')
  assert.equal(seen.length,0)
  assert.equal(f.numbers.length,0)
  b.dispose()
})

test('A3h shared Web/Mobile/Desktop secure HTTPS map uses Gallery pool + Owner Range, no AK/URL sent to provider',()=>{
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const places=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const isolated=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const adapter=read('ui/shared/src/mui/MediaGalleryCoverThumbnail.tsx')
  const data=read('internal/api/baidu_photo_map_cells.go')
  const http=read('internal/api/baidu_jsapi4_native_cells_http.go')
  const docs=read('docs/gallery-places-ios27-roadmap.md')
  assert.match(gallery,/loadPhotoCoverThumbnail=\{loadThumbnail\}/)
  assert.match(places,/XDriveMediaGalleryBaiduIsolatedPhotoSurface/)
  assert.doesNotMatch(places,/loadThumbnail=\{loadPhotoCoverThumbnail\}/)
  assert.match(isolated,/xDriveSelectBaiduNativeCell\(page,bounds,cell\)/)
  assert.match(isolated,/frame\.replaceAuthorizedCells\(cells\)/)
  assert.doesNotMatch(isolated,/loadThumbnail|loadPhotoCoverThumbnail|XDriveMediaGalleryCoverThumbnail/)
  // The previous trusted in-document thumbnail/pin component remains inert.
  // Gallery/Viewer retain the normal authorized thumbnail transport.
  assert.match(surface,/XDriveMediaGalleryCoverThumbnail/)
  assert.match(surface,/data-xdrive-baidu-photo-cover-pins/)
  assert.match(surface,/onClick=\{\(\) => openTrustedCell\(cell\)\}/)
  assert.match(surface,/latestBridge\.current\?\.focusCell\(clicked\)/)
  assert.match(surface,/xDriveSelectBaiduNativeCell\(frame\.page, frame\.bounds, clicked\)/)
  assert.match(surface,/pointToPixel/)
  assert.match(surface,/setCoverPins\(\[\]\)/)
  assert.match(adapter,/new XDriveMediaGalleryCoverThumbnailPool\(loadThumbnail\)/)
  assert.match(data,/p\.node_revision AS node_revision/)
  assert.match(http,/currentBaiduJSAPI4OperatorRelease/)
  assert.match(docs,/P0-Places-A3h/)
  assert.doesNotMatch(surface,/fetch\(|api\.map\.baidu\.com|BaiduBrowserAK|new BMap\./)
})
