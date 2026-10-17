const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('operation intent observation remains private and read-only', () => {
  const source = read('internal/api/local_push_operation_observe.go')
  for (const fragment of [
    'func (s *Server) observeBoundLocalPushOperationIntent(',
    'localPushOperationIntentScopeTx(',
    'localPushFirstDirectoryDBClock(',
    'Order("generation DESC")',
    'latest.OwnerSession != owner.SessionVersion',
    'latest.RootFingerprint != fingerprint',
    'context.WithTimeout(',
  ]) assert.ok(source.includes(fragment), fragment)
  for (const forbidden of ['.Create(', '.Save(', '.Updates(', '.BeginRun(', 'commitBoundLocalPush', 'SourceItemStateSynced']) {
    assert.ok(!source.includes(forbidden), forbidden)
  }
  for (const runtime of [
    'internal/api/router.go',
    'internal/client/sources.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'web/src/App.tsx',
  ]) {
    const text = read(runtime)
    assert.ok(!text.includes('observeBoundLocalPushOperationIntent') && !text.includes('local-push-operation-observe'), runtime)
  }
})
