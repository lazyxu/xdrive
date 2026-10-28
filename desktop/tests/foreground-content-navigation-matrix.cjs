'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const transpile = (file) => ts.transpileModule(source(file), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function load(file, requireFn = require) {
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', transpile(file))(mod.exports, mod, requireFn)
  return mod.exports
}
const bus = load('ui/shared/src/mui/ViewerForegroundPriority.ts')
const gallery = load('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts',
  name => name === './ViewerForegroundPriority' ? bus : require(name))
const webApps = load('web/src/webApps.ts')
const hostRoutes = load('ui/shared/src/mui/WorkspaceRoute.ts')
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}
function newScheduler(loader, extra = {}) {
  return new gallery.XDriveMediaThumbnailScheduler(loader,
    { concurrency: 2, ...extra })
}

test('all registered Web and Desktop/DSM route pairs abandon previous disposable readers', () => {
  const webRoutes = [...Object.keys(webApps.XDRIVE_WEB_APPS), 'public-share', 'offline']
  const host = [...hostRoutes.XDRIVE_APP_WORKSPACE_ROUTES]
  assert.ok(webRoutes.includes('files') && webRoutes.includes('gallery'))
  assert.ok(host.includes('admin-services') && host.includes('diagnostics'))
  assert.ok(webRoutes.includes('pdf-viewer') && webRoutes.includes('media-viewer'))
  for (const [platform, routes] of [
    ['web', webRoutes],
    ['desktop', host],
    ['synology', host],
  ]) {
    for (const previous of routes) {
      for (const next of routes) {
        const first = platform + ':' + previous
        const second = platform + ':' + next
        bus.xDriveEnterForegroundPage(null)
        bus.xDriveEnterForegroundPage(first)
        const oldStates = [], newStates = []
        const stopOld = bus.xDriveObserveViewerForeground(active => oldStates.push(active))
        try {
          bus.xDriveEnterForegroundPage(second)
          const stopNew = bus.xDriveObserveViewerForeground(active => newStates.push(active))
          try {
            assert.equal(oldStates.at(-1), first !== second,
              platform + ' ' + previous + ' -> ' + next + ' must preserve same-page reads only')
            assert.equal(newStates.at(-1), false, 'new visible page may issue its reads')
          } finally { stopNew() }
        } finally { stopOld() }
      }
    }
  }
  bus.xDriveEnterForegroundPage(null)
})

test('same-type directory and album content changes cancel pending thumbnails before next range', async () => {
  for (const [page, kind] of [
    ['web:files', 'files'], ['desktop:files', 'files'],
    ['synology:files', 'files'], ['web:gallery', 'gallery'],
    ['desktop:gallery', 'gallery'], ['synology:gallery', 'gallery'],
    ['desktop:gallery', ['gallery', 'map']], // Maps is a Gallery section, not another Host route
  ]) {
    bus.xDriveEnterForegroundPage(null)
    bus.xDriveEnterForegroundPage(page)
    const oldGate = deferred()
    const newGate = deferred()
    const revoked = []
    const signals = new Map()
    const scheduler = newScheduler((id, scopedSignal) => {
      signals.set(id, scopedSignal)
      return id === 10 ? oldGate.promise : newGate.promise
    }, { revokeURL: url => revoked.push(url) })
    try {
      const old = scheduler.load(10, 1, 1)
      await tick()
      assert.equal(signals.get(10).aborted, false)
      const finish = bus.xDriveBeginForegroundContentTransition(kind)
      assert.equal(bus.xDriveCurrentForegroundPage(), page,
        'new folder or album must NOT masquerade as a different app route')
      assert.equal(await old, null, 'old thumbnail resolves as cancelled')
      assert.equal(signals.get(10).aborted, true, 'old transport receives AbortSignal')
      assert.equal(await scheduler.load(11, 1, 1), null,
        'old mounted content cannot silently requeue during pending first Range')
      finish()
      finish()
      const incoming = scheduler.load(12, 1, 1)
      await tick()
      assert.equal(signals.get(12).aborted, false, 'new accepted content resumes')
      oldGate.resolve('blob:late-aborted')
      await tick()
      assert.ok(revoked.includes('blob:late-aborted'),
        'canceled old response is never installed in a visible thumbnail')
      newGate.resolve('blob:incoming')
      assert.equal(await incoming, 'blob:incoming')
      assert.ok(!revoked.includes('blob:incoming'), 'current image must remain usable')
    } finally {
      oldGate.resolve(null)
      newGate.resolve(null)
      scheduler.dispose()
      bus.xDriveEnterForegroundPage(null)
    }
  }
})

