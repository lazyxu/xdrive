const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const repo = path.resolve(__dirname, '..', '..')
function loadShared(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const transpiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const localRequire = (name) => {
    if (!name.startsWith('.')) return require(name)
    const root = path.resolve(path.dirname(filename), name)
    const local = [root + '.ts', root + '.tsx'].find(fs.existsSync)
    return local ? loadShared(local, cache) : require(root)
  }
  new Function('exports', 'module', 'require', transpiled)(mod.exports, mod, localRequire)
  return mod.exports
}
const { xDriveLeaseDesktopPreviewURL } = loadShared(
  path.join(repo, 'desktop/src/renderer/desktopPreviewURLLease.ts'),
)
const { XDriveFilePreviewSurface } = loadShared(
  path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'),
)
const native = (c) => `http://127.0.0.1:53217/preview/${c.repeat(64)}`
const node = (id, name = 'clip.mp4') => ({ id, revision: 1, kind: 'file', name })
const releaseCollector = () => {
  const released = []
  return {
    released,
    release: async url => { released.push(url); return { ok: true, data: { released: true } } },
  }
}

test('local proxy lease releases exactly once upon abort; old/foreign URLs are never released', async () => {
  const { release, released } = releaseCollector()
  const abort = new AbortController()
  assert.equal(xDriveLeaseDesktopPreviewURL(native('a'), abort.signal, release), native('a'))
  assert.deepEqual(released, [])
  abort.abort()
  abort.abort()
  await Promise.resolve()
  assert.deepEqual(released, [native('a')])
  for (const invalid of [
    'blob:preview',
    'https://media.example/api/v1/file-preview/1?ticket=opaque',
    'http://evil.example/preview/' + 'b'.repeat(64),
    'http://127.0.0.1:53217/preview/' + 'c'.repeat(63),
    native('d') + '?ticket=other',
    'http://127.0.0.2:53217/preview/' + 'e'.repeat(64),
  ]) {
    const control = new AbortController()
    assert.equal(xDriveLeaseDesktopPreviewURL(invalid, control.signal, release), invalid)
    control.abort()
  }
  assert.deepEqual(released, [native('a')], 'unknown URLs never reach native release IPC')
})

test('lease disposes late native token even when signal was aborted before URL arrival', async () => {
  const { release, released } = releaseCollector()
  const controller = new AbortController()
  controller.abort()
  assert.throws(() => xDriveLeaseDesktopPreviewURL(native('b'), controller.signal, release), /abort/i)
  assert.deepEqual(released, [native('b')])
})

test('mounted shared video Viewer revokes old native ticket on Node change and current on close', async () => {
  const { release, released } = releaseCollector()
  const calls = []
  const render = id => React.createElement(XDriveFilePreviewSurface, {
    target: node(id),
    loadPreviewURL: async (file, _kind, signal) => {
      calls.push({ id: file.id, signal })
      return xDriveLeaseDesktopPreviewURL(native(id === 1 ? 'a' : 'b'), signal, release)
    },
  })
  let renderer
  try {
    await act(async () => { renderer = create(render(1)) })
    assert.equal(renderer.root.findByType('video').props.src, native('a'))
    assert.equal(calls.length, 1)
    assert.deepEqual(released, [])
    await act(async () => renderer.update(render(2)))
    assert.equal(calls[0].signal.aborted, true)
    assert.deepEqual(released, [native('a')])
    assert.equal(renderer.root.findByType('video').props.src, native('b'))
    await act(async () => renderer.unmount())
    renderer = null
    assert.equal(calls[1].signal.aborted, true)
    assert.deepEqual(released, [native('a'), native('b')])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('mounted shared image Viewer releases original native URL on Source change and unmount', async () => {
  const { release, released } = releaseCollector()
  let renderer
  const render = id => React.createElement(XDriveFilePreviewSurface, {
    target: node(id, 'original.jpg'),
    loadPreviewURL: async (file, _kind, signal) => xDriveLeaseDesktopPreviewURL(
      native(file.id === 1 ? 'c' : 'd'), signal, release,
    ),
  })
  try {
    await act(async () => { renderer = create(render(1)) })
    assert.equal(renderer.root.findByType('img').props.src, native('c'))
    await act(async () => renderer.update(render(2)))
    assert.deepEqual(released, [native('c')])
    assert.equal(renderer.root.findByType('img').props.src, native('d'))
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(released, [native('c'), native('d')])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('shared retry revokes failed audio proxy URL before obtaining another ticket', async () => {
  const { release, released } = releaseCollector()
  let renderer, count = 0
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: node(7, 'recording.mp3'),
        loadPreviewURL: async (_file, _kind, signal) => xDriveLeaseDesktopPreviewURL(
          native(++count === 1 ? 'e' : 'f'), signal, release,
        ),
      }))
    })
    const audio = renderer.root.findByType('audio')
    assert.equal(audio.props.src, native('e'))
    await act(async () => audio.props.onError())
    const retry = renderer.root.findAll(element =>
      element.type === 'button' && element.props['aria-label'] === '重试预览')
    assert.equal(retry.length, 1)
    await act(async () => { retry[0].props.onClick(); await Promise.resolve() })
    assert.deepEqual(released, [native('e')])
    assert.equal(renderer.root.findByType('audio').props.src, native('f'))
    await act(async () => renderer.unmount())
    renderer = null
    assert.deepEqual(released, [native('e'), native('f')])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('Explorer/Gallery preview and poster adapters use sender-scoped release IPC', () => {
  const explorer = fs.readFileSync(path.join(repo, 'desktop/src/renderer/DesktopFileExplorer.tsx'), 'utf8')
  const gallery = fs.readFileSync(path.join(repo, 'desktop/src/renderer/mediaGalleryAdapter.ts'), 'utf8')
  const main = fs.readFileSync(path.join(repo, 'desktop/src/main/index.cts'), 'utf8')
  const preload = fs.readFileSync(path.join(repo, 'desktop/src/preload/index.cts'), 'utf8')
  const bridge = fs.readFileSync(path.join(repo, 'desktop/src/renderer/DesktopFileExplorerHostPort.ts'), 'utf8')
  // The Files controller uses its captured Owner media port for late release.
  // The Desktop Host maps this to the same protected native lease helper.
  assert.match(explorer, /hostPort\.leasePreviewURL\(/)
  assert.match(explorer, /hostPort\.releaseDiscardedPreviewURL\(/)
  assert.match(explorer, /const agent = hostPort\.media/)
  assert.match(explorer, /agent\.releaseCloudFilePreviewURL\(/)
  assert.match(bridge, /leasePreviewURL: xDriveLeaseDesktopPreviewURL/)
  assert.match(bridge, /releaseDiscardedPreviewURL: xDriveReleaseDiscardedDesktopPreviewURL/)
  assert.match(bridge, /releaseCloudFilePreviewURL: files\.releaseCloudFilePreviewURL/)
  assert.match(gallery, /xDriveLeaseDesktopPreviewURL\(/)
  assert.match(gallery, /releaseCloudFilePreviewURL\(/)
  assert.match(explorer, /finally \{\s*\/\/ Poster capture does not own a persistent/)
  assert.match(main, /agent:release-cloud-file-preview-url/)
  assert.match(preload, /agent:release-cloud-file-preview-url/)
  assert.match(main, /filePreviewProxy\?\.releaseURL\(value\)/)
})
