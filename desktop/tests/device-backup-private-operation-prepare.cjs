const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('private LocalPush prepare does not grant upload authority or renderer access', () => {
  const router = read('internal/api/router.go')
  const handler = read('internal/api/local_push_operation_prepare.go')
  const client = read('internal/client/local_push_operation_prepare.go')
  const manifest = read('internal/api/router_contract_test.go')
  const route = '/sources/:id/local-operation/prepare'
  assert.match(router, /authed\.POST\("\/sources\/:id\/local-operation\/prepare", localPushOperationNoStore, s\.requireLocalSourceExecutor\(\), s\.prepareLocalPushOperation\)/)
  assert.ok(manifest.includes('/api/v1' + route), 'coverage manifest must include private prepare')
  assert.match(handler, /reserveBoundLocalPushOperationIntentWithKey\(/)
  assert.match(handler, /localPushStageProof\(/)
  assert.match(handler, /expectedRevision\(/)
  assert.match(handler, /DisallowUnknownFields\(/)
  assert.match(handler, /MaxBytesReader\(/)
  assert.match(handler, /private, no-store/)
  assert.match(handler, /CommitSupported:\s+false/)
  assert.match(handler, /BackupComplete:\s+false/)
  assert.match(client, /PrepareLocalPushOperation\(/)
  assert.match(client, /localRulesProofHeaders\(/)
  assert.match(client, /json:"-"/)
  assert.doesNotMatch(handler, /commitBoundLocalPushFirstLeaf\(|BeginSourceRun|SourceItemStateSynced|ActivateSource|putLocalPushStageBytes|SourceRunStateCompleted/)
  assert.doesNotMatch(client, /BeginSourceRun|commitBoundLocalPushFirstLeaf|SourceItemStateSynced/)
  for (const runtime of [
    'cmd/xdrive-agent/desktop_ipc.go',
    'cmd/xdrive-agent/device_backup_local_operation_held_request.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(runtime), /PrepareLocalPushOperation|local-operation\/prepare/, runtime)
  }
})
