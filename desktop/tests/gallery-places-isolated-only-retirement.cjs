'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('retired same-document SDK and Browser AK prototype have no remaining routes or transports', () => {
  for (const file of [
    'internal/api/baidu_jsapi4_prototype.go',
    'cmd/xdrive-agent/desktop_ipc_baidu_jsapi_prototype.go',
    'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx',
    'ui/shared/src/media-gallery-baidu-prototype-cover-pins.ts',
    'ui/shared/src/media-gallery-places-prototype-clusters.ts',
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, file)

  const forbidden = [
    ['internal/api/router.go', /authed\.GET\("\/media\/places\/baidu-jsapi\/prototype"/],
    ['internal/client/media.go', /MediaBaiduJSAPIPrototype|BaiduJSAPIPrototypeConfig/],
    ['cmd/xdrive-agent/desktop_ipc.go', /\/v1\/media\/baidu-jsapi-prototype/],
    ['desktop/src/main/agent_client.cts', /AgentBaiduJSAPIPrototype|mediaBaiduJSAPIPrototype/],
    ['desktop/src/main/index.cts', /agent:get-baidu-jsapi-prototype|AgentBaiduJSAPIPrototype/],
    ['desktop/src/preload/index.cts', /agent:get-baidu-jsapi-prototype|getBaiduJSAPIPrototype/],
    ['desktop/src/renderer/global.d.ts', /XDriveBaiduJSAPIPrototypeConfig|getBaiduJSAPIPrototype/],
    ['ui/shared/src/models.ts', /XDriveBaiduJSAPIPrototypeConfig/],
    ['ui/shared/src/mui/MediaGallery.tsx', /getBaiduJSAPIPrototype/],
    ['ui/shared/src/mui/MediaGalleryAdapter.ts', /getBaiduJSAPIPrototype|XDriveBaiduJSAPIPrototypeConfig/],
    ['web/src/api.ts', /mediaBaiduJSAPIPrototype|\/media\/places\/baidu-jsapi\/prototype/],
    ['web/src/mediaGalleryAdapter.ts', /getBaiduJSAPIPrototype/],
  ]
  for (const [file, pattern] of forbidden) {
    assert.doesNotMatch(read(file), pattern, file)
  }
})

test('only signed isolated HTTPS Child remains the rendered provider', () => {
  const router = read('internal/api/router.go')
  const places = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const web = read('web/src/mediaGalleryAdapter.ts')
  const child = read('deploy/baidu-isolated-child/child.js')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(router, /authed\.GET\("\/media\/places\/baidu-jsapi\/status"/)
  assert.match(router, /authed\.POST\("\/media\/places\/baidu-jsapi\/child-ticket"/)
  assert.match(places, /result\.activation_state === 'authorized_signed_release'/)
  assert.match(places, /XDriveMediaGalleryBaiduIsolatedPhotoSurface/)
  assert.match(places, /data-xdrive-baidu-map-unavailable/)
  assert.match(places, /server_release_blocked/)
  assert.match(surface, /mintChildTicket\(lifetime\.signal\)/)
  assert.match(surface, /xDriveSelectBaiduNativeCell/)
  assert.match(child, /map-failed/)
  assert.match(web, /mintBaiduIsolatedChildTicket: signal => api\.mediaBaiduIsolatedChildTicket\(signal\)/)
  assert.match(gallery, /getBaiduJSAPI4Status=\{source\.getBaiduJSAPI4Status\}/)
  assert.doesNotMatch(places, /MediaGalleryBaiduPrototypeMap|MediaGalleryBaiduStaticMap|loadBaiduStaticMap/)
})

test('retired prototype diagnostics cannot be recorded while signed failures remain private', () => {
  const file = 'ui/shared/src/media-gallery-baidu-diagnostics.ts'
  const moduleSource = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual(moduleSource.diagnostics || [], [])
  const loaded = new Module(file, module)
  loaded.filename = path.join(root, file)
  loaded.paths = module.paths
  loaded._compile(moduleSource.outputText, loaded.filename)
  const {
    xDriveBaiduMapDiagnosticDetails: details,
    xDriveRecordBaiduMapDiagnostic: record,
    xDriveReadBaiduMapDiagnostic: get,
    xDriveClearBaiduMapDiagnostic: clear,
    xDriveClassifyBaiduMapRequestFailure: classify,
  } = loaded.exports

  assert.equal(Object.keys(details).some(code => code.startsWith('prototype_')), false)
  assert.equal(loaded.exports.xDriveClassifyBaiduPrototypeConfigFailure, undefined)
  assert.equal(classify('status', { status: 404, message: 'AK=secret' }), 'client_version_mismatch')
  assert.equal(classify('status', { get status() { throw Error('JWT secret') } }), 'status_unavailable')
  assert.equal(record('web:current-owner', 'server_release_blocked'), true)
  assert.deepEqual(Object.keys(get('web:current-owner')).sort(), ['code', 'recordedAt'])
  assert.equal(JSON.stringify(get('web:current-owner')).includes('secret'), false)
  clear('web:current-owner')
})
