'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

// Compile the real shared Live Photo surface. Only MUI host elements and the
// browser media element are stubs; hold and promise logic remain production.
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const original = read('ui/shared/src/mui/LivePhotoSurface.tsx')
const start = original.indexOf('function livePhotoMotionURL(')
assert.ok(start > 0, 'the production Live Photo helpers and component must exist')
const source = [
  "import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'",
  "import { xDriveAbortHTMLMediaElement } from './teardown'",
  "import { Box, Chip, CircularProgress, XDriveLivePhotoGlyph, XDriveMediaLoadingProgress, xDriveAnchorPreviewZoom, xDriveClampPreviewViewport } from './fixture'",
  'type XDriveLivePhotoMotionSource = string | { url: string; dispose?: () => void }',
  'type XDriveByteProgressHandler = (loaded: number, total?: number) => void',
  'type XDriveLivePhotoMotionLoader = (progress?: XDriveByteProgressHandler, signal?: AbortSignal) => Promise<XDriveLivePhotoMotionSource | null>',
  'type XDriveLivePhotoSurfaceProps = { still: any; stillReady?: boolean; loadMotion?: XDriveLivePhotoMotionLoader; sourceKey?: string | number; label?: string; onSwipePrevious?: () => void; onSwipeNext?: () => void; deferTouchHold?: boolean }',
  'type PointerEvent<T> = any; type KeyboardEvent<T> = any; type WheelEvent<T> = any',
  'type XDrivePreviewPoint = { x: number; y: number }; type XDrivePreviewViewport = { scale: number; offset: XDrivePreviewPoint }; type XDrivePreviewImageDimensions = { width: number; height: number; noUpscale?: boolean }',
  original.slice(start),
].join('\n')
const js = ts.transpileModule(source, {
  fileName: 'MountedRealLivePhotoSurface.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText
// Import the same pure viewport math used by ordinary still previews.
const viewportModule = { exports: {} }
const viewportJS = ts.transpileModule(read('ui/shared/src/file-preview-viewport.ts'), {
  fileName: 'file-preview-viewport.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('exports', 'module', viewportJS)(viewportModule.exports, viewportModule)
const teardownModule = { exports: {} }
const teardownJS = ts.transpileModule(read('ui/shared/src/mui/mediaPreviewStreamTeardown.ts'), {
  fileName: 'mediaPreviewStreamTeardown.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('exports', 'module', teardownJS)(teardownModule.exports, teardownModule)
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  './teardown': teardownModule.exports,
  './fixture': {
    Box: 'mounted-live-box',
    Chip: 'mounted-live-chip',
    CircularProgress: 'mounted-live-circular-progress',
    XDriveLivePhotoGlyph: 'mounted-live-glyph',
    XDriveMediaLoadingProgress: 'mounted-live-progress',
    xDriveAnchorPreviewZoom: viewportModule.exports.xDriveAnchorPreviewZoom,
    xDriveClampPreviewViewport: viewportModule.exports.xDriveClampPreviewViewport,
  },
}
const mod = { exports: {} }
new Function('exports', 'module', 'require', js)(mod.exports, mod, id => {
  assert.ok(id in mocks, 'unexpected production dependency ' + id)
  return mocks[id]
})
const Live = mod.exports.XDriveLivePhotoSurface
global.HTMLMediaElement = { HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3 }
const flush = async () => {
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
}
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const makePlayer = play => ({
  play,
  pauseCalls: 0,
  removedSource: 0,
  resetLoads: 0,
  currentTime: 0,
  volume: 0,
  readyState: 3,
  pause() { this.pauseCalls++ },
  removeAttribute(name) { assert.equal(name, 'src'); this.removedSource++ },
  load() { this.resetLoads++ },
})
const mount = (player, loadMotion, sourceKey = 'node:1', extra = {}) =>
  renderer.create(React.createElement(Live, {
    still: React.createElement('mounted-live-still', { 'data-still': true }),
    stillReady: true,
    sourceKey,
    loadMotion,
    ...extra,
  }), {
    createNodeMock: element => {
      if (element.type === 'mounted-live-box' && element.props.component === 'video') return player
      if (element.type === 'mounted-live-box' && element.props.role === 'button') {
        return {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
          querySelector: selector => selector.includes('img:not')
            ? { naturalWidth: 400, naturalHeight: 300 } : null,
        }
      }
      return null
    },
  })
const surface = tree => tree.root.find(x =>
  x.type === 'mounted-live-box' && x.props.role === 'button')
const video = tree => tree.root.findAll(x =>
  x.type === 'mounted-live-box' && x.props.component === 'video')[0]
const label = tree => tree.root.find(x => x.type === 'mounted-live-chip').props.label
const pointer = {
  isPrimary: true,
  pointerType: 'touch',
  button: 0,
  pointerId: 1,
  currentTarget: {
    setPointerCapture() {},
    hasPointerCapture() { return false },
    releasePointerCapture() {},
  },
}
const press = tree => surface(tree).props.onPointerDown(pointer)
const release = tree => surface(tree).props.onPointerUp(pointer)

test('hidden Viewer immediately cancels motion, retires late tickets, and pagehide releases the player', async () => {
  const priorDocument = global.document
  const priorWindow = global.window
  const listeners = new Map()
  const pageListeners = new Map()
  const add = (map, name, callback) => {
    if (!map.has(name)) map.set(name, new Set())
    map.get(name).add(callback)
  }
  const remove = (map, name, callback) => map.get(name)?.delete(callback)
  const dispatch = (map, name) => {
    for (const callback of [...(map.get(name) ?? [])]) callback({ type: name })
  }
  let visibility = 'visible'
  global.document = {
    get visibilityState() { return visibility },
    addEventListener: (name, callback) => add(listeners, name, callback),
    removeEventListener: (name, callback) => remove(listeners, name, callback),
  }
  global.window = {
    addEventListener: (name, callback) => add(pageListeners, name, callback),
    removeEventListener: (name, callback) => remove(pageListeners, name, callback),
  }
  const pending = deferred()
  const signals = []
  const player = makePlayer(async () => {})
  let created = 0
  let disposed = 0
  let tree
  const loadMotion = (_progress, signal) => {
    created++
    signals.push(signal)
    if (created === 1) return pending.promise
    return Promise.resolve({
      url: 'https://example.invalid/new-live.mov',
      dispose: () => { disposed++ },
    })
  }
  try {
    await act(async () => {
      tree = mount(player, loadMotion, 'background:1')
      await flush()
    })
    await act(async () => { press(tree); await flush() })
    assert.equal(created, 1)
    assert.equal(signals[0].aborted, false)
    await act(async () => {
      visibility = 'hidden'
      dispatch(listeners, 'visibilitychange')
      await flush()
    })
    assert.equal(signals[0].aborted, true, 'hidden tab must abort the current signed ticket')
    assert.equal(surface(tree).props['aria-pressed'], false)
    assert.equal(surface(tree).props['aria-busy'], false)
    await act(async () => {
      pending.resolve({
        url: 'https://example.invalid/late-live.mov',
        dispose: () => { disposed++ },
      })
      await flush()
    })
    assert.equal(disposed, 1, 'a late ticket must be disposed after background cancellation')
    assert.equal(video(tree), undefined, 'hidden tab cannot render obsolete motion')
    await act(async () => { press(tree); await flush() })
    assert.equal(created, 1, 'queued pointer input must not acquire motion while hidden')
    await act(async () => {
      visibility = 'visible'
      dispatch(listeners, 'visibilitychange')
      await flush()
    })
    assert.equal(created, 1, 'foreground restore must not autoplay or prefetch motion')
    await act(async () => { press(tree); await flush() })
    assert.equal(created, 2, 'a new visible explicit hold may acquire motion again')
    assert.ok(video(tree), 'new hold may play the valid current motion')
    await act(async () => { dispatch(pageListeners, 'pagehide'); await flush() })
    assert.equal(disposed, 2, 'pagehide must retire the active motion lease once')
    assert.ok(player.removedSource >= 1, 'pagehide must detach signed video Range')
    assert.equal(video(tree), undefined)
    await act(async () => { tree.unmount(); tree = null })
    assert.equal(listeners.get('visibilitychange')?.size ?? 0, 0)
    assert.equal(pageListeners.get('pagehide')?.size ?? 0, 0)
  } finally {
    if (tree) await act(async () => tree.unmount())
    if (priorDocument === undefined) delete global.document
    else global.document = priorDocument
    if (priorWindow === undefined) delete global.window
    else global.window = priorWindow
  }
})

test('P0-L6 pending video.play retains still; release abort is not a permanent Live failure', async () => {
  const firstPlay = deferred()
  let playCalls = 0
  let loads = 0
  const player = makePlayer(() => ++playCalls === 1 ? firstPlay.promise : Promise.resolve())
  let tree
  await act(async () => {
    tree = mount(player, async () => { loads++; return 'https://example.invalid/live.mov' })
    await flush()
  })
  assert.equal(loads, 0, 'mount must not request motion')
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1)
  assert.equal(playCalls, 1)
  assert.equal(video(tree).props.sx.opacity, 0, 'an unresolved play() must not show a black video surface')
  assert.equal(surface(tree).props['aria-pressed'], false)
  assert.equal(tree.root.findAll(x => x.type === 'mounted-live-still').length, 1)
  await act(async () => {
    release(tree)
    firstPlay.reject(Object.assign(new Error('paused before playback'), { name: 'AbortError' }))
    await flush()
  })
  assert.equal(label(tree), '实况', 'a released/aborted hold must be retryable')
  assert.equal(surface(tree).props['aria-busy'], false)
  assert.equal(video(tree).props.sx.opacity, 0)
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1, 'second hold must reuse the signed motion source')
  assert.equal(playCalls, 2)
  assert.equal(surface(tree).props['aria-pressed'], true)
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0, 'release must immediately restore still')
  await act(async () => { tree.unmount() })
})

test('P0-L6 rehold during in-flight motion ticket reuses one fetch and resumes progress', async () => {
  const motion = deferred()
  let loads = 0
  let plays = 0
  const player = makePlayer(() => { plays++; return Promise.resolve() })
  let tree
  await act(async () => {
    tree = mount(player, () => { loads++; return motion.promise }, 'still:9')
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1)
  assert.equal(surface(tree).props['aria-busy'], true)
  await act(async () => { release(tree); await flush() })
  assert.equal(surface(tree).props['aria-busy'], false)
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1, 'reholding must not request another ticket')
  assert.equal(surface(tree).props['aria-busy'], true)
  await act(async () => { motion.resolve('https://example.invalid/delayed.mov'); await flush() })
  assert.equal(plays, 1)
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); tree.unmount() })
})

