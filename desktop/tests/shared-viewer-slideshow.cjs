const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const repo = path.resolve(__dirname, '../..')
const host = React.forwardRef(({ children, ...props }, ref) => React.createElement('div', { ...props, ref }, children))
const shell = ({ actions, children, ...props }) => React.createElement('viewer-shell', props, actions, children)
const preview = (props) => React.createElement('preview-content', props)
function load(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const localRequire = (name) => {
    if (name === '@mui/material') return { IconButton: host, Stack: host, Tooltip: host, Typography: host }
    if (name.startsWith('@mui/icons-material/')) return () => null
    if (name === './FileOpenPreviewDialog') return { XDriveOpenPreviewDialog: shell }
    if (name === './FilePreviewSurface') return { XDriveFilePreviewSurface: preview }
    if (!name.startsWith('.')) return require(name)
    const base = path.resolve(path.dirname(filename), name)
    return load([base + '.ts', base + '.tsx'].find(fs.existsSync), cache)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}
const { XDriveFileQuickLookDialog } = load(path.join(repo, 'ui/shared/src/mui/FileQuickLookDialog.tsx'))

async function scenario(run) {
  let now = 1000
  let timerID = 0
  let nextCalls = 0
  const timers = new Map()
  const canceledTimers = []
  const oldWindow = global.window
  const oldDocument = global.document
  const oldNow = Date.now
  global.window = {
    setTimeout(callback, delay) { timers.set(++timerID, { callback, at: now + delay }); return timerID },
    clearTimeout(id) {
      const timer = timers.get(id)
      if (timer) canceledTimers.push(timer.callback)
      timers.delete(id)
    },
  }
  global.document = new EventTarget()
  document.visibilityState = 'visible'
  Date.now = () => now
  let renderer
  let props = { open: true, item: { id: 1, revision: 1, name: 'same.jpg', kind: 'file' }, canNext: true, onNext: () => { nextCalls++ }, onClose() {} }
  const advance = async (ms) => {
    const end = now + ms
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      timers.delete(due[0])
      await act(async () => due[1].callback())
    }
    now = end
  }
  try {
    await act(async () => { renderer = create(React.createElement(XDriveFileQuickLookDialog, props)) })
    await act(async () => renderer.root.findByType('viewer-shell').props.onFullScreenChange(true))
    const start = renderer.root.findAllByProps({ 'aria-label': '开始幻灯片' }).find((entry) => entry.type === host)
    await act(async () => start.props.onClick())
    await run({
      renderer, advance, calls: () => nextCalls,
      fireCanceled: async () => {
        for (const callback of canceledTimers.splice(0)) {
          await act(async () => callback())
        }
      },
      report: () => renderer.root.findByType('preview-content').props.onPresentationStateChange,
      ready: async (state = 'ready') => act(async () => renderer.root.findByType('preview-content').props.onPresentationStateChange(state)),
      update: async (patch) => {
        props = { ...props, ...patch }
        await act(async () => renderer.update(React.createElement(XDriveFileQuickLookDialog, props)))
      },
      visibility: async (value) => act(async () => {
        document.visibilityState = value
        document.dispatchEvent(new Event('visibilitychange'))
      }),
    })
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    Date.now = oldNow
    global.window = oldWindow
    global.document = oldDocument
  }
}

test('Quick Look gives the first usable frame a full dwell after loading', async () => scenario(async ({ advance, calls, ready }) => {
  await advance(15000)
  assert.equal(calls(), 0, 'loading must not consume slideshow dwell')
  await ready()
  await advance(4999)
  assert.equal(calls(), 0)
  await advance(1)
  assert.equal(calls(), 1)
}))

test('slideshow pauses buffering and resumes only the remaining ready time', async () => scenario(async ({ advance, calls, ready }) => {
  await ready()
  await advance(2000)
  await ready('loading')
  await advance(10000)
  assert.equal(calls(), 0)
  await ready()
  await advance(2999)
  assert.equal(calls(), 0)
  await advance(1)
  assert.equal(calls(), 1)
}))

test('hidden tabs do not consume slideshow dwell', async () => scenario(async ({ advance, calls, ready, visibility }) => {
  await ready()
  await advance(2000)
  await visibility('hidden')
  await advance(20000)
  assert.equal(calls(), 0)
  await visibility('visible')
  await advance(3000)
  assert.equal(calls(), 1)
}))

test('completed dwell cannot advance twice while navigation is still resolving', async () => scenario(async ({ advance, calls, ready, visibility, update }) => {
  await ready()
  await advance(5000)
  assert.equal(calls(), 1)
  await visibility('hidden')
  await advance(200)
  await visibility('visible')
  await advance(0)
  assert.equal(calls(), 1, 'visibility must not repeat an already requested navigation')
  await ready('loading')
  await ready()
  await advance(10000)
  assert.equal(calls(), 1, 'buffering must not repeat an already requested navigation')
  await update({ item: { id: 2, revision: 1, name: 'next.jpg', kind: 'file' } })
  await ready()
  await advance(5000)
  assert.equal(calls(), 2, 'the next source receives its own dwell')
}))

