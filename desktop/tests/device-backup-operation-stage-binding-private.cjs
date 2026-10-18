const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('private operation Stage binding is not a backup writer or remote control surface', () => {
  const binder = read('internal/api/local_push_operation_stage_binding.go')
  const schema = read('internal/meta/local_push_operation_stage_binding.go')
  assert.match(binder, /bindBoundLocalPushOperationStage\(/)
  assert.match(binder, /validateCurrentLocalPushWriterFenceTx\(/)
  assert.match(binder, /loadLocalPushStageTx\(/)
  assert.match(binder, /localPushStageReady/)
  assert.match(schema, /json:"-"/)
  assert.doesNotMatch(binder, /BeginSourceRun|SourceItemStateSynced|FileVersion\{|MirrorDelete|Retire|secretstore\.Delete|ContentBlob\{|\.Router\(/)
  for (const name of [
    'internal/api/router.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(name), /bindBoundLocalPushOperationStage|LocalPushOperationStageBinding/,
      name + ' must not expose private operation-to-stage correlation')
  }
})
