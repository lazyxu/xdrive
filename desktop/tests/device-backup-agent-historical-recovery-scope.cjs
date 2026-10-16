const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('historical CAS recovery is native-owning-Agent private and cannot start backup', () => {
  const impl = read('cmd/xdrive-agent/device_backup_local_first_leaf_recovery.go')
  const tests = read('cmd/xdrive-agent/device_backup_local_first_leaf_recovery_test.go')
  const cli = read('internal/client/local_push_first_file_receipt.go')
  const ipc = read('cmd/xdrive-agent/desktop_ipc.go')
  const main = read('desktop/src/main/index.cts')
  const web = read('web/src/App.tsx')
  assert.match(impl, /func \(c \*agentController\) readLocalBoundBackupHistoricalPhysicalReceipt\(/)
  for (const fence of [
    'c.localFolderGrantMu.TryLock()', 'c.localBoundBackupConfig(readCtx, sourceID)',
    'localpush.LoadRootGrant(', 'localpush.LocalInventoryPathKey(',
    'cli.ReadLocalPushFirstLeafPhysicalReceipt(',
    'localBackupRuleSessionUnchanged(account)',
    'nowProof != proof', 'nowRoot != root',
    'nowSource.TargetNodeID', 'historicalPhysicalReceiptMatches(',
  ]) assert.ok(impl.includes(fence), 'missing private fence: ' + fence)
  assert.match(tests, /TestHistoricalPhysicalReceiptMatchesDeniesAuthorityAndWrongScope/)
  assert.match(tests, /TestPrivateLocalPhysicalReceiptErrorsAreRedacted/)
  assert.match(cli, /NativeVerified\s+bool\s+`json:"-"`/)
  for (const other of [ipc, main, web]) {
    assert.equal(other.includes('readLocalBoundBackupHistoricalPhysicalReceipt'), false,
      'private Agent physical receipt must never enter Renderer, Web or IPC')
    assert.equal(other.includes('ReadLocalPushFirstLeafPhysicalReceipt'), false)
  }
  assert.doesNotMatch(impl, /\.(?:Reserve|Put|Commit|Create|Begin|Trigger|Delete|Cancel)LocalPush\w*\(/)
  assert.doesNotMatch(impl, /\bCloud[A-Z]/)
})
