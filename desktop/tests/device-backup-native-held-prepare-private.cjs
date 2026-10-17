const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('native LocalPush prepares and observes only in owning held directory window', () => {
  const integration = read('cmd/xdrive-agent/device_backup_local_operation_prepared_held.go')
  const held = read('cmd/xdrive-agent/device_backup_local_operation_held_request.go')
  const native = read('internal/localpush/first_directory_native_recheck.go')
  const prep = read('internal/client/local_push_operation_prepare.go')
  const status = read('internal/client/local_push_operation_status.go')

  assert.match(integration, /withBoundLocalPushHeldRequest\(/)
  assert.match(integration, /withBoundLocalPushPreparedOperation\(/)
  assert.match(integration, /inspectLocalBoundBackupPreparedOperation\(/)
  assert.match(integration, /currentClient\.PrepareLocalPushOperation\(/)
  assert.match(integration, /currentClient\.ObserveLocalPushOperation\(/)
  assert.match(integration, /localpush\.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint\(/)
  assert.match(integration, /localpush\.LoadRootGrant\(/)
  assert.match(integration, /validBoundFirstDirectorySource\(/)
  assert.match(integration, /boundReads != 2/)
  assert.match(integration, /boundReads != 3/)
  assert.match(integration, /status\.State != "reserved"/)
  assert.match(held, /context\.WithTimeout\(checkCtx, 8\*time\.Second\)/)
  assert.match(held, /verifyBound\(checkCtx, sourceID\)/)
  assert.match(native, /openPinnedCurrentFirstDirectory\(/)
  assert.match(prep, /localRulesProofHeaders\(/)
  assert.match(status, /localRulesProofHeaders\(/)

  for (const source of [integration, held]) {
    assert.doesNotMatch(source,
      /commitBoundLocalPushFirstLeaf\(|BeginSourceRun\(|SourceItemStateSynced|putLocalPushStageBytes|ActivateSource|MirrorDelete/,
      'a private reservation cannot be an upload/SourceRun capability')
  }
  for (const path of [
    'internal/api/router.go',
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(path),
      /withBoundLocalPushPreparedOperation|inspectLocalBoundBackupPreparedOperation/,
      path + ' must not expose Agent-private preparation')
  }
})
