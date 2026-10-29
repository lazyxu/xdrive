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

test('native Viewer video pauses on hidden and never auto-resumes or pauses a newer source', async () => {
  const priorDocument = global.document
  const listeners = new Map()
  let visibility = 'visible'
  global.document = {
    get visibilityState() { return visibility },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback)
    },
  }
  const dispatch = name => {
    for (const callback of [...(listeners.get(name) || [])]) callback()
  }
  const streams = []
  const render = revision => React.createElement(XDriveFilePreviewSurface, {
    target: { id: 9723, revision, name: 'clip.mp4', kind: 'file' },
    loadPreviewURL: async () => 'https://example.invalid/signed-' + revision + '.mp4',
  })
  let renderer
  try {
    await act(async () => {
      renderer = create(render(1), {
        createNodeMock: element => {
          if (element.type !== 'video') return null
          const stream = {
            pauses: 0, detaches: 0,
            pause() { this.pauses++ },
            removeAttribute(name) { assert.equal(name, 'src'); this.detaches++ },
            load() {},
          }
          streams.push(stream)
          return stream
        },
      })
    })
    assert.equal(renderer.root.findByType('video').props.src,
      'https://example.invalid/signed-1.mp4')
    assert.equal(streams.length, 1)
    assert.equal(listeners.get('visibilitychange')?.size ?? 0, 1)
    const oldListener = [...listeners.get('visibilitychange')][0]
    await act(async () => { visibility = 'hidden'; dispatch('visibilitychange') })
    assert.equal(streams[0].pauses, 1, 'hidden tab must pause the real native video')
    assert.equal(streams[0].detaches, 0, 'hiding is not Viewer Close or URL revocation')
    assert.equal(renderer.root.findByType('video').props.src,
      'https://example.invalid/signed-1.mp4')
    await act(async () => { visibility = 'visible'; dispatch('visibilitychange') })
    assert.equal(streams[0].pauses, 1, 'visible tab cannot auto-resume or restart playback')
    await act(async () => renderer.update(render(2)))
    assert.equal(streams.length, 2)
    assert.ok(streams[0].detaches >= 1, 'replacing source must still cancel old signed Range')
    const nextPauses = streams[1].pauses
    // Exercise the stale listener under actual hidden conditions, otherwise
    // the event handler's visibility guard could mask an Owner-scope leak.
    visibility = 'hidden'
    oldListener()
    assert.equal(streams[1].pauses, nextPauses, 'old Owner/Node handler cannot pause the newer video')
    await act(async () => { dispatch('visibilitychange') })
    assert.equal(streams[1].pauses, nextPauses + 1)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    assert.equal(listeners.get('visibilitychange')?.size ?? 0, 0,
      'unmount must retire the document lifecycle listener')
    if (priorDocument === undefined) delete global.document
    else global.document = priorDocument
  }
})

test('native video pagehide is wired without changing audio, PDF or transformed media', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../ui/shared/src/mui/FilePreviewSurface.tsx'), 'utf8')
  assert.match(source, /window\.addEventListener\('pagehide', pauseNativeVideoIfCurrent\)/)
  assert.match(source, /window\.removeEventListener\('pagehide', pauseNativeVideoIfCurrent\)/)
  assert.match(source, /previewKind !== 'video' \|\| hasTransformedVideo/)
  assert.match(source, /try \{ video\.pause\(\) \} catch/)
})

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

