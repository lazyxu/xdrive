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

test('default same-document Places starts bounded Owner GPS overview after SDK readiness', () => {
  assert.doesNotMatch(code, /prototypeConsent|setPrototypeConsent|data-xdrive-baidu-prototype-gps-opt-in/)
  const ownerQueryAt = code.indexOf('void listPlacesMapOverview(bounds, detail, controller.signal)')
  const begin = code.lastIndexOf('  useEffect(() => {', ownerQueryAt)
  const end = code.indexOf('// Register the native ClusterLayer', ownerQueryAt)
  assert.ok(ownerQueryAt > 0 && begin > 0 && end > ownerQueryAt)
  const query = code.slice(begin, end)
  assert.match(query, /if \(!runtime\) return/)
  assert.match(query, /listPlacesMapOverview\(bounds, detail, controller.signal\)/)
  assert.match(query, /page\.items\.length > 64/)
  assert.match(query, /\[runtime, listPlacesMapOverview, overviewRetry\]/)
  assert.match(code, /data-xdrive-baidu-prototype-auto-gps-notice/)
})

test('official Convertor accepts only current bounded Owner samples and can be cancelled', () => {
  const conversionAt = code.indexOf('const convertor = new runtime.namespace.Convertor()')
  const begin = code.lastIndexOf('  useEffect(() => {', conversionAt)
  const end = code.indexOf('\n  return (\n    <Box component="section"', conversionAt)
  assert.ok(conversionAt > 0 && begin > 0 && end > conversionAt)
  const conversion = code.slice(begin, end)
  assert.match(conversion, /if \(!runtime\) return/)
  assert.match(conversion, /places\.filter\(validMarker\)/)
  assert.match(conversion, /xDriveConvertBaiduJSAPI4MarkerWindow/)
  assert.match(conversion, /if \(abort\.signal\.aborted\) return/)
  assert.match(conversion, /\[runtime, places, reportFailure, diagnosticScope\]/)
  assert.doesNotMatch(code, /(?:localStorage|sessionStorage)\.setItem\(/)
})

test('stop sharing leaves the unisolated document instead of re-authorizing on reload', () => {
  assert.match(code, /data-xdrive-baidu-prototype-gps-stop/)
  assert.match(code, /xDrivePlacesMapModeNavigationURL\(window\.location\.href, 'isolated'\)/)
  assert.match(code, /if \(target\) window\.location\.replace\(target\)/)
  assert.doesNotMatch(code, /window\.location\.reload\(\)/)
  assert.match(code, /最多 64 组原始 WGS84 GPS/)
  assert.match(code, /已发送的定位无法撤回/)
  assert.match(code, /disabled=\{!canBrowseNearby \|\| !runtime \|\|\s*!committedOwnerFrame\.current\}/)
  assert.match(code, /if \(!runtime \|\| !manualCamera\.current \|\| !committedOwnerFrame\.current\) return/)
})
