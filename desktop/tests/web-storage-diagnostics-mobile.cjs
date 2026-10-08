const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const source = fs.readFileSync(path.join(repo, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')

test('admin storage diagnostics use cards on compact layouts', () => {
  for (const token of [
    'data-xdrive-staging-mobile-list',
    'data-xdrive-unreferenced-mobile-list',
    'data-xdrive-legacy-mobile-list',
    "wordBreak: 'break-word'",
    "gridTemplateColumns: 'repeat(2, minmax(0, 1fr))'",
  ]) {
    assert.ok(source.includes(token), 'mobile storage diagnostic contract missing: ' + token)
  }
})

test('mobile diagnostic cards preserve GC and legacy operational fields', () => {
  for (const token of [
    'unreferencedBlobStatus(blob)',
    'blob.metadata_size',
    'blob.physical_size',
    'blob.reused_upload_parts',
    'item.current_file_refs',
    'item.history_version_refs',
    'file.modified_at',
  ]) {
    assert.ok(source.includes(token), 'storage diagnostic field missing: ' + token)
  }
})

test('desktop diagnostic tables remain available', () => {
  for (const token of [
    '<Table size="small" aria-label="Orphan staging" sx={{ minWidth: 680 }}>',
    '<Table size="small" aria-label="待 GC Blob 明细" sx={{ minWidth: 980 }}>',
    '<Table size="small" aria-label="Legacy 对象明细" sx={{ minWidth: 900 }}>',
  ]) {
    assert.ok(source.includes(token), 'desktop diagnostic table missing: ' + token)
  }
})

test('diagnostic pagination and lazy loading remain shared', () => {
  for (const token of [
    'onPrevious={() => void loadStagingPage(stagingPage - 1)}',
    'onNext={() => void loadStagingPage(stagingPage + 1)}',
    'onPrevious={() => void loadUnreferencedPage(unreferencedPageNumber - 1)}',
    'onNext={() => void loadLegacyPage(legacyPageNumber + 1)}',
  ]) {
    assert.ok(source.includes(token), 'diagnostic pagination contract missing: ' + token)
  }
})