test('native media seek uses the actual current buffer window and stays busy until decoded', async () => {
  for (const scenario of [
    { name: 'clip.mp4', kind: 'video', initialReady: 'onLoadedData' },
    { name: 'track.mp3', kind: 'audio', initialReady: 'onLoadedMetadata' },
  ]) {
    const renderer = await mountMedia(scenario.name)
    try {
      const native = renderer.root.findByType(scenario.kind)
      const current = ({ at, readyState, range }) => ({
        currentTarget: {
          currentTime: at,
          duration: 150,
          readyState,
          buffered: {
            length: range ? 1 : 0,
            start: () => range[0],
            end: () => range[1],
          },
        },
      })
      await act(async () => native.props[scenario.initialReady]())
      assert.equal(root(renderer, scenario.kind).props['aria-busy'], undefined)
      await act(async () => native.props.onSeeking(current({
        at: 82, readyState: 1, range: null,
      })))
      assert.equal(root(renderer, scenario.kind).props['aria-busy'], true,
        'native Seek must suspend ready state immediately, even before Waiting')
      let labels = renderer.root.findAll(n =>
        n.props?.['data-xdrive-media-loading-stage'] === 'buffering')
        .map(n => n.props['aria-label'])
      assert.ok(labels.includes('正在缓冲…'),
        'a seek into an unbuffered region must not claim 00:00 has been received')
      await act(async () => native.props.onSeeked(current({
        at: 82, readyState: 1, range: null,
      })))
      assert.equal(root(renderer, scenario.kind).props['aria-busy'], true,
        'seeked without HAVE_CURRENT_DATA is not a presented frame')
      await act(async () => native.props.onProgress(current({
        at: 82, readyState: 2, range: [75, 88],
      })))
      labels = renderer.root.findAll(n =>
        n.props?.['data-xdrive-media-loading-stage'] === 'buffering')
        .map(n => n.props['aria-label'])
      assert.ok(labels.includes('缓冲 01:15–01:28 / 02:30'),
        'report only the native buffered TimeRange containing the requested position')
      await act(async () => native.props.onSeeked(current({
        at: 82, readyState: 2, range: [75, 88],
      })))
      assert.equal(root(renderer, scenario.kind).props['aria-busy'], undefined,
        'a paused seek with decoded current data can finish without Playing')
    } finally {
      await act(async () => renderer.unmount())
    }
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
    await act(async () => video.props.onCanPlay())
    assert.equal(root(renderer, 'video').props['aria-busy'], undefined)
    // Keep the existing edited trim/rotation and native player; Seeking must
    // use that element's own actual TimeRanges, never the original Node size.
    const changed = { currentTarget: {
      currentTime: 16, duration: 90, readyState: 1,
      buffered: { length: 0, start: () => 0, end: () => 0 },
    } }
    await act(async () => video.props.onSeeking(changed))
    assert.equal(root(renderer, 'video').props['aria-busy'], true)
    await act(async () => video.props.onSeeked(changed))
    assert.equal(root(renderer, 'video').props['aria-busy'], true)
    changed.currentTarget.readyState = 2
    await act(async () => video.props.onSeeked(changed))
    assert.equal(root(renderer, 'video').props['aria-busy'], undefined)
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


test('P1 text preview aborts stale HTTP readers and discards late text on revision change/unmount', async () => {
  const reads = []
  const target = revision => ({ id: 600, revision, name: 'notes.txt', kind: 'file' })
  const loadTextPreview = (node, signal) => new Promise(resolve => reads.push({ node, signal, resolve }))
  let renderer
  const shown = () => renderer.root.findAllByType('pre').map(node => node.children.join(''))
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: target(1), loadTextPreview,
      }))
    })
    assert.equal(reads.length, 1)
    assert.ok(reads[0].signal instanceof AbortSignal)
    assert.equal(reads[0].signal.aborted, false)
    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, {
        target: target(2), loadTextPreview,
      }))
    })
    assert.equal(reads[0].signal.aborted, true, 'new revision cancels old text network request')
    assert.equal(reads.length, 2)
    assert.equal(reads[1].signal.aborted, false)
    await act(async () => {
      reads[0].resolve({ text: 'PRIVATE OLD REVISION', truncated: false, size: 20 })
      await Promise.resolve()
    })
    assert.deepEqual(shown(), [], 'late old text must not be rendered')
    await act(async () => {
      reads[1].resolve({ text: 'Current revision', truncated: false, size: 16 })
      await Promise.resolve()
    })
    assert.deepEqual(shown(), ['Current revision'])
    await act(async () => renderer.unmount())
    renderer = null
    assert.equal(reads[1].signal.aborted, true, 'closing Viewer cancels the current text reader')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P1 FileExplorer Owner scope remounts in-place text Inspector and Quick Look', async () => {
  const explorer = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
  assert.match(explorer, /<XDriveFilePreviewSurface\s+key=\{interactionScopeKey\}/,
    'Inspector must remount when the authorized FileExplorer scope changes')
  assert.match(explorer, /<XDriveFileQuickLookDialog\s+key=\{interactionScopeKey\}/,
    'Quick Look must remount when the authorized FileExplorer scope changes')

  const current = { id: 771, revision: 1, name: 'same-id.txt', kind: 'file' }
  const reads = []
  const scoped = owner => React.createElement(XDriveFilePreviewSurface, {
    key: owner, target: current,
    loadTextPreview: (_item, signal) => new Promise(resolve => reads.push({ owner, signal, resolve })),
  })
  let renderer
  try {
    await act(async () => { renderer = create(scoped('Owner A')) })
    assert.equal(reads.length, 1)
    assert.equal(reads[0].signal.aborted, false)

    await act(async () => { renderer.update(scoped('Owner B')) })
    assert.equal(reads.length, 2, 'same Node/revision under a new Owner requires a new text read')
    assert.equal(reads[0].signal.aborted, true, 'old Owner text request must abort on remount')
    assert.equal(reads[1].signal.aborted, false)

    await act(async () => {
      reads[0].resolve({ text: 'OLD OWNER PRIVATE TEXT', truncated: false, size: 22 })
      await Promise.resolve()
    })
    assert.equal(renderer.root.findAllByType('pre').length, 0, 'old Owner text cannot paint in the new Viewer')

    await act(async () => {
      reads[1].resolve({ text: 'New owner text', truncated: false, size: 14 })
      await Promise.resolve()
    })
    assert.deepEqual(renderer.root.findAllByType('pre').map(x => x.children.join('')), ['New owner text'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})



test('P1 PDF ticket failure supports an explicit single-flight retry on the same verified Node', async () => {
  const reads = []
  const target = { id: 1101, revision: 4, name: 'manual.pdf', kind: 'file' }
  const loader = (_node, kind, signal) => new Promise((resolve, reject) =>
    reads.push({ kind, signal, resolve, reject }))
  let renderer
  const retry = () => renderer.root.findAll(el =>
    el.type === 'button' && el.props['aria-label'] === '重试预览')
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target, loadPreviewURL: loader,
        fallback: React.createElement('div', { role: 'alert' }, 'Preview unavailable'),
      }))
    })
    assert.equal(reads.length, 1)
    await act(async () => {
      reads[0].reject(new Error('ticket expired'))
      await Promise.resolve()
    })
    assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Preview unavailable')
    assert.equal(retry().length, 1, 'terminal PDF ticket failure must expose one retry')
    const oldClick = retry()[0].props.onClick
    await act(async () => { oldClick(); oldClick(); await Promise.resolve() })
    assert.equal(reads.length, 2, 'duplicate retry taps start only one authorized read')
    assert.equal(reads[0].signal.aborted, true, 'the failed attempt is closed by retry')
    assert.equal(reads[1].signal.aborted, false)
    await act(async () => {
      reads[1].resolve('https://example.invalid/new-ticket.pdf')
      await Promise.resolve()
    })
    assert.equal(renderer.root.findByType('iframe').props.src, 'https://example.invalid/new-ticket.pdf')
    assert.equal(retry().length, 0)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P1 audio renderer failure reissues authenticated ticket and frees old blob on retry', async () => {
  let renderer
  const reads = []
  const revoked = []
  const originalRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = url => revoked.push(url)
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: { id: 1102, revision: 2, name: 'recording.mp3', kind: 'file' },
        loadPreviewURL: (_node, kind, signal) => {
          reads.push({ kind, signal })
          return Promise.resolve(reads.length === 1 ? 'blob:old-recording' : 'blob:new-recording')
        },
      }))
    })
    const first = renderer.root.findByType('audio')
    assert.equal(first.props.src, 'blob:old-recording')
    await act(async () => first.props.onError())
    assert.deepEqual(revoked, ['blob:old-recording'],
      'a terminal decoder failure retires the failed audio Blob before Retry')
    const action = renderer.root.findAll(el => el.type === 'button' &&
      el.props['aria-label'] === '重试预览')
    assert.equal(action.length, 1)
    await act(async () => { action[0].props.onClick(); await Promise.resolve() })
    assert.equal(reads.length, 2, 'renderer failure must renew the authenticated URL')
    assert.deepEqual(revoked, ['blob:old-recording'], 'old media blob must not outlive retry')
    assert.equal(renderer.root.findByType('audio').props.src, 'blob:new-recording')
    assert.equal(renderer.root.findAll(el => el.type === 'button' &&
      el.props['aria-label'] === '重试预览').length, 0,
    'successful retry hides the previous failed-attempt action')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = originalRevoke
  }
})

