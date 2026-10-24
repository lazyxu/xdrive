'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const filename = 'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'
const source = fs.readFileSync(path.join(root, filename), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error), [])

test('gesture-start rejects pending Owner GPS and Baidu conversion concurrently', () => {
  assert.match(source, /const conversionAbort = useRef<AbortController \| null>\(null\)/)
  const begin = source.indexOf('const stopOnGesture = () => {')
  const end = source.indexOf("runtime.map.addEventListener('movestart', stopOnGesture)", begin)
  assert.ok(begin > 0 && end > begin)
  const handler = source.slice(begin, end)
  assert.match(handler, /request\?\.abort\(\)/)
  assert.match(handler, /conversionAbort\.current\?\.abort\(\)/)
  assert.ok(handler.indexOf('request?.abort()') < handler.indexOf("lastKey = ''"))
  assert.ok(handler.indexOf('conversionAbort.current?.abort()') < handler.indexOf("lastKey = ''"))
  assert.doesNotMatch(handler, /layer\.setData\(/)
})
test('each Convertor generation records and releases its exact abort controller', () => {
  assert.match(source, /conversionAbort\.current = abort/)
  assert.match(source, /if \(conversionAbort\.current === abort\) conversionAbort\.current = null/)
  assert.match(source, /if \(abort\.signal\.aborted\) return/)
  assert.match(source, /\[runtime, places, reportFailure, diagnosticScope\]/)
})

test('old native marker clicks remain inert until a fresh Owner layer commits',()=>{
  assert.match(source,/const committedOwnerFrame = useRef\(false\)/)
  assert.match(source,/if \(abort\.signal\.aborted \|\| !committedOwnerFrame\.current\) return/)
  assert.match(source,/if \(!committedOwnerFrame\.current\) return/)
  assert.match(source,/committedOwnerFrame\.current = false/)
  assert.match(source,/committedOwnerFrame\.current = true/)
  const gesture=source.slice(source.indexOf('const stopOnGesture = () => {'),
    source.indexOf("runtime.map.addEventListener('movestart', stopOnGesture)"))
  assert.match(gesture,/committedOwnerFrame\.current = false/)
  assert.match(gesture,/setCanBrowseNearby\(false\)/)
  assert.doesNotMatch(gesture,/layer\.setData\(/)
  const layer=source.slice(source.indexOf("phase = 'layer'"),source.indexOf('// Opening Places should show'))
  assert.ok(layer.indexOf("runtime.layer.setData(collection)") <
    layer.indexOf("committedOwnerFrame.current = true"))
  assert.match(source,/if \(!committedOwnerFrame\.current \|\| !node/)
})
