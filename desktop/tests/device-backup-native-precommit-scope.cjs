const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('native precommit remains Agent-private and never an exposed backup action', () => {
  const impl = read('internal/localpushstage/native_commit_preflight.go')
  const transport = read('internal/localpushstage/native_bytes_transport.go')
  const goTests = read('internal/localpushstage/native_commit_preflight_test.go')
  const api = read('internal/api/router.go')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const desktop = read('desktop/src/main/index.cts')
  const shared = read('ui/shared/src/mui/DeviceBackupPage.tsx')
  assert.match(impl, /func PreflightStagedNativeOriginalForCommit\(/)
  assert.match(impl, /localpush\.StreamCurrentInventoryFileToStaging/)
  assert.match(impl, /localpush\.VerifyInventoryJournal/)
  assert.match(impl, /c\.ReadLocalPushStaging\(/)
  assert.match(impl, /c\.PreflightLocalPushStagingPhysical\(/)
  assert.match(transport, /SnapshotSHA256: current\.SnapshotSHA256/)
  assert.match(goTests, /TestPrivateNativeStagePrecommitRehashesOriginalAndPhysicalStage/)
  assert.match(goTests, /TestPrivateNativeStagePrecommitFailsClosed/)
  for (const raw of [api, agent, desktop, shared]) {
    assert.equal(raw.includes('PreflightStagedNativeOriginalForCommit'), false,
      'private precommit must not cross REST, IPC, renderer or Web')
  }
  assert.doesNotMatch(impl, /\b(?:Create|Delete|Commit|BeginRun|TriggerSource)\w*\(/)
})
