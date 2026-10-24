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
  "import { useCallback, useEffect, useRef, useState } from 'react'",
  "import { Box, Chip, CircularProgress, XDriveLivePhotoGlyph, XDriveMediaLoadingProgress } from './fixture'",
  'type XDriveLivePhotoMotionSource = string | { url: string; dispose?: () => void }',
  'type XDriveByteProgressHandler = (loaded: number, total?: number) => void',
  'type XDriveLivePhotoMotionLoader = (progress?: XDriveByteProgressHandler, signal?: AbortSignal) => Promise<XDriveLivePhotoMotionSource | null>',
  'type XDriveLivePhotoSurfaceProps = { still: any; stillReady?: boolean; loadMotion?: XDriveLivePhotoMotionLoader; sourceKey?: string | number; label?: string }',
  'type PointerEvent<T> = any; type KeyboardEvent<T> = any',
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
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  './fixture': {
    Box: 'mounted-live-box',
    Chip: 'mounted-live-chip',
    CircularProgress: 'mounted-live-circular-progress',
    XDriveLivePhotoGlyph: 'mounted-live-glyph',
    XDriveMediaLoadingProgress: 'mounted-live-progress',
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
  currentTime: 0,
  volume: 0,
  readyState: 3,
  pause() { this.pauseCalls++ },
})
const mount = (player, loadMotion, sourceKey = 'node:1') =>
  renderer.create(React.createElement(Live, {
    still: React.createElement('mounted-live-still', { 'data-still': true }),
    stillReady: true,
    sourceKey,
    loadMotion,
  }), {
    createNodeMock: element =>
      element.type === 'mounted-live-box' && element.props.component === 'video'
        ? player : null,
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
  assert.equal(video(failedTree).props.sx.opacity, 0)
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
  assert.equal(video(tree).props.sx.opacity, 0, 'static still remains visible')
  await act(async () => { tree.unmount() })
})

test('P0-L7 still readiness loss immediately hides motion and stops playback without auto-restart', async () => {
  let plays = 0
  const player = makePlayer(() => { plays++; return Promise.resolve() })
  const loader = async () => 'https://example.invalid/live.mov'
  const element = stillReady => React.createElement(Live, {
    still: React.createElement('mounted-live-still'), stillReady,
    sourceKey: 'still:90', loadMotion: loader,
  })
  let tree
  await act(async () => {
    tree = renderer.create(element(true), {
      createNodeMock: entry =>
        entry.type === 'mounted-live-box' && entry.props.component === 'video'
          ? player : null,
    })
    await flush()
  })
  await act(async () => { press(tree); await flush() })
  assert.equal(video(tree).props.sx.opacity, 1)
  const pauseBefore = player.pauseCalls
  await act(async () => { tree.update(element(false)); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0, 'a gray/failed still must not keep showing motion')
  assert.equal(video(tree).props.preload, 'none')
  assert.equal(surface(tree).props['aria-disabled'], true)
  assert.ok(player.pauseCalls > pauseBefore, 'losing still must stop video and audio')
  const previousPlays = plays
  await act(async () => { press(tree); await flush() })
  assert.equal(plays, previousPlays, 'disabled still does not load motion')
  await act(async () => { tree.update(element(true)); await flush() })
  assert.equal(video(tree).props.sx.opacity, 0, 'still recovery must not autoplay')
  assert.equal(plays, previousPlays)
  await act(async () => { press(tree); await flush() })
  assert.equal(plays, previousPlays + 1, 'new intentional hold resumes cached motion')
  await act(async () => { release(tree); tree.unmount() })
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
  assert.equal(video(tree).props.sx.opacity, 0)
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