test('P0 terminal video/audio error detaches native Range and retires Blob before manual Retry', async () => {
  // react-test-renderer has no real DOM. A small host-only MUI Box
  // adapter forwards refs into createNodeMock, so terminal Range teardown
  // is checked against an actual mock media element instead of null.
  // Keep the production Viewer and teardown implementation unchanged.
  const NativeRefBox = React.forwardRef(function NativeRefBox({ component = 'div', sx: _sx, ...props }, ref) {
    return React.createElement(component, { ...props, ref })
  })
  const { XDriveFilePreviewSurface: RefAwarePreview } = loadShared(
    path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'),
    { '@mui/material': { ...require('@mui/material'), Box: NativeRefBox } },
    new Map(),
  )
  const scenarios = [
    { name: 'failure.mp4', kind: 'video' },
    { name: 'failure.mp3', kind: 'audio' },
    { name: 'failure-edit.mp4', kind: 'video', mediaTransform: { rotationDegrees: 90 } },
  ]
  for (const scenario of scenarios) {
    const oldRevoke = URL.revokeObjectURL
    const revoked = []
    URL.revokeObjectURL = (url) => revoked.push(url)
    const streams = []
    const hostMocks = []
    const requests = []
    let renderer
    try {
      const broken = 'blob:broken-' + scenario.name
      const replacement = 'blob:replacement-' + scenario.name
      await act(async () => {
        renderer = create(React.createElement(RefAwarePreview, {
          target: { id: 1200, revision: 5, name: scenario.name, kind: 'file' },
          mediaTransform: scenario.mediaTransform,
          loadPreviewURL: (_node, kind, signal) => {
            requests.push({ kind, signal })
            return Promise.resolve(requests.length === 1 ? broken : replacement)
          },
          fallback: React.createElement('div', { role: 'alert' }, 'Preview unavailable'),
        }), {
          createNodeMock: (element) => {
            hostMocks.push(String(element.type))
            if (element.type !== scenario.kind) return null
            const stream = {
              pauseCalls: 0, detachCalls: 0, resetCalls: 0,
              pause() { this.pauseCalls++ },
              removeAttribute(attribute) {
                assert.equal(attribute, 'src')
                this.detachCalls++
              },
              load() { this.resetCalls++ },
            }
            streams.push(stream)
            return stream
          },
        })
      })
      const first = renderer.root.findByType(scenario.kind)
      assert.equal(first.props.src, broken)
      assert.equal(requests[0].kind, scenario.kind)
      assert.equal(streams.length, 1,
        `${scenario.name}: expected native ${scenario.kind} ref, encountered ${hostMocks.join(',')}`)
      await act(async () => first.props.onError())
      assert.equal(renderer.root.findAllByType(scenario.kind).length, 0,
        'a failed native player must not remain mounted')
      assert.equal(streams[0].detachCalls, 1, 'stop failed signed Range at terminal error')
      assert.equal(streams[0].resetCalls, 1, 'reset the native element before Blob disposal')
      assert.ok(streams[0].pauseCalls >= 1)
      assert.deepEqual(revoked, [broken],
        'the failed Blob must be released before the user retries')
      const retry = renderer.root.findAll(el => el.type === 'button' &&
        el.props['aria-label'] === '重试预览')
      assert.equal(retry.length, 1)
      await act(async () => { retry[0].props.onClick(); await Promise.resolve() })
      assert.equal(requests.length, 2)
      assert.equal(requests[0].signal.aborted, true)
      assert.equal(renderer.root.findByType(scenario.kind).props.src, replacement)
      assert.deepEqual(revoked, [broken], 'retry must not double revoke old Blob')
      await act(async () => { renderer.unmount(); renderer = null })
      assert.deepEqual(revoked, [broken, replacement],
        'Close frees only the active new Blob and does not revisit the retired source')
      assert.equal(streams[1].detachCalls, 1, 'Close also detaches new signed Range')
    } finally {
      if (renderer) await act(async () => renderer.unmount())
      URL.revokeObjectURL = oldRevoke
    }
  }
})

