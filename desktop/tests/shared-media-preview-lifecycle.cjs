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
  // A native video element (not styled Box) must forward its actual media
  // ref to both React and the browser for pause and signed Range teardown.
  assert.match(source, /<video\s+[\s\S]*?ref=\{videoStreamElementRef\}/)
  assert.doesNotMatch(source, /component="video"/)
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



test('read-only text reauthorizes same Node revision on Owner loader switch', async () => {
  const target = { id: 77001, revision: 7, name: 'confidential.txt', kind: 'file' }
  const calls = []
  const a = async (node, signal) => {
    calls.push({owner:'A',node,signal})
    return {text:'PRIVATE OWNER A',size:15,truncated:false}
  }
  let resolveB
  const b = (node, signal) => new Promise(resolve => {
    calls.push({owner:'B',node,signal,resolve}); resolveB=resolve
  })
  const props = loadTextPreview => React.createElement(XDriveFilePreviewSurface, {target,loadTextPreview})
  const shown = view => view.root.findAllByType('pre').map(x=>x.children.join(''))
  let view
  try {
    await act(async () => { view=create(props(a)); await Promise.resolve() })
    assert.deepEqual(shown(view), ['PRIVATE OWNER A'])
    await act(async () => { view.update(props(b)); await Promise.resolve() })
    assert.equal(calls.length,2)
    assert.equal(calls[0].signal.aborted,true)
    assert.deepEqual(shown(view), [], 'old Owner text must not paint while B pending')
    assert.equal(view.root.findByProps({'data-xdrive-file-preview-kind':'text'}).props['aria-busy'],true)
    await act(async () => {
      resolveB({text:'CURRENT OWNER B',size:15,truncated:false})
      await Promise.resolve()
    })
    assert.deepEqual(shown(view), ['CURRENT OWNER B'])
  } finally { if (view) await act(async () => view.unmount()) }
})

test('former text Owner failed Retry is inert after same-Node source handoff', async () => {
  const target={id:77002,revision:2,name:'private.md',kind:'file'},reads=[]
  const load=owner=>(node,signal)=>new Promise((resolve,reject)=>reads.push({owner,node,signal,resolve,reject}))
  const a=load('A'),b=load('B')
  const props=loadTextPreview=>React.createElement(XDriveFilePreviewSurface,{target,loadTextPreview})
  let view
  try{
    await act(async()=>{view=create(props(a))})
    await act(async()=>{reads[0].reject(new Error('unauthorized'));await Promise.resolve()})
    const stale=view.root.findAll(x=>x.type==='button'&&x.props['aria-label']==='重试预览')[0].props.onClick
    await act(async()=>{view.update(props(b));await Promise.resolve()})
    assert.equal(reads.length,2)
    assert.equal(reads[0].signal.aborted,true)
    await act(async()=>{stale();await Promise.resolve()})
    assert.equal(reads.length,2,'former Owner must not issue an additional request')
    await act(async()=>{reads[1].resolve({text:'B only',size:6,truncated:false});await Promise.resolve()})
    assert.deepEqual(view.root.findAllByType('pre').map(x=>x.children.join('')),['B only'])
  }finally{if(view)await act(async()=>view.unmount())}
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




test('PDF iframe reauthorizes same Node/revision before old Owner pixels, readiness or Blob leak', async () => {
  const target = { id: 79001, revision: 3, name: 'private.pdf', kind: 'file' }
  const calls = [], revoked = [], originalRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = url => revoked.push(url)
  const a = async (node, kind, signal) => {
    calls.push({ owner: 'A', node, kind, signal })
    return 'blob:pdf-owner-A'
  }
  let resolveB
  const b = (node, kind, signal) => new Promise(resolve => {
    calls.push({ owner: 'B', node, kind, signal })
    resolveB = resolve
  })
  const props = loadPreviewURL => React.createElement(XDriveFilePreviewSurface, { target, loadPreviewURL })
  let view
  try {
    await act(async () => { view = create(props(a)); await Promise.resolve() })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].kind, 'pdf')
    const oldFrame = view.root.findByType('iframe')
    assert.equal(oldFrame.props.src, 'blob:pdf-owner-A')
    const oldOnLoad = oldFrame.props.onLoad
    await act(async () => oldOnLoad())
    assert.equal(root(view, 'pdf').props['aria-busy'], undefined)

    await act(async () => { view.update(props(b)); await Promise.resolve() })
    assert.equal(calls.length, 2, 'new Host must obtain a new signed PDF ticket')
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(view.root.findAllByType('iframe').length, 0,
      'old PDF iframe must unmount before the new authorization settles')
    assert.equal(root(view, 'pdf').props['aria-busy'], true)
    assert.ok(revoked.includes('blob:pdf-owner-A'), 'replaced Owner Blob must be retired')
    await act(async () => oldOnLoad())
    assert.equal(root(view, 'pdf').props['aria-busy'], true,
      'old PDF onLoad cannot signal new Owner readiness')

    await act(async () => { resolveB('blob:pdf-owner-B'); await Promise.resolve() })
    const currentFrame = view.root.findByType('iframe')
    assert.equal(currentFrame.props.src, 'blob:pdf-owner-B')
    assert.equal(root(view, 'pdf').props['aria-busy'], true)
    await act(async () => currentFrame.props.onLoad())
    assert.equal(root(view, 'pdf').props['aria-busy'], undefined)
  } finally {
    if (view) await act(async () => view.unmount())
    URL.revokeObjectURL = originalRevoke
  }
  assert.equal(revoked.filter(x => x === 'blob:pdf-owner-A').length, 1)
  assert.equal(revoked.filter(x => x === 'blob:pdf-owner-B').length, 1)
})

