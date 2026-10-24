'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const repo = path.resolve(__dirname, '../..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const compile = (text, name) => ts.transpileModule(text, {
  fileName: name,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function loadModule(js, customRequire = require) {
  const module = { exports: {} }
  new Function('exports', 'module', 'require', js)(module.exports, module, customRequire)
  return module.exports
}
const scheduler = loadModule(compile(read('ui', 'shared', 'src', 'mui', 'MediaGalleryThumbnailScheduler.ts'), 'Scheduler.ts'))
const { XDriveMediaGalleryCoverThumbnailPool: Pool } = loadModule(
  compile(read('ui', 'shared', 'src', 'mui', 'MediaGalleryCoverThumbnailPool.ts'), 'CoverPool.ts'),
  (name) => name === './MediaGalleryThumbnailScheduler' ? scheduler : require(name),
)
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

test('P0-L16 production cover Scheduler: real image error arms only next-visible bypass', async () => {
  const calls = []
  const revoked = []
  const cover = new Pool(async (id, signal, revision, _progress, bypass) => {
    calls.push({ id, signal, revision, bypass })
    return 'blob:cover:' + id + ':' + revision + ':' + calls.length
  }, (url) => revoked.push(url))
  const release = cover.retain(71)
  const first = await cover.load(71)
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].revision, undefined)
  assert.equal(calls[0].bypass, undefined)
  assert.equal(cover.invalidateDecodedURL(71, 9, first), false)
  assert.equal(cover.invalidateDecodedURL(72, undefined, first), false)
  assert.equal(cover.invalidateDecodedURL(71, undefined, first), true)
  assert.deepEqual(revoked, [first])
  await flush()
  assert.equal(calls.length, 1, 'onError itself must make zero requests')
  const second = await cover.load(71)
  assert.equal(calls[1].bypass, true, 'one next-visible no-store on same Node')
  assert.equal(cover.invalidateDecodedURL(71, undefined, second), true)
  assert.equal(await cover.load(71), null, 'second decode failure is terminal')
  assert.equal(calls.length, 2)
  release()
  cover.dispose()
})

test('P0-L16 duplicate consumers keep shared Node request until last visible release', async () => {
  const requests = []
  const cover = new Pool((_id, signal) => new Promise((resolve) => {
    requests.push({ signal, resolve })
  }), () => undefined)
  const releaseA = cover.retain(17)
  const releaseB = cover.retain(17)
  const releaseOther = cover.retain(18)
  const first = cover.load(17)
  const other = cover.load(18)
  await flush()
  assert.equal(requests.length, 2)
  releaseA()
  await flush()
  assert.equal(requests[0].signal.aborted, false)
  releaseB()
  await flush()
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].signal.aborted, false)
  assert.equal(await first, null)
  requests[0].resolve(null)
  requests[1].resolve('blob:other')
  assert.equal(await other, 'blob:other')
  releaseOther()
  cover.dispose()
})

test('P0-L16 sibling mount effects coalesce before viewport cancellation', async () => {
  const calls = []
  const cover = new Pool(async (id) => {
    calls.push(id)
    return 'blob:cover:' + id
  }, () => undefined)
  const a = cover.load(11)
  const b = cover.load(12)
  const releaseA = cover.retain(11)
  const releaseB = cover.retain(12)
  await flush()
  assert.equal(await a, 'blob:cover:11')
  assert.equal(await b, 'blob:cover:12')
  assert.deepEqual(calls.sort((l, r) => l - r), [11, 12])
  releaseA()
  releaseB()
  cover.dispose()
})

test('P0-L16 shared Gallery covers use one provider, same Web/Mobile backend and virtualization', () => {
  const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
  const covers = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCoverThumbnail.tsx')
  const web = read('web', 'src', 'mediaGalleryAdapter.ts')
  const desktop = read('desktop', 'src', 'renderer', 'mediaGalleryAdapter.ts')
  const app = read('web', 'src', 'App.tsx')
  assert.match(gallery, /<XDriveMediaGalleryCoverProvider\b/)
  assert.match(gallery, /key=\{preferenceScope \|\| "gallery-default"\}/)
  assert.match(gallery, /loadThumbnail=\{source\.loadThumbnail\}/)
  // P0-L17 adds the verified duplicate-fold still to the four Gallery cover card entries.
  assert.equal((gallery.match(/<XDriveMediaGalleryCoverThumbnail\b/g) || []).length, 5)
  for (const name of [
    'MobileGalleryCollections.tsx', 'MediaGalleryAlbumOrganizer.tsx',
    'MediaGalleryMemories.tsx', 'MediaGalleryCleanup.tsx', 'MediaGalleryPets.tsx',
  ]) {
    const source = read('ui', 'shared', 'src', 'mui', name)
    assert.match(source, /<XDriveMediaGalleryCoverThumbnail\b/, name)
    assert.doesNotMatch(source, /<XDriveMediaAsyncThumbnail\b/, name)
  }
  assert.match(covers, /IntersectionObserver/)
  assert.match(covers, /rootMargin: '180px'/)
  assert.match(covers, /pool\.retain\(nodeID\)/)
  assert.match(covers, /revokeOnDispose=\{!pool\}/)
  assert.match(covers, /onImageDecodeError=\{pool \? onDecodeError : undefined\}/)
  assert.match(covers, /active\?\.loader === loadThumbnail \? active\.pool : null/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(gallery, /<MediaVirtualTileGrid\b/)
  assert.match(gallery, /<MediaVirtualTimeline\b/)
  assert.equal((app.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /api\.mediaThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(desktop, /agent\.getMediaThumbnail\(nodeID, requestID, revision, onProgress\)/)
  assert.match(read('ui', 'shared', 'src', 'mui', 'MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})

test('P0-L16 provider owns account/StrictMode lifecycle; not a new media transport', () => {
  const c = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCoverThumbnail.tsx')
  const p = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCoverThumbnailPool.ts')
  assert.match(c, /new XDriveMediaGalleryCoverThumbnailPool\(loadThumbnail\)/)
  assert.match(c, /return \(\) => pool\.dispose\(\)/)
  assert.match(c, /if \(!nodeID \|\| !near \|\| !pool\) return/)
  assert.match(c, /!nodeID \? fallback : !near \|\| owner === null/)
  assert.match(p, /maxCacheEntries: XDRIVE_GALLERY_COVER_CACHE_SIZE/)
  assert.match(p, /concurrency: XDRIVE_GALLERY_COVER_CONCURRENCY/)
  assert.doesNotMatch(c, /localStorage|sessionStorage|loadMotion|fetch\(/)
})