test('P1 text read failure can retry without reloading the Viewer or changing Node identity', async () => {
  const reads = []
  const loader = (node, signal) => new Promise((resolve, reject) => reads.push({ node, signal, resolve, reject }))
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: { id: 1103, revision: 1, name: 'readme.md', kind: 'file' },
        loadTextPreview: loader,
      }))
    })
    await act(async () => {
      reads[0].reject(new Error('temporary network failure'))
      await Promise.resolve()
    })
    const button = renderer.root.findAll(el => el.type === 'button' &&
      el.props['aria-label'] === '重试预览')[0]
    assert.ok(button)
    await act(async () => { button.props.onClick(); await Promise.resolve() })
    assert.equal(reads.length, 2)
    assert.equal(reads[0].signal.aborted, true)
    await act(async () => {
      reads[1].resolve({ text: 'Current markdown', size: 16, truncated: false })
      await Promise.resolve()
    })
    assert.deepEqual(renderer.root.findAllByType('pre').map(el => el.children.join('')), ['Current markdown'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('P0 stale retry callback from a former Node/session cannot fetch or display old media', async () => {
  const reads = []
  const loader = (node, _kind, signal) => new Promise((resolve, reject) =>
    reads.push({ id: node.id, signal, resolve, reject }))
  const target = id => ({ id, revision: 1, name: 'file.pdf', kind: 'file' })
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: target(2101), loadPreviewURL: loader,
      }))
    })
    await act(async () => { reads[0].reject(new Error('A failed')); await Promise.resolve() })
    const oldRetry = renderer.root.findAll(el =>
      el.type === 'button' && el.props['aria-label'] === '重试预览')[0].props.onClick
    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, {
        target: target(2102), loadPreviewURL: loader,
      }))
    })
    assert.equal(reads[0].signal.aborted, true)
    assert.equal(reads.length, 2)
    await act(async () => { oldRetry(); await Promise.resolve() })
    assert.equal(reads.length, 2, 'an old Node retry callback must not issue an old request')
    await act(async () => {
      reads[1].resolve('https://example.invalid/current.pdf')
      await Promise.resolve()
    })
    assert.equal(renderer.root.findByType('iframe').props.src, 'https://example.invalid/current.pdf')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})


