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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
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
const { XDriveFilePreviewSurface } = loadShared(path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'))

async function mountMedia(name) {
  let renderer
  await act(async () => {
    renderer = create(React.createElement(XDriveFilePreviewSurface, {
      target: { id: 9, revision: 3, name, kind: 'file' },
      loadPreviewURL: async () => 'https://example.invalid/preview',
      fallback: React.createElement('div', { role: 'alert' }, 'Preview unavailable'),
    }))
  })
  return renderer
}
function root(renderer, kind) {
  return renderer.root.findByProps({ 'data-xdrive-file-preview-kind': kind })
}

test('video busy state follows first frame and later buffering', async () => {
  const renderer = await mountMedia('clip.mp4')
  try {
    const video = renderer.root.findByType('video')
    assert.equal(root(renderer, 'video').props['aria-busy'], true)
    await act(async () => video.props.onLoadedData())
    assert.equal(root(renderer, 'video').props['aria-busy'], undefined)
    await act(async () => video.props.onWaiting())
    assert.equal(root(renderer, 'video').props['aria-busy'], true)
    await act(async () => video.props.onPlaying())
    assert.equal(root(renderer, 'video').props['aria-busy'], undefined)
    await act(async () => video.props.onError())
    assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Preview unavailable')
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('audio and PDF stay busy until their renderer is ready and use shared fallback', async () => {
  for (const scenario of [
    { name: 'track.mp3', kind: 'audio', host: 'audio', ready: 'onLoadedMetadata' },
    { name: 'document.pdf', kind: 'pdf', host: 'iframe', ready: 'onLoad' },
  ]) {
    const renderer = await mountMedia(scenario.name)
    try {
      const host = renderer.root.findByType(scenario.host)
      assert.equal(root(renderer, scenario.kind).props['aria-busy'], true)
      await act(async () => host.props[scenario.ready]())
      assert.equal(root(renderer, scenario.kind).props['aria-busy'], undefined)
      await act(async () => host.props.onError())
      assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Preview unavailable')
    } finally {
      await act(async () => renderer.unmount())
    }
  }
})

test('transformed video forwards ready and waiting events', async () => {
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: { id: 10, revision: 1, name: 'edited.mp4', kind: 'file' },
        loadPreviewURL: async () => 'https://example.invalid/edited',
        mediaTransform: { rotationDegrees: 90 },
      }))
    })
    const video = renderer.root.findByType('video')
    assert.equal(root(renderer, 'video').props['aria-busy'], true)
    await act(async () => video.props.onCanPlay())
    assert.equal(root(renderer, 'video').props['aria-busy'], undefined)
    await act(async () => video.props.onWaiting())
    assert.equal(root(renderer, 'video').props['aria-busy'], true)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('Live Photo loader callback changes do not reset a source, but source identity does', async () => {
  const Chip = React.forwardRef(({ icon, label }, ref) => React.createElement('span', { ref }, icon, label))
  const { XDriveLivePhotoSurface } = loadShared(
    path.join(repo, 'ui/shared/src/mui/LivePhotoSurface.tsx'),
    { '@mui/material': { ...require('@mui/material'), Chip } },
    new Map(),
  )
  let renderer
  let disposeCalls = 0
  let loaderCalls = 0
  let resolveMotion
  const pending = new Promise((resolve) => { resolveMotion = resolve })
  const still = React.createElement('div', null, 'still')
  const button = () => renderer.root.findAllByProps({ role: 'button' })[0]
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveLivePhotoSurface, {
        still, sourceKey: '7:1', loadMotion: () => { loaderCalls += 1; return pending },
      }), {
        createNodeMock: (element) => element.type === 'video'
          ? { pause() {}, currentTime: 0, volume: 1, readyState: 4, play: async () => {} } : null,
      })
    })
    await act(async () => {
      button().props.onKeyDown({ key: ' ', repeat: false, preventDefault() {}, stopPropagation() {} })
      button().props.onKeyUp({ key: ' ', preventDefault() {}, stopPropagation() {} })
    })
    assert.equal(loaderCalls, 1)
    await act(async () => resolveMotion({
      url: 'https://example.invalid/motion.mp4',
      dispose: () => { disposeCalls += 1 },
    }))
    assert.equal(renderer.root.findByType('video').props.src, 'https://example.invalid/motion.mp4')
    await act(async () => renderer.update(React.createElement(XDriveLivePhotoSurface, {
      still, sourceKey: '7:1', loadMotion: async () => null,
    })))
    assert.equal(disposeCalls, 0)
    assert.equal(renderer.root.findByType('video').props.src, 'https://example.invalid/motion.mp4')
    await act(async () => renderer.update(React.createElement(XDriveLivePhotoSurface, {
      still, sourceKey: '7:2', loadMotion: async () => null,
    })))
    assert.equal(disposeCalls, 1)
    assert.equal(renderer.root.findAllByType('video').length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('late Live Photo source is disposed after unmount', async () => {
  const Chip = React.forwardRef(({ icon, label }, ref) => React.createElement('span', { ref }, icon, label))
  const { XDriveLivePhotoSurface } = loadShared(
    path.join(repo, 'ui/shared/src/mui/LivePhotoSurface.tsx'),
    { '@mui/material': { ...require('@mui/material'), Chip } },
    new Map(),
  )
  let renderer
  let disposeCalls = 0
  let resolveMotion
  const pending = new Promise((resolve) => { resolveMotion = resolve })
  await act(async () => {
    renderer = create(React.createElement(XDriveLivePhotoSurface, {
      still: React.createElement('div'), sourceKey: '8:1', loadMotion: () => pending,
    }))
  })
  const button = renderer.root.findAllByProps({ role: 'button' })[0]
  await act(async () => {
    button.props.onKeyDown({ key: 'Enter', repeat: false, preventDefault() {}, stopPropagation() {} })
    button.props.onKeyUp({ key: 'Enter', preventDefault() {}, stopPropagation() {} })
  })
  await act(async () => renderer.unmount())
  await act(async () => resolveMotion({
    url: 'https://example.invalid/late.mp4',
    dispose: () => { disposeCalls += 1 },
  }))
  assert.equal(disposeCalls, 1)
})


test('P0 Viewer cancels old video byte requests on revision change and disposes late blob URLs', async () => {
  let renderer
  const reads = []
  const revoked = []
  const originalRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url) => revoked.push(url)
  const target = (revision) => ({ id: 90, revision, name: 'clip.mp4', kind: 'file' })
  const loadPreviewURL = (node, kind, signal) => new Promise((resolve) => {
    reads.push({ node, kind, signal, resolve })
  })
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: target(1), loadPreviewURL,
      }))
    })
    assert.equal(reads.length, 1)
    assert.equal(reads[0].kind, 'video')
    assert.ok(reads[0].signal instanceof AbortSignal)
    assert.equal(reads[0].signal.aborted, false)

    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, {
        target: target(2), loadPreviewURL,
      }))
    })
    assert.equal(reads[0].signal.aborted, true, 'old network response must release resources')
    assert.equal(reads.length, 2, 'new revision needs its own authorized stream')
    assert.equal(reads[1].node.revision, 2)
    assert.equal(reads[1].signal.aborted, false)

    await act(async () => {
      reads[0].resolve('blob:xdrive-obsolete-preview')
      await Promise.resolve()
    })
    assert.deepEqual(revoked, ['blob:xdrive-obsolete-preview'],
      'late old blob cannot become visible or remain allocated')
    await act(async () => {
      reads[1].resolve('https://example.invalid/new.mp4')
      await Promise.resolve()
    })
    assert.equal(renderer.root.findByType('video').props.src,
      'https://example.invalid/new.mp4')
    await act(async () => renderer.unmount())
    renderer = null
    assert.equal(reads[1].signal.aborted, true, 'closing Viewer aborts an active media stream')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = originalRevoke
  }
})

