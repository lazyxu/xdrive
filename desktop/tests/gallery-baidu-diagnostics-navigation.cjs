'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

const file = 'ui/shared/src/media-gallery-baidu-diagnostics.ts'
const transpiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual(transpiled.diagnostics || [], [])
const loaded = new Module(file, module)
loaded.filename = path.join(root, file)
loaded.paths = module.paths
loaded._compile(transpiled.outputText, loaded.filename)
const {
  xDriveRecordBaiduMapDiagnostic: record,
  xDriveReadBaiduMapDiagnostic: get,
  xDriveClearBaiduMapDiagnostic: clear,
  xDriveClassifyBaiduMapRequestFailure: classify,
  xDriveSubscribeBaiduMapDiagnostics: subscribe,
  xDriveBaiduMapDiagnosticDetails: details,
  XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS: ttl,
  xDriveBaiduMapHTTPSRequired: needsHTTPS,
} = loaded.exports

test('HTTPS-only loader source guard is deterministic and never depends on AK/Owner', () => {
  assert.equal(needsHTTPS('https:'), false)
  for (const p of ['http:', 'file:', 'about:', 'data:', undefined, null, '']) {
    assert.equal(needsHTTPS(p), true, String(p))
  }
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const checks = [
    "protocol = container.ownerDocument.defaultView?.location.protocol",
    "if (xDriveBaiduMapHTTPSRequired(protocol))",
    "record('https_origin_required')",
    "record(phase === 'session' ? 'session_timeout' : 'sdk_timeout')",
  ]
  for (const check of checks) assert.ok(surface.includes(check), check)
  assert.ok(surface.indexOf("record('https_origin_required')") <
    surface.indexOf('native = await mount.acquire(container, pending.signal, camera)'),
    'insecure browsers must fail closed before attempting SDK or map-only Session')
})

test('real TypeScript diagnosis maps known HTTP codes but never stores sensitive error text', () => {
  assert.equal(classify('status', { status: 403, message: 'Cookie x=y' }), 'status_access_denied')
  assert.equal(classify('status', { status: 429 }), 'status_rate_limited')
  assert.equal(classify('session', { status: 401 }), 'session_denied')
  assert.equal(classify('session', { status: 429 }), 'session_rate_limited')
  assert.equal(classify('viewport', { status: 409 }), 'viewport_denied')
  assert.equal(classify('viewport', { status: 429 }), 'viewport_rate_limited')
  assert.equal(classify('status', { status: 404 }), 'client_version_mismatch')
  assert.equal(classify('viewport', { status: 501 }), 'client_version_mismatch')
  assert.equal(classify('session', new Error('Bearer secret: /private/asset')), 'session_unavailable')
  assert.equal(classify('viewport', { get status() { throw Error('SECRET') } }), 'viewport_unavailable')
  assert.equal(record('web:owner-1', classify('status', { status: 403, detail: 'AK_SECRET' })), true)
  const observed = get('web:owner-1')
  assert.deepEqual(Object.keys(observed).sort(), ['code', 'recordedAt'])
  assert.equal(JSON.stringify(observed).includes('AK_SECRET'), false)
  assert.equal(JSON.stringify(observed).includes('Bearer'), false)
  assert.equal(JSON.stringify(details).includes('https://user:secret'), false)
  clear('web:owner-1')
})

test('scopes are bounded, isolated, transient, and never persist across logout/TTL', () => {
  const savedNow = Date.now
  let tick = 1_700_000_000_000
  Date.now = () => tick
  try {
    let count = 0
    const unsubscribe = subscribe(() => count++)
    assert.equal(record('web:Alice', 'sdk_load_failed'), true)
    assert.equal(get('web:alice'), null)
    assert.equal(get('desktop:Alice'), null)
    assert.equal(get('web:Alice').code, 'sdk_load_failed')
    assert.equal(record('', 'sdk_load_failed'), false)
    assert.equal(record('web:Alice', 'not-a-real-code'), false)
    assert.equal(record('web:Alice\nInjected:token', 'sdk_load_failed'), false)
    assert.equal(count, 1)
    for (let i=0; i<8; i++) assert.equal(record('web:new'+i, 'status_unavailable'), true)
    assert.equal(get('web:Alice'), null, 'least-recent owner is evicted')
    assert.equal(get('web:new7').code, 'status_unavailable')
    tick += ttl
    assert.equal(get('web:new7'), null)
    assert.equal(record('web:Alice', 'session_renew_failed'), true)
    clear('web:Alice')
    assert.equal(get('web:Alice'), null)
    unsubscribe()
    const previous = count
    record('web:Alice', 'status_unavailable')
    assert.equal(count, previous)
    clear('web:Alice')
  } finally {
    Date.now = savedNow
  }
})

