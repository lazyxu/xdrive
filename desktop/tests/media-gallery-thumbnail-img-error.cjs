'use strict'
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
const original = read('ui/shared/src/mui/MediaGalleryPreviewMedia.tsx')
const start = original.indexOf('export function XDriveMediaAsyncThumbnail(')
const end = original.indexOf('\nconst mediaPosterConcurrency', start)
assert.ok(start >= 0 && end > start, 'the shared production thumbnail component must exist')
const source = [
  "import { useEffect, useState } from 'react'",
  "import { Box, Skeleton, XDriveMediaLoadingProgress } from './fixture'",
  'type MediaThumbnailLoader = any; type ReactNode = any',
  "function revokeIfBlob(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url) }",
  original.slice(start, end),
  'export { XDriveMediaAsyncThumbnail }',
].join('\n')
const js = ts.transpileModule(source, {
  fileName: 'MountedRealMediaAsyncThumbnail.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const mod = { exports: {} }
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  './fixture': {
    Box: 'gallery-test-box',
    Skeleton: 'gallery-test-skeleton',
    XDriveMediaLoadingProgress: 'gallery-test-progress',
  },
}
new Function('exports', 'module', 'require', js)(mod.exports, mod, id => {
  assert.ok(id in mocks, 'unexpected production component dependency ' + id)
  return mocks[id]
})
const Thumb = mod.exports.XDriveMediaAsyncThumbnail
const fallback = React.createElement('gallery-test-fallback', { 'data-fallback': true })
const image = view => view.root.findAll(x =>
  x.type === 'gallery-test-box' && x.props.component === 'img')[0]
const failed = view => view.root.findAll(x => x.type === 'gallery-test-fallback').length > 0
const flush = async () => { await Promise.resolve(); await new Promise(r => setImmediate(r)) }

test('P0-L2 real Gallery thumbnail switches to fallback on actual image element error without a second HTTP request', async () => {
  const calls = []
  const loadThumbnail = async (nodeID, signal, revision) => {
    calls.push([nodeID, revision, signal.aborted])
    return 'https://images.invalid/corrupt-asset'
  }
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Thumb, {
      nodeID: 63, revision: 7, alt: 'IMG_0063.HEIC',
      loadThumbnail, fallback,
    }))
    await flush()
  })
  assert.equal(image(view)?.props.src, 'https://images.invalid/corrupt-asset')
  assert.equal(failed(view), false, 'URL resolution alone is not an image decode failure')
  assert.equal(typeof image(view).props.onError, 'function',
    'the mounted production image must receive the native browser failure callback')
  await act(async () => { image(view).props.onError() })
  assert.equal(image(view), undefined, 'browser decode failure must hide the broken image element')
  assert.equal(failed(view), true, 'existing fallback must replace the broken image')
  assert.deepEqual(calls, [[63, 7, false]],
    'onError must not refetch the same broken original or start a second transfer')
  await act(async () => { view.unmount() })
})


test('P0-L3 real DOM image load only reports valid visible bytes and preserves a single fetch', async () => {
  const ready = []
  let calls = 0
  const loadThumbnail = async () => { calls++; return 'blob:valid-still' }
  let tree
  const element = revision => React.createElement(Thumb, {
    nodeID: 88, revision, alt: 'IMG_0088.LIVP',
    loadThumbnail, fallback, onImageReadyChange: value => ready.push(value),
    revokeOnDispose: false,
  })
  await act(async () => { tree = renderer.create(element(1)); await flush() })
  assert.deepEqual(ready, [false])
  const loaded = image(tree)
  assert.equal(loaded.props.src, 'blob:valid-still')
  await act(async () => { loaded.props.onLoad({ currentTarget: { naturalWidth: 0 } }) })
  assert.deepEqual(ready, [false], 'an undecoded/zero-width image cannot reveal Live glyph')
  await act(async () => { loaded.props.onLoad({ currentTarget: { naturalWidth: 512 } }) })
  assert.deepEqual(ready, [false, true])
  await act(async () => { loaded.props.onError() })
  assert.deepEqual(ready, [false, true, false])
  assert.equal(failed(tree), true)
  assert.equal(calls, 1, 'new presentation state must never trigger another thumbnail request')
  await act(async () => { tree.unmount() })
})

