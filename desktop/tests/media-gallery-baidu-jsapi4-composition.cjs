'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function transpile(pathname, dependency = {}) {
  const compiled = ts.transpileModule(read(pathname), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(
    module, module.exports, id => {
      if (!Object.hasOwn(dependency, id)) throw Error('unexpected module in offline test')
      return dependency[id]
    })
  return module.exports
}
const base = 'ui/shared/src/'
const markers = transpile(base + 'media-gallery-baidu-jsapi4-markers.ts')
const layer = transpile(base + 'media-gallery-baidu-jsapi4-layer.ts',
  { './media-gallery-baidu-jsapi4-markers': markers })
const viewport = transpile(base + 'media-gallery-baidu-jsapi4-viewport.ts',
  { './media-gallery-baidu-jsapi4-layer': layer })
const native = transpile(base + 'media-gallery-baidu-jsapi4-native.ts')
const compositionPath = base + 'media-gallery-baidu-jsapi4-composition.ts'
const composition = transpile(compositionPath, {
  './media-gallery-baidu-jsapi4-native': native,
  './media-gallery-baidu-jsapi4-viewport': viewport,
})
const compose = composition.xDriveComposeBaiduJSAPI4OwnerViewport
const bounds = { west: -1, south: -1, east: 1, north: 1 }
const photoWindow = value => ({ coordinate_space: 'photo-wgs84', bounds: value })
function page() {
  return {
    items: [{ id: 'place:0:0', name: '原始 GPS', latitude: 0.005,
      longitude: 0.005, sample_latitude: 0, sample_longitude: 0,
      coordinate_kind: 'grid_cell_center', item_count: 3 }],
    offset: 0, limit: 100, has_more: false,
    total_count: 1, total_photo_count: 3,
  }
}
function fixture() {
  const events = new Map()
  const clicks = new Map()
  const layers = []
  const records = []
  class Point {
    constructor(lng, lat) { this.lng = lng; this.lat = lat }
  }
  class Convertor {
    translate(points, from, to, fn) {
      records.push(['convert', from, to, points.length])
      fn({ status: 0, points: points.map(p => new Point(p.lng + 0.001, p.lat + 0.001)) })
    }
  }
  class ClusterLayer {
    constructor(options) { this.options = options; this.data = null; layers.push(this) }
    setData(data) { this.data = data }
    clearData() { this.data = null }
    addEventListener(type, fn) { clicks.set(type, fn) }
    removeEventListener(type, fn) { assert.equal(clicks.get(type), fn); clicks.delete(type) }
  }
  const map = {
    addLayer(layer) { assert.ok(layer instanceof ClusterLayer) },
    removeLayer(layer) { assert.ok(layer instanceof ClusterLayer); layers.pop() },
    addEventListener(type, fn) {
      if (!events.has(type)) events.set(type, new Set())
      events.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      assert.equal(events.get(type)?.delete(fn), true)
    },
  }
  return {
    map, namespace: { Point, Convertor, ClusterLayer },
    layers, records, events, clicks,
    emit(type) { for (const fn of [...(events.get(type) || [])]) fn() },
  }
}

test('A3 official native composition binds one Owner viewport and original Gallery Viewer', async () => {
  const f = fixture()
  const calls = [], opened = [], outcomes = []
  const inputs = {
    map: f.map, namespace: f.namespace,
    trustedWGS84Bounds: async () => photoWindow({ ...bounds }),
    listOwnerViewport: async (b, limit, offset, signal) => {
      calls.push({ b, limit, offset, signal })
      return page()
    },
    callbacks: {
      onOpenPlace: item => opened.push(item),
      onResult: result => outcomes.push(result.kind),
    },
  }
  const bridge = compose(inputs)
  assert.equal(f.layers.length, 1)
  assert.deepEqual(await bridge.refresh(), { kind: 'rendered', cells: 1, photos: 3 })
  assert.deepEqual(outcomes, ['rendered'])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].b, bounds)
  assert.equal(calls[0].limit, 100)
  assert.equal(calls[0].offset, 0)
  assert.equal(calls[0].signal.aborted, false)
  assert.deepEqual(f.records, [['convert', 1, 5, 1]])
  assert.deepEqual(f.layers[0].data.features[0].geometry.coordinates, [0.001, 0.001])
  f.clicks.get('click')({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 3 } } })
  assert.deepEqual(opened, page().items)
  f.clicks.get('click')({ value: { isCluster: true, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 3 } } })
  f.clicks.get('click')({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 5 } } })
  assert.equal(opened.length, 1, 'native cluster or forged count cannot select a photo')
  bridge.dispose()
  assert.equal(f.layers.length, 0)
  assert.equal((await bridge.refresh()).kind, 'query-unavailable')
  assert.equal(f.clicks.size, 0)
})

