'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

function loadTypeScript(file) {
  const transpiled = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual(transpiled.diagnostics || [], [])
  const loaded = new Module(file, module)
  loaded.filename = path.join(root, file)
  loaded.paths = module.paths
  loaded._compile(transpiled.outputText, loaded.filename)
  return loaded.exports
}

const source = 'ui/shared/src/media-gallery-baidu-jsapi4-browser-loader.ts'
const { xDriveCreateBaiduJSAPI4IndexedBD09Mount } = loadTypeScript(source)
const { xDriveBaiduMapDiagnosticDetails: details } =
  loadTypeScript('ui/shared/src/media-gallery-baidu-diagnostics.ts')

function fixture(onFailure) {
  const scripts = []
  const browser = { location: { protocol: 'https:', origin: 'https://gallery.example.test' } }
  const doc = {
    defaultView: browser,
    head: { appendChild(script) { scripts.push(script) } },
    createElement(tag) {
      assert.equal(tag, 'script')
      return { remove() { this.removed = true } }
    },
  }
  const mount = xDriveCreateBaiduJSAPI4IndexedBD09Mount({
    mintMapOnlySession: async () => ({ provider: 'baidu-jsapi-4.0', runtime_enabled: true }),
    onRuntimeFailure: onFailure,
  })
  const camera = { longitude: 116.4, latitude: 39.9, zoom: 10, coordinate_space: 'bd09ll' }
  const start = () => {
    // secureDocument() intentionally validates the real global document. The
    // production adapter is not changed for tests; only provide this fake DOM
    // during the synchronous part of acquire() that inspects global document.
    const previous = global.document
    global.document = doc
    try {
      return mount.acquire({ ownerDocument: doc }, new AbortController().signal, camera)
    } finally {
      if (previous === undefined) delete global.document
      else global.document = previous
    }
  }
  return { scripts, browser, start }
}

const validNamespace = () => ({
  Map: class { centerAndZoom() {} destroy() {} },
  Point: class { constructor(lng, lat) { this.lng = lng; this.lat = lat } },
  Convertor: class { translate(_p, _from, _to, cb) { cb({ status: 0, points: [{lng:116, lat:40}] }) } },
  ClusterLayer: class {},
})

const nextTask = () => new Promise(resolve => setImmediate(resolve))

test('deferred BMap initialization after bootstrap onload is accepted, without public AK URLs', async () => {
  const reported = []
  const f = fixture(code => reported.push(code))
  const pending = f.start()
  await nextTask()
  assert.equal(f.scripts.length, 1)
  const script = f.scripts[0]
  assert.equal(script.src, 'https://gallery.example.test/_BMapService/api?v=4.0')
  assert.equal(script.referrerPolicy, 'no-referrer')
  script.onload()
  // The old loader rejected synchronously at this point; v4 is allowed to
  // finish populating its namespace after the bootstrap script's onload.
  setTimeout(() => { f.browser.BMap = validNamespace() }, 10)
  const map = await pending
  assert.ok(map.map)
  map.dispose()
  assert.deepEqual(reported, [])
})

test('errors from the authenticated Session are never exposed as SDK codes', async () => {
  const reported = []
  const f = fixture(code => reported.push(code))
  // Force a new mount with an independently failing owner/session port.
  const mount = xDriveCreateBaiduJSAPI4IndexedBD09Mount({
    mintMapOnlySession: async () => { throw new Error('private Bearer/Cookie/token') },
    onRuntimeFailure: code => reported.push(code),
  })
  const oldDoc = global.document
  global.document = f.browser && { defaultView: f.browser, head: { appendChild() { throw Error('unexpected script') } } }
  try {
    await assert.rejects(mount.acquire({ ownerDocument: global.document },
      new AbortController().signal,
      { longitude:116.4, latitude:39.9, zoom:10, coordinate_space:'bd09ll' }))
    assert.deepEqual(reported, [])
  } finally {
    if (oldDoc === undefined) delete global.document
    else global.document = oldDoc
  }
})

test('actual script.onerror produces exact safe code rather than generic sdk_load_failed', async () => {
  const reported = []
  const f = fixture(code => reported.push(code))
  const pending = f.start()
  await nextTask()
  f.scripts[0].onerror(new Error('SECRET_JWT_Cookie_AK'))
  await assert.rejects(pending)
  assert.deepEqual(reported, ['sdk_script_failed'])
  assert.equal(JSON.stringify(reported).includes('SECRET'), false)
  assert.match(details.sdk_script_failed.title, /启动脚本/)
})

test('a conflicting already-configured serviceHost is reported and never loads a script', async () => {
  const reported = []
  const f = fixture(code => reported.push(code))
  f.browser._BMapSecurityConfig = { serviceHost: 'https://other.example.test/_BMapService/' }
  await assert.rejects(f.start())
  assert.deepEqual(reported, ['sdk_service_host_conflict'])
  assert.equal(f.scripts.length, 0)
})

test('a failing native Map constructor is a distinct post-SDK initialization failure', async () => {
  const reported = []
  const f = fixture(code => reported.push(code))
  const pending = f.start()
  await nextTask()
  f.browser.BMap = { ...validNamespace(), Map: class { constructor() { throw Error('PRIVATE_TOKEN') } } }
  f.scripts[0].onload()
  await assert.rejects(pending)
  assert.deepEqual(reported, ['sdk_map_initialization_failed'])
  assert.doesNotMatch(JSON.stringify(reported), /PRIVATE_TOKEN/)
})

test('diagnostics are explicitly allowlisted in both Gallery fallback and Admin page', () => {
  const photo = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const places = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const admin = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const loader = read(source)
  assert.match(photo, /onRuntimeFailure: code =>/)
  assert.match(photo, /!runtimeFailureRecorded/)
  assert.match(photo, /data-xdrive-baidu-map-runtime-reason/)
  assert.match(places, /data-xdrive-baidu-map-blocked-reason/)
  assert.match(places, /xDriveSubscribeBaiduMapDiagnostics/)
  assert.match(admin, /data-xdrive-baidu-runtime-evidence-boundary/)
  for (const src of [places, admin]) {
    assert.match(src, /addEventListener\('visibilitychange', (?:read|refresh)\)/)
    assert.match(src, /addEventListener\('focus', (?:read|refresh)\)/)
    assert.match(src, /removeEventListener\('visibilitychange', (?:read|refresh)\)/)
    assert.match(src, /removeEventListener\('focus', (?:read|refresh)\)/)
    assert.match(src, /xDriveReadBaiduMapDiagnostic\(scope\)/)
    assert.match(src, /typeof window === 'undefined' \? null : window/)
    assert.match(src, /typeof document === 'undefined' \? null : document/)
  }
  assert.match(loader, /missingNativeCapability/)
  assert.match(loader, /script\.onerror = \(\) => finish\(null, 'sdk_script_failed'\)/)
  for (const code of [
    'sdk_script_failed','sdk_script_timeout','sdk_namespace_missing','sdk_missing_map',
    'sdk_missing_point','sdk_missing_convertor','sdk_missing_cluster_layer',
    'sdk_coordinate_conversion_failed','sdk_map_initialization_failed',
    'sdk_service_host_conflict','sdk_cached_namespace_conflict','sdk_script_injection_failed',
  ]) assert.ok(Object.hasOwn(details, code), code)
  assert.doesNotMatch(photo, /record\(.*error\.message/)
  assert.doesNotMatch(loader, /console\.|onRuntimeFailure\?\.\(error/)
})
