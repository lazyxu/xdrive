'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const modulePath = 'ui/shared/src/media-gallery-baidu-jsapi4-viewport-range.ts'
const built = ts.transpileModule(read(modulePath),{
  fileName:modulePath, reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((built.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
const output={exports:{}}
new Function('module','exports',built.outputText)(output,output.exports)
const { xDriveBaiduNativeViewportRangeParams:params,
  xDriveValidBaiduNativeViewportRangePage:valid }=output.exports
const bounds={coordinate_space:'bd09ll',west:116,south:39,east:117,north:40}
const query={sort_by:'captured',sort_dir:'desc',time_zone:'Asia/Tokyo'}
const page={offset:0,limit:48,total_count:100000,items:[
  {node:{id:1}},{node:{id:2}},
]}

test('current camera queries use only bounded BD09 and signed original Range',()=>{
  const q=params(bounds,48,0,query)
  assert.ok(q)
  assert.equal(q.get('range'),'true')
  assert.equal(q.get('west'),'116')
  assert.equal(q.get('sort_by'),'captured')
  assert.equal(q.get('time_zone'),'Asia/Tokyo')
  assert.equal(q.get('coordinate_space'),null)
  for(const bad of [
    {...bounds,coordinate_space:'wgs84'}, {...bounds,west:Infinity},
    {...bounds,south:90}, {...bounds,west:180,east:-180},
    {...bounds,west:116,east:116},
  ]) assert.equal(params(bad,48,0,query),null)
  assert.equal(params(bounds,101,0,query),null)
  assert.equal(params(bounds,48,-1,query),null)
  assert.equal(params(bounds,48,0,{...query,anchor_node_id:-1}),null)
  assert.equal(params(bounds,48,0,{...query,sort_by:'distance'}),null)
  assert.equal(params(bounds,48,0,{...query,search:'private'}),null)
  assert.equal(params(bounds,48,0,{...query,bbox:'0,0,1,1'}),null)
  assert.equal(params(bounds,48,0,{...query,place:'place:1:2'}),null)
  assert.equal(params(bounds,48,0,{...query,fold_duplicates:true}),null)
  assert.equal(params(bounds,48,0,{...query,asset_kind:'live_photo'}),null)
  assert.ok(params(bounds,48,0,{...query,fold_duplicates:false}))
})

test('Owner sparse Range remains page-bounded even with 100k authorized members',()=>{
  assert.equal(valid(page,48,0),true)
  assert.equal(valid({...page,offset:1},48,0),false)
  assert.equal(valid({...page,items:Array.from({length:49},(_,i)=>({node:{id:i+1}}))},48,0),false)
  assert.equal(valid({...page,items:[{node:{id:1}},{node:{id:1}}]},48,0),false)
  assert.equal(valid({...page,anchor_index:100000},48,0),false)
  assert.equal(valid({...page,items:[{node:{id:0}}]},48,0),false)
})

test('full camera uses original virtual Gallery wall, not the ten-cover preview',()=>{
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const web=read('web/src/api.ts')
  const child=read('deploy/baidu-isolated-child/child.js')
  for (const match of [
    "kind: 'baidu-viewport'", "case 'baidu-viewport':",
    'listBaiduNativeViewportItems(target.baiduViewport',
    'virtualCollection.primePage(', 'controller.signal',
    'setSection(\'places\')',
  ]) assert.ok(gallery.includes(match),match)
  assert.ok(map.includes('onOpenViewport={onOpenBaiduNativeViewport}'))
  assert.ok(surface.includes('data-xdrive-places-full-camera-wall'))
  assert.ok(surface.includes('latestAcceptedViewport.current = accepted'))
  assert.ok(surface.includes('onViewport: bounds => { void queryCells(bounds, true) }'))
  assert.ok(web.includes('/api/v1/media/places/baidu-jsapi/viewport-items?'))
  assert.doesNotMatch(child,/viewport-items|loadThumbnail|PhotoAsset|Bearer/)
})
