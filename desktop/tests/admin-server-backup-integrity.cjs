const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/server-backup-integrity.ts'), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported = {}
// Only the TypeScript type import is present; compilation removes it, allowing
// this pure summarizer to run without React or a browser.
new Function('exports', transpiled)(exported)
const { summarizeServerBackupIntegrity } = exported

const snapshot = (id, date, state = 'complete', file_data_included = true) =>
  ({ id, created_at: date, state, file_data_included })
const verify = (id, state, finished_at) => ({
  snapshot_id: id, action: 'verify', mode: 'fast', state, finished_at,
  verification: state === 'success' ? {
    protocol: 'xdrive-host-backup-verify-v1', state: 'success',
    format: id.startsWith('v1:') ? 'v1' : 'v2',
    scope: 'backup_snapshot_and_referenced_cas',
    cas_objects_checked: id.startsWith('v1:') ? 0 : 1,
    cas_bytes_hashed: id.startsWith('v1:') ? 0 : 2048,
  } : undefined,
})
const page = (snapshots, history = []) =>
  ({ inventory: { snapshots }, history })

test('integrity summary distinguishes full candidates from database-only and unsafe snapshots', () => {
  const result = summarizeServerBackupIntegrity(page([
    snapshot('v1:older', '2026-10-25T00:00:00Z'),
    snapshot('v2-default:newer', '2026-10-27T00:00:00Z'),
    snapshot('v1:db', '2026-10-24T00:00:00Z', 'complete', false),
    snapshot('v2-default:partial', '2026-10-26T00:00:00Z', 'incomplete'),
    snapshot('v1:inconsistent', '2026-10-23T00:00:00Z', 'inconsistent'),
  ], [
    verify('v2-default:newer', 'success', '2026-10-27T10:00:00Z'),
    verify('v1:older', 'success', '2026-10-27T10:00:00Z'),
    verify('v2-default:newer', 'failed', '2026-10-27T11:00:00Z'),
  ]))
  assert.equal(result.snapshots, 5)
  assert.equal(result.fullCandidates, 2)
  assert.equal(result.databaseOnly, 1)
  assert.equal(result.incomplete, 1)
  assert.equal(result.inconsistent, 1)
  assert.equal(result.newestFullID, 'v2-default:newer')
  assert.equal(result.historicalPassed, 1)
  assert.equal(result.historicalFailed, 1)
  assert.equal(result.withoutRecentReceipt, 3)
  assert.equal(result.needsAttention, true)
})

test('absence of recent receipts is unknown, not failed, and cannot assert current integrity', () => {
  const result = summarizeServerBackupIntegrity(page([
    snapshot('v2-default:good', '2026-10-27T00:00:00Z'),
  ]))
  assert.equal(result.fullCandidates, 1)
  assert.equal(result.withoutRecentReceipt, 1)
  assert.equal(result.historicalPassed, 0)
  assert.equal(result.historicalFailed, 0)
  assert.equal(result.needsAttention, true)
  const panel = fs.readFileSync(path.join(root, 'ui/shared/src/mui/ServerBackupManagementPanel.tsx'), 'utf8')
  assert.match(panel, /data-xdrive-admin-backup-integrity-summary/)
  assert.match(panel, /历史校验通过均不代表当前数据仍完好/)
  assert.match(panel, /mode: 'fast'/)
  assert.match(panel, /disabled={disabled \|\| !integrity\.newestFullID}/)
})

test('no structurally complete file backup prompts attention instead of a false green state', () => {
  const result = summarizeServerBackupIntegrity(page([
    snapshot('v1:database-only', '2026-10-27T00:00:00Z', 'complete', false),
  ], [verify('v1:database-only', 'success', '2026-10-27T01:00:00Z')]))
  assert.equal(result.fullCandidates, 0)
  assert.equal(result.databaseOnly, 1)
  assert.equal(result.historicalPassed, 1)
  assert.equal(result.newestFullID, null)
  assert.equal(result.needsAttention, true)
})

test('latest verification is chosen by Host completion time, not list ordering', () => {
  const { latestServerBackupVerification } = exported
  const old = verify('v2-default:target', 'success', '2026-10-27T10:00:00Z')
  const recent = verify('v2-default:target', 'failed', '2026-10-27T11:00:00Z')
  assert.equal(latestServerBackupVerification([old, recent], 'v2-default:target'), recent)
  assert.equal(latestServerBackupVerification([recent, old], 'v2-default:target'), recent)
  assert.equal(latestServerBackupVerification([old], 'v2-default:else'), undefined)
})

test('elapsed seconds and categories use only structured Host receipts', () => {
  const { serverBackupReceiptDurationSeconds, serverBackupReceiptExplanation } = exported
  const item = {
    action: 'verify', state: 'failed', error_code: 'lock_busy',
    started_at: '2026-10-27T10:00:00Z', finished_at: '2026-10-27T10:00:13Z',
  }
  assert.equal(serverBackupReceiptDurationSeconds(item), 13)
  assert.match(serverBackupReceiptExplanation(item), /锁/)
  assert.equal(serverBackupReceiptDurationSeconds({ ...item, finished_at: 'bad' }), null)
  assert.equal(serverBackupReceiptDurationSeconds({
    ...item, finished_at: '2026-10-27T09:59:59Z',
  }), null)
  assert.match(serverBackupReceiptExplanation({
    ...item, error_code: 'operation_failed',
  }), /私有日志/)
  const component = fs.readFileSync(
    path.join(root, 'ui/shared/src/mui/ServerBackupManagementPanel.tsx'), 'utf8')
  assert.match(component, /data-xdrive-admin-backup-history-detail/)
  // The prior text-only protocol was intentionally replaced by bounded,
  // real Host verification receipts. Preserve both new-evidence and legacy-
  // missing-evidence guards without pinning an obsolete UI sentence.
  assert.ok(component.includes('XDriveBackupVerificationReceipt entry={historyDetail}'))
  assert.match(component, /对于没有新版宿主机验证报告的历史记录，仍然不推断对象数量或校验字节/)
  const receiptComponent = fs.readFileSync(
    path.join(root, 'ui/shared/src/mui/BackupVerificationReceipt.tsx'), 'utf8')
  assert.match(receiptComponent, /data-xdrive-admin-backup-verification-report/)
  assert.match(receiptComponent, /不代表已完成 PostgreSQL 与文件恢复演练/)
  assert.match(component, /retention.hashed_objects/)
})