test('failed same-page navigation resumes old content; nested and stale completion cannot unpause successor', () => {
  bus.xDriveEnterForegroundPage(null)
  bus.xDriveEnterForegroundPage('web:files')
  const oldStates = []
  const stopOld = bus.xDriveObserveViewerForeground(active => oldStates.push(active))
  try {
    const first = bus.xDriveBeginForegroundContentTransition('files') // folder A -> B
    const next = bus.xDriveBeginForegroundContentTransition('files') // B -> C before B completes
    assert.equal(oldStates.at(-1), true)
    first()
    assert.equal(oldStates.at(-1), true, 'B failure may not resume work while C is pending')
    next()
    assert.equal(oldStates.at(-1), false, 'C failure or commit restores admitted Files')
    const hung = bus.xDriveBeginForegroundContentTransition('files')
    const accepted = bus.xDriveBeginForegroundContentTransition('files')
    accepted()
    assert.equal(oldStates.at(-1), false,
      'new Folder C completion must resume even when superseded B never settles')
    hung()
    assert.equal(oldStates.at(-1), false, 'stale hung B release cannot alter current content')
    const mismatch = bus.xDriveBeginForegroundContentTransition('gallery')
    assert.equal(oldStates.at(-1), false, 'background Gallery cannot pause active Files')
    mismatch()
    const previous = bus.xDriveBeginForegroundContentTransition('files')
    bus.xDriveEnterForegroundPage('web:gallery')
    const currentStates = []
    const stopCurrent = bus.xDriveObserveViewerForeground(active => currentStates.push(active))
    try {
      previous() // obsolete /files request now finishes late
      assert.equal(currentStates.at(-1), false, 'old folder finally cannot suspend Gallery')
      assert.equal(oldStates.at(-1), true, 'old page stays suspended')
    } finally { stopCurrent() }
  } finally {
    stopOld()
    bus.xDriveEnterForegroundPage(null)
  }
})

test('pending Memories/Cleanup index cannot keep a later accepted photo wall paused', () => {
  bus.xDriveEnterForegroundPage(null)
  bus.xDriveEnterForegroundPage('web:gallery')
  const states = []
  const stop = bus.xDriveObserveViewerForeground(value => states.push(value))
  try {
    const index = bus.xDriveBeginForegroundContentTransition(['gallery', 'map'])
    assert.equal(bus.xDriveForegroundContentTransitionPending('gallery'), true)
    assert.equal(states.at(-1), true)
    // The index renderer can clear collectionTargetRef to null while its GET
    // is still unresolved. The photo wall must take new latest-wins ownership.
    const photo = bus.xDriveBeginForegroundContentTransition(['gallery', 'map'])
    photo()
    assert.equal(bus.xDriveForegroundContentTransitionPending('gallery'), false)
    assert.equal(states.at(-1), false, 'new accepted Album A resumes without waiting for hung index')
    index() // old promise finally arrives late
    assert.equal(states.at(-1), false, 'old index completion cannot suspend current photo wall')
    assert.equal(bus.xDriveForegroundContentTransitionPending('gallery'), false)
  } finally {
    stop()
    bus.xDriveEnterForegroundPage(null)
  }
})

test('Viewer leases retain stronger priority over successful folder navigation and Blob cache', async () => {
  bus.xDriveEnterForegroundPage(null)
  bus.xDriveEnterForegroundPage('web:gallery')
  const old = deferred()
  const newer = deferred()
  const signals = []
  const scheduler = newScheduler((id, signal) => {
    signals.push({ id, signal })
    return id === 1 ? old.promise : newer.promise
  })
  const durableUpload = new AbortController()
  const durableDownload = new AbortController()
  const durableBackup = new AbortController()
  const durableSync = new AbortController()
  try {
    const warm = scheduler.load(1, 1, 1)
    old.resolve('blob:warm')
    assert.equal(await warm, 'blob:warm')
    const lease = scheduler.borrowCachedForViewer(1, 1)
    assert.equal(lease?.url, 'blob:warm')
    const viewerClose = bus.xDriveAcquireViewerForeground({})
    const finishAlbum = bus.xDriveBeginForegroundContentTransition('gallery')
    finishAlbum()
    assert.equal(await scheduler.load(2, 1, 1), null,
      'Album may finish but its covered background cannot outrun active Viewer')
    viewerClose()
    const restored = scheduler.load(2, 1, 1)
    await tick()
    assert.equal(signals.at(-1)?.signal.aborted, false)
    newer.resolve('blob:restored')
    assert.equal(await restored, 'blob:restored')
    assert.equal(lease.url, 'blob:warm', 'borrowed cached Blob stays alive')
    lease.release()
    for (const controller of [durableUpload, durableDownload, durableBackup, durableSync]) {
      assert.equal(controller.signal.aborted, false,
        'render-only navigation must not send durable cancellation')
    }
  } finally {
    old.resolve(null)
    newer.resolve(null)
    scheduler.dispose()
    bus.xDriveEnterForegroundPage(null)
  }
})

