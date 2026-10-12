const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('L03-E1b1a pinned CAS reads fence local Store writes and GC deletes', () => {
  const api = read('internal', 'api', 'local_source_item_evidence_cloud_bytes.go')
  const store = read('internal', 'storage', 'local.go')
  const lock = read('internal', 'storage', 'cas_lifecycle.go')
  const contract = read('internal', 'storage', 'storage.go')
  const checks = read('internal', 'storage', 'cas_lifecycle_test.go')

  assert.match(contract, /type CASReadLeaseProvider interface/)
  assert.match(contract, /OpenPinnedCAS\(context.Context, string\) \(PinnedCASFile, error\)/)
  assert.match(api, /store\.\(storage\.CASReadLeaseProvider\)/)
  assert.match(api, /provider\.OpenPinnedCAS\(ctx, key\)/)
  assert.match(lock, /lockTempLifecycleFile\(ctx, file, exclusive, false\)/)
  assert.match(lock, /func \(f \*pinnedLocalCASFile\) Close\(\) error/)
  assert.match(lock, /func \(l \*Local\) OpenPinnedCAS\(/)
  assert.match(store, /func \(l \*Local\) Put\(/)
  assert.match(store, /func \(l \*Local\) Delete\(/)
  assert.match(store, /func \(l \*Local\) Promote\(/)
  assert.equal((store.match(/optionalCASWriteLease\(ctx, key\)/g) || []).length, 2)
  assert.equal((store.match(/optionalCASWriteLease\(ctx, targetKey\)/g) || []).length, 1)
  assert.match(checks, /TestLocalCASPinnedReadFencesPutDeleteAndPromoteAcrossInstances/)
  assert.match(checks, /TestLocalCASReadLeaseFailsClosedAndDifferentShardsProceed/)
  const endpoint = read('internal', 'api', 'local_source_commit_content_preflight.go')
  assert.match(endpoint, /CloudBytesVerified: false, ContentVerified: false/)
  assert.match(endpoint, /CommitSupported: false, Authoritative: false, MissingInferenceSafe: false/)
  for (const exposed of [
    read('cmd', 'xdrive-agent', 'desktop_ipc.go'),
    read('desktop', 'src', 'main', 'index.cts'),
    read('desktop', 'src', 'preload', 'index.cts'),
    read('web', 'src', 'App.tsx'),
  ]) {
    assert.doesNotMatch(exposed, /OpenPinnedCAS|CASLifecycleLockDir|casLifecycleLease/)
  }
})
