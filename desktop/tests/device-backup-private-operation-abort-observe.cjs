const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('owning-only private operation abort and observe remain non-operational', () => {
  const router = read('internal/api/router.go')
  const handler = read('internal/api/local_push_operation_status_transport.go')
  const client = read('internal/client/local_push_operation_status.go')
  const coverage = read('internal/api/router_contract_test.go')

  for (const [action, handlerName] of [
    ['abort', 'abortLocalPushOperation'],
    ['observe', 'observeLocalPushOperation'],
  ]) {
    const url = '/sources/:id/local-operation/' + action
    assert.ok(
      router.includes('authed.POST("' + url + '", localPushOperationNoStore, s.requireLocalSourceExecutor(), s.' + handlerName + ')'),
      'owning device and Root middleware required for ' + action,
    )
    assert.ok(coverage.includes('/api/v1' + url), 'missing Go API route coverage')
  }
  assert.match(handler, /abortBoundLocalPushOperationIntent\(/)
  assert.match(handler, /observeBoundLocalPushOperationIntent\(/)
  assert.match(handler, /readLocalPushOperationStatusRequest\(/)
  assert.match(handler, /MaxBytesReader\(/)
  assert.match(handler, /DisallowUnknownFields\(/)
  assert.match(handler, /expectedRevision\(/)
  assert.match(handler, /localPushStageProof\(/)
  assert.match(handler, /private, no-store/)
  assert.match(handler, /func localPushOperationNoStore\(c \*gin\.Context\)/)
  assert.match(handler, /CommitSupported: false, BackupComplete: false/)
  assert.match(client, /ObserveLocalPushOperation\(/)
  assert.match(client, /AbortLocalPushOperation\(/)
  assert.match(client, /localRulesProofHeaders\(/)
  assert.match(client, /json:"-"/)
  for (const source of [handler, client]) {
    assert.doesNotMatch(source, /BeginSourceRun|SourceItemStateSynced|commitBoundLocalPushFirstLeaf|putLocalPushStageBytes/)
  }
  for (const runtime of [
    'cmd/xdrive-agent/desktop_ipc.go',
    'cmd/xdrive-agent/device_backup_local_operation_held_request.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(runtime), /AbortLocalPushOperation|ObserveLocalPushOperation|local-operation\/(abort|observe)/, runtime)
  }
})
