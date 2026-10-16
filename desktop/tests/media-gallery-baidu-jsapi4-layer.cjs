'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const markerSource = read('ui/shared/src/media-gallery-baidu-jsapi4-markers.ts')
const layerSource = read('ui/shared/src/media-gallery-baidu-jsapi4-layer.ts')

function loadTypeScript(code, requireModule) {
  const compiled = ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(
    module, module.exports, requireModule || (() => { throw Error('not expected') }))
  return module.exports
}

const markers = loadTypeScript(markerSource)
const { XDriveBaiduJSAPI4ClusterController: Controller } =
  loadTypeScript(layerSource, name => {
    if (name !== './media-gallery-baidu-jsapi4-markers') throw Error('unexpected dependency')
    return markers
  })

function page(n, total = n) {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: 'place:' + i + ':' + i,
      latitude: 80, longitude: 100,
      sample_latitude: i / 100, sample_longitude: i / 100,
      coordinate_kind: 'grid_cell_center', item_count: 2, name: 'cell ' + i,
    })),
    offset: 0, limit: 100, has_more: total > n,
    total_count: total, total_photo_count: total * 2,
  }
}

function fixture(converter) {
  const calls = []
  const mapEvents = new Map()
  const layerEvents = new Map()
  const singleMockLayer = {
    frames: [], clears: 0,
    setData(d) { this.frames.push(d) },
    clearData() { this.clears++; this.frames = [] },
    addEventListener(name, fn) { layerEvents.set(name, fn) },
    removeEventListener(name, fn) {
      assert.equal(layerEvents.get(name), fn)
      layerEvents.delete(name)
    },
  }
  const map = {
    removed: 0,
    addLayer(layer) { calls.push('addLayer'); assert.equal(layer, singleMockLayer) },
    removeLayer(layer) { calls.push('removeLayer'); assert.equal(layer, singleMockLayer); this.removed++ },
    addEventListener(name, fn) { mapEvents.set(name, fn) },
    removeEventListener(name, fn) {
      assert.equal(mapEvents.get(name), fn)
      mapEvents.delete(name)
    },
  }
  const convertor = converter ?? {
    translate(points, from, to, cb) {
      calls.push('translate:' + from + ':' + to + ':' + points.length)
      cb({ status: 0,
        points: points.map(p => ({ lng: p.lng + 0.001, lat: p.lat + 0.001 })) })
    },
  }
  const runtime = {
    map, convertor, createPoint: (lng, lat) => ({ lng, lat }),
    createClusterLayer(options) {
      calls.push({ options })
      return singleMockLayer
    },
  }
  return { runtime, map, layer: singleMockLayer, mapEvents, layerEvents, calls }
}

test('A3b3a3b only official ClusterLayer with one session-owned map is injected', async () => {
  const ctx = fixture()
  const opened = []
  const invalidations = []
  const controller = new Controller(ctx.runtime, {
    onOpenPlace: place => opened.push(place),
    onViewportInvalidated: () => invalidations.push(true),
  })
  assert.deepEqual(ctx.calls[0].options, {
    clusterRadius: 60, enablePicked: true, fitViewOnClick: true,
    updateRealTime: false, idKey: 'id',
  })
  assert.equal(ctx.calls[1], 'addLayer')
  assert.deepEqual([...ctx.mapEvents.keys()],
    ['movestart', 'zoomstart', 'moveend', 'zoomend'])
  assert.deepEqual([...ctx.layerEvents.keys()], ['click'])
  const current = page(3)
  const result = await controller.applyAuthorizedViewport(current)
  assert.deepEqual(result, { kind: 'rendered', cells: 3, photos: 6 })
  assert.equal(ctx.layer.frames.length, 1)
  assert.equal(ctx.layer.frames[0].features.length, 3)
  assert.deepEqual(ctx.layer.frames[0].features[0].geometry.coordinates,
    [0.001, 0.001], 'WGS84 was only translated with official converter')
  assert.ok(ctx.calls.includes('translate:1:5:3'))

  const click = ctx.layerEvents.get('click')
  click({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 2 } } })
  assert.deepEqual(opened, [current.items[0]], 'only canonical Server cell is opened')

  click({ value: { isCluster: true, pointCount: 3,
    properties: { place_id: 'place:0:0', photo_count: 2 } } })
  click({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:999:999', photo_count: 2 } } })
  click({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 999 } } })
  click({ value: { isCluster: false, pointCount: 2,
    properties: { place_id: 'place:0:0', photo_count: 2 } } })
  assert.equal(opened.length, 1, 'clusters, forged and partial events never open arbitrary photos')
  assert.equal(invalidations.length, 0)

  controller.dispose()
  assert.equal(ctx.map.removed, 1)
  assert.deepEqual([...ctx.mapEvents.keys()], [])
  assert.deepEqual([...ctx.layerEvents.keys()], [])
  assert.equal(ctx.layer.frames.length, 0)
  controller.dispose()
  assert.equal(ctx.map.removed, 1, 'idempotent disposal')
})

test('A3b3a3b 100k or incomplete view never feeds native cluster', async () => {
  const ctx = fixture()
  const c = new Controller(ctx.runtime, {
    onOpenPlace() { throw Error('unexpected selection') },
    onViewportInvalidated() {},
  })
  const ok = await c.applyAuthorizedViewport(page(2))
  assert.equal(ok.kind, 'rendered')
  const incomplete = await c.applyAuthorizedViewport(page(100, 100000))
  assert.deepEqual(incomplete,
    { kind: 'incomplete', totalCells: 100000, totalPhotoCount: 200000 })
  assert.equal(ctx.layer.frames.length, 0, 'remove stale successful cluster on incomplete view')
  assert.equal(ctx.calls.filter(x => typeof x === 'string' &&
    x.startsWith('translate:')).length, 1)
  assert.equal((await c.applyAuthorizedViewport({ ...page(1), total_photo_count: 1 })).kind,
    'invalid')
  assert.equal(ctx.layer.frames.length, 0)
  c.dispose()
})

