'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const relative = 'ui/shared/src/mui/FileExplorerVerifiedOwnerSelection.ts'
const source = fs.readFileSync(path.join(root, relative), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: relative, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = { exports: {} }
new Function('exports', compiled.outputText)(mod.exports)
const { xDriveOwnerSelectionMatches: matches, xDriveFindVerifiedOwnerSelection: find } = mod.exports
const canonical = Object.freeze({ id: 42, name: 'photo.jpg', type: 'file', revision: 7, size: 1337 })
const selected = Object.freeze({ id: 42, name: 'photo.jpg', kind: 'file', revision: 7, size: 1337 })

test('both Host DTO and FileExplorer projection have one exact Owner identity', () => {
  assert.equal(matches(selected, canonical), true)
  assert.equal(matches(canonical, selected), true)
  assert.strictEqual(find(selected, [canonical]), canonical)
  assert.equal(matches({ ...selected, size: 0 }, { ...canonical, size: 0 }), true,
    'zero-byte files still have valid identities even when download is unsupported')
})

test('deny stale identity, unsafe numbers, conflicting kind and untrusted types', () => {
  const changes = [
    { id: '42' }, { id: 0 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { revision: 6 }, { revision: 0 }, { revision: 2.5 },
    { revision: '7' }, { revision: 'not-a-number' },
    { size: 2000 }, { size: -1 }, { size: Number.MAX_SAFE_INTEGER + 1 },
    { name: 'other.jpg' }, { name: '' }, { name: 'x'.repeat(513) },
    { kind: 'dir' }, { kind: 'file', type: 'dir' }, { kind: 'virtual' },
  ]
  for (const delta of changes) {
    const forged = { ...selected, ...delta }
    assert.equal(find(forged, [canonical]), null, JSON.stringify(delta))
  }
  assert.equal(find(selected, [{ ...canonical, id: 43 }]), null, 'another Owner/parent selection')
  assert.equal(find(selected, [{ ...canonical, revision: 8 }]), null, 'replaced Node revision')
  assert.equal(find(selected, [{ ...canonical, revision: '7' }]), null,
    'a string-encoded Server revision is not a current authoritative number')
  assert.equal(find(selected, [{ ...canonical, name: 'renamed.jpg' }]), null, 'renamed Node')
  assert.equal(find(selected, [{ ...canonical, type: 'dir' }]), null, 'type mismatch')
  assert.equal(find(selected, [{ ...canonical, type: 'file', kind: 'dir' }]), null, 'conflicting DTO kinds')
  assert.equal(find(selected, []), null, 'empty/evicted cursor page')
})

test('directories require same verified Owner row before changing cursor root', () => {
  const folder = { id: 51, name: 'Folder', type: 'dir', revision: 2, size: 0 }
  assert.strictEqual(find({ ...folder, type: undefined, kind: 'dir' }, [folder]), folder)
  assert.equal(find({ ...folder, type: undefined, kind: 'dir', revision: 1 }, [folder]), null)

  const page = fs.readFileSync(
    path.join(root, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
  const directory = page.slice(page.indexOf('onOpenItem={item => {'),
    page.indexOf('statusText={currentScopeVerified'))
  assert.match(directory, /if \(!isCurrentOwner\(\) \|\| !currentScopeVerified\) return/)
  assert.match(directory, /xDriveFindVerifiedOwnerSelection\(item, itemsRef\.current\)/)
  assert.match(directory, /if \(!verified\)/)
  assert.match(directory, /id: verified\.id, name: verified\.name/)
  assert.doesNotMatch(directory, /id: item\.id|name: item\.name/)
})

test('preview and download both independently verify actual current Owner row', () => {
  const page = fs.readFileSync(
    path.join(root, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
  // DSM's download proof moved into the shared read-only admission helper.
  const downloadAdmission = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/FileExplorerReadOnlyDownloadAdmission.ts'), 'utf8')
  assert.match(page, /xDriveFileExplorerReadOnlyDownloadReason\(\{/)
  assert.match(page, /rows: itemsRef\.current,/)
  assert.match(downloadAdmission, /const current = xDriveFindVerifiedOwnerSelection\(item, rows\)/)
  assert.match(page, /const authenticatedRow = xDriveFindVerifiedOwnerSelection\(item, itemsRef\.current\)/)
  assert.match(page, /const current = xDriveFindVerifiedOwnerSelection\(item, displayedItems\)/)
  assert.match(page, /if \(!isCurrentOwner\(\) \|\| !currentScopeVerified\) return/)
  assert.doesNotMatch(source, /window\.xdriveDesktop|backup\.cgi|fetch\s*\(|OwnerToken|document\./)
})
