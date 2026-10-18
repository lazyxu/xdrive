'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function transpile(file, modules = {}) {
  const source = ts.transpileModule(read(file), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  const m={exports:{}}
  new Function('module','exports','require',source)(m,m.exports,id => {
    if (Object.prototype.hasOwnProperty.call(modules,id)) return modules[id]
    throw Error('unapproved runtime dependency '+id)
  })
  return m.exports
}
const cells=transpile('ui/shared/src/media-gallery-baidu-jsapi4-cells.ts')
const photo=transpile('ui/shared/src/media-gallery-baidu-jsapi4-bd09-photo.ts',{
  './media-gallery-baidu-jsapi4-cells':cells,
})
const bounds={coordinate_space:'bd09ll',west:116,south:39,east:117,north:41}
const original={cell_x:1,cell_y:1,photo_count:100000,asset_id:91,node_id:92,
  latitude:39.4,longitude:116.2}
const page=list=>({
  coordinate_space:'bd09ll',index_scope:'explicit_opt_in_only',grid_columns:8,
  grid_rows:8,total_count:list.reduce((v,c)=>v+c.photo_count,0),cells:list,
})
function nativeFixture() {
  const created=[], removed=[], layers=[], events=new Map(), opened=[], centered=[]
  class Point {constructor(lng,lat){this.lng=lng;this.lat=lat}}
  class Label {
    constructor(text,opts){this.text=text;this.position=opts.position;this.click=null}
    setStyle(style){this.style=style}
    addEventListener(name,cb){assert.equal(name,'click');this.click=cb}
    removeEventListener(name,cb){if(this.click===cb)this.click=null}
  }
  class ClusterLayer {
    setData(data){this.data=data}
    clearData(){this.clears=(this.clears||0)+1}
    addEventListener(){}
    removeEventListener(){}
  }
  let zoom=12
  const map={
    addOverlay(label){created.push(label)},
    removeOverlay(label){removed.push(label)},
    centerAndZoom(point,nextZoom){centered.push({point,zoom:nextZoom});zoom=nextZoom},
    getZoom(){return zoom},
    addLayer(layer){layers.push(layer)},removeLayer(layer){layers.splice(layers.indexOf(layer),1)},
    getBounds(){return {getSouthWest:()=>new Point(116,39),getNorthEast:()=>new Point(117,41)}},
    addEventListener(name,fn){const a=events.get(name)||new Set();a.add(fn);events.set(name,a)},
    removeEventListener(name,fn){events.get(name)?.delete(fn)},
  }
  return {map,Point,Label,ClusterLayer,created,removed,layers,events,opened,centered}
}
test('C20 authentic Server count and complete 64-bin DTO validation; reject fake quantities/owner payloads',()=>{
  assert.equal(Object.keys(original).length,7, 'a cell has exactly seven JSON keys')
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(page([original]),bounds),true)
  for(const bad of [
    {...page([original]),coordinate_space:'photo-wgs84'},
    {...page([original]),index_scope:'all'},
    {...page([original]),total_count:12},
    {...page([original]),extra:'AK'},
    page([original,original]),
    page([{...original,photo_count:0}]),
    page([{...original,asset_id:0}]),
    page([{...original,node_id:0}]),
    page([{...original,longitude:118}]),
    page([{...original,latitude:90}]),
    page([{...original,cell_x:8}]),
    page([{...original,cell_x:2}]),
    page([{...original,cell_y:2}]),
  ]) assert.equal(cells.xDriveValidBaiduNativeCellsPage(bad,bounds),false)
  const sixtyfour=Array.from({length:64},(_,i)=>({...original,cell_x:i%8,
    cell_y:Math.floor(i/8),asset_id:100+i,node_id:200+i,
    longitude:116+(i%8+0.5)/8,
    latitude:39+(Math.floor(i/8)+0.5)/4,
    photo_count:i===63?100000-63:1}))
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(page(sixtyfour),bounds),true)
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(page([...sixtyfour,original]),bounds),false)
})
test('C20 true count uses official JSAPI4 Labels; clicks, revoke and stale bubble cleanup',()=>{
  const f=nativeFixture()
  const ctl=new cells.XDriveBaiduJSAPI4NativeCellOverlays(f.map,{Point:f.Point,Label:f.Label},
    id=>f.opened.push(id))
  const a=new AbortController()
  const singleton={...original,cell_x:4,photo_count:1,asset_id:98,node_id:99,longitude:116.6}
  assert.equal(ctl.apply(page([{...original,photo_count:99999},singleton]),bounds,a.signal),true)
  assert.equal(f.created.length,2)
  assert.equal(f.created[0].text,'99,999')
  assert.equal(f.created[1].text,'1')
  const old=f.created[0].click
  old()
  assert.equal(f.centered[0].zoom,14)
  assert.deepEqual([f.centered[0].point.lng,f.centered[0].point.lat],
    [original.longitude,original.latitude])
  f.created[1].click()
  assert.deepEqual(f.opened,[{assetID:98,nodeID:99}])
  ctl.clear()
  old()
  assert.equal(f.centered.length,1,'cancelled stale JSAPI click must be inert')
  assert.equal(f.removed.length,2)
  a.abort()
  assert.equal(ctl.apply(page([original]),bounds,a.signal),false)
  ctl.dispose()
})
test('C20 bridge fetches <=64 complete cells instead of first 100 photos for dense viewport',async()=>{
  const f=nativeFixture()
  let cellCalls=0,rawCalls=0
  const bridge=new photo.XDriveBaiduJSAPI4IndexedViewportBridge({
    map:f.map,createClusterLayer:()=>new f.ClusterLayer(),
  },async()=>{rawCalls++;throw Error('must not download partial >100 locations')},{
    onOpenPhoto:id=>f.opened.push(id),onViewportInvalidated(){},
  },async (actual,signal)=>{cellCalls++;assert.deepEqual(actual,bounds)
    assert.equal(signal.aborted,false);return page([original])},
    {Point:f.Point,Label:f.Label})
  const r=await bridge.refresh()
  assert.equal(r.kind,'aggregated')
  assert.equal(r.totalPhotos,100000)
  assert.equal(cellCalls,1);assert.equal(rawCalls,0)
  assert.equal(f.created.length,1)
  bridge.cancel()
  assert.equal(f.removed.length,1)
  bridge.dispose()
  assert.equal(f.layers.length,0)
})
test('C20 one real Server /cells and shared Gallery path, no separate desktop file SDK, pin still empty',()=>{
  const api=read('web/src/api.ts'),web=read('web/src/mediaGalleryAdapter.ts')
  const port=read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const places=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const bridge=read('ui/shared/src/media-gallery-baidu-jsapi4-bd09-photo.ts')
  const desktop=read('desktop/src/renderer/mediaGalleryAdapter.ts')
  assert.match(api,/\/api\/v1\/media\/places\/baidu-jsapi\/cells/)
  assert.match(api,/cache:'no-store'/)
  for(const s of [api,web,port,gallery,places,surface,bridge])
    assert.match(s,/BaiduNativeCells|listCells|listOwnerCells|listBaiduNativeCells/)
  assert.match(surface,/kind === 'aggregated'/)
  assert.match(surface,/result !== 'aggregated'/)
  assert.match(gallery,/anchor_node_id: identity\.nodeID/)
  assert.doesNotMatch(desktop,/mintBaiduJSAPI4Session:/)
  assert.match(read('internal/baidumapjsapi/resource_policy.go'),
    /reviewedJSAPI4ChildResourceCount = 0/)
  assert.match(read('internal/baidumapjsapi/release_attestation.go'),
    /jsapi4PinnedProductionPublicKey = ""/)
})
