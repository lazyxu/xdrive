const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E1b0 uses one authorized SQL snapshot per side of physical CAS reads', () => {
  const scope = read('internal', 'api', 'local_source_commit_content_preflight.go')
  const metadata = read('internal', 'api', 'local_source_item_evidence_cloud_metadata.go')
  const tests = read('internal', 'api', 'local_source_precommit_snapshot_test.go')
  const integration = read('internal', 'api', 'local_source_commit_intents_integration_test.go')
  assert.match(metadata, /checkLocalQuarantinedCloudSnapshot\(/)
  const shared = metadata.slice(metadata.indexOf('func (s *Server) checkLocalQuarantinedCloudSnapshot('))
  assert.match(shared, /Transaction\(func\(tx \*gorm\.DB\) error/)
  assert.match(shared, /checkLocalQuarantinedEvidenceScopeTx\(/)
  assert.match(shared, /checkLocalEvidenceCloudMetadataTx\(/)
  assert.ok(shared.indexOf('checkLocalQuarantinedEvidenceScopeTx(') <
    shared.indexOf('checkLocalEvidenceCloudMetadataTx('))
  assert.match(scope, /checkLocalQuarantinedEvidenceScopeTx\(/)
  assert.match(scope, /bound != proof/)
  assert.match(metadata, /bound != proof/)
  assert.match(tests, /TestLocalQuarantinedMetadataTxScopeRequiresLiveOwningProof/)
  assert.match(integration, /Update\("ref_count", 0\)/)
  assert.match(integration, /Update\("sha256", strings\.Repeat\("f", 64\)\)/)
  const endpoint = scope.slice(scope.indexOf('func (s *Server) preflightLocalQuarantinedContent('))
  const occurrences = [...endpoint.matchAll(/checkLocalQuarantinedCloudSnapshot\(/g)].length
  assert.equal(occurrences, 2, 'CAS byte reading must be surrounded by two atomic SQL snapshots')
  assert.ok(endpoint.indexOf('checkLocalQuarantinedCloudSnapshot(') <
    endpoint.indexOf('verifyPhysicalEvidenceCAS('))
  assert.ok(endpoint.lastIndexOf('checkLocalQuarantinedCloudSnapshot(') >
    endpoint.indexOf('verifyPhysicalEvidenceCAS('))
  assert.match(endpoint, /CloudBytesVerified: false, ContentVerified: false/)
  assert.match(endpoint, /CommitSupported: false, Authoritative: false, MissingInferenceSafe: false/)
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /checkLocalQuarantinedCloudSnapshot|checkLocalEvidenceCloudMetadataTx/)
  }
  assert.doesNotMatch(shared, /BeginSourceRun|UploadChunk|CommitSourceItem|MirrorDeletion/)
})
