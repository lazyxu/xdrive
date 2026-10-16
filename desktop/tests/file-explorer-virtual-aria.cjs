'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/FileExplorerVirtualSurface.ts')
const source = fs.readFileSync(filename, 'utf8')
const explorer = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}, fileName: filename }).outputText
const mod = { exports: {} }
new Function('exports', 'module', js)(mod.exports, mod)
const { xDriveFileExplorerAriaTableRowCount: count,
  xDriveFileExplorerAriaItemRowIndex: row,
  xDriveFileExplorerAriaGroupRowIndex: groupRow,
  xDriveFileExplorerAriaItemPosition: pos,
  xDriveFileExplorerDetailsVirtualWindow: windowFor } = mod.exports

test('F02 100k virtual Details positions remain complete, not 30 retained rows', () => {
  const w = windowFor({ itemCount: 100000, scrollTop: 50000,
    viewportHeight: 720, rowHeight: 40, headerHeight: 32, overscan: 8 })
  assert(w.start > 0 && w.end - w.start < 64)
  assert.equal(count(100000, 0), 100001)
  assert.equal(row(w.start, []), w.start + 2)
  assert.equal(row(99999, []), 100001)
  assert.equal(pos(w.start), w.start + 1)
  assert.equal(pos(99999), 100000)
})
test('F02 grouped heading and item rows have contiguous disjoint positions', () => {
  const groups = [{ startIndex: 0, itemCount: 2 }, { startIndex: 2, itemCount: 3 }]
  assert.equal(count(5, groups.length), 8)
  assert.equal(groupRow(0, groups), 2)
  assert.equal(row(0, groups), 3)
  assert.equal(row(1, groups), 4)
  assert.equal(groupRow(2, groups), 5)
  assert.equal(row(2, groups), 6)
  assert.equal(row(4, groups), 8)
})
test('F02 many groups and 100k nodes have stable non-window indexes', () => {
  const groups = Array.from({ length: 10000 }, (_, i) => ({
    startIndex: i * 10, itemCount: 10,
  }))
  assert.equal(count(100000, groups.length), 110001)
  assert.equal(groupRow(99990, groups), 109991)
  assert.equal(row(99999, groups), 110001)
})
test('F02 no grouping and empty identity do not fabricate loaded files', () => {
  assert.equal(count(0, 0), 1)
  assert.equal(row(0, []), 2)
  assert.equal(pos(0), 1)
  assert.equal(row(42, [{ startIndex: 0, itemCount: 2 }]), 44)
})
test('F02 actual shared MUI rows/grid use logical positional ARIA', () => {
  for (const token of [
    'aria-rowcount={xDriveFileExplorerAriaTableRowCount(logicalItemCount, groupedDetailsLayout?.groups.length ?? 0)}',
    'aria-colcount={visibleDetailsColumns.length}',
    'aria-rowindex={1}',
    'aria-rowindex={xDriveFileExplorerAriaItemRowIndex(index, groupedDetailsLayout?.groups ?? [])}',
    'aria-rowindex={xDriveFileExplorerAriaGroupRowIndex(segment.group.startIndex, groupedDetailsLayout.groups)}',
    'aria-setsize={logicalItemCount}',
    'aria-posinset={xDriveFileExplorerAriaItemPosition(index)}',
    '<Box role="cell">',
  ]) assert(explorer.includes(token), token)
  assert.equal((explorer.match(/role="(?:row|listitem)"\s+aria-hidden/g) || []).length, 2)
  assert(!explorer.includes('aria-rowindex={windowIndex}'))
  assert(!explorer.includes('aria-posinset={windowIndex}'))
})
