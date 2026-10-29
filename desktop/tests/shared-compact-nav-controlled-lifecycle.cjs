'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const admissionPath = path.join(root, 'ui/shared/src/mui/WorkspaceCompactNavigationAdmission.ts')
const source = fs.readFileSync(admissionPath, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: admissionPath,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const exports = {}
new Function('exports', compiled.outputText)(exports)
const admissionChanged = exports.xDriveCompactNavigationAdmissionChanged

test('initial controlled More drawer has no false route/disabled transition', () => {
  const initial = { selected: 'gallery', disabled: false }
  assert.equal(admissionChanged(initial, initial), false)
  assert.equal(admissionChanged(initial, { ...initial }), false,
    'callback identity and parent repaint cannot close the drawer')
  assert.equal(admissionChanged({ selected: undefined, disabled: false },
    { selected: undefined, disabled: false }), false)
})

test('actual navigation or disabling retires stale drawer contents', () => {
  assert.equal(admissionChanged({ selected: 'files', disabled: false },
    { selected: 'gallery', disabled: false }), true)
  assert.equal(admissionChanged({ selected: 'files', disabled: false },
    { selected: 'files', disabled: true }), true)
  assert.equal(admissionChanged({ selected: 'files', disabled: true },
    { selected: 'files', disabled: false }), true)
  assert.equal(admissionChanged({ selected: 'files', disabled: true },
    { selected: 'files', disabled: true }), false)
})

test('shared component uses admission transition, never mount-only close', () => {
  const component = fs.readFileSync(
    path.join(root, 'ui/shared/src/mui/WorkspaceCompactNavigation.tsx'), 'utf8')
  assert.match(component, /const lastAdmission = useRef\(\{ selected, disabled \}\)/)
  assert.match(component, /const previous = lastAdmission\.current/)
  assert.match(component, /const changed = xDriveCompactNavigationAdmissionChanged\(previous, next\)/)
  assert.match(component, /lastAdmission\.current = next/)
  assert.match(component, /if \(changed\) setMoreOpen\(false\)/)
  assert.doesNotMatch(component, /useEffect\(\(\) => \{\s*setMoreOpen\(false\)/,
    'Mounting with open=true must not notify the host to close')
  assert.match(component, /open=\{moreOpen && !disabled\}/)
  assert.match(component, /onClose=\{\(\) => setMoreOpen\(false\)\}/)
})
