const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const labelStart = gallery.indexOf('function mediaAssetChipLabel(')
const labelEnd = gallery.indexOf('\ntype MediaGalleryTimeScale', labelStart)
const tileStart = gallery.indexOf('type MediaTileProps = {')
const tileEnd = gallery.indexOf('\nfunction MediaTileGrid(', tileStart)
assert.ok(labelStart >= 0 && labelEnd > labelStart)
assert.ok(tileStart >= 0 && tileEnd > tileStart, 'test must render the real shared MediaTile')

const src = [
  "import { useCallback, useState } from 'react'",
  "import { Paper, Box, Stack, Chip, Checkbox, Tooltip, IconButton, Button, Typography, ImageIcon, MovieIcon, StarIcon, StarBorderIcon, XDriveLivePhotoGlyph, XDriveMediaAsyncThumbnail, XDriveMediaAsyncVideoPoster, useMediaQuery, xDriveMediaFallback, xDriveMediaFormatDuration } from './fixture'",
  "type MediaItem = any; type MediaThumbnailLoader = any; type XDriveMediaThumbnailScheduler = any; type XDriveMediaThumbnailPriority = any; type MediaPreviewURLLoader = any; type MediaVideoPosterSaver = any; type XDriveByteProgressHandler = any; type ReactMouseEvent<T> = any",
  gallery.slice(labelStart, labelEnd),
  gallery.slice(tileStart, tileEnd),
  'export { MediaTile }',
].join('\n')
const js = ts.transpileModule(src, {
  fileName: 'MediaTile.real.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  },
}).outputText
let touch = true
const LiveGlyph = ({ size }) => React.createElement('mounted-live-glyph', { size })
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  './fixture': {
    Paper: 'mounted-gallery-paper', Box: 'mounted-gallery-box',
    Stack: 'mounted-gallery-stack', Chip: 'mounted-gallery-chip',
    Checkbox: 'mounted-gallery-checkbox', Tooltip: 'mounted-gallery-tooltip',
    IconButton: 'mounted-gallery-icon-button', Button: 'mounted-gallery-button',
    Typography: 'mounted-gallery-typography',
    ImageIcon: 'mounted-image-icon', MovieIcon: 'mounted-video-icon',
    StarIcon: 'mounted-star-icon', StarBorderIcon: 'mounted-star-border',
    XDriveLivePhotoGlyph: LiveGlyph,
    XDriveMediaAsyncThumbnail: 'mounted-async-thumbnail',
    XDriveMediaAsyncVideoPoster: 'mounted-async-video-poster',
    useMediaQuery: () => touch,
    xDriveMediaFallback: () => 'media fallback',
    xDriveMediaFormatDuration: () => '00:10',
  },
}
const moduleRef = { exports: {} }
new Function('exports', 'module', 'require', js)(moduleRef.exports, moduleRef,
  id => { assert.ok(id in mocks, 'unexpected isolated dependency: ' + id); return mocks[id] })
const MediaTile = moduleRef.exports.MediaTile

const makeItem = (patch = {}) => ({
  node: { id: 41, name: 'IMG_0041.HEIC', revision: 1 },
  metadata: { media_kind: 'image', has_thumbnail: true, mime_type: 'image/heic' },
  favorite: false, asset_kind: 'live_photo', live_photo: { pair_id: 'verified' },
  ...patch,
})
const props = (item, overrides = {}) => ({
  item, logicalIndex: 0, selectionMode: false, selectedForAction: false,
  onSelect: () => {}, loadThumbnail: async () => null,
  onOpen: () => {}, onPreview: () => {}, onToggleFavorite: () => {},
  ...overrides,
})
const liveBadges = tree => tree.root.findAll(x => x.props?.['data-xdrive-media-live-indicator'])
const chips = tree => tree.root.findAll(x => x.type === 'mounted-gallery-chip')

test('real shared Live Photo tile uses 20px icon-only indicator, not full-width 实况 Chip, at mobile and wide pointer widths', async () => {
  for (const pointer of [true, false]) {
    touch = pointer
    let tree
    await act(async () => { tree = renderer.create(React.createElement(MediaTile, props(makeItem()))) })
    // A metadata-only or still-loading Live Photo must not obscure a
    // gray placeholder; wait for the actual browser-loaded still.
    assert.equal(liveBadges(tree).length, 0)
    const asyncThumb = tree.root.findByType('mounted-async-thumbnail')
    assert.equal(typeof asyncThumb.props.onImageReadyChange, 'function')
    await act(async () => { asyncThumb.props.onImageReadyChange(true) })
    assert.equal(liveBadges(tree).length, 1)
    const badge = liveBadges(tree)[0]
    assert.equal(badge.props.sx.width, 20)
    assert.equal(badge.props.sx.height, 20)
    assert.equal(badge.props['aria-hidden'], 'true')
    assert.equal(badge.props.sx.flexShrink, 0)
    assert.equal(tree.root.findByType('mounted-live-glyph').props.size, 13)
    assert.equal(chips(tree).filter(c => c.props.label === '实况').length, 0)
    const button = tree.root.findByType('mounted-gallery-paper')
    assert.equal(button.props['aria-label'], 'IMG_0041.HEIC，实况照片')
    assert.equal(button.props.sx.aspectRatio, '1 / 1')
    const overlay = tree.root.find(x => x.props?.['data-xdrive-media-tile-badges'])
    assert.equal(overlay.props.sx.maxWidth, 'calc(100% - 8px)')
    assert.equal(overlay.props.sx.right, 4)
    await act(async () => { tree.unmount() })
  }
})

