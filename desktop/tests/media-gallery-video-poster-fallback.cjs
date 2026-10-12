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
const start = original.indexOf('const mediaPosterConcurrency =')
const end = original.indexOf('\nexport function xDriveMediaFallback(', start)
assert.ok(start >= 0 && end > start, 'real production video poster component must exist')
const source = [
  "import { useEffect, useRef, useState } from 'react'",
  "import { Box, XDriveMediaLoadingProgress, xDriveResolveMediaVideoPoster, xDriveCaptureVideoPosterBlob } from './fixture'",
  'type ReactNode = any',
  'type MediaThumbnailLoader = any',
  'type MediaPreviewURLLoader = any',
  'type MediaVideoPosterSaver = any',
  'type XDriveMediaLoadStage = any',
  "function revokeIfBlob(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url) }",
  original.slice(start, end),
  'export { XDriveMediaAsyncVideoPoster }',
].join('\n')
const js = ts.transpileModule(source, {
  fileName: 'RealGalleryVideoPosterState.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
let resolvePoster = async () => null
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  './fixture': {
    Box: 'gallery-poster-box',
    XDriveMediaLoadingProgress: 'gallery-poster-progress',
    xDriveResolveMediaVideoPoster: opts => resolvePoster(opts),
    xDriveCaptureVideoPosterBlob: async () => null,
  },
}
const mod = { exports: {} }
new Function('exports', 'module', 'require', js)(mod.exports, mod, id => {
  assert.ok(id in mocks, 'unexpected production dependency: ' + id)
  return mocks[id]
})
const Poster = mod.exports.XDriveMediaAsyncVideoPoster
const fallback = React.createElement('gallery-poster-fallback')
const loader = async () => null
const element = revision => React.createElement(Poster, {
  nodeID: 33, revision, alt: 'IMG_0033.MOV',
  loadPreviewURL: loader, loadThumbnail: loader, fallback,
})
const options = { createNodeMock: node => node.type === 'gallery-poster-box' ? {} : null }
const find = (view, type) => view.root.findAll(x => x.type === type)
const img = view => find(view, 'gallery-poster-box').find(x => x.props.component === 'img')
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await new Promise(done => setImmediate(done))
}
async function mounted(revision = 1) {
  let view
  await act(async () => { view = renderer.create(element(revision), options); await flush() })
  return view
}

test('P0-L5 terminal missing cold-video poster shows fallback and no indefinite progress', async () => {
  let calls = 0
  resolvePoster = async () => { calls++; return null }
  const view = await mounted()
  assert.equal(img(view), undefined)
  assert.equal(find(view, 'gallery-poster-fallback').length, 1)
  assert.equal(find(view, 'gallery-poster-progress').length, 0)
  assert.equal(calls, 1, 'no extra original-video request after failure')
  await act(async () => { view.unmount() })
})

test('P0-L5 actual browser decode error becomes terminal without duplicate request', async () => {
  let calls = 0
  resolvePoster = async () => { calls++; return 'https://images.invalid/broken.jpg' }
  const view = await mounted()
  const old = img(view)
  assert.equal(old?.props.src, 'https://images.invalid/broken.jpg')
  assert.equal(typeof old.props.onError, 'function')
  await act(async () => { old.props.onError() })
  assert.equal(img(view), undefined)
  assert.equal(find(view, 'gallery-poster-fallback').length, 1)
  assert.equal(find(view, 'gallery-poster-progress').length, 0)
  assert.equal(calls, 1)
  await act(async () => { view.unmount() })
})

test('P0-L5 stale old-revision DOM error cannot hide a new poster', async () => {
  const calls = []
  resolvePoster = async ({ revision }) => {
    calls.push(revision)
    return 'https://images.invalid/poster-' + revision + '.jpg'
  }
  const view = await mounted(1)
  const priorOnError = img(view).props.onError
  await act(async () => { view.update(element(2)); await flush() })
  assert.equal(img(view)?.props.src, 'https://images.invalid/poster-2.jpg')
  await act(async () => { priorOnError() })
  assert.equal(img(view)?.props.src, 'https://images.invalid/poster-2.jpg')
  assert.deepEqual(calls, [1, 2])
  await act(async () => { view.unmount() })
})

test('P0-L5 rejected poster resolution stops spinner instead of appearing pending', async () => {
  resolvePoster = async () => { throw Error('video source missing') }
  const view = await mounted()
  assert.equal(img(view), undefined)
  assert.equal(find(view, 'gallery-poster-fallback').length, 1)
  assert.equal(find(view, 'gallery-poster-progress').length, 0)
  await act(async () => { view.unmount() })
})

test('P0-L5 common Web/Mobile Gallery virtualization and 52px App Frame remain identical', () => {
  const page = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(page, /<XDriveMediaAsyncVideoPoster/)
  assert.match(page, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(page, /<MediaVirtualTileGrid/)
  assert.match(page, /<MediaVirtualTimeline/)
  assert.match(read('web/src/App.tsx'), /createWebMediaGalleryDataSource\(api\)/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'), /calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.doesNotMatch(original.slice(start, end), /(?:new Image|fetch\(|XMLHttpRequest)/)
})
