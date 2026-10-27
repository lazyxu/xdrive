'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const ts = require('typescript')
const { performance } = require('node:perf_hooks')
const React = require('react')
const { create, act } = require('react-test-renderer')

// A deterministic SIX-slot, delayed HTTP server models the bottleneck from
// slow NAS / shared-origin thumbnail handlers. These are real fetch/abort TCP
// connections, not mocked AbortSignal counters. They are NOT a measured xDrive
// production Go worker pool, physical iOS Safari, or 100k JPEG benchmark.
const repo = path.resolve(__dirname, '../..')
const filePath = path.join(repo, 'ui/shared/src/mui/FileExplorerThumbnail.tsx')
const galleryPath = path.join(repo, 'ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
const priorityPath = path.join(repo, 'ui/shared/src/mui/ViewerForegroundPriority.ts')
const priorityModule = (() => {
  const src = fs.readFileSync(priorityPath, 'utf8')
  const js = ts.transpileModule(src, {
    fileName: priorityPath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const result = { exports: {} }
  new Function('exports', 'module', js)(result.exports, result)
  return result.exports
})()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, message, timeout = 2000) {
  const start = performance.now()
  while (!predicate()) {
    if (performance.now() - start > timeout) throw new Error('Viewer preemption: ' + message)
    await sleep(5)
  }
}
function loadTypescript(filename, stubs = {}) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  } }).outputText
  const mod = { exports: {} }
  const fallback = () => React.createElement('span', null, 'preview')
  const Box = React.forwardRef(function TestBox({ children, ...rest }, ref) {
    return React.createElement('div', { ref, ...rest }, children)
  })
  const localRequire = name => {
    if (name === 'react') return React
    if (name === '@mui/material') return { Box }
    if (name === '@mui/icons-material/ErrorOutlineRounded') return { __esModule: true, default: fallback }
    if (name === './MediaLoadProgress') return { XDriveMediaLoadingProgress: fallback }
    if (name === './LivePhotoSurface') return { XDriveLivePhotoGlyph: fallback }
    if (name === './ViewerForegroundPriority') return priorityModule
    if (name === './FileExplorerThumbnailVisualState') {
      return { xDriveFileExplorerThumbnailVisualState: () => 'loading' }
    }
    if (Object.hasOwn(stubs, name)) return stubs[name]
    return require(name)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}
