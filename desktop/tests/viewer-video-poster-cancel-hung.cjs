'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'ui/shared/src/mui/MediaGalleryPreviewMedia.tsx')
const source = fs.readFileSync(file, 'utf8')
const start = source.indexOf('const mediaPosterConcurrency = 3')
const end = source.indexOf('\nasync function captureVideoPoster(', start)
assert.ok(start >= 0 && end > start, 'the real bounded Gallery video-poster queue must exist')
const extracted = [
  "function revokeIfBlob(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url) }",
  source.slice(start, end),
  'export const queueUnderTest = { scheduleMediaPoster, metrics: () => ({active: mediaPosterActive, queued: mediaPosterQueue.length}) }',
].join('\n')
const compiled = ts.transpileModule(extracted, {
  fileName: 'RealMediaPosterQueue.ts',
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText
const moduleRef = {exports: {}}
new Function('module', 'exports', compiled)(moduleRef, moduleRef.exports)
const {scheduleMediaPoster, metrics} = moduleRef.exports.queueUnderTest
const flush = async () => { await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)) }
function deferred() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return {promise, resolve}
}
test('cancelled video poster with non-cooperative transport does not starve a new visible poster', async () => {
  const old = Array.from({length:3}, () => deferred())
  const signalled = []
  const started = []
  const active = old.map((pending, index) => scheduleMediaPoster(signal => {
    started.push('old-' + index)
    signalled.push(signal)
    return pending.promise
  }))
  assert.deepEqual(started, ['old-0','old-1','old-2'])
  assert.equal(metrics().active, 3)
  const incoming = scheduleMediaPoster(async () => { started.push('incoming'); return 'blob:current' })
  assert.equal(metrics().queued, 1)
  assert.ok(!started.includes('incoming'))
  for (const task of active) task.cancel()
  assert.deepEqual(await Promise.all(active.map(task => task.promise)), [null,null,null])
  assert.equal(signalled.every(signal => signal.aborted), true)
  await flush()
  assert.ok(started.includes('incoming'), 'new poster must start even if every aborted old request hangs')
  assert.equal(await incoming.promise, 'blob:current')
  await flush()
  assert.deepEqual(metrics(), {active:0, queued:0})
  old.forEach(row => row.resolve(null))
})
test('late cancelled completion revokes stale Blob without freeing a replacement slot twice', async () => {
  const old = Array.from({length:3}, () => deferred())
  const pendingNew = deferred()
  const pendingNext = deferred()
  const started = []
  const revocations = []
  const originalRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = url => { revocations.push(url) }
  const tasks = old.map((pending,index) => scheduleMediaPoster(() => {
    started.push('old-' + index)
    return pending.promise
  }))
  const first = scheduleMediaPoster(() => { started.push('first'); return pendingNew.promise })
  const second = scheduleMediaPoster(() => { started.push('second'); return pendingNext.promise })
  try {
    tasks[0].cancel()
    await flush()
    assert.ok(started.includes('first'))
    tasks[1].cancel()
    await flush()
    assert.ok(started.includes('second'))
    assert.equal(metrics().active, 3)
    old[0].resolve('blob:late-old-owner')
    await flush()
    assert.ok(revocations.includes('blob:late-old-owner'), 'late obsolete Owner data must be revoked')
    assert.equal(metrics().active, 3, 'late completion cannot release the current poster slot')
    const third = scheduleMediaPoster(() => { started.push('third'); return Promise.resolve('blob:third') })
    assert.ok(!started.includes('third'), 'all three live slots are still owned')
    pendingNew.resolve('blob:first')
    assert.equal(await first.promise, 'blob:first')
    await flush()
    assert.ok(started.includes('third'), 'genuine completion releases one live slot')
    assert.equal(await third.promise, 'blob:third')
    old[2].resolve(null)
    pendingNext.resolve('blob:second')
    assert.equal(await second.promise, 'blob:second')
    await flush()
    assert.equal(metrics().active, 0)
  } finally {
    tasks.forEach(task => task.cancel())
    first.cancel()
    second.cancel()
    old.forEach(row => row.resolve(null))
    pendingNew.resolve(null)
    pendingNext.resolve(null)
    await flush()
    URL.revokeObjectURL = originalRevoke
  }
})
test('poster read cleanup uses pre-paint layout effect, without changing passive visibility tracking', () => {
  const component = source.slice(
    source.indexOf('export function XDriveMediaAsyncVideoPoster'),
    source.indexOf('\nexport function xDriveMediaFallback'),
  )
  assert.match(source.split('\n')[0], /useLayoutEffect/)
  assert.match(component, /useLayoutEffect\(\(\) => \{\s*\/\/ Poster lookup/,
    'Viewer suspend must abort the old video read before Viewer paint')
  assert.match(component, /scheduled\.cancel\(\)/)
  assert.match(component, /useEffect\(\(\) => \{\s*setVisible\(false\)/,
    'visibility observer remains passive and must not start original reads itself')
})
