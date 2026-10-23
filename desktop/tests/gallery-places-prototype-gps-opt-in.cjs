'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'
const code = fs.readFileSync(path.join(root, file), 'utf8')
const parsed = ts.transpileModule(code, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX },
})
assert.deepEqual((parsed.diagnostics || [])
  .filter(item => item.category === ts.DiagnosticCategory.Error), [])

test('prototype never initiates original GPS Owner query before explicit session opt-in', () => {
  assert.match(code, /const \[prototypeConsent, setPrototypeConsent\] = useState\(false\)/)
  const query = code.slice(code.indexOf('// GPS-bearing Owner requests require'),
    code.indexOf('// Register the native ClusterLayer'))
  assert.match(query, /if \(!runtime \|\| !prototypeConsent\) return/)
  assert.match(query, /listPlacesMapOverview\(bounds, detail, controller.signal\)/)
  assert.match(query, /\[runtime, listPlacesMapOverview, prototypeConsent, overviewRetry\]/)
  assert.match(code, /data-xdrive-baidu-prototype-gps-opt-in/)
  assert.match(code, /onClick=\{\(\) => setPrototypeConsent\(true\)\}/)
})

test('Baidu Convertor is separately gated and SDK data never gains persisted consent', () => {
  const begin = code.indexOf('// Never call Baidu Convertor with original WGS84')
  const end = code.indexOf('\n  return (\n    <Box component="section"', begin)
  assert.ok(begin > 0 && end > begin)
  const conversion = code.slice(begin, end)
  assert.match(conversion, /if \(!runtime \|\| !prototypeConsent\) return/)
  assert.match(conversion, /xDriveConvertBaiduJSAPI4MarkerWindow/)
  assert.match(conversion, /\[runtime, places, reportFailure, diagnosticScope, prototypeConsent\]/)
  assert.doesNotMatch(code, /(?:localStorage|sessionStorage)\.setItem\([^\n]*prototypeConsent/)
})

test('ending session reloads unisolated SDK and nearby photo actions require opt-in', () => {
  assert.match(code, /data-xdrive-baidu-prototype-gps-stop/)
  assert.match(code, /window\.location\.reload\(\)/)
  assert.match(code, /disabled=\{!prototypeConsent \|\| !canBrowseNearby \|\| !runtime\}/)
  assert.match(code, /最多 64 组原始 WGS84 GPS/)
  assert.match(code, /已发送的定位无法撤回/)
})
