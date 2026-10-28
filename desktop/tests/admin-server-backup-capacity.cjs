const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const js = ts.transpileModule(read('ui/shared/src/server-backup-capacity.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported = {}
new Function('exports', js)(exported)
const { backupRetentionCapacity } = exported

const plan = () => ({
  mode: 'read_only',
  validation: 'snapshot_sha256_and_cas_size',
  keep_last: 2,
  keep_snapshots: ['g3', 'g2'],
  drop_candidates: ['g1'],
  retained_objects: 20,
  drop_only_objects: 3,
  unreferenced_objects: 4,
  committed_snapshots: 3,
  drop_snapshot_bytes: 1000,
  drop_only_object_bytes: 2000,
  unreferenced_bytes: 3000,
  potential_logical_bytes: 6000,
  hashed_objects: 0,
  hashed_bytes: 0,
  delete_enabled: false,
})

test('logical retention capacity separates snapshot, exclusive, orphan and retained bytes', () => {
  const got = backupRetentionCapacity(plan())
  assert.equal(got.snapshotBytes, 1000)
  assert.equal(got.exclusiveCASBytes, 2000)
  assert.equal(got.unreferencedCASBytes, 3000)
  assert.equal(got.potentialLogicalBytes, 6000)
  assert.equal(got.retainedObjects, 20)
  assert.equal(got.exclusiveObjects, 3)
  assert.equal(got.unreferencedObjects, 4)
  assert.equal(got.committedSnapshots, 3)
  assert.equal(got.componentsComplete, true)
  assert.equal(got.totalsConsistent, true)
  assert.equal(got.integrityMode, 'fast')
  const deep = backupRetentionCapacity({
    ...plan(), validation: 'snapshot_sha256_and_full_cas_sha256',
  })
  assert.equal(deep.integrityMode, 'deep')
})

test('missing historical Host breakdown never fabricates zero savings', () => {
  const legacy = plan()
  delete legacy.drop_snapshot_bytes
  delete legacy.drop_only_object_bytes
  const got = backupRetentionCapacity(legacy)
  assert.equal(got.snapshotBytes, null)
  assert.equal(got.exclusiveCASBytes, null)
  assert.equal(got.componentsComplete, false)
  assert.equal(got.totalsConsistent, null)
  assert.equal(got.potentialLogicalBytes, 6000)
})

test('mismatched or invalid Host counters are not reported as measured numbers', () => {
  assert.equal(backupRetentionCapacity({
    ...plan(), potential_logical_bytes: 6001,
  }).totalsConsistent, false)
  assert.equal(backupRetentionCapacity({
    ...plan(), drop_snapshot_bytes: Number.MAX_SAFE_INTEGER,
  }).totalsConsistent, false)
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '3000']) {
    const got = backupRetentionCapacity({
      ...plan(), unreferenced_bytes: invalid,
    })
    assert.equal(got.unreferencedCASBytes, null)
    assert.equal(got.componentsComplete, false)
  }
  assert.equal(backupRetentionCapacity({
    ...plan(), validation: 'not-a-hash-proof',
  }).integrityMode, 'unknown')
})

test('shared Admin UI shows breakdown and explicitly does not claim disk reclaim', () => {
  const panel = read('ui/shared/src/mui/ServerBackupManagementPanel.tsx')
  for (const phrase of [
    'data-xdrive-admin-backup-capacity-breakdown',
    '候选代快照文件',
    '仅被候选代引用的 CAS',
    '孤儿 CAS',
    '潜在可清理逻辑字节合计',
    '不是实际可释放磁盘空间',
    'data-xdrive-admin-backup-capacity-mismatch',
  ]) assert.ok(panel.includes(phrase), phrase)
  assert.ok(panel.includes('canPruneServerBackup(page, keep, verifyMode, prunePreview)'))
  assert.ok(panel.includes('隔离演练所选 v2 备份'))
})
