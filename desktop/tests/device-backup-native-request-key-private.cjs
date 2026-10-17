const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')

test('native LocalPush idempotency key is private, durable and not execution authority', () => {
  const native = read('cmd/xdrive-agent/device_backup_local_operation_request.go')
  assert.match(native, /"crypto\/rand"/)
  assert.match(native, /os\.O_EXCL/)
  assert.match(native, /secretstore\.Save\(/)
  assert.match(native, /secretstore\.Load\(/)
  assert.match(native, /scope\.sessionID/)
  assert.match(native, /scope\.rootFingerprint/)
  assert.match(native, /scope\.targetNodeID/)
  assert.match(native, /errLocalPushRequestKeyUnavailable/)
  assert.doesNotMatch(native, /\.BeginSourceRun\(|commitBoundLocalPushFirstLeaf\(|SourceItemStateSynced/)
  for (const runtime of [
    'internal/api/router.go',
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'web/src/App.tsx',
    'desktop/src/renderer/App.tsx',
  ]) {
    assert.doesNotMatch(read(runtime), /mintLocalPushOperationRequestKey|loadLocalPushOperationRequestKey|local-push-operation-key/, runtime)
  }
})
