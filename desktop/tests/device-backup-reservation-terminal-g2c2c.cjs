const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('G2c2c reservation terminal observes the exact old native operation without permitting physical cancel', () => {
  const old = read('cmd/xdrive-agent/device_backup_local_recovery_g2c2b.go')
  const observer = read('cmd/xdrive-agent/device_backup_local_reservation_terminal_g2c2c.go')
  const client = read('internal/client/local_push_operation_terminal_proof.go')
  const server = read('internal/api/local_push_operation_terminal_receipt.go')

  assert.match(old, /func \(d \*localPushFirstLeafDriver\) readPriorFirstLeafOriginalEvidence\(/)
  assert.match(old, /localPushStageAdmissionClaimValidForRecovery\(/)
  assert.match(old, /loadLocalPushOperationRequestKey\(/)
  assert.match(old, /loadLocalPushPreparedReceipt\(/)
  assert.match(old, /selectLocalPushRecoveredFirstLeaf\(/)
  assert.match(observer, /d\.readPriorFirstLeafOriginalEvidence\(ctx, s\)/)
  assert.match(observer, /localPushPriorEvidenceUnchanged\(/)
  assert.match(observer, /WithHeldCurrentOriginalReadCheckpoint\(/)
  assert.match(observer, /d\.nativeMatches\(s, original\)/)
  assert.match(observer, /d\.api\.ReadLocalPushTerminalProof\(/)
  assert.match(observer, /d\.Check\(heldCtx, s\)/)
  assert.match(client, /RetirementSupported\s+\*bool/)
  assert.match(client, /got\.RetirementSupported == nil \|\| \*got\.RetirementSupported/)
  assert.match(server, /requireLocalPushOperationWithoutSQLCommitTx\(/)
  assert.match(server, /requireLocalPushSourceWithoutFirstLeafSQLCommitTx\(/)

  for (const forbidden of [
    'StageVerifiedNativeOriginalBytes(', 'mintLocalPushOperationRequestKey(',
    'PrepareLocalPushOperation(', 'BindLocalPushOperationStage(',
    'CommitLocalPushFirstLeafWithOperation(', 'os.Remove(',
  ]) assert.equal(observer.includes(forbidden), false, 'private observer must not contain write method ' + forbidden)
})

test('G2c2c private terminal is inaccessible to Web, Desktop and generic Agent IPC', () => {
  const name = 'inspectLocalPushFirstLeafReservationTerminalPrivate'
  for (const relative of [
    'cmd/xdrive-agent/desktop_ipc.go',
    'cmd/xdrive-agent/desktop_ipc_device_backup_config.go',
    'internal/api/router.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
  ]) assert.equal(read(relative).includes(name), false, relative + ' exposed private terminal')
  const observer = read('cmd/xdrive-agent/device_backup_local_reservation_terminal_g2c2c.go')
  assert.match(observer, /c\.localFolderGrantMu\.TryLock\(\)/)
  assert.match(observer, /newLocalPushFirstLeafDriverPrivate\(/)
  assert.match(observer, /localPushFirstLeafReservationTerminalMatches\(/)
  assert.match(observer, /"aborted" \|\| receipt\.State == "expired"/)
})
