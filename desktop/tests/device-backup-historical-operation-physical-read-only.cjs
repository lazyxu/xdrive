const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('owned historical SQL/CAS HTTP read remains device-only and never a backup executor', () => {
  const router = read('internal/api/router.go')
  const transport = read('internal/api/local_push_historical_operation_physical_transport.go')
  const client = read('internal/client/local_push_historical_operation_physical.go')
  assert.match(router, /operation-physical-receipt", localPushOperationNoStore, s\.requireLocalSourceExecutor\(\)/)
  assert.match(transport, /observeBoundLocalPushHistoricalOperationPhysicalCommit\(/)
  assert.match(transport, /validLocalPushOperationPrepareKey\(/)
  assert.match(client, /ReadLocalPushHistoricalOperationPhysicalReceipt\(/)
  assert.match(client, /RetirementSupported/)
  assert.doesNotMatch(transport, /BeginSourceRun|SourceItemStateSynced|MirrorDelete|secretstore\.Delete|\.Router\(/)
  assert.doesNotMatch(client, /BeginSourceRun|SourceItemStateSynced|MirrorDelete|secretstore\.Delete/)
  for (const filename of [
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(filename),
      /ReadLocalPushHistoricalOperationPhysicalReceipt|readLocalPushHistoricalOperationPhysical|operation-physical-receipt/,
      filename + ' must not expose a private operation key or execution control')
  }
})