test('P0-L6 old play rejection cannot corrupt a newer hold; current decode failure keeps still', async () => {
  const old = deferred()
  const second = deferred()
  let count = 0
  const player = makePlayer(() => ++count === 1 ? old.promise : second.promise)
  let tree
  await act(async () => {
    tree = mount(player, async () => 'https://example.invalid/live.mov', 'still:10')
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  await act(async () => { release(tree); press(tree); await flush() })
  assert.equal(count, 2)
  await act(async () => { second.resolve(); await flush() })
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { old.reject(new Error('stale decoder failure')); await flush() })
  assert.equal(label(tree), '实况', 'prior play failure must not mark current source unavailable')
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); tree.unmount() })

  const broken = makePlayer(() => Promise.reject(new Error('unsupported codec')))
  let failedTree
  await act(async () => {
    failedTree = mount(broken, async () => 'https://example.invalid/unsupported.mov', 'still:11')
    await flush()
  })
  await act(async () => { press(failedTree); await flush() })
  assert.equal(label(failedTree), '实况不可用')
  assert.equal(video(failedTree), undefined, 'terminal codec failure detaches the stale motion element')
  assert.equal(failedTree.root.findAll(x => x.type === 'mounted-live-still').length, 1)
  await act(async () => { failedTree.unmount() })
})

test('P0-L6 Safari NotAllowedError on first hold is retryable without re-fetching motion', async () => {
  let playCalls = 0
  let loads = 0
  const denied = Object.assign(new Error('gesture unavailable'), { name: 'NotAllowedError' })
  const player = makePlayer(() => ++playCalls === 1 ? Promise.reject(denied) : Promise.resolve())
  let tree
  await act(async () => {
    tree = mount(player, async () => { loads++; return 'https://example.invalid/stream.mov' })
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  assert.equal(label(tree), '实况')
  assert.equal(video(tree).props.sx.opacity, 0)
  await act(async () => { release(tree); press(tree); await flush() })
  assert.equal(loads, 1)
  assert.equal(playCalls, 2)
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); tree.unmount() })
})

test('P0-L6 mobile and wide Web reuse shared Live presentation, API and virtual windows', () => {
  const viewer = read('ui/shared/src/mui/MediaViewerContent.tsx')
  const webApp = read('web/src/App.tsx')
  const adapter = read('web/src/mediaGalleryAdapter.ts')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(viewer, /<XDriveLivePhotoSurface/)
  assert.match(webApp, /createWebMediaGalleryDataSource\(\s*api\s*(?:,\s*\{\s*onAuthorizedAlbums\s*:|\))/)
  assert.match(adapter, /mediaLivePhotoMotionURL\(nodeID, signal\)/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(read('ui/shared/src/mui/LivePhotoSurface.tsx'), /preload=\{holdActiveRef\.current && stillReady \? 'metadata' : 'none'\}/)
})

test('P0-L7 delayed motion ticket after release stays preload=none until next explicit hold', async () => {
  const ticket = deferred()
  let loads = 0
  let plays = 0
  const player = makePlayer(() => { plays++; return Promise.resolve() })
  let tree
  await act(async () => {
    tree = mount(player, () => { loads++; return ticket.promise }, 'delayed:1')
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1)
  assert.equal(plays, 0)
  await act(async () => { release(tree); await flush() })
  await act(async () => { ticket.resolve('https://example.invalid/delayed.mov'); await flush() })
  assert.equal(video(tree).props.preload, 'none', 'released video cannot initiate a metadata preload')
  assert.equal(video(tree).props.sx.opacity, 0)
  assert.equal(plays, 0, 'ticket resolution after release cannot autoplay')
  assert.equal(label(tree), '实况')
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1, 'next hold should reuse the valid signed URL')
  assert.equal(plays, 1)
  assert.equal(video(tree).props.preload, 'metadata')
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); await flush() })
  assert.equal(video(tree).props.preload, 'none')
  assert.equal(video(tree).props.sx.opacity, 0)
  await act(async () => { tree.unmount() })
})