test('fallback or unavailable still retains truthful compact Live type but never masks the whole photo', async () => {
  let tree
  const missingStill = makeItem({ metadata: { media_kind: 'image', has_thumbnail: false, mime_type: 'image/heic' } })
  await act(async () => { tree = renderer.create(React.createElement(MediaTile, props(missingStill))) })
  assert.equal(tree.root.findByType('mounted-async-thumbnail').props.nodeID, undefined)
  assert.equal(liveBadges(tree).length, 0)
  assert.equal(tree.root.findByType('mounted-gallery-paper').props['aria-label'],
    'IMG_0041.HEIC，实况照片')
  assert.equal(chips(tree).filter(c => c.props.label === '实况').length, 0)
  await act(async () => { tree.unmount() })
})


test('P0-L3 visible Live badge follows image load/error and current Node revision, never stale cache status', async () => {
  touch = true
  const rev = (version) => props(makeItem({
    node: { id: 51, name: 'IMG_0051.LIVP', revision: version },
  }))
  let tree
  await act(async () => { tree = renderer.create(React.createElement(MediaTile, rev(1))) })
  assert.equal(liveBadges(tree).length, 0)
  const first = tree.root.findByType('mounted-async-thumbnail')
  const oldReady = first.props.onImageReadyChange
  await act(async () => { oldReady(true) })
  assert.equal(liveBadges(tree).length, 1, 'only successful displayed image enables Live glyph')
  await act(async () => { oldReady(false) })
  assert.equal(liveBadges(tree).length, 0, 'image error hides Live glyph')
  await act(async () => { oldReady(true) })
  assert.equal(liveBadges(tree).length, 1)
  await act(async () => { tree.update(React.createElement(MediaTile, rev(2))) })
  assert.equal(liveBadges(tree).length, 0, 'new version is not yet loaded')
  await act(async () => { oldReady(true) })
  assert.equal(liveBadges(tree).length, 0, 'obsolete image callback cannot mark newer Node revision ready')
  const newReady = tree.root.findByType('mounted-async-thumbnail').props.onImageReadyChange
  await act(async () => { newReady(true) })
  assert.equal(liveBadges(tree).length, 1)
  await act(async () => { oldReady(false) })
  assert.equal(liveBadges(tree).length, 1, 'late error from obsolete image must not hide current still')
  await act(async () => { tree.unmount() })
})

test('unpaired still/video remain classified separately; video duration and other badges are not lost', async () => {
  const still = makeItem({ live_photo: null, asset_kind: 'image' })
  let tree
  await act(async () => { tree = renderer.create(React.createElement(MediaTile, props(still))) })
  assert.equal(liveBadges(tree).length, 0)
  assert.equal(tree.root.findByType('mounted-gallery-paper').props['aria-label'], undefined)
  await act(async () => { tree.unmount() })

  const video = makeItem({
    live_photo: null, asset_kind: 'video',
    metadata: { media_kind: 'video', has_thumbnail: true, duration_ms: 10000 },
  })
  await act(async () => { tree = renderer.create(React.createElement(MediaTile, props(video))) })
  assert.equal(liveBadges(tree).length, 0)
  assert.equal(chips(tree).filter(c => c.props.label === '00:10').length, 1)
  assert.equal(chips(tree).find(c => c.props.label === '00:10').props.sx.maxWidth, '100%')
  await act(async () => { tree.unmount() })
})

test('44px touch selection remains dominant and ordinary tap still opens the single shared Viewer', async () => {
  touch = true
  const selected = []
  const viewed = []
  let tree
  await act(async () => { tree = renderer.create(React.createElement(MediaTile, props(makeItem(), {
    selectionMode: true, selectedForAction: true,
    onSelect: (item) => selected.push(item.node.id),
    onPreview: (item) => viewed.push(item.node.id),
  }))) })
  assert.equal(liveBadges(tree).length, 0)
  assert.equal(tree.root.findAll(x => x.props?.['data-xdrive-media-tile-badges']).length, 0)
  const checkbox = tree.root.findByType('mounted-gallery-checkbox')
  assert.equal(checkbox.props.sx.width, 44)
  assert.equal(checkbox.props.sx.height, 44)
  await act(async () => { tree.root.findByType('mounted-gallery-paper').props.onClick({
    detail: 1, ctrlKey: false, metaKey: false, shiftKey: false,
  }) })
  assert.deepEqual(selected, [41])
  assert.deepEqual(viewed, [])
  await act(async () => { tree.update(React.createElement(MediaTile, props(makeItem(), {
    onPreview: (item) => viewed.push(item.node.id),
  }))) })
  await act(async () => { tree.root.findByType('mounted-gallery-paper').props.onClick({
    detail: 1, ctrlKey: false, metaKey: false, shiftKey: false,
  }) })
  assert.deepEqual(viewed, [41])
  await act(async () => { tree.unmount() })
})

test('all layout modes and platforms still use the one Gallery tile/VirtualCollection/API implementation', () => {
  const web = read('web/src/App.tsx')
  const adapter = read('web/src/mediaGalleryAdapter.ts')
  assert.equal((gallery.match(/<MediaTile\b/g) || []).length, 3)
  assert.equal((web.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /createWebMediaGalleryDataSource\(api\)/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(adapter, /listItemRange: \(limit, offset, query, signal\) =>/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})
