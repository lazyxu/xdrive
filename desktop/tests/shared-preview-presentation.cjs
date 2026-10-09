const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')
const Box = React.forwardRef(({ component = 'div', children, ...props }, ref) => React.createElement(component, { ...props, ref }, children))
const mui = { Box, Chip: Box, LinearProgress: Box, CircularProgress: Box, IconButton: Box, Stack: Box, Tooltip: Box, Typography: Box, useMediaQuery: () => true }
function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const localRequire = (request) => {
    if (request === '@mui/material') return mui
    if (request === '@mui/icons-material') return { Image: Box, Movie: Box }
    if (request.startsWith('@mui/icons-material')) return Box
    if (!request.startsWith('.')) return require(request)
    const base = path.resolve(path.dirname(filename), request)
    const resolved = [base + '.ts', base + '.tsx'].find(fs.existsSync)
    return resolved ? load(resolved, cache) : require(base)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}
const { XDriveFilePreviewSurface } = load(path.join(__dirname, '../../ui/shared/src/mui/FilePreviewSurface.tsx'))
const { XDriveMediaViewerContent } = load(path.join(__dirname, '../../ui/shared/src/mui/MediaViewerContent.tsx'))

const target = { id: 1, revision: 1, name: 'one.jpg', kind: 'file' }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function decode(r, src, pending) { await act(async () => r.root.findAllByType('img').find(n => n.props.src === src).props.onLoad({ currentTarget: { naturalWidth: 400, naturalHeight: 300, decode: () => pending ? pending.promise : Promise.resolve() } })) }
test('image reports ready only after a first frame decodes, including thumbnail while original remains pending', async () => {
  const original = deferred(), decoded = deferred(), states = []; let r
  try {
    await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, { target, loadPreviewURL: () => original.promise, loadImagePreview: async () => 'thumb', onPresentationStateChange: s => states.push(s) })) })
    assert.deepEqual(states, ['loading'])
    await decode(r, 'thumb', decoded); assert.deepEqual(states, ['loading'])
    await act(async () => decoded.resolve()); assert.deepEqual(states, ['loading', 'ready'])
    await act(async () => original.resolve('original')); assert.deepEqual(states, ['loading', 'ready'])
  } finally { if (r) await act(async () => r.unmount()) }
})
test('callback changes do not restart source and current revision rejects an old decode', async () => {
  const oldDecode = deferred(), states = []; let r, calls = 0
  const loader = async () => { calls++; return 'original' }
  const callback = s => states.push(s)
  try {
    await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, { target, loadPreviewURL: loader, onPresentationStateChange: callback })) })
    await decode(r, 'original', oldDecode)
    await act(async () => r.update(React.createElement(XDriveFilePreviewSurface, { target: { ...target }, loadPreviewURL: async () => 'unused', onPresentationStateChange: callback })))
    assert.equal(calls, 1)
    await act(async () => r.update(React.createElement(XDriveFilePreviewSurface, { target: { ...target, revision: 2 }, loadPreviewURL: loader, onPresentationStateChange: callback })))
    await act(async () => oldDecode.resolve()); assert.equal(states.includes('ready'), false)
    await decode(r, 'original'); assert.equal(states.at(-1), 'ready')
  } finally { if (r) await act(async () => r.unmount()) }
})
test('current video/audio/PDF presentation reports readiness, buffering and failure through the callback', async () => {
  for (const [name, host, ready] of [['one.mp4', 'video', 'onLoadedData'], ['one.mp3', 'audio', 'onLoadedMetadata'], ['one.pdf', 'iframe', 'onLoad']]) {
    const states = []; let r
    try {
      await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, { target: { ...target, name }, loadPreviewURL: async () => 'url', onPresentationStateChange: s => states.push(s) })) })
      assert.equal(states.at(-1), 'loading')
      await act(async () => r.root.findByType(host).props[ready]()); assert.equal(states.at(-1), 'ready')
      if (host !== 'iframe') { await act(async () => r.root.findByType(host).props.onWaiting()); assert.equal(states.at(-1), 'loading'); await act(async () => r.root.findByType(host).props.onCanPlay()); assert.equal(states.at(-1), 'ready') }
      await act(async () => r.root.findByType(host).props.onError()); assert.equal(states.at(-1), 'failed')
    } finally { if (r) await act(async () => r.unmount()) }
  }
})
test('switching revision reports loading and ignores readiness dispatched from the old media element', async () => {
  const states = []; let r
  const base = { target: { ...target, name: 'one.mp4' }, loadPreviewURL: async () => 'url', onPresentationStateChange: s => states.push(s) }
  try {
    await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, base)) })
    const oldReady = r.root.findByType('video').props.onLoadedData
    await act(async () => oldReady()); assert.equal(states.at(-1), 'ready')
    await act(async () => r.update(React.createElement(XDriveFilePreviewSurface, { ...base, target: { ...base.target, revision: 2 } })))
    assert.equal(states.at(-1), 'loading')
    await act(async () => oldReady()); assert.equal(states.at(-1), 'loading')
    await act(async () => r.root.findByType('video').props.onLoadedData()); assert.equal(states.at(-1), 'ready')
  } finally { if (r) await act(async () => r.unmount()) }
})
test('Live Photo presentation follows still decode rather than acquiring motion', async () => {
  let r, motionCalls = 0; const states = []
  try {
    await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, { target: { ...target, name: 'one.livp' }, loadPreviewURL: async () => 'still', loadLivePhotoMotion: async () => { motionCalls++; return null }, onPresentationStateChange: s => states.push(s) })) })
    assert.equal(states.at(-1), 'loading'); await decode(r, 'still'); assert.equal(states.at(-1), 'ready'); assert.equal(motionCalls, 0)
  } finally { if (r) await act(async () => r.unmount()) }
})
test('paired Gallery Live Photo enables motion only after its current still is ready', async () => {
  let r, motionCalls = 0
  const item = {
    node: { id: 1, revision: 1, name: 'paired.jpg', type: 'file', size: 32 },
    asset_kind: 'live_photo',
    metadata: { media_kind: 'image', mime_type: 'image/jpeg', has_thumbnail: false },
  }
  const props = {
    item, loadThumbnail: async () => null, loadPreviewURL: async () => 'still',
    loadLivePhotoMotion: async () => { motionCalls++; return null },
  }
  const button = () => r.root.findAllByProps({ role: 'button' })[0]
  const hold = () => button().props.onKeyDown({ key: ' ', repeat: false, preventDefault() {}, stopPropagation() {} })
  try {
    await act(async () => { r = create(React.createElement(XDriveMediaViewerContent, props)) })
    await act(async () => hold())
    assert.equal(motionCalls, 0, 'motion must not load before a usable still is visible')
    assert.equal(button().props['aria-disabled'], true, 'an undecoded still must not advertise a playable Live Photo')
    await decode(r, 'still')
    assert.equal(button().props['aria-disabled'], undefined)
    await act(async () => hold())
    assert.equal(motionCalls, 1)
    await act(async () => r.update(React.createElement(XDriveMediaViewerContent, {
      ...props, item: { ...item, node: { ...item.node, revision: 2 } },
    })))
    assert.equal(button().props['aria-disabled'], true, 'a replacement still must earn its own readiness')
    await act(async () => hold())
    assert.equal(motionCalls, 1)
    await decode(r, 'still')
    assert.equal(button().props['aria-disabled'], undefined)
  } finally { if (r) await act(async () => r.unmount()) }
})
test('unsupported targets and unavailable text/URL loaders report terminal failure', async () => {
  for (const name of ['unknown.bin', 'one.txt', 'one.pdf']) {
    const states = []; let r
    try {
      await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, { target: { ...target, name }, onPresentationStateChange: s => states.push(s) })) })
      assert.equal(states.at(-1), 'failed', name)
    } finally { if (r) await act(async () => r.unmount()) }
  }
})
test('image source failures report failed and callback replacement observes the next state without a reload', async () => {
  let r, calls = 0; const first = [], second = []
  const base = { target, loadPreviewURL: async () => { calls++; return 'original' } }
  try {
    await act(async () => { r = create(React.createElement(XDriveFilePreviewSurface, { ...base, onPresentationStateChange: s => first.push(s) })) })
    await act(async () => r.update(React.createElement(XDriveFilePreviewSurface, { ...base, onPresentationStateChange: s => second.push(s) })))
    assert.equal(calls, 1)
    await act(async () => r.root.findByType('img').props.onError())
    assert.deepEqual(first, ['loading']); assert.deepEqual(second, ['failed'])
  } finally { if (r) await act(async () => r.unmount()) }
})
