'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const sourceFile = 'ui/shared/src/media-gallery-places-map-strip.ts'
const source = fs.readFileSync(path.join(root, sourceFile), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: sourceFile,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const fixture = {exports:{}}
new Function('module', 'exports', compiled.outputText)(fixture, fixture.exports)
const {xDriveVerifiedMapPhotoProjections, xDriveCurrentMapPhotoCollections} = fixture.exports

const bounds = () => ({coordinate_space:'bd09ll',west:118,south:30,east:122,north:33})
const cell = () => ({cell_x:3,cell_y:4,asset_id:23,node_id:45,node_revision:7,photo_count:2})
const selection = () => ({...cell(),bounds:bounds()})
const page = () => ({coordinate_space:'bd09ll',index_scope:'explicit_opt_in_only',
  grid_columns:8,grid_rows:8,total_count:2,cells:[cell()]})
const projected = () => ({width:390,height:700,cells:[
  {selection:selection(),count:2,x:194,y:270},
]})

test('shared Owner /cells is sole authority for both cover count and selected photo', () => {
  const approved=[selection()]
  const verified=xDriveVerifiedMapPhotoProjections(page(),projected(),approved)
  assert.equal(verified.length,1)
  assert.equal(verified[0].selection,approved[0], 'return original trusted Parent selection')
  assert.equal(verified[0].count,2)
  assert.equal(verified[0].x,194)
  assert.equal(verified[0].y,270)
  assert.deepEqual(xDriveCurrentMapPhotoCollections(page(),projected(),approved),verified)
})

test('untrusted SDK cannot spoof count, Owner identity, bounds or pixel geometry', () => {
  const authorized=[selection()]
  const valid=projected()
  const invalid=[
    {...valid,cells:[{...valid.cells[0],count:999}]},
    {...valid,cells:[{...valid.cells[0],count:NaN}]},
    {...valid,cells:[{...valid.cells[0],selection:{...selection(),node_id:99}}]},
    {...valid,cells:[{...valid.cells[0],selection:{...selection(),node_revision:9}}]},
    {...valid,cells:[{...valid.cells[0],selection:{...selection(),
      bounds:{...bounds(),west:117}}}]},
    {...valid,cells:[{...valid.cells[0],x:Infinity}]},
    {...valid,cells:[{...valid.cells[0],x:-1}]},
    {...valid,cells:[{...valid.cells[0],x:391}]},
    {...valid,cells:[{...valid.cells[0],y:-1}]},
    {...valid,cells:[{...valid.cells[0],y:701}]},
    {...valid,width:Infinity},
    {...valid,height:0},
  ]
  for (const untrusted of invalid) {
    assert.deepEqual(xDriveVerifiedMapPhotoProjections(page(),untrusted,authorized),[],
      'malformed SDK projection must produce no Parent photo cover')
  }
  assert.deepEqual(xDriveVerifiedMapPhotoProjections(page(),valid,[]),[])
  assert.deepEqual(xDriveVerifiedMapPhotoProjections(
    {...page(),total_count:3},valid,authorized),[])
  assert.deepEqual(xDriveVerifiedMapPhotoProjections(
    {...page(),cells:[{...cell(),node_id:99}]},valid,authorized),[])
})

test('duplicate SDK projections cannot produce duplicated covers or altered counts', () => {
  const valid=projected()
  const one={...valid.cells[0]}
  const result=xDriveVerifiedMapPhotoProjections(page(),{
    ...valid,cells:[one,{...one,x:200,y:400}],
  },[selection()])
  assert.equal(result.length,1)
  assert.equal(result[0].count,2)
})

test('inline and isolated hosts consume the exact same trusted cover projections', () => {
  const surface=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
  assert.match(surface,/xDriveVerifiedMapPhotoProjections\(\s*trustedSummary, projected, accessible\.map\(cell => cell\.selection\)\)/)
  assert.match(surface,/xDriveCurrentMapPhotoCollections\(trustedSummary, projected,/)
  assert.doesNotMatch(surface,/\[\.\.\.projected\.cells\]\.sort/)
  assert.match(surface,/xDriveMountBaiduInlineMap/)
  assert.match(surface,/xDriveMountBaiduIsolatedFrame/)
})
