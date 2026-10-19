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
const safeLatestRun = {
  id: 'run-37', source_id: 37, run_number: 1, mode: 'backup',
  trigger: 'manual', status: 'completed',
  scanned_items: 2, scanned_bytes: 200, ignored_items: 0,
  new_items: 2, changed_items: 0, moved_items: 0,
  unchanged_items: 0, planned_transfer_bytes: 200,
  transferred_items: 2, transferred_bytes: 200, failed_items: 0,
  active_transfer_bytes: 0, active_transfer_total_bytes: 0,
  started_at: '2026-10-19T01:00:00Z',
}

test('paged device folders accept a complete safe redacted latest run', () => {
  const safe = {
    folders: [{ ...folder(37), target_path: '/Cloud/Backup', latest_run: safeLatestRun }],
    has_more: false, next_after_source_id: 0,
  }
  assert.doesNotThrow(() => validate(safe, 36))
  assert.doesNotThrow(() => validate({ folders: [{ ...folder(37),
    latest_run: { ...safeLatestRun, finished_at: '2026-10-19T01:01:00Z',
      cancel_requested_at: '2026-10-19T01:00:59Z' } }],
    has_more: false, next_after_source_id: 0 }, 36))
})

test('paged device folders fail closed on extra private nested fields and malformed runs', () => {
  const f = folder(37)
  const safe = { folders: [{ ...f, latest_run: safeLatestRun }],
    has_more: false, next_after_source_id: 0 }
  const bad = [
    { ...safe, owner_id: 42 },
    { ...safe, device_root: '/private/root' },
    { ...safe, folders: [{ ...f, root_fingerprint: 'PRIVATE-ROOT' }] },
    { ...safe, folders: [{ ...f, local_path: '/home/alice/private' }] },
    { ...safe, folders: [{ ...f, ignore_rules: '**/secrets' }] },
    { ...safe, folders: [{ ...f, latest_run: null }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, error: '/private/error' } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, active_transfer_path: '/home/private' } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, source_id: 1 } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, id: '/private/id' } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, started_at: 'invalid' } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, finished_at: 'not-a-date' } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, run_number: -1 } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, transferred_bytes: 1.5 } }] },
    { ...safe, folders: [{ ...f, latest_run: { ...safeLatestRun, failed_items: Number.MAX_SAFE_INTEGER + 1 } }] },
  ]
  for (const payload of bad) {
    assert.throws(() => validate(payload, 36), /Invalid redacted backup folder page/)
  }
})

test('paged folder nested verification precedes shared UI state acceptance with the old request fences', () => {
  const component = fs.readFileSync(path.join(root, 'ui/shared/src/mui/DeviceBackupPage.tsx'), 'utf8')
  const pageStart = component.indexOf('const page = await source.foldersPage(deviceID, 100, cursor)')
  const epochFence = component.indexOf('folderScopeRef.current.epoch !== scope', pageStart)
  const validateCall = component.indexOf('validateXDriveDeviceBackupFolderPage(page, cursor)', pageStart)
  const stateCommit = component.indexOf('setFolderReadState((prev) => {', validateCall)
  assert.ok(pageStart > 0 && epochFence > pageStart && validateCall > epochFence &&
    stateCommit > validateCall, 'untrusted nested Source/run fields must never precede the page validator')
  assert.doesNotMatch(helper, /\b(?:fetch|ipcRenderer|window|RootFingerprint|createSource|triggerRun)\b/)
})
