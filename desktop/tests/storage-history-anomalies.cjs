const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const panel = read('web', 'src', 'StorageStatsPanel.tsx')
const models = read('ui', 'shared', 'src', 'models.ts')
const server = read('internal', 'api', 'storage_history.go')
const docs = read('docs', 'storage-inventory.md')

test('storage history exposes deterministic persisted-snapshot anomalies', () => {
  assert.ok(models.includes('export interface StorageHistoryAnomaly'))
  assert.ok(models.includes('anomalies: StorageHistoryAnomaly[]'))
  for (const key of [
    'snapshot_stale',
    'physical_missing',
    'metadata_inconsistent',
    'cas_metadata_drift',
    'stale_deleting',
    'unclassified_storage',
    'blocked_by_upload_stalled',
    'unreferenced_growth',
    'cache_growth_spike',
  ]) assert.ok(server.includes(`Key: "${key}"`), 'server anomaly rule missing: ' + key)
  assert.ok(server.includes('storageHistoryAnomalies(points, now.UTC())'))
  assert.ok(docs.includes('must not perform any'))
})

test('global storage page promotes anomalies into a needs-attention section', () => {
  assert.ok(panel.includes('title="需要处理"'))
  assert.ok(panel.includes('history.anomalies.length > 0'))
  assert.ok(panel.includes('storageHistoryAnomalyDetail(anomaly)'))
  assert.ok(panel.includes('title="未发现存储异常"'))
})
