const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E0e replays only exact recovered owning-Agent quarantined evidence', () => {
  const oldAgent = read('cmd', 'xdrive-agent', 'device_backup_local_commit_intents.go')
  const replay = read('cmd', 'xdrive-agent', 'device_backup_local_commit_replay.go')
  const recovery = read('cmd', 'xdrive-agent', 'device_backup_local_commit_recovery.go')
  const privateTests = read('cmd', 'xdrive-agent', 'device_backup_local_commit_replay_test.go')
  assert.match(oldAgent, /quarantineLocalBoundBackupEvidencePageExpected\(/)
  assert.match(oldAgent, /expectedIDs != nil && \(expectedRevision == 0 \|\| source\.Revision != expectedRevision\)/)
  assert.match(oldAgent, /localQuarantineReplayMatches\(ids, expectedIDs\)/)
  assert.match(oldAgent, /localpush\.HashCurrentLocalEvidenceBatch\(/)
  assert.match(oldAgent, /cli\.CheckLocalSourceItemCloudMetadata\(/)
  assert.match(oldAgent, /submitLocalQuarantineBatch\(/)
  assert.ok(oldAgent.indexOf('localQuarantineReplayMatches(ids, expectedIDs)') <
    oldAgent.indexOf('submitLocalQuarantineBatch(' , oldAgent.indexOf('quarantineLocalBoundBackupEvidencePageExpected(')))
  assert.match(oldAgent, /proofNow != proof/)
  assert.match(replay, /readLocalBoundBackupQuarantineRecoveryPage\(/)
  assert.match(replay, /quarantineLocalBoundBackupEvidencePageExpected\(/)
  assert.match(replay, /localQuarantineReplayConfirmed\(/)
  assert.match(privateTests, /TestLocalQuarantineReplayMatchesExactRecoveredIDs/)
  assert.match(privateTests, /TestLocalQuarantineReplayConfirmedRequiresOnlyExactIdempotentCount/)
  assert.match(recovery, /LoadLocalReconcileEvidence\(/)
  for (const privateSource of [oldAgent, replay]) {
    assert.doesNotMatch(privateSource, /BeginSourceRun|UploadChunk|CommitSourceItem|MirrorDeletion/)
  }
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /replayLocalBoundBackupQuarantinePage|quarantineLocalBoundBackupEvidencePageExpected|device-backup-local-quarantine-replay/)
  }
})
