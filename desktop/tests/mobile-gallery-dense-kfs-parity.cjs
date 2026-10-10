const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

const root = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const gridSource = read('ui/shared/src/mui/MediaGalleryVirtualGrid.ts')
const denseStart = gallery.indexOf('function MediaTileGrid({')
const denseEnd = gallery.indexOf('function mediaGalleryScrollParent(', denseStart)
assert.ok(denseStart >= 0 && denseEnd > denseStart, 'isolated dense Gallery renderer missing')

const gridJs = ts.transpileModule(gridSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const gridModule = { exports: {} }
new Function('exports', 'module', 'require', gridJs)(
  gridModule.exports, gridModule, (id) => { throw Error('unexpected grid import: ' + id) },
)
const metrics = gridModule.exports.xDriveMediaGalleryGridMetrics
const Box = React.forwardRef((props, ref) => (
  React.createElement('gallery-test-box', { ...props, ref }, props.children)
))
const MediaTile = ({ item, logicalIndex }) => (
  React.createElement('gallery-test-tile', {
    'data-node-id': item.node.id,
    'data-logical-index': logicalIndex,
  })
)
const source = [
  "import { useLayoutEffect, useRef, useState } from 'react'",
  "import { Box, MediaTile } from './fixture'",
  "import { xDriveMediaGalleryGridMetrics, XDRIVE_MEDIA_GALLERY_GRID_GAP } from './MediaGalleryVirtualGrid'",
  gallery.slice(denseStart, denseEnd),
  'export { MediaTileGrid }',
].join('\n')
const compiled = ts.transpileModule(source, {
  fileName: 'MediaTileGridExtract.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText
const componentModule = { exports: {} }
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  './fixture': { Box, MediaTile },
  './MediaGalleryVirtualGrid': gridModule.exports,
}
new Function('exports', 'module', 'require', compiled)(
  componentModule.exports, componentModule,
  (id) => {
    if (!(id in mocks)) throw Error('Unexpected component import: ' + id)
    return mocks[id]
  },
)
const DenseGrid = componentModule.exports.MediaTileGrid
const items = Array.from({ length: 12 }, (_, i) => ({ node: { id: i + 1 } }))
const baseProps = {
  items, minTileWidth: 144, selectionMode: false,
  selectedNodeIDs: new Set(), onSelect: () => {},
  loadThumbnail: async () => null,
  onOpen: () => {}, onPreview: () => {}, onToggleFavorite: () => {},
}

test('P0-2b dense Gallery fallback uses the SAME 390px KFS columns as shared virtual grid', async () => {
  const original = global.ResizeObserver
  let observer
  const node = { clientWidth: 390 }
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this }
    observe(actual) { assert.equal(actual, node) }
    disconnect() { this.disconnected = true }
  }
  let view
  try {
    await act(async () => {
      view = renderer.create(
        React.createElement(DenseGrid, {
          ...baseProps, minColumns: 3, referenceColumnWidth: 144,
        }),
        { createNodeMock: (el) => el.type === 'gallery-test-box' ? node : null },
      )
    })
    const template = () => view.root.findByType('gallery-test-box')
      .props.sx.gridTemplateColumns
    assert.equal(template(), 'repeat(3, minmax(0, 1fr))')
    assert.equal(metrics({
      width: node.clientWidth, itemCount: items.length,
      minColumns: 3, referenceColumnWidth: 144,
    }).columns, 3)
    assert.equal(view.root.findAllByType('gallery-test-tile').length, items.length)
    // A width change must recalculate columns with the exact shared metrics,
    // and not change item identity/order or create a parallel Range API.
    await act(async () => { node.clientWidth = 899; observer.callback() })
    assert.equal(template(), 'repeat(6, minmax(0, 1fr))')
    assert.deepEqual(
      view.root.findAllByType('gallery-test-tile').map((t) => t.props['data-node-id']),
      items.map((i) => i.node.id),
    )
    await act(async () => { view.unmount() })
    assert.equal(observer.disconnected, true)
  } finally {
    global.ResizeObserver = original
  }
})

test('P0-2b wide Web dense fallback keeps original minimum-width CSS layout', async () => {
  let view
  await act(async () => {
    view = renderer.create(React.createElement(DenseGrid, baseProps))
  })
  assert.equal(
    view.root.findByType('gallery-test-box').props.sx.gridTemplateColumns,
    'repeat(auto-fill, minmax(144px, 1fr))',
  )
  await act(async () => { view.unmount() })
})

test('P0-2b both dense Gallery routes opt into the same mobile columns, never a new List API', () => {
  const calls = gallery.match(/<MediaTileGrid\b[\s\S]*?\/>/g) || []
  assert.equal(calls.length, 2, 'the current dense Timeline and All routes must both be covered')
  for (const source of calls) {
    assert.match(source, /minColumns=\{compactGallery \? mobileColumns : undefined\}/)
    assert.match(source, /referenceColumnWidth=\{XDRIVE_MEDIA_GALLERY_MOBILE_REFERENCE_WIDTH\}/)
  }
  assert.equal((gallery.match(/<MediaVirtualTileGrid\b/g) || []).length, 1)
  assert.equal((gallery.match(/<MediaVirtualTimeline\b/g) || []).length, 1)
  assert.match(gallery, /const virtualCollection = useXDriveVirtualCollection<MediaItem>/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})

test('P0-2b dense and sparse geometry agree across KFS 320-899px and 10k/100k', () => {
  for (const itemCount of [10000, 100000]) {
    for (const width of [320, 360, 390, 430, 899]) {
      for (const minColumns of [2, 3, 5, 6, 10]) {
        const sparse = metrics({
          width, itemCount, minColumns, referenceColumnWidth: 144,
        })
        const dense = metrics({
          width, itemCount: 12, minColumns, referenceColumnWidth: 144,
        })
        assert.equal(dense.columns, sparse.columns)
        assert.equal(dense.columnWidth, sparse.columnWidth)
        assert.equal(dense.rowStep, sparse.rowStep)
      }
    }
  }
})
