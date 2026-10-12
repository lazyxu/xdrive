'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const api = read('web/src/api.ts')
const helperStart = api.indexOf('async function xDriveThumbnailRetryAfter503(')
const helperEnd = api.indexOf('\nconst API_BASE', helperStart)
const methodStart = api.indexOf('  async mediaThumbnail(')
const methodEnd = api.indexOf('\n  /**\n   * Authenticated bounded JPEG', methodStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart && methodStart > 0 && methodEnd > methodStart,
  'isolate the actual Web/Mobile production mediaThumbnail method and bounded retry helper')
const production = [
  'class ApiError extends Error { constructor(status: number, message: string) { super(message); this.status = status } }',
  api.slice(helperStart, helperEnd),
  "const API_BASE = ''",
  api.slice(methodStart, methodEnd).replace('  async mediaThumbnail(', 'async function mediaThumbnail('),
  'export { mediaThumbnail, xDriveThumbnailHasSafeImageEnvelope }',
].join('\n')
const compiled = ts.transpileModule(production, {
  fileName: 'RealWebThumbnailCacheRecovery.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mediaProgress = ts.transpileModule(read('web/src/mediaBinaryProgress.ts'), {
  fileName: 'RealMediaBinaryProgress.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const progressModule = { exports: {} }
new Function('exports', 'module', 'require', mediaProgress)(
  progressModule.exports, progressModule, require,
)
const jpeg = Buffer.alloc(80, 3)
jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[78] = 0xff; jpeg[79] = 0xd9
const truncated = Buffer.from(jpeg)
truncated[78] = 0
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(40, 0),
  Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]),
])
const response = (bytes, type = 'image/jpeg', status = 200, headers = {}) =>
  new Response(bytes, { status, headers: { 'Content-Type': type, ...headers } })
function harness(replies) {
  const calls = []
  const fetch = async (url, options) => {
    options.signal?.throwIfAborted()
    calls.push({
      url, cache: options.cache, authorization: options.headers?.Authorization,
      signal: options.signal,
    })
    assert.ok(replies.length > 0, 'extra or recursive request')
    return replies.shift()
  }
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', 'fetch', 'xDriveMediaResponseBlob', compiled)(
    mod.exports, mod, require, fetch, progressModule.exports.xDriveMediaResponseBlob,
  )
  const auth = {
    session: { accessToken: 'real-owner-scoped-token', refreshToken: 'test-refresh' },
    ensureFresh: async () => undefined,
    refresh: async () => undefined,
  }
  return { calls, auth, ...mod.exports }
}

test('P0-L12 old browser-cached 200/truncated JPEG causes just one authorized no-store GET', async () => {
  const t = harness([response(truncated), response(jpeg)])
  const result = await t.mediaThumbnail.call(t.auth, 42, undefined, 9)
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), jpeg)
  assert.deepEqual(t.calls.map(c => c.cache), ['default', 'no-store'])
  assert.deepEqual(t.calls.map(c => c.url), Array(2).fill('/api/v1/media/items/42/thumbnail?v=4&revision=9'))
  assert.deepEqual(t.calls.map(c => c.authorization), Array(2).fill('Bearer real-owner-scoped-token'))
})

test('P0-L12 valid JPEG and PNG keep one request and no additional source reads', async () => {
  for (const [bytes, type] of [[jpeg, 'image/jpeg'], [png, 'image/png']]) {
    const t = harness([response(bytes, type)])
    const result = await t.mediaThumbnail.call(t.auth, 42, undefined, 9)
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes)
    assert.equal(t.calls.length, 1)
    assert.equal(t.calls[0].cache, 'default')
  }
})

test('P0-L12 account-scoped unknown-revision cover revalidates, then bypasses only invalid body', async () => {
  const t = harness([response(Buffer.alloc(0)), response(jpeg)])
  await t.mediaThumbnail.call(t.auth, 45)
  assert.deepEqual(t.calls.map(c => c.cache), ['no-cache', 'no-store'])
  assert.equal(t.calls[0].url, '/api/v1/media/items/45/thumbnail?v=4')
  assert.equal(t.calls[1].url, t.calls[0].url)
})

test('P0-L12 one fresh invalid image or wrong MIME fails as 502, never recursive', async () => {
  for (const bad of [response(truncated), response(jpeg, 'text/plain'), response(png.subarray(0, 8), 'image/png')]) {
    const t = harness([response(truncated), bad])
    await assert.rejects(t.mediaThumbnail.call(t.auth, 42, undefined, 9),
      error => error.status === 502 && /Invalid thumbnail image bytes/.test(error.message))
    assert.deepEqual(t.calls.map(c => c.cache), ['default', 'no-store'])
  }
})

test('P0-L12 404/409/415 terminal responses do not bypass cache or read originals', async () => {
  for (const code of [404, 409, 415]) {
    const t = harness([response('not available', 'application/json', code)])
    await assert.rejects(t.mediaThumbnail.call(t.auth, 42, undefined, 9), e => e.status === code)
    assert.equal(t.calls.length, 1)
  }
  const t = harness([response(truncated), response('queue full', 'application/json', 503)])
  await assert.rejects(t.mediaThumbnail.call(t.auth, 42, undefined, 9), e => e.status === 503)
  assert.equal(t.calls.length, 2, 'a 503 after the one uncached recovery cannot start another retry timer')
})

test('P0-L12 viewport AbortSignal prevents any uncached retry and progress is reset for recovery', async () => {
  const abort = new AbortController()
  const blocked = harness([response(truncated), response(jpeg)])
  await assert.rejects(
    blocked.mediaThumbnail.call(blocked.auth, 42, abort.signal, 9, (loaded) => {
      if (loaded === 0 && !abort.signal.aborted) abort.abort()
    }),
    err => err.name === 'AbortError',
  )
  assert.equal(blocked.calls.length, 1)
  assert.equal(blocked.calls[0].signal, abort.signal)

  const progress = []
  const retried = harness([response(truncated, 'image/jpeg', 200, {
    'X-XDrive-Thumbnail-Alpha-State': 'opaque',
  }), response(jpeg, 'image/jpeg', 200, {
    'X-XDrive-Thumbnail-Alpha-State': 'opaque',
  })])
  await retried.mediaThumbnail.call(retried.auth, 42, undefined, 9,
    (loaded, _total, mask) => progress.push({ loaded, mask }))
  assert.equal(retried.calls.length, 2)
  assert.ok(progress.filter(x => x.loaded === 0).length >= 2,
    'recovering a corrupt cached image resets the existing progress indicator')
})

test('P0-L12 preserves shared Web/Mobile Gallery and iOS27 App Frame without a second media endpoint', () => {
  const web = read('web/src/mediaGalleryAdapter.ts')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const scheduler = read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
  assert.match(web, /loadThumbnail: \(nodeID, signal, revision, onProgress, bypassHTTPCache\) => api\.mediaThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(api, /const send = \(cacheOverride\?: RequestCache\) => fetch/)
  assert.match(api, /response = await send\('no-store'\)/)
  assert.match(api, /const retried503 = response\.status === 503/)
  assert.match(api, /xDriveThumbnailHasSafeImageEnvelope\(blob, response\.headers\.get\('Content-Type'\), signal\)/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(scheduler, /XDRIVE_MEDIA_THUMBNAIL_CONCURRENCY = 6/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})