test('Viewer video uses current-revision thumbnail as native poster without changing playback controls', async () => {
  let renderer
  const requests = []
  const revoked = []
  const originalRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = url => revoked.push(url)
  const target = revision => ({ id: 9007, revision, name: 'clip.mp4', kind: 'file' })
  const thumbnail = (_node, signal) => new Promise(resolve => requests.push({ signal, resolve }))
  const preview = async () => 'https://example.invalid/clip'
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: target(1), loadPreviewURL: preview, loadImagePreview: thumbnail,
      }))
    })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].signal.aborted, false)
    await act(async () => { requests[0].resolve('blob:video-poster-one'); await Promise.resolve() })
    let video = renderer.root.findByType('video')
    assert.equal(video.props.poster, 'blob:video-poster-one')
    assert.equal(video.props.controls, true, 'native playback controls remain active')
    await act(async () => video.props.onLoadedData())
    video = renderer.root.findByType('video')
    assert.equal(video.props.poster, undefined, 'a rendered first frame retires the static native poster')
    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, {
        target: target(2), loadPreviewURL: preview, loadImagePreview: thumbnail,
      }))
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].signal.aborted, true)
    assert.ok(revoked.includes('blob:video-poster-one'),
      'retiring the first revision releases its owned poster')
    assert.notEqual(renderer.root.findByType('video').props.poster, 'blob:video-poster-one')
    await act(async () => { requests[1].resolve('blob:video-poster-two'); await Promise.resolve() })
    assert.equal(renderer.root.findByType('video').props.poster, 'blob:video-poster-two')
    await act(async () => renderer.unmount())
    renderer = null
    assert.ok(revoked.includes('blob:video-poster-two'))
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = originalRevoke
  }
})

