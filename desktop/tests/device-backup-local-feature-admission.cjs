'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const helperPath = 'ui/shared/src/device-backup-local-feature-access.ts'
const helper = fs.readFileSync(path.join(root, helperPath), 'utf8')
const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui/DeviceBackupPage.tsx'), 'utf8')
const output = ts.transpileModule(helper, {
  fileName: helperPath, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((output.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', output.outputText)(mod, mod.exports)
const access = mod.exports.xDriveLocalBackupFeatureAccess
const keys = ['run','schedule','rename','target','mode','rules','preview','snapshot',
  'firstFile','delta','evidence','evidenceSummary','evidencePreflight','remove']
const supported = Object.fromEntries(keys.map(k => [k, true]))

test('local agent-owned Backup has all supported controls, but never two backup writers', () => {
  const result = access({ currentLocalDevice: true, backupMode: true, supported })
  for (const name of keys) assert.equal(result[name], name !== 'firstFile', name)
  assert.deepEqual(Object.keys(result).sort(), [...keys].sort())
})
test('remote Web/PWA/DSM observer cannot obtain any owner-only local-folder action', () => {
  for (const currentLocalDevice of [false, null, undefined, 0, 'true']) {
    const result = access({ currentLocalDevice, backupMode: true, supported })
    assert.equal(Object.values(result).every(v => v === false), true)
  }
})
test('Mirror cannot use ordinary Backup writers, but local policies remain truthful', () => {
  const result = access({ currentLocalDevice: true, backupMode: false, supported })
  assert.equal(result.run, false)
  assert.equal(result.firstFile, false)
  assert.equal(result.schedule, true)
  assert.equal(result.mode, true)
})
test('legacy single-first-file execution is only available without common batch', () => {
  const result = access({
    currentLocalDevice: true, backupMode: true,
    supported: { ...supported, run: false },
  })
  assert.equal(result.run, false)
  assert.equal(result.firstFile, true)
})
test('missing Agent capability cannot become an action even on own device', () => {
  const result = access({
    currentLocalDevice: true, backupMode: true,
    supported: Object.fromEntries(keys.map(k => [k, false])),
  })
  assert.equal(Object.values(result).every(v => v === false), true)
})
test('shared DeviceBackup page keeps Agent identity fencing and explicit native buttons', () => {
  assert.match(page, /localIdentity\.source === source/)
  assert.match(page, /verifiedLocalDeviceID === device\.id && !device\.revoked/)
  assert.match(page, /Boolean\(verifiedLocalDeviceID\)/)
  assert.match(page, /xDriveLocalBackupFeatureAccess\(\{/)
  for (const key of keys) assert.match(page, new RegExp('localActions\\.' + key + '\\b'), key)
  assert.equal((page.match(/localActions\./g) ?? []).length, keys.length)
  assert.match(page, /localOwnsFolder\(.*?\)/s)
  assert.doesNotMatch(page, /window\.xdriveDesktop|ipcRenderer/)
})
