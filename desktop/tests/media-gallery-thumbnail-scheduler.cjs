const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryThumbnailScheduler.ts')
const source = fs.readFileSync(filename, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: filename,
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', output)(mod.exports, mod, require)

const { XDriveMediaThumbnailScheduler } = mod.exports

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

test('Gallery thumbnail scheduler bounds concurrency, prioritizes visible work, and deduplicates nodes', async () => {
  const calls = []
  const pending = new Map()
  const scheduler = new XDriveMediaThumbnailScheduler((nodeID) => {
    calls.push(nodeID)
    const request = deferred()
    pending.set(nodeID, request)
    return request.promise
  }, { concurrency: 1, revokeURL: () => {} })

  const first = scheduler.load(1, 1)
  const prefetch = scheduler.load(2, 1)
  const visible = scheduler.load(3, 0)
  const visibleDuplicate = scheduler.load(3, 0)

  assert.equal(visible, visibleDuplicate, 'same node must share one queued promise')
  await flush()
  assert.deepEqual(calls, [3], 'same-turn visible work must start before prefetch work')

  pending.get(3).resolve('blob:three')
  await visible
  await flush()
  assert.deepEqual(calls, [3, 1], 'older prefetch keeps FIFO order after visible work')

  pending.get(1).resolve('blob:one')
  await first
  await flush()
  assert.deepEqual(calls, [3, 1, 2])

  pending.get(2).resolve('blob:two')
  await prefetch
  scheduler.dispose()
})

test('Gallery thumbnail scheduler cancels stale retention work and discards stale in-flight results', async () => {
  const calls = []
  const pending = new Map()
  const revoked = []
  const signals = new Map()
  const scheduler = new XDriveMediaThumbnailScheduler((nodeID, signal) => {
    signals.set(nodeID, signal)
    calls.push(nodeID)
    const request = deferred()
    pending.set(nodeID, request)
    return request.promise
  }, {
    concurrency: 1,
    revokeURL: (url) => revoked.push(url),
  })

  const stale = scheduler.load(10, 0)
  await flush()
  const retained = scheduler.load(20, 1)
  scheduler.setRetention([20])
  assert.equal(signals.get(10)?.aborted, true, 'abandoning the viewport must abort the started HTTP request')

  assert.equal(await stale, null, 'stale in-flight request must be logically cancelled')
  pending.get(10).resolve('blob:stale')
  await flush()
  assert.deepEqual(revoked, ['blob:stale'], 'stale blob result must be revoked instead of cached')
  assert.deepEqual(calls, [10, 20])

  pending.get(20).resolve('blob:retained')
  assert.equal(await retained, 'blob:retained')
  scheduler.dispose()
  assert.ok(revoked.includes('blob:retained'), 'scheduler must own cached blob cleanup')
})

test('8009-item cold Gallery does not starve new visible tiles behind six aborted requests that never settle', async () => {
  const calls = []
  const pending = new Map()
  const signals = new Map()
  const revoked = []
  const scheduler = new XDriveMediaThumbnailScheduler((nodeID, signal) => {
    calls.push(nodeID)
    signals.set(nodeID, signal)
    const work = deferred()
    pending.set(nodeID, work)
    return work.promise
  }, { concurrency: 6, revokeURL: url => revoked.push(url) })

  const oldIDs = [1, 2, 3, 4, 5, 6]
  const newIDs = [8004, 8005, 8006, 8007, 8008, 8009]
  const old = oldIDs.map(id => scheduler.load(id, 0, 1))
  await flush()
  assert.deepEqual(calls, oldIDs, 'six cold requests occupy the first viewport')
  const next = newIDs.map(id => scheduler.load(id, 0, 1))
  // The cancelled transport intentionally ignores its AbortSignal.
  scheduler.setRetention(newIDs)
  await flush()
  assert.ok(oldIDs.every(id => signals.get(id)?.aborted))
  assert.deepEqual(await Promise.all(old), Array(6).fill(null))
  assert.deepEqual(calls, [...oldIDs, ...newIDs],
    'new visible work starts before abandoned network promises resolve')

  for (const id of oldIDs) pending.get(id).resolve('blob:late-' + id)
  await flush()
  assert.equal(revoked.length, 6, 'late, aborted image URLs are discarded')
  for (const id of newIDs) pending.get(id).resolve('blob:visible-' + id)
  assert.deepEqual(await Promise.all(next), newIDs.map(id => 'blob:visible-' + id))
  scheduler.dispose()
})

test('Gallery thumbnail scheduler reuses cached URLs and evicts least-recently-used entries', async () => {
  const calls = new Map()
  const revoked = []
  const scheduler = new XDriveMediaThumbnailScheduler(async (nodeID) => {
    calls.set(nodeID, (calls.get(nodeID) ?? 0) + 1)
    return `blob:node-${nodeID}-call-${calls.get(nodeID)}`
  }, {
    concurrency: 2,
    maxCacheEntries: 2,
    revokeURL: (url) => revoked.push(url),
  })

  const first = await scheduler.load(1, 0)
  assert.equal(await scheduler.load(1, 0), first)
  assert.equal(calls.get(1), 1, 'cache hit must not call the source loader again')

  await scheduler.load(2, 1)
  await scheduler.load(1, 0)
  await scheduler.load(3, 1)
  assert.ok(revoked.includes('blob:node-2-call-1'), 'least recently used cache entry should be evicted')

  const secondLoadOfTwo = await scheduler.load(2, 0)
  assert.equal(calls.get(2), 2)
  assert.equal(secondLoadOfTwo, 'blob:node-2-call-2')
  scheduler.dispose()
})


test('P0-L4c1 decode-failed URL is evicted only for the exact Node revision and cached URL', async () => {
  const revoked = []
  const calls = new Map()
  const scheduler = new XDriveMediaThumbnailScheduler(async (id) => {
    const count = (calls.get(id) ?? 0) + 1
    calls.set(id, count)
    return 'blob:thumb-' + id + '-response-' + count
  }, {
    concurrency: 2,
    revokeURL: (url) => revoked.push(url),
  })
  const old = await scheduler.load(71, 0, 9)
  const unaffected = await scheduler.load(72, 0, 9)
  await flush()
  assert.equal(old, 'blob:thumb-71-response-1')
  assert.equal(scheduler.invalidateDecodedURL(71, 9, 'blob:other-url'), false)
  assert.equal(scheduler.invalidateDecodedURL(71, 8, old), false)
  assert.equal(scheduler.invalidateDecodedURL(72, 9, old), false)
  assert.equal(scheduler.invalidateDecodedURL(0, 9, old), false)
  assert.equal(await scheduler.load(71, 0, 9), old, 'mismatched callback never evicts valid cache')
  assert.equal(calls.get(71), 1)
  assert.deepEqual(revoked, [])
  assert.equal(scheduler.invalidateDecodedURL(71, 9, old), true)
  assert.deepEqual(revoked, [old], 'only the proven broken Blob URL is released')
  assert.equal(calls.get(71), 1, 'the decode error must not launch a background retry')
  const recovered = await scheduler.load(71, 0, 9)
  await flush()
  assert.equal(recovered, 'blob:thumb-71-response-2')
  assert.equal(calls.get(71), 2, 'only the next explicit visible request reacquires pixels')
  assert.equal(scheduler.invalidateDecodedURL(71, 9, old), false,
    'late error from superseded Blob cannot evict the replacement')
  assert.equal(await scheduler.load(71, 0, 9), recovered)
  assert.equal(calls.get(71), 2)
  assert.equal(await scheduler.load(72, 0, 9), unaffected,
    'independent thumbnails retain their successful LRU entries')
  assert.equal(calls.get(72), 1)
  scheduler.dispose()
  assert.ok(revoked.includes(recovered) && revoked.includes(unaffected))
})

test('Gallery Viewer lease pins the warmed revision Blob across eviction/disposal', async () => {
  const revoked = []
  let calls = 0
  const scheduler = new XDriveMediaThumbnailScheduler(
    async (node) => { calls++; return `blob:tile-${node}-${calls}` },
    { maxCacheEntries: 1, revokeURL: url => revoked.push(url) },
  )
  const first = await scheduler.load(9, 0, 2)
  assert.equal(first, 'blob:tile-9-1')
  assert.equal(scheduler.borrowCachedForViewer(9, 3), null, 'different revision may not borrow')
  assert.equal(scheduler.borrowCachedForViewer(0, 2), null)
  const lease = scheduler.borrowCachedForViewer(9, 2)
  assert.equal(lease?.url, first)
  assert.equal(calls, 1, 'Viewer warm cache skips a second transport')
  await scheduler.load(10, 0, 2)
  assert.deepEqual(revoked, [], 'eviction may not revoke a Viewer-mounted Blob URL')
  lease.release(); lease.release()
  assert.deepEqual(revoked, [first], 'release is idempotent')
  const next = scheduler.borrowCachedForViewer(10, 2)
  assert.equal(next?.url, 'blob:tile-10-2')
  scheduler.dispose()
  assert.deepEqual(revoked, [first], 'Gallery disposal defers active Viewer Blob revocation')
  next.release()
  assert.deepEqual(revoked, [first, next.url])
  assert.equal(scheduler.borrowCachedForViewer(10, 2), null)
})

test('invalidate a decode-failed cached revision without revoking the borrowing Viewer', async () => {
  const revoked = []
  const scheduler = new XDriveMediaThumbnailScheduler(
    async () => 'blob:bad-tile',
    { revokeURL: url => revoked.push(url) },
  )
  const url = await scheduler.load(81, 0, 5)
  const lease = scheduler.borrowCachedForViewer(81, 5)
  assert.equal(lease?.url, url)
  assert.equal(scheduler.invalidateDecodedURL(81, 5, url), true)
  assert.deepEqual(revoked, [])
  assert.equal(scheduler.borrowCachedForViewer(81, 5), null)
  lease.release()
  assert.deepEqual(revoked, [url])
  scheduler.dispose()
})
