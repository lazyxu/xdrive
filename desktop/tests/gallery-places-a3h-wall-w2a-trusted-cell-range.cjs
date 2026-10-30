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
const viewport=loadTs('ui/shared/src/media-gallery-baidu-jsapi4-viewport-range.ts')
const lib=loadTs('ui/shared/src/media-gallery-baidu-jsapi4-cell-range.ts',{
  './media-gallery-baidu-jsapi4-cells':cells,
  './media-gallery-baidu-jsapi4-viewport-range':viewport,
})
const bounds={coordinate_space:'bd09ll',west:116,south:39,east:117,north:41}
const p={cell_x:1,cell_y:1,asset_id:9,node_id:19,node_revision:3,
  photo_count:2,longitude:116.2,latitude:39.3}
const page={coordinate_space:'bd09ll',index_scope:'owner_gps_auto_index',
  grid_columns:8,grid_rows:8,total_count:2,cells:[p]}
const sort={by:'captured',dir:'desc'}
test('middle Owner clusters stay grouped after a small pan with negotiated world tiles',()=>{
  const first={coordinate_space:'bd09ll',west:100,south:0,east:108,north:8}
  const moved={...first,west:100.6,east:108.6}
  const a=103.5,b=103.7,lat=1.5
  const legacy=(bounds,lon)=>Math.floor((lon-bounds.west)/
    ((bounds.east-bounds.west)/8))
  // This reproduces the user's complaint in the PREVIOUS shipped 8x8 grid:
  // two middle photos are ONE cell, then separate while both remain visible.
  assert.equal(legacy(first,a),3)
  assert.equal(legacy(first,b),3)
  assert.equal(legacy(moved,a),2)
  assert.equal(legacy(moved,b),3)
  const posA=cells.xDriveWorldStableBaiduCellXY(first,a,lat)
  const posB=cells.xDriveWorldStableBaiduCellXY(first,b,lat)
  const movedA=cells.xDriveWorldStableBaiduCellXY(moved,a,lat)
  const movedB=cells.xDriveWorldStableBaiduCellXY(moved,b,lat)
  assert.deepEqual(posA,posB)
  assert.deepEqual(movedA,movedB)
  assert.deepEqual(posA,movedA)
  const makePage=(bounds,id)=>({
    coordinate_space:'bd09ll',index_scope:'owner_gps_auto_index',
    grid_scheme:'world_stable_v1',grid_columns:8,grid_rows:8,
    total_count:2,cells:[{
      cell_x:cells.xDriveWorldStableBaiduCellXY(bounds,a,lat).x,
      cell_y:cells.xDriveWorldStableBaiduCellXY(bounds,a,lat).y,
      photo_count:2,asset_id:8,node_id:id,node_revision:3,
      latitude:lat,longitude:a,
    }],
  })
  const firstPage=makePage(first,88),movedPage=makePage(moved,88)
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(firstPage,first),true)
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(movedPage,moved),true)
  const selected=lib.xDriveSelectBaiduNativeCell(movedPage,moved,movedPage.cells[0])
  assert.equal(selected?.grid_scheme,'world_stable_v1')
  assert.equal(selected?.photo_count,2)
  assert.equal(selected?.node_id,88)
  const range=lib.xDriveBaiduNativeCellRangeParams(selected,48,0,{
    by:'captured',dir:'desc',
  })
  assert.ok(range)
  assert.equal(range.has('grid_scheme'),false,
    'scheme travels only in a trusted Owner header, not in public map URL')
  for(const invalid of [
    {...movedPage,grid_scheme:'unreviewed'},
    {...movedPage,grid_scheme:undefined},
    {...movedPage,cells:[{...movedPage.cells[0],cell_x:7}]},
    {...movedPage,total_count:3},
    {...movedPage,owner_id:999},
  ])assert.equal(cells.xDriveValidBaiduNativeCellsPage(invalid,moved),false)
  assert.equal(cells.xDriveValidBaiduNativeCellsPage({
    ...firstPage,grid_scheme:undefined,
  },first),false,'legacy DTO must not gain even an undefined scheme field')
  const validLegacy={...page}
  assert.equal(cells.xDriveValidBaiduNativeCellsPage(validLegacy,bounds),true)
  const web=read('web/src/api.ts')
  assert.match(web,/X-XDrive-Map-Grid-Scheme': 'world_stable_v1'/)
  assert.match(web,/selection\.grid_scheme === 'world_stable_v1'/)
})

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
test('filtered map Cell click cannot widen the accepted Owner Gallery scope',()=>{
  const selection=lib.xDriveSelectBaiduNativeCell(page,bounds,p)
  const filters={sort_by:'added',sort_dir:'asc',favorite:true,
    asset_kind:'video',captured_from:'2026-01-01',
    captured_to:'2026-12-31',time_zone:'Asia/Tokyo'}
  const map=viewport.xDriveBaiduNativeCellsFilterParams(bounds,filters,'manual:trip')
  const range=lib.xDriveBaiduNativeCellRangeParams(selection,48,0,{
    by:'added',dir:'asc',filters,albumKey:'manual:trip',anchorNodeID:19,
  })
  assert.ok(map && range)
  for(const [name,value] of map.entries()) assert.equal(range.get(name),value,name)
  assert.equal(range.get('range'),'true')
  assert.equal(range.get('photo_count'),'2')
  assert.equal(range.get('anchor_node_id'),'19')
  assert.equal(range.get('coordinate_space'),null)
  for(const bad of [
    {search:'private'}, {bbox:'116,39,117,41'},
    {fold_duplicates:true}, {anchor_node_id:20},
    {asset_kind:'live_photo'}, {sort_by:'captured'},
  ]) {
    assert.equal(lib.xDriveBaiduNativeCellRangeParams(selection,48,0,{
      by:'added',dir:'asc',filters:{...filters,...bad},albumKey:'manual:trip',
    }),null)
  }
  assert.equal(lib.xDriveBaiduNativeCellRangeParams(selection,48,0,{
    by:'added',dir:'asc',filters,albumKey:'invalid-album',
  }),null)
  assert.equal(lib.xDriveBaiduNativeCellRangeParams(selection,48,0,{
    by:'added',dir:'asc',filters,albumKey:'manual:trip',
    anchorNodeID:0,
  }),null)
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
test('signed Cell Range transport rejects overlap, repeated Nodes and bogus anchors',()=>{
  const item=id=>({node:{id}})
  // This lower-level contract intentionally accepts sparse pages. The
  // higher-level 48-item Drawer independently requires complete pages.
  const sparse={items:[item(19)],total_count:2,offset:0,limit:100}
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage(sparse,100,0),true)
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage({
    ...sparse,items:[item(19),item(20)],anchor_index:1,
  },100,0),true)
  assert.equal(lib.xDriveValidBaiduNativeCellRangePage({
    ...sparse,items:[],offset:2,
  },100,2),true,'an empty page at the end remains a valid sparse response')

  const cases=[
    [{...sparse,items:[item(19),item(19)]},100,0],
    [{...sparse,offset:1,items:[item(19),item(20)]},100,1],
    [{...sparse,offset:2,items:[item(19)]},100,2],
    [{...sparse,anchor_index:-1},100,0],
    [{...sparse,anchor_index:2},100,0],
    [{...sparse,anchor_index:1.5},100,0],
    [{...sparse,anchor_index:'1'},100,0],
    [{...sparse,items:[item(0)]},100,0],
    [{...sparse,items:[item(1.5)]},100,0],
    [{...sparse,items:[]},0,0],
    [{...sparse,items:[]},101,0],
    [{...sparse,items:[],offset:-1},100,-1],
    [{...sparse,items:[],offset:10_000_001},100,10_000_001],
    [{...sparse,items:{}},100,0],
    [[],100,0],
  ]
  for(const [response,limit,offset] of cases)
    assert.equal(lib.xDriveValidBaiduNativeCellRangePage(response,limit,offset),false,
      JSON.stringify({response,limit,offset}))
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
