'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
const original = fs.readFileSync(filename, 'utf8')
const transpiled = ts.transpileModule(original, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', transpiled)(mod.exports, mod, require)
const { XDriveMediaThumbnailScheduler } = mod.exports

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
async function flush() {
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
}

test('Gallery updated Node revision must bypass the old warm thumbnail cache', async () => {
  const calls = []
  const revoked = []
  const scheduler = new XDriveMediaThumbnailScheduler(async (nodeID) => {
    calls.push(nodeID)
    return 'blob:version-' + calls.length
  }, { concurrency: 2, revokeURL: url => revoked.push(url) })
  try {
    const first = await scheduler.load(417, 0, 3)
    const warm = await scheduler.load(417, 0, 3)
    assert.equal(warm, first, 'unchanged revision must reuse its cached image')
    assert.deepEqual(calls, [417], 'same-revision GET must stay deduplicated')
    const next = await scheduler.load(417, 0, 4)
    console.log('GALLERY_REVISION_CACHE_SAMPLE ' + JSON.stringify({
      nodeID: 417, fromRevision: 3, toRevision: 4,
      first, warm, next, requests: calls.length,
    }))
    assert.equal(calls.length, 2,
      'same Node ID but a newer revision MUST start a new thumbnail request')
    assert.notEqual(next, first, 'new revision must not display old warm Blob')
  } finally {
    scheduler.dispose()
  }
})

test('Gallery new revision must cancel obsolete in-flight source and prevent late cache poisoning', async () => {
  const pending = []
  const revoked = []
  const scheduler = new XDriveMediaThumbnailScheduler((nodeID, signal) => {
    const task = deferred()
    pending.push({ nodeID, signal, ...task })
    return task.promise
  }, { concurrency: 2, revokeURL: value => revoked.push(value) })
  let stale
  let fresh
  try {
    stale = scheduler.load(418, 0, 8)
    await flush()
    assert.equal(pending.length, 1)
    fresh = scheduler.load(418, 0, 9)
    await flush()
    console.log('GALLERY_REVISION_INFLIGHT_SAMPLE ' + JSON.stringify({
      nodeID: 418, oldRevision: 8, newRevision: 9,
      upstreamRequests: pending.length, oldAborted: pending[0].signal.aborted,
    }))
    assert.equal(pending.length, 2,
      'a newer revision must never dedupe to an older in-flight Promise')
    assert.equal(pending[0].signal.aborted, true,
      'superseded revision must receive a real AbortSignal')
    assert.equal(pending[1].signal.aborted, false,
      'new request must own an independent non-cancelled signal')
    pending[1].resolve('blob:revision-9')
    assert.equal(await fresh, 'blob:revision-9')
    pending[0].resolve('blob:revision-8-late')
    assert.equal(await stale, null,
      'old request must not resolve a thumbnail for the new revision')
    await flush()
    assert.ok(revoked.includes('blob:revision-8-late'),
      'late obsolete Blob must be released')
    assert.equal(await scheduler.load(418, 0, 9), 'blob:revision-9',
      'new revision should remain reusable without another GET')
  } finally {
    for (const p of pending) p.resolve('blob:cleanup')
    if (stale) await Promise.allSettled([stale])
    if (fresh) await Promise.allSettled([fresh])
    scheduler.dispose()
  }
})

test('Gallery media tile passes revision and re-acquires same Node after revision change', () => {
  const source = fs.readFileSync(path.join(
    root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const start = source.indexOf('function MediaTile(')
  assert.ok(start >= 0, 'shared Gallery tile must exist')
  const tile = source.slice(start, start + 11000)
  assert.match(tile,
    /thumbnailScheduler\.load\(nodeID,\s*thumbnailPriority,\s*item\.node\.revision,\s*onProgress,\s*signal\)/,
    'Gallery must supply Node revision for thumbnail cache ownership')
  assert.match(tile,
    /\[loadThumbnail,\s*thumbnailPriority,\s*thumbnailScheduler,\s*item\.node\.revision\]/,
    'same-ID revision update must restart the thumbnail acquisition effect')
})
