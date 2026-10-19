'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const code = fs.readFileSync(path.join(root,
  'ui/shared/src/media-gallery-baidu-jsapi4-bd09-photo.ts'), 'utf8')
const js = ts.transpileModule(code, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const mod = { exports: {} }
// C20 adds an optional verified CellOverlay for dense maps; A3c14 fixtures
// test raw <=100 ClusterLayer and must resolve the optional TS module without
// granting a signed runtime or constructing unreviewed SDK objects.
const optionalCells = {
  XDriveBaiduJSAPI4NativeCellOverlays: class {
    constructor() { throw new Error('A3c14 must not instantiate dense overlays') }
  },
  xDriveValidBaiduNativeCellsPage() { return false },
}
new Function('module', 'exports', 'require', js)(mod, mod.exports, id => {
  assert.equal(id, './media-gallery-baidu-jsapi4-cells')
  return optionalCells
})
const { xDrivePrepareBaiduNativePhotoWindow: prepare,
  XDriveBaiduJSAPI4NativePhotoController: Controller,
  XDriveBaiduJSAPI4IndexedViewportBridge: Bridge,
  XDRIVE_BAIDU_NATIVE_PHOTO_WINDOW_MAX: maxPhotos } = mod.exports

function page(n, total = n) {
  return { coordinate_space: 'bd09ll', index_scope: 'explicit_opt_in_only',
    total_count: total, limit: 100, offset: 0, has_more: total > n,
    items: Array.from({ length: n }, (_, i) => ({
      asset_id: i + 1, node_id: 101 + i, latitude: i / 100, longitude: i / 100,
    })),
  }
}
function fakeRuntime() {
  const listeners = new Map()
  const mapListeners = new Map()
  const calls = []
  const layer = {
    setData(data) { calls.push(['data', data]); this.data = data },
    clearData() { calls.push(['clear']); this.data = undefined },
    addEventListener(k, fn) { listeners.set(k, fn) },
    removeEventListener(k) { listeners.delete(k) },
  }
  const map = {
    addLayer(value) { assert.equal(value, layer); calls.push(['add']) },
    removeLayer(value) { assert.equal(value, layer); calls.push(['remove']) },
    addEventListener(k, fn) { mapListeners.set(k, fn) },
    removeEventListener(k) { mapListeners.delete(k) },
    getBounds() { return { getSouthWest() { return { lng: 116, lat: 39 } },
      getNorthEast() { return { lng: 117, lat: 41 } } } },
  }
  return { map, layer, listeners, mapListeners, calls,
    createClusterLayer(options) {
      assert.deepEqual(options, { clusterRadius: 60, enablePicked: true,
        fitViewOnClick: true, updateRealTime: false, idKey: 'id' })
      return layer
    },
  }
}

test('BD09 page preserves 0/0, exact Asset/Node IDs, and official GeoJSON coordinates', () => {
  const p = page(2)
  const result = prepare(p)
  assert.equal(maxPhotos, 100)
  assert.equal(result.kind, 'ready')
  assert.equal(result.count, 2)
  assert.deepEqual(result.collection.features[0], {
    type: 'Feature', id: 'asset:1',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { asset_id: 1, node_id: 101 },
  })
  assert.deepEqual(result.identities.get(1), { assetID: 1, nodeID: 101 })
  assert.equal(prepare(page(100)).kind, 'ready')
  assert.equal(prepare(page(0)).kind, 'ready')
})

test('A3c14 never fabricates a complete cluster from 100k indexed photos', () => {
  assert.deepEqual(prepare(page(100, 100000)),
    { kind: 'incomplete', totalPhotos: 100000 })
  assert.equal(prepare({ ...page(2), offset: 50 }).kind, 'incomplete')
  assert.equal(prepare(page(101)).kind, 'invalid')
  assert.equal(prepare({ ...page(2), has_more: true }).kind, 'invalid')
  assert.equal(prepare({ ...page(2), total_count: 3, has_more: false }).kind, 'invalid')
})

test('A3c14 rejects forged CRS, opt-in scope, unsafe IDs, duplicates, and bad GPS', () => {
  const p = page(2)
  for (const [name, value] of [
    ['asset_id', 0], ['asset_id', Number.MAX_SAFE_INTEGER + 1],
    ['node_id', -1], ['node_id', NaN], ['latitude', NaN],
    ['longitude', Infinity], ['latitude', 91], ['longitude', -181],
  ]) {
    const invalid = page(2)
    invalid.items[0] = { ...invalid.items[0], [name]: value }
    assert.equal(prepare(invalid).kind, 'invalid', name)
  }
  assert.equal(prepare({ ...p, coordinate_space: 'photo-wgs84' }).kind, 'invalid')
  assert.equal(prepare({ ...p, index_scope: 'all' }).kind, 'invalid')
  assert.equal(prepare({ ...p, limit: 101 }).kind, 'invalid')
  assert.equal(prepare({ ...p, items: [p.items[0], p.items[0]] }).kind, 'invalid')
  assert.equal(prepare({ ...p, items: [p.items[0], { ...p.items[1], node_id: 101 }] }).kind, 'invalid')
  assert.equal(prepare({ ...page(1), items: [{ ...p.items[0], latitude: 86 }] }).kind,
    'out-of-map-range')
  const controller = new AbortController()
  controller.abort()
  assert.equal(prepare(p, controller.signal).kind, 'cancelled')
})

test('A3c14 native ClusterLayer opens only a current, exact Server identity', () => {
  const rt = fakeRuntime()
  const seen = []
  const controller = new Controller(rt, { onOpenPhoto(value) { seen.push(value) },
    onViewportInvalidated() {} })
  assert.deepEqual(controller.applyOwnerBD09Page(page(2)), { kind: 'rendered', photos: 2 })
  const click = rt.listeners.get('click')
  click({ value: { isCluster: false, pointCount: 1,
    properties: { asset_id: 1, node_id: 101 } } })
  assert.deepEqual(seen, [{ assetID: 1, nodeID: 101 }])
  click({ value: { isCluster: false, pointCount: 1,
    properties: { asset_id: 1, node_id: 999 } } })
  click({ value: { isCluster: true, pointCount: 2,
    properties: { asset_id: 1, node_id: 101 } } })
  assert.equal(seen.length, 1)
  rt.mapListeners.get('movestart')()
  assert.equal(rt.layer.data, undefined)
  click({ value: { isCluster: false, pointCount: 1,
    properties: { asset_id: 1, node_id: 101 } } })
  assert.equal(seen.length, 1)
  assert.deepEqual(controller.applyOwnerBD09Page(page(100, 100000)),
    { kind: 'incomplete', totalPhotos: 100000 })
  assert.equal(rt.layer.data, undefined)
  controller.dispose()
  assert.deepEqual(rt.calls.at(-1), ['remove'])
  assert.deepEqual(controller.applyOwnerBD09Page(page(1)), { kind: 'unavailable' })
})

test('A3c14 native pan immediately cancels in-flight Owner API and ignores late pages', async () => {
  const rt = fakeRuntime()
  let currentSignal, resolveLate
  const bridge = new Bridge(rt, (_bounds, _limit, _offset, signal) => {
    currentSignal = signal
    return new Promise(resolve => { resolveLate = resolve })
  }, { onOpenPhoto() {}, onViewportInvalidated() {} })
  const pending = bridge.refresh()
  assert.equal(currentSignal.aborted, false)
  rt.mapListeners.get('movestart')()
  assert.equal(currentSignal.aborted, true)
  assert.deepEqual(await pending, { kind: 'cancelled' })
  resolveLate(page(1))
  await Promise.resolve()
  assert.equal(rt.layer.data, undefined)
  bridge.dispose()
})

test('A3c14 BD09 map bounds are never mislabeled WGS84 and invalid bounds do not query', async () => {
  const rt = fakeRuntime()
  let count = 0
  const bridge = new Bridge(rt, async (bounds, limit, offset) => {
    count++
    assert.deepEqual(bounds, { coordinate_space: 'bd09ll',
      west: 116, south: 39, east: 117, north: 41 })
    assert.equal(limit, 100)
    assert.equal(offset, 0)
    return page(1)
  }, { onOpenPhoto() {}, onViewportInvalidated() {} })
  assert.deepEqual(await bridge.refresh(), { kind: 'rendered', photos: 1 })
  assert.equal(count, 1)
  bridge.dispose()
  const broken = fakeRuntime()
  broken.map.getBounds = () => ({
    getSouthWest: () => ({ lng: Infinity, lat: 0 }),
    getNorthEast: () => ({ lng: 1, lat: 1 }),
  })
  const missing = new Bridge(broken, async () => { throw Error('must not query') },
    { onOpenPhoto() {}, onViewportInvalidated() {} })
  assert.deepEqual(await missing.refresh(), { kind: 'invalid-bounds' })
  missing.dispose()
})

test('A3c14 no provider credential, second basemap, or unauthorized SDK load', () => {
  const policy = fs.readFileSync(path.join(root,
    'internal/baidumapjsapi/resource_policy.go'), 'utf8')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(policy, /return ErrGateClosed/)
  assert.doesNotMatch(code, /api\.map\.baidu\.com|BMAP_PROXY_URL|new BMap\.|fetch\(|localStorage/)
})
