const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('local Push operation intent stays private, non-executable and never a renderer capability', () => {
  const model = read('internal/meta/local_push_operation_intent.go')
  const impl = read('internal/api/local_push_operation_intent.go')
  const migration = read('cmd/server/main.go')
  assert.match(model, /type LocalPushOperationIntent struct/)
  assert.match(migration, /&meta\.LocalPushOperationIntent\{\}/)
  for (const field of ['ID', 'SourceID', 'Generation', 'OwnerID', 'OwnerSession', 'SourceRevision', 'TargetNodeID', 'DeviceID', 'RootID', 'RootFingerprint', 'State', 'IssuedAt', 'ExpiresAt', 'AbortedAt']) {
    assert.match(model, new RegExp('\\b' + field + '\\s+[^\\n]+json:"-"'), field + ' leaked through JSON')
  }
  assert.match(impl, /func \(s \*Server\) reserveBoundLocalPushOperationIntent\(/)
  assert.match(impl, /func \(s \*Server\) abortBoundLocalPushOperationIntent\(/)
  assert.match(impl, /checkLocalPushStageScopeTx\(/)
  assert.match(impl, /localPushFirstDirectoryDBClock\(/)
  assert.match(impl, /generation DESC/)
  assert.doesNotMatch(impl, /\.BeginRun\(|\.commitBoundLocalPushFirstLeaf\(|\.commitBoundLocalPushFirstDirectoryTx\(|meta\.SyncRun\{|SourceItemStateSynced|meta\.FileVersion\{/)
  for (const file of [
    'internal/api/router.go',
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'web/src/App.tsx',
  ]) {
    assert.doesNotMatch(read(file), /reserveBoundLocalPushOperationIntent|abortBoundLocalPushOperationIntent|local-push-operation-intent/, file + ' exposed private operation control')
  }
})