test('P0-L7 late video error from released or previous still does not poison current motion', async () => {
  const player = makePlayer(() => Promise.resolve())
  const oldSource = async () => 'https://example.invalid/old.mov'
  const newSource = async () => 'https://example.invalid/new.mov'
  const element = (sourceKey, loader) => React.createElement(Live, {
    still: React.createElement('mounted-live-still'),
    stillReady: true, sourceKey, loadMotion: loader,
  })
  let tree
  await act(async () => {
    tree = renderer.create(element('still:101', oldSource), {
      createNodeMock: entry =>
        entry.type === 'mounted-live-box' && entry.props.component === 'video'
          ? player : null,
    })
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  const staleError = video(tree).props.onError
  const oldURL = video(tree).props.src
  await act(async () => { release(tree); await flush() })
  await act(async () => { staleError({ currentTarget: player }); await flush() })
  assert.equal(label(tree), '实况', 'late error after release must not mark Live unavailable')

  await act(async () => { tree.update(element('still:102', newSource)); await flush() })
  await act(async () => { press(tree); await flush() })
  assert.notEqual(video(tree).props.src, oldURL)
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { staleError({ currentTarget: player }); await flush() })
  assert.equal(label(tree), '实况', 'old source error cannot poison new still')
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { video(tree).props.onError({ currentTarget: player }); await flush() })
  assert.equal(label(tree), '实况不可用', 'real error for current held video remains terminal')
  assert.equal(video(tree), undefined, 'terminal stream error detaches the motion element')
  await act(async () => { tree.unmount() })
})

test('P0-L7 lost still immediately detaches signed motion, releases its lease and needs a fresh hold', async () => {
  let plays = 0
  let loads = 0
  let released = 0
  const player = makePlayer(() => { plays++; return Promise.resolve() })
  const loader = async () => ({
    url: `https://example.invalid/private-live-${++loads}.mov`,
    dispose() { released++ },
  })
  const element = stillReady => React.createElement(Live, {
    still: React.createElement('mounted-live-still'), stillReady,
    sourceKey: 'still:90', loadMotion: loader,
  })
  let tree
  try {
    await act(async () => {
      tree = renderer.create(element(true), {
        createNodeMock: entry =>
          entry.type === 'mounted-live-box' && entry.props.component === 'video'
            ? player : null,
      })
      await flush()
    })
    await act(async () => { press(tree); await flush() })
    assert.equal(loads, 1)
    assert.equal(plays, 1)
    assert.equal(video(tree).props.sx.opacity, 1)
    const oldError = video(tree).props.onError

    await act(async () => { tree.update(element(false)); await flush() })
    assert.equal(video(tree), undefined, 'failed still cannot retain the signed native motion source')
    assert.equal(player.removedSource, 1, 'lost still detaches HTTP Range immediately')
    assert.equal(player.resetLoads, 1)
    assert.equal(released, 1, 'retired one-shot signed proxy lease is disposed once')
    assert.equal(surface(tree).props['aria-disabled'], true)
    await act(async () => { press(tree); await flush() })
    assert.equal(loads, 1, 'disabled still cannot reissue a signed ticket')

    await act(async () => { tree.update(element(true)); await flush() })
    assert.equal(video(tree), undefined, 'still recovery must not mount or autoplay obsolete motion')
    assert.equal(plays, 1)
    await act(async () => { oldError({ currentTarget: player }); await flush() })
    assert.equal(label(tree), '实况', 'late old media error cannot poison the recovered still')
    await act(async () => { press(tree); await flush() })
    assert.equal(loads, 2, 'a new explicit hold must acquire a fresh signed motion source')
    assert.equal(plays, 2)
    assert.equal(video(tree).props.src, 'https://example.invalid/private-live-2.mov')
    assert.equal(video(tree).props.sx.opacity, 1)

    await act(async () => { release(tree); tree.unmount(); tree = null })
    assert.equal(player.removedSource, 2, 'final Close detaches only the new Range')
    assert.equal(player.resetLoads, 2)
    assert.equal(released, 2, 'new proxy released, old proxy not double disposed')
  } finally {
    if (tree) await act(async () => tree.unmount())
  }
})


test('P0-L8 manual hold retries a failed motion ticket exactly once without automatic polling', async () => {
  let loads = 0
  let plays = 0
  const loader = async () => {
    loads += 1
    if (loads === 1) throw Error('transient signed ticket lookup failure')
    return 'https://example.invalid/live-recovered.mov'
  }
  const player = makePlayer(() => { plays++; return Promise.resolve() })
  let tree
  await act(async () => { tree = mount(player, loader, 'still:recover'); await flush() })
  assert.equal(loads, 0, 'idle Viewer must not request motion')
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1)
  assert.equal(label(tree), '实况不可用')
  assert.equal(plays, 0)
  // A rejected Promise alone cannot schedule a second ticket request.
  await act(async () => { await flush() })
  assert.equal(loads, 1, 'never automatically retry under a continued hold')
  await act(async () => { release(tree); await flush() })
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 2, 'the next explicit press triggers exactly one new ticket')
  assert.equal(label(tree), '实况')
  assert.equal(plays, 1)
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); tree.unmount() })
})

test('P0-L8 null ticket result can recover on a new press and old attempt progress is fenced', async () => {
  const progressHandlers = []
  const second = deferred()
  let loads = 0
  const player = makePlayer(() => Promise.resolve())
  const loader = onProgress => {
    progressHandlers.push(onProgress)
    loads++
    return loads === 1 ? Promise.resolve(null) : second.promise
  }
  let tree
  await act(async () => { tree = mount(player, loader, 'still:progress'); await flush() })
  await act(async () => { press(tree); await flush() })
  assert.equal(label(tree), '实况不可用')
  await act(async () => { release(tree); press(tree); await flush() })
  assert.equal(loads, 2)
  assert.equal(surface(tree).props['aria-busy'], true)
  await act(async () => {
    progressHandlers[1](12, 100)
    progressHandlers[0](96, 100)
    await flush()
  })
  const current = tree.root.findAll(x => x.type === 'mounted-live-progress')[0]
  assert.equal(current.props.loadedBytes, 12, 'completed old request must not overwrite the retry progress')
  await act(async () => { release(tree); await flush() })
  await act(async () => {
    second.resolve('https://example.invalid/late-recovery.mov')
    await flush()
  })
  assert.equal(loads, 2)
  assert.equal(video(tree).props.preload, 'none')
  assert.equal(video(tree).props.sx.opacity, 0, 'a result after release cannot autoplay')
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 2, 'recovered signed URL is reused instead of requested again')
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); tree.unmount() })
})

