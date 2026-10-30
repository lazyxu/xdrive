'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const compile = (code, filename) => ts.transpileModule(code, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function evaluate(code, resolve = require) {
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', code)(mod.exports, mod, resolve)
  return mod.exports
}
const bus = evaluate(compile(
  read('ui/shared/src/mui/ViewerForegroundPriority.ts'), 'ViewerForegroundPriority.ts'))
const { XDriveMediaThumbnailScheduler: Scheduler } = evaluate(compile(
  read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts'), 'MediaGalleryThumbnailScheduler.ts'),
  name => name === './ViewerForegroundPriority' ? bus : require(name))
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}

test('active Viewer suspends background wall but starts its own fresh Filmstrip thumbnails', async () => {
  bus.xDriveEnterForegroundPage('web:gallery')
  const wallRequest = deferred()
  let wallSignal
  let stripSignal
  let stripCalls = 0
  const wall = new Scheduler((_id, signal) => {
    wallSignal = signal
    return wallRequest.promise
  }, { concurrency: 1 })
  const releaseViewer = bus.xDriveAcquireViewerForeground({})
  let strip
  try {
    // The page's old wall request is not usable by the Viewer while a modal is active.
    assert.equal(await wall.load(71, 0, 1), null)
    strip = new Scheduler(async (_id, signal) => {
      stripCalls += 1
      stripSignal = signal
      return 'blob:viewer-visible'
    }, { concurrency: 3, maxCacheEntries: 32, viewerOwned: true })
    const visible = strip.load(72, 0, 1)
    await flush()
    assert.equal(stripCalls, 1, 'a visible Filmstrip must not inherit background preemption')
    assert.equal(stripSignal.aborted, false)
    assert.equal(await visible, 'blob:viewer-visible')
    assert.equal(await wall.load(73, 0, 1), null, 'background wall is still preempted')
  } finally {
    strip?.dispose()
    releaseViewer()
    wallRequest.resolve(null)
    wall.dispose()
    bus.xDriveEnterForegroundPage(null)
  }
})

test('Viewer Filmstrip retains cancellation on route supersession and revokes obsolete bytes', async () => {
  bus.xDriveEnterForegroundPage('web:media-viewer')
  const releaseViewer = bus.xDriveAcquireViewerForeground({})
  const pending = deferred()
  const revoked = []
  let signal
  const strip = new Scheduler((_id, controllerSignal) => {
    signal = controllerSignal
    return pending.promise
  }, { concurrency: 1, viewerOwned: true, revokeURL: url => revoked.push(url) })
  try {
    const old = strip.load(81, 0, 7)
    await flush()
    assert.equal(signal.aborted, false)
    bus.xDriveEnterForegroundPage('web:files')
    assert.equal(await old, null)
    assert.equal(signal.aborted, true, 'a Viewer-owned request still yields when its page leaves')
    pending.resolve('blob:obsolete-viewer')
    await flush()
    assert.deepEqual(revoked, ['blob:obsolete-viewer'],
      'late pixels from the superseded Viewer may never become visible')
    assert.equal(await strip.load(82, 0, 7), null, 'obsolete Viewer cannot restart')
  } finally {
    pending.resolve(null)
    strip.dispose()
    releaseViewer()
    bus.xDriveEnterForegroundPage(null)
  }
})

test('Viewer Filmstrip yields while a newer same-route content Range is pending', async () => {
  bus.xDriveEnterForegroundPage('web:media-viewer')
  const releaseViewer = bus.xDriveAcquireViewerForeground({})
  const old = deferred()
  const signals = []
  const strip = new Scheduler((_id, signal) => {
    signals.push(signal)
    return signals.length === 1 ? old.promise : Promise.resolve('blob:current')
  }, { concurrency: 1, viewerOwned: true })
  let finish = () => undefined
  try {
    const stale = strip.load(91, 0, 1)
    await flush()
    finish = bus.xDriveBeginForegroundContentTransition('media-viewer')
    assert.equal(await stale, null)
    assert.equal(signals[0].aborted, true)
    assert.equal(await strip.load(92, 0, 1), null)
    finish()
    const current = strip.load(93, 0, 1)
    await flush()
    assert.equal(await current, 'blob:current')
  } finally {
    finish()
    old.resolve(null)
    strip.dispose()
    releaseViewer()
    bus.xDriveEnterForegroundPage(null)
  }
})

test('only the shared Viewer Filmstrip opts into foreground ownership', () => {
  const strip = read('ui/shared/src/mui/MediaGalleryFilmstrip.tsx')
  const wall = read('ui/shared/src/mui/MediaGallery.tsx')
  const priority = read('ui/shared/src/mui/ViewerForegroundPriority.ts')
  assert.match(strip, /new XDriveMediaThumbnailScheduler\(loadThumbnail,\s*\{[\s\S]*?viewerOwned: true/)
  assert.match(wall, /new XDriveMediaThumbnailScheduler\(loadThumbnail\)/)
  assert.match(priority, /obsoletePage \|\|/)
  assert.match(priority, /contentTransitionPending\(entry\.page\)/)
})
