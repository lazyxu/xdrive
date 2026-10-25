'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')
const repo = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(repo, p), 'utf8')
const filmstripPath = 'ui/shared/src/mui/MediaGalleryFilmstrip.tsx'
const source = read(filmstripPath)
const compile = (code, fileName) => ts.transpileModule(code, {
  fileName,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const evaluate = (code, resolve) => {
  const m = { exports: {} }
  new Function('exports', 'module', 'require', code)(m.exports, m, resolve)
  return m.exports
}
const utilsFile = 'ui/shared/src/mui/MediaGalleryUtils.ts'
const utils = evaluate(compile(read(utilsFile), utilsFile), require)
const host = tag => React.forwardRef(({ children, ...props }, ref) =>
  React.createElement(tag, { ...props, ref }, children))
const mui = { Box: host('div'), ButtonBase: host('button'),
  Stack: host('div'), Typography: host('span') }
const { XDriveMediaGalleryFilmstrip } = evaluate(compile(source, filmstripPath), name => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return require(name)
  if (name === '@mui/material') return mui
  if (name === './MediaGalleryUtils') return utils
  if (name === './LivePhotoSurface') return {
    XDriveLivePhotoGlyph: () => React.createElement('svg', { 'data-xdrive-live-photo-glyph': 'sf-livephoto' }),
  }
  if (name === './MediaGalleryThumbnailScheduler') return {
    XDriveMediaThumbnailScheduler: class {
      load() { return Promise.resolve(null) }
      setRetention() {}
      dispose() {}
      invalidateDecodedURL() { return false }
    },
  }
  if (name === './MediaGalleryPreviewMedia') return {
    XDriveMediaAsyncThumbnail: props => React.createElement('span', {
      'data-test-thumbnail': true,
      'data-node-id': props.nodeID,
      onImageReadyChange: props.onImageReadyChange,
    }),
    xDriveMediaFallback: () => null,
  }
  throw Error('unexpected Filmstrip dependency: ' + name)
})
const entry = (index, name, media_kind, duration_ms) => ({
  index,
  item: {
    node: { id: index + 1, revision: 1, name },
    metadata: { media_kind, duration_ms, has_thumbnail: true },
  },
})
test('Filmstrip reuses the Gallery/Inspector duration formatter, no second formatter', () => {
  assert.match(source, /import \{ xDriveMediaFormatDuration \} from '\.\/MediaGalleryUtils'/)
  assert.match(read('ui/shared/src/mui/MediaGallery.tsx'), /xDriveMediaFormatDuration\(item\.metadata\.duration_ms\)/)
})
test('mounted Viewer Filmstrip shows video time, safe fallback and accessible labels', async () => {
  const entries = [
    entry(0, 'short.mp4', 'video', 65999),
    entry(1, 'long.mp4', 'video', 3661000),
    entry(2, 'unknown.mp4', 'video', undefined),
    entry(3, 'invalid.mp4', 'video', Number.POSITIVE_INFINITY),
    entry(4, 'photo.jpg', 'image', undefined),
  ]
  let view
  try {
    await act(async () => {
      view = create(React.createElement(XDriveMediaGalleryFilmstrip, {
        entries, activeIndex: 0, loadThumbnail: async () => null, onSelect() {},
      }))
    })
    const labels = view.root.findAllByType('button').map(el => el.props['aria-label'])
    assert.deepEqual(labels, [
      '预览 short.mp4，视频，时长 1:06',
      '预览 long.mp4，视频，时长 1:01:01',
      '预览 unknown.mp4，视频',
      '预览 invalid.mp4，视频',
      '预览 photo.jpg',
    ])
    const text = view.root.findAllByType('span').map(el => el.children.join(''))
    assert.equal(text.filter(value => value === '1:06').length, 1)
    assert.equal(text.filter(value => value === '1:01:01').length, 1)
    assert.equal(text.filter(value => value === '视频').length, 2)
    assert.equal(view.root.findAllByType('button').length, 5)
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('decoded Live Photo thumbnail uses existing SF glyph and rejects stale Owner/revision readiness', async () => {
  const first = { ...entry(5, 'live.jpg', 'image'), live_photo: true }
  // MediaItem stores Live relation on the item, not on the node.
  const liveItem = { ...first.item, live_photo: true }
  const sourceEntries = [{ index: 5, item: liveItem }]
  const oldLoader = async () => null
  const newLoader = async () => null
  const props = (entries, loadThumbnail) => ({
    entries, activeIndex: 5, loadThumbnail, onSelect() {},
  })
  const findBadge = tree => tree.root.findAll(node =>
    node.type === 'div' && node.props?.['data-xdrive-gallery-filmstrip-live-indicator'] !== undefined)
  const findThumb = tree => tree.root.findAll(node =>
    node.type === 'span' && node.props['data-test-thumbnail'])[0]
  let view
  try {
    await act(async () => {
      view = create(React.createElement(XDriveMediaGalleryFilmstrip,
        props(sourceEntries, oldLoader)))
    })
    assert.equal(view.root.findByType('button').props['aria-label'], '预览 live.jpg，实况照片')
    assert.equal(findBadge(view).length, 0, 'do not show Live glyph before actual thumbnail readiness')
    const staleOnReady = findThumb(view).props.onImageReadyChange
    assert.equal(typeof staleOnReady, 'function')
    await act(async () => staleOnReady(true))
    assert.equal(findBadge(view).length, 1)
    assert.equal(view.root.findAll(node =>
      node.type === 'svg' && node.props?.['data-xdrive-live-photo-glyph'] === 'sf-livephoto').length, 1)

    await act(async () => view.update(React.createElement(XDriveMediaGalleryFilmstrip,
      props(sourceEntries, newLoader))))
    assert.equal(findBadge(view).length, 0, 'rebound Owner must not inherit old decoded badge')
    await act(async () => staleOnReady(true))
    assert.equal(findBadge(view).length, 0, 'old Owner callback cannot show badge after rebound')
    const newOnReady = findThumb(view).props.onImageReadyChange
    await act(async () => newOnReady(true))
    assert.equal(findBadge(view).length, 1)
    await act(async () => newOnReady(false))
    assert.equal(findBadge(view).length, 0, 'decode failure clears Live badge')

    // Live relation discovery/withdrawal is not necessarily a Node revision.
    // A decoded still from the prior Live classification must not light a
    // restored Live badge before the currently visible still becomes ready.
    await act(async () => newOnReady(true))
    assert.equal(findBadge(view).length, 1)
    const regularStill = [{ index: 5, item: { ...liveItem, live_photo: false } }]
    await act(async () => view.update(React.createElement(XDriveMediaGalleryFilmstrip,
      props(regularStill, newLoader))))
    assert.equal(findBadge(view).length, 0)
    await act(async () => view.update(React.createElement(XDriveMediaGalleryFilmstrip,
      props(sourceEntries, newLoader))))
    assert.equal(findBadge(view).length, 0,
      'restored Live relation must not inherit previously decoded still state')
    await act(async () => newOnReady(true))
    assert.equal(findBadge(view).length, 0,
      'delayed callback from the earlier Live relation must be rejected')
    const relationOnReady = findThumb(view).props.onImageReadyChange
    await act(async () => relationOnReady(true))
    assert.equal(findBadge(view).length, 1)
    await act(async () => relationOnReady(false))
    assert.equal(findBadge(view).length, 0)

    const revised = [{ index: 5, item: {
      ...liveItem, node: { ...liveItem.node, revision: 2 },
    } }]
    await act(async () => view.update(React.createElement(XDriveMediaGalleryFilmstrip,
      props(revised, newLoader))))
    assert.equal(findBadge(view).length, 0, 'new revision has a fresh decoded state')
    await act(async () => newOnReady(true))
    assert.equal(findBadge(view).length, 0, 'old revision callback cannot mark new still ready')
  } finally {
    if (view) await act(async () => view.unmount())
  }
})