test('P0-L8 a true current video decoding failure still does not reissue a motion ticket', async () => {
  let loads = 0
  let plays = 0
  const player = makePlayer(() => { plays++; return Promise.reject(new Error('unsupported HEVC codec')) })
  let tree
  await act(async () => {
    tree = mount(player, async () => { loads++; return 'https://example.invalid/invalid-codec.mov' })
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  assert.equal(label(tree), '实况不可用')
  await act(async () => { release(tree); press(tree); await flush() })
  assert.equal(loads, 1, 'media decode error is not mistaken for a transient ticket failure')
  assert.equal(plays, 1, 'unsupported video is not replayed without replacing the source')
  assert.equal(video(tree), undefined,
    'terminal codec failure must detach its video and preserve the still')
  assert.equal(player.removedSource, 1, 'a failed native Range must be stopped once')
  assert.equal(player.resetLoads, 1)
  await act(async () => { release(tree); tree.unmount() })
})


test('P1 first-frame: play() success alone cannot cover Live still before actual compositor frame', async () => {
  const queued = new Map()
  const cancelled = []
  let serial = 0, loads = 0
  const player = makePlayer(() => Promise.resolve())
  player.requestVideoFrameCallback = callback => {
    const id = ++serial
    queued.set(id, callback)
    return id
  }
  player.cancelVideoFrameCallback = id => cancelled.push(id)
  let tree
  await act(async () => {
    tree = mount(player, async () => { loads++; return 'https://example.invalid/p1-first-frame.mov' })
    await flush()
  })
  assert.equal(loads, 0, 'no idle motion preload')
  await act(async () => { press(tree); await flush() })
  assert.equal(loads, 1)
  assert.equal(serial, 1, 'schedule one genuine compositor-frame receipt')
  assert.equal(video(tree).props.sx.opacity, 0, 'play() is not visual first frame')
  assert.equal(surface(tree).props['aria-pressed'], false)
  assert.equal(surface(tree).props['aria-busy'], true)
  assert.equal(tree.root.findAll(x => x.type === 'mounted-live-still').length, 1)
  await act(async () => { queued.get(1)(0, { presentedFrames: 1 }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 1, 'first real frame may replace still')
  assert.equal(surface(tree).props['aria-pressed'], true)
  assert.equal(surface(tree).props['aria-busy'], false)
  await act(async () => { release(tree); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0)
  assert.equal(cancelled.includes(1), false, 'completed receipt is not outstanding')
  await act(async () => { tree.unmount() })
})

test('P1 first-frame: stale callback cannot reveal released, re-held or replaced Live source', async () => {
  const callbacks = []
  const cancellations = []
  const player = makePlayer(() => Promise.resolve())
  player.requestVideoFrameCallback = callback => {
    callbacks.push(callback)
    return callbacks.length
  }
  player.cancelVideoFrameCallback = id => cancellations.push(id)
  const element = (key, loader) => React.createElement(Live, {
    still: React.createElement('mounted-live-still'), stillReady: true,
    sourceKey: key, loadMotion: loader,
  })
  let tree
  await act(async () => {
    tree = renderer.create(element('node:1', async () => 'https://example.invalid/old.mov'), {
      createNodeMock: entry => entry.type === 'mounted-live-box' &&
        entry.props.component === 'video' ? player : null,
    })
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  assert.equal(callbacks.length, 1)
  await act(async () => { release(tree); press(tree); await flush() })
  assert.ok(cancellations.includes(1), 'release cancels outstanding frame receipt')
  assert.equal(callbacks.length, 2)
  await act(async () => { callbacks[0](0, { presentedFrames: 1 }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0, 'old hold callback must not reveal video')
  await act(async () => { callbacks[1](0, { presentedFrames: 1 }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => {
    tree.update(element('node:2', async () => 'https://example.invalid/new.mov'))
    await flush()
  })
  assert.equal(video(tree), undefined, 'changing still unmounts the prior video before the new source loads')
  assert.equal(tree.root.findAll(x => x.type === 'mounted-live-still').length, 1,
    'the already accepted still remains mounted across source replacement')
  await act(async () => { press(tree); await flush() })
  assert.equal(callbacks.length, 3)
  await act(async () => { callbacks[1](0, { presentedFrames: 9 }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0)
  await act(async () => { callbacks[2](0, { presentedFrames: 1 }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); tree.unmount() })
})

test('P1 first-frame: legacy browser waits for decoded loadeddata, not just play() or canplay metadata', async () => {
  const player = makePlayer(() => Promise.resolve())
  player.readyState = 1
  let tree
  await act(async () => {
    tree = mount(player, async () => 'https://example.invalid/legacy.mov')
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0)
  assert.equal(surface(tree).props['aria-busy'], true)
  await act(async () => { video(tree).props.onCanPlay({ currentTarget: player }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0, 'metadata-only readiness is not decoded frame')
  player.readyState = 2
  await act(async () => { video(tree).props.onLoadedData({ currentTarget: player }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 1)
  await act(async () => { release(tree); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0)
  await act(async () => { video(tree).props.onTimeUpdate({ currentTarget: player }); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0, 'late loaded-data after release cannot reveal motion')
  await act(async () => { tree.unmount() })
})


test('P1 Live motion aborts stale ticket on source replacement and unmount while re-hold reuses it', async () => {
  const requests = []
  const disposed = []
  const player = makePlayer(() => Promise.resolve())
  const loader = (_progress, signal) => new Promise(resolve => requests.push({ signal, resolve }))
  const item = key => React.createElement(Live, {
    sourceKey: key,
    still: React.createElement('mounted-live-still'),
    stillReady: true,
    loadMotion: loader,
  })
  let tree
  try {
    await act(async () => {
      tree = renderer.create(item('Owner-A'), {
        createNodeMock: el => el.type === 'mounted-live-box' && el.props.component === 'video' ? player : null,
      })
    })
    await act(async () => { press(tree); await flush() })
    assert.equal(requests.length, 1)
    assert.ok(requests[0].signal instanceof AbortSignal)
    assert.equal(requests[0].signal.aborted, false)
    await act(async () => { release(tree); press(tree); await flush() })
    assert.equal(requests.length, 1, 'same-still re-hold may reuse the pending ticket')
    assert.equal(requests[0].signal.aborted, false)

    await act(async () => { tree.update(item('Owner-B')); await flush() })
    assert.equal(requests[0].signal.aborted, true, 'Owner/source switch cancels the old HTTP ticket')
    await act(async () => {
      requests[0].resolve({
        url: 'https://example.invalid/old-owner.mov',
        dispose() { disposed.push('A') },
      })
      await flush()
    })
    assert.deepEqual(disposed, ['A'], 'late cancelled source must release its resource')
    assert.equal(video(tree), undefined, 'old Owner motion must never appear in new Viewer')

    await act(async () => { press(tree); await flush() })
    assert.equal(requests.length, 2)
    assert.equal(requests[1].signal.aborted, false)
    await act(async () => { tree.unmount(); tree = null })
    assert.equal(requests[1].signal.aborted, true, 'unmount cancels the pending source ticket')
  } finally {
    if (tree) await act(async () => tree.unmount())
  }
})

test('P1 Web Live Photo adapters pass one AbortSignal to authenticated motion ticket', () => {
  const webAPI = read('web/src/api.ts')
  const explorer = read('web/src/WebFileExplorer.tsx')
  const gallery = read('web/src/mediaGalleryAdapter.ts')
  const routed = read('web/src/WebFileViewerApps.tsx')
  const shared = read('ui/shared/src/mui/FilePreviewSurface.tsx')
  const semantic = read('ui/shared/src/mui/MediaViewerContent.tsx')
  for (const [label, code, needle] of [
    ['Web API', webAPI, 'mediaLivePhotoMotionURL(nodeID: number, signal?: AbortSignal)'],
    ['Web auth transport', webAPI, "{ method: 'POST', signal }"],
    ['FileExplorer', explorer, 'api.mediaLivePhotoMotionURL(Number(item.id), signal)'],
    ['Gallery adapter', gallery, 'api.mediaLivePhotoMotionURL(nodeID, signal)'],
    ['Routed Quick Look', routed, 'api.mediaLivePhotoMotionURL(Number(currentTarget.id), signal)'],
    ['Shared FilePreview', shared, 'loadLivePhotoMotion(target, onProgress, signal)'],
    ['Semantic Gallery Viewer', semantic, 'loadLivePhotoMotion(item.node.id, onProgress, signal)'],
    ['Routed Owner isolation', routed, 'key={modalOwner.session}'],
  ]) assert.ok(code.includes(needle), label + ' must retain signal / ownership')
})


test('P1 Live Photo browsing separates tap, swipe and stationary hold without eager motion bytes', async () => {
  const originalSet = global.setTimeout
  const originalClear = global.clearTimeout
  const scheduled = new Map()
  let nextTimer = 1000000
  global.setTimeout = (callback, delay, ...args) => {
    if (delay === 260) {
      const id = nextTimer++
      scheduled.set(id, () => callback(...args))
      return id
    }
    return originalSet(callback, delay, ...args)
  }
  global.clearTimeout = (id) => {
    if (!scheduled.delete(id)) originalClear(id)
  }
  let loads = 0, next = 0, previous = 0
  const load = async () => { loads++; return 'https://example.invalid/one-live.mov' }
  const player = makePlayer(() => Promise.resolve())
  const opts = { onSwipeNext: () => next++, onSwipePrevious: () => previous++, deferTouchHold: true }
  const pt = (x, y, pointerId = 1, isPrimary = true) => ({
    ...pointer, pointerId, isPrimary, clientX: x, clientY: y,
  })
  let tree
  const start = async (x, y) => act(async () => { surface(tree).props.onPointerDown(pt(x, y)); await flush() })
  const move = async (x, y) => act(async () => { surface(tree).props.onPointerMove(pt(x, y)); await flush() })
  const finish = async (x, y) => act(async () => { surface(tree).props.onPointerUp(pt(x, y)); await flush() })
  try {
    await act(async () => { tree = mount(player, load, 'gesture:1', opts); await flush() })
    await start(300, 150)
    assert.equal(loads, 0, 'touch down may not mint motion before a stationary hold')
    assert.equal(scheduled.size, 1)
    const stale = [...scheduled.values()][0]
    await move(200, 150)
    assert.equal(scheduled.size, 0, 'moving cancels the in-flight hold timer')
    await finish(200, 150)
    assert.equal(next, 1, 'left swipe advances one authorized photo')
    assert.equal(previous, 0)
    assert.equal(loads, 0, 'horizontal navigation must never mint a Live ticket')
    await act(async () => { stale(); await flush() })
    assert.equal(loads, 0, 'a queued stale timer cannot request motion after navigation')

    await start(200, 150)
    await finish(200, 150)
    assert.equal(loads, 0, 'short tap only toggles outer Viewer chrome')
    await start(300, 150)
    await move(300, 235)
    await finish(300, 235)
    assert.equal(next, 1, 'vertical move must not navigate')
    assert.equal(loads, 0, 'vertical move must not request motion')
    await start(300, 150)
    await move(296, 180)
    await move(140, 150)
    await finish(140, 150)
    assert.equal(next, 1, 'vertical-first movement must not change into horizontal navigation')
    assert.equal(loads, 0)

    await start(200, 150)
    const hold = [...scheduled.values()][0]
    assert.ok(hold)
    await act(async () => { hold(); await flush() })
    assert.equal(loads, 1, 'stationary long hold requests one authenticated motion source')
    await finish(200, 150)
    assert.equal(next, 1)
    assert.equal(video(tree).props.sx.opacity, 0, 'release returns the still immediately')
  } finally {
    if (tree) await act(async () => tree.unmount())
    global.setTimeout = originalSet
    global.clearTimeout = originalClear
  }
})

test('P1 Live Photo two-finger and replaced-source gestures cancel before navigation or motion fetch', async () => {
  const originalSet = global.setTimeout
  const originalClear = global.clearTimeout
  const scheduled = new Map()
  let seq = 2000000
  global.setTimeout = (cb, delay, ...args) => {
    if (delay === 260) { const id = seq++; scheduled.set(id, () => cb(...args)); return id }
    return originalSet(cb, delay, ...args)
  }
  global.clearTimeout = id => { if (!scheduled.delete(id)) originalClear(id) }
  const player = makePlayer(() => Promise.resolve())
  const load = async () => { loads++; return 'https://example.invalid/live.mov' }
  let loads = 0, navigation = 0, tree
  const opts = { onSwipeNext: () => navigation++, deferTouchHold: true }
  const pt = (x, pointerId = 1, isPrimary = true) => ({
    ...pointer, pointerId, isPrimary, clientX: x, clientY: 120,
  })
  try {
    await act(async () => { tree = mount(player, load, 'A', opts); await flush() })
    await act(async () => {
      surface(tree).props.onPointerDown(pt(300))
      surface(tree).props.onPointerDown(pt(320, 2, false))
    })
    assert.equal(scheduled.size, 0, 'pinch/second finger cancels an uncommitted Live hold')
    await act(async () => {
      surface(tree).props.onPointerMove(pt(200))
      surface(tree).props.onPointerUp(pt(200))
      await flush()
    })
    assert.equal(navigation, 0)
    assert.equal(loads, 0)
    await act(async () => surface(tree).props.onPointerDown(pt(250)))
    const late = [...scheduled.values()][0]
    assert.ok(late)
    await act(async () => {
      tree.update(React.createElement(Live, {
        still: React.createElement('mounted-live-still', null),
        stillReady: true, sourceKey: 'B', loadMotion: load, ...opts,
      }))
      await flush()
    })
    assert.equal(scheduled.size, 0, 'source revision invalidates pending hold timer')
    await act(async () => { late(); await flush() })
    assert.equal(loads, 0, 'A timer cannot fetch motion for B')
  } finally {
    if (tree) await act(async () => tree.unmount())
    global.setTimeout = originalSet
    global.clearTimeout = originalClear
  }
})


test('P1 single-photo Viewer defers touch even with no neighboring media, and still loss revokes hold', async () => {
  const set = global.setTimeout, clear = global.clearTimeout, pending = new Map()
  let nextID = 3100000
  global.setTimeout = (callback, delay, ...args) => {
    if (delay === 260) {
      const id = nextID++
      pending.set(id, () => callback(...args))
      return id
    }
    return set(callback, delay, ...args)
  }
  global.clearTimeout = id => { if (!pending.delete(id)) clear(id) }
  let loads = 0, tree
  const loader = async () => { loads++; return 'https://example.invalid/one.mov' }
  const player = makePlayer(() => Promise.resolve())
  const gesture = (x, y) => ({ ...pointer, clientX: x, clientY: y })
  const options = { deferTouchHold: true }
  const render = stillReady => React.createElement(Live, {
    still: React.createElement('mounted-live-still', null),
    stillReady, sourceKey: 'single:2', loadMotion: loader, ...options,
  })
  try {
    await act(async () => {
      tree = mount(player, loader, 'single:2', options)
      await flush()
    })
    await act(async () => {
      surface(tree).props.onPointerDown(gesture(300, 150))
      surface(tree).props.onPointerMove(gesture(180, 150))
      surface(tree).props.onPointerUp(gesture(180, 150))
      await flush()
    })
    assert.equal(loads, 0, 'last item still must not fetch motion on a swipe')
    assert.equal(pending.size, 0)
    await act(async () => {
      surface(tree).props.onPointerDown(gesture(200, 150))
      surface(tree).props.onPointerUp(gesture(200, 150))
      await flush()
    })
    assert.equal(loads, 0, 'short tap with no neighbors is not a Live press')
    await act(async () => surface(tree).props.onPointerDown(gesture(180, 150)))
    const delayed = [...pending.values()][0]
    assert.ok(delayed)
    await act(async () => { tree.update(render(false)); await flush() })
    assert.equal(pending.size, 0)
    await act(async () => { delayed(); await flush() })
    assert.equal(loads, 0, 'lost still must revoke even an already queued hold callback')
  } finally {
    if (tree) await act(async () => tree.unmount())
    global.setTimeout = set
    global.clearTimeout = clear
  }
})

test('P1 Live still double tap and wheel zoom never acquire motion without a hold', async () => {
  let loads = 0
  const player = makePlayer(() => Promise.resolve())
  const extra = { interactiveImage: true, deferTouchHold: true }
  let tree
  const e = (id, x, y, primary = true) => ({
    ...pointer, pointerId: id, isPrimary: primary,
    clientX: x, clientY: y, preventDefault() {},
    currentTarget: {
      ...pointer.currentTarget,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    },
  })
  const transform = () => tree.root.find(x => x.type === 'mounted-live-box' &&
    typeof x.props.sx?.transform === 'string').props.sx.transform
  try {
    await act(async () => { tree = mount(player, async () => { loads++; return '/motion.mov' }, 'zoom:first', extra) })
    const tap = async () => {
      surface(tree).props.onPointerDown(e(1, 250, 150))
      surface(tree).props.onPointerUp(e(1, 250, 150))
    }
    await act(async () => { await tap(); await tap() })
    assert.equal(transform(), 'translate(-50px, 0px) scale(2)')
    assert.equal(loads, 0, 'a quick double tap must never request Live motion')
    await act(async () => {
      surface(tree).props.onWheel({ ...e(1, 250, 150), deltaY: -1 })
    })
    assert.ok(transform().includes('scale(2.3)'), 'wheel uses existing 1.15x anchored zoom')
    assert.equal(loads, 0)
    await act(async () => { await tap(); await tap() })
    assert.equal(transform(), 'translate(0px, 0px) scale(1)', 'double tap again resets zoom')
    assert.equal(loads, 0)
  } finally { if (tree) await act(async () => tree.unmount()) }
})

test('P1 Live pinch/pan stays in the same still, not navigation or motion', async () => {
  let loads = 0, navigation = 0
  const player = makePlayer(() => Promise.resolve())
  const extra = { interactiveImage: true, deferTouchHold: true,
    onSwipeNext: () => navigation++ }
  let tree
  const e = (id, x, y, primary = true) => ({
    ...pointer, pointerId: id, isPrimary: primary, clientX: x, clientY: y,
    preventDefault() {}, currentTarget: {
      ...pointer.currentTarget,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    },
  })
  const transform = () => tree.root.find(x => x.type === 'mounted-live-box' &&
    typeof x.props.sx?.transform === 'string').props.sx.transform
  const load = async () => { loads++; return '/motion.mov' }
  try {
    await act(async () => { tree = mount(player, load, 'zoom:A', extra) })
    await act(async () => {
      surface(tree).props.onPointerDown(e(1, 250, 150))
      surface(tree).props.onPointerDown(e(2, 350, 150, false))
      surface(tree).props.onPointerMove(e(2, 450, 150, false))
    })
    assert.equal(transform(), 'translate(-50px, 0px) scale(2)')
    await act(async () => {
      surface(tree).props.onPointerUp(e(2, 450, 150, false))
      surface(tree).props.onPointerUp(e(1, 250, 150))
    })
    await act(async () => {
      surface(tree).props.onPointerDown(e(1, 200, 150))
      surface(tree).props.onPointerMove(e(1, 100, 150))
      surface(tree).props.onPointerUp(e(1, 100, 150))
    })
    assert.equal(loads, 0, 'pinch or zoomed pan must not download Live motion')
    assert.equal(navigation, 0, 'zoomed pan must not navigate')
    await act(async () => tree.update(React.createElement(Live, {
      still: React.createElement('mounted-live-still'),
      stillReady: true, sourceKey: 'zoom:B', loadMotion: load, ...extra,
    })))
    assert.equal(transform(), 'translate(0px, 0px) scale(1)', 'new source clears prior zoom')
    assert.equal(navigation, 0)
  } finally { if (tree) await act(async () => tree.unmount()) }
})

test('P1 Live owner A→B rejects retained old zoom, hold, swipe and wheel callbacks', async () => {
  let loads = 0, navigation = 0, tree
  const player = makePlayer(() => Promise.resolve())
  const loader = async () => { loads++; return '/motion.mov' }
  const extra = { interactiveImage: true, deferTouchHold: true,
    onSwipeNext: () => navigation++ }
  const event = { ...pointer, pointerId: 1, isPrimary: true,
    clientX: 280, clientY: 150, preventDefault() {},
    currentTarget: { ...pointer.currentTarget,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) } }
  const transform = () => tree.root.find(x => x.type === 'mounted-live-box' &&
    typeof x.props.sx?.transform === 'string').props.sx.transform
  try {
    await act(async () => { tree = mount(player, loader, 'owner:A', extra) })
    const old = surface(tree).props
    await act(async () => tree.update(React.createElement(Live, {
      still: React.createElement('mounted-live-still'),
      stillReady: true, sourceKey: 'owner:B', loadMotion: loader, ...extra,
    })))
    await act(async () => {
      old.onPointerDown(event)
      old.onPointerMove({ ...event, clientX: 100 })
      old.onPointerUp({ ...event, clientX: 100 })
      old.onWheel({ ...event, deltaY: -1 })
      old.onDoubleClick(event)
      old.onKeyDown({ key: 'Enter', repeat: false, preventDefault() {}, stopPropagation() {} })
      old.onPointerCancel(event)
    })
    assert.equal(transform(), 'translate(0px, 0px) scale(1)')
    assert.equal(loads, 0, 'retired A gesture cannot request current Owner B motion')
    assert.equal(navigation, 0, 'retired A gesture cannot navigate current Owner B range')
  } finally { if (tree) await act(async () => tree.unmount()) }
})

test('P1 a second touch aborts an already-pending authorized Live motion ticket', async () => {
  const ticket = deferred()
  let controllerSignal, disposed = 0, loads = 0, tree
  const player = makePlayer(() => Promise.resolve())
  const loader = (_progress, signal) => { loads++; controllerSignal = signal; return ticket.promise }
  const extra = { interactiveImage: true, deferTouchHold: true }
  const event = (id, x, primary = true) => ({
    ...pointer, pointerId: id, isPrimary: primary,
    clientX: x, clientY: 150, preventDefault() {},
    currentTarget: { ...pointer.currentTarget,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
  })
  try {
    await act(async () => { tree = mount(player, loader, 'motion:pending', extra) })
    await act(async () =>
      surface(tree).props.onKeyDown({ key: 'Enter', repeat: false, preventDefault() {}, stopPropagation() {} }))
    assert.equal(loads, 1, 'explicit keyboard hold may request a ticket')
    assert.equal(controllerSignal.aborted, false)
    await act(async () => {
      surface(tree).props.onPointerDown(event(1, 250))
      surface(tree).props.onPointerDown(event(2, 350, false))
    })
    assert.equal(controllerSignal.aborted, true, 'pinch immediately aborts pending motion')
    await act(async () => {
      ticket.resolve({ url: '/stale-motion.mov', dispose() { disposed++ } })
      await flush()
    })
    assert.equal(disposed, 1, 'late motion ticket is released, never adopted')
    assert.equal(loads, 1)
    assert.equal(surface(tree).props['aria-pressed'], false)
  } finally { if (tree) await act(async () => tree.unmount()) }
})

test('P1 Live still unavailable cannot zoom a loading/error placeholder and resets old pan', async () => {
  let loads = 0, tree
  const player = makePlayer(() => Promise.resolve())
  const loader = async () => { loads++; return '/motion.mov' }
  const extra = { interactiveImage: true, deferTouchHold: true }
  const event = (id, x, primary = true) => ({
    ...pointer, pointerId: id, isPrimary: primary, clientX: x, clientY: 150,
    preventDefault() {}, currentTarget: {
      ...pointer.currentTarget,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    },
  })
  const make = ready => React.createElement(Live, {
    still: React.createElement('mounted-live-still'),
    stillReady: ready, sourceKey: 'still:error', loadMotion: loader, ...extra,
  })
  const transform = () => tree.root.find(x => x.type === 'mounted-live-box' &&
    typeof x.props.sx?.transform === 'string').props.sx.transform
  try {
    await act(async () => { tree = renderer.create(make(false), {
      createNodeMock: el => el.type === 'mounted-live-box' && el.props.role === 'button'
        ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
          querySelector: () => ({ naturalWidth: 400, naturalHeight: 300 }) } : null,
    }) })
    await act(async () => {
      surface(tree).props.onWheel({ ...event(1, 250), deltaY: -1 })
      surface(tree).props.onPointerDown(event(1, 250))
      surface(tree).props.onPointerDown(event(2, 350, false))
      surface(tree).props.onPointerMove(event(2, 450, false))
    })
    assert.equal(transform(), 'translate(0px, 0px) scale(1)')
    assert.equal(loads, 0)
    await act(async () => tree.update(make(true)))
    await act(async () => {
      surface(tree).props.onWheel({ ...event(1, 250), deltaY: -1 })
    })
    assert.ok(transform().includes('scale(1.15)'))
    await act(async () => tree.update(make(false)))
    assert.equal(transform(), 'translate(0px, 0px) scale(1)')
    assert.equal(loads, 0, 'decoder loss must not authorize playback')
  } finally { if (tree) await act(async () => tree.unmount()) }
})

test('P1 Live mouse double-click zooms one existing still and never fetches motion', async () => {
  let loads = 0, tree
  const player = makePlayer(() => Promise.resolve())
  const event = {
    clientX: 250, clientY: 150,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    },
  }
  const transform = () => tree.root.find(x => x.type === 'mounted-live-box' &&
    typeof x.props.sx?.transform === 'string').props.sx.transform
  try {
    await act(async () => {
      tree = mount(player, async () => { loads++; return '/motion.mov' }, 'mouse:double', {
        interactiveImage: true, deferTouchHold: true,
      })
    })
    await act(async () => surface(tree).props.onDoubleClick(event))
    assert.equal(transform(), 'translate(-50px, 0px) scale(2)')
    await act(async () => surface(tree).props.onDoubleClick(event))
    assert.equal(transform(), 'translate(0px, 0px) scale(1)')
    assert.equal(loads, 0, 'mouse zoom never requests Live motion')
  } finally { if (tree) await act(async () => tree.unmount()) }
})

test('P1 slow horizontal Live drag never navigates, even when distance exceeds swipe threshold', async () => {
  const originalNow = Date.now
  let now = 1000, navigation = 0, loads = 0, tree
  Date.now = () => now
  const player = makePlayer(() => Promise.resolve())
  const event = x => ({
    ...pointer, pointerId: 1, isPrimary: true,
    clientX: x, clientY: 150, preventDefault() {},
    currentTarget: {
      ...pointer.currentTarget,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    },
  })
  try {
    await act(async () => {
      tree = mount(player, async () => { loads++; return '/motion.mov' }, 'slow:drag', {
        interactiveImage: true, deferTouchHold: true,
        onSwipeNext: () => navigation++,
      })
    })
    await act(async () => surface(tree).props.onPointerDown(event(300)))
    now += 800
    await act(async () => {
      surface(tree).props.onPointerMove(event(100))
      surface(tree).props.onPointerUp(event(100))
    })
    assert.equal(navigation, 0, 'slow drag is pan/interaction, never a photo swipe')
    assert.equal(loads, 0, 'slow drag is not a motion hold')
  } finally {
    if (tree) await act(async () => tree.unmount())
    Date.now = originalNow
  }
})

test('P1 Live decoding ready later refreshes actual portrait pan bounds', async () => {
  let decoded = false, loads = 0, tree
  const node = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    querySelector: () => decoded ? { naturalWidth: 100, naturalHeight: 300 } : null,
    setPointerCapture() {}, hasPointerCapture() { return false }, releasePointerCapture() {},
  }
  const extra = { interactiveImage: true, deferTouchHold: true }
  const render = stillReady => React.createElement(Live, {
    still: React.createElement('mounted-live-still'), stillReady,
    loadMotion: async () => { loads++; return '/motion.mov' },
    sourceKey: 'portrait:ready', ...extra,
  })
  const gesture = (x, y) => ({
    ...pointer, pointerId: 1, isPrimary: true, clientX: x, clientY: y,
    preventDefault() {}, currentTarget: node,
  })
  const transform = () => tree.root.find(x => x.type === 'mounted-live-box' &&
    typeof x.props.sx?.transform === 'string').props.sx.transform
  try {
    await act(async () => {
      tree = renderer.create(render(false), {
        createNodeMock: el => el.type === 'mounted-live-box' &&
          el.props.role === 'button' ? node : null,
      })
    })
    decoded = true
    await act(async () => tree.update(render(true)))
    await act(async () => surface(tree).props.onDoubleClick(gesture(200, 150)))
    assert.equal(transform(), 'translate(0px, 0px) scale(2)')
    await act(async () => {
      surface(tree).props.onPointerDown(gesture(200, 150))
      surface(tree).props.onPointerMove(gesture(2200, 2150))
      surface(tree).props.onPointerUp(gesture(2200, 2150))
    })
    assert.equal(transform(), 'translate(0px, 150px) scale(2)',
      'decoded portrait contain-fit clamp prevents phantom horizontal pan')
    assert.equal(loads, 0, 'reclamping decoded still must not reload motion')
  } finally { if (tree) await act(async () => tree.unmount()) }
})


test('P0 terminal Live decoder rejection releases failed Blob immediately and only once', async () => {
  const originalRevoke = URL.revokeObjectURL
  const revoked = []
  URL.revokeObjectURL = (url) => revoked.push(url)
  const player = makePlayer(() => Promise.reject(new Error('unsupported codec')))
  let loads = 0
  let tree
  try {
    await act(async () => {
      tree = mount(player, async () => { loads++; return 'blob:terminal-live-broken' }, 'terminal:codec')
      await flush()
    })
    await act(async () => { press(tree); await flush() })
    assert.equal(loads, 1)
    assert.equal(label(tree), '实况不可用')
    assert.equal(video(tree), undefined, 'failed video must not retain its src')
    assert.equal(player.removedSource, 1, 'detach failed native Range synchronously')
    assert.equal(player.resetLoads, 1)
    assert.deepEqual(revoked, ['blob:terminal-live-broken'])
    assert.equal(tree.root.findAll(x => x.type === 'mounted-live-still').length, 1,
      'still stays visible after terminal motion failure')
    await act(async () => { press(tree); await flush() })
    assert.equal(loads, 1, 'terminal codec failure is not retried without a fresh source')
    await act(async () => tree.unmount())
    tree = null
    assert.deepEqual(revoked, ['blob:terminal-live-broken'],
      'unmount cannot revoke an already-disposed motion source twice')
  } finally {
    if (tree) await act(async () => tree.unmount())
    URL.revokeObjectURL = originalRevoke
  }
})

test('P0 terminal held Live HTTP media error tears down source once; stale error cannot poison replacement', async () => {
  const player = makePlayer(() => Promise.resolve())
  let disposed = 0
  const oldMotion = async () => ({ url: 'https://example.invalid/private-owner-motion.mov',
    dispose: () => { disposed++ } })
  const nextMotion = async () => 'https://example.invalid/next-owner-motion.mov'
  const element = (key, loadMotion) => React.createElement(Live, {
    still: React.createElement('mounted-live-still'), stillReady: true,
    sourceKey: key, loadMotion,
  })
  let tree
  try {
    await act(async () => {
      tree = mount(player, oldMotion, 'terminal:old')
      await flush()
    })
    await act(async () => { press(tree); await flush() })
    const oldError = video(tree).props.onError
    await act(async () => { oldError({ currentTarget: player }); await flush() })
    assert.equal(disposed, 1)
    assert.equal(player.removedSource, 1)
    assert.equal(player.resetLoads, 1)
    assert.equal(video(tree), undefined, 'private failed video stream is detached')
    assert.equal(label(tree), '实况不可用')
    assert.equal(tree.root.findAll(x => x.type === 'mounted-live-still').length, 1)
    await act(async () => { tree.update(element('terminal:next', nextMotion)); await flush() })
    await act(async () => { press(tree); await flush() })
    assert.equal(video(tree).props.src, 'https://example.invalid/next-owner-motion.mov')
    await act(async () => { oldError({ currentTarget: player }); await flush() })
    assert.equal(video(tree).props.src, 'https://example.invalid/next-owner-motion.mov',
      'prior Owner failure must not tear down new motion')
    await act(async () => tree.unmount())
    tree = null
    assert.equal(disposed, 1, 'source change and unmount cannot dispose failed motion twice')
  } finally {
    if (tree) await act(async () => tree.unmount())
  }
})


test('P0 Live Viewer source switch and Close detach signed Range before disposing motion', async () => {
  const player = makePlayer(() => Promise.resolve())
  let oldDisposed = 0
  let nextDisposed = 0
  const oldMotion = async () => ({
    url: 'https://example.invalid/current-owner-motion.mov',
    dispose: () => { oldDisposed++ },
  })
  const newMotion = async () => ({
    url: 'https://example.invalid/next-owner-motion.mov',
    dispose: () => { nextDisposed++ },
  })
  const element = (key, loader) => React.createElement(Live, {
    still: React.createElement('mounted-live-still'), stillReady: true,
    sourceKey: key, loadMotion: loader,
  })
  let tree
  try {
    await act(async () => {
      tree = mount(player, oldMotion, 'source-owner:1')
      await flush()
    })
    await act(async () => { press(tree); await flush() })
    assert.equal(video(tree).props.src, 'https://example.invalid/current-owner-motion.mov')
    assert.equal(player.removedSource, 0)
    await act(async () => { tree.update(element('source-owner:2', newMotion)); await flush() })
    assert.equal(player.removedSource, 1,
      'source replacement must synchronously detach the old video Range')
    assert.equal(player.resetLoads, 1)
    assert.equal(oldDisposed, 1, 'previous source must release its one-shot proxy lease')
    assert.equal(video(tree), undefined, 'new source must wait for explicit next hold')
    await act(async () => { press(tree); await flush() })
    assert.equal(video(tree).props.src, 'https://example.invalid/next-owner-motion.mov')
    await act(async () => tree.unmount())
    tree = null
    assert.equal(player.removedSource, 2,
      'Viewer close must detach the next video without retaining a Range')
    assert.equal(player.resetLoads, 2)
    assert.equal(oldDisposed, 1)
    assert.equal(nextDisposed, 1)
  } finally {
    if (tree) await act(async () => tree.unmount())
  }
})
