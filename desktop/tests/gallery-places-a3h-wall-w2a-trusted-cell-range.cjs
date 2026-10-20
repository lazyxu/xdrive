'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
function loadTs(file, modules={}) {
  const compiled=ts.transpileModule(read(file), {fileName:file,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  assert.deepEqual((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
  const mod={exports:{}}
  new Function('module','exports','require',compiled.outputText)(mod,mod.exports,id=>{
    if(Object.hasOwn(modules,id))return modules[id]
    throw Error('unexpected source dependency '+id)
  })
  return mod.exports
}
const cells=loadTs('ui/shared/src/media-gallery-baidu-jsapi4-cells.ts')
const lib=loadTs('ui/shared/src/media-gallery-baidu-jsapi4-cell-range.ts',{
  './media-gallery-baidu-jsapi4-cells':cells,
})
const bounds={coordinate_space:'bd09ll',west:116,south:39,east:117,north:41}
const p={cell_x:1,cell_y:1,asset_id:9,node_id:19,node_revision:3,
  photo_count:2,longitude:116.2,latitude:39.3}
const page={coordinate_space:'bd09ll',index_scope:'explicit_opt_in_only',
  grid_columns:8,grid_rows:8,total_count:2,cells:[p]}
const sort={by:'captured',dir:'desc'}
test('W2a freezes only actual Owner /cells identity and its BD09 bounds',()=>{
  const s=lib.xDriveSelectBaiduNativeCell(page,bounds,p)
  assert.deepEqual(s,{bounds,cell_x:1,cell_y:1,asset_id:9,
    node_id:19,node_revision:3,photo_count:2})
  assert.notEqual(s.bounds,bounds)
  for(const update of [{photo_count:3},{node_revision:4},{asset_id:10},
                       {cell_x:2},{node_id:20}])
    assert.equal(lib.xDriveSelectBaiduNativeCell(page,bounds,{...p,...update}),null)
  assert.equal(lib.xDriveSelectBaiduNativeCell(page,
    {...bounds,coordinate_space:'wgs84ll'},p),null)
  assert.equal(lib.xDriveSelectBaiduNativeCell(
    {...page,cells:[{...p,node_revision:undefined}]},bounds,p),null)
})
test('W2a bounded signed Owner URL has exact allowed names and no credential',()=>{
  const s=lib.xDriveSelectBaiduNativeCell(page,bounds,p)
  const q=lib.xDriveBaiduNativeCellRangeParams(s,100,0,{
    by:'added',dir:'asc',anchorNodeID:19,
  })
  assert.deepEqual([...q.keys()].sort(),[
    'anchor_node_id','asset_id','cell_x','cell_y','east','limit','node_id',
    'node_revision','north','offset','photo_count','range','sort_by','sort_dir',
    'south','west',
  ].sort())
  assert.equal(q.get('range'),'true')
  assert.equal(q.get('anchor_node_id'),'19')
  assert.equal(q.get('node_revision'),'3')
  assert.equal(q.get('sort_by'),'added')
  for (const [bad,l,o,by] of [
    [{...s,bounds:{...bounds,coordinate_space:'wgs84ll'}},100,0,sort],
    [{...s,node_revision:0},100,0,sort],
    [{...s,photo_count:0},100,0,sort],
    [{...s,cell_y:8},100,0,sort],
    [s,101,0,sort],[s,100,10000001,sort],
    [s,50,0,{by:'random',dir:'desc'}],
    [s,50,0,{by:'added',dir:'up'}],
    [s,50,0,{by:'captured',dir:'asc',anchorNodeID:0}],
  ]) assert.equal(lib.xDriveBaiduNativeCellRangeParams(bad,l,o,by),null)
})
test('W2a sparse Range rejects fabricated count and invalid identity',()=>{
  const first={items:[{node:{id:19}}],total_count:2,offset:0,limit:100}
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage(first,100,0),true)
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage({...first,total_count:0},100,0),false)
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage({...first,total_count:NaN},100,0),false)
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage({...first,offset:1},100,0),false)
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage({...first,limit:101},100,0),false)
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage({...first,items:[{node:{id:0}}]},100,0),false)
})
test('W2a trusted Web/Mobile Web endpoint is not a general Gallery/share scope',()=>{
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const adapter=read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const api=read('web/src/api.ts')
  const web=read('web/src/mediaGalleryAdapter.ts')
  assert.match(gallery,/listBaiduNativeCellItems\?:/)
  assert.match(adapter,/port\.listBaiduNativeCellItems!/)
  assert.match(web,/api\.mediaBaiduNativeCellItems\(selection, limit, offset, sort, signal\)/)
  assert.match(api,/\/api\/v1\/media\/places\/baidu-jsapi\/cell-items\?/)
  assert.match(api,/xDriveValidBaiduNativeCellRangePage/)
  assert.doesNotMatch(api.slice(api.indexOf('mediaBaiduNativeCellItems('),
    api.indexOf('mediaPlaces(limit = 24)')), /BrowserAK|owner_id|localStorage|share_token|BMap\.Convertor/)
})