test('same-name items and late readiness do not inherit the previous dwell', async () => scenario(async ({ advance, calls, ready, report, update }) => {
  await ready()
  const oldReport = report()
  await advance(2000)
  await update({ item: { id: 2, revision: 1, name: 'same.jpg', kind: 'file' } })
  await act(async () => oldReport('ready'))
  await advance(10000)
  assert.equal(calls(), 0)
  await ready()
  await advance(5000)
  assert.equal(calls(), 1)
}))

test('callback replacement does not restart dwell and uses the latest callback', async () => scenario(async ({ advance, calls, ready, update }) => {
  let latest = 0
  await ready()
  await advance(2000)
  await update({ onNext: () => latest++ })
  await advance(3000)
  assert.equal(calls(), 0)
  assert.equal(latest, 1)
}))

test('a failed presentation stops the slideshow without silently skipping it', async () => scenario(async ({ renderer, advance, calls, ready }) => {
  await ready('failed')
  await advance(10000)
  assert.equal(calls(), 0)
  assert.ok(renderer.root.findAllByProps({ 'aria-label': '开始幻灯片' }).length)
}))

test('Quick Look rotates chrome session on A→B→A and same-revision loader rebind', async () => scenario(async ({ renderer, update }) => {
  const session = () => renderer.root.findByType('viewer-shell').props.chromeSessionKey
  const A = session()
  await update({ item: { id: 8, revision: 1, name: 'other.jpg', kind: 'file' } })
  const B = session()
  assert.notEqual(B, A)
  await update({ item: { id: 1, revision: 1, name: 'same.jpg', kind: 'file' } })
  const freshA = session()
  assert.notEqual(freshA, B)
  assert.notEqual(freshA, A)
  await update({ loadPreviewURL: async () => null })
  const loaderA = session()
  assert.notEqual(loaderA, freshA)
  await update({ loadPreviewURL: async () => null })
  assert.notEqual(session(), loaderA, 'new authorized loader resets same Node chrome ownership')
}))

test('a canceled already-queued A timer cannot advance B or an A→B→A revisit', async () => scenario(async ({ advance, calls, ready, update, fireCanceled }) => {
  await ready()
  await advance(1200)
  await update({ item: { id: 2, revision: 1, name: 'other.jpg', kind: 'file' } })
  await ready()
  await fireCanceled()
  assert.equal(calls(), 0, 'retired A callback must not navigate B')
  await update({ item: { id: 1, revision: 1, name: 'same.jpg', kind: 'file' } })
  await ready()
  await fireCanceled()
  assert.equal(calls(), 0, 'retired A and B callbacks must not navigate returning A')
  await advance(4999)
  assert.equal(calls(), 0)
  await advance(1)
  assert.equal(calls(), 1, 'fresh A gets exactly one full dwell')
}))

test('canceled ready timer cannot advance while buffering or page-hidden', async () => scenario(async ({ advance, calls, ready, visibility, fireCanceled }) => {
  await ready()
  await advance(1600)
  await ready('loading')
  await fireCanceled()
  await advance(12000)
  assert.equal(calls(), 0, 'buffering rejects a queued ready callback')
  await ready()
  await advance(600)
  await visibility('hidden')
  await fireCanceled()
  await advance(12000)
  assert.equal(calls(), 0, 'background tab rejects a queued callback')
  await visibility('visible')
  await advance(2799)
  assert.equal(calls(), 0)
  await advance(1)
  assert.equal(calls(), 1, 'only previously visible and ready time counts')
}))

test('slideshow pauses a partly elapsed dwell while a blocking Viewer dialog is open', async () => {
  const { useXDrivePreviewSlideshow } = load(path.join(repo, 'ui/shared/src/mui/usePreviewSlideshow.ts'))
  const oldWindow = global.window
  const oldDocument = global.document
  const oldNow = Date.now
  let now = 1000
  let timerID = 0
  let advances = 0
  const timers = new Map()
  const canceled = []
  global.window = {
    setTimeout(callback, delay) {
      const id = ++timerID
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout(id) {
      const timer = timers.get(id)
      if (timer) canceled.push(timer.callback)
      timers.delete(id)
    },
  }
  global.document = new EventTarget()
  document.visibilityState = 'visible'
  Date.now = () => now

  function HookHarness({ interactionPaused }) {
    useXDrivePreviewSlideshow({
      enabled: true, playing: true, sourceKey: 'viewer-photo-1',
      presentationState: 'ready', canNext: true, interactionPaused,
      onNext: () => { advances += 1 },
      onStop: () => {},
    })
    return React.createElement('slideshow-test-host')
  }
  let renderer
  const update = async (interactionPaused) => {
    await act(async () => {
      const element = React.createElement(HookHarness, { interactionPaused })
      if (!renderer) renderer = create(element)
      else renderer.update(element)
    })
  }
  const advance = async (ms) => {
    const end = now + ms
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      timers.delete(next[0])
      await act(async () => next[1].callback())
    }
    now = end
  }
  try {
    await update(false)
    await advance(2000)
    await update(true)
    assert.equal(canceled.length, 1, 'opening the dialog cancels the active dwell timer')
    const stale = canceled[0]
    await advance(20000)
    assert.equal(advances, 0, 'modal time never consumes photo viewing dwell')
    await update(false)
    await act(async () => stale())
    assert.equal(advances, 0, 'queued callback from before the modal is fenced even after resume')
    await advance(2999)
    assert.equal(advances, 0)
    await advance(1)
    assert.equal(advances, 1, 'remaining three seconds resume only after dismissing the modal')
    await advance(10000)
    assert.equal(advances, 1, 'same still never advances twice')
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    Date.now = oldNow
    global.window = oldWindow
    global.document = oldDocument
  }
})

