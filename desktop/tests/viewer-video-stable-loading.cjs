'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

// Compile the actual shared FilePreviewSurface, replacing only the OS/browser
// and presentational imports. This is a mounted React regression, not a copy
// of the loader/state machine under test.
const root = path.resolve(__dirname, '../..')
const sourceFile = 'ui/shared/src/mui/FilePreviewSurface.tsx'
const source = fs.readFileSync(path.join(root, sourceFile), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: sourceFile,
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(issue => issue.category === ts.DiagnosticCategory.Error)
  .map(issue => ts.flattenDiagnosticMessageText(issue.messageText, '\n')), [])

const mui = Object.fromEntries(
  ['Box', 'Button', 'CircularProgress', 'IconButton', 'Stack', 'Tooltip', 'Typography']
    .map(name => [name, name.toLowerCase()]),
)
mui.useMediaQuery = () => false
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui,
  '../file-preview': {
    xDriveClassifyFilePreview: item => item?.mimeType?.startsWith('video/') ? 'video' : 'none',
  },
  '../file-preview-viewport': {
    xDriveAnchorPreviewZoom: () => ({ scale: 1, offset: { x: 0, y: 0 } }),
    xDriveClampPreviewViewport: value => value,
  },
  '../media-gallery-photo-swipe': {
    XDRIVE_PHOTO_PAGE_SETTLE_MS: 280,
    xDrivePhotoFingerTranslation: () => 0,
    xDrivePhotoPageTurn: () => null,
  },
  './LivePhotoSurface': { XDriveLivePhotoSurface: 'live-photo' },
  './MediaLoadProgress': { XDriveMediaLoadingProgress: 'media-loading-progress' },
  './mediaPreviewStreamTeardown': { xDriveAbortHTMLMediaElement: () => undefined },
  './FilePreviewImage': { XDriveDecodedImagePreview: 'decoded-image-preview' },
  './FilePreviewTransformedMedia': { XDriveTransformedVideoPreview: 'transformed-video' },
}
const loaded = { exports: {} }
new Function('exports', 'module', 'require', compiled.outputText)(
  loaded.exports, loaded, name => {
    if (name.startsWith('@mui/icons-material/')) return 'icon'
    assert.ok(Object.hasOwn(mocks, name), 'unexpected Viewer dependency: ' + name)
    return mocks[name]
  },
)
const Surface = loaded.exports.XDriveFilePreviewSurface
const target = id => ({
  id, name: 'clip-' + id + '.mp4', kind: 'file', mimeType: 'video/mp4',
  revision: 1, size: 1_000_000_000,
})
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
}
const selected = (view, key, value) => view.root.findAll(n => n.props?.[key] === value)
const videoShell = view => {
  const shell = selected(view, 'data-xdrive-preview-media-state', 'video')
  assert.equal(shell.length, 1, 'single stable video viewport required')
  return shell[0]
}
async function mountedVideo(loader, item = target(1)) {
  let view
  await act(async () => {
    view = Renderer.create(React.createElement(Surface, {
      target: item, loadPreviewURL: loader,
      minHeight: 0, maxHeight: 'none',
      videoControlsSafeArea: 'actions-filmstrip',
    }))
    await flush()
  })
  return view
}

test('video loading placeholder and first decoded frame share exact shell and controls clearance', async () => {
  let complete
  let requests = 0
  const url = new Promise(resolve => { complete = resolve })
  const loader = async (_target, kind, signal) => {
    requests++
    assert.equal(kind, 'video')
    assert.equal(signal?.aborted, false)
    return url
  }
  const view = await mountedVideo(loader)
  try {
    const before = videoShell(view).props.sx
    assert.equal(before.minHeight, 0)
    assert.equal(before.boxSizing, 'border-box')
    assert.equal(typeof before.pb, 'string')
    assert.match(before.pb, /actions-filmstrip-clearance/)
    assert.equal(selected(view, 'data-xdrive-preview-media-loading', true).length, 0)
    assert.equal(view.root.findAllByType('media-loading-progress').length, 1,
      'pending signed URL should provide honest transfer status')
    assert.equal(view.root.findAllByType('video').length, 0,
      'do not start native playback before the signed URL is authorized')

    await act(async () => { complete('http://127.0.0.1:45678/preview-token'); await flush() })
    const native = view.root.findByType('video')
    assert.equal(native.props.preload, 'metadata',
      'active Viewer must not force-download a multi-GiB original for first frame')
    assert.equal(native.props.controls, true)
    assert.deepEqual(videoShell(view).props.sx, before,
      'native video must not resize the shared viewport when its signed URL resolves')

    await act(async () => { native.props.onLoadedData(); await flush() })
    assert.equal(view.root.findAllByType('video').length, 1)
    assert.deepEqual(videoShell(view).props.sx, before,
      'first decoded frame must not move the controls or the video container')
    assert.equal(requests, 1, 'first frame must not reload the full media source')

    await act(async () => { view.root.findByType('video').props.onWaiting(); await flush() })
    assert.equal(selected(view, 'data-xdrive-preview-media-loading', true).length, 1)
    assert.deepEqual(videoShell(view).props.sx, before,
      'buffering must not shift navigation or video content')
    await act(async () => { view.root.findByType('video').props.onCanPlay(); await flush() })
    assert.equal(selected(view, 'data-xdrive-preview-media-loading', true).length, 0)
    assert.equal(view.root.findAllByType('video').length, 1)
    assert.equal(requests, 1)
  } finally {
    await act(async () => view.unmount())
  }
})

test('changing video while previous signed URL is slow aborts the old request and never paints stale bytes', async () => {
  let completeOld
  const old = new Promise(resolve => { completeOld = resolve })
  const requests = []
  const loader = async (item, kind, signal) => {
    requests.push({ item: item.id, kind, signal })
    return item.id === 1 ? old : 'http://127.0.0.1:45678/second'
  }
  const props = item => ({
    target: item, loadPreviewURL: loader, minHeight: 0, maxHeight: 'none',
    videoControlsSafeArea: 'actions-filmstrip',
  })
  const view = await mountedVideo(loader)
  try {
    assert.equal(requests.length, 1)
    await act(async () => {
      view.update(React.createElement(Surface, props(target(2))))
      await flush()
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(view.root.findByType('video').props.src, 'http://127.0.0.1:45678/second')
    await act(async () => { completeOld('http://127.0.0.1:45678/stale-first'); await flush() })
    assert.equal(videoShell(view).props.sx.minHeight, 0)
    assert.equal(view.root.findByType('video').props.src, 'http://127.0.0.1:45678/second',
      'late first source must not replace or restart the second video')
  } finally {
    await act(async () => view.unmount())
  }
})