test('older generations show historical receipts without implying current recovery', () => {
  const { serverBackupHistoricalVerificationLabel } = exported
  const id = 'v2-default:xdrive-backup-20261001T000000Z'
  const older = verify(id, 'success', '2026-10-26T10:00:00Z')
  const newer = { ...verify(id, 'failed', '2026-10-27T12:00:00Z'), mode: 'deep' }
  assert.equal(serverBackupHistoricalVerificationLabel([], id), '未见历史校验')
  assert.equal(serverBackupHistoricalVerificationLabel([older], 'v1:other'), '未见历史校验')
  assert.match(serverBackupHistoricalVerificationLabel([newer, older], id), /^历史失败 · deep · /)
  assert.match(serverBackupHistoricalVerificationLabel([older, newer], id), /^历史失败 · deep · /)
  assert.match(serverBackupHistoricalVerificationLabel([older], id), /^历史通过 · fast · /)
  const noTime = { ...newer, finished_at: '' }
  assert.equal(serverBackupHistoricalVerificationLabel([noTime], id), '历史失败 · deep · 时间未知')
  const pager = fs.readFileSync(path.join(root, 'ui/shared/src/mui/BackupSnapshotIndexPager.tsx'), 'utf8')
  const parent = fs.readFileSync(path.join(root, 'ui/shared/src/mui/ServerBackupManagementPanel.tsx'), 'utf8')
  assert.match(pager, /data-xdrive-admin-older-verification-history/)
  assert.match(pager, /serverBackupHistoricalVerificationLabel\(history, id\)/)
  assert.match(parent, /history=\{page\.history\}/)
  // Even after showing a historic success, the old pager cannot restore/delete.
  assert.doesNotMatch(pager, /onRestoreOlder|onDeleteOlder|onDrillOlder/)
})


test('Admin integrity lists require a matching structured Host proof, not only a success status', () => {
  const { classifyServerBackupVerificationEvidence: classify,
    serverBackupHistoricalVerificationLabel: label,
    serverBackupReceiptExplanation: explanation } = exported
  const id = 'v2-default:xdrive-backup-20261029T010203Z'
  const good = verify(id, 'success', '2026-10-29T01:02:03Z')
  assert.equal(classify(good), 'passed')
  assert.match(label([good], id), /^历史通过 · fast · .+结构化校验凭据/)
  const old = { ...good, verification: undefined }
  assert.equal(classify(old), 'unattested')
  assert.match(label([old], id), /^历史结果未证实/)
  assert.match(explanation(old), /缺少可信结构化校验凭据/)
  const malformed = [
    { ...good, verification: { ...good.verification, protocol: 'unrecognized' } },
    { ...good, verification: { ...good.verification, scope: 'online_storage' } },
    { ...good, verification: { ...good.verification, format: 'v1' } },
    { ...good, verification: { ...good.verification, failure_category: 'object_read_failed' } },
    { ...good, verification: { ...good.verification, cas_objects_checked: -1 } },
    { ...good, verification: { ...good.verification, cas_bytes_hashed: 1.5 } },
    { ...good, verification: { ...good.verification, cas_bytes_hashed: Number.MAX_SAFE_INTEGER + 1 } },
    { ...good, snapshot_id: 'another-host:xdrive-backup-20261029T010203Z' },
    { ...verify('v1:xdrive-backup-20261029T010203Z', 'success', good.finished_at),
      verification: { ...good.verification, format: 'v1' } },
  ]
  for (const entry of malformed) assert.equal(classify(entry), 'unattested')
  const status = summarizeServerBackupIntegrity(page([snapshot(id, '2026-10-29T01:02:03Z')], [old]))
  assert.equal(status.historicalPassed, 0)
  assert.equal(status.historicalFailed, 0)
  assert.equal(status.withoutRecentReceipt, 1)
  assert.equal(status.needsAttention, true)
  const failed = { ...old, state: 'failed', finished_at: '2026-10-29T03:00:00Z' }
  assert.equal(classify(failed), 'failed')
  const latest = summarizeServerBackupIntegrity(page([snapshot(id, '2026-10-29T01:02:03Z')],
    [good, failed]))
  assert.equal(latest.historicalPassed, 0)
  assert.equal(latest.historicalFailed, 1)
  assert.match(label([good, failed], id), /^历史失败/)
})

test('shared Admin backup surfaces use the same evidence classification and fail closed', () => {
  const panel = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/ServerBackupManagementPanel.tsx'), 'utf8')
  const evidence = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/BackupRecoveryEvidencePanel.tsx'), 'utf8')
  const receipt = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/BackupVerificationReceipt.tsx'), 'utf8')
  assert.match(panel, /return serverBackupHistoricalVerificationLabel\(history, snapshotID\)/)
  assert.match(panel, /无可信校验凭据/)
  assert.match(evidence, /classifyServerBackupVerificationEvidence\(event\)/)
  assert.match(receipt, /evidence === 'unattested'/)
  assert.doesNotMatch(evidence, /action: 'delete'|action: 'restore'/)
})
