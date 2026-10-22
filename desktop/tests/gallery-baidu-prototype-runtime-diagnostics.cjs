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
const compiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual(compiled.diagnostics || [], [])
const loaded = new Module(file, module)
loaded.filename = path.join(root, file)
loaded.paths = module.paths
loaded._compile(compiled.outputText, loaded.filename)
const { xDriveClassifyBaiduPrototypeConfigFailure: classify,
  xDriveBaiduMapDiagnosticDetails: details,
  xDriveRecordBaiduMapDiagnostic: record,
  xDriveReadBaiduMapDiagnostic: get,
  xDriveClearBaiduMapDiagnostic: clear,
} = loaded.exports

test('Browser AK prototype route HTTP failures are correctly distinguished', () => {
  for (const [status, code] of [
    [401, 'prototype_config_denied'], [403, 'prototype_config_denied'],
    [404, 'prototype_config_unsupported'], [501, 'prototype_config_unsupported'],
    [429, 'prototype_config_rate_limited'], [503, 'prototype_config_unavailable'],
  ]) assert.equal(classify({ status, message: 'Cookie AK=secret' }), code)
  assert.equal(classify({ get status() { throw Error('JWT') } }), 'prototype_config_unavailable')
  assert.equal(classify(new Error('https://api.map.baidu.com/?ak=secret')),
    'prototype_config_unavailable')
})

test('prototype stages are allowlisted, transient, scoped and secret-free', () => {
  for (const code of ["prototype_config_unavailable","prototype_config_denied","prototype_config_unsupported","prototype_config_rate_limited","prototype_config_invalid","prototype_ak_rotated","prototype_document_unavailable","prototype_csp_script_blocked","prototype_sdk_script_failed","prototype_sdk_script_timeout","prototype_sdk_callback_timeout","prototype_sdk_namespace_missing","prototype_sdk_script_injection_failed","prototype_sdk_map_init_failed","prototype_sdk_convert_failed","prototype_sdk_layer_update_failed"]) {
    assert.equal(typeof details[code]?.title, 'string', code)
  }
  const scope = 'web:baidu-diagnostic-test'
  assert.equal(record(scope, 'prototype_csp_script_blocked'), true)
  assert.deepEqual(Object.keys(get(scope)).sort(), ['code','recordedAt'])
  assert.equal(JSON.stringify(get(scope)).includes('AK=secret'), false)
  clear(scope)
})

test('exact Gallery runtime and Admin UI retain specific errors without raw provider text', () => {
  const map = read('ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx')
  const parent = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const admin = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  for (const path of ['ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx',
    'ui/shared/src/mui/MediaGalleryPlacesMap.tsx',
    'ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx']) {
    const t = ts.transpileModule(read(path), {
      fileName: path, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022 },
    })
    assert.deepEqual(t.diagnostics || [], [], path)
  }
  assert.match(map, /xDriveClassifyBaiduPrototypeConfigFailure\(error\)/)
  assert.match(map, /xDriveRecordBaiduMapDiagnostic\(diagnosticScope, code\)/)
  assert.match(map, /xDriveClearBaiduMapDiagnostic\(diagnosticScope\)/)
  assert.match(map, /data-xdrive-baidu-prototype-error-code/)
  assert.match(map, /prototype_csp_script_blocked/)
  assert.match(map, /prototype_sdk_callback_timeout/)
  assert.match(map, /&callback=/)
  assert.match(map, /prototype_sdk_convert_failed/)
  assert.match(map, /script\.onerror = \(\) => cleanup/)
  assert.match(parent, /diagnosticScope=\{diagnosticScope\}/)
  assert.match(admin, /不会验证图库原型在浏览器中直接发起的 JSAPI 请求/)
  assert.doesNotMatch(map, /error\.message|JSON\.stringify\(error\)|console\.(?:warn|error)/)
})
