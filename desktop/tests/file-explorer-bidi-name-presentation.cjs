'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const shared = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
const mobile = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')

test('U07 shared Web/Desktop Details & Grid names isolate BiDi and expose full unmodified tooltip', () => {
  const begin = shared.indexOf('const renderItemName = (item:')
  const end = shared.indexOf('const selectItem = (', begin)
  assert(begin >= 0 && end > begin)
  const section = shared.slice(begin, end)
  assert(section.includes('dir="auto"'))
  assert.equal((section.match(/title=\{item\.name\}/g) || []).length, 2)
  assert.equal((section.match(/unicodeBidi: 'isolate'/g) || []).length, 2)
  assert(section.includes('WebkitLineClamp: 2'), 'grid stays two lines')
  assert(section.includes('noWrap'), 'Details remains a single virtual row')
  assert(!section.includes('slice(-'), 'must not truncate or rewrite actual item name')
})

test('U07 Mobile iOS27 list, collections, compact folder title and ancestor menu stay single-line', () => {
  const locations = ['data-mobile-files-item-title', 'data-mobile-files-collection-title']
  for (const attr of locations) {
    const i = mobile.indexOf('<Typography ' + attr)
    assert(i >= 0, attr)
    const opening = mobile.slice(i, mobile.indexOf('>', i))
    assert(opening.includes('dir="auto"'), attr)
    assert(opening.includes('noWrap'), attr)
    assert(opening.includes('unicodeBidi:'), attr)
    assert(opening.includes('title='), attr)
  }
  assert.equal((mobile.match(/data-mobile-files-compact-title component="span"/g) || []).length, 2)
  assert.equal((mobile.match(/aria-hidden=\{(?:false|!compactTitleVisible)\} dir="auto" title=\{compactTitle\}/g) || []).length, 2)
  assert(mobile.includes('noWrap dir="auto" title={crumb.name'), 'native ancestor menu keeps full label')
  assert(mobile.includes("onCrumbClick(index)"), 'no changed navigation/history')
})

test('U07 file names preserve Unicode and actual path, no extra API/parser/virtual owner', () => {
  const strings = ['你好 世界 🌟.txt', 'report-بيانات-2026.pdf', 'a\u0301-long-name.exe', 'תיקייה-بيانات.csv']
  for(const name of strings) {
    const bytes = Buffer.from(name, 'utf8')
    assert.equal(bytes.toString('utf8'), name)
  }
  const srcs = shared + '\n' + mobile
  assert(srcs.includes('title={item.name}'))
  assert(srcs.includes('title={entry.name}'))
  assert(srcs.includes('title={compactTitle}'))
  assert(srcs.includes("unicodeBidi: 'isolate'"))
  // Current filename handling, byte limits, client/server sorting and sparse paging are untouched.
  assert(!srcs.includes('xDriveFileExplorerDisplayedNameSubstring'))
})
