const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('prepared LocalPush operation receipt is private durable correlation, not upload authority', () => {
  const receipt = read('cmd/xdrive-agent/device_backup_local_operation_prepared_receipt.go')
  const held = read('cmd/xdrive-agent/device_backup_local_operation_prepared_held.go')
  const key = read('cmd/xdrive-agent/device_backup_local_operation_request.go')

  assert.match(receipt, /os\.O_CREATE\|os\.O_EXCL\|os\.O_WRONLY/)
  assert.match(receipt, /secretstore\.Save\(/)
  assert.match(receipt, /secretstore\.Load\(/)
  assert.match(receipt, /loadLocalPushOperationRequestKey\(/)
  assert.match(receipt, /hmac\.New\(sha256\.New, key\.bytes\[:\]\)/)
  assert.match(receipt, /subtle\.ConstantTimeCompare\(/)
  assert.match(receipt, /localPushPreparedReceiptClaimContents/)
  assert.match(receipt, /func loadLocalPushPreparedReceipt\(/)
  assert.match(receipt, /func persistLocalPushPreparedReceipt\(/)
  assert.match(receipt, /errLocalPushRequestKeyUnavailable/)
  assert.match(key, /xdrive-localpush-request-slot-v1/)
  assert.match(held, /persistLocalPushPreparedReceipt/)
  assert.match(held, /receiptWriters\[0\]\(configDir, scope, key, candidate\)/)
  assert.ok(held.indexOf('status.State != "reserved"') <
    held.indexOf('receiptWriters[0](configDir, scope, key, candidate)'))
  assert.doesNotMatch(receipt,
    /secretstore\.Delete\(|os\.Remove\(|BeginSourceRun\(|commitBoundLocalPushFirstLeaf\(|SourceItemStateSynced|SourceRunStateCompleted|putLocalPushStageBytes/)
  assert.doesNotMatch(held,
    /BeginSourceRun\(|SourceItemStateSynced|commitBoundLocalPushFirstLeaf\(|ActivateSource/)
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
      /loadLocalPushPreparedReceipt|persistLocalPushPreparedReceipt|localPushPrivatePreparedReceipt/,
      runtime + ' must not access private prepared operation journal')
  }
})
