const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryVirtualGrid.ts')
const source = fs.readFileSync(filename, 'utf8')
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
  xDriveMediaGalleryGridMetrics,
  xDriveMediaGalleryGridWindow,
} = mod.exports

test('Gallery virtual grid keeps 100k logical items at stable full height with bounded slots', () => {
  const metrics = xDriveMediaGalleryGridMetrics({
    width: 1280,
    itemCount: 100_000,
  })
  const window = xDriveMediaGalleryGridWindow({
    itemCount: 100_000,
    columns: metrics.columns,
    rowStep: metrics.rowStep,
    visibleTop: metrics.rowStep * 5_000,
    visibleBottom: metrics.rowStep * 5_006,
  })

  assert.ok(metrics.columns >= 7)
  assert.equal(metrics.totalRows, Math.ceil(100_000 / metrics.columns))
  assert.ok(metrics.totalHeight > 1_000_000)
  assert.ok(window.start > 0)
  assert.ok(window.end < 100_000)
  assert.ok(
    window.end - window.start <= metrics.columns * 11,
    `render window must stay bounded, got ${window.end - window.start}`,
  )
})

test('Gallery virtual grid aligns viewport windows to complete rows', () => {
  const metrics = xDriveMediaGalleryGridMetrics({
    width: 640,
    itemCount: 1_003,
  })
  const window = xDriveMediaGalleryGridWindow({
    itemCount: 1_003,
    columns: metrics.columns,
    rowStep: metrics.rowStep,
    visibleTop: metrics.rowStep * 9 + 20,
    visibleBottom: metrics.rowStep * 12 + 30,
    overscanRows: 2,
  })
  assert.equal(window.start % metrics.columns, 0)
  assert.ok(window.end <= 1_003)
  assert.ok(window.startRow <= 7)
  assert.ok(window.endRow >= 15)
})

test('Gallery virtual grid is empty for an empty collection', () => {
  const metrics = xDriveMediaGalleryGridMetrics({ width: 800, itemCount: 0 })
  const window = xDriveMediaGalleryGridWindow({
    itemCount: 0,
    columns: metrics.columns,
    rowStep: metrics.rowStep,
    visibleTop: 0,
    visibleBottom: 600,
  })
  assert.equal(metrics.totalHeight, 0)
  assert.deepEqual(window, { start: 0, end: 0, startRow: 0, endRow: 0 })
})


test('Gallery thumbnail priorities distinguish visible rows from overscan rows', () => {
  const metrics = xDriveMediaGalleryGridMetrics({
    width: 1000,
    itemCount: 10_000,
  })
  const visible = xDriveMediaGalleryGridWindow({
    itemCount: 10_000,
    columns: metrics.columns,
    rowStep: metrics.rowStep,
    visibleTop: metrics.rowStep * 20,
    visibleBottom: metrics.rowStep * 24,
    overscanRows: 0,
  })
  const retained = xDriveMediaGalleryGridWindow({
    itemCount: 10_000,
    columns: metrics.columns,
    rowStep: metrics.rowStep,
    visibleTop: metrics.rowStep * 20,
    visibleBottom: metrics.rowStep * 24,
  })

  assert.ok(retained.start < visible.start)
  assert.ok(retained.end > visible.end)
  assert.equal(visible.start % metrics.columns, 0)
  assert.equal(retained.start % metrics.columns, 0)
})
