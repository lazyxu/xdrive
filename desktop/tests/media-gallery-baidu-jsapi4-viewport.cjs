'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const read = relative => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8')
const names = {
  markers: 'ui/shared/src/media-gallery-baidu-jsapi4-markers.ts',
  layer: 'ui/shared/src/media-gallery-baidu-jsapi4-layer.ts',
  bridge: 'ui/shared/src/media-gallery-baidu-jsapi4-viewport.ts',
}
const source = Object.fromEntries(Object.entries(names).map(([name, filename]) => [name, read(filename)]))
function transpile(code, map) {
  const out = ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out)(
    module, module.exports, id => {
      if (!(id in map)) throw new Error('unexpected module: ' + id)
      return map[id]
    })
  return module.exports
}
const markers = transpile(source.markers, {})
const layer = transpile(source.layer, { './media-gallery-baidu-jsapi4-markers': markers })
const bridgeSource = transpile(source.bridge, { './media-gallery-baidu-jsapi4-layer': layer })
const { XDriveBaiduJSAPI4OwnerViewportBridge: Bridge,
  xDriveValidJSAPI4WGS84Bounds: validBounds } = bridgeSource

function page(n, total = n) {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: 'place:' + i + ':' + i, name: 'place' + i,
      latitude: 80, longitude: 80,
      sample_latitude: i / 100, sample_longitude: i / 100,
      coordinate_kind: 'grid_cell_center', item_count: 2,
    })),
    total_count: total, total_photo_count: total * 2, offset: 0,
    limit: 100, has_more: total > n,
  }
}
const wgs84 = { west: -5, south: -5, east: 5, north: 5 }
const photoWindow = bounds => ({ coordinate_space: 'photo-wgs84', bounds })
function mockRuntime() {
  const listeners = new Map()
  const layerListeners = new Map()
  const calls = []
  const nativeLayer = {
    frame: null, cleared: 0,
    setData(data) { this.frame = data; calls.push('setData') },
    clearData() { this.frame = null; this.cleared++; calls.push('clearData') },
    addEventListener(type, handler) { layerListeners.set(type, handler) },
    removeEventListener(type, handler) {
      assert.equal(layerListeners.get(type), handler)
      layerListeners.delete(type)
    },
  }
  const map = {
    removed: 0,
    addLayer(l) { assert.equal(l, nativeLayer) },
    removeLayer(l) { assert.equal(l, nativeLayer); this.removed++ },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      assert.equal(listeners.get(type)?.delete(handler), true)
    },
  }
  const emit = type => {
    for (const handler of [...(listeners.get(type) || [])]) handler()
  }
  const runtime = {
    map, convertor: {
      translate(points, from, to, callback) {
        assert.equal(from, 1)
        assert.equal(to, 5)
        callback({ status: 0, points: points.map(p => ({
          lng: p.lng + 0.001, lat: p.lat + 0.001,
        })) })
      },
    },
    createPoint: (lng, lat) => ({ lng, lat }),
    createClusterLayer(options) {
      assert.equal(options.fitViewOnClick, true)
      return nativeLayer
    },
  }
  return { map, runtime, layer: nativeLayer, emit, calls, listeners, layerListeners }
}

test('A3b3a3c validates strict WGS84, dateline and polar bounds without BD09 confusion', () => {
  assert.equal(validBounds(photoWindow(wgs84)), true)
  assert.equal(validBounds(photoWindow(
    { west: 170, south: -90, east: -170, north: 90 })), true)
  assert.equal(validBounds(photoWindow(
    { west: -180, south: -90, east: 180, north: 90 })), true)
  for (const value of [
    null, {}, wgs84, { ...wgs84, coordType: 'bd09' },
    { coordinate_space: 'bd09', bounds: wgs84 },
    { coordinate_space: 'gcj02', bounds: wgs84 },
    { ...photoWindow(wgs84), extra: 1 },
    { ...photoWindow(wgs84), bounds: null },
    photoWindow({ ...wgs84, west: NaN }),
    photoWindow({ ...wgs84, north: Infinity }),
    photoWindow({ ...wgs84, west: 181 }),
    photoWindow({ ...wgs84, south: -91 }),
    photoWindow({ ...wgs84, west: 0, east: 0 }),
    photoWindow({ ...wgs84, north: -5 }),
    photoWindow({ ...wgs84, ak: 'bad' }),
    photoWindow({ ...wgs84, callback: 'bad' }),
    photoWindow({ west: 180, south: -1, east: -180, north: 1 }),
  ]) assert.equal(validBounds(value), false, JSON.stringify(value))
})

test('A3b3a3c bounded authenticated Owner query feeds native layer and original Gallery selection', async () => {
  const c = mockRuntime()
  const opened = [], statuses = [], calls = []
  const bridge = new Bridge(c.runtime, async (bounds, limit, offset, signal) => {
    calls.push({ bounds, limit, offset, signal })
    return page(2)
  }, async () => photoWindow({ ...wgs84 }), {
    onOpenPlace: place => opened.push(place),
    onResult: result => statuses.push(result),
  })
  const got = await bridge.refresh()
  assert.deepEqual(got, { kind: 'rendered', cells: 2, photos: 4 })
  assert.deepEqual(statuses, [got])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].bounds, wgs84)
  assert.equal(calls[0].limit, 100)
  assert.equal(calls[0].offset, 0)
  assert.equal(calls[0].signal.aborted, false)
  assert.equal(c.layer.frame.features.length, 2)
  assert.deepEqual(c.layer.frame.features[0].geometry.coordinates, [0.001, 0.001])
  c.layerListeners.get('click')({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 2 } } })
  assert.deepEqual(opened, [page(2).items[0]])
  c.layerListeners.get('click')({ value: { isCluster: true, pointCount: 2,
    properties: { place_id: 'place:0:0', photo_count: 2 } } })
  assert.equal(opened.length, 1)
  bridge.dispose()
  assert.equal(c.map.removed, 1)
  assert.equal(c.layer.frame, null)
  assert.equal((await bridge.refresh()).kind, 'query-unavailable')
})

