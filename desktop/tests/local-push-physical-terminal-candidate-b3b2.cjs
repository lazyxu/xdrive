const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')

test('B3b2 only inspects original SQL operation UPDATE and physical CAS; no writer routes', () => {
  const candidate = read('internal', 'api', 'local_push_file_terminal_commit_candidate_g2c2d2b3b2.go')
  const original = read('internal', 'api', 'local_push_historical_operation_physical_observation.go')
  const staging = read('internal', 'api', 'local_push_staging.go')
  const sql = read('internal', 'api', 'local_push_file_terminal_sql.go')
  const pinned = read('internal', 'storage', 'localpush_historical_cas_precommit.go')
  const router = read('internal', 'api', 'router.go')
  const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
  assert.ok(candidate.includes('requireFileTerminalVacant: true'))
  assert.ok(candidate.includes('local.InspectPinnedLocalPushHistoricalCASBeforeCommit, selector,'))
  assert.ok(candidate.includes('readBoundLocalPushFirstLeafReceiptWithCASInspector('))
  assert.ok(pinned.includes('func (l *Local) InspectPinnedLocalPushHistoricalCASBeforeCommit('))
  assert.ok(pinned.includes('ErrLocalPushCASPrecommitBusy'))
  assert.ok(pinned.includes('ErrLocalPushCASPrecommitOutcomeUncertain'))
  assert.ok(original.includes('originalLockStrength = "UPDATE"'))
  assert.ok(staging.includes('"status", "sync_mode", "revision", "target_node_id"'))
  assert.ok(original.includes('requireLocalPushFileTerminalVacantTx(tx, source.ID)'))
  assert.ok(original.includes('generation > ?'))
  assert.ok(sql.includes('func requireLocalPushFileTerminalVacantTx('))
  for (const invalid of ['tx.Create(', 'tx.Save(', 'tx.Delete(', 'StageVerifiedNativeOriginalBytes(', 'CommitLocalPushFirstLeafWithOperation(', 'os.Remove(', 'localpushwriter.Begin(']) {
    assert.equal(candidate.includes(invalid), false, 'a read-only candidate gained writer authority: ' + invalid)
  }
  for (const exposure of [router, agentIPC]) {
    assert.equal(exposure.includes('observeBoundLocalPushHistoricalPhysicalTerminalCandidate'), false)
  }
})
