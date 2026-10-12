const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E0d private owning Agent only reads quarantined proposals after native revalidation', () => {
  const agent = read('cmd', 'xdrive-agent', 'device_backup_local_commit_recovery.go')
  const client = read('internal', 'client', 'local_source_commit_intent_page.go')
  const testAgent = read('cmd', 'xdrive-agent', 'device_backup_local_commit_recovery_test.go')
  assert.match(agent, /localFolderGrantMu\.TryLock\(\)/)
  assert.match(agent, /localBoundBackupConfig\(readCtx, sourceID\)/)
  assert.match(agent, /LoadRootGrant\(configDir, cfg\.Server, cfg\.Username, proof\.RootID\)/)
  assert.match(agent, /LoadLocalReconcileEvidence\(readCtx, configDir, grant, source\.Revision\)/)
  assert.match(agent, /ReadLocalSourceCommitIntentPage\(/)
  assert.match(agent, /generationNow\.IntegritySHA256 != generations\.IntegritySHA256/)
  assert.match(agent, /rulesNow\.IgnoreRules != rules\.IgnoreRules/)
  assert.match(agent, /localBackupRuleSessionUnchanged\(cfg\)/)
  assert.match(agent, /proofNow != proof/)
  assert.match(agent, /validateLocalQuarantineRecoveryPage\(/)
  assert.match(testAgent, /TestValidateLocalQuarantineRecoveryPageFailsClosed/)
  assert.match(client, /got\.CommitSupported == nil/)
  assert.doesNotMatch(agent, /BeginSourceRun|CommitSourceItem|UploadChunk|MirrorDeletion/)
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /readLocalBoundBackupQuarantineRecoveryPage|device-backup-local-quarantine-recovery/)
  }
})
