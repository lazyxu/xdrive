'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const page = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const begin = page.indexOf('<XDriveMediaGalleryCoverProvider')
const end = page.indexOf('</XDriveMediaGalleryCoverProvider>', begin)
const owned = page.slice(begin, end)
const foldBegin = page.indexOf('<XDriveMediaGalleryCoverProvider', end)
const foldEnd = page.indexOf('</XDriveMediaGalleryCoverProvider>', foldBegin)
const fold = page.slice(foldBegin, foldEnd)

test('P0-L17 verified duplicate-fold Live stills remain within the one account-scoped cover pool', () => {
  assert.ok(begin >= 0 && end > begin && foldBegin > end && foldEnd > foldBegin)
  assert.equal((page.match(/<XDriveMediaGalleryCoverProvider\b/g) || []).length, 2)
  assert.equal((page.match(/<\/XDriveMediaGalleryCoverProvider>/g) || []).length, 2)
  assert.match(owned, /<XDriveMediaGallery\b/)
  assert.doesNotMatch(owned, /data-xdrive-gallery-verified-fold-dialog/)
  assert.match(fold, /data-xdrive-gallery-verified-fold-dialog/)
  assert.match(fold, /verified-fold/)
  assert.match(fold, /<XDriveMediaGalleryCoverThumbnail\b/)
  assert.doesNotMatch(fold, /<XDriveMediaAsyncThumbnail\b/)
  assert.match(page.slice(foldEnd), /\{shareDialog \? \(/)
})

test('P0-L17 fold renderer supplies exact loaded Node revision and preserves authorization and interaction', () => {
  assert.match(fold, /nodeID=\{member\.metadata\.has_thumbnail \? member\.node\.id : undefined\}/)
  assert.match(fold, /revision=\{member\.node\.revision\}/)
  assert.match(fold, /loadThumbnail=\{source\.loadThumbnail\}/)
  assert.match(fold, /fallback=\{xDriveMediaFallback\(member\.metadata\.media_kind\)\}/)
  assert.match(fold, /onClick=\{\(\) => openFoldMember\(member, index\)\}/)
  assert.match(fold, /<XDriveMediaGalleryDuplicateOrganizePreview\b/)
  assert.match(page, /getDuplicateOrganizePlan/)
  assert.doesNotMatch(fold, /getMediaLivePhotoMotion|mediaLivePhotoMotion|fetch\(/)
})

test('P0-L17 versioned cover uses existing production Scheduler one-shot replay, not new transport', async () => {
  const schedulerSource = read('ui', 'shared', 'src', 'mui', 'MediaGalleryThumbnailScheduler.ts')
  const poolSource = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCoverThumbnailPool.ts')
  const transpile = (text, filename) => ts.transpileModule(text, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const run = (js, req = require) => {
    const module = { exports: {} }
    new Function('exports', 'module', 'require', js)(module.exports, module, req)
    return module.exports
  }
  const scheduler = run(transpile(schedulerSource, 'scheduler.ts'))
  const Pool = run(transpile(poolSource, 'pool.ts'), (name) =>
    name === './MediaGalleryThumbnailScheduler' ? scheduler : require(name)).XDriveMediaGalleryCoverThumbnailPool
  const calls = []
  const pool = new Pool(async (id, signal, revision, progress, bypass) => {
    calls.push({ id, revision, bypass })
    return `blob:fold:${id}:${revision}:${calls.length}`
  }, () => {})
  const release = pool.retain(71)
  const first = await pool.load(71, undefined, 8)
  await new Promise((r) => setImmediate(r))
  assert.equal(calls[0].revision, 8)
  assert.equal(pool.invalidateDecodedURL(71, 7, first), false)
  assert.equal(pool.invalidateDecodedURL(71, 8, first), true)
  const recovered = await pool.load(71, undefined, 8)
  assert.equal(calls[1].bypass, true)
  assert.equal(pool.invalidateDecodedURL(71, 8, recovered), true)
  assert.equal(await pool.load(71, undefined, 8), null)
  await pool.load(71, undefined, 9)
  assert.equal(calls[2].bypass, undefined)
  assert.equal(calls.length, 3)
  release()
  pool.dispose()
})


test('P0-L17 a versioned fold thumb cannot abort a distinct unknown-revision Gallery cover', async () => {
  const schedulerSource = read('ui', 'shared', 'src', 'mui', 'MediaGalleryThumbnailScheduler.ts')
  const poolSource = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCoverThumbnailPool.ts')
  const compile = (source, name) => ts.transpileModule(source, {
    fileName: name,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const load = (source, req = require) => {
    const m = { exports: {} }
    new Function('exports', 'module', 'require', source)(m.exports, m, req)
    return m.exports
  }
  const Scheduler = load(compile(schedulerSource, 'scheduler.ts'))
  const Pool = load(compile(poolSource, 'pool.ts'), (name) =>
    name === './MediaGalleryThumbnailScheduler' ? Scheduler : require(name))
    .XDriveMediaGalleryCoverThumbnailPool
  const requests = []
  const loader = (nodeID, signal, revision) => new Promise((resolve) => {
    requests.push({ nodeID, signal, revision, resolve })
  })
  const wall = new Pool(loader, () => {})
  const foldPool = new Pool(loader, () => {})
  const releaseWall = wall.retain(71)
  const releaseFold = foldPool.retain(71)
  const wallRequest = wall.load(71, undefined, 0)
  const foldRequest = foldPool.load(71, undefined, 8)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(requests[0].revision, undefined)
  assert.equal(requests[1].revision, 8)
  assert.equal(requests[0].signal.aborted, false,
    'version 8 in a distinct modal pool must not supersede revision-unknown wall')
  releaseFold()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests[1].signal.aborted, true, 'closing fold aborts only fold work')
  assert.equal(requests[0].signal.aborted, false, 'the still-visible wall remains')
  requests[1].resolve(null)
  requests[0].resolve('blob:wall')
  assert.equal(await foldRequest, null)
  assert.equal(await wallRequest, 'blob:wall')
  releaseWall()
  wall.dispose()
  foldPool.dispose()
})

test('P0-L17 Web/Mobile share one Gallery and virtual range, Desktop retains Agent IPC and 52px frame', () => {
  const web = read('web', 'src', 'mediaGalleryAdapter.ts')
  const desktop = read('desktop', 'src', 'renderer', 'mediaGalleryAdapter.ts')
  const app = read('web', 'src', 'App.tsx')
  assert.match(web, /api\.mediaThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(desktop, /agent\.getMediaThumbnail\(nodeID, requestID, revision, onProgress\)/)
  assert.match(page, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(page, /<MediaVirtualTileGrid\b/)
  assert.match(page, /<MediaVirtualTimeline\b/)
  assert.equal((app.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(read('ui', 'shared', 'src', 'mui', 'MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})
