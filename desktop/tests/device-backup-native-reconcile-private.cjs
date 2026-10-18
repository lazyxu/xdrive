const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('restart reconciliation is only an owning-Agent held-native observation', () => {
  const reconcile = read('cmd/xdrive-agent/device_backup_local_operation_reconcile_held.go')
  const request = read('cmd/xdrive-agent/device_backup_local_operation_request.go')
  const receipt = read('cmd/xdrive-agent/device_backup_local_operation_prepared_receipt.go')
  const held = read('cmd/xdrive-agent/device_backup_local_operation_held_request.go')
  const status = read('internal/client/local_push_operation_status.go')

  assert.match(reconcile, /withBoundLocalPushHeldRequest\(/)
  assert.match(reconcile, /loadLocalPushPreparedReceipt\(/)
  assert.match(reconcile, /inspectLocalBoundBackupReconciledReceipt\(/)
  assert.match(reconcile, /RecheckLocalFirstDirectoryNativeWithHeldCheckpoint\(/)
  assert.match(reconcile, /currentClient\.ObserveLocalPushOperation\(/)
  assert.match(reconcile, /localFolderGrantMu\.TryLock\(/)
  assert.match(reconcile, /reads != 2/)
  assert.match(reconcile, /reads != 3/)
  assert.match(reconcile, /status\.State != "reserved"/)
  assert.match(reconcile, /status\.State != "aborted"/)
  assert.match(reconcile, /status\.State != "expired"/)
  assert.match(held, /loadLocalPushOperationRequestKey\(/)
  assert.match(held, /verifyBound\(checkCtx, sourceID\)/)
  assert.match(receipt, /subtle\.ConstantTimeCompare\(/)
  assert.match(request, /localPushRequestClaimContents/)
  assert.match(status, /localRulesProofHeaders\(/)
  assert.doesNotMatch(reconcile,
    /mintLocalPushOperationRequestKey\(|persistLocalPushPreparedReceipt\(|secretstore\.Delete\(|os\.Remove\(|AbortLocalPushOperation\(|PrepareLocalPushOperation\(/)
  assert.doesNotMatch(reconcile,
    /BeginSourceRun|SourceItemStateSynced|commitBoundLocalPushFirstLeaf|putLocalPushStageBytes|SourceRunStateCompleted|MirrorDelete/)
  for (const runtime of [
    'internal/api/router.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(runtime),
      /withBoundLocalPushReconciledReceipt|inspectLocalBoundBackupReconciledReceipt|localPushPrivateReconciledReceipt/,
      runtime + ' must not expose private operation recovery')
  }
})
