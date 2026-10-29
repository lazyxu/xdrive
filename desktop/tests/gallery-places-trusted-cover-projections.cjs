'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const sourceFile = 'ui/shared/src/media-gallery-places-map-pins.ts'
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
const {
  xDriveVerifiedMapPhotoProjections,
  xDriveSelectVisibleMapPhotoCovers, XDRIVE_PLACES_MAP_COVER_MAX,
} = fixture.exports

const bounds = () => ({coordinate_space:'bd09ll',west:118,south:30,east:122,north:33})
const cell = () => ({cell_x:3,cell_y:4,asset_id:23,node_id:45,node_revision:7,photo_count:2})
const selection = () => ({...cell(),bounds:bounds()})
const page = () => ({coordinate_space:'bd09ll',index_scope:'owner_gps_auto_index',
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
  // Both SDK Hosts reject stale consent-era scopes instead of producing
  // misleading cover counts or dropping current Owner photos silently.
  assert.deepEqual(xDriveVerifiedMapPhotoProjections(
    {...page(),index_scope:'explicit_opt_in_only'},valid,authorized),[])
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
  assert.doesNotMatch(surface,/\[\.\.\.projected\.cells\]\.sort/)
  assert.match(surface,/xDriveMountBaiduInlineMap/)
  assert.match(surface,/xDriveMountBaiduIsolatedFrame/)
})


test('photo-first map avoids badge, map-control and diagonal overlap', () => {
  const pins=[
    {count:100,x:210,y:150,id:'largest'},
    {count:90,x:280,y:218,id:'diagonal-collision'},
    {count:80,x:360,y:151,id:'separate'},
    {count:70,x:40,y:100,id:'clipped-left'},
    {count:60,x:862,y:200,id:'clipped-right'},
    {count:50,x:600,y:750,id:'under-map-controls'},
    {count:40,x:600,y:620,id:'unobscured'},
    {count:35,x:750,y:675,id:'reclaimed-map-space'},
  ]
  const selected=xDriveSelectVisibleMapPhotoCovers(pins,900,800,false)
  assert.deepEqual(selected.map(pin=>pin.id),['largest','separate','unobscured','reclaimed-map-space'])
  assert.deepEqual(pins.map(pin=>pin.count),[100,90,80,70,60,50,40,35],
    'display selection never mutates original signed projection or count')
})

test('mobile photo pins respect compact count-badge, safe edge and landscape controls', () => {
  const pins=[
    {count:90,x:120,y:120,id:'selected'},
    {count:80,x:200,y:195,id:'overlapping'},
    {count:70,x:325,y:300,id:'right-clipped'},
    {count:60,x:205,y:210,id:'separate'},
    {count:50,x:200,y:755,id:'behind-map-controls'},
  ]
  assert.deepEqual(xDriveSelectVisibleMapPhotoCovers(pins,390,844,true)
    .map(pin=>pin.id),['selected','separate'])
  assert.deepEqual(xDriveSelectVisibleMapPhotoCovers([
    {count:10,x:250,y:310,id:'under-landscape-controls'},
    {count:8,x:250,y:170,id:'visible-landscape'},
  ],900,390,true).map(pin=>pin.id),['visible-landscape'])
  assert.deepEqual(xDriveSelectVisibleMapPhotoCovers([
    {count:12,x:46,y:160,id:'wide-compact-cut-border'},
    {count:11,x:120,y:160,id:'wide-compact-valid'},
  ],900,390,true).map(pin=>pin.id),['wide-compact-valid'],
  'wide compact tablet still renders the 72px sm card, not a 64px xs card')
  assert.deepEqual(xDriveSelectVisibleMapPhotoCovers(pins,Infinity,844,true),[])
  assert.deepEqual(xDriveSelectVisibleMapPhotoCovers(pins,390,0,true),[])
})

