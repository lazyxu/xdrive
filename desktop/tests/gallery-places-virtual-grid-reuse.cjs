'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const virtualFile = 'ui/shared/src/mui/MediaGalleryVirtualGrid.ts'
const compiled = ts.transpileModule(read(virtualFile), {
  fileName: virtualFile,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error), [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(mod, mod.exports, require)
const { xDriveMediaGalleryGridMetrics: metrics, xDriveMediaGalleryGridWindow: win } = mod.exports

test('71, 142 and 100k Places photos use the identical bounded Gallery row window', () => {
  for (const count of [71, 142, 100000]) {
    const m = metrics({ width: 792, itemCount: count, minColumnWidth: 108 })
    const top = win({ itemCount: count, columns: m.columns,
      rowStep: m.rowStep, visibleTop: 0, visibleBottom: 520 })
    const middle = win({ itemCount: count, columns: m.columns,
      rowStep: m.rowStep, visibleTop: m.totalHeight / 2, visibleBottom: m.totalHeight / 2 + 520 })
    const bottom = win({ itemCount: count, columns: m.columns,
      rowStep: m.rowStep, visibleTop: Math.max(0, m.totalHeight - 520), visibleBottom: m.totalHeight })
    for (const w of [top, middle, bottom]) {
      assert.ok(w.end > w.start && w.end <= count, JSON.stringify({ count, w }))
      assert.ok(w.end - w.start <= m.columns * (Math.ceil(520 / m.rowStep) + 6),
        'only viewport + overscan rows may enter the DOM')
    }
    assert.equal(top.start, 0)
    assert.equal(bottom.end, count)
    assert.ok(middle.start > 0 && middle.end < count, 'middle viewport must skip nonvisible tiles')
  }
})

test('Places draws the canonical Gallery tiles and respects signed Owner pagination', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const drawer = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  const parent = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  assert.match(gallery, /export function MediaVirtualTileGrid\(/)
  assert.match(gallery, /export function MediaTile\(/)
  assert.match(drawer, /<MediaVirtualTileGrid[\s\S]*?collection=\{collection\}/)
  assert.match(drawer, /<MediaTile[\s\S]*?item=\{item\}/)
  assert.match(gallery, /data-xdrive-places-photo-drawer-item=\{placesDrawer \? item.node.id : undefined\}/)
  assert.match(gallery, /xDriveMediaGalleryGridWindow\(/)
  assert.match(drawer, /new XDriveMediaThumbnailScheduler\(loadThumbnail\)/)
  assert.match(drawer, /scheduler\.dispose\(\)/)
  assert.match(drawer, /onScroll=\{event => \{/)
  assert.match(parent, /xDriveAppendPlacesDrawerPage\(selection,current.items,current.total,range\)/)
  assert.match(parent, /hasAcceptedCell\(selection\)/)
  assert.match(drawer, /items\.slice\(0,8\)\.map/)
  assert.doesNotMatch(drawer, /items\.map\(item => \(\s*<Box key=\{item.node.id\} component="button"/)
})

test('trusted Parent touch activation remains one-shot and does not cross the Child map', () => {
  const drawer = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(drawer, /listRef\.current\?\.contains\(tile\)/)
  assert.match(drawer, /items\.find\(item => item\.node\.id === id\)/)
  assert.match(drawer, /onPointerDownCapture=\{event =>/)
  assert.match(drawer, /onPointerCancelCapture=\{event =>/)
  assert.match(drawer, /onPointerUpCapture=\{event =>/)
  assert.match(drawer, /tap\.moved/)
  assert.match(drawer, /event\.timeStamp-tap\.startAt>700/)
  assert.match(drawer, /event\.timeStamp-handled\.at<900/)
  assert.match(drawer, /event\.stopPropagation\(\)/)
  assert.match(gallery, /event\.preventDefault\(\)[\s\S]*?onPreview\(item\)/)
  assert.doesNotMatch(drawer, /dispatchEvent\(/)
})
