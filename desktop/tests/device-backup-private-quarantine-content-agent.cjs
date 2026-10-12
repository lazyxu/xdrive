const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E1a3 owning-Agent quarantine content check has no desktop/web exposure', () => {
  const agent = read('cmd', 'xdrive-agent', 'device_backup_local_commit_content_preflight.go')
  const agentTests = read('cmd', 'xdrive-agent', 'device_backup_local_commit_content_preflight_test.go')
  assert.match(agent, /preflightLocalBoundBackupQuarantinedPhysicalPage\(/)
  assert.match(agent, /localFolderGrantMu\.TryLock\(\)/)
  assert.match(agent, /ReadLocalSourceCommitIntentPage\(/)
  assert.match(agent, /ReadLocalSourceItemEvidencePage\(/)
  assert.match(agent, /localQuarantinedPhysicalCandidates\(/)
  assert.match(agent, /HashCurrentLocalEvidenceBatch\(/)
  assert.match(agent, /CheckLocalSourceItemCloudMetadata\(/)
  assert.match(agent, /PreflightLocalQuarantinedPhysicalContentBatch\(/)
  assert.match(agent, /localBackupRuleSessionUnchanged\(/)
  assert.match(agent, /CloudBytesVerified\s+bool/)
  assert.match(agentTests, /TestLocalQuarantinedPhysicalCandidatesExactOnly/)
  assert.match(agentTests, /TestLocalQuarantinedPhysicalClaimsWithinBudget/)
  assert.doesNotMatch(agent, /QuarantineLocalSourceCommitIntents\(|BeginSourceRun|UploadChunk|CommitSourceItem|MirrorDeletion/)
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /preflightLocalBoundBackupQuarantinedPhysicalPage|local-quarantine-physical-page/)
  }
})