test('A3b3a3b map move/zoom synchronously aborts; invalidation is coalesced', async () => {
  let callback
  const ctx = fixture({
    translate(_points, _from, _to, cb) { callback = cb },
  })
  let changed = 0
  const opened = []
  const c = new Controller(ctx.runtime, {
    onOpenPlace(place) { opened.push(place) },
    onViewportInvalidated() { changed++ },
  })
  const pending = c.applyAuthorizedViewport(page(1))
  assert.equal(typeof callback, 'function')
  ctx.mapEvents.get('movestart')()
  assert.equal(ctx.layer.frames.length, 0, 'cancel immediately at drag start')
  ctx.mapEvents.get('zoomstart')()
  ctx.mapEvents.get('moveend')()
  ctx.mapEvents.get('zoomend')()
  assert.equal(ctx.layer.frames.length, 0)
  callback({ status: 0, points: [{ lng: 1, lat: 1 }] })
  assert.equal((await pending).kind, 'cancelled')
  await Promise.resolve()
  assert.equal(changed, 1, 'moveend+zoomend in one microtask tick send one viewport invalidation')
  ctx.layerEvents.get('click')({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 2 } } })
  assert.deepEqual(opened, [], 'no stale click after pan')
  c.dispose()
  ctx.mapEvents.get('moveend')?.()
  await Promise.resolve()
  assert.equal(changed, 1)
})

test('A3b3a3b second Owner window cancels previous and refuses late writes', async () => {
  let first
  let invocations = 0
  const ctx = fixture({
    translate(points, _from, _to, cb) {
      invocations++
      if (invocations === 1) { first = cb; return }
      cb({ status: 0, points: points.map(p => ({ lng: p.lng, lat: p.lat })) })
    },
  })
  const c = new Controller(ctx.runtime, {
    onOpenPlace() {},
    onViewportInvalidated() {},
  })
  const old = c.applyAuthorizedViewport(page(1))
  const newer = c.applyAuthorizedViewport(page(2))
  assert.equal((await newer).kind, 'rendered')
  assert.equal((await old).kind, 'cancelled')
  first({ status: 0, points: [{ lng: 10, lat: 10 }] })
  await Promise.resolve()
  assert.equal(ctx.layer.frames.length, 1)
  assert.equal(ctx.layer.frames[0].features.length, 2)
  const abort = new AbortController()
  abort.abort()
  assert.equal((await c.applyAuthorizedViewport(page(1), abort.signal)).kind, 'cancelled')
  assert.equal(ctx.layer.frames.length, 0, 'aborted viewport clears old map')
  c.dispose()
  assert.equal((await c.applyAuthorizedViewport(page(1))).kind, 'unavailable')
})

test('A3b3a3b conversion errors and native setData errors clear all layers', async () => {
  const ctx = fixture({ translate(points, f, t, cb) {
    cb({ status: 1, points: points.slice(0, 1) })
  } })
  const c = new Controller(ctx.runtime, {
    onOpenPlace() {},
    onViewportInvalidated() {},
  })
  assert.equal((await c.applyAuthorizedViewport(page(1))).kind, 'unavailable')
  assert.equal(ctx.layer.frames.length, 0)
  c.dispose()

  const ctx2 = fixture()
  ctx2.layer.setData = () => { throw new Error('forbidden raw upstream text') }
  const c2 = new Controller(ctx2.runtime, {
    onOpenPlace() {},
    onViewportInvalidated() {},
  })
  assert.equal((await c2.applyAuthorizedViewport(page(1))).kind, 'unavailable')
  assert.equal(ctx2.layer.frames.length, 0)
  c2.dispose()
})

test('A3b3a3b reentrant official layer update cannot resurrect canceled marks', async () => {
  const ctx = fixture()
  const opened = []
  const c = new Controller(ctx.runtime, {
    onOpenPlace(place) { opened.push(place) },
    onViewportInvalidated() {},
  })
  const baseSetData = ctx.layer.setData.bind(ctx.layer)
  ctx.layer.setData = frame => {
    baseSetData(frame)
    ctx.mapEvents.get('movestart')()
  }
  const result = await c.applyAuthorizedViewport(page(1))
  assert.equal(result.kind, 'cancelled')
  assert.equal(ctx.layer.frames.length, 0)
  ctx.layerEvents.get('click')({ value: { isCluster: false, pointCount: 1,
    properties: { place_id: 'place:0:0', photo_count: 2 } } })
  assert.deepEqual(opened, [])
  c.dispose()
})

test('A3b3a3b no unlicensed loader, unsafe BD09->WGS84 bbox or alternate Provider', () => {
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  const shared = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const web = read('web/src/mediaGalleryAdapter.ts')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 0/)
  assert.match(policy, /return ErrGateClosed/)
  assert.match(shared, /<XDriveMediaGalleryBaiduStaticMap/)
  assert.match(shared, /listPlacesViewport/)
  assert.match(web, /api.mediaPlacesViewport/)
  assert.match(desktop, /getMediaPlacesViewport/)
  assert.doesNotMatch(layerSource,
    /BMAP_PROXY_URL|serviceHost|new BMap\.|window\.BMap|document\.createElement|fetch\(|localStorage/)
  assert.doesNotMatch(layerSource, /getBounds\(\)/,
    'BD09 bounds must never be assumed to be source WGS84 bounds')
  assert.ok(layerSource.includes("onViewportInvalidated"))
})
