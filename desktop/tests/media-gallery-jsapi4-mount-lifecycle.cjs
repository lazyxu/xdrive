'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const file = 'ui/shared/src/media-gallery-baidu-jsapi4-mount.ts'
const source = read(file)
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const calls = []
const holder = { exports: {} }
new Function('module', 'exports', 'require', compiled)(
  holder, holder.exports, name => {
    assert.equal(name, './media-gallery-baidu-jsapi4-composition')
    return {
      xDriveComposeBaiduJSAPI4OwnerViewport(args) {
        calls.push(['compose', args])
        return {
          async refresh() {
            calls.push(['refresh'])
            const envelope = await args.trustedWGS84Bounds(new AbortController().signal)
            assert.equal(envelope.coordinate_space, 'photo-wgs84')
            return args.listOwnerViewport(envelope.bounds, 100, 0,
              new AbortController().signal)
          },
          dispose() { calls.push(['bridge-dispose']) },
        }
      },
    }
  })
const Lifecycle = holder.exports.XDriveBaiduJSAPI4MountLifecycle
const camera = { latitude: 0, longitude: 0, zoom: 12 }
const bounds = { west: -1, south: -1, east: 1, north: 1 }
const sourcePort = async (b, limit, offset) => {
  assert.deepEqual(b, bounds)
  assert.equal(limit, 100)
  assert.equal(offset, 0)
  return { kind: 'rendered', cells: 1, photos: 3 }
}
const callbacks = { onOpenPlace() {}, onResult() {} }
const native = () => ({
  map: { kind: 'BMap.Map' },
  namespace: { kind: 'BMap' },
  trustedWGS84Bounds: async () => ({ coordinate_space: 'photo-wgs84', bounds }),
  dispose() { calls.push(['native-dispose']) },
})
for (const platform of ['web', 'mobile-web', 'desktop']) {
  test('A3 platform parity: ' + platform + ' uses one authenticated viewport and Map lifecycle',
    async () => {
      calls.length = 0
      const runtime = new Lifecycle()
      const result = await runtime.open({ platform }, {
        acquire: async (_element, signal, originalPhotoCamera) => {
          assert.equal(signal.aborted, false)
          assert.deepEqual(originalPhotoCamera, camera)
          return native()
        },
      }, sourcePort, callbacks, camera)
      assert.deepEqual(result, { kind: 'rendered', cells: 1, photos: 3 })
      assert.equal(calls[0][1].listOwnerViewport, sourcePort)
      assert.equal(calls[0][1].callbacks, callbacks)
      assert.deepEqual(calls.map(c => c[0]), ['compose', 'refresh'])
      runtime.dispose()
      assert.deepEqual(calls.map(c => c[0]),
        ['compose', 'refresh', 'bridge-dispose', 'native-dispose'])
      assert.equal((await runtime.open({}, { acquire: async () => native() },
        sourcePort, callbacks, camera)).kind, 'query-unavailable')
    })
}
test('A3 unmount cancels an uncooperative pending SDK; late native Map is disposed', async () => {
  calls.length = 0
  let resolveSDK
  const runtime = new Lifecycle()
  const old = runtime.open({}, { acquire: () =>
    new Promise(resolve => { resolveSDK = resolve }), }, sourcePort, callbacks, camera)
  await new Promise(resolve => setImmediate(resolve))
  runtime.close()
  assert.equal((await old).kind, 'cancelled')
  resolveSDK(native())
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(c => c[0]), ['native-dispose'])
  runtime.dispose()
})
test('A3 rapid map session replacement cannot install stale native Map', async () => {
  calls.length = 0
  let resolveOld
  const runtime = new Lifecycle()
  const old = runtime.open({}, {
    acquire: () => new Promise(resolve => { resolveOld = resolve }),
  }, sourcePort, callbacks, camera)
  await new Promise(resolve => setImmediate(resolve))
  const current = await runtime.open({}, { acquire: async () => native() },
    sourcePort, callbacks, camera)
  assert.equal(current.kind, 'rendered')
  assert.equal((await old).kind, 'cancelled')
  resolveOld(native())
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(c => c[0]), ['compose', 'refresh', 'native-dispose'])
  runtime.dispose()
  assert.deepEqual(calls.map(c => c[0]),
    ['compose', 'refresh', 'native-dispose', 'bridge-dispose', 'native-dispose'])
})
test('A3 fails closed on malformed camera, absent original GPS and SDK failure', async () => {
  calls.length = 0
  const runtime = new Lifecycle()
  const acquire = { acquire: async () => {
    throw Error('AK, personal GPS and upstream URL must not leak to UI')
  }}
  for (const bad of [null, { ...camera, latitude: 86 },
    { ...camera, zoom: 0 }, { ...camera, longitude: NaN }]) {
    assert.equal((await runtime.open({}, acquire, sourcePort, callbacks, bad)).kind,
      'query-unavailable')
  }
  assert.equal((await runtime.open({}, acquire,
    sourcePort, callbacks, camera)).kind, 'query-unavailable')
  const incomplete = await runtime.open({}, { acquire: async () => ({
    map: {}, namespace: {}, dispose() { calls.push(['native-dispose']) },
  }) }, sourcePort, callbacks, camera)
  assert.equal(incomplete.kind, 'query-unavailable')
  assert.deepEqual(calls, [['native-dispose']])
  runtime.dispose()
})
test('A3 strictly no new Browser AK, SDK/network injection or client-specific Gallery fork', () => {
  assert.doesNotMatch(source,
    /\bfetch\(|document\.createElement|BMapLoader|window\.BMap|localStorage|indexedDB|BMAP_PROXY_URL|serviceHost/)
  const places = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4Surface.tsx')
  assert.match(places, /XDriveMediaGalleryBaiduJSAPI4Surface/)
  assert.match(places, /XDriveMediaGalleryBaiduStaticMap/)
  assert.match(places, /listOwnerViewport=\{listPlacesViewport\}/)
  assert.match(surface, /XDriveBaiduJSAPI4MountLifecycle/)
  assert.doesNotMatch(surface, /document\.createElement|BMapLoader|\bfetch\(/)
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(policy, /return ErrGateClosed/)
  for (const adapter of ['web/src/mediaGalleryAdapter.ts',
    'desktop/src/renderer/mediaGalleryAdapter.ts']) {
    assert.match(read(adapter), /listPlacesViewport/)
  }
})
