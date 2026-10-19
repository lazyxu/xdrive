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
const validationExports = {}
new Function('exports', 'require', compiled.outputText)(validationExports, () => {
  throw new Error('The device page validator must not import mutable Source or network code')
})
const validate = validationExports.validateXDriveDeviceBackupDevicePage
const uuid = (i) => '10000000-0000-4000-8000-' + i.toString(16).padStart(12, '0')
const device = (i) => ({
  id: uuid(i), name: 'Desktop ' + i, platform: 'linux', connection_state: 'unknown',
  revoked: false, folders: [],
})
const page = (ids, hasMore = false, next = hasMore && ids.length ? uuid(ids.at(-1)) : '') => ({
  devices: ids.map(device), has_more: hasMore, has_more_folders: false,
  next_after_device_id: next,
})

test('validated continuation retains 103 owner devices beyond the 100-device overview cap', () => {
  const seen = new Set([uuid(0)])
  let cursor = uuid(0)
  for (const ids of [Array.from({ length: 100 }, (_, i) => i + 1), [101, 102, 103]]) {
    const response = page(ids, ids.length === 100)
    assert.doesNotThrow(() => validate(response, cursor, seen))
    for (const result of response.devices) seen.add(result.id)
    cursor = response.next_after_device_id || ''
  }
  assert.equal(seen.size, 104)
  assert.equal(cursor, '')
})

test('reject malformed, duplicate, cross-page and fabricated terminal device pages', () => {
  const anchor = uuid(0)
  const good = page([1, 2], true)
  const invalid = [
    page([1, 1], true), page([1], true, uuid(50)), page([], true),
    { ...good, has_more: 'false' }, { ...good, has_more_folders: null },
    { ...good, devices: 'not-an-array' },
    { ...good, devices: Array.from({ length: 101 }, (_, i) => device(i + 1)) },
    { ...good, devices: [{ ...device(1), id: '../root' }] },
    { ...good, devices: [{ ...device(1), connection_state: 'connected' }] },
    { ...good, devices: [{ ...device(1), revoked: 'false' }] },
    { ...good, devices: [{ ...device(1), folders: [{ source_id: 2, name: 'A', status: 'paused', sync_mode: 'unexpected' }] }] },
    { ...good, devices: [{ ...device(1), folders: [{ source_id: 2, name: 'A', status: 'paused', sync_mode: 'backup', latest_run: { status: 'completed', source_id: 99 } }] }] },
    { ...page([1]), next_after_device_id: uuid(1) },
    null,
  ]
  for (const response of invalid) {
    assert.throws(() => validate(response, anchor, new Set()), /Invalid redacted backup device page/)
  }
  assert.throws(() => validate(good, anchor, new Set([uuid(1)])), /Invalid redacted backup device page/)
  assert.throws(() => validate(page([1], true), 'not-a-uuid', new Set()), /Invalid redacted backup device page/)
  assert.doesNotThrow(() => validate(page([1]), anchor, new Set()))
})

test('Web and Desktop share one validator before committing the continuation to presentation state', () => {
  const component = fs.readFileSync(path.join(root, 'ui/shared/src/mui/DeviceBackupPage.tsx'), 'utf8')
  const request = component.indexOf('const page = await source.listPage(100, cursor)')
  const validation = component.indexOf('validateXDriveDeviceBackupDevicePage(page, cursor', request)
  const commit = component.indexOf('setSnapshot((prev) => {', request)
  assert.ok(request >= 0 && validation > request && commit > validation)
  assert.ok(component.includes('prev.source !== source || prev.overview !== requestedOverview'))
  assert.ok(component.includes('if (seen.has(device.id)) continue'))
  assert.doesNotMatch(helper, /\b(?:fetch|ipcRenderer|window|RootFingerprint|createSource|triggerRun)\b/)
})
