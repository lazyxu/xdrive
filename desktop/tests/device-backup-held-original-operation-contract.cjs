const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('held original operation observation never becomes an IPC, Router, or writer', () => {
  const agent = read('cmd/xdrive-agent/device_backup_local_operation_original_held.go')
  assert.match(agent, /observeBoundLocalPushHeldOriginalOperation\(/)
  assert.match(agent, /inspectLocalBoundBackupHeldOriginalOperation\(/)
  assert.match(agent, /WithHeldCurrentOriginalReadCheckpoint\(/)
  assert.match(agent, /loadLocalPushOperationRequestKey\(/)
  assert.match(agent, /loadLocalPushPreparedReceipt\(/)
  assert.match(agent, /ObserveLocalPushOperation\(/)
  assert.match(agent, /status\.State != "reserved"/)
  assert.doesNotMatch(agent, /BeginSourceRun|SourceItemStateSynced|FileVersion\{|MirrorDelete|Retire|secretstore\.Delete/)
  for (const name of [
    'internal/api/router.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(name), /inspectLocalBoundBackupHeldOriginalOperation|observeBoundLocalPushHeldOriginalOperation/,
      name + ' must not expose owning native operation observation')
  }
})
