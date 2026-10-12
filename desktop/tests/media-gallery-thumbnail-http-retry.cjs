'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const api = read('web/src/api.ts')
const start = api.indexOf('async function xDriveThumbnailRetryAfter503(')
const end = api.indexOf('\nconst API_BASE', start)
assert.ok(start >= 0 && end > start, 'the actual production helper must be present')
const isolated = api.slice(start, end) + '\nexport { xDriveThumbnailRetryAfter503 }'
const js = ts.transpileModule(isolated, {
  fileName: 'RealWebThumbnailRetry.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const pendingTimers = new Map()
let nextTimer = 1
function schedule(callback, delay) {
  const id = nextTimer++
  pendingTimers.set(id, { callback, delay })
  return id
}
function cancel(id) { pendingTimers.delete(id) }
function flush() { return new Promise(resolve => setImmediate(resolve)) }
async function fireNext() {
  assert.equal(pendingTimers.size, 1, 'expected exactly one bounded retry timer')
  const [id, timer] = [...pendingTimers.entries()][0]
  pendingTimers.delete(id)
  timer.callback()
  await flush()
}
const mod = { exports: {} }
new Function('exports', 'module', 'require', 'setTimeout', 'clearTimeout', js)(
  mod.exports, mod, require, schedule, cancel,
)
const retry = mod.exports.xDriveThumbnailRetryAfter503
const reply = (status, hint, cancelled) => ({
  status,
  headers: { get: name => name.toLowerCase() === 'retry-after' ? hint : null },
  body: { cancel: async () => { cancelled?.push(status) } },
})

test('P0-L4b one real HTTP 503 Retry-After=1 waits then issues exactly one retry', async () => {
  const closed = []
  const failed = reply(503, '1', closed)
  const ok = reply(200, null)
  let requests = 0
  const result = retry(failed, async () => { requests++; return ok })
  await flush()
  assert.equal(pendingTimers.size, 1)
  assert.equal([...pendingTimers.values()][0].delay, 1000)
  assert.deepEqual(closed, [503], 'rejected body must be released')
  assert.equal(requests, 0, 'no immediate retry thundering herd')
  await fireNext()
  assert.equal(await result, ok)
  assert.equal(requests, 1)
  assert.equal(pendingTimers.size, 0)
})

test('P0-L4b 404 409 415, absent and malformed retry hints never retry', async () => {
  for (const [status, hint] of [
    [404, '1'], [409, '1'], [415, '1'], [503, null], [503, '0'],
    [503, '9'], [503, '3600'], [503, 'date'], [503, '1.5'],
  ]) {
    const bad = reply(status, hint)
    let requests = 0
    const value = await retry(bad, async () => { requests++; return reply(200, null) })
    assert.equal(value, bad)
    assert.equal(requests, 0)
    assert.equal(pendingTimers.size, 0)
  }
})

test('P0-L4b repeated 503 terminates after ONE retry; no recursive chain', async () => {
  let requests = 0
  const result = retry(reply(503, '1'), async () => {
    requests++
    return reply(503, '1')
  })
  await flush()
  await fireNext()
  assert.equal((await result).status, 503)
  assert.equal(requests, 1)
  assert.equal(pendingTimers.size, 0)
})

test('P0-L4b viewport abort clears pending retry and never sends another GET', async () => {
  const controller = new AbortController()
  let requests = 0
  const result = retry(reply(503, '1'), async () => {
    requests++
    return reply(200, null)
  }, controller.signal)
  await flush()
  assert.equal(pendingTimers.size, 1)
  controller.abort()
  await assert.rejects(result, err => err?.name === 'AbortError')
  assert.equal(pendingTimers.size, 0)
  assert.equal(requests, 0)
})

test('P0-L4b Web/Mobile uses same REST transport, forces uncached second GET and retains virtual scheduler', () => {
  const web = read('web/src/mediaGalleryAdapter.ts')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const scheduler = read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
  assert.match(api, /const send = \(cacheOverride\?: RequestCache\) => fetch/)
  assert.match(api, /cache: cacheOverride \?\? \(sourceRevision \? 'default' : 'no-cache'\)/)
  assert.match(api, /response = await xDriveThumbnailRetryAfter503\(\s*response, \(\) => send\('no-store'\), signal/)
  assert.match(web, /loadThumbnail: \(nodeID, signal, revision, onProgress\) => api\.mediaThumbnail/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(scheduler, /XDRIVE_MEDIA_THUMBNAIL_CONCURRENCY = 6/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.match(read('internal/api/media_derivatives.go'), /Cache-Control", "private, no-store"/)
  assert.match(read('internal/api/media.go'), /video poster is not cached/)
})
