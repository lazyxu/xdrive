const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('private LocalPush operation request digests are not renderer credentials', () => {
  const model = read('internal/meta/local_push_operation_intent.go')
  const implementation = read('internal/api/local_push_operation_intent.go')
  assert.match(model, /RequestKeyDigest\s+\*string[^\n]+json:"-"/)
  assert.match(model, /uniqueIndex:idx_xd_local_push_op_request,priority:1/)
  assert.match(model, /uniqueIndex:idx_xd_local_push_op_request,priority:2/)
  assert.match(implementation, /localPushOperationRequestKeyDigest\(/)
  assert.match(implementation, /reserveBoundLocalPushOperationIntentWithKey\(/)
  assert.match(implementation, /reserveBoundLocalPushOperationIntentInternal\(/)
  assert.match(implementation, /localPushOperationIntentScopeTx\(/)
  assert.match(implementation, /prior\.OwnerSession != owner\.SessionVersion/)
  assert.match(implementation, /prior\.RootFingerprint != fingerprint/)
  assert.match(implementation, /now\.Before\(prior\.IssuedAt\)/)
  assert.doesNotMatch(implementation, /\.BeginRun\(|SourceItemStateSynced|commitBoundLocalPushFirstLeaf\(/)
  for (const runtime of [
    'internal/api/router.go',
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'web/src/App.tsx',
  ]) {
    assert.doesNotMatch(read(runtime), /reserveBoundLocalPushOperationIntentWithKey|local-push-operation-request-key/, runtime)
  }
})
