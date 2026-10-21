'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = path.join(root,
  'ui/shared/src/media-gallery-baidu-jsapi4-browser-loader.ts')
const source = fs.readFileSync(file, 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const holder = { exports: {} }
new Function('module', 'exports', 'require', js)(holder, holder.exports, () => {
  throw new Error('production browser loader must have no runtime dependencies')
})
const createPort = holder.exports.xDriveCreateBaiduJSAPI4SameOriginMount
const camera = { latitude: 39.9, longitude: 116.4, zoom: 12 }
const approved = { provider: 'baidu-jsapi-4.0', runtime_enabled: true }
const envelope = { coordinate_space: 'photo-wgs84',
  bounds: { west: 115, east: 117, south: 39, north: 41 } }
const originalDocument = global.document

function fixture(url = 'https://xdrive.example/') {
  const location = new URL(url)
  const requests = []
  const maps = []
  const browser = { location }
  const doc = {
    defaultView: browser,
    createElement(tag) {
      assert.equal(tag, 'script')
      return {
        remove() { this.removed = true },
      }
    },
    head: {
      appendChild(script) {
        requests.push(script)
      },
    },
  }
  const container = { ownerDocument: doc }
  function installSDK() {
    class Point {
      constructor(lng, lat) { this.lng = lng; this.lat = lat }
    }
    class Map {
      constructor(node) {
        assert.equal(node, container)
        maps.push(this)
      }
      centerAndZoom(point, zoom) { this.point = point; this.zoom = zoom }
      destroy() { this.destroyed = true }
    }
    class Convertor {
      translate(points, from, to, callback) {
        assert.equal(from, 1, 'original GPS must be WGS84')
        assert.equal(to, 5, 'Baidu native Map must receive BD-09')
        assert.deepEqual([points[0].lng, points[0].lat], [116.4, 39.9])
        callback({ status: 0, points: [new Point(116.42, 39.91)] })
      }
    }
    browser.BMap = { Point, Map, Convertor, ClusterLayer: class {} }
  }
  return { browser, doc, container, requests, maps, installSDK }
}
function makeOptions(grant) {
  return {
    mintMapOnlySession: grant,
    trustedWGS84Bounds: async () => envelope,
  }
}
const later = () => new Promise(resolve => setImmediate(resolve))
test.after(() => {
  if (originalDocument === undefined) delete global.document
  else global.document = originalDocument
})

test('real same-origin JSAPI4 load requests only fixed SDK URL AFTER Owner session', async () => {
  const f = fixture()
  global.document = f.doc
  let admit
  const calls = []
  const port = createPort(makeOptions(signal => {
    assert.equal(signal.aborted, false)
    calls.push('session')
    return new Promise(resolve => { admit = resolve })
  }))
  const controller = new AbortController()
  const pending = port.acquire(f.container, controller.signal, camera)
  await later()
  assert.deepEqual(calls, ['session'])
  assert.equal(f.requests.length, 0, 'no map child before real session')
  admit(approved)
  await later()
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].src,
    'https://xdrive.example/_BMapService/api?v=4.0')
  assert.equal(f.requests[0].referrerPolicy, 'no-referrer')
  assert.deepEqual(f.browser._BMapSecurityConfig,
    { serviceHost: 'https://xdrive.example/_BMapService/' })
  assert.doesNotMatch(f.requests[0].src, /[?&](?:ak|token)=/)
  f.installSDK()
  f.requests[0].onload()
  const mounted = await pending
  assert.equal(mounted.namespace, f.browser.BMap)
  assert.deepEqual(await mounted.trustedWGS84Bounds(new AbortController().signal), envelope)
  assert.equal(f.maps.length, 1)
  assert.equal(f.maps[0].zoom, 12)
  assert.deepEqual([f.maps[0].point.lng, f.maps[0].point.lat], [116.42, 39.91])
  mounted.dispose()
  assert.equal(f.maps[0].destroyed, true)
})

test('untrusted file: or http: origins cannot mint or run a map session', async () => {
  for (const url of ['file:///app/index.html', 'http://xdrive.example/']) {
    const f = fixture(url)
    global.document = f.doc
    let sessions = 0
    const port = createPort(makeOptions(async () => {
      sessions++
      return approved
    }))
    await assert.rejects(port.acquire(f.container,
      new AbortController().signal, camera), /baidu_jsapi4_not_authorized/)
    assert.equal(sessions, 0)
    assert.equal(f.requests.length, 0)
  }
})

test('denied Server session and pre-abort never create an external script', async () => {
  const f = fixture()
  global.document = f.doc
  const bad = createPort(makeOptions(async () => ({
    provider: 'baidu-jsapi-4.0', runtime_enabled: false,
  })))
  await assert.rejects(bad.acquire(f.container,
    new AbortController().signal, camera))
  assert.equal(f.requests.length, 0)
  const controller = new AbortController()
  controller.abort()
  const cancelled = createPort(makeOptions(async () => {
    throw new Error('should never execute after abort')
  }))
  await assert.rejects(cancelled.acquire(f.container, controller.signal, camera))
  assert.equal(f.requests.length, 0)
})

test('aborted session settles before uncooperative delayed grant', async () => {
  const f = fixture()
  global.document = f.doc
  let admit
  const port = createPort(makeOptions(
    () => new Promise(resolve => { admit = resolve })))
  const controller = new AbortController()
  const pending = port.acquire(f.container, controller.signal, camera)
  await later()
  controller.abort()
  await assert.rejects(pending, /baidu_jsapi4_not_authorized/)
  admit(approved)
  await later()
  assert.equal(f.requests.length, 0)
})

