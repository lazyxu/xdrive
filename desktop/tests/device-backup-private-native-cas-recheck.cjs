const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('historical native/CAS recheck is private, two-sided, bounded, non-authoritative', () => {
  const implementation = read('cmd/xdrive-agent/device_backup_local_stage_native_cas_observation.go')
  const suite = read('cmd/xdrive-agent/device_backup_local_stage_native_cas_observation_test.go')
  const staging = read('internal/localpush/native_staging_stream.go')
  const saved = read('internal/localpushstage/private_recovery_hint.go')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const router = read('internal/api/router.go')
  const renderer = read('desktop/src/main/index.cts')
  const web = read('web/src/App.tsx')

  assert.match(implementation, /func \(c \*agentController\) inspectLocalBoundBackupHistoricalNativeCAS\(/)
  assert.match(implementation, /localpushstage\.ReadLocalOriginalRecoveryHint\(/)
  assert.match(implementation, /localpush\.LocalInventoryPathKey\(/)
  assert.match(implementation, /localpush\.StreamCurrentInventoryFileToStaging\(/)
  assert.match(implementation, /c\.readLocalBoundBackupHistoricalPhysicalReceipt\(/)
  assert.match(implementation, /observeHistoricalNativeCAS\(/)
  assert.match(implementation, /localBackupRuleSessionUnchanged\(/)
  assert.match(implementation, /after\.Revision != source\.Revision/)
  assert.match(implementation, /readNative\(ctx, hint\)/)
  assert.match(implementation, /readHistorical\(/)
  assert.match(implementation, /localpushstage\.ReadLocalOriginalRecoveryHint\(/)
  assert.match(staging, /NativeIdentity\.Strong/)
  assert.match(saved, /func ReadLocalOriginalRecoveryHint\(/)
  for (const testName of [
    'TestPrivateRestartNativeCASObservationNeedsTwoReadsAndOneScopedReceipt',
    'TestPrivateRestartNativeCASObservationFailsClosedBeforeOrAfterNetwork',
    'TestPrivateRestartNativeCASReadsActualSealedOSFileTwice',
  ]) assert.ok(suite.includes('func '+testName+'('), 'missing '+testName)
  for (const surface of [agent, router, renderer, web]) {
    assert.equal(surface.includes('inspectLocalBoundBackupHistoricalNativeCAS'), false,
      'private owning-Agent native/CAS observer must not be remotely callable')
    assert.equal(surface.includes('observeHistoricalNativeCAS'), false)
  }
  assert.doesNotMatch(implementation, /\.(?:ReserveLocalPushStaging|PutLocalPushStagingBytes|CancelLocalPushStaging|CommitLocalPush|CreateSource|TriggerSource)\(/)
  assert.doesNotMatch(implementation, /(?:StageVerifiedNativeOriginalBytes|commitBoundLocalPushFirstLeaf|SourceRun|FileVersion)\(/)
})