test('A3b3a3c future map movestart instantly aborts Server even if source ignores signal', async () => {
  const c = mockRuntime(), status = []
  let resolveOld, oldSignal
  let next = 0
  const bridge = new Bridge(c.runtime, async (_bounds, limit, offset, signal) => {
    assert.equal(limit, 100); assert.equal(offset, 0)
    next++
    if (next === 1) {
      oldSignal = signal
      return new Promise(resolve => { resolveOld = resolve })
    }
    return page(1)
  }, async () => photoWindow({ ...wgs84 }), {
    onOpenPlace() {},
    onResult: result => status.push(result.kind),
  })
  const old = bridge.refresh()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof resolveOld, 'function')
  c.emit('movestart')
  assert.equal(oldSignal.aborted, true, 'abort Server while pan begins, not after settle')
  assert.equal(c.layer.frame, null)
  assert.equal((await old).kind, 'cancelled', 'do not await uncooperative Server promise')
  c.emit('moveend')
  c.emit('zoomend')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(next, 2, 'two map settle events coalesce to one bounded request')
  assert.equal(c.layer.frame.features.length, 1)
  resolveOld(page(10))
  await Promise.resolve()
  assert.equal(c.layer.frame.features.length, 1, 'late obsolete Server response ignored')
  assert.deepEqual(status, ['rendered'])
  bridge.dispose()
})

test('A3b3a3c rejects malformed bounds without Server fetch or map data', async () => {
  const c = mockRuntime()
  let calls = 0
  const bridge = new Bridge(c.runtime, async () => { calls++; return page(1) },
    async () => photoWindow({ ...wgs84, east: NaN }), { onOpenPlace() {} })
  assert.equal((await bridge.refresh()).kind, 'invalid-bounds')
  assert.equal(calls, 0)
  assert.equal(c.layer.frame, null)
  bridge.dispose()
})

test('A3b3a3c 100k cells or mismatched total never reaches a fake full cluster', async () => {
  const c = mockRuntime()
  let response = page(2)
  const bridge = new Bridge(c.runtime, async () => response, async () => photoWindow(wgs84),
    { onOpenPlace() {} })
  assert.equal((await bridge.refresh()).kind, 'rendered')
  response = page(100, 100000)
  assert.deepEqual(await bridge.refresh(),
    { kind: 'incomplete', totalCells: 100000, totalPhotoCount: 200000 })
  assert.equal(c.layer.frame, null)
  response = { ...page(1), total_photo_count: 10000 }
  assert.equal((await bridge.refresh()).kind, 'invalid')
  assert.equal(c.layer.frame, null)
  bridge.dispose()
})

test('A3b3a3c bad Server/coordinate adapter and logout dispose fail closed', async () => {
  const c = mockRuntime()
  let open = 0, mode = 'reject'
  const bridge = new Bridge(c.runtime, async () => {
    if (mode === 'reject') throw Error('private Server URL/token not leaked')
    return page(1)
  }, async () => photoWindow(wgs84), { onOpenPlace() { open++ } })
  assert.equal((await bridge.refresh()).kind, 'query-unavailable')
  mode = 'ok'
  assert.equal((await bridge.refresh()).kind, 'rendered')
  const clears = c.layer.cleared
  c.emit('zoomstart')
  assert.equal(c.layer.frame, null)
  assert.ok(c.layer.cleared > clears)
  bridge.dispose()
  bridge.dispose()
  assert.equal(c.map.removed, 1)
  c.emit('zoomend')
  await Promise.resolve()
  assert.equal(open, 0)
})

test('A3b3a3c implementation only uses one shared Owner transport; no map runtime activation', () => {
  const web = read('web/src/mediaGalleryAdapter.ts')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const code = source.bridge
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  assert.match(web, /listPlacesViewport: \(bounds, limit = 64, offset = 0, signal\)/)
  assert.match(web, /api.mediaPlacesViewport\(bounds, limit, offset, signal\)/)
  assert.match(desktop, /agent.getMediaPlacesViewport\(bounds, limit, offset, requestID\)/)
  assert.match(desktop, /xDriveDesktopViewportRequest\(signal/)
  assert.match(code, /this.listOwnerViewport\(bounds, maxViewportCells, 0, request.signal\)/)
  assert.match(code, /this.native.applyAuthorizedViewport\(page, request.signal\)/)
  assert.doesNotMatch(code,
    /window\.BMap|BMAP_PROXY_URL|new BMap\.|document\.createElement|fetch\(|localStorage/)
  assert.doesNotMatch(code, /\.getBounds\(\)/,
    'Baidu BD09 bounds must not silently become WGS84 query bounds')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 0/)
  assert.match(policy, /return ErrGateClosed/)
})