test('Video poster appears during pending ticket and remains behind failure/retry UI', async () => {
  let renderer, resolveTicket, resolvePoster
  const ticket = new Promise(resolve => { resolveTicket = resolve })
  const poster = new Promise(resolve => { resolvePoster = resolve })
  const target = { id: 9011, revision: 3, name: 'pending.mp4', kind: 'file' }
  const revocations = []
  const original = URL.revokeObjectURL
  URL.revokeObjectURL = url => revocations.push(url)
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target, loadPreviewURL: () => ticket, loadImagePreview: () => poster,
        fallback: React.createElement('div', { role: 'alert' }, 'Unavailable'),
      }))
    })
    await act(async () => { resolvePoster('blob:pending-poster'); await Promise.resolve() })
    // MUI Box forwards the same prop through styled React wrappers. Count
    // rendered DOM hosts, not wrapper instances, and verify the actual pixels.
    const domNodesWith = attribute => renderer.root.findAll(node =>
      typeof node.type === 'string' && node.props[attribute] === true)
    const posters = () => domNodesWith('data-xdrive-preview-video-poster')
    assert.equal(posters().length, 1, 'show one DOM poster before stream ticket completes')
    assert.equal(posters()[0].findByType('img').props.src, 'blob:pending-poster',
      'the visible image must contain this revision\'s authenticated thumbnail')
    assert.equal(renderer.root.findAllByType('video').length, 0)
    await act(async () => { resolveTicket(null); await Promise.resolve() })
    assert.equal(posters().length, 1, 'failed video should not blank the last valid poster')
    assert.equal(posters()[0].findByType('img').props.src, 'blob:pending-poster',
      'the failure overlay must retain the same current-revision thumbnail')
    assert.equal(domNodesWith('data-xdrive-preview-retry').length, 1,
      'the failure overlay has exactly one actionable DOM retry region')
    await act(async () => renderer.unmount())
    renderer = null
    assert.ok(revocations.includes('blob:pending-poster'))
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = original
  }
})

test('Old video thumbnail result is cancelled and revoked after Viewer source replacement', async () => {
  let renderer
  const requests = []
  const revoked = []
  const original = URL.revokeObjectURL
  URL.revokeObjectURL = url => revoked.push(url)
  const target = revision => ({ id: 9015, revision, name: 'video.mp4', kind: 'file' })
  const loadImagePreview = (_node, signal) => new Promise(resolve => requests.push({ signal, resolve }))
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: target(1), loadPreviewURL: async () => 'https://example.invalid/video', loadImagePreview,
      }))
    })
    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, {
        target: target(2), loadPreviewURL: async () => 'https://example.invalid/video', loadImagePreview,
      }))
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].signal.aborted, true)
    await act(async () => { requests[0].resolve('blob:retired-poster'); await Promise.resolve() })
    assert.ok(revoked.includes('blob:retired-poster'), 'aborted poster Blob is released')
    assert.notEqual(renderer.root.findByType('video').props.poster, 'blob:retired-poster')
    await act(async () => { requests[1].resolve('blob:current-poster'); await Promise.resolve() })
    assert.equal(renderer.root.findByType('video').props.poster, 'blob:current-poster')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = original
  }
})

test('Audio Viewer reports native buffered time, never synthetic byte completion', async () => {
  const renderer = await mountMedia('track.mp3')
  try {
    const audio = renderer.root.findByType('audio')
    assert.equal(audio.props.preload, 'metadata')
    await act(async () => audio.props.onProgress({ currentTarget: {
      buffered: { length: 1, start: () => 2, end: () => 9 },
      currentTime: 5, duration: 30,
    } }))
    const progress = renderer.root.findAllByProps({ 'data-xdrive-media-loading-stage': 'buffering' })
    assert.ok(progress.length >= 1)
    assert.ok(progress.some(node => node.props['aria-label']?.includes('缓冲 00:02–00:09 / 00:30')))
  } finally {
    await act(async () => renderer.unmount())
  }
})