test('old PDF Retry callback cannot renew ticket after same-ID Owner handoff', async () => {
  const target = { id: 79002, revision: 1, name: 'old-report.pdf', kind: 'file' }
  const calls = []
  const load = owner => (node, kind, signal) =>
    new Promise((resolve, reject) => calls.push({ owner, node, kind, signal, resolve, reject }))
  const a = load('A'), b = load('B')
  const props = loadPreviewURL => React.createElement(XDriveFilePreviewSurface, { target, loadPreviewURL })
  let view
  try {
    await act(async () => { view = create(props(a)) })
    await act(async () => { calls[0].reject(new Error('denied')); await Promise.resolve() })
    const staleRetry = view.root.findAll(node => node.type === 'button' &&
      node.props['aria-label'] === '重试预览')[0].props.onClick
    await act(async () => { view.update(props(b)); await Promise.resolve() })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].signal.aborted, true)
    await act(async () => { staleRetry(); await Promise.resolve() })
    assert.equal(calls.length, 2, 'a stale click must not request an Owner A ticket')
    assert.equal(view.root.findAllByType('iframe').length, 0)
    await act(async () => {
      calls[1].resolve('https://example.invalid/owner-B.pdf')
      await Promise.resolve()
    })
    assert.equal(view.root.findByType('iframe').props.src, 'https://example.invalid/owner-B.pdf')
  } finally { if (view) await act(async () => view.unmount()) }
})

