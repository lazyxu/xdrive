const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../../ui/shared/src/file-explorer-inline.ts')
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  fileName: sourcePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', compiled)(mod, mod.exports)
const { xDriveFileExplorerInlineLayout: layout, xDriveFileExplorerInlineCellAt: cell,
  xDriveFileExplorerInlineVisibleRanges: ranges,
  xDriveFileExplorerInlineGroupIndex: groupIndex } = mod.exports
const source = (ownerID, itemCount, items = {}) => ({ ownerID, itemCount, itemAt: index => items[index] })

test('F-PARITY-07A: nested rows map to their owners without duplicating parent rows', () => {
  const root = source(1, 6, { 1: { id: 2, name: 'A' }, 3: { id: 3, name: 'B' } })
  const a = { ...source(2, 4, { 2: { id: 4, name: 'C' } }), parentID: 1, parentIndex: 1 }
  const b = { ...source(3, 2), parentID: 1, parentIndex: 3 }
  const c = { ...source(4, 3, { 0: { id: 6, name: 'E' } }), parentID: 2, parentIndex: 2 }
  const tree = layout(root, [a, b, c])
  assert.equal(tree.itemCount, 15)
  assert.equal(tree.segments.length, 7)
  assert.equal(cell(tree, 1).item.id, 2)
  assert.equal(cell(tree, 2).ownerID, 2)
  assert.equal(cell(tree, 4).item.id, 4)
  assert.equal(cell(tree, 5).item.id, 6)
  assert.equal(cell(tree, 5).depth, 2)
  assert.deepEqual(ranges(tree, 1, 6), [
    { ownerID: 1, startIndex: 1, endIndex: 1 },
    { ownerID: 2, startIndex: 0, endIndex: 2 },
    { ownerID: 4, startIndex: 0, endIndex: 1 },
  ])
})

test('F-PARITY-07A: 100k parent and 100k child create three spans, no eager reads', () => {
  let accesses = 0
  const root = { ownerID: 1, itemCount: 100000, itemAt(index) { accesses++; return { index } } }
  const child = { ownerID: 20, parentID: 1, parentIndex: 50,
    itemCount: 100000, itemAt(index) { accesses++; return { index } } }
  const tree = layout(root, [child])
  assert.equal(tree.itemCount, 200000)
  assert.equal(tree.segments.length, 3)
  assert.equal(accesses, 0)
  assert.deepEqual(cell(tree, 51), { ownerID: 20, sourceIndex: 0, depth: 1, item: { index: 0 } })
  assert.deepEqual(cell(tree, 100051), { ownerID: 1, sourceIndex: 51, depth: 0, item: { index: 51 } })
  assert.equal(accesses, 2)
  assert.deepEqual(ranges(tree, 99990, 100010), [
    { ownerID: 20, startIndex: 99939, endIndex: 99959 },
  ])
})

test('F-PARITY-07A: cycles, duplicate/orphan expansions and out-of-range indices cannot inject nodes', () => {
  const root = source(1, 5)
  const a = { ...source(2, 7), parentID: 1, parentIndex: 1 }
  const tree = layout(root, [
    a, { ...source(1, 999), parentID: 2, parentIndex: 3 },
    { ...source(100, 1), parentID: 700, parentIndex: 0 },
    { ...source(2, 9), parentID: 1, parentIndex: 1 },
    { ...source(3, 15), parentID: 1, parentIndex: 100000 },
  ])
  assert.equal(tree.itemCount, 12)
  assert.equal(tree.segments.length, 3)
  assert.equal(cell(tree, -1), undefined)
  assert.equal(cell(tree, 12), undefined)
  assert.deepEqual(ranges(tree, 999, 1000), [])
})

test('F-PARITY-07A: empty child inserts zero rows; source ranges still coalesce', () => {
  const tree = layout(source(1, 10), [{ ...source(2, 0), parentID: 1, parentIndex: 4 }])
  assert.equal(tree.itemCount, 10)
  assert.equal(tree.segments.length, 2)
  assert.equal(cell(tree, 4).item, undefined)
  assert.deepEqual(ranges(tree, 2, 8), [{ ownerID: 1, startIndex: 2, endIndex: 8 }])
})

test('F-PARITY-07C: nested List disclosure preserves authoritative Server group boundaries', () => {
  let reads = 0
  const root = { ownerID: 1, itemCount: 6, itemAt(index) { reads++; return { index } } }
  const a = { ...source(10, 3), parentID: 1, parentIndex: 1 }
  const b = { ...source(11, 2), parentID: 1, parentIndex: 3 }
  const tree = layout(root, [a, b])
  const groups = groupIndex(tree, 1, [
    { key: 'folder', item_count: 2, start_index: 0 },
    { key: 'ext:txt', item_count: 2, start_index: 2 },
    { key: 'ext:png', item_count: 2, start_index: 4 },
  ], 6)
  assert.deepEqual(groups, [
    { key: 'folder', item_count: 5, start_index: 0 },
    { key: 'ext:txt', item_count: 4, start_index: 5 },
    { key: 'ext:png', item_count: 2, start_index: 9 },
  ])
  assert.equal(tree.itemCount, 11)
  assert.equal(reads, 0, 'group augmentation must never materialize files')
  assert.equal(cell(tree, 5).sourceIndex, 2)
  assert.deepEqual(ranges(tree, 5, 8), [
    { ownerID: 1, startIndex: 2, endIndex: 3 },
    { ownerID: 11, startIndex: 0, endIndex: 1 },
  ])
})

test('F-PARITY-07C: 100k root + 100k child is two spans, no dense group scan', () => {
  let reads = 0
  const root = { ownerID: 1, itemCount: 100000, itemAt(index) { reads++; return index } }
  const child = { ...source(8, 100000), parentID: 1, parentIndex: 99999 }
  const tree = layout(root, [child])
  assert.deepEqual(groupIndex(tree, 1, [
    { key: 'folder', item_count: 50000, start_index: 0 },
    { key: 'other', item_count: 50000, start_index: 50000 },
  ], 100000), [
    { key: 'folder', item_count: 50000, start_index: 0 },
    { key: 'other', item_count: 150000, start_index: 50000 },
  ])
  assert.equal(tree.segments.length, 2)
  assert.equal(reads, 0)
})

test('F-PARITY-07C: invalid/stale Server group indices cannot invent group membership', () => {
  const tree = layout(source(1, 4), [])
  const invalid = [
    [],
    [{ key: 'a', item_count: 3, start_index: 0 }],
    [{ key: 'a', item_count: 2, start_index: 1 }, { key: 'b', item_count: 2, start_index: 3 }],
    [{ key: 'a', item_count: 0, start_index: 0 }, { key: 'b', item_count: 4, start_index: 0 }],
  ]
  for (const groups of invalid) assert.equal(groupIndex(tree, 1, groups, 4), null)
  assert.deepEqual(groupIndex(layout(source(1, 0), []), 1, [], 0), [])
})
