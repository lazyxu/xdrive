const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('actual native→Gin→CAS→SQL first leaf proof stays internal only', () => {
  const spec = read('internal/api/local_push_native_to_canonical_first_leaf_integration_test.go')
  const router = read('internal/api/router.go')
  const writer = read('internal/api/local_push_first_file_commit.go')
  const desktop = read('desktop/src/main/index.cts')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const web = read('web/src/App.tsx')
  for (const token of [
    'localpushstage.StageVerifiedNativeOriginalBytes(',
    'localpushstage.PreflightStagedNativeOriginalForCommit(',
    'app.Router()',
    'f.server.quarantineBoundLocalPushCASPrepareIntent(',
    'f.server.prepareQuarantinedBoundLocalPushNewCAS(',
    'f.server.reserveBoundLocalPushQuota(',
    'f.server.commitBoundLocalPushFirstLeaf(',
    'f.server.readBoundLocalPushFirstLeafPhysicalReceipt(',
    'meta.SourceItemStatePending',
    'source.Status != meta.SourceStatusPaused',
    'f.stagePUTs.Load() != 1',
  ]) {
    assert.ok(spec.includes(token), 'real private chain missing stage: ' + token)
  }
  for (const caseName of [
    'TestLocalPushRealNativeToGinCASToFirstLeafPrivateSQLCommit',
    'TestLocalPushRealNativeBeforeCASCommitRejectsChangedOriginal',
    'TestLocalPushRealNativeBeforeCASCommitRejectsChangedServerStage',
    'TestLocalPushRealNativeCASWriteRequiresOwningDeviceAfterPrecommit',
  ]) {
    assert.ok(spec.includes('func ' + caseName + '('), 'missing native negative case ' + caseName)
  }
  assert.match(writer, /func \(s \*Server\) commitBoundLocalPushFirstLeaf\(/)
  for (const surface of [router, desktop, agent, web]) {
    assert.equal(surface.includes('commitBoundLocalPushFirstLeaf'), false,
      'private first-file writer unexpectedly exposed to a live client')
  }
})