test('all 64 current Owner cells may have bounded photo covers when geometry permits', () => {
  const pins=Array.from({length:64},(_,i)=>({
    count:64-i,x:110+(i%8)*110,y:110+Math.floor(i/8)*108,
  }))
  const output=xDriveSelectVisibleMapPhotoCovers(pins,1000,1000,false)
  assert.equal(XDRIVE_PLACES_MAP_COVER_MAX,64)
  assert.equal(output.length,64)
  assert.equal(pins.length,64)
  assert.equal(new Set(output.map(p=>p.count)).size,64)
  const surface=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
  assert.match(surface,/xDriveSelectVisibleMapPhotoCovers\(/)
  assert.match(surface,/xDriveVerifiedMapPhotoProjections\(/)
  assert.match(surface,/data-xdrive-places-cluster-list/)
  assert.match(surface,/xDriveMountBaiduInlineMap/)
  assert.match(surface,/xDriveMountBaiduIsolatedFrame/)
})

test('photo overlay has one shared presentation lease for inline and isolated native labels', () => {
  const parent=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
  const inline=fs.readFileSync(path.join(root,
    'ui/shared/src/media-gallery-baidu-inline-map-host.ts'),'utf8')
  const frame=fs.readFileSync(path.join(root,
    'ui/shared/src/media-gallery-baidu-isolated-frame-host.ts'),'utf8')
  const child=fs.readFileSync(path.join(root,
    'deploy/baidu-isolated-child/child.js'),'utf8')
  assert.match(parent,/mapFrameRef\.current\?\.setPhotoCoverSelections\?\.\(/)
  assert.match(parent,/coverPins\.map\(pin => pin\.selection\)/)
  assert.match(parent,/complete marker presentation/)
  assert.match(parent,/xDriveVerifiedMapPhotoProjections\(/)
  assert.match(inline,/coveredSelections\.size > 0/)
  assert.match(inline,/complete Cell list and signed/)
  assert.match(inline,/return renderCells\(false\)/)
  assert.match(frame,/xDriveCreateBaiduIsolatedPhotoCoversMessage\(/)
  assert.match(child,/coveredKeys\.size > 0/)
  assert.match(child,/current Cells remain accessible in Parent/)
  assert.match(child,/renderCells\(false\)/)
  assert.doesNotMatch(child,/\\.node_id\\b|\\.asset_id\\b|photo_url|loadThumbnail|Authorization:/,
    'no private photo transport may enter the isolated SDK Host')
  assert.equal(XDRIVE_PLACES_MAP_COVER_MAX,64)
})

test('map screenshot no longer owns a fixed photo thumbnail strip', () => {
  const surface=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
  const browser=fs.readFileSync(path.join(root,
    'desktop/scripts/gallery-places-dual-host-chromium.cjs'),'utf8')
  assert.doesNotMatch(surface,/photoStrip|xDriveCurrentMapPhotoCollections|data-xdrive-places-photo-collection-strip|data-xdrive-places-map-photo-strip-shell|data-xdrive-places-collection-thumb/)
  assert.doesNotMatch(source,/XDRIVE_PLACES_MAP_STRIP_MAX|xDriveCurrentMapPhotoCollections|hasBottomStrip/)
  assert.match(surface,/data-xdrive-places-map-photo-summary/)
  assert.match(surface,/data-xdrive-places-full-camera-wall/)
  assert.match(surface,/data-xdrive-places-cluster-list/)
  assert.match(browser,/noFixedPhotoStrip/)
})

test('real Chromium proves both SDK Hosts never paint mixed native labels and signed photo covers', () => {
  const browser=fs.readFileSync(path.join(root,
    'desktop/scripts/gallery-places-dual-host-chromium.cjs'),'utf8')
  const fixture=fs.readFileSync(path.join(root,
    'desktop/scripts/gallery-places-dual-host-chromium.tsx'),'utf8')
  assert.match(browser,/async function testPhotoMarkerPresentation\(/)
  assert.match(browser,/await testPhotoMarkerPresentation\(browser,'inline',port\)/)
  assert.match(browser,/await testPhotoMarkerPresentation\(browser,'isolated',port\)/)
  assert.match(browser,/sdk\.maxOverlays>=2 && sdk\.overlays\.length===0/)
  assert.match(browser,/preview\?\.total===5&&preview\?\.items===5/)
  assert.match(fixture,/const mixedMarkerMap = !genuineGin/)
  assert.match(fixture,/cells:mixedMarkerMap\?\[first,other\]:\[first\]/)
  assert.match(browser,/presentation\.pins===1&&presentation\.cellCount===2/)
})

test('measured Parent-only controls protect their own wrapped buttons without a bottom dock',()=>{
  // The real count/action pills occupy only the right-hand part of this
  // canvas. A free photo in the same bottom row must not be discarded.
  const pins=[
    {id:'under-controls',count:90,x:470,y:605},
    {id:'free-bottom',count:80,x:200,y:605},
    {id:'free-above',count:70,x:470,y:480},
  ]
  const controls=[{left:408,top:566,right:555,bottom:686}]
  assert.deepEqual(xDriveSelectVisibleMapPhotoCovers(pins,900,700,false,controls)
    .map(pin=>pin.id),['free-bottom','free-above'])
  assert.deepEqual(xDriveSelectVisibleMapPhotoCovers(pins,900,700,false)
    .map(pin=>pin.id),['free-above'],
    'before real DOM measurement the safe legacy bottom boundary remains')
  for (const invalid of [
    {left:-100,top:0,right:200,bottom:120},
    {left:NaN,top:0,right:200,bottom:120},
    {left:400,top:60,right:300,bottom:120},
  ]) assert.deepEqual(xDriveSelectVisibleMapPhotoCovers(
    pins,900,700,false,[invalid]).map(pin=>pin.id),['free-above'])
  assert.deepEqual(pins.map(pin=>pin.count),[90,80,70],
    'cosmetic overlay exclusions never mutate Owner count or signed Cell')
})

test('both SDK Hosts receive the same current React layout exclusions',()=>{
  const parent=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
  const driver=fs.readFileSync(path.join(root,
    'desktop/scripts/gallery-places-dual-host-chromium.cjs'),'utf8')
  assert.match(parent,/ref=\{summaryElement\} data-xdrive-places-map-photo-summary/)
  assert.match(parent,/ref=\{errorElement\} role="alert"/)
  assert.match(parent,/new win\.ResizeObserver\(measure\)/)
  assert.match(parent,/setOverlayRects\(/)
  assert.match(parent,/projected\.width, projected\.height, edgeToEdge, overlayRects\)/)
  assert.match(parent,/summary,edgeToEdge,loadThumbnail,overlayRects\]/)
  assert.match(parent,/mapFrameRef\.current\?\.setPhotoCoverSelections\?\.\(/)
  assert.match(driver,/testMapOverlayPinOcclusion/)
  assert.doesNotMatch(parent,/data-xdrive-places-photo-collection-strip/)
})

test('nearby 142 and 28 Owner photo clusters both paint when their cards do not overlap',()=>{
  // Regression from actual Baidu map screenshot: prior 104x92 conservative
  // collision exclusion silently removed the valid 28-photo thumbnail,
  // leaving only a native-looking numeric fallback. Both true signed
  // representatives must be independently paintable at this spacing.
  const nearby=[
    {count:142,x:950,y:100,id:'large'},
    {count:28,x:1049,y:190,id:'28-photo'},
    {count:10,x:1020,y:160,id:'genuinely-overlapping'},
  ]
  const selected=xDriveSelectVisibleMapPhotoCovers(nearby,1280,760,false,[])
  assert.deepEqual(selected.map(x=>x.id),['large','28-photo'])
  assert.deepEqual(nearby.map(x=>x.count),[142,28,10],
    'decluttering must never alter signed Owner count, only visual pins')
})
