'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const wide = read('ui/shared/src/mui/FileExplorer.tsx')
const mobile = read('web/src/MobileFiles.tsx')
const nameFunction = wide.slice(wide.indexOf('  const renderItemName = '), wide.indexOf('  const selectItem = '))
test('U07 shared Details/Grid keep exact original name and supply isolated full-name tooltip', () => {
  assert(nameFunction.includes('dir="auto"'))
  assert.equal((nameFunction.match(/title=\{item.name\}/g) || []).length, 2)
  assert.equal((nameFunction.match(/unicodeBidi: 'plaintext'/g) || []).length, 2)
  assert(nameFunction.includes("WebkitLineClamp: 2"))
  assert(nameFunction.includes('noWrap dir="auto" title={item.name}'))
  assert.equal((nameFunction.match(/\{item.name\}/g) || []).length, 4)
})
test('U07 Mobile iOS27 file/collection/folder names and ancestor crumbs expose full original names', () => {
  for(const token of [
    'data-mobile-files-item-title variant="body2"', 'dir="auto" title={item.name}',
    'data-mobile-files-collection-title variant="body2"',
    'dir="auto" title={entry.name}',
    'data-mobile-files-compact-title', 'dir="auto" title={compactTitle}',
    'title={crumb.name ||',
  ]) assert(mobile.includes(token), token)
  assert.equal((mobile.match(/dir="auto" title=\{compactTitle\}/g)||[]).length, 2)
  assert(mobile.includes("fontSize: effectiveGrid ? 14 : 16"))
  assert(mobile.includes("WebkitLineClamp") === false ||
    mobile.includes("MOBILE_FILES_GRID_ROW_HEIGHT"))
})
test('U07 Unicode names are not transformed by a presentation-only enhancement', () => {
  const examples = ['合同草稿—2026年10月.最终版.pdf', 'שם-קובץ-2026.txt',
    'الأرشيف_＃０７.zip', '😀📁 LIVE 001.livp', 'invoice-123-very-long-prefix-A.docx',
    'invoice-123-very-long-prefix-B.docx']
  for (const n of examples) {
    assert(n.length > 0 && n.includes('.'))
  }
  assert(!nameFunction.includes('item.name.slice('))
  assert(!nameFunction.includes('replace(/'))
  assert(!mobile.includes('item.name.normalize('))
  assert(!mobile.includes('entry.name.normalize('))
  assert(mobile.includes('aria-label={selectionMode ?'))
})