test('both routed and shared Gallery Viewer suspend slideshow under blocking action UI', () => {
  const routed = fs.readFileSync(path.join(repo, 'web/src/WebFileViewerApps.tsx'), 'utf8')
  const shared = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/MediaGalleryViewer.tsx'), 'utf8')
  assert.match(routed, /interactionPaused:\s*keepChromeVisible/)
  assert.match(shared, /interactionPaused:\s*externalInteractionPaused\s*\|\|\s*moreOpen\s*\|\|\s*deleteOpen\s*\|\|\s*creativeOpen\s*\|\|\s*editOpen\s*\|\|\s*locationOpen/)
  assert.match(routed, /keepChromeVisible=\{shareVisible\s*\|\|\s*tagsVisible\s*\|\|\s*infoVisible/)
  const gallery = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  assert.match(gallery, /shareDialogOpen=\{Boolean\(shareItem\)\}/,
    'Page share dialog must suspend the embedded Viewer while it owns the dialog')
  assert.match(gallery, /externalInteractionPaused=\{Boolean\(selected\)\s*\|\|\s*shareDialogOpen\}/,
    'Viewer Info inspector and Page share dialog must use the same pause state')
  assert.match(shared, /keepChromeVisible=\{externalInteractionPaused\s*\|\|\s*moreOpen/,
    'interactive parent-owned UI must also preserve the Viewer chrome')
})

test('shared Quick Look never auto-advances video, audio or text and returns to manual still mode', async () => scenario(async ({ renderer, advance, calls, ready, update }) => {
  await ready()
  await advance(2000)
  for (const [index, name] of ['clip.mp4', 'track.mp3', 'notes.txt'].entries()) {
    await update({ item: { id: 30 + index, revision: 1, name, kind: 'file' } })
    await ready()
    assert.equal(renderer.root.findAllByProps({ 'aria-label': '开始幻灯片' })
      .filter((entry) => entry.type === host).length, 0,
      name + ' must not expose a slideshow control')
    await advance(10000)
    assert.equal(calls(), 0, 'non-still media is never auto-advanced')
  }
  await update({ item: { id: 40, revision: 1, name: 'new-still.jpg', kind: 'file' } })
  await ready()
  assert.equal(renderer.root.findAllByProps({ 'aria-label': '开始幻灯片' })
    .filter((entry) => entry.type === host).length, 1,
    'returning to a still permits only an explicit new playback intent')
  await advance(10000)
  assert.equal(calls(), 0, 'previous playback cannot silently resume after non-still media')
}))

test('Quick Look readiness and autoplay are not inherited after same-file loader rebind', async () => scenario(async ({ renderer, advance, calls, ready, update }) => {
  await ready()
  await advance(2000)
  const oldPresentation = renderer.root.findByType('preview-content').props.onPresentationStateChange
  await update({ loadImagePreview: async () => null })
  assert.equal(renderer.root.findAllByProps({ 'aria-label': '开始幻灯片' })
    .filter((entry) => entry.type === host).length, 1)
  await act(async () => oldPresentation('ready'))
  await advance(15000)
  assert.equal(calls(), 0, 'late readiness from the previous Agent cannot trigger a navigation')
}))

test('routed Web Files Quick Look uses the shared still-only slideshow eligibility', () => {
  const web = fs.readFileSync(path.join(repo, 'web/src/WebFileViewerApps.tsx'), 'utf8')
  assert.match(web, /quickLookKind = target \? xDriveClassifyFilePreview\(target\) : 'none'/)
  assert.match(web, /quickLookSlideshowEligible = quickLookKind === 'image' \|\| quickLookKind === 'live_photo'/)
  assert.match(web, /slideshow=\{quickLookSlideshowEligible\}/,
    'Web/Mobile Quick Look must not auto-advance video, audio or text')
  assert.match(web, /keepChromeVisible=\{shareOpen \|\| tagsOpen\}/,
    'Web/Mobile Files Share and Tags dialogs must freeze Quick Look slideshow dwell')
})
