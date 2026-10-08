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