test('semantic media Loader captures exactly the current Node revision after in-place source replacement', async () => {
  // Real shared semantic Viewer callback; only the visual surface is replaced.
  const { XDriveMediaViewerContent } = loadShared(
    path.join(repo, 'ui/shared/src/mui/MediaViewerContent.tsx'),
    {
      './FilePreviewSurface': {
        XDriveFilePreviewSurface: props => React.createElement('test-media-surface', props),
      },
    },
    new Map(),
  )
  const requests = []
  const loadPreviewURL = async (...args) => {
    requests.push(args)
    return 'https://example.invalid/still.jpg'
  }
  const makeItem = revision => ({
    node: { id: 991, revision, name: 'same-node.jpg', type: 'file', size: 2048 },
    metadata: { mime_type: 'image/jpeg', media_kind: 'image', has_thumbnail: true },
  })
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveMediaViewerContent, {
        item: makeItem(1), loadThumbnail: async () => null, loadPreviewURL,
      }))
    })
    const initial = renderer.root.findByType('test-media-surface').props.loadPreviewURL
    await act(async () => {
      renderer.update(React.createElement(XDriveMediaViewerContent, {
        item: makeItem(2), loadThumbnail: async () => null, loadPreviewURL,
      }))
    })
    const latest = renderer.root.findByType('test-media-surface').props.loadPreviewURL
    assert.notEqual(latest, initial, 'same Node ID with a new revision requires a new authorized loader')
    const signal = new AbortController().signal
    await initial(null, 'image', signal)
    await latest(null, 'image', signal)
    assert.deepEqual(requests.map(args => [args[0], args[1], args[2], args[4]]), [
      [991, 'image', signal, 1],
      [991, 'image', signal, 2],
    ], 'all preview callbacks retain their own revision and forward AbortSignal')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})
