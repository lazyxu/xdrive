const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
function load(file, mocks = {}) {
  const compiled = ts.transpileModule(read(file), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', compiled)(
    mod.exports, mod, (name) => {
      if (!(name in mocks)) throw new Error('Unexpected module ' + name)
      return mocks[name]
    },
  )
  return mod.exports
}

const grid = load('ui/shared/src/mui/MediaGalleryVirtualGrid.ts')
const timeline = load('ui/shared/src/mui/MediaGalleryVirtualTimeline.ts', {
  './MediaGalleryVirtualGrid': grid,
})
const gallerySource = read('ui/shared/src/mui/MediaGallery.tsx')
const chromeSource = read('ui/shared/src/mui/MobileGalleryChrome.tsx')

// Reference: lazyxu/kfs/develop:
// ui/packages/common/components/ThumbnailList/ThumbnailList.jsx
// calImageWidth(minCol, gridWidth, scrollbarWidth, spacing).
function kfsReference(minCol, gridWidth, scrollbarWidth, spacing) {
  const columns = Math.ceil(Math.max(minCol, Math.floor((gridWidth - scrollbarWidth) / 256)))
  const totalGap = (columns - 1) * 8 * spacing
  return { columns, cellWidth: (gridWidth - scrollbarWidth - totalGap) / columns }
}

test('P0-2 KFS column-count formula and square width match when gaps are equal', () => {
  for (const width of [320, 360, 390, 430, 899, 1024, 1600]) {
    for (const scrollbar of [0, 15]) {
      for (const minColumns of [3, 5, 10]) {
        const reference = kfsReference(minColumns, width, scrollbar, 0)
        const metrics = grid.xDriveMediaGalleryGridMetrics({
          width: width - scrollbar,
          itemCount: 100000,
          minColumns,
          referenceColumnWidth: 256,
          gap: 0,
        })
        assert.equal(metrics.columns, reference.columns)
        assert.equal(grid.xDriveMediaGalleryKfsColumnCount(
          width - scrollbar, minColumns, 256,
        ), reference.columns)
        assert.ok(Math.abs(metrics.columnWidth - reference.cellWidth) < 0.00001)
      }
    }
  }
})

test('P0-2 xDrive Mobile KFS-inspired accessible defaults: year 6, month 5, day/all 3', () => {
  const expected = [
    { width: 320, year: 6, month: 5, day: 3, all: 3 },
    { width: 360, year: 6, month: 5, day: 3, all: 3 },
    { width: 390, year: 6, month: 5, day: 3, all: 3 },
    { width: 430, year: 6, month: 5, day: 3, all: 3 },
    { width: 899, year: 6, month: 6, day: 6, all: 6 },
  ]
  const minimums = { year: 6, month: 5, day: 3, all: 3 }
  for (const row of expected) {
    for (const scale of Object.keys(minimums)) {
      const metrics = grid.xDriveMediaGalleryGridMetrics({
        width: row.width, itemCount: 100000, gap: 4,
        minColumns: minimums[scale], referenceColumnWidth: 144,
      })
      assert.equal(metrics.columns, row[scale], 'columns: ' + row.width + ' ' + scale)
      if (scale === 'year' && row.width >= 320) {
        assert.ok(metrics.columnWidth >= 44, 'Year tap area must reach 44 CSS px')
      }
    }
  }
  const wideWeb = grid.xDriveMediaGalleryGridMetrics({
    width: 390, itemCount: 100000, minColumnWidth: 144,
  })
  const mobile = grid.xDriveMediaGalleryGridMetrics({
    width: 390, itemCount: 100000, minColumns: 3, referenceColumnWidth: 144,
  })
  assert.equal(wideWeb.columns, 2)
  assert.equal(mobile.columns, 3)
  assert.equal(wideWeb.columnWidth, 193)
  assert.ok(Math.abs(mobile.columnWidth - 127.3333333) < 0.001)
})

test('P0-2 wide Web pixel-first layout stays unchanged by optional KFS mode', () => {
  for (const width of [390, 899, 900, 1200]) {
    for (const minColumnWidth of [96, 144, 192, 240]) {
      const actual = grid.xDriveMediaGalleryGridMetrics({
        width, itemCount: 10000, minColumnWidth,
      })
      const columns = Math.max(1, Math.floor((width + 4) / (minColumnWidth + 4)))
      assert.equal(actual.columns, columns)
      assert.equal(actual.totalRows, Math.ceil(10000 / columns))
    }
  }
})

