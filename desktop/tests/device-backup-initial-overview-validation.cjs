const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const helper = fs.readFileSync(path.join(root, 'ui/shared/src/device-backup-device-page-validation.ts'), 'utf8')
const compiled = ts.transpileModule(helper, {
  fileName: 'device-backup-device-page-validation.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const exportsForTest = {}
new Function('exports', 'require', compiled.outputText)(exportsForTest, () => {
  throw Error('Initial owner-redacted overview validator must have no runtime imports')
})
const validate = exportsForTest.validateXDriveDeviceBackupInitialOverview
const continuation = exportsForTest.validateXDriveDeviceBackupDevicePage
const uuid = (i) => '10000000-0000-4000-8000-' + i.toString(16).padStart(12, '0')
const device = (n) => ({
  id: uuid(n), name: 'Device ' + n, platform: 'linux',
  connection_state: 'unknown', revoked: false, folders: [],
})
const page = (devices, more = false) => ({
  devices, has_more: more, has_more_folders: false,
  next_after_device_id: more ? devices.at(-1)?.id : '',
})
const run = {
  id: 'run-1', source_id: 42, run_number: 1, mode: 'backup',
  trigger: 'manual', status: 'completed',
  scanned_items: 1, scanned_bytes: 123, ignored_items: 0, new_items: 1,
  changed_items: 0, moved_items: 0, unchanged_items: 0,
  planned_transfer_bytes: 123, transferred_items: 1,
  transferred_bytes: 123, failed_items: 0, active_transfer_bytes: 0,
  active_transfer_total_bytes: 0, started_at: '2026-10-19T01:00:00Z',
}

test('first owner page accepts empty, bounded and truthful continuation cursors', () => {
  assert.doesNotThrow(() => validate(page([])))
  assert.doesNotThrow(() => validate(page([device(1)], false)))
  assert.doesNotThrow(() => validate(page(Array.from({ length: 100 }, (_, i) => device(i + 1)), true)))
  const withRun = page([{ ...device(1), folders: [{
    source_id: 42, name: 'Safe', sync_mode: 'backup', status: 'paused',
    target_path: '/Cloud/Backup', latest_run: run,
  }] }])
  assert.doesNotThrow(() => validate(withRun))
  assert.doesNotThrow(() => continuation(page([device(2)]), uuid(1), new Set([uuid(1)])),
    'previous pagination input contract must remain intact')
})

test('initial read rejects private fields, malformed pages and unsafe nested records', () => {
  const safe = page([device(1)])
  const folder = { source_id: 42, name: 'Safe', sync_mode: 'backup',
    status: 'paused', latest_run: run }
  const invalid = [
    null, { devices: [] }, { ...safe, owner_id: 2 },
    { ...safe, has_more: 'false' }, { ...safe, has_more_folders: 'false' },
    { ...safe, devices: 'not-an-array' },
    page(Array.from({ length: 101 }, (_, i) => device(i + 1))),
    page([device(1), device(1)]),
    { ...page([device(1)], true), next_after_device_id: uuid(88) },
    { ...safe, devices: [{ ...device(1), local_root: '/home/alice' }] },
    { ...safe, devices: [{ ...device(1), root_fingerprint: 'secret' }] },
    { ...safe, devices: [{ ...device(1), last_seen_at: 'not-a-date' }] },
    { ...safe, devices: [{ ...device(1), folders: [{ ...folder, ignore_rules: '*.private' }] }] },
    { ...safe, devices: [{ ...device(1), folders: [{ ...folder,
      latest_run: { ...run, error: '/home/alice/private' } }] }] },
    { ...safe, devices: [{ ...device(1), folders: [{ ...folder,
      latest_run: { ...run, active_transfer_path: '/home/alice/private' } }] }] },
    { ...safe, devices: [{ ...device(1), folders: [{ ...folder,
      latest_run: { ...run, transferred_bytes: -1 } }] }] },
    { ...safe, devices: [{ ...device(1), folders: [{ ...folder,
      latest_run: { ...run, started_at: 'unsafe' } }] }] },
  ]
  for (const payload of invalid) {
    assert.throws(() => validate(payload), /Invalid redacted backup device page/)
  }
})

test('shared Web/Mobile Web/Desktop checks initial data before React state commit', () => {
  const view = fs.readFileSync(path.join(root, 'ui/shared/src/mui/DeviceBackupPage.tsx'), 'utf8')
  const request = view.indexOf('void source.list().then((result) => {')
  const guard = view.indexOf('if (!active) return', request)
  const check = view.indexOf('validateXDriveDeviceBackupInitialOverview(result)', request)
  const commit = view.indexOf('setSnapshot({ source, overview: result, loading: false, failed: false })', request)
  assert.ok(request >= 0 && guard > request && check > guard && commit > check)
  assert.ok(view.includes('overview: prev.source === source ? prev.overview : null'))
  assert.ok(view.includes('if (active) setSnapshot((prev) => prev.source === source'))
  assert.doesNotMatch(helper, /\b(?:fetch|ipcRenderer|window|RootFingerprint|createSource|triggerRun)\b/)
})
