const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('private operation writer fence is SQL transaction held and not a backup control', () => {
  const guard = read('internal/api/local_push_operation_writer_fence.go')
  assert.match(guard, /validateCurrentLocalPushWriterFenceTx\(/)
  assert.match(guard, /localPushOperationIntentScopeTx\(/)
  assert.match(guard, /localPushFirstDirectoryDBClock\(tx\)/)
  assert.match(guard, /clause\.Locking\{Strength: "UPDATE"\}/)
  assert.match(guard, /localPushOperationRequestKeyDigest\(/)
  assert.match(guard, /subtle\.ConstantTimeCompare\(/)
  assert.match(guard, /LocalPushOperationIntentReserved/)
  assert.match(guard, /LocalPushOperationTerminalReceipt/)
  assert.match(guard, /Count\(&count\)/)
  assert.doesNotMatch(guard,
    /BeginSourceRun|SourceItemStateSynced|FileVersion\{|commitBoundLocalPushFirstLeaf\(|MirrorDelete|Mint|Retire|secretstore\.Delete|os\.Remove/)
  for (const file of [
    'internal/api/router.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(file),
      /validateCurrentLocalPushWriterFenceTx/,
      file + ' must not expose SQL precommit admission to UI/IPC/Router')
  }
})
