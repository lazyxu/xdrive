const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('operation-fenced first-leaf writer remains private and precommit checked', () => {
  const writer = read('internal/api/local_push_first_file_commit.go')
  assert.match(writer, /commitBoundLocalPushFirstLeafWithCurrentOperation\(/)
  assert.match(writer, /commitBoundLocalPushFirstLeafWithInspectorAndOperation\(/)
  assert.equal((writer.match(/validateCurrentLocalPushWriterFenceTx\(/g) || []).length, 2)
  assert.match(writer, /local\.InspectMatchingLocalPushStageAndCASPinned/)
  assert.match(writer, /meta\.SourceItemStatePending/)
  for (const file of [
    'internal/api/router.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/App.tsx',
    'web/src/App.tsx',
    'ui/shared/src/mui/DeviceBackupPage.tsx',
  ]) {
    assert.doesNotMatch(read(file), /commitBoundLocalPushFirstLeafWithCurrentOperation\(/,
      file + ' must not expose private operation-fenced writer to a control surface')
  }
})
