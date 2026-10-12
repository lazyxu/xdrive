'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const strip = read('ui/shared/src/mui/MediaGalleryFilmstrip.tsx')

function actualScheduler() {
  const source = read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
  const compiled = ts.transpileModule(source, {
    fileName: 'GalleryFilmstripScheduler.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, require)
  return mod.exports.XDriveMediaThumbnailScheduler
}

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

test('P0-L15 Viewer filmstrip owns one bounded shared Scheduler, not raw standalone thumb loading', () => {
  assert.match(strip, /new XDriveMediaThumbnailScheduler\(loadThumbnail,\s*\{\s*concurrency: 3,\s*maxCacheEntries: 32,\s*\}\)/)
  assert.match(strip, /thumbnailScheduler\.load\(nodeID, 0, revision, onProgress, signal\)/)
  assert.match(strip, /loadThumbnail=\{loadFilmstripThumbnail\}/)
  assert.match(strip, /revokeOnDispose=\{false\}/)
  assert.match(strip, /onImageDecodeError=\{\(failedURL\) => \{\s*thumbnailScheduler\.invalidateDecodedURL\(item\.node\.id, item\.node\.revision, failedURL\)/)
  assert.match(strip, /thumbnailScheduler\.setRetention\(entries\.map\(\(\{ item \}\) => item\.node\.id\)\)/)
  assert.match(strip, /thumbnailScheduler\.dispose\(\)/)
  assert.doesNotMatch(strip, /loadThumbnail=\{loadThumbnail\}/)
})

test('P0-L15 real Scheduler next-visible repair survives stale URL and cannot loop', async () => {
  const Scheduler = actualScheduler()
  const calls = []
  const revoked = []
  const queue = new Scheduler(
    async (nodeID, signal, revision, _onProgress, bypassHTTPCache) => {
      calls.push({ nodeID, signal, revision, bypassHTTPCache })
      return `blob:filmstrip:${nodeID}:${revision}:${calls.length}`
    },
    { concurrency: 3, maxCacheEntries: 32, revokeURL: (url) => revoked.push(url) },
  )
  queue.setRetention([91, 92])
  const first = await queue.load(91, 0, 7)
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].bypassHTTPCache, undefined)
  assert.equal(queue.invalidateDecodedURL(91, 6, first), false)
  assert.equal(queue.invalidateDecodedURL(92, 7, first), false)
  assert.equal(queue.invalidateDecodedURL(91, 7, first), true)
  assert.deepEqual(revoked, [first])
  await flush()
  assert.equal(calls.length, 1, 'browser decoder event must not fire a new GET')
  const second = await queue.load(91, 0, 7)
  assert.equal(second, 'blob:filmstrip:91:7:2')
  assert.equal(calls[1].bypassHTTPCache, true, 'only the next visible load bypasses HTTP cache')
  assert.equal(queue.invalidateDecodedURL(91, 7, second), true)
  assert.equal(await queue.load(91, 0, 7), null, 'second decoder failure is terminal')
  assert.equal(calls.length, 2)
  await queue.load(91, 0, 8)
  assert.equal(calls[2].bypassHTTPCache, undefined, 'new revision is independent')
  queue.dispose()
})

test('P0-L15 exiting a filmstrip aborts only its queue, preserving the Gallery owner', async () => {
  const Scheduler = actualScheduler()
  const requests = []
  const loader = (_nodeID, signal) => new Promise((resolve) => {
    requests.push({ signal, resolve })
  })
  const wall = new Scheduler(loader, { concurrency: 1, revokeURL: () => {} })
  const stripQueue = new Scheduler(loader, { concurrency: 1, maxCacheEntries: 32, revokeURL: () => {} })
  const wallTask = wall.load(77, 0, 4)
  const stripTask = stripQueue.load(77, 0, 4)
  await flush()
  assert.equal(requests.length, 2)
  stripQueue.setRetention([])
  assert.equal(await stripTask, null)
  assert.equal(requests[1].signal.aborted, true)
  assert.equal(requests[0].signal.aborted, false, 'Viewer close must never cancel its wall sibling')
  requests[1].resolve(null)
  requests[0].resolve('blob:wall-photo')
  assert.equal(await wallTask, 'blob:wall-photo')
  wall.dispose()
  stripQueue.dispose()
})

test('P0-L15 Web/Mobile and Desktop retain one Viewer, same REST/IPC and 52px App Frame', () => {
  const page = read('ui/shared/src/mui/MediaGallery.tsx')
  const viewer = read('ui/shared/src/mui/MediaGalleryViewer.tsx')
  const web = read('web/src/mediaGalleryAdapter.ts')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const app = read('web/src/App.tsx')
  assert.match(viewer, /<XDriveMediaGalleryFilmstrip\b/)
  assert.match(page, /<XDriveMediaGalleryViewer\b/)
  assert.match(page, /<MediaVirtualTileGrid\b/)
  assert.match(page, /<MediaVirtualTimeline\b/)
  assert.equal((app.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /api\.mediaThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(desktop, /agent\.getMediaThumbnail\(nodeID, requestID, revision, onProgress\)/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})
