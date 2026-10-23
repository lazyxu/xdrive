'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const name = 'ui/shared/src/media-gallery-baidu-native-photo-marker-art.ts'
const output = ts.transpileModule(read(name), {fileName:name,reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}})
assert.deepEqual(output.diagnostics ?? [], [])
const mod = {exports:{}}
new Function('module','exports',output.outputText)(mod,mod.exports)
const {xDriveCreateBaiduNativePhotoMarkerArt:makeArt} = mod.exports

function fakeDocument() {
  const texts = [], canvases = []
  return {texts, canvases, createElement(tag) {
    assert.equal(tag, 'canvas')
    const ctx = {
      scale(){},save(){},restore(){},beginPath(){},moveTo(){},
      lineTo(){},quadraticCurveTo(){},closePath(){},fill(){},stroke(){},arc(){},
      fillText(value){texts.push(value)},
    }
    const canvas = {width:0,height:0,getContext(kind) {
      assert.equal(kind,'2d')
      return ctx
    }}
    canvases.push(canvas)
    return canvas
  }}
}

test('SDK native fallback renders photo-shaped, bounded canvases instead of colored bubbles', () => {
  const doc = fakeDocument()
  const art = makeArt(doc)
  const two = art.clusterIcon({pointCount:2})
  assert.ok(doc.texts.includes('2处'))
  assert.equal(two.width,128)
  assert.equal(two.height,128)
  assert.strictEqual(two,art.clusterIcon({pointCount:2}), 'cache one marker per point count')
  assert.notStrictEqual(two,art.clusterIcon({pointCount:3}))
  assert.ok(doc.texts.includes('3处'))
  assert.ok(doc.texts.includes('地点'), 'unknown membership is labeled as place, not a photo count')
  assert.equal(doc.texts.some(value => value.includes('张')),false)
  assert.equal(art.singleIcon.width,128)
})

test('invalid or hostile SDK point counts never enter icon text or grow the cache', () => {
  const doc = fakeDocument()
  const art = makeArt(doc)
  const fallback = art.clusterIcon({})
  for(const malformed of [
    {pointCount:'<script>private</script>'}, {pointCount:-1},
    {pointCount:Infinity},{pointCount:1.5},{pointCount:100000},
    {pointCount:{nested:'private'}},null,undefined,[],
  ])assert.strictEqual(art.clusterIcon(malformed),fallback)
  for(let count=2;count<=64;count++)art.clusterIcon({pointCount:count})
  assert.ok(doc.canvases.length<=65,'at most 63 count icons plus two fixed icons')
  assert.equal(doc.texts.some(value=>value.includes('private')),false)
})

test('one official SDK layer owns marker picking and all covers center on its native hit targets',()=>{
  const map=read('ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx')
  assert.match(map,/new api.ClusterLayer/)
  // Marker restacks must never retire the already merged #2416 quota gate.
  assert.ok(map.includes('setTimeout(load, 500)'))
  assert.ok(map.includes('xDriveBaiduConversionSessionForScope'))
  assert.ok(map.includes('abort.signal, conversionSession'))
  assert.match(map,/clusterIcon: markerArt.clusterIcon/)
  assert.match(map,/singleStyle: \{ icon: markerArt.singleIcon, iconSize: \[64, 64\] \}/)
  assert.match(map,/clusterIconSize: \(\) => \[64, 64\]/)
  assert.match(map,/fitViewOnClick: true/)
  assert.match(map,/pointerEvents: 'none'/)
  assert.match(map,/data-xdrive-baidu-native-cluster-cover/)
  assert.match(map,/data-xdrive-baidu-photo-cover/)
  assert.equal((map.match(/top: pin.y - 30/g)||[]).length,2)
  assert.equal((map.match(/left: pin.x - 30/g)||[]).length,2)
  assert.equal((map.match(/pin.photoCount.toLocaleString\('zh-CN'\)/g)||[]).length,2)
  assert.doesNotMatch(map,/new BMapLib.MarkerClusterer|clusterIcon:.*https?:/)
  assert.match(map,/listPlacesMapOverview\(bounds, detail, controller.signal\)/)
})

test('map has one short user hint; debug throughput and duplicate counters are not shown',()=>{
  const page=read('ui/shared/src/mui/MediaGallery.tsx')
  const parent=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.doesNotMatch(page,/使用百度 JSAPI 动态地图；当前账户有效 GPS 地点/)
  assert.doesNotMatch(parent,/data-xdrive-places-prototype-progress/)
  assert.match(parent,/缩放地图浏览照片/)
  assert.match(parent,/!prototypeMap && !hasIsolatedChildPorts \? <Chip/)
  assert.match(parent,/data-xdrive-places-map-options/)
})

test('signed isolated Child and prototype use neutral photo-style markers with verified counts',()=>{
  const child=read('deploy/baidu-isolated-child/child.js')
  const parent=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const places=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(child,/backgroundColor:'#ffffff'/)
  assert.match(child,/borderRadius:'12px'/)
  assert.match(child,/new sdk.Size\(-28,-28\)/)
  assert.doesNotMatch(child,/backgroundColor:'#1677e9'/)
  assert.match(parent,/data-xdrive-places-trusted-photo-cover=/)
  assert.match(parent,/\{pin.count.toLocaleString\('zh-CN'\)\}张/)
  assert.match(parent,/bgcolor:'rgba\(15,23,42,\.94\)'/)
  assert.doesNotMatch(parent,/rotate\(9deg\)/)
  assert.match(places,/const hasIsolatedChildPorts = Boolean\(/)
  assert.match(places,/const prototypeMap = xDriveBaiduPlacesRuntime\(/)
  assert.match(parent,/xDriveSelectBaiduNativeCell\(page,bounds,cell\)/)
})
