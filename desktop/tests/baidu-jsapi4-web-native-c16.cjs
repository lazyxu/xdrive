'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const loader = read('ui/shared/src/media-gallery-baidu-jsapi4-browser-loader.ts')
const compiled = ts.transpileModule(loader, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled)(mod, mod.exports, () => {
  throw new Error('same-origin provider must not have runtime dependencies')
})
const createIndexed = mod.exports.xDriveCreateBaiduJSAPI4IndexedBD09Mount
const camera = { latitude: 39.9, longitude: 116.4, zoom: 12 }
const originalDoc = global.document

function fixture(uri) {
  const scripts = []
  const created = []
  const browser = { location: new URL(uri) }
  const doc = {
    defaultView: browser,
    head: { appendChild(script) { scripts.push(script) } },
    createElement(tag) {
      assert.equal(tag, 'script')
      return { remove() { this.removed = true } }
    },
  }
  const container = { ownerDocument: doc }
  function install() {
    class Point { constructor(lng, lat) { this.lng = lng; this.lat = lat } }
    class Map {
      constructor(element) { assert.equal(element, container); created.push(this) }
      centerAndZoom(point, zoom) { this.point = point; this.zoom = zoom }
      destroy() { this.destroyed = true }
      getBounds() { return { getSouthWest: () => new Point(116, 39),
        getNorthEast: () => new Point(117, 41) } }
      addLayer() {}
      removeLayer() {}
      addEventListener() {}
      removeEventListener() {}
    }
    class Convertor { translate(points, from, to, callback) {
      assert.equal(from, 1)
      assert.equal(to, 5)
      callback({ status: 0, points: points.map(p => new Point(p.lng + 0.01, p.lat + 0.01)) })
    } }
    browser.BMap = { Point, Map, Convertor, ClusterLayer: class {} }
  }
  return { doc, browser, container, scripts, created, install }
}
test.after(() => {
  if (originalDoc === undefined) delete global.document
  else global.document = originalDoc
})
const tick = () => new Promise(resolve => setImmediate(resolve))

test('C16 real BMap SDK is requested ONLY after an authenticated map Cookie grant', async () => {
  const f = fixture('https://gallery.example/')
  global.document = f.doc
  let finish, calls = 0
  const port = createIndexed({ mintMapOnlySession: async signal => {
    assert.equal(signal.aborted, false)
    calls++
    return new Promise(resolve => { finish = resolve })
  } })
  const pending = port.acquire(f.container, new AbortController().signal, camera)
  await tick()
  assert.equal(calls, 1)
  assert.equal(f.scripts.length, 0, 'no script without a Server map session')
  finish({ provider: 'baidu-jsapi-4.0', runtime_enabled: true })
  await tick()
  assert.equal(f.scripts.length, 1)
  assert.equal(f.scripts[0].src, 'https://gallery.example/_BMapService/api?v=4.0')
  assert.deepEqual(f.browser._BMapSecurityConfig,
    { serviceHost: 'https://gallery.example/_BMapService/' })
  assert.doesNotMatch(f.scripts[0].src, /[?&](?:ak|token)=/)
  f.install()
  f.scripts[0].onload()
  const native = await pending
  assert.equal(native.map, f.created[0])
  assert.equal(native.namespace, f.browser.BMap)
  assert.equal(typeof native.trustedWGS84Bounds, 'undefined')
  assert.ok(Math.abs(f.created[0].point.lng - 116.41) < 1e-9)
  assert.ok(Math.abs(f.created[0].point.lat - 39.91) < 1e-9)
  native.dispose()
  assert.equal(f.created[0].destroyed, true)
})
test('C16 denied release, insecure origins, stale Owner and abort never load JSAPI', async () => {
  for (const uri of ['file:///app/index.html', 'http://gallery.example/', 'https://other.example/']) {
    const f = fixture(uri)
    global.document = f.doc
    const abort = new AbortController()
    if (uri.includes('other')) abort.abort()
    await assert.rejects(createIndexed({ mintMapOnlySession: async () => ({
      provider: 'baidu-jsapi-4.0', runtime_enabled: true,
    }) }).acquire(f.container, abort.signal, camera), /baidu_jsapi4_not_authorized/)
    assert.equal(f.scripts.length, 0)
  }
  const f = fixture('https://denied.example/')
  global.document = f.doc
  await assert.rejects(createIndexed({ mintMapOnlySession: async () => ({
    provider: 'baidu-jsapi-4.0', runtime_enabled: false,
  }) }).acquire(f.container, new AbortController().signal, camera),
  /baidu_jsapi4_not_authorized/)
  assert.equal(f.scripts.length, 0)
})
test('C16 Web and Mobile share isolated Ticket/Owner Range while Desktop file remains denied', () => {
  const api = read('web/src/api.ts')
  const web = read('web/src/mediaGalleryAdapter.ts')
  const port = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const places = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const host = read('ui/shared/src/media-gallery-baidu-isolated-frame-host.ts')
  const child = read('deploy/baidu-isolated-child/child.js')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  assert.match(api, /mediaBaiduJSAPI4Status\(/)
  assert.match(api, /mediaBaiduJSAPI4Session\(/)
  assert.match(api, /credentials: 'same-origin'/)
  assert.match(api, /\/api\/v1\/media\/places\/baidu-jsapi\/session/)
  assert.match(web, /getBaiduJSAPI4Status/)
  assert.match(web, /mintBaiduJSAPI4Session/)
  assert.match(port, /listBaiduNativeViewport/)
  assert.match(gallery, /onOpenBaiduNativePhoto/)
  assert.match(gallery, /anchor_node_id: identity\.nodeID/)
  assert.match(places, /authorized_signed_release/)
  assert.match(api, /mediaBaiduIsolatedChildTicket\(/)
  assert.match(web, /mintBaiduIsolatedChildTicket/)
  assert.match(port, /mintBaiduIsolatedChildTicket/)
  assert.match(places, /XDriveMediaGalleryBaiduIsolatedPhotoSurface/)
  assert.doesNotMatch(places, /XDriveMediaGalleryBaiduJSAPI4PhotoSurface|XDriveMediaGalleryBaiduJSAPI4Surface/)
  assert.match(surface, /xDriveMountBaiduIsolatedFrame/)
  assert.match(surface, /xDriveSelectBaiduNativeCell\(page,bounds,cell\)/)
  assert.match(surface, /listOwnerCells\(bounds,request\.signal\)/)
  assert.match(host, /onActivateCell\(ownerSelection\.get\(event\.key\)!\)/)
  assert.match(child, /script\.src = '\/_BMapService\/api\?v=4\.0'/)
  assert.doesNotMatch(surface, /loadThumbnail|window\.BMap|BMapLoader|\bfetch\(/)
  assert.doesNotMatch(desktop, /mintBaiduIsolatedChildTicket:/)
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(policy, /return ErrGateClosed/)
})

test('C16 aborted late SDK and post-grant failure release native Map/ClusterLayer', () => {
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  assert.match(surface, /if \(!active \|\| pending\.signal\.aborted\) \{\s*\/\/[\s\S]*?native\.dispose\(\)/)
  assert.match(surface, /bridge\?\.dispose\(\)\s*bridge = null\s*latestBridge\.current = null\s*native\?\.dispose\(\)\s*native = null/)
  assert.match(surface, /pending\.abort\(\)/)
  assert.match(surface, /bridge\?\.dispose\(\)\s*latestBridge\.current = null\s*native\?\.dispose\(\)/)
})