test('semantic Gallery Viewer forwards measured thumbnail bytes with the current Node revision', async () => {
  const { XDriveMediaViewerContent } = loadShared(
    path.join(repo, 'ui/shared/src/mui/MediaViewerContent.tsx'),
    { './FilePreviewSurface': {
      XDriveFilePreviewSurface: props => React.createElement('test-thumbnail-source', props),
    } }, new Map(),
  )
  const calls = []
  const loadThumbnail = async (nodeID, signal, revision, onProgress) => {
    calls.push({ nodeID, signal, revision, onProgress })
    return null
  }
  const item = revision => ({
    node: { id: 811, revision, name: 'still.jpg', type: 'file', size: 8192 },
    metadata: { mime_type: 'image/jpeg', media_kind: 'image', has_thumbnail: true },
  })
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveMediaViewerContent, {
        item: item(1), loadThumbnail,
      }))
    })
    const originalLoader = renderer.root.findByType('test-thumbnail-source').props.loadImagePreview
    const signal = new AbortController().signal
    const seen = []
    await originalLoader(null, signal, (...bytes) => seen.push(bytes))
    assert.equal(calls[0].nodeID, 811)
    assert.equal(calls[0].revision, 1)
    assert.equal(calls[0].signal, signal)
    calls[0].onProgress(512, 1024)
    assert.deepEqual(seen, [[512, 1024]], 'the Viewer must not drop the binary observer')
    await act(async () => {
      renderer.update(React.createElement(XDriveMediaViewerContent, {
        item: item(2), loadThumbnail,
      }))
    })
    const currentLoader = renderer.root.findByType('test-thumbnail-source').props.loadImagePreview
    assert.notEqual(currentLoader, originalLoader)
    await currentLoader(null, signal, () => {})
    assert.equal(calls[1].revision, 2, 'new revisions request their own thumbnail bytes')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('first-frame Viewer reports actual thumbnail transfer and fences old revision callbacks', async () => {
  const reads = []
  const thumbnail = (target, signal, onProgress) => new Promise(resolve =>
    reads.push({ revision: target.revision, signal, onProgress, resolve }))
  const target = revision => ({ id: 819, revision, name: 'image.jpg', kind: 'file' })
  let renderer
  const status = () => {
    const visible = renderer.root.findAll(node =>
      typeof node.type === 'string' && node.props['data-xdrive-media-loading-progress'])
    assert.equal(visible.length, 1, 'only one visible preview loading status')
    return visible[0].props['aria-label']
  }
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: target(1), loadImagePreview: thumbnail,
      }))
    })
    assert.equal(reads.length, 1)
    await act(async () => reads[0].onProgress(256, 1024))
    assert.match(status(), /0\.3 \/ 1\.0 KiB/, 'show measured thumbnail bytes before a decoded frame')
    await act(async () => {
      renderer.update(React.createElement(XDriveFilePreviewSurface, {
        target: target(2), loadImagePreview: thumbnail,
      }))
    })
    assert.equal(reads.length, 2)
    assert.equal(reads[0].signal.aborted, true, 'retired thumbnail fetch must be cancelled')
    await act(async () => reads[0].onProgress(1024, 1024))
    assert.equal(status(), '正在加载…', 'late progress from a prior revision is never shown')
    await act(async () => reads[1].onProgress(512, 1024))
    assert.match(status(), /0\.5 \/ 1\.0 KiB/)
    await act(async () => { renderer.unmount(); renderer = null })
    assert.equal(reads[1].signal.aborted, true)
  } finally {
    if (renderer) await act(async () => renderer.unmount())
  }
})

test('video poster borrowed from Gallery never revokes the shared thumbnail URL', async () => {
  const old = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => revoked.push(url)
  let releases = 0
  let renderer
  try {
    await act(async () => {
      renderer = create(React.createElement(XDriveFilePreviewSurface, {
        target: { id: 330, revision: 7, name: 'clip.mp4', kind: 'file' },
        loadPreviewURL: async () => 'https://example.invalid/video',
        loadImagePreview: async () => ({
          url: 'blob:gallery-video-cover', release: () => { releases++ },
        }),
      }))
    })
    assert.equal(renderer.root.findByType('video').props.poster, 'blob:gallery-video-cover')
    await act(async () => renderer.root.findByType('video').props.onLoadedData())
    assert.equal(renderer.root.findByType('video').props.poster, undefined)
    assert.equal(releases, 0, 'first frame does not revoke a still-mounted cached poster')
    await act(async () => { renderer.unmount(); renderer = null })
    assert.equal(releases, 1)
    assert.deepEqual(revoked, [])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = old
  }
})