test('Gallery remains a short fallback with admin-only route to the shared diagnosis', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const photo = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const places = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  const deps = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const admin = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')

  assert.match(gallery, /onOpenBaiduMapDiagnostics\?: \(\) => void/)
  assert.match(gallery, /diagnosticScope=\{preferenceScope\}/)
  // The outer page and shared presentation are separate functions. The
  // admin-only callback must cross BOTH boundaries before reaching Places.
  assert.match(gallery, /onOpenBaiduMapDiagnostics=\{onOpenBaiduMapDiagnostics\}/)
  assert.match(gallery, /onOpenBaiduMapDiagnostics\?: \(\) => void/g)
  const desktopGallery = desktop.slice(
    desktop.indexOf("{view === 'gallery' && ("),
    desktop.indexOf("{view === 'device-backup' && ("),
  )
  assert.equal((desktopGallery.match(/preferenceScope=/g) ?? []).length, 1,
    'Desktop Gallery must not send the same JSX prop twice')
  assert.match(places, /status\.activation_state === 'authorized_signed_release'/)
  assert.match(places, /xDriveClassifyBaiduMapRequestFailure\('status', error\)/)
  assert.match(places, /!desktopHTTPSOnly/)
  assert.match(places, /data-xdrive-baidu-map-diagnostics-link/)
  assert.match(photo, /record\('session_renew_failed'\)/)
  assert.match(photo, /xDriveClassifyBaiduMapRequestFailure\('viewport', error\)/)
  assert.match(photo, /pending\.abort\(\)/)
  assert.match(photo, /data-xdrive-baidu-map-fallback/)
  assert.match(web, /onOpenBaiduMapDiagnostics=\{profile\?\.role === 'admin'/)
  assert.match(web, /app: 'admin-services', params: \{ service: 'baidu-map', tab: 'verify' \}/)
  assert.match(desktop, /status\?\.role === 'admin' &&/)
  assert.match(web, /xDriveClearBaiduMapDiagnostic\(baiduDiagnosticScope\)/)
  assert.match(desktop, /xDriveClearBaiduMapDiagnostic\(baiduDiagnosticScope\)/)
  assert.match(admin, /XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS/)
  assert.match(desktop, /setBaiduDiagnosticLocation\(\{ service: 'baidu-map', tab: 'verify' \}\)/)
  assert.match(deps, /diagnosticScope=\{diagnosticScope\}/)
  assert.match(admin, /data-xdrive-baidu-client-diagnostic/)
  assert.match(admin, /releaseBlockerHints\[reason\]/)
  assert.match(admin, /latestDiagnostic\.code/)
  assert.doesNotMatch(admin, /\{error\.stack\}|\{error\.message\}|JSON\.stringify\(error\)/)
})

test('SDK stage and status errors do not expose raw provider errors or photos to diagnostics', () => {
  const photo = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const places = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(photo, /sessionFailureRecorded = true/)
  assert.match(photo, /phase === 'sdk' \? 'sdk_load_failed'/)
  assert.match(photo, /phase === 'viewport' \? 'viewport_unavailable'/)
  assert.match(photo, /onReady\(false\)/)
  assert.match(photo, /if \(diagnosticScope\) xDriveClearBaiduMapDiagnostic\(diagnosticScope\)/)
  assert.doesNotMatch(photo, /record\(.*error\.message/)
  assert.doesNotMatch(places, /record.*JWT|record.*owner_id|record.*BrowserAK/)
  assert.match(places, /百度动态照片地图暂不可用，仍可使用原有地点与静态地图/)
  assert.equal(Object.keys(details).length >= 14, true)
})
