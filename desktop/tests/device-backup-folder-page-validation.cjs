const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const helper = fs.readFileSync(path.join(root, 'ui/shared/src/device-backup-folder-page-validation.ts'), 'utf8')
const compiled = ts.transpileModule(helper, {
  fileName: 'device-backup-folder-page-validation.ts',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const validationExports = {}
new Function('exports', 'require', compiled.outputText)(validationExports, () => {
  throw new Error('The redacted backup page validator must not import mutable Source or network code')
})
const validate = validationExports.validateXDriveDeviceBackupFolderPage
const folder = id => ({ source_id: id, name: 'Backup ' + id, status: 'paused', sync_mode: 'backup' })
const page = (ids, hasMore = false, next = hasMore ? ids.at(-1) : 0) => ({
  folders: ids.map(folder), has_more: hasMore, next_after_source_id: next,
})

test('verified folder keysets consume 1003 entries in bounded, strictly increasing pages', () => {
  const ids = Array.from({ length: 1003 }, (_, i) => i + 1)
  let cursor = 0
  const observed = []
  for (let start = 0; start < ids.length; start += 100) {
    const part = ids.slice(start, start + 100)
    const hasMore = start + part.length < ids.length
    const response = page(part, hasMore)
    assert.doesNotThrow(() => validate(response, cursor))
    observed.push(...part)
    cursor = response.next_after_source_id
  }
  assert.equal(cursor, 0)
  assert.equal(observed.length, 1003)
  assert.equal(new Set(observed).size, 1003)
  assert.deepEqual(observed, ids)
  assert.doesNotThrow(() => validate(page([]), 0))
})

test('never accept corrupt, unsorted, repeated or forged complete backup-folder pages', () => {
  const good = page([21, 22], true)
  const invalid = [
    [page([22, 21]), 20],
    [page([21, 21]), 20],
    [page([19, 22]), 20],
    [page([20]), 20],
    [page([21], true, 19), 20],
    [page([21], true, 25), 20],
    [page([], true, 25), 20],
    [page([21], false, 21), 20],
    [{ ...good, folders: Array.from({ length: 101 }, (_, i) => folder(i + 21)) }, 20],
    [{ ...good, folders: [folder(Number.MAX_SAFE_INTEGER + 1)] }, 20],
    [{ ...good, folders: [folder(21), { ...folder(22), source_id: NaN }] }, 20],
    [{ ...good, folders: [null] }, 20],
    [{ ...good, folders: [{ ...folder(21), name: 42 }] }, 20],
    [{ ...good, folders: [{ ...folder(21), sync_mode: 'push' }] }, 20],
    [{ ...good, folders: [{ ...folder(21), target_path: { root: '/home/secret' } }] }, 20],
    [{ ...good, folders: 'not an array' }, 20],
    [{ ...good, has_more: 'false' }, 20],
    [{ ...good, next_after_source_id: -1 }, 20],
    [null, 20],
    [good, -1],
    [good, Number.MAX_SAFE_INTEGER + 1],
  ]
  for (const [payload, cursor] of invalid) {
    assert.throws(() => validate(payload, cursor), /Invalid redacted backup folder page/)
  }
  // Fail closed on a malformed final page; UI keeps the previously read rows
  // and must not promote a bad page to completed state.
  assert.throws(() => validate(page([15, 25]), 20))
  assert.doesNotThrow(() => validate(page([21, 22]), 20))
})

test('one shared read-only page calls the verifier before mutating paginated UI state', () => {
  const component = fs.readFileSync(path.join(root, 'ui/shared/src/mui/DeviceBackupPage.tsx'), 'utf8')
  assert.match(component, /validateXDriveDeviceBackupFolderPage\(page, cursor\)/)
  const validatePosition = component.indexOf('validateXDriveDeviceBackupFolderPage(page, cursor)')
  const mutatePosition = component.indexOf('setFolderReadState((prev) => {', validatePosition)
  assert.ok(mutatePosition > validatePosition)
  assert.match(component, /folderScopeRef\.current\.epoch !== scope/)
  assert.match(component, /folderRequestIDs\.current\[deviceID\] !== requestID/)
  assert.match(component, /localOwnsFolder\(renameTarget\.id\)/)
  assert.match(component, /localOwnsFolder\(removeTarget\.id\)/)
  assert.doesNotMatch(helper, /\b(?:fetch|ipcRenderer|window|RootFingerprint|createSource|triggerRun)\b/)
})
