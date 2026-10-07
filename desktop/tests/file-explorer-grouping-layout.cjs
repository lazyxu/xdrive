const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function load(relativePath, extraModules = {}) {
  const filename = path.join(repo, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => (
    Object.prototype.hasOwnProperty.call(extraModules, request)
      ? extraModules[request]
      : require(request)
  )
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

const grouping = load(['ui', 'shared', 'src', 'file-explorer-grouping.ts'])
const layout = load(
  ['ui', 'shared', 'src', 'mui', 'FileExplorerGroupingLayout.ts'],
  { '../file-explorer-grouping': grouping },
)

test('FileExplorer group index must remain contiguous over the full logical collection', () => {
  assert.equal(layout.xDriveFileExplorerGroupIndexValid([
    { key: 'folder', item_count: 3, start_index: 0 },
    { key: 'ext:pdf', item_count: 2, start_index: 3 },
  ], 5), true)
  assert.equal(layout.xDriveFileExplorerGroupIndexValid([
    { key: 'folder', item_count: 3, start_index: 0 },
    { key: 'ext:pdf', item_count: 2, start_index: 4 },
  ], 5), false)
  assert.equal(layout.xDriveFileExplorerGroupIndexValid([], 0), true)
})

test('grouped Details layout accounts for headers in scroll geometry', () => {
  const result = layout.xDriveCreateFileExplorerGroupLayout({
    groups: [
      { key: 'folder', item_count: 2, start_index: 0 },
      { key: 'ext:pdf', item_count: 3, start_index: 2 },
    ],
    groupBy: 'type',
    itemCount: 5,
    rowHeight: 36,
    groupHeaderHeight: 30,
    groupGap: 6,
  })
  assert.ok(result)
  assert.equal(result.groups[0].top, 0)
  assert.equal(result.groups[0].itemsTop, 30)
  assert.equal(result.groups[1].startIndex, 2)
  assert.equal(result.groups[1].top, 108)
  assert.equal(layout.xDriveFileExplorerGroupedItemTop(result, 0), 30)
  assert.equal(layout.xDriveFileExplorerGroupedItemTop(result, 2), 138)
  assert.equal(result.totalHeight, 246)
})

test('grouped Grid layout resets columns inside each group instead of across group boundaries', () => {
  const result = layout.xDriveCreateFileExplorerGroupLayout({
    groups: [
      { key: 'ext:jpg', item_count: 3, start_index: 0 },
      { key: 'ext:png', item_count: 2, start_index: 3 },
    ],
    groupBy: 'type',
    itemCount: 5,
    columns: 2,
    rowHeight: 120,
    rowGap: 8,
    padding: 12,
    groupHeaderHeight: 30,
    groupGap: 8,
  })
  assert.ok(result)
  assert.equal(result.groups[0].rowCount, 2)
  assert.equal(result.groups[1].rowCount, 1)
  assert.equal(layout.xDriveFileExplorerGroupedItemTop(result, 2), 170)
  assert.equal(
    layout.xDriveFileExplorerGroupedItemTop(result, 3),
    result.groups[1].itemsTop,
    'the first item of the next group must start in column zero of a fresh group row',
  )
})

test('grouped viewport segments translate scroll geometry back to logical sparse indexes', () => {
  const result = layout.xDriveCreateFileExplorerGroupLayout({
    groups: [
      { key: 'folder', item_count: 4, start_index: 0 },
      { key: 'ext:txt', item_count: 6, start_index: 4 },
    ],
    groupBy: 'type',
    itemCount: 10,
    rowHeight: 36,
    groupHeaderHeight: 30,
    groupGap: 6,
  })
  const segments = layout.xDriveFileExplorerVisibleGroupSegments(
    result,
    result.groups[1].top,
    90,
    0,
  )
  assert.equal(segments.length, 1)
  assert.equal(segments[0].group.key, 'ext:txt')
  assert.equal(segments[0].headerVisible, true)
  assert.equal(segments[0].startIndex, 4)
  assert.ok(segments[0].endIndex > segments[0].startIndex)
})

test('shared labels are stable for type, month and size group keys', () => {
  assert.equal(grouping.xDriveFileExplorerGroupLabel('type', 'ext:pdf'), 'PDF')
  assert.equal(grouping.xDriveFileExplorerGroupLabel('modified', 'month:2026-10'), '2026年10月')
  assert.equal(grouping.xDriveFileExplorerGroupLabel('size', 'medium'), '100 MiB–1 GiB')
})
