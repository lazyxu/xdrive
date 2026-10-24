'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const file = 'ui/shared/src/media-gallery-places-map-strip.ts'
const built = ts.transpileModule(read(file), {
  fileName:file,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((built.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[])
const moduleFixture={exports:{}}
new Function('module','exports',built.outputText)(moduleFixture,moduleFixture.exports)
const {xDriveCurrentMapPhotoCollections:selectCurrent,XDRIVE_PLACES_MAP_STRIP_MAX:MAX}=moduleFixture.exports
const bounds={coordinate_space:'bd09ll',west:116,south:39,east:117,north:40}
const cell=(x,y,count=1)=>({cell_x:x,cell_y:y,asset_id:100+x+8*y,
  node_id:200+x+8*y,node_revision:6,photo_count:count,
  latitude:39+0.1*y,longitude:116+0.1*x})
const page=(cells)=>({coordinate_space:'bd09ll',index_scope:'explicit_opt_in_only',
  grid_columns:8,grid_rows:8,total_count:cells.reduce((sum,x)=>sum+x.photo_count,0),cells})
const frame=(cells)=>({width:640,height:480,cells:cells.map((c,i)=>({
  selection:{bounds,cell_x:c.cell_x,cell_y:c.cell_y,asset_id:c.asset_id,
    node_id:c.node_id,node_revision:c.node_revision,photo_count:c.photo_count},
  count:c.photo_count,x:20+i*25,y:60+i*5,
}))})

const approvedFor = (page) => page?.cells.map(c => ({
  bounds,cell_x:c.cell_x,cell_y:c.cell_y,asset_id:c.asset_id,
  node_id:c.node_id,node_revision:c.node_revision,photo_count:c.photo_count,
})) || []
// The approval snapshot is independent of the Child's projected coordinates.
const select = (page, projected, approved = approvedFor(page)) =>
  selectCurrent(page, projected, approved)

test('map photo collections show only paired current authenticated Owner reps',()=>{
  const cells=[cell(0,0,99990),cell(2,0,6),cell(6,0,4)]
  const row=select(page(cells),frame(cells))
  assert.equal(row.length,3)
  assert.deepEqual(row.map(x=>x.count),[99990,6,4])
  assert.equal(row[0].selection.node_id,200)
  assert.equal(select(null,frame(cells)).length,0)
  assert.equal(select(page(cells),null).length,0)
  assert.equal(select({...page(cells),total_count:1},frame(cells)).length,0)
  assert.equal(select({...page(cells),coordinate_space:'wgs84'},frame(cells)).length,0)
  assert.equal(select({...page(cells),index_scope:'all-users'},frame(cells)).length,0)
  assert.equal(select(page(cells.map(c=>({...c,node_revision:undefined}))),frame(cells)).length,0)
})

test('cross-snapshot projection cannot reveal stale, fabricated or unbounded media',()=>{
  const cells=[cell(0,0,1),cell(1,0,5)]
  const source=page(cells), projected=frame(cells)
  assert.equal(select(source,{...projected,cells:[{
    ...projected.cells[0],selection:{...projected.cells[0].selection,node_id:999},
  }]}).length,0)
  assert.equal(select(source,{...projected,cells:[{
    ...projected.cells[0],count:17,
  }]}).length,0)
  assert.equal(select(source,{...projected,cells:[{
    ...projected.cells[0],x:Infinity,
  }]}).length,0)
  assert.equal(select(source,{...projected,cells:[{
    ...projected.cells[0],x:10000,
  }]}).length,0)
  assert.equal(select(source,{...projected,cells:[
    projected.cells[0],projected.cells[0],
  ]}).length,1)
  assert.equal(select(source,{...projected,width:100000}).length,0)
  // The same valid-looking representative from a different camera must NOT
  // acquire Owner thumbnail status under the currently accepted selection.
  const otherCamera={...bounds,west:115}
  const stale={...projected,cells:projected.cells.map(pin=>({
    ...pin,selection:{...pin.selection,bounds:otherCamera},
  }))}
  assert.equal(select(source,stale).length,0)
  assert.equal(select(source,projected,approvedFor(source).slice(0,1)).length,0)
  assert.equal(select(source,projected,approvedFor(source).map(a=>({...a,bounds:otherCamera}))).length,0)
})

test('100k Owner media never induces more than ten preview covers',()=>{
  const cells=Array.from({length:64},(_,i)=>cell(i%8,Math.floor(i/8),i===0?99937:1))
  const result=select(page(cells),frame(cells))
  assert.equal(result.length,MAX)
  assert.equal(MAX,10)
  assert.equal(result[0].count,99937)
  assert.equal(new Set(result.map(x=>x.selection.node_id)).size,MAX)
})

test('UI reuses Server-verified /cells -> /cell-items, not a new photo source',()=>{
  const ui=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const child=read('deploy/baidu-isolated-child/child.js')
  for(const fragment of [
    'xDriveCurrentMapPhotoCollections(trustedSummary, projected, accessible.map(cell => cell.selection))',
    'scopeIsCurrent && acceptedViewport && phase',
    'data-xdrive-places-photo-collection-strip',
    'onClick={() => openVerifiedCell(pin.selection)}',
    'XDriveMediaGalleryCoverThumbnail',
    'revision={pin.selection.node_revision}',
    'frame.replaceAuthorizedCells(cells)',
    'xDriveSelectBaiduNativeCell(page,bounds,cell)',
  ]) assert.ok(ui.includes(fragment),fragment)
  assert.doesNotMatch(child,/loadThumbnail|PhotoAsset|node_id|image_url/)
})
