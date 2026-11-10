'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {createRequire} = require('node:module')

const root = path.resolve(__dirname, '../..')
const desktopRequire = createRequire(path.join(root, 'desktop/package.json'))
const esbuild = desktopRequire('esbuild')
const entry = path.join(root, 'ui/shared/src/mui/MediaGalleryVirtualTimeline.ts')
const bundled = esbuild.buildSync({
  entryPoints:[entry], bundle:true, format:'cjs', platform:'node',
  target:'node20', write:false, logLevel:'silent',
})
const mod = {exports:{}}
new Function('module','exports','require',bundled.outputFiles[0].text)(
  mod, mod.exports, require)
const {xDriveMediaGalleryTimelineLayout: geometry,
  xDriveMediaGalleryTimelineOffsetForIndex: offsetAt} = mod.exports

test('one signed date index resolves its real virtual row and out-of-range dates',()=>{
  const layout = geometry({
    width:390,minColumns:3,referenceColumnWidth:144,
    groups:[
      {key:'2026-11-10',start_index:0,item_count:7},
      {key:'2026-11-09',start_index:7,item_count:4},
      {key:'unknown',start_index:11,item_count:2},
    ],
  })
  assert.equal(layout.groups.length,3)
  assert.equal(offsetAt(layout,0),layout.groups[0].itemsTop)
  assert.equal(offsetAt(layout,2),layout.groups[0].itemsTop)
  assert.equal(offsetAt(layout,3),layout.groups[0].itemsTop+layout.rowStep)
  assert.equal(offsetAt(layout,6),layout.groups[0].itemsTop+layout.rowStep*2)
  assert.equal(offsetAt(layout,7),layout.groups[1].itemsTop)
  assert.equal(offsetAt(layout,10),layout.groups[1].itemsTop+layout.rowStep)
  assert.equal(offsetAt(layout,11),layout.groups[2].itemsTop)
  assert.equal(offsetAt(layout,12),layout.groups[2].itemsTop)
  assert.equal(offsetAt(layout,13),null)
  assert.equal(offsetAt(layout,-999),layout.groups[0].itemsTop)
  for(const invalid of [Number.NaN,Infinity,-Infinity,Number.MAX_VALUE]) {
    assert.equal(offsetAt(layout,invalid),null)
  }
})

test('sparse logical date gap or empty layout never fabricates a row',()=>{
  const group = (index,size,top) => ({
    key:'2026',label:'2026年',startIndex:index,itemCount:size,
    itemsTop:top,itemsHeight:50,rowCount:1,headerHeight:32,
    top:top-40,height:90,
  })
  const layout={columns:4,rowStep:45,totalHeight:100,
    groups:[group(0,2,40),group(10,2,90)]}
  assert.equal(offsetAt(layout,2),null)
  assert.equal(offsetAt(layout,9),null)
  assert.equal(offsetAt(layout,10),90)
  assert.equal(offsetAt({...layout,groups:[]},0),null)
})

test('100k one-photo-per-day date jump stays logarithmic, not a scan',()=>{
  // One index per group is the worst case for a linear .find by date. Proxy
  // measures actual indexed array accesses, not noisy wall-clock timing.
  const groups=Array.from({length:100000},(_,i)=>({
    key:String(i),label:String(i),startIndex:i,itemCount:1,
    itemsTop:i*88,itemsHeight:44,rowCount:1,headerHeight:32,
    top:i*88-40,height:88,
  }))
  let reads=0
  const tracked = new Proxy(groups,{
    get(target,key,receiver){
      if(typeof key==='string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target,key,receiver)
    },
  })
  const layout={columns:3,rowStep:44,totalHeight:100000*88,groups:tracked}
  assert.equal(offsetAt(layout,90000),90000*88)
  assert.equal(offsetAt(layout,99999),99999*88)
  assert.equal(offsetAt(layout,0),0)
  assert.equal(offsetAt(layout,100000),null)
  assert.ok(reads<105,'Date anchor must not inspect 100k groups: '+reads)
})

test('both Gallery and signed Places renderers use the binary anchor policy',()=>{
  const source=fs.readFileSync(
    path.join(root,'ui/shared/src/mui/MediaGallerySharedTimeline.tsx'),'utf8')
  const host=fs.readFileSync(
    path.join(root,'ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx'),'utf8')
  const gallery=fs.readFileSync(
    path.join(root,'ui/shared/src/mui/MediaGallery.tsx'),'utf8')
  assert.match(source,/xDriveMediaGalleryTimelineOffsetForIndex\(layout, restoreAnchorIndex\)/)
  assert.doesNotMatch(source,/layout\.groups\.find\(/)
  assert.match(source,/restoreAnchorViewportOffset/)
  assert.match(source,/collection\.onRangeChange\(/)
  assert.match(gallery,/XDriveMediaGalleryVirtualTimeline as MediaVirtualTimeline/)
  assert.match(host,/<XDriveMediaGalleryVirtualTimeline/)
  // Binary UI seeking is never an independent source of media authority.
  assert.doesNotMatch(fs.readFileSync(entry,'utf8'),
    /Authorization|URLSession|fetch\(|OwnerCellItems|JWT/)
})
