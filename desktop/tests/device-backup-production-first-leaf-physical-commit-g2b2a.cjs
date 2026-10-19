const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('production first-leaf physical COMMIT is owner-Agent-only and still cannot finish a backup', () => {
  const router = read('internal/api/router.go')
  const handler = read('internal/api/local_push_operation_first_leaf_commit_transport.go')
  const writer = read('internal/api/local_push_first_file_commit.go')
  const client = read('internal/client/local_push_operation_first_leaf_commit.go')
  const api = read('internal/api/local_push_operation_first_leaf_commit_integration_test.go')
  const browser = read('web/src/App.tsx')
  const desktop = read('desktop/src/main/index.cts')
  const agentIPC = read('cmd/xdrive-agent/desktop_ipc.go')

  assert.match(router, /operation-first-leaf-commit", localPushOperationNoStore, s\.requireLocalSourceExecutor\(\), s\.commitLocalPushFirstLeafOperation\)/)
  assert.match(handler, /localPushStageProof\(c\)/)
  assert.match(handler, /expectedRevision\(c\)/)
  assert.match(handler, /validLocalPushOperationPrepareKey\(req\.RequestKey\)/)
  assert.match(handler, /localPushFirstLeafPathKey\(proof\.RootID, req\.RelativeLeaf\)/)
  assert.match(handler, /s\.commitBoundLocalPushFirstLeafWithCurrentOperation\(/)
  assert.match(writer, /validateCurrentLocalPushWriterFenceTx\(/)
  assert.match(writer, /requireLocalPushStageOperationBindingTx\(/)
  assert.match(writer, /persistLocalPushFirstLeafOperationCommitTx\(/)
  assert.match(writer, /meta\.SourceItemStatePending/)
  assert.match(handler, /BackupComplete: false/)
  assert.match(handler, /NativeVerified: false/)
  assert.match(handler, /RetirementSupported: false/)
  assert.match(client, /CommitLocalPushFirstLeafWithOperation/)
  assert.match(client, /BackupComplete == nil/)
  assert.match(client, /RetirementSupported == nil/)
  for (const fn of [
    'TestLocalPushOperationFirstLeafRealHTTPCommitAndReplay',
    'TestLocalPushOperationFirstLeafHTTPRevocationCannotCommit',
  ]) {
    assert.ok(api.includes('func ' + fn + '('), 'missing physical commit/revocation coverage ' + fn)
  }

  // The existing old CI-only unsigned first-leaf route remains gated, and
  // ordinary Web/foreign Desktop cannot call the private canonical writer.
  assert.match(router, /if s\.localPushCIOnlyFirstLeaf \{/)
  for (const s of [browser, desktop, agentIPC]) {
    assert.doesNotMatch(s, /operation-first-leaf-commit|CommitLocalPushFirstLeafWithOperation|localPushFirstLeafOperationCommit/)
  }
  assert.doesNotMatch(handler, /SourceItemStateSynced|LastSyncedAt|BeginSourceRun|secretstore\.Delete|MirrorDelete/)
})
