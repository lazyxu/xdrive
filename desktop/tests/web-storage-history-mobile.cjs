const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(repo, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')

test('admin storage history switches wide tables to snapshot cards below 900px', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px)')",
    'data-xdrive-storage-history-mobile-list',
    'data-xdrive-storage-anomaly-history-mobile-list',
    "gridTemplateColumns: 'repeat(2, minmax(0, 1fr))'",
    'history.samples.slice(-12).reverse()',
  ]) {
    assert.ok(source.includes(token), 'mobile storage history contract missing: ' + token)
  }
})

test('mobile history cards preserve the same storage metrics as desktop tables', () => {
  for (const token of [
    'point.cas_blob_count.toLocaleString()',
    'formatBytes(point.cas_physical_bytes)',
    'formatBytes(point.cas_logical_referenced_bytes)',
    'point.cas_dedup_ratio.toFixed(2)',
    'formatBytes(point.unreferenced_blob_bytes)',
    'storageHistoryOtherCacheBytes(point)',
    'point.unclassified_bytes',
  ]) {
    assert.ok(source.includes(token), 'storage history metric missing: ' + token)
  }
})

test('desktop storage history tables remain unchanged', () => {
  assert.ok(source.includes('<Table size="small" aria-label="存储历史趋势" sx={{ minWidth: 920 }}>'))
  assert.ok(source.includes('<Table size="small" aria-label="存储异常与缓存趋势" sx={{ minWidth: 1540 }}>'))
})