test('A3 native pan cancels old Go viewport promptly; stale response cannot reinstall markers', async () => {
  const f = fixture()
  const calls = []
  let resolveOld
  const bridge = compose({
    map: f.map, namespace: f.namespace,
    trustedWGS84Bounds: async () => photoWindow({ ...bounds }),
    listOwnerViewport: (_b, limit, offset, signal) => {
      calls.push({ limit, offset, signal })
      if (calls.length === 1) return new Promise(resolve => { resolveOld = resolve })
      return Promise.resolve(page())
    },
    callbacks: { onOpenPlace() { throw Error('stale click opened') } },
  })
  const old = bridge.refresh()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1)
  f.emit('movestart')
  assert.equal(calls[0].signal.aborted, true)
  assert.equal((await old).kind, 'cancelled')
  f.emit('moveend')
  f.emit('zoomend')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2, 'one query per completed camera change')
  assert.deepEqual({ limit: calls[1].limit, offset: calls[1].offset },
    { limit: 100, offset: 0 })
  assert.equal(f.layers[0].data.features.length, 1)
  resolveOld({ ...page(), total_count: 100000, has_more: true })
  await Promise.resolve()
  assert.equal(f.layers[0].data.features.length, 1)
  bridge.dispose()
  assert.equal(f.layers.length, 0, 'unmount releases the native layer')
  f.emit('moveend')
  await Promise.resolve()
  assert.equal(calls.length, 2, 'unmounted map cannot launch a new Owner query')
})

test('A3 rejects unproven bounds and broken official namespace before Owner query', async () => {
  const f = fixture()
  let queries = 0
  const inputs = {
    map: f.map, namespace: f.namespace,
    trustedWGS84Bounds: async () => ({ coordinate_space: 'bd09', bounds }),
    listOwnerViewport: async () => { queries++; return page() },
    callbacks: { onOpenPlace() {} },
  }
  const bridge = compose(inputs)
  assert.equal((await bridge.refresh()).kind, 'invalid-bounds')
  assert.equal(queries, 0)
  assert.equal(f.layers[0].data, null)
  bridge.dispose()
  const naked = compose({
    ...inputs, trustedWGS84Bounds: async () => ({ ...bounds }),
  })
  assert.equal((await naked.refresh()).kind, 'invalid-bounds',
    'raw BMap.getBounds coordinates must not be relabeled as GPS')
  assert.equal(queries, 0, 'invalid coordinate frame cannot request Owner photos')
  naked.dispose()
  assert.throws(() => compose({ ...inputs, namespace: {} }),
    /baidu_jsapi4_composition_unavailable/)
  assert.throws(() => compose({ ...inputs, callbacks: {} }),
    /baidu_jsapi4_composition_unavailable/)
  assert.throws(() => compose({ ...inputs, trustedWGS84Bounds: undefined }),
    /baidu_jsapi4_composition_unavailable/)
  assert.throws(() => compose({
    ...inputs, get namespace() { throw Error('private credential must not leak') },
  }), error => error.message === 'baidu_jsapi4_composition_unavailable')
})

test('A3 shared native composition has NO SDK loader, AK, second API or runtime switch', () => {
  const code = read(compositionPath)
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  const web = read('web/src/mediaGalleryAdapter.ts')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const gallery = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 0/)
  assert.match(policy, /return ErrGateClosed/)
  assert.match(web, /api.mediaPlacesViewport/)
  assert.match(desktop, /getMediaPlacesViewport/)
  assert.match(gallery, /XDriveMediaGalleryBaiduStaticMap/)
  assert.doesNotMatch(gallery, /media-gallery-baidu-jsapi4-composition/)
  assert.doesNotMatch(code,
    /window\.BMap|new BMap\.|fetch\(|document\.createElement|BMAP_PROXY_URL|serviceHost|localStorage|indexedDB|new WebSocket/)
  assert.doesNotMatch(code, /\.getBounds\(/)
  assert.match(code, /xDriveBindBaiduJSAPI4NativeMap/)
  assert.match(code, /new XDriveBaiduJSAPI4OwnerViewportBridge/)
})
