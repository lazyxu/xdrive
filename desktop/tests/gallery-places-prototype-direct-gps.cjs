'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')

const filename='ui/shared/src/media-gallery-places-prototype-clusters.ts'
const compiled=ts.transpileModule(read(filename),{
  fileName:filename,reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
})
assert.deepEqual(compiled.diagnostics||[],[])
const m={exports:{}}
new Function('module','exports','require',compiled.outputText)(m,m.exports,()=>{
  throw Error('the first-party GPS cluster helper must not import a provider SDK')
})
const {xDrivePlacesPrototypeClusters}=m.exports
const sample=(id,latitude,longitude,count=1,cover=50)=>({
  id, name:id, sample_latitude:latitude,sample_longitude:longitude,
  latitude,longitude,item_count:count,cover_node_id:cover,
})

test('prototype clusters ordinary Owner GPS places without a Baidu per-item Consent grant',()=>{
  const input=[
    sample('place:3568:13970',35.68,139.7,25,21),
    sample('place:3569:13971',35.69,139.71,8,22),
    sample('place:3570:13972',35.70,139.72,3,23),
  ]
  const clusters=xDrivePlacesPrototypeClusters(input,{latitude:35.69,longitude:139.7},12)
  assert.ok(clusters.length>0)
  assert.equal(clusters.reduce((sum,p)=>sum+p.photoCount,0),36)
  assert.ok(clusters.some(p=>p.coverNodeID === 21))
  assert.ok(clusters.every(p=>p.bbox || p.place),
    'each ordinary local cluster can enter the existing Owner sparse Gallery Range')
})
test('same-origin prototype handles distant GPS positions, invalid data, and bounded markers',()=>{
  const near=sample('place:3568:13970',35.68,139.7,2)
  const far=sample('place:4071:-7401',40.71,-74.01,5)
  assert.equal(xDrivePlacesPrototypeClusters([near,far],{latitude:35.68,longitude:139.7},12).length,1)
  assert.deepEqual(xDrivePlacesPrototypeClusters([
    {...near,item_count:0},{...far,sample_latitude:Infinity},
    {...near,sample_latitude:95},
  ],{latitude:35.68,longitude:139.7},12),[])
  assert.equal(xDrivePlacesPrototypeClusters([near],{latitude:Infinity,longitude:0},3).length,0)
  const same=Array.from({length:100},(_,i)=>
    sample('place:'+(3568+i)+':13970',35.68+i/100,139.7,1))
  const clusters=xDrivePlacesPrototypeClusters(same,{latitude:35.68,longitude:139.7},3)
  assert.ok(clusters.length<=64)
})
test('Gallery and Desktop share the first-party map, no independent HTTPS Child or implicit opt-in',()=>{
  const page=read('ui/shared/src/mui/MediaGallery.tsx')
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const staticMap=read('ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx')
  const desktop=read('desktop/src/renderer/App.tsx')
  const places=read('internal/api/media_places.go')
  assert.match(page,/listPlacesPage=\{source.listPlacesPage\}/)
  assert.match(page,/listPlacesPage=\{listPlacesPage\}/)
  assert.match(map,/const prototypeMap = Boolean\(listPlacesPage && loadBaiduStaticMap\)/)
  assert.match(map,/listPlacesPage\(100,offset\)/)
  assert.match(map,/!prototypeMap && !nativeMapFailed/)
  assert.match(staticMap,/data-xdrive-places-prototype-owner-gps-pins/)
  assert.match(staticMap,/xDrivePlacesPrototypeClusters/)
  assert.match(staticMap,/XDriveMediaGalleryCoverThumbnail/)
  assert.match(places,/mediaPlacesBaseQuery/)
  assert.match(places,/mediaPlaceValidGPSPredicate/)
  assert.doesNotMatch(desktop,/onOpenSecureDesktopMap=\{/)
  assert.doesNotMatch(read(filename),/baidu-map-consent|allow_baidu_conversion|Cookie|JWT/)
  assert.doesNotMatch(staticMap,/new BMap|document\.cookie|eval\(/)
})
