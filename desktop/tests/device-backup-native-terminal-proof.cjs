const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

test('terminal lease proof is owning-Agent held native only, never a remote backup control', () => {
  const server = read('internal/api/local_push_operation_terminal_transport.go')
  const agent = read('cmd/xdrive-agent/device_backup_local_operation_terminal_held.go')
  const client = read('internal/client/local_push_operation_terminal_proof.go')
  const router = read('internal/api/router.go')

  assert.match(server, /recordBoundLocalPushReservationTerminal\(/)
  assert.match(server, /localPushStageProof\(c\)/)
  assert.match(server, /RetirementSupported:\s*false/)
  assert.match(server, /CommitSupported:\s*false/)
  assert.match(router, /terminal-proof", localPushOperationNoStore, s\.requireLocalSourceExecutor\(\)/)
  assert.match(agent, /withBoundLocalPushHeldRequest\(/)
  assert.match(agent, /loadLocalPushPreparedReceipt\(/)
  assert.match(agent, /RecheckLocalFirstDirectoryNativeWithHeldCheckpoint\(/)
  assert.match(agent, /localFolderGrantMu\.TryLock\(/)
  assert.match(agent, /reads != 2/)
  assert.match(agent, /reads != 3/)
  assert.match(agent, /ReadLocalPushTerminalProof\(/)
  assert.match(client, /retirement_supported/)
  assert.match(client, /missing_inference_safe/)
  assert.doesNotMatch(agent,
    /mintLocalPushOperationRequestKey\(|secretstore\.Delete\(|os\.Remove\(|BeginSourceRun|SourceItemStateSynced|MirrorDelete|commitBoundLocalPushFirstLeaf/)
  for (const p of [
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'desktop/src/renderer/components/DeviceBackupPage.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
    'internal/api/local_push_operation_status_transport.go',
  ]) {
    if (!fs.existsSync(path.join(root, p))) continue
    assert.doesNotMatch(read(p),
      /withBoundLocalPushHeldTerminal|inspectLocalBoundBackupTerminalProof|LocalPushTerminalProof|localPushPrivateHeldTerminal/,
      p + ' must not expose private terminal identity')
  }
})
