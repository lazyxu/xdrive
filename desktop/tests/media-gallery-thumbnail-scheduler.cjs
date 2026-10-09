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