test('P0-L2 changed Node revision recovers from an image error without stale fallback persistence', async () => {
  const requests = []
  const loadThumbnail = async (id, signal, rev) => {
    requests.push(rev)
    return 'https://images.invalid/revision-' + rev
  }
  const element = revision => React.createElement(Thumb, {
    nodeID: 64, revision, alt: 'IMG_0064.HEIC', loadThumbnail, fallback,
  })
  let view
  await act(async () => { view = renderer.create(element(1)); await flush() })
  assert.equal(image(view)?.props.src, 'https://images.invalid/revision-1')
  await act(async () => { image(view).props.onError() })
  assert.equal(failed(view), true)
  await act(async () => { view.update(element(2)); await flush() })
  assert.equal(failed(view), false)
  assert.equal(image(view)?.props.src, 'https://images.invalid/revision-2')
  assert.deepEqual(requests, [1, 2], 'only source revision change restarts acquisition')
  await act(async () => { view.unmount() })
})

test('P0-L2 missing support/loader failure still fall back and never introduce new HTTP requests', async () => {
  let calls = 0
  const loadThumbnail = async () => { calls++; return 'https://images.invalid/never-needed' }
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Thumb, {
      nodeID: undefined, revision: 1, alt: 'missing',
      loadThumbnail, fallback,
    }))
    await flush()
  })
  assert.equal(failed(view), true)
  assert.equal(calls, 0, 'unsupported/no-thumbnail items must not trigger original-byte fallback')
  await act(async () => { view.unmount() })
  await act(async () => {
    view = renderer.create(React.createElement(Thumb, {
      nodeID: 65, revision: 1, alt: 'failed',
      loadThumbnail: async () => { throw Error('HTTP 503') }, fallback,
    }))
    await flush()
  })
  assert.equal(failed(view), true)
  await act(async () => { view.unmount() })
})

test('P0-L2 Web/Mobile/desktop share unchanged thin transport and Gallery virtual collection', () => {
  const page = read('ui/shared/src/mui/MediaGallery.tsx')
  const web = read('web/src/App.tsx')
  const adapter = read('web/src/mediaGalleryAdapter.ts')
  assert.equal((web.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /createWebMediaGalleryDataSource\(api\)/)
  assert.match(page, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(page, /<MediaVirtualTileGrid/)
  assert.match(page, /<MediaVirtualTimeline/)
  assert.match(page, /<XDriveMediaAsyncThumbnail/)
  assert.match(adapter, /loadThumbnail: \(nodeID, signal, revision, onProgress\) =>/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
  // No browser error path may bypass the authenticated Server/API/Agent transport.
  const thumb = original.slice(start, end)
  assert.doesNotMatch(thumb, /(?:new Image|fetch\(|XMLHttpRequest|preview-ticket)/)
  assert.match(thumb, /onError=\{\(\) => \{/)
  assert.match(thumb, /onImageReadyChange\?\.\(false\)/)
  assert.match(thumb, /setFailed\(true\)/)
  assert.match(thumb, /onLoad=\{\(event\) => \{/)
  assert.match(thumb, /event\.currentTarget\.naturalWidth > 0/)
})


test('P0-L4c1 real thumbnail image onError reports its exact failed URL without refetching', async () => {
  const broken = []
  let requests = 0
  const loader = async () => {
    requests += 1
    return 'blob:stale-cached-thumb'
  }
  let tree
  await act(async () => {
    tree = renderer.create(React.createElement(Thumb, {
      nodeID: 710, revision: 9, alt: 'IMG_0710.LIVP',
      loadThumbnail: loader, fallback, revokeOnDispose: false,
      onImageDecodeError: value => broken.push(value),
    }))
    await flush()
  })
  assert.equal(image(tree)?.props.src, 'blob:stale-cached-thumb')
  await act(async () => { image(tree).props.onError() })
  assert.deepEqual(broken, ['blob:stale-cached-thumb'])
  assert.equal(failed(tree), true)
  assert.equal(requests, 1, 'an image decoder failure must never launch a retry in the same mount')
  await act(async () => { tree.unmount() })

  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const scheduler = read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
  assert.match(gallery, /onImageDecodeError=\{thumbnailScheduler \? onThumbnailDecodeError : undefined\}/)
  assert.match(gallery, /thumbnailScheduler\?\.invalidateDecodedURL\(item\.node\.id, item\.node\.revision, failedURL\)/)
  assert.match(scheduler, /invalidateDecodedURL = \(nodeID: number, revision: number, failedURL: string\)/)
  assert.match(read('web/src/App.tsx'), /createWebMediaGalleryDataSource\(api\)/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
})
