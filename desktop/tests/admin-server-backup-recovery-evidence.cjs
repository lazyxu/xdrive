const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root,
  'ui/shared/src/server-backup-recovery-evidence.ts'), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exportsObject = {}
new Function('exports', js)(exportsObject)
const select = exportsObject.selectServerBackupRecoveryEvidence

const snapshot = (id, state = 'complete', file_data_included = true) =>
  ({ id, name: id, state, file_data_included })
const receipt = (action, snapshot_id, state, finished_at) =>
  ({ action, snapshot_id, state, finished_at, mode: 'deep' })
const page = (snapshots, history = []) =>
  ({ supported: true, inventory: { snapshots }, history })

test('only genuine matching Host history is attributed to the selected snapshot', () => {
  const target = 'v2-default:xdrive-backup-20261027T120000Z'
  const other = 'v1:xdrive-backup-20261026T120000Z'
  const older = receipt('verify', target, 'success', '2026-10-27T13:00:00Z')
  const failed = receipt('verify', target, 'failed', '2026-10-27T14:00:00Z')
  const restored = receipt('restore', target, 'success', '2026-10-27T15:00:00Z')
  const view = select(page([snapshot(target), snapshot(other)], [
    older, receipt('restore', other, 'failed', '2026-10-28T18:00:00Z'),
    restored, failed,
  ]), target)
  assert.equal(view.snapshotKind, 'complete_candidate')
  assert.equal(view.lastVerify, failed)
  assert.equal(view.lastRestore, restored)
  assert.equal(view.lastDrill, null)
  assert.equal(view.hostIsolatedDrill, 'not_verified')
  assert.equal(view.ciDrillForDeployedHost, 'not_attested')
})

test('a successful verify or production restore never asserts isolated recoverability', () => {
  const id = 'v2-default:xdrive-backup-20261027T120000Z'
  const good = select(page([snapshot(id)], [
    receipt('verify', id, 'success', '2026-10-27T13:00:00Z'),
    receipt('restore', id, 'success', '2026-10-27T14:00:00Z'),
  ]), id)
  assert.equal(good.lastVerify.state, 'success')
  assert.equal(good.lastRestore.state, 'success')
  assert.equal(good.hostIsolatedDrill, 'not_verified')
  assert.equal(good.ciDrillForDeployedHost, 'not_attested')
  const ui = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/BackupRecoveryEvidencePanel.tsx'), 'utf8')
  assert.match(ui, /data-xdrive-admin-backup-recovery-evidence/)
  assert.match(ui, /不是隔离演练/)
  assert.match(ui, /跳过（未验收）/)
  assert.match(ui, /CI 产物独立于当前部署/)
  const parent = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/ServerBackupManagementPanel.tsx'), 'utf8')
  assert.ok(parent.includes("XDriveBackupRecoveryEvidencePanel page={page} snapshotID={selected?.id || ''}"))
  assert.match(parent, /data-xdrive-admin-backup-drill-receipt/)
  assert.match(parent, /隔离演练所选 v2 备份/)
})

test('isolation history remains snapshot-specific and never becomes production acceptance', () => {
  const id = 'v2-default:xdrive-backup-20261027T120000Z'
  const event = receipt('drill', id, 'success', '2026-10-28T00:10:00Z')
  event.drill = {
    protocol: 'xdrive-host-isolated-drill-v1', state: 'success',
    environment: 'host_ephemeral_offline_tmpfs',
    snapshot: 'xdrive-backup-20261027T120000Z',
    files_restored: true, postgresql_restored: true, production_verified: false,
    max_mib: 1024, failure_category: '',
  }
  const result = select(page([snapshot(id)], [event]), id)
  assert.equal(result.lastDrill, event)
  assert.equal(result.hostIsolatedDrill, 'not_verified')
  assert.equal(select(page([snapshot('other')], [event]), 'other').lastDrill, null)
  const ui = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/BackupRecoveryEvidencePanel.tsx'), 'utf8')
  assert.match(ui, /drillLabel\(evidence.lastDrill\)/)
  assert.match(ui, /不是生产破坏性恢复验收/)
})

test('database-only, inconsistent, incomplete and missing snapshots do not become full backups', () => {
  const formats = [
    [snapshot('a', 'complete', false), 'database_only'],
    [snapshot('b', 'inconsistent'), 'inconsistent'],
    [snapshot('c', 'incomplete'), 'incomplete'],
  ]
  for (const [snap, expected] of formats) {
    assert.equal(select(page([snap]), snap.id).snapshotKind, expected)
  }
  const forgedHistory = receipt('restore', 'unknown', 'success', '2026-10-27T13:00:00Z')
  const absent = select(page([], [forgedHistory]), 'unknown')
  assert.equal(absent.snapshotKind, 'none')
  assert.equal(absent.lastRestore, null)
  assert.equal(absent.lastVerify, null)
})

test('historical receipts use completion time, not arbitrary result ordering', () => {
  const id = 'v2-default:xdrive-backup-20261027T120000Z'
  const earlier = receipt('restore', id, 'success', '2026-10-27T09:00:00Z')
  const later = receipt('restore', id, 'failed', '2026-10-27T10:00:00Z')
  for (const history of [[earlier, later], [later, earlier]]) {
    assert.equal(select(page([snapshot(id)], history), id).lastRestore, later)
  }
})