test('late PDF Owner A ticket is discarded after B already mounted same Node revision', async () => {
  const target = { id: 79003, revision: 4, name: 'memo.pdf', kind: 'file' }
  const originalRevoke = URL.revokeObjectURL, revoked = [], requests = []
  URL.revokeObjectURL = url => revoked.push(url)
  let resolveA
  const a = (node, kind, signal) => new Promise(resolve => {
    requests.push({ owner: 'A', node, kind, signal }); resolveA = resolve
  })
  const b = async (node, kind, signal) => {
    requests.push({ owner: 'B', node, kind, signal })
    return 'blob:pdf-B-current'
  }
  const props = loadPreviewURL => React.createElement(XDriveFilePreviewSurface, { target, loadPreviewURL })
  let view
  try {
    await act(async () => { view = create(props(a)) })
    assert.equal(requests.length, 1)
    await act(async () => { view.update(props(b)); await Promise.resolve() })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(view.root.findByType('iframe').props.src, 'blob:pdf-B-current')
    await act(async () => { resolveA('blob:pdf-A-late'); await Promise.resolve() })
    assert.equal(view.root.findByType('iframe').props.src, 'blob:pdf-B-current')
    assert.ok(revoked.includes('blob:pdf-A-late'), 'obsolete private PDF Blob must be revoked')
  } finally {
    if (view) await act(async () => view.unmount())
    URL.revokeObjectURL = originalRevoke
  }
  assert.ok(revoked.includes('blob:pdf-B-current'), 'closing Viewer releases current PDF Blob')
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


test('read-only audio reauthorizes same Node and retires old signed native Range', async () => {
  const RefBox=React.forwardRef(function RefBox({component='div',sx:_sx,...props},ref){
    return React.createElement(component,{...props,ref})
  })
  const {XDriveFilePreviewSurface:RefAware}=loadShared(
    path.join(repo,'ui/shared/src/mui/FilePreviewSurface.tsx'),
    {'@mui/material':{...require('@mui/material'),Box:RefBox}},new Map())
  const prev=URL.revokeObjectURL,revoked=[],requests=[],streams=[]
  URL.revokeObjectURL=url=>revoked.push(url)
  const target={id:78001,revision:3,name:'memo.mp3',kind:'file'}
  const a=async(node,kind,signal)=>{requests.push({owner:'A',node,kind,signal});return 'blob:audio-A'}
  let resolveB
  const b=(node,kind,signal)=>new Promise(resolve=>{
    requests.push({owner:'B',node,kind,signal});resolveB=resolve
  })
  const props=loadPreviewURL=>React.createElement(RefAware,{target,loadPreviewURL})
  let view
  try{
    await act(async()=>{
      view=create(props(a),{createNodeMock:element=>{
        if(element.type!=='audio')return null
        const x={pauses:0,detaches:0,resets:0,
          pause(){this.pauses++},
          removeAttribute(name){assert.equal(name,'src');this.detaches++},
          load(){this.resets++}}
        streams.push(x);return x
      }})
      await Promise.resolve()
    })
    assert.equal(requests.length,1)
    assert.equal(requests[0].kind,'audio')
    const old=view.root.findByType('audio')
    assert.equal(old.props.src,'blob:audio-A')
    const staleReady=old.props.onLoadedMetadata
    await act(async()=>staleReady())
    await act(async()=>{view.update(props(b));await Promise.resolve()})
    assert.equal(requests.length,2)
    assert.equal(requests[0].signal.aborted,true)
    assert.equal(view.root.findAllByType('audio').length,0,'A audio cannot play under B')
    assert.ok(streams[0].pauses>0&&streams[0].detaches>0&&streams[0].resets>0)
    assert.ok(revoked.includes('blob:audio-A'))
    await act(async()=>{resolveB('blob:audio-B');await Promise.resolve()})
    assert.equal(view.root.findByType('audio').props.src,'blob:audio-B')
    await act(async()=>staleReady())
    assert.equal(view.root.findByProps({'data-xdrive-file-preview-kind':'audio'}).props['aria-busy'],true,
      'old A callback must not mark B ready')
    await act(async()=>view.root.findByType('audio').props.onLoadedMetadata())
    assert.equal(view.root.findByProps({'data-xdrive-file-preview-kind':'audio'}).props['aria-busy'],undefined)
  }finally{
    if(view)await act(async()=>view.unmount())
    URL.revokeObjectURL=prev
  }
  assert.equal(revoked.filter(x=>x==='blob:audio-A').length,1)
  assert.equal(revoked.filter(x=>x==='blob:audio-B').length,1)
})

test('former audio Owner failed Retry cannot renew ticket for same Node',async()=>{
  const target={id:78002,revision:1,name:'memo.mp3',kind:'file'},calls=[]
  const load=owner=>(node,kind,signal)=>new Promise((resolve,reject)=>calls.push({owner,node,kind,signal,resolve,reject}))
  const a=load('A'),b=load('B')
  const props=loadPreviewURL=>React.createElement(XDriveFilePreviewSurface,{target,loadPreviewURL})
  let view
  try{
    await act(async()=>{view=create(props(a))})
    await act(async()=>{calls[0].reject(new Error('unauthorized'));await Promise.resolve()})
    const stale=view.root.findAll(x=>x.type==='button'&&x.props['aria-label']==='重试预览')[0].props.onClick
    await act(async()=>{view.update(props(b));await Promise.resolve()})
    assert.equal(calls.length,2)
    assert.equal(calls[0].signal.aborted,true)
    assert.equal(view.root.findAllByType('audio').length,0)
    await act(async()=>{stale();await Promise.resolve()})
    assert.equal(calls.length,2)
    await act(async()=>{calls[1].resolve('https://example.invalid/b.mp3');await Promise.resolve()})
    assert.equal(view.root.findByType('audio').props.src,'https://example.invalid/b.mp3')
  }finally{if(view)await act(async()=>view.unmount())}
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


test('signed video loader stored in state is never accidentally invoked as a React updater', async () => {
  const source = fs.readFileSync(
    path.join(repo, 'ui/shared/src/mui/FilePreviewSurface.tsx'), 'utf8')
  assert.match(source, /setVideoURLSourceOwner\(\(\) => loaders\.url\)/,
    'React function-valued state must be wrapped in an updater returning the loader')

  const calls = []
  const target = { id: 12091, revision: 7, name: 'session.mp4', kind: 'file' }
  const makeLoader = owner => async (...args) => {
    calls.push({owner,args})
    const [node,kind,signal] = args
    assert.equal(node.id, 12091, 'do not call an Owner loader with previous React state')
    assert.equal(kind, 'video')
    assert.ok(signal instanceof AbortSignal)
    return 'https://example.invalid/' + owner + '/signed-original.mp4'
  }
  const a = makeLoader('A')
  const b = makeLoader('B')
  const viewFor = loadPreviewURL => React.createElement(XDriveFilePreviewSurface, {
    target, loadPreviewURL,
  })
  let view
  try {
    await act(async () => { view = create(viewFor(a)); await Promise.resolve() })
    assert.equal(calls.length, 1, 'one authorized stream read; state setter must not invoke loader')
    assert.equal(view.root.findByType('video').props.src,
      'https://example.invalid/A/signed-original.mp4')
    await act(async () => { view.update(viewFor(b)); await Promise.resolve() })
    assert.equal(calls.length, 2,
      'same Node/revision new Owner performs exactly one authorized B request')
    assert.equal(calls[0].args[2].aborted, true)
    assert.equal(view.root.findByType('video').props.src,
      'https://example.invalid/B/signed-original.mp4')
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('native video original stream switches Owner loader even with identical Node and revision', async () => {
  const oldRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => revoked.push(url)
  const calls = []
  const streams = []
  const target = { id: 9781, revision: 4, name: 'same-id.mp4', kind: 'file' }
  // Commit the pending initial page before resolving its signed ticket.
  // That guarantees React test-renderer attaches the native video ref to
  // createNodeMock rather than batching the host mount into the same act.
  let resolveA
  const loaderA = (_target, kind, signal) => new Promise(resolve => {
    calls.push({ owner: 'A', kind, signal })
    resolveA = resolve
  })
  let resolveB
  const loaderB = (_target, kind, signal) => new Promise(resolve => {
    calls.push({ owner: 'B', kind, signal })
    resolveB = resolve
  })
  const make = loader => React.createElement(XDriveFilePreviewSurface, {
    target, loadPreviewURL: loader,
  })
  let view
  try {
    await act(async () => {
      view = create(make(loaderA), {
        createNodeMock: element => {
          if (element.type !== 'video') return null
          const stream = {
            pauses: 0, detaches: 0, resets: 0,
            pause() { this.pauses++ },
            removeAttribute(key) { assert.equal(key, 'src'); this.detaches++ },
            load() { this.resets++ },
          }
          streams.push(stream)
          return stream
        },
      })
    })
    assert.equal(calls.length, 1)
    await act(async () => {
      resolveA('blob:owner-a-video')
      await Promise.resolve()
    })
    assert.equal(view.root.findByType('video').props.src, 'blob:owner-a-video')
    assert.equal(streams.length, 1, 'the real native video ref must be committed')
    const oldReady = view.root.findByType('video').props.onLoadedData
    await act(async () => oldReady())
    assert.equal(root(view, 'video').props['aria-busy'], undefined)
    await act(async () => { view.update(make(loaderB)); await Promise.resolve() })
    assert.equal(calls.length, 2, 'current Owner loader must renew a same-node original')
    assert.equal(calls[0].signal.aborted, true, 'superseded signed Range must abort')
    assert.equal(view.root.findAllByType('video').length, 0,
      'new Owner must not see the old signed video while new ticket is pending')
    assert.ok(streams[0].detaches >= 1 && streams[0].resets >= 1,
      'old native Range is synchronously detached at Owner handoff')
    assert.ok(revoked.includes('blob:owner-a-video'),
      'old Owner Blob URL must be retired before new video displays')
    await act(async () => { resolveB('blob:owner-b-video'); await Promise.resolve() })
    const videoB = view.root.findByType('video')
    assert.equal(videoB.props.src, 'blob:owner-b-video')
    await act(async () => oldReady())
    assert.equal(root(view, 'video').props['aria-busy'], true,
      'stale A media-ready callback must not certify B playable frame')
    await act(async () => view.root.findByType('video').props.onLoadedData())
    assert.equal(root(view, 'video').props['aria-busy'], undefined)
  } finally {
    if (view) await act(async () => view.unmount())
    URL.revokeObjectURL = oldRevoke
  }
  assert.equal(revoked.filter(url => url === 'blob:owner-a-video').length, 1)
  assert.equal(revoked.filter(url => url === 'blob:owner-b-video').length, 1)
})

test('stale retry from failed video Owner cannot renew the next Owner source', async () => {
  const requests = []
  const target = { id: 9791, revision: 1, name: 'same-id.mp4', kind: 'file' }
  const loaderA = (_node, _kind, signal) => new Promise((resolve, reject) =>
    requests.push({ owner: 'A', signal, resolve, reject }))
  const loaderB = (_node, _kind, signal) => new Promise((resolve, reject) =>
    requests.push({ owner: 'B', signal, resolve, reject }))
  const make = loadPreviewURL => React.createElement(XDriveFilePreviewSurface, {
    target, loadPreviewURL,
  })
  let view
  try {
    await act(async () => { view = create(make(loaderA)) })
    await act(async () => { requests[0].reject(new Error('A unauthorized')); await Promise.resolve() })
    const retry = view.root.findAll(x => x.type === 'button' && x.props['aria-label'] === '重试预览')
    assert.equal(retry.length, 1)
    const oldRetry = retry[0].props.onClick
    await act(async () => { view.update(make(loaderB)); await Promise.resolve() })
    assert.equal(requests.length, 2, 'one new Owner B request starts')
    assert.equal(requests[0].signal.aborted, true, 'failed prior Owner request retires')
    assert.equal(view.root.findAllByType('video').length, 0)
    await act(async () => { oldRetry(); await Promise.resolve() })
    assert.equal(requests.length, 2,
      'stale old retry callback cannot reissue the former Owner request')
    await act(async () => { requests[1].resolve('https://example.invalid/b-stream.mp4'); await Promise.resolve() })
    assert.equal(view.root.findByType('video').props.src, 'https://example.invalid/b-stream.mp4')
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('native video poster switches Owner loader for the same exact Node revision without reloading stream', async () => {
  const oldRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = value => revoked.push(value)
  const thumbnailReads = []
  const sourceReads = []
  const preview = async (_node, kind, signal) => {
    sourceReads.push({ kind, signal })
    return 'https://example.invalid/video-current.mp4'
  }
  const a = async (_node, signal) => {
    thumbnailReads.push({ owner: 'A', signal })
    return 'blob:owner-a-poster'
  }
  const b = (_node, signal) => new Promise(resolve => {
    thumbnailReads.push({ owner: 'B', signal, resolve })
  })
  const target = { id: 9017, revision: 7, name: 'shared-id.mp4', kind: 'file' }
  const props = loadImagePreview => React.createElement(XDriveFilePreviewSurface, {
    target, loadPreviewURL: preview, loadImagePreview,
  })
  let renderer
  try {
    await act(async () => { renderer = create(props(a)); await Promise.resolve() })
    assert.equal(thumbnailReads.length, 1)
    assert.equal(renderer.root.findByType('video').props.poster, 'blob:owner-a-poster')
    assert.equal(sourceReads.length, 1)
    await act(async () => { renderer.update(props(b)); await Promise.resolve() })
    assert.equal(thumbnailReads.length, 2,
      'new authenticated thumbnail loader must re-acquire even with same Node and revision')
    assert.equal(thumbnailReads[0].signal.aborted, true,
      'old poster task must abort even when Node and revision are unchanged')
    assert.equal(renderer.root.findByType('video').props.poster, undefined,
      'pending new Owner cannot render the previous poster pixels')
    assert.equal(renderer.root.findByType('video').props.src,
      'https://example.invalid/video-current.mp4',
      'changing only thumbnail source does not restart the unchanged video stream')
    assert.deepEqual(revoked, ['blob:owner-a-poster'])
    await act(async () => {
      thumbnailReads[1].resolve('blob:owner-b-poster')
      await Promise.resolve()
    })
    assert.equal(renderer.root.findByType('video').props.poster, 'blob:owner-b-poster')
    assert.equal(sourceReads.length, 1, 'poster handoff did not fetch a second original')
    await act(async () => { renderer.unmount(); renderer = null })
    assert.deepEqual(revoked, ['blob:owner-a-poster', 'blob:owner-b-poster'],
      'owner-local Blob is retired when replaced or Viewer closed')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    URL.revokeObjectURL = oldRevoke
  }
})

test('late borrowed video poster from former Owner never displaces the new Owner', async () => {
  let resolveOld
  const freed = { old: 0, current: 0 }
  const reads = []
  const loaderA = (_node, signal) => new Promise(resolve => {
    resolveOld = resolve
    reads.push({ owner: 'A', signal })
  })
  const loaderB = async (_node, signal) => {
    reads.push({ owner: 'B', signal })
    return { url: 'blob:owner-b-borrowed', release: () => { freed.current++ } }
  }
  const preview = async () => 'https://example.invalid/unchanged-original'
  const target = { id: 9024, revision: 4, name: 'borrowed.mp4', kind: 'file' }
  const props = loadImagePreview => React.createElement(XDriveFilePreviewSurface, {
    target, loadPreviewURL: preview, loadImagePreview,
  })
  let renderer
  try {
    await act(async () => { renderer = create(props(loaderA)); await Promise.resolve() })
    assert.equal(reads.length, 1)
    await act(async () => { renderer.update(props(loaderB)); await Promise.resolve() })
    assert.equal(reads[0].signal.aborted, true)
    assert.equal(reads.length, 2)
    assert.equal(renderer.root.findByType('video').props.poster, 'blob:owner-b-borrowed')
    await act(async () => {
      resolveOld({ url: 'blob:owner-a-borrowed', release: () => { freed.old++ } })
      await Promise.resolve()
    })
    assert.deepEqual(freed, { old: 1, current: 0 },
      'old cancelled borrowed reference was returned to its original cache')
    assert.equal(renderer.root.findByType('video').props.poster, 'blob:owner-b-borrowed',
      'late former Owner must not replace the current poster')
    await act(async () => { renderer.unmount(); renderer = null })
    assert.deepEqual(freed, { old: 1, current: 1 },
      'new current borrowed lease was released at Viewer Close')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
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


test('same-ID original JPEG Viewer remounts on authorized Owner loader switch', async () => {
  const oldRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => revoked.push(url)
  const calls = []
  const target = { id: 9821, revision: 3, name: 'photo.jpg', kind: 'file' }
  const loaderA = async (_node, kind, signal) => {
    calls.push({ owner: 'A', kind, signal })
    return 'blob:owner-a-image'
  }
  let resolveB
  const loaderB = (_node, kind, signal) => new Promise(resolve => {
    calls.push({ owner: 'B', kind, signal })
    resolveB = resolve
  })
  const props = loadPreviewURL => React.createElement(XDriveFilePreviewSurface, {target,loadPreviewURL})
  const decoded = { currentTarget: {
    decode: () => Promise.resolve(), naturalWidth: 512, naturalHeight: 512,
  } }
  let view
  try {
    await act(async () => { view = create(props(loaderA)); await Promise.resolve() })
    const oldImage = view.root.findByType('img')
    assert.equal(oldImage.props.src, 'blob:owner-a-image')
    assert.equal(calls.length, 1)
    const staleReady = oldImage.props.onLoad
    await act(async () => { staleReady(decoded); await new Promise(r => setImmediate(r)) })
    assert.equal(view.root.findByType('img').props.style.visibility, 'visible')
    await act(async () => { view.update(props(loaderB)); await Promise.resolve() })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(view.root.findAllByType('img').length, 0,
      'old authenticated original cannot paint during new same-node Owner pending state')
    assert.deepEqual(revoked, ['blob:owner-a-image'])
    await act(async () => { staleReady(decoded); await new Promise(r => setImmediate(r)) })
    assert.equal(view.root.findAllByType('img').length, 0,
      'stale decoded image event cannot certify or restore the new session')
    await act(async () => { resolveB('blob:owner-b-image'); await Promise.resolve() })
    const current = view.root.findByType('img')
    assert.equal(current.props.src, 'blob:owner-b-image')
    await act(async () => { current.props.onLoad(decoded); await new Promise(r => setImmediate(r)) })
    assert.equal(view.root.findByType('img').props.style.visibility, 'visible')
  } finally {
    if (view) await act(async () => view.unmount())
    URL.revokeObjectURL = oldRevoke
  }
  assert.deepEqual(revoked, ['blob:owner-a-image', 'blob:owner-b-image'],
    'old and new original leases must each be released exactly once')
})

test('newly available thumbnail still does not restart the current original read', async () => {
  const calls = []
  let resolveOriginal
  const target = { id: 9822, revision: 5, name: 'photo.jpg', kind: 'file' }
  const original = (_node, _kind, signal) => new Promise(resolve => {
    calls.push({role:'original',signal}); resolveOriginal = resolve
  })
  const thumbnail = async (_node, signal) => {
    calls.push({role:'thumbnail',signal}); return 'blob:new-thumb'
  }
  const props = loadImagePreview => React.createElement(XDriveFilePreviewSurface, {
    target, loadPreviewURL: original, loadImagePreview,
  })
  const oldRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = url => revoked.push(url)
  let view
  try {
    await act(async () => { view = create(props(undefined)); await Promise.resolve() })
    assert.equal(calls.length, 1)
    await act(async () => { view.update(props(thumbnail)); await Promise.resolve() })
    assert.deepEqual(calls.map(c=>c.role), ['original','thumbnail'])
    assert.equal(calls[0].signal.aborted, false,
      'late thumbnail admission must not abort/refetch a pending authorized original')
    assert.equal(view.root.findByType('img').props.src, 'blob:new-thumb')
    await act(async () => { resolveOriginal('blob:original'); await Promise.resolve() })
    assert.equal(calls.length, 2)
    assert.equal(view.root.findAllByType('img').length, 2)
  } finally {
    if(view) await act(async () => view.unmount())
    URL.revokeObjectURL = oldRevoke
  }
  assert.equal(revoked.filter(x=>x==='blob:new-thumb').length, 1)
  assert.equal(revoked.filter(x=>x==='blob:original').length, 1)
})

test('former Owner borrowed thumbnail is released after same-node Viewer loader handoff', async () => {
  const target = { id: 9823, revision: 7, name: 'photo.jpg', kind: 'file' }
  const calls = [], released = {a:0,b:0}
  let resolveOld
  const a = (_node, signal) => new Promise(resolve => {
    calls.push({owner:'A',signal}); resolveOld=resolve
  })
  const b = async (_node, signal) => {
    calls.push({owner:'B',signal})
    return {url:'blob:borrowed-b',release:()=>{released.b++}}
  }
  const props = loadImagePreview => React.createElement(XDriveFilePreviewSurface, {
    target, loadImagePreview,
  })
  let view
  try {
    await act(async () => { view=create(props(a)); await Promise.resolve() })
    await act(async () => { view.update(props(b)); await Promise.resolve() })
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(calls.length,2)
    assert.equal(view.root.findByType('img').props.src,'blob:borrowed-b')
    await act(async () => {
      resolveOld({url:'blob:borrowed-a',release:()=>{released.a++}})
      await Promise.resolve()
    })
    assert.deepEqual(released,{a:1,b:0},
      'aborted prior Owner borrowed thumbnail is returned to the correct cache')
    assert.equal(view.root.findByType('img').props.src,'blob:borrowed-b')
  } finally {
    if(view) await act(async () => view.unmount())
  }
  assert.deepEqual(released,{a:1,b:1},'each borrowed lease released exactly once')
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
