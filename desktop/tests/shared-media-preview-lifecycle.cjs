const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

function loadShared(filename, bindings = {}, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const localRequire = (request) => {
    if (Object.hasOwn(bindings, request)) return bindings[request]
    if (!request.startsWith('.')) return require(request)
    const base = path.resolve(path.dirname(filename), request)
    const resolved = [base + '.ts', base + '.tsx'].find(fs.existsSync)
    return resolved ? loadShared(resolved, bindings, cache) : require(base)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

const repo = path.join(__dirname, '..', '..')
const mui = require('@mui/material')
const Box = React.forwardRef(({ component = 'div', sx, ...props }, ref) =>
  React.createElement(component, { ...props, ref }))
const Chip = React.forwardRef(({ icon, label, sx, ...props }, ref) =>
  React.createElement('span', { ...props, ref }, icon, label))
const bindings = { '@mui/material': { ...mui, Box, Chip } }
const { XDriveFilePreviewSurface } = loadShared(
  path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'),
  bindings,
)
const { XDriveLivePhotoSurface } = loadShared(
  path.join(repo, 'ui/shared/src/mui/LivePhotoSurface.tsx'),
  bindings,
)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function renderPreview(name) {
  let renderer
  await act(async () => {
    renderer = create(React.createElement(XDriveFilePreviewSurface, {
      target: { id: 1, revision: 1, name, kind: 'file' },
      loadPreviewURL: async () => 'https://example.invalid/preview',
      fallback: React.createElement('div', { role: 'alert' }, 'Preview unavailable'),
    }))
  })
  return renderer
}

test('video stays busy until a frame is available and decode failure uses shared fallback', async () => {
  const renderer = await renderPreview('movie.mp4')
  try {
    const root = renderer.root.findByProps({ 'data-xdrive-file-preview-kind': 'video' })
    const video = renderer.root.findByType('video')
    assert.equal(root.props['aria-busy'], true)
    assert.ok(
      renderer.root.findAllByProps({ 'data-xdrive-preview-media-loading': true }).length >= 1,
      'the media loading wrapper must stay active before first-frame readiness',
    )
    await act(async () => video.props.onLoadedData())
    assert.equal(root.props['aria-busy'], undefined)

    await act(async () => video.props.onError())
    assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Preview unavailable')
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('audio waits for metadata and PDF waits for frame load', async () => {
  for (const [name, type, readyEvent] of [
    ['sound.mp3', 'audio', 'onLoadedMetadata'],
    ['document.pdf', 'iframe', 'onLoad'],
  ]) {
    const renderer = await renderPreview(name)
    try {
      const root = renderer.root.findByProps({
        'data-xdrive-file-preview-kind': name.endsWith('.pdf') ? 'pdf' : 'audio',
      })
      const media = renderer.root.findByType(type)
      assert.equal(root.props['aria-busy'], true, name + ' must remain busy after URL acquisition')
      await act(async () => media.props[readyEvent]())
      assert.equal(root.props['aria-busy'], undefined, name + ' must become ready after presentation event')
    } finally {
      await act(async () => renderer.unmount())
    }
  }
})

test('a readiness event from a replaced URL cannot clear the newer media loading state', async () => {
  let renderer
  await act(async () => {
    renderer = create(React.createElement(XDriveFilePreviewSurface, {
      target: { id: 1, revision: 1, name: 'first.mp4', kind: 'file' },
      loadPreviewURL: async () => 'https://example.invalid/first',
    }))
  })
  try {
    const oldReady = renderer.root.findByType('video').props.onLoadedData
    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, {
        target: { id: 2, revision: 1, name: 'second.mp4', kind: 'file' },
        loadPreviewURL: async () => 'https://example.invalid/second',
      }))
    })
    const root = renderer.root.findByProps({ 'data-xdrive-file-preview-kind': 'video' })
    assert.equal(root.props['aria-busy'], true)
    await act(async () => oldReady())
    assert.equal(root.props['aria-busy'], true, 'stale first-media event must not mark second media ready')
    await act(async () => renderer.root.findByType('video').props.onCanPlay())
    assert.equal(root.props['aria-busy'], undefined)
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('Live Photo callback identity updates do not reset a resolved motion source', async () => {
  let disposeCalls = 0
  let firstCalls = 0
  let secondCalls = 0
  const firstLoader = async () => {
    firstCalls += 1
    return { url: 'https://example.invalid/motion-1', dispose: () => { disposeCalls += 1 } }
  }
  const secondLoader = async () => {
    secondCalls += 1
    return { url: 'https://example.invalid/motion-2', dispose: () => { disposeCalls += 1 } }
  }
  let renderer
  await act(async () => {
    renderer = create(React.createElement(XDriveLivePhotoSurface, {
      still: React.createElement('div', null, 'still'),
      stillReady: true,
      loadMotion: firstLoader,
      motionKey: '1:1',
    }))
  })
  try {
    const press = () => renderer.root.findByProps({ role: 'button' }).props.onKeyDown({
      key: ' ', repeat: false, preventDefault() {}, stopPropagation() {},
    })
    await act(async () => press())
    assert.equal(firstCalls, 1)
    assert.equal(renderer.root.findByType('video').props.src, 'https://example.invalid/motion-1')

    await act(async () => {
      renderer.update(React.createElement(XDriveLivePhotoSurface, {
        still: React.createElement('div', null, 'still'),
        stillReady: true,
        loadMotion: secondLoader,
        motionKey: '1:1',
      }))
    })
    assert.equal(renderer.root.findByType('video').props.src, 'https://example.invalid/motion-1')
    assert.equal(disposeCalls, 0)
    assert.equal(secondCalls, 0)

    await act(async () => {
      renderer.update(React.createElement(XDriveLivePhotoSurface, {
        still: React.createElement('div', null, 'still 2'),
        stillReady: true,
        loadMotion: secondLoader,
        motionKey: '1:2',
      }))
    })
    assert.equal(disposeCalls, 1, 'identity change must dispose the old resolved motion source')
    assert.equal(renderer.root.findAllByType('video').length, 0)
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('Live Photo disposes a late source resolved after media identity changed', async () => {
  const pending = deferred()
  let disposeCalls = 0
  let renderer
  await act(async () => {
    renderer = create(React.createElement(XDriveLivePhotoSurface, {
      still: React.createElement('div', null, 'still'),
      stillReady: true,
      loadMotion: () => pending.promise,
      motionKey: '1:1',
    }))
  })
  try {
    await act(async () => renderer.root.findByProps({ role: 'button' }).props.onKeyDown({
      key: ' ', repeat: false, preventDefault() {}, stopPropagation() {},
    }))
    await act(async () => {
      renderer.update(React.createElement(XDriveLivePhotoSurface, {
        still: React.createElement('div', null, 'still 2'),
        stillReady: true,
        loadMotion: async () => null,
        motionKey: '1:2',
      }))
    })
    await act(async () => pending.resolve({
      url: 'https://example.invalid/late-motion',
      dispose: () => { disposeCalls += 1 },
    }))
    assert.equal(disposeCalls, 1)
    assert.equal(renderer.root.findAllByType('video').length, 0)
  } finally {
    await act(async () => renderer.unmount())
  }
})
