const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('held historical exact operation/CAS read stays inside owning Agent only', () => {
  const source = read('cmd/xdrive-agent/device_backup_local_operation_historical_physical_held.go')
  const client = read('internal/client/local_push_historical_operation_physical.go')
  assert.match(source, /WithHeldCurrentOriginalReadCheckpoint\(/)
  assert.match(source, /loadLocalPushOperationRequestKey\(/)
  assert.match(source, /loadLocalPushPreparedReceipt\(/)
  assert.match(source, /ReadLocalPushHistoricalOperationPhysicalReceipt\(/)
  assert.match(source, /observed|physical\.CASObserved/)
  assert.match(source, /inspectLocalBoundBackupHeldHistoricalOperationPhysical\(/)
  assert.match(client, /RetirementSupported/)
  assert.doesNotMatch(source,
    /BeginSourceRun|SourceItemStateSynced|MirrorDelete|secretstore\.Delete|\.Router\(/)
  for (const name of [
    'internal/api/router.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(name),
      /inspectLocalBoundBackupHeldHistoricalOperationPhysical|observeBoundLocalPushHeldHistoricalOperationPhysical/,
      name + ' must not route a private native recovery observation')
  }
})
