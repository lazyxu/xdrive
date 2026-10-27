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
const verify = (id, state, finished_at) =>
  ({ snapshot_id: id, action: 'verify', mode: 'fast', state, finished_at })
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
  assert.equal(result.needsAttention, false)
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
