const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(repo, p), 'utf8')

test('durable LocalPush request key can be used only in an owning held native window', () => {
  const held = read('cmd/xdrive-agent/device_backup_local_operation_held_request.go')
  const owner = read('cmd/xdrive-agent/device_backup_local_first_directory_bound.go')
  const native = read('internal/localpush/first_directory_native_recheck.go')
  assert.match(held, /observeLocalBoundFirstDirectoryHeld\(/)
  assert.match(held, /checkpoint\(checkCtx, candidate\)/)
  assert.match(held, /loadLocalPushOperationRequestKey\(/)
  assert.match(held, /mintLocalPushOperationRequestKey\(/)
  assert.match(held, /verifyBound\(checkCtx, sourceID\)/)
  assert.match(held, /sameBoundFirstDirectorySource\(/)
  assert.match(held, /localpush\.LoadRootGrant\(/)
  assert.match(held, /localpush\.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint\(/)
  assert.match(held, /context\.WithTimeout\(checkCtx, 8\*time\.Second\)/)
  assert.match(owner, /checkpoints != 1/)
  assert.match(native, /openPinnedCurrentFirstDirectory\(/)
  assert.doesNotMatch(held, /commitBoundLocalPushFirstLeaf\(|BeginSourceRun|SourceItemStateSynced|ActivateSource|RemoteControl/)
  for (const runtime of [
    'internal/api/router.go',
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
  ]) {
    assert.doesNotMatch(read(runtime), /withOwnLocalPushFirstDirectoryRequest|withBoundLocalPushHeldRequest/, runtime)
  }
})
