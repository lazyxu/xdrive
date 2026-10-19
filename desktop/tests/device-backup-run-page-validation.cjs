const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const helper = fs.readFileSync(path.join(root, 'ui/shared/src/device-backup-run-page-validation.ts'), 'utf8')
const compiled = ts.transpileModule(helper, {
  fileName: 'device-backup-run-page-validation.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter((x) => x.category === ts.DiagnosticCategory.Error).length, 0)
const exportsForTest = {}
new Function('exports', 'require', compiled.outputText)(exportsForTest, () => {
  throw new Error('Redacted run page validation must have no runtime imports')
})
const validate = exportsForTest.validateXDriveDeviceBackupRunPage
const sourceID = 42
const run = (n) => ({
  id: 'run-' + n, source_id: sourceID, run_number: n, mode: 'sync', trigger: 'manual',
  status: 'completed', scanned_items: n, scanned_bytes: n * 100,
  ignored_items: 0, new_items: n, changed_items: 0, moved_items: 0,
  unchanged_items: 0, planned_transfer_bytes: n * 100,
  transferred_items: n, transferred_bytes: n * 100, failed_items: 0,
  active_transfer_bytes: 0, active_transfer_total_bytes: 0,
  started_at: new Date(Date.UTC(2026, 9, 19, 8, 0, 0) - n * 1000).toISOString(),
})
const page = (runs, hasMore = false) => ({ items: runs, has_more: hasMore })

test('accept 20-item bounded page followed by an empty or partial final page', () => {
  const first = Array.from({ length: 20 }, (_, n) => run(n + 1))
  assert.doesNotThrow(() => validate(page(first, true), sourceID, 20, 0))
  assert.doesNotThrow(() => validate(page([run(21), run(22)]), sourceID, 20, 20))
  assert.doesNotThrow(() => validate(page([]), sourceID, 20, 40))
  assert.doesNotThrow(() => validate(page([run(1)]), sourceID, 1, 0))
})

test('reject wrong Source, duplicate, unsorted, fake cursor, unsafe numbers and raw extra fields', () => {
  const valid = run(2)
  const broken = [
    page([run(1), run(1)]),
    page([run(3), run(2)]),
    page([run(1)], true),
    page([], true),
    page([run(1), { ...valid, source_id: 99 }]),
    page([{ ...valid, started_at: 'not-a-date' }]),
    page([{ ...valid, started_at: '/home/private/file' }]),
    page([{ ...valid, transferred_bytes: -1 }]),
    page([{ ...valid, scanned_items: Number.MAX_SAFE_INTEGER + 1 }]),
    page([{ ...valid, active_transfer_total_bytes: NaN }]),
    page([{ ...valid, finished_at: { error: '/home/private' } }]),
    page([{ ...valid, active_transfer_path: '/home/private/file' }]),
    page([{ ...valid, error: '/home/private/file' }]),
    page([{ ...valid, status: '' }]),
    page([{ ...valid, id: '../../private' }]),
    { items: 'not-array', has_more: false },
    { items: [run(1)], has_more: 'false' },
    null,
  ]
  for (const payload of broken) {
    assert.throws(() => validate(payload, sourceID, 20, 0), /Invalid redacted backup run page/)
  }
  for (const args of [
    [0, 20, 0], [sourceID, 0, 0], [sourceID, 101, 0],
    [sourceID, 20, -1], [sourceID, 20, Number.MAX_SAFE_INTEGER],
  ]) {
    assert.throws(() => validate(page([]), ...args), /Invalid redacted backup run page/)
  }
})

test('shared Desktop/Web history must validate before committing or marking a page verified', () => {
  const component = fs.readFileSync(path.join(root, 'ui/shared/src/mui/DeviceBackupPage.tsx'), 'utf8')
  const request = component.indexOf('const data = await source.runs(id, pageSize, (page - 1) * pageSize)')
  const check = component.indexOf('validateXDriveDeviceBackupRunPage(data, id, pageSize, (page - 1) * pageSize)', request)
  const stateCommit = component.indexOf('setHistoryState((prev) => {', request)
  assert.ok(request >= 0 && check > request && stateCommit > check)
  assert.ok(component.includes('if (prev.source !== source) return prev'))
  assert.ok(component.includes('if (requests.current[id] !== request) return'))
  assert.doesNotMatch(helper, /\b(?:fetch|ipcRenderer|window|RootFingerprint|createSource|triggerRun)\b/)
})
