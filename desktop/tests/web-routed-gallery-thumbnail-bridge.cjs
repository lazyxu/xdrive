'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const helper = path.join(repo, 'web/src/routedGalleryThumbnailBridge.ts')
const source = fs.readFileSync(helper, 'utf8')
const transpiled = ts.transpileModule(source, {
  fileName: helper,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', transpiled)(mod.exports, mod, require)
const { XDriveRoutedGalleryThumbnailBridge } = mod.exports

test('Gallery route can borrow only its active context and verified revision', () => {
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  const reads = []
  const registered = bridge.register((node, revision) => {
    reads.push([node, revision])
    return { url: 'blob:owned-current-revision', release: () => undefined }
  })
  assert.equal(bridge.borrow('context-A', 8, 2), null, 'direct URL cannot borrow')
  bridge.activate('context-A')
  for (const [context, node, revision] of [
    ['context-B', 8, 2], [undefined, 8, 2], ['context-A', 0, 2],
    ['context-A', 8, 0], ['context-A', 8, Number.NaN],
  ]) assert.equal(bridge.borrow(context, node, revision), null)
  assert.deepEqual(reads, [], 'invalid accesses must not inspect Gallery cache')
  const borrowed = bridge.borrow('context-A', 8, 2)
  assert.equal(borrowed?.url, 'blob:owned-current-revision')
  assert.deepEqual(reads, [[8, 2]])
  registered()
  assert.equal(bridge.borrow('context-A', 8, 2), null, 'unmounted Gallery cannot lend URLs')
})

test('stale Gallery cleanup cannot unregister the current mounted Gallery', () => {
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  const oldCleanup = bridge.register(() => ({ url: 'blob:old', release: () => {} }))
  const newCleanup = bridge.register(() => ({ url: 'blob:new', release: () => {} }))
  bridge.activate('context-C')
  oldCleanup()
  assert.equal(bridge.borrow('context-C', 55, 9)?.url, 'blob:new')
  newCleanup()
  assert.equal(bridge.borrow('context-C', 55, 9), null)
})

test('route exit, another session and a different Owner bridge have no inherited borrowing', () => {
  const ownerA = new XDriveRoutedGalleryThumbnailBridge()
  const ownerB = new XDriveRoutedGalleryThumbnailBridge()
  const releaseA = ownerA.register(() => ({ url: 'blob:private-A', release: () => {} }))
  ownerA.activate('same-browser-hash')
  assert.equal(ownerA.borrow('same-browser-hash', 10, 3)?.url, 'blob:private-A')
  assert.equal(ownerB.borrow('same-browser-hash', 10, 3), null,
    'new API/Owner scope cannot reuse old Gallery registration')
  ownerA.leave()
  assert.equal(ownerA.borrow('same-browser-hash', 10, 3), null,
    'Back or app switch invalidates the old hash admission')
  ownerA.activate('next-gallery-context')
  assert.equal(ownerA.borrow('same-browser-hash', 10, 3), null)
  assert.equal(ownerA.borrow('next-gallery-context', 10, 3)?.url, 'blob:private-A')
  releaseA()
})

test('routed Viewer borrows the actual warm Gallery scheduler without a second media GET', async () => {
  const filename = path.join(repo, 'ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiled = { exports: {} }
  new Function('exports', 'module', 'require', output)(
    compiled.exports, compiled,
    name => name === './ViewerForegroundPriority' ? require('./viewer-foreground-priority-test-loader.cjs') : require(name))
  const { XDriveMediaThumbnailScheduler } = compiled.exports
  const revoked = []
  let requests = 0
  const scheduler = new XDriveMediaThumbnailScheduler(async (nodeID) => {
    requests++
    return `blob:gallery-${nodeID}-${requests}`
  }, { maxCacheEntries: 1, revokeURL: value => revoked.push(value) })
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  const unmount = bridge.register(
    (nodeID, revision) => scheduler.borrowCachedForViewer(nodeID, revision))
  const cached = await scheduler.load(75, 0, 5)
  assert.equal(requests, 1)
  bridge.activate('real-gallery-session')
  const lease = bridge.borrow('real-gallery-session', 75, 5)
  assert.equal(lease?.url, cached)
  assert.equal(requests, 1, 'the routed Viewer does not refetch a visible warmed tile')
  assert.equal(bridge.borrow('other-context', 75, 5), null)
  assert.equal(bridge.borrow('real-gallery-session', 75, 6), null)
  await scheduler.load(76, 0, 5)
  assert.deepEqual(revoked, [], 'LRU eviction preserves a still-open route lease')
  bridge.leave()
  assert.equal(bridge.borrow('real-gallery-session', 75, 5), null)
  lease.release()
  assert.deepEqual(revoked, [cached], 'route exit may retire old Blob only after Viewer releases it')
  unmount()
  scheduler.dispose()
  assert.deepEqual(revoked, [cached, 'blob:gallery-76-2'])
})

test('actual Gallery/App/routed Viewer handoff uses only a transient cache borrow', () => {
  const gallery = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const app = fs.readFileSync(path.join(repo, 'web/src/App.tsx'), 'utf8')
  const routed = fs.readFileSync(path.join(repo, 'web/src/WebFileViewerApps.tsx'), 'utf8')
  assert.match(gallery, /onRegisterViewerThumbnailCache/)
  assert.match(gallery, /thumbnailScheduler\.borrowCachedForViewer\(nodeID, revision\)/)
  assert.match(app, /galleryThumbnailBridge\.activate\(contextID\)/)
  assert.match(app, /onRegisterViewerThumbnailCache=\{galleryThumbnailBridge\.register\}/)
  assert.match(app, /onBorrowGalleryThumbnail=\{galleryThumbnailBridge\.borrow\}/)
  assert.match(app, /useEffect\(\(\) => \(\) => galleryThumbnailBridge\.leave\(\), \[galleryThumbnailBridge\]\)/,
    'old Owner API scopes revoke their route admission on replacement')
  assert.match(routed, /onBorrowGalleryThumbnail\?\.\(route\.params\.context, nodeID, revision\)/)
  assert.match(routed, /lease\.release\(\)/)
  assert.match(routed, /return gallerySource\.loadThumbnail\(nodeID, signal, revision, onProgress\)/,
    'a cold or standalone media route keeps original authenticated thumbnail path')
  assert.doesNotMatch(source, /sessionStorage\.|localStorage\.|indexedDB\.|window\./,
    'the bridge must never expose or persist private media URLs/bytes')
})

test('routed Viewer uses authorized fallback when an optional Gallery scheduler borrow throws', () => {
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  bridge.register(() => { throw Error('SecurityError: stale WebKit Blob lease') })
  bridge.activate('active-owner-gallery')
  assert.doesNotThrow(() => bridge.borrow('active-owner-gallery', 22, 4))
  assert.equal(bridge.borrow('active-owner-gallery', 22, 4), null)
  const unregister = bridge.register(() => ({ url: 'blob:recovered', release() {} }))
  assert.equal(bridge.borrow('active-owner-gallery', 22, 4)?.url, 'blob:recovered')
  unregister()
})

test('routed Viewer rejects non-Blob or malformed leases without publishing a foreign URL', () => {
  for (const value of ['', 'https://other.example/private.jpg', 'data:image/png;base64,AA', 17]) {
    const bridge = new XDriveRoutedGalleryThumbnailBridge()
    let releases = 0
    bridge.register(() => ({ url: value, release() { releases++ } }))
    bridge.activate('owner-gallery')
    assert.equal(bridge.borrow('owner-gallery', 19, 2), null)
    assert.equal(releases, 1, 'invalid lease must release exactly once')
  }
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  bridge.register(() => ({ url: 'blob:no-release', release: null }))
  bridge.activate('owner-gallery')
  assert.equal(bridge.borrow('owner-gallery', 19, 2), null)
})

test('Gallery synchronous route exit cannot return a stale borrowed Blob to Viewer', () => {
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  let releases = 0
  bridge.register(() => {
    bridge.leave()
    return { url: 'blob:revoked-session', release() { releases++ } }
  })
  bridge.activate('old-gallery')
  assert.equal(bridge.borrow('old-gallery', 20, 3), null)
  assert.equal(releases, 1)
  assert.equal(bridge.borrow('old-gallery', 20, 3), null)
})

test('new Gallery registration owns the bridge even when old borrower switches it mid-call', () => {
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  let oldReleases = 0
  bridge.register(() => {
    bridge.register(() => ({ url: 'blob:new-owner-mounted', release() {} }))
    return { url: 'blob:old-unmounted', release() { oldReleases++ } }
  })
  bridge.activate('route-owner')
  assert.equal(bridge.borrow('route-owner', 21, 5), null,
    'an old synchronous borrower may not publish after replacement')
  assert.equal(oldReleases, 1)
  assert.equal(bridge.borrow('route-owner', 21, 5)?.url, 'blob:new-owner-mounted')
})

test('a lease-release exception does not mask the original Owner-authenticated fallback', () => {
  const bridge = new XDriveRoutedGalleryThumbnailBridge()
  bridge.register(() => ({ url: 'https://invalid.example/opaque',
    release() { throw Error('Safari ObjectURL release rejected') } }))
  bridge.activate('owner-route')
  assert.doesNotThrow(() => bridge.borrow('owner-route', 1, 1))
  assert.equal(bridge.borrow('owner-route', 1, 1), null)
})
