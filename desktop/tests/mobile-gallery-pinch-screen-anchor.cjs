const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
function load(file) {
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
      throw Error('Unexpected module: ' + name)
    },
  )
  return mod.exports
}
const anchor = load('ui/shared/src/mui/MediaGalleryScrollAnchor.ts')
const grid = load('ui/shared/src/mui/MediaGalleryVirtualGrid.ts')
const source = read('ui/shared/src/mui/MediaGallery.tsx')

test('Pinch preserves row Y inside an independently scrolling Gallery viewport', () => {
  const scrollViewportTop = 52
  const anchorViewportTop = 184
  const logicalRowTop = 25000
  const hostTop = -12000
  const delta = anchor.xDriveMediaGalleryAnchorScrollDelta({
    hostTop, scrollViewportTop, logicalRowTop, anchorViewportTop,
  })
  assert.equal(delta, 12764)
  const afterHostTop = hostTop - delta
  assert.equal(afterHostTop + logicalRowTop - scrollViewportTop, anchorViewportTop)
  // Old sorting/date navigation must still put its anchor at viewport top.
  const legacy = anchor.xDriveMediaGalleryAnchorScrollDelta({
    hostTop, scrollViewportTop, logicalRowTop,
  })
  assert.equal(legacy, 12948)
})

test('The same logical Node stays at the pinch Y across 10k/100k and KFS column changes', () => {
  let pairs = 0
  for (const total of [10000, 100000]) {
    for (const width of [320, 360, 390, 430, 899]) {
      for (const [oldColumns, newColumns] of [[3, 5], [5, 3], [3, 6], [6, 3]]) {
        const old = grid.xDriveMediaGalleryGridMetrics({
          width, itemCount: total, minColumns: oldColumns, referenceColumnWidth: 144,
        })
        const next = grid.xDriveMediaGalleryGridMetrics({
          width, itemCount: total, minColumns: newColumns, referenceColumnWidth: 144,
        })
        const index = Math.floor(total * 0.68)
        const beforeRowTop = Math.floor(index / old.columns) * old.rowStep
        const afterRowTop = Math.floor(index / next.columns) * next.rowStep
        const viewportTop = 52
        const oldTileViewportTop = 180
        const hostTop = viewportTop + oldTileViewportTop - beforeRowTop
        const delta = anchor.xDriveMediaGalleryAnchorScrollDelta({
          hostTop,
          scrollViewportTop: viewportTop,
          logicalRowTop: afterRowTop,
          anchorViewportTop: oldTileViewportTop,
        })
        // A scroll delta moves the virtual host opposite to the scroll.
        const restoredY = (hostTop - delta) + afterRowTop - viewportTop
        assert.ok(Math.abs(restoredY - oldTileViewportTop) < 0.00001)
        assert.equal(next.totalRows, Math.ceil(total / next.columns))
        assert.ok(Math.floor(index / next.columns) < next.totalRows)
        // Sparse window size stays viewport-bounded after the layout change.
        const visible = grid.xDriveMediaGalleryGridWindow({
          itemCount: total,
          columns: next.columns,
          rowStep: next.rowStep,
          visibleTop: Math.max(0, afterRowTop - oldTileViewportTop),
          visibleBottom: Math.max(0, afterRowTop - oldTileViewportTop) + 720,
        })
        assert.ok(visible.end - visible.start > 0 && visible.end - visible.start < 350)
        pairs++
      }
    }
  }
  assert.equal(pairs, 40)
})

test('Nonfinite coordinates are not allowed to corrupt scroll position', () => {
  const calculate = anchor.xDriveMediaGalleryAnchorScrollDelta
  assert.equal(calculate({
    hostTop: Number.NaN, scrollViewportTop: 0, logicalRowTop: 100,
  }), 0)
  assert.equal(calculate({
    hostTop: 0, scrollViewportTop: 0, logicalRowTop: Infinity,
  }), 0)
  assert.equal(calculate({
    hostTop: 0, scrollViewportTop: 0, logicalRowTop: -20,
  }), 0)
})

test('Only a pinch revision uses the screen-space anchor: sort, time and slider retain top alignment', () => {
  assert.match(source, /pinchViewportRestore\?\.revision === viewAnchorRevision/)
  assert.match(source, /anchorViewportTop = tile\.getBoundingClientRect\(\)\.top -/)
  assert.match(source, /mediaGalleryScrollParent\(galleryPhotoWallRef\.current \?\? tile\)/)
  assert.match(source, /pinch\.anchorViewportTop,/)
  assert.match(source, /setPinchViewportRestore\(/)
  assert.match(source, /viewAnchorRevision \+ 1, viewportTop: anchorViewportTop/)
  assert.match(source, /anchorViewportTop !== undefined && Number\.isFinite\(anchorViewportTop\)/)
  assert.equal((source.match(/restoreAnchorViewportOffset=\{/g) || []).length, 2)
  assert.equal((source.match(/restoreAnchorViewportOffset === undefined/g) || []).length, 2)
  assert.equal((source.match(/scrollMediaGalleryHostToOffset\(hostRef\.current, offset, restoreAnchorViewportOffset\)/g) || []).length, 2)
  assert.equal((source.match(/if \(afterLayout !== null\) window\.cancelAnimationFrame\(afterLayout\)/g) || []).length, 2)
  assert.match(source, /onTouchStartCapture=\{handleGalleryTouchStart\}/)
  assert.match(source, /onTouchCancelCapture=\{\(\) => finishGalleryPinch\(false\)\}/)
  assert.match(source, /onPointerDownCapture=\{handleGalleryPointerDown\}/)
  assert.match(source, /onVisibleAnchorChange=\{captureVisibleAnchor\}/)
  assert.match(source, /const virtualCollection = useXDriveVirtualCollection<MediaItem>/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})

test('The Gallery still has two shared virtual geometry owners, not a parallel Mobile list', () => {
  const virtual = source.match(/<(MediaVirtualTileGrid|MediaVirtualTimeline)\b[\s\S]*?\/>/g) || []
  assert.equal(virtual.length, 2)
  for (const entry of virtual) {
    assert.match(entry, /restoreAnchorViewportOffset=\{/)
    assert.match(entry, /minColumns=\{compactGallery \? mobileColumns : undefined\}/)
    assert.match(entry, /referenceColumnWidth=\{XDRIVE_MEDIA_GALLERY_MOBILE_REFERENCE_WIDTH\}/)
  }
  assert.doesNotMatch(source, /mobileItemRange|new MobileVirtualCollection/)
})
