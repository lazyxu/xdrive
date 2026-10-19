'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root,
  'ui/shared/src/media-gallery-baidu-jsapi4-native.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const moduleHolder = { exports: {} }
new Function('module', 'exports', compiled)(moduleHolder, moduleHolder.exports)
const bind = moduleHolder.exports.xDriveBindBaiduJSAPI4NativeMap

const opts = Object.freeze({
  clusterRadius: 60, enablePicked: true, fitViewOnClick: true,
  updateRealTime: false, idKey: 'id',
})
const calls = []
const nativeMap = {
  addLayer(layer) { calls.push(['add', layer]) },
  removeLayer(layer) { calls.push(['remove', layer]) },
  addEventListener(name, fn) { calls.push(['listen', name, fn]) },
  removeEventListener(name, fn) { calls.push(['unlisten', name, fn]) },
}
class Point { constructor(lng, lat) { this.lng = lng; this.lat = lat } }
class Convertor {
  translate(points, from, to, callback) {
    calls.push(['officialTranslate', from, to, points.length])
    callback({ status: 0, points })
  }
}
class ClusterLayer {
  constructor(options) { this.options = options; calls.push(['nativeCluster', options]) }
  setData(data) { this.data = data }
  clearData() { this.data = null }
  addEventListener(name, fn) { calls.push(['layerListen', name, fn]) }
  removeEventListener(name, fn) { calls.push(['layerUnlisten', name, fn]) }
}
const namespace = { Point, Convertor, ClusterLayer }

test('A3 inert native port binds exact documented JSAPI4 constructors with 0/0', () => {
  calls.length = 0
  const runtime = bind(nativeMap, namespace)
  assert.equal(runtime.map, nativeMap)
  assert.deepEqual(runtime.createPoint(0, 0), new Point(0, 0))
  const layer = runtime.createClusterLayer(opts)
  assert.ok(layer instanceof ClusterLayer)
  assert.deepEqual(layer.options, opts)
  let result
  runtime.convertor.translate([runtime.createPoint(0, 0)], 1, 5, value => { result = value })
  assert.deepEqual(result, { status: 0, points: [new Point(0, 0)] })
  assert.deepEqual(calls, [
    ['nativeCluster', opts], ['officialTranslate', 1, 5, 1],
  ])
})

test('A3 native namespace/map contract fails closed for incomplete official interfaces', () => {
  assert.throws(() => bind(null, namespace), /baidu_jsapi4_native_unavailable/)
  assert.throws(() => bind({}, namespace), /baidu_jsapi4_native_unavailable/)
  assert.throws(() => bind(nativeMap, {}), /baidu_jsapi4_native_unavailable/)
  assert.throws(() => bind(nativeMap, { ...namespace, Convertor: class {} }),
    /baidu_jsapi4_native_unavailable/)
  assert.throws(() => bind(nativeMap, { ...namespace, Point: undefined }),
    /baidu_jsapi4_native_unavailable/)
  assert.throws(() => bind(nativeMap, { ...namespace, Convertor: class {
    constructor() { throw Error('provider secret, do not echo') }
  } }), /baidu_jsapi4_native_unavailable/)
})

test('A3 native adapter rejects forged ClusterLayer options, broken layers and coordinates', () => {
  const runtime = bind(nativeMap, namespace)
  for (const changed of [
    { ...opts, idKey: 'other' }, { ...opts, clusterRadius: 1 },
    { ...opts, updateRealTime: true }, { ...opts, extra: 1 },
  ]) assert.throws(() => runtime.createClusterLayer(changed),
    /baidu_jsapi4_native_unavailable/)
  for (const [lng, lat] of [[Infinity, 1], [181, 0], [0, 86], [NaN, 0]]) {
    assert.throws(() => runtime.createPoint(lng, lat),
      /baidu_jsapi4_native_unavailable/)
  }
  const brokenLayer = bind(nativeMap, { ...namespace, ClusterLayer: class {} })
  assert.throws(() => brokenLayer.createClusterLayer(opts),
    /baidu_jsapi4_native_unavailable/)
  const lyingPoint = bind(nativeMap, { ...namespace, Point: class {
    constructor() { this.lng = 0; this.lat = 0 }
  } })
  assert.throws(() => lyingPoint.createPoint(1, 2),
    /baidu_jsapi4_native_unavailable/)
})

test('A3 official adapter cannot serve as a licence, release proof, loader or second Gallery', () => {
  const policy = fs.readFileSync(path.join(root,
    'internal/baidumapjsapi/resource_policy.go'), 'utf8')
  const sharedMap = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'), 'utf8')
  const bridge = fs.readFileSync(path.join(root,
    'ui/shared/src/media-gallery-baidu-jsapi4-viewport.ts'), 'utf8')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(policy, /return ErrGateClosed/)
  assert.match(sharedMap, /XDriveMediaGalleryBaiduStaticMap/)
  assert.doesNotMatch(sharedMap, /media-gallery-baidu-jsapi4-native/)
  assert.match(bridge, /listOwnerViewport\(bounds, maxViewportCells, 0, request.signal\)/)
  assert.doesNotMatch(source,
    /window\.BMap|new BMap\.|document\.createElement|BMapLoader|fetch\(|localStorage|serviceHost/)
  assert.doesNotMatch(source, /getBounds\(\)/)
})