test('P0-2 10k/100k virtual Grid and Timeline use same columns, gap and bounded range', () => {
  for (const n of [10000, 100000]) {
    const groups = [
      { key: '2026-09', start_index: 0, item_count: n / 2 },
      { key: '2026-10', start_index: n / 2, item_count: n / 2 },
    ]
    for (const width of [320, 360, 390, 430, 899]) {
      for (const minColumns of [2, 3, 5, 6, 10]) {
        const opts = { width, minColumns, referenceColumnWidth: 144 }
        const metrics = grid.xDriveMediaGalleryGridMetrics({
          ...opts, itemCount: n,
        })
        const layout = timeline.xDriveMediaGalleryTimelineLayout({
          ...opts, groups,
        })
        assert.equal(metrics.columns, layout.columns)
        assert.ok(Math.abs(metrics.columnWidth - layout.columnWidth) < 0.001)
        assert.ok(Math.abs(metrics.rowStep - layout.rowStep) < 0.001)
        const firstTop = Math.max(0, Math.floor(metrics.totalHeight * 0.73))
        const visible = grid.xDriveMediaGalleryGridWindow({
          itemCount: n, columns: metrics.columns, rowStep: metrics.rowStep,
          visibleTop: firstTop, visibleBottom: firstTop + 720,
        })
        assert.ok(visible.end > visible.start)
        assert.ok(visible.start >= 0 && visible.end <= n)
        assert.ok(visible.end - visible.start <= 350, 'Grid too many items')
        const timelineTop = Math.max(0, Math.floor(layout.totalHeight * 0.73))
        const slice = timeline.xDriveMediaGalleryTimelineWindow({
          layout, visibleTop: timelineTop, visibleBottom: timelineTop + 720,
        })
        const visibleCount = slice.segments.reduce(
          (sum, part) => sum + part.endIndex - part.startIndex, 0,
        )
        assert.ok(visibleCount > 0)
        assert.ok(visibleCount <= 350, 'Timeline too many items')
      }
    }
  }
})

test('P0-2 pinch changes the minimum column count once, with drift threshold and clamps', () => {
  const change = (distance) => grid.xDriveMediaGalleryPinchColumnCount(
    3, 100, distance, 2, 10,
  )
  assert.equal(change(100), 3)
  assert.equal(change(103), 3)
  assert.equal(change(150), 2)
  assert.equal(change(60), 5)
  assert.equal(change(20), 3)
  assert.equal(change(30), 10)
  assert.equal(change(999), 2)
  assert.equal(grid.xDriveMediaGalleryPinchColumnCount(
    6, 0, 160, 2, 10,
  ), 6)
})

test('P0-2 mobile gesture has one root, preserves Gallery anchor and uses same virtual components', () => {
  assert.match(gallerySource, /XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_KEY/)
  assert.match(gallerySource, /year: 6, month: 5, day: 3, all: 3/)
  assert.match(gallerySource, /mobileColumnsByScale\[effectiveTimeScale\]/)
  assert.match(gallerySource, /XDRIVE_MEDIA_GALLERY_MOBILE_REFERENCE_WIDTH = 144/)
  assert.match(gallerySource, /data-xdrive-gallery-photo-wall/)
  assert.match(gallerySource, /onTouchStartCapture=\{handleGalleryTouchStart\}/)
  assert.match(gallerySource, /onTouchMoveCapture=\{handleGalleryTouchMove\}/)
  assert.match(gallerySource, /onTouchEndCapture=\{handleGalleryTouchEnd\}/)
  assert.match(gallerySource, /clearGalleryTouchPress\(\)/)
  assert.match(gallerySource, /viewAnchorIndexRef\.current = index/)
  assert.match(gallerySource, /updateGalleryDensity\(xDriveMediaGalleryPinchColumnCount\(/)
  const virtualCallSites = gallerySource.match(/<(?:MediaVirtualTileGrid|MediaVirtualTimeline)\b[\s\S]*?\/>/g) || []
  assert.equal(virtualCallSites.length, 2, 'one shared virtual grid and one virtual timeline')
  for (const call of virtualCallSites) {
    assert.match(call, /minColumns=\{compactGallery \? mobileColumns : undefined\}/)
  }
  assert.match(gallerySource, /restoreAnchorRevision=\{viewAnchorRevision\}/)
  assert.match(gallerySource, /<MediaVirtualTileGrid/)
  assert.match(gallerySource, /<MediaVirtualTimeline/)
  assert.match(gallerySource, /<XDriveMediaGalleryViewer/)
  assert.match(chromeSource, /照片墙最少列数：\{density\} 列/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})
