'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const file = 'ui/shared/src/media-gallery-baidu-diagnostics.ts'
const built = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual(built.diagnostics || [], [])
const moduleObject = new Module(file, module)
moduleObject.filename = path.join(root, file)
moduleObject.paths = module.paths
moduleObject._compile(built.outputText, moduleObject.filename)
const {xDriveClassifyBaiduPrototypeConfigFailure: classify,
  xDriveBaiduMapDiagnosticDetails: details,
  xDriveRecordBaiduMapDiagnostic: record,
  xDriveReadBaiduMapDiagnostic: get,
  xDriveClearBaiduMapDiagnostic: clear,
} = moduleObject.exports

test('prototype errors classify real HTTP status without copying sensitive response', () => {
  for (const [status, code] of [
    [401,'prototype_config_denied'],[403,'prototype_config_denied'],
    [404,'prototype_config_unsupported'],[501,'prototype_config_unsupported'],
    [429,'prototype_config_rate_limited'],[503,'prototype_config_unavailable'],
  ]) assert.equal(classify({status, message:'AK=SECRET Bearer=PRIVATE'}),code)
  assert.equal(classify({get status() {throw Error('AK=SECRET')}}),
    'prototype_config_unavailable')
  assert.equal(classify(new Error('https://api.map.baidu.com/?ak=SECRET')),
    'prototype_config_unavailable')
})

test('every prototype failure code is allowlisted, scope-bounded, and private', () => {
  const codes = [
    'prototype_config_unavailable','prototype_config_denied',
    'prototype_config_unsupported','prototype_config_rate_limited',
    'prototype_config_invalid','prototype_ak_rotated',
    'prototype_document_unavailable','prototype_csp_script_blocked',
    'prototype_sdk_script_failed','prototype_sdk_script_timeout',
    'prototype_sdk_namespace_missing','prototype_sdk_script_injection_failed',
    'prototype_sdk_map_init_failed','prototype_sdk_convert_failed',
    'prototype_sdk_layer_update_failed',
    'sdk_missing_map','sdk_missing_point','sdk_missing_convertor','sdk_missing_cluster_layer',
  ]
  for(const code of codes) {
    assert.equal(typeof details[code]?.title,'string',code)
    assert.equal(typeof details[code]?.action,'string',code)
  }
  assert.equal(record('web:owner-prototype', 'prototype_csp_script_blocked'),true)
  assert.deepEqual(Object.keys(get('web:owner-prototype')).sort(),['code','recordedAt'])
  assert.equal(get('web:other-owner'),null)
  assert.doesNotMatch(JSON.stringify(get('web:owner-prototype')),/SECRET|Bearer|api\.map/)
  clear('web:owner-prototype')
})

test('Web/Mobile/Desktop Gallery shares true stage and admin-only diagnosis',()=>{
  const map=read('ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx')
  const places=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const admin=read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  for(const file of [
    'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx',
    'ui/shared/src/mui/MediaGalleryPlacesMap.tsx',
    'ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx',
  ]) {
    const result=ts.transpileModule(read(file),{
      fileName:file,reportDiagnostics:true,
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
    })
    assert.deepEqual(result.diagnostics||[],[],file)
  }
  for(const expected of [
    /xDriveClassifyBaiduPrototypeConfigFailure\(error\)/,
    /xDriveRecordBaiduMapDiagnostic\(diagnosticScope, code\)/,
    /xDriveClearBaiduMapDiagnostic\(diagnosticScope\)/,
    /data-xdrive-baidu-prototype-error-code/,
    /prototype_csp_script_blocked/,
    /prototype_sdk_convert_failed/,
    /script\.onerror = \(\) => cleanup/,
    /new api\.Map\(node\)/,
    /onOpenDiagnostics/,
  ]) assert.match(map,expected)
  assert.match(places,/diagnosticScope=\{diagnosticScope\}/)
  assert.match(places,/onOpenDiagnostics=\{onOpenDiagnostics\}/)
  assert.match(admin,/不能验证图库原型浏览器直接发起的 JSAPI 请求/)
  assert.match(admin,/data-xdrive-baidu-client-diagnostic/)
  assert.doesNotMatch(map,/error\.message|JSON\.stringify\(error\)|console\.(?:warn|error)/)
})
