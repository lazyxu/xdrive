const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorerVirtualSurface.ts')
const source = fs.readFileSync(filename, 'utf8')
const explorerSource = fs.readFileSync(
  path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'),
  'utf8',
)
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: filename,
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', output)(mod.exports, mod, require)

const {
  xDriveFileExplorerDetailsVirtualWindow,
  xDriveFileExplorerGridVirtualWindow,
  xDriveFileExplorerVirtualWindowSlots,
} = mod.exports

test('details virtual window uses logical count without allocating logical placeholders', () => {
  const window = xDriveFileExplorerDetailsVirtualWindow({
    itemCount: 100_000,
    scrollTop: 50_000,
    viewportHeight: 640,
    rowHeight: 38,
    headerHeight: 32,
    overscan: 10,
  })
  let reads = 0
  const slots = xDriveFileExplorerVirtualWindowSlots({
    start: window.start,
    end: window.end,
    itemAt(index) {
      reads += 1
      return index === window.start ? { id: index } : undefined
    },
  })

  assert.equal(window.before, window.start * 38)
  assert.equal(window.after, (100_000 - window.end) * 38)
  assert.ok(slots.length < 64, `window slots=${slots.length} must stay bounded`)
  assert.equal(reads, slots.length)
  assert.equal(slots[0].index, window.start)
  assert.deepEqual(slots[0].item, { id: window.start })
})

test('grid virtual window keeps a stable full-collection height with bounded slots', () => {
  const window = xDriveFileExplorerGridVirtualWindow({
    itemCount: 100_000,
    scrollTop: 120_000,
    viewportHeight: 720,
    columns: 6,
    rowHeight: 156,
    rowGap: 8,
    padding: 12,
    overscanRows: 3,
  })
  const slots = xDriveFileExplorerVirtualWindowSlots({
    start: window.start,
    end: window.end,
    itemAt: () => undefined,
  })

  assert.equal(window.totalRows, Math.ceil(100_000 / 6))
  assert.ok(window.totalHeight > 2_000_000)
  assert.ok(slots.length <= 72, `window slots=${slots.length} must stay bounded`)
  assert.ok(window.start > 0)
  assert.ok(window.end < 100_000)
})

test('empty logical collection produces no virtual slots', () => {
  const details = xDriveFileExplorerDetailsVirtualWindow({
    itemCount: 0,
    scrollTop: 0,
    viewportHeight: 600,
    rowHeight: 38,
    headerHeight: 32,
    overscan: 10,
  })
  const grid = xDriveFileExplorerGridVirtualWindow({
    itemCount: 0,
    scrollTop: 0,
    viewportHeight: 600,
    columns: 4,
    rowHeight: 156,
    rowGap: 8,
    padding: 12,
    overscanRows: 3,
  })
  assert.deepEqual(details, { start: 0, end: 0, before: 0, after: 0 })
  assert.equal(grid.start, 0)
  assert.equal(grid.end, 0)
  assert.equal(grid.totalRows, 0)
})


test('sparse FileExplorer interactions resolve logical indexes and never commit partial Shift ranges', () => {
  for (const token of [
    'const logicalItemAt = (index: number) =>',
    'const logicalIndexOf = (id: XDriveFileExplorerID) =>',
    'const logicalItemByID = (id: XDriveFileExplorerID) =>',
    'const loadedRangeItems = (start: number, end: number) =>',
    'const resolveLogicalRange = async (start: number, end: number) =>',
    'if (!item) return null',
    'const loadedCurrentIndex = logicalIndexOf(item.id)',
    'const currentRange = await resolveLogicalRange(currentIndex, currentIndex)',
    'selectionAnchorIndex ?? logicalIndexOf(anchorID) ?? currentIndex',
    'selectionAnchorIndex ?? logicalIndexOf(selectionAnchorID) ?? -1',
    'const range = await resolveLogicalRange(start, end)',
    'commitSelectionIntent(intent, nextIDs, range)',
  ]) {
    assert.ok(explorerSource.includes(token), 'missing sparse interaction contract: ' + token)
  }
  assert.ok(
    explorerSource.includes('const item = logicalItemAt(index)'),
    'marquee/range interaction must read sparse items by logical index',
  )
  assert.ok(
    explorerSource.includes('const item = logicalItemByID(renamingID)'),
    'rename recovery must use the loaded sparse ID index',
  )
  assert.equal(
    explorerSource.includes('visibleItems.slice(start, end + 1)'),
    false,
    'Shift selection must not silently collapse sparse logical ranges to the dense compatibility list',
  )
})