async function serveSlowThumbnails() {
  const state = { active: 0, thumbnails: [], waitingViewers: [], viewerFinishedAt: null }
  const server = http.createServer((req, res) => {
    if (req.url === '/viewer') {
      const reply = () => {
        if (res.destroyed) return
        state.viewerFinishedAt = performance.now()
        res.writeHead(200, { 'Content-Type': 'image/jpeg' })
        res.end('viewer-current-original')
      }
      if (state.active >= 6) state.waitingViewers.push(reply)
      else reply()
      return
    }
    if (!req.url.startsWith('/thumbnail/')) {
      res.writeHead(404); res.end(); return
    }
    const row = { url: req.url, startedAt: performance.now(), closedAt: null,
      earlyClosed: false, sentBytes: 0 }
    state.thumbnails.push(row)
    state.active++
    const timer = setTimeout(() => {
      if (res.destroyed) return
      const body = Buffer.alloc(32768, 19)
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(body.length) })
      row.sentBytes += body.length
      res.end(body)
    }, 650)
    res.once('close', () => {
      clearTimeout(timer)
      row.closedAt = performance.now()
      row.earlyClosed = !res.writableEnded
      state.active--
      while (state.waitingViewers.length && state.active < 6) state.waitingViewers.shift()()
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { state, url: 'http://127.0.0.1:' + server.address().port,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
async function fileTrial(mode, attempt) {
  const httpFixture = await serveSlowThumbnails()
  const { state, url } = httpFixture
  const before = {
    document: global.document, window: global.window,
    IntersectionObserver: global.IntersectionObserver,
  }
  const document = Object.assign(new EventTarget(), { hidden: false })
  const window = Object.assign(new EventTarget(), { setTimeout, clearTimeout })
  global.document = document
  global.window = window
  global.IntersectionObserver = undefined
  let renderer
  let releasePriority = null
  try {
    const component = loadTypescript(filePath)
    const loadThumbnail = async (item, signal) => {
      const response = await fetch(url + '/thumbnail/' + item.id, { signal })
      await response.arrayBuffer()
      return 'https://viewer-preempt.invalid/' + item.id
    }
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: attempt * 100 + i + 1, revision: 1, kind: 'file', name: 'cold.jpeg',
    }))
    const view = (suspended) => React.createElement(
      component.XDriveFileExplorerThumbnailProvider,
      { lifecycleKey: 'viewer-pause-' + attempt, loadThumbnail, suspended },
      items.map(item => React.createElement(component.XDriveFileExplorerThumbnail, {
        key: item.id, item, eligible: true,
        fallback: React.createElement('span', null, 'cold'),
      })),
    )
    await act(async () => {
      renderer = create(view(false), { createNodeMock: () => ({}) })
    })
    await until(() => state.active === 6, 'Files six actual cold HTTP requests')
    assert.equal(document.hidden, false, 'Viewer must not need a hidden-tab event')
    const openAt = performance.now()
    const viewerRequest = fetch(url + '/viewer').then(response => response.text())
    await until(() => state.waitingViewers.length === 1, 'Viewer GET blocked on six thumbnails')
    if (mode === 'preempt') {
      await act(async () => { renderer.update(view(true)) })
    } else if (mode === 'foreground') {
      await act(async () => {
        releasePriority = priorityModule.xDriveAcquireViewerForeground({})
      })
    }
    if (mode !== 'baseline') await until(
      () => state.thumbnails.slice(0, 6).every(row => row.closedAt !== null),
      'cancel all previous Files HTTP requests',
    )
    const viewerBody = await viewerRequest
    assert.equal(viewerBody, 'viewer-current-original')
    // Viewer is admitted when ONE slot frees, before the remaining bodies
    // are closed; keep latency measurement separate from full byte accounting.
    const elapsedMS = state.viewerFinishedAt - openAt
    if (mode === 'baseline') await until(() =>
      state.thumbnails.slice(0, 6).every(row => row.closedAt !== null),
      'baseline FileExplorer six real HTTP bodies completed',
    )
    const cancelled = state.thumbnails.slice(0, 6).filter(row => row.earlyClosed)
    const wastedBytes = state.thumbnails.slice(0, 6).reduce((sum, row) => sum + row.sentBytes, 0)
    if (mode !== 'baseline') {
      assert.equal(cancelled.length, 6, 'all obscured Files thumbnails disconnect')
      assert.equal(wastedBytes, 0, 'no cancelled thumbnail may send its delayed HTTP body')
      assert.ok(elapsedMS < 250, 'Viewer must be admitted quickly, not wait 650ms: ' + elapsedMS)
      await sleep(30)
      assert.equal(state.thumbnails.length, 6, 'suspended Files may not immediately restart reads')
      if (releasePriority) {
        await act(async () => { releasePriority(); releasePriority = null })
      }
      await act(async () => { renderer.update(view(false)) })
      await until(() => state.thumbnails.length >= 12,
        'return to Files resumes only mounted/visible thumbnail reads')
    } else {
      assert.equal(cancelled.length, 0)
      assert.ok(elapsedMS >= 450, 'the no-preemption reproduction must really be slow')
      assert.equal(wastedBytes, 6 * 32768)
    }
    const sample = { source: 'mounted-Files-real-HTTP', mode, attempt,
      modelHTTPConcurrency: 6, delayedThumbnailMS: 650,
      loadedBeforeViewer: 0, viewerMS: Math.round(elapsedMS),
      earlyClosed: cancelled.length, sentThumbnailBytes: wastedBytes }
    console.log('VIEWER_BACKGROUND_THUMB_HTTP_SAMPLE ' + JSON.stringify(sample))
    return sample
  } finally {
    releasePriority?.()
    if (renderer) await act(async () => { renderer.unmount() })
    await httpFixture.close()
    for (const name of Object.keys(before)) {
      if (before[name] === undefined) delete global[name]
      else global[name] = before[name]
    }
  }
}
async function galleryTrial(mode, attempt) {
  const fixture = await serveSlowThumbnails()
  const { state, url } = fixture
  const { XDriveMediaThumbnailScheduler } = loadTypescript(galleryPath)
  let scheduler
  let releasePriority = null
  try {
    scheduler = new XDriveMediaThumbnailScheduler(async (nodeID, signal) => {
      const response = await fetch(url + '/thumbnail/' + nodeID, { signal })
      await response.arrayBuffer()
      return 'https://viewer-preempt.invalid/gallery-' + nodeID
    }, { concurrency: 6 })
    const pending = Array.from({ length: 6 }, (_, i) =>
      scheduler.load(attempt * 100 + i + 1, 0, 1))
    await until(() => state.active === 6, 'Gallery six actual cold HTTP requests')
    const openAt = performance.now()
    const viewerRequest = fetch(url + '/viewer').then(response => response.text())
    await until(() => state.waitingViewers.length === 1, 'Viewer GET blocked by Gallery')
    if (mode === 'preempt') scheduler.setSuspended(true)
    else if (mode === 'foreground') releasePriority = priorityModule.xDriveAcquireViewerForeground({})
    const viewerBody = await viewerRequest
    assert.equal(viewerBody, 'viewer-current-original')
    const elapsedMS = state.viewerFinishedAt - openAt
    if (mode === 'baseline') await until(() =>
      state.thumbnails.slice(0, 6).every(row => row.closedAt !== null),
      'baseline Gallery six real HTTP bodies completed',
    )
    if (mode !== 'baseline') await until(
      () => state.thumbnails.slice(0, 6).every(row => row.closedAt !== null),
      'all Gallery thumbnail HTTP transports released',
    )
    const cancelled = state.thumbnails.slice(0, 6).filter(row => row.earlyClosed)
    const wastedBytes = state.thumbnails.slice(0, 6).reduce((sum, row) => sum + row.sentBytes, 0)
    await Promise.all(pending)
    if (mode !== 'baseline') {
      assert.equal(cancelled.length, 6, 'all Gallery background HTTP disconnects')
      assert.equal(wastedBytes, 0)
      assert.ok(elapsedMS < 250, 'Viewer must bypass cold Gallery thumbnail backlog: ' + elapsedMS)
      assert.equal(await scheduler.load(99999, 0, 1), null,
        'new background thumbnails must not restart under Viewer')
      assert.equal(state.thumbnails.length, 6)
      releasePriority?.()
      releasePriority = null
      scheduler.setSuspended(false)
      const resumed = scheduler.load(100000 + attempt, 0, 1)
      await until(() => state.thumbnails.length === 7, 'resumed Gallery requests')
      await resumed
    } else {
      assert.equal(cancelled.length, 0)
      assert.ok(elapsedMS >= 450, 'the original contention scenario must block Viewer')
      assert.equal(wastedBytes, 6 * 32768)
    }
    const sample = { source: 'Gallery-thumbnail-scheduler-real-HTTP', mode, attempt,
      modelHTTPConcurrency: 6, delayedThumbnailMS: 650,
      viewerMS: Math.round(elapsedMS), earlyClosed: cancelled.length,
      sentThumbnailBytes: wastedBytes }
    console.log('VIEWER_BACKGROUND_THUMB_HTTP_SAMPLE ' + JSON.stringify(sample))
    return sample
  } finally {
    releasePriority?.()
    scheduler?.dispose()
    await fixture.close()
  }
}
test('a shared foreground Viewer lease preempts six genuine HTTP thumbnails in Files and Gallery', async () => {
  // Local-HTTP six-slot contention, NOT a claimed real iPhone/Go 100k speedup.
  for (const [kind, trial] of [['Files', fileTrial], ['Gallery', galleryTrial]]) {
    const sample = await trial('foreground', 7)
    assert.equal(sample.earlyClosed, 6, kind + ' obsolete HTTP requests must abort')
    assert.equal(sample.sentThumbnailBytes, 0, kind + ' no obsolete response bytes')
    assert.ok(sample.viewerMS < 250, kind + ' current Viewer should be admitted')
    assert.equal(priorityModule.xDriveViewerForegroundActive(), false)
  }
})
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
for (const [kind, trial] of [['Files', fileTrial], ['Gallery', galleryTrial]]) {
  test('P0 Viewer must preempt six genuine slow background HTTP thumbnails in ' + kind, async () => {
    const baseline = [], fixed = []
    // Same runner and identical controlled server cap. The baseline is an
    // explicit NO-PREEMPTION control, NOT historical production performance.
    for (const [i, mode] of [
      [1, 'baseline'], [1, 'preempt'],
      [2, 'preempt'], [2, 'baseline'],
      [3, 'baseline'], [3, 'preempt'],
    ]) (mode === 'baseline' ? baseline : fixed).push(await trial(mode, i))
    const baselineP50 = median(baseline.map(s => s.viewerMS))
    const fixedP50 = median(fixed.map(s => s.viewerMS))
    const summary = { source: kind, n: 3, fixture: 'controlled-real-HTTP-six-650ms-slot-pressure',
      historicalBeforeCommit: false, physicalGo100k: false,
      baselineViewerP50MS: baselineP50, preemptViewerP50MS: fixedP50,
      allPreemptCancelled: fixed.every(s => s.earlyClosed === 6 && s.sentThumbnailBytes === 0) }
    console.log('VIEWER_BACKGROUND_THUMB_PAIRED_SUMMARY ' + JSON.stringify(summary))
    assert.equal(summary.allPreemptCancelled, true)
    assert.ok(fixedP50 < baselineP50 * 0.6,
      'a cancellation-only cosmetic fix must not pass the genuine Viewer blocking regression')
  })
}

test('both mounted workspace entry points pause only background thumbnails, not Viewer/operations', () => {
  const read = f => fs.readFileSync(path.join(repo, f), 'utf8')
  const app = read('web/src/App.tsx')
  const files = read('ui/shared/src/mui/FileExplorer.tsx')
  const provider = read('ui/shared/src/mui/FileExplorerThumbnail.tsx')
  const webFiles = read('web/src/WebFileExplorer.tsx')
  const mobileFiles = read('web/src/MobileFiles.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const media = read('ui/shared/src/mui/MediaGalleryPreviewMedia.tsx')
  const covers = read('ui/shared/src/mui/MediaGalleryCoverThumbnail.tsx')
  const coverPool = read('ui/shared/src/mui/MediaGalleryCoverThumbnailPool.ts')
  assert.match(app, /suspendBackgroundThumbnails=\{viewerActive\}/,
    'Web/PWA route must suspend both Files and Gallery on Viewer activation')
  assert.match(webFiles, /suspendBackgroundThumbnails=\{suspendBackgroundThumbnails\}/)
  assert.match(mobileFiles, /suspended=\{props\.suspendBackgroundThumbnails\}/)
  assert.match(files, /suspended=\{suspendBackgroundThumbnails \|\| quickLookItemID !== null\}/,
    'Desktop local QuickLook also preempts its mounted background FileExplorer')
  assert.match(provider, /for \(const cancel of \[\.\.\.cache\.pending\]\) cancel\(\)/)
  assert.match(provider, /foreground: foreground && !suspended/,
    'cancelled tile effects cannot immediately restart while Viewer is active')
  assert.match(gallery, /thumbnailScheduler\.setSuspended\(thumbnailBackgroundSuspended\)/)
  assert.match(gallery, /thumbnailBackgroundSuspended = suspendBackgroundThumbnails \|\| previewItem !== null \|\| viewerPriorityActive/,
    'Desktop inline Gallery Viewer and routed PWA Viewer must share one pause gate')
  assert.match(gallery, /<XDriveBackgroundMediaThumbnailSuspended\.Provider value=\{thumbnailBackgroundSuspended\}>/)
  assert.match(media, /if \(suspended\) return/, 'both tile and video-poster effects must stop')
  assert.match(media, /scheduled\.cancel\(\)/, 'video-poster capture must be cancelled too')
  assert.match(covers, /const coverPaused = suspended \|\| inlineViewerPaused/,
    'both routed Viewer and inline Viewer must suspend cover requests')
  assert.match(covers, /pool\?\.setSuspended\(coverPaused\)/,
    'album covers must release their lower-priority in-flight requests')
  assert.match(coverPool, /this\.scheduler\.setSuspended\(suspended\)/)
  assert.match(files, /<XDriveFileQuickLookDialog/,
    'the active Viewer itself is mounted separately and keeps its own loaders')
})

test('Gallery pause preserves cached thumbnails for the foreground Viewer', async () => {
  const { XDriveMediaThumbnailScheduler } = loadTypescript(galleryPath)
  let loads = 0
  const revoked = []
  const scheduler = new XDriveMediaThumbnailScheduler(async () => {
    loads++
    return 'blob:decoded-visible-' + loads
  }, { revokeURL: value => revoked.push(value) })
  const warmed = await scheduler.load(202, 0, 4)
  assert.equal(loads, 1)
  scheduler.setSuspended(true)
  assert.equal(await scheduler.load(202, 0, 4), warmed,
    'a warm thumbnail is reusable without new I/O while Viewer is active')
  assert.equal(await scheduler.load(203, 0, 4), null,
    'a cold background request is refused while Viewer is active')
  assert.equal(loads, 1)
  assert.deepEqual(revoked, [], 'background pause is not a cache clear or Blob revoke')
  scheduler.setSuspended(false)
  assert.equal(await scheduler.load(203, 0, 4), 'blob:decoded-visible-2')
  assert.equal(loads, 2, 'Gallery resumes ordinary visible fetching after Viewer exit')
  scheduler.dispose()
  assert.deepEqual(revoked, [warmed, 'blob:decoded-visible-2'],
    'ordinary dispose retains previous cache cleanup')
})
