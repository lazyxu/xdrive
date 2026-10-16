const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('owning first-directory observation never becomes Router or Desktop backup control', () => {
  const impl = read('cmd/xdrive-agent/device_backup_local_first_directory_bound.go')
  assert.match(impl, /func \(c \*agentController\) inspectLocalBoundBackupFirstDirectoryNative\(/)
  assert.match(impl, /localpush\.RecheckLocalFirstDirectoryNative\(/)
  assert.match(impl, /c\.localBoundBackupConfig\(/)
  assert.match(impl, /againProof != proof/)
  assert.match(impl, /localBackupRuleSessionUnchanged\(account\)/)
  assert.doesNotMatch(impl, /(?:TriggerSource|CommitSourceRun|DeleteSource|CommitBoundLocalPushFirstDirectory)\(/)
  for (const file of [
    'cmd/xdrive-agent/desktop_ipc.go',
    'internal/api/router.go',
    'internal/client/sources.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'web/src/App.tsx',
  ]) {
    assert.doesNotMatch(read(file), /inspectLocalBoundBackupFirstDirectoryNative/)
  }
})
