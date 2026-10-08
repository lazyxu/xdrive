const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'StorageInventorySection.tsx'), 'utf8')

test('shared storage inventory uses cards below the 900px layout boundary', () => {
  for (const token of [
    "useMediaQuery('(max-width:899.95px)')",
    'data-xdrive-storage-inventory-mobile-list',
    'aria-label="全实例物理存储占用明细"',
    "gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'",
    "wordBreak: 'break-word'",
  ]) {
    assert.ok(source.includes(token), 'mobile storage inventory contract missing: ' + token)
  }
})

test('mobile storage cards preserve the same cleanup action contract', () => {
  assert.ok((source.match(/setCleanupRequest\(\{ kind: item\.cleanup_kind!, itemKey: item\.key \}\)/g) || []).length >= 2)
  assert.ok(source.includes('disabled={cleanupLoading || item.reclaimable_bytes <= 0}'))
  assert.ok(source.includes('<XDriveConfirmDialog'))
})

test('desktop storage inventory retains the dense table', () => {
  for (const token of [
    '<XDriveTableSurface>',
    '<Table size="small" aria-label="全实例物理存储占用明细" sx={{ minWidth: 1040 }}>',
    '<TableCell>宿主机绝对路径</TableCell>',
    '<TableCell align="right">可回收</TableCell>',
  ]) {
    assert.ok(source.includes(token), 'desktop storage table contract missing: ' + token)
  }
})