test('all same-type content entry points are wired to disposable-only preemption', () => {
  const files = source('ui/shared/src/mui/CloudFilesController.ts')
  const mobile = source('web/src/MobileFiles.tsx')
  const wide = source('ui/shared/src/mui/FileExplorer.tsx')
  const galleryCode = source('ui/shared/src/mui/MediaGallery.tsx')
  const virtual = source('ui/shared/src/mui/VirtualCollectionController.ts')
  const publicShare = source('web/src/PublicShare.tsx')
  const webRuntime = source('web/src/webAppRuntime.ts')
  const desktopApp = source('desktop/src/renderer/App.tsx')
  const synology = source('web/src/synology.tsx')
  assert.match(files, /previous\.parentID !== id/, 'folder A -> B')
  assert.match(files, /previous\.sort\.key !== effectiveSort\.key/, 'file sort')
  assert.match(files, /xDriveFileExplorerGroupingSignature\(previous\.grouping\)/, 'grouping')
  assert.match(files, /startDirectoryFirstPage\(\)/, 'prior first GET is aborted')
  assert.match(files, /finishContentTransition\(\)/, 'rejection restores previous content')
  assert.match(mobile, /thumbnailContentScope/, 'mobile directory/search cache scope')
  assert.match(mobile, /props\.trashActive \? 'trash'/)
  assert.match(wide, /virtualCollection\?\.interactionKey \?\? derivedPath/,
    'wide Files already changes its thumbnail cache when accepted query changes')
  assert.match(galleryCode, /mediaGalleryContentKey\(previousContent\) !== nextContentKey/,
    'album/filter/collection content')
  assert.match(galleryCode, /pendingContentKey !== null && pendingContentKey !== nextContentKey/,
    'returning to the accepted album must supersede an uncooperative pending album')
  assert.match(galleryCode, /pendingFirstContentKeyRef\.current = nextContentKey/,
    'each new Gallery target takes latest-wins content ownership')
  assert.match(galleryCode, /xDriveForegroundContentTransitionPending\(\['gallery', 'map'\]\)/,
    'a stuck Memories or Cleanup index cannot suppress a later accepted Gallery target')
  assert.match(galleryCode, /const finishContentTransition = collectionTargetRef\.current \|\|/,
    'index-to-index navigation must supersede an earlier pending index')
  assert.match(galleryCode, /xDriveBeginForegroundContentTransition\(\['gallery', 'map'\]\)/,
    'both map modes and Gallery share the content lease')
  assert.match(galleryCode, /kind:'baidu-cell'/, 'map cell range')
  assert.match(galleryCode, /kind:'baidu-viewport'/, 'map viewport range')
  assert.match(galleryCode, /nativeCellOpenAbort\.current\?\.abort\(\)/)
  assert.match(galleryCode, /firstContentRangeAbort\.current\?\.abort\(\)/,
    'new Gallery first Range aborts old Album/People/Map/Trash first Range')
  for (const call of [
    'listTrashItemRange(limit, offset, signal)',
    'listAlbumItemRange(target.id, limit, offset, rangedQuery, signal)',
    'listPersonItemRange(target.id, limit, offset, target.query, signal)',
    'listDuplicateItemRange(target.id, limit, offset, signal)',
    'listBurstReviewItemRange(target.id, limit, offset, signal)',
    'listPetItemRange(target.id, limit, offset, signal)',
    'listSuggestedPersonItemRange(target.id, limit, offset, target.query, signal)',
  ]) {
    assert.ok(galleryCode.includes(call), 'every disposable Gallery virtual Range must forward AbortSignal: ' + call)
  }
  assert.match(virtual, /abortInFlight\(\)/, 'superseded 100k sparse ranges')
  assert.match(publicShare, /for \(const request of activeThumbnailRequests\.current\) request\.abort\(\)/,
    'Share folder and cursor navigation cancels obsolete disposable JPEGs')
  assert.match(publicShare, /if \(contentChanged\) setThumbnailVisibilityEpoch\(epoch => epoch \+ 1\)/,
    'failed Share folder navigation restores retry for still-visible old rows')
  assert.match(publicShare, /await shareFileAdapter\.list\(path\.at\(-1\)\?\.id \?\? 0, cursor, controller\.signal\)/,
    'Share first page and cursor reads are cancelable independently of downloads')
  assert.match(webRuntime, /guardBrowserNavigation/, 'unaccepted dirty draft must not preempt')
  assert.match(desktopApp, /xDriveEnterForegroundPage\('desktop:' \+ next\)/)
  assert.match(synology, /xDriveEnterForegroundPage\('synology:' \+ next\)/)
  const coordinator = source('ui/shared/src/mui/ViewerForegroundPriority.ts')
  assert.doesNotMatch(coordinator,
    /cancelTransfer|cancelBackup|terminateWorker|abortAll|cancelUpload|cancelDownload/,
    'durable jobs and independent browser windows are outside renderer read priority')
})