test('simultaneous approved consumers use one fixed JSAPI script', async () => {
  const f = fixture()
  global.document = f.doc
  const port = createPort(makeOptions(async () => approved))
  const first = port.acquire(f.container, new AbortController().signal, camera)
  const second = port.acquire(f.container, new AbortController().signal, camera)
  await later()
  assert.equal(f.requests.length, 1)
  f.installSDK()
  f.requests[0].onload()
  const [one, two] = await Promise.all([first, second])
  assert.equal(f.maps.length, 2)
  one.dispose()
  two.dispose()
  assert.equal(f.maps.filter(x => x.destroyed).length, 2)
})

test('failed script and mismatched pre-existing serviceHost fail closed', async () => {
  const f = fixture()
  global.document = f.doc
  const port = createPort(makeOptions(async () => approved))
  const pending = port.acquire(f.container, new AbortController().signal, camera)
  await later()
  f.requests[0].onerror()
  await assert.rejects(pending)
  assert.equal(f.requests[0].removed, true)
  assert.equal(f.browser._BMapSecurityConfig, undefined)
  const conflicting = fixture()
  global.document = conflicting.doc
  conflicting.browser._BMapSecurityConfig = {
    serviceHost: 'https://attacker.example/_BMapService/',
  }
  const secondPort = createPort(makeOptions(async () => approved))
  await assert.rejects(secondPort.acquire(conflicting.container,
    new AbortController().signal, camera))
  assert.equal(conflicting.requests.length, 0)
})


test('A3c22 aborting one consumer preserves the other; last abort cancels the script immediately', async () => {
  const f = fixture('https://c22.example/')
  global.document = f.doc
  const port = createPort(makeOptions(async () => approved))
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  const first = port.acquire(f.container, firstAbort.signal, camera)
  const second = port.acquire(f.container, secondAbort.signal, camera)
  await later()
  assert.equal(f.requests.length, 1, 'one shared script for two Owner sessions')
  const obsolete = f.requests[0]
  const staleOnload = obsolete.onload
  firstAbort.abort()
  await assert.rejects(first, /baidu_jsapi4_not_authorized/)
  assert.notEqual(obsolete.removed, true, 'second consumer still owns script')
  secondAbort.abort()
  await assert.rejects(second, /baidu_jsapi4_not_authorized/)
  await later()
  assert.equal(obsolete.removed, true, 'last abort must remove the script')
  assert.equal(obsolete.onload, null, 'stale onload callback disarmed')
  assert.equal(f.browser._BMapSecurityConfig, undefined)
  f.installSDK()
  staleOnload()
  const retry = port.acquire(f.container, new AbortController().signal, camera)
  await later()
  assert.equal(f.requests.length, 2, 'fresh signed session starts a fresh script')
  f.requests[1].onload()
  const mounted = await retry
  assert.equal(f.maps.length, 1)
  mounted.dispose()
})

test('A3c22 a script without onload/onerror expires and can be retried', async () => {
  const f = fixture('https://never-loads.example/')
  global.document = f.doc
  const port = createPort(makeOptions(async () => approved))
  const realSetTimeout = global.setTimeout
  const realClearTimeout = global.clearTimeout
  const scheduled = []
  global.setTimeout = (fn, duration, ...args) => {
    if (duration === 7_500) {
      const task = { fn, cancelled: false }
      scheduled.push(task)
      return task
    }
    return realSetTimeout(fn, duration, ...args)
  }
  global.clearTimeout = token => {
    if (scheduled.includes(token)) token.cancelled = true
    else realClearTimeout(token)
  }
  try {
    const first = port.acquire(f.container, new AbortController().signal, camera)
    await later()
    assert.equal(f.requests.length, 1)
    assert.equal(scheduled.length, 1)
    assert.equal(scheduled[0].cancelled, false)
    // Fire the REAL bounded 7.5s bootstrap timeout, before Gallery's 8s deadline.
    // not an old source regex or an invented authorized SDK.
    scheduled[0].fn()
    await assert.rejects(first, /baidu_jsapi4_not_authorized/)
    await later()
    assert.equal(f.requests[0].removed, true)
    assert.equal(f.browser._BMapSecurityConfig, undefined)
    const second = port.acquire(f.container, new AbortController().signal, camera)
    await later()
    assert.equal(f.requests.length, 2)
    f.installSDK()
    f.requests[1].onload()
    const mounted = await second
    assert.equal(f.maps.length, 1)
    assert.equal(scheduled[1].cancelled, true, 'successful load clears its timer')
    mounted.dispose()
  } finally {
    global.setTimeout = realSetTimeout
    global.clearTimeout = realClearTimeout
  }
})

test('static contract: only Baidu, original WGS84, no browser AK or alternate map source', () => {
  for (const value of [
    '/_BMapService/api?v=4.0', 'mintMapOnlySession(signal)',
    'translate([original], 1, 5', 'trustedWGS84Bounds',
    "browser.location.protocol !== 'https:'",
  ]) assert.ok(source.includes(value), value)
  assert.doesNotMatch(source,
    /api\.map\.baidu\.com|googleapis|openstreetmap|mapbox|[?&]ak=|localStorage|sessionStorage/)
  const current = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'), 'utf8')
  assert.match(current, /XDriveMediaGalleryBaiduStaticMap/)
  assert.match(current, /authorizedJSAPI4Runtime/)
  for (const platform of [
    'web/src/mediaGalleryAdapter.ts',
    'desktop/src/renderer/mediaGalleryAdapter.ts',
  ]) assert.match(fs.readFileSync(path.join(root, platform), 'utf8'),
    /listPlacesViewport/)
})
