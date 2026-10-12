'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(repo, name), 'utf8')
const schedulerSource = read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
const schedulerCompiled = ts.transpileModule(schedulerSource, {
  fileName: 'RealGalleryScheduler.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const schedulerModule = { exports: {} }
new Function('exports', 'module', 'require', schedulerCompiled)(
  schedulerModule.exports, schedulerModule, require,
)
const { XDriveMediaThumbnailScheduler } = schedulerModule.exports

const apiSource = read('web/src/api.ts')
const helperStart = apiSource.indexOf('async function xDriveThumbnailRetryAfter503(')
const helperEnd = apiSource.indexOf('\nconst API_BASE', helperStart)
const methodStart = apiSource.indexOf('  async mediaThumbnail(')
const methodEnd = apiSource.indexOf('\n  /**\n   * Authenticated bounded JPEG', methodStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart && methodStart >= 0 && methodEnd > methodStart)
const extracted = [
  'class ApiError extends Error { constructor(status: number, message: string) { super(message); this.status = status } }',
  apiSource.slice(helperStart, helperEnd),
  "const API_BASE = ''",
  apiSource.slice(methodStart, methodEnd).replace('  async mediaThumbnail(', 'async function mediaThumbnail('),
  'export { mediaThumbnail }',
].join('\n')
const js = ts.transpileModule(extracted, {
  fileName: 'RealWebGalleryApi.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mediaBinaryProgress = ts.transpileModule(read('web/src/mediaBinaryProgress.ts'), {
  fileName: 'RealMediaBinaryProgress.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const progModule = { exports: {} }
new Function('exports', 'module', 'require', mediaBinaryProgress)(progModule.exports, progModule, require)

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }
const jpeg = Buffer.alloc(80, 3)
jpeg[0] = 255; jpeg[1] = 216; jpeg[2] = 255
jpeg[78] = 255; jpeg[79] = 217
const res = () => new Response(jpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })

function apiHarness() {
  const calls = []
  const fetch = async (url, options) => {
    options.signal?.throwIfAborted()
    calls.push({ url, cache: options.cache, authorization: options.headers?.Authorization })
    return res()
  }
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', 'fetch', 'xDriveMediaResponseBlob', js)(
    mod.exports, mod, require, fetch, progModule.exports.xDriveMediaResponseBlob,
  )
  const user = {
    session: { accessToken: 'owner-jwt', refreshToken: 'not-used' },
    ensureFresh: async () => undefined,
    refresh: async () => undefined,
  }
  return { calls, user, mediaThumbnail: mod.exports.mediaThumbnail }
}

test('P0-L13 a real DOM decode-error identity schedules NO immediate refetch and bypasses HTTP cache only on next visible load', async () => {
  const requests = []
  const revoked = []
  const scheduler = new XDriveMediaThumbnailScheduler(
    async (id, signal, revision, onProgress, bypassHTTP) => {
      requests.push({ id, revision, bypassHTTP, signal })
      return 'blob:' + id + ':' + revision + ':' + requests.length
    },
    { revokeURL: url => revoked.push(url) },
  )
  const first = await scheduler.load(71, 0, 9)
  assert.equal(first, 'blob:71:9:1')
  assert.equal(requests[0].bypassHTTP, undefined)
  assert.equal(scheduler.invalidateDecodedURL(71, 9, 'blob:other'), false)
  assert.equal(scheduler.invalidateDecodedURL(71, 8, first), false)
  assert.equal(scheduler.invalidateDecodedURL(72, 9, first), false)
  assert.equal(requests.length, 1)
  assert.equal(scheduler.invalidateDecodedURL(71, 9, first), true)
  assert.deepEqual(revoked, [first])
  await flush()
  assert.equal(requests.length, 1, 'real img.onError must not immediately start a GET')
  const second = await scheduler.load(71, 0, 9)
  assert.equal(second, 'blob:71:9:2')
  assert.equal(requests[1].bypassHTTP, true, 'exact next viewport mount must bypass poisoned browser HTTP cache')
  scheduler.dispose()
})

test('P0-L13 failed fresh decode exhausts once-per-node-revision recovery without repeated requests after scroll', async () => {
  const requests = []
  const scheduler = new XDriveMediaThumbnailScheduler(
    async (id, _signal, rev, _progress, bypass) => {
      requests.push({ id, rev, bypass })
      return 'blob:' + id + ':' + rev + ':' + requests.length
    },
    { revokeURL: () => {} },
  )
  const first = await scheduler.load(42, 0, 3)
  await flush()
  assert.equal(scheduler.invalidateDecodedURL(42, 3, first), true)
  await flush()
  const second = await scheduler.load(42, 0, 3)
  assert.equal(requests[1].bypass, true)
  assert.equal(scheduler.invalidateDecodedURL(42, 3, second), true)
  assert.equal(await scheduler.load(42, 0, 3), null, 'same bad source must not refetch forever after failed uncached decode')
  assert.equal(requests.length, 2)
  const another = await scheduler.load(42, 0, 4)
  assert.match(another, /blob:42:4/)
  assert.equal(requests[2].bypass, undefined, 'new revision is independently valid and normally cached')
  scheduler.dispose()
})

test('P0-L13 cancellation before completed recovery preserves the single next-visible uncached chance', async () => {
  let pending
  const requests = []
  const scheduler = new XDriveMediaThumbnailScheduler((nodeID, signal, revision, progress, bypass) => {
    requests.push({ nodeID, signal, revision, bypass })
    if (bypass && requests.length === 2) {
      return new Promise(resolve => { pending = resolve })
    }
    return Promise.resolve('blob:' + nodeID + ':' + revision + ':' + requests.length)
  }, { revokeURL: () => {} })
  const first = await scheduler.load(42, 0, 3)
  await flush()
  scheduler.invalidateDecodedURL(42, 3, first)
  await flush()
  const cancelled = scheduler.load(42, 0, 3)
  await flush()
  assert.equal(requests[1].bypass, true)
  scheduler.setRetention([])
  assert.equal(await cancelled, null)
  assert.equal(requests[1].signal.aborted, true)
  pending('blob:late-aborted')
  await flush()
  const resumed = await scheduler.load(42, 0, 3)
  assert.match(resumed, /blob:42:3:3/)
  assert.equal(requests[2].bypass, true, 'scroll abort must not permanently consume the only recovery attempt')
  scheduler.dispose()
})

test('P0-L13 real Web API honors explicit one-shot cache bypass for exact authorized source revision', async () => {
  const h = apiHarness()
  const body = await h.mediaThumbnail.call(h.user, 71, undefined, 9, undefined, true)
  assert.deepEqual(Buffer.from(await body.arrayBuffer()), jpeg)
  assert.deepEqual(h.calls, [{
    url: '/api/v1/media/items/71/thumbnail?v=4&revision=9',
    cache: 'no-store',
    authorization: 'Bearer owner-jwt',
  }], 'same authorized Node+revision one GET; never a synthetic cache-busting query')
})

test('P0-L13 ordinary good thumbnail remains single default-cache Web GET', async () => {
  const h = apiHarness()
  await h.mediaThumbnail.call(h.user, 71, undefined, 9)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].cache, 'default')
})

test('P0-L13 Web and Mobile Gallery use identical transport, shared virtualization and the 52px App Frame', () => {
  const web = read('web/src/mediaGalleryAdapter.ts')
  const shared = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const app = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  assert.match(web, /loadThumbnail: \(nodeID, signal, revision, onProgress, bypassHTTPCache\) => api\.mediaThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(shared, /port\.loadThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(gallery, /useXDriveVirtualCollection<MediaItem>/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.equal((app.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(desktop, /agent\.getMediaThumbnail\(nodeID, requestID, revision, onProgress\)/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})
