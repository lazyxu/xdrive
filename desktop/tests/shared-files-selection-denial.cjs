'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const file = 'ui/shared/src/file-explorer-selection-admission.ts'
const compiled = ts.transpileModule(read(file), {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, name => {
    if (name === './file-explorer-controller') return {
      xDriveFileExplorerSelectionActionDisabledReason: () => null,
    }
    throw new Error('Unexpected shared admission runtime dependency: ' + name)
  },
)
const request = mod.exports.xDriveFileExplorerSelectionRequest

test('one admission ticket counts distinct logical nodes and notifies a denial once', () => {
  const denied = []
  const selected = [{ id: 4 }, { id: 4 }, { id: 19 }]
  const ticket = request('copy', selected, (action, rows, count) => {
    assert.equal(action, 'copy')
    assert.strictEqual(rows, selected)
    assert.equal(count, 2)
    return '当前 Owner 已变化，请重新选择'
  }, reason => denied.push(reason))
  assert.deepEqual(ticket, {
    allowed: false, reason: '当前 Owner 已变化，请重新选择',
    selectedCount: 2,
  })
  assert.deepEqual(denied, ['当前 Owner 已变化，请重新选择'])
})

test('permitted and legacy three-argument callers are side-effect free', () => {
  const failures = []
  const rows = [{ id: 11, revision: 3 }]
  const allowed = request('cut', rows, () => null, reason => failures.push(reason))
  assert.deepEqual(allowed, { allowed: true, reason: null, selectedCount: 1 })
  assert.deepEqual(failures, [])
  const original = request('copy', rows, () => '不可复制')
  assert.deepEqual(original, { allowed: false, reason: '不可复制', selectedCount: 1 })
})

test('the two Hosts share the denial callback but retain native-specific checks', () => {
  const web = read('web/src/WebFileExplorer.tsx')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const shared = read(file)
  assert.match(shared, /onDenied\?: \(reason: string\) => void/)
  assert.match(shared, /if \(reason\) onDenied\?\.\(reason\)/)
  assert.match(web, /xDriveFileExplorerSelectionRequest\(\s*action, selected, getSelectionActionDisabledReason,/)
  assert.match(web, /\(reason\) => onError\(new Error\(reason\)\)/)
  assert.match(desktop, /xDriveFileExplorerSelectionRequest\(\s*action, selected, getSelectionActionDisabledReason,/)
  assert.match(desktop, /\n\s*onError,\s*\n\s*\)\.allowed/)
  assert.match(web, /downloadMaxItems: 1000/)
  assert.match(desktop, /archiveDownloadSupported/)
  assert.match(desktop, /folderTreeDownloadSupported/)
  assert.match(desktop, /fileTagsSupported/)
  assert.match(web, /if \(allowSelectionAction\('copy', selected\)\) copyWorkspaceItems\(selected\)/)
  assert.match(desktop, /if \(allowSelectionAction\('cut', selected\)\) cutWorkspaceItems\(selected\)/)
})
