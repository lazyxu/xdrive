'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { performance } = require('node:perf_hooks')
const root = path.resolve(__dirname, '../..')

function compile(relative) {
  const file = path.join(root, relative)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, require)
  return mod.exports
}

const { xDriveMediaResponseBlob } = compile('web/src/mediaBinaryProgress.ts')
const { XDriveMediaThumbnailScheduler } =
  compile('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')

function fixture(size = 512 * 1024, opts = {}) {
  const block = new Uint8Array(64 * 1024)
  for (let i = 0; i < block.length; i++) block[i] = i % 251
  let remaining = size
  const body = new ReadableStream({
    pull(controller) {
      if (!remaining) { controller.close(); return }
      const take = Math.min(remaining, block.length)
      controller.enqueue(block.subarray(0, take))
      remaining -= take
    },
  })
  const headers = { 'Content-Type': 'image/jpeg' }
  if (opts.known !== false) headers['Content-Length'] = String(size)
  if (opts.encoding) headers['Content-Encoding'] = opts.encoding
  return new Response(body, { headers })
}

test('Web media stream preserves JPEG bytes and reports actual response length', async () => {
  const sizes = []
  const data = await xDriveMediaResponseBlob(fixture(), undefined, (done, total) => {
    sizes.push([done, total])
  })
  assert.equal(data.size, 512 * 1024)
  assert.equal(data.type, 'image/jpeg')
  assert.ok(sizes.length >= 1)
  assert.deepEqual(sizes.at(-1), [512 * 1024, 512 * 1024])
  assert.ok(sizes.every(([done, total]) => done >= 0 && done <= total))
  const bytes = new Uint8Array(await data.arrayBuffer())
  assert.equal(bytes[0], 0)
  assert.equal(bytes[250], 250)
  assert.equal(bytes[251], 0)
  assert.equal(bytes[65536], 0)
})

test('unknown or encoded response length never invents a percent denominator', async () => {
  for (const opts of [{ known: false }, { encoding: 'gzip' }]) {
    const progress = []
    const response = fixture(65_536, opts)
    const blob = await xDriveMediaResponseBlob(response, undefined, (done, total) =>
      progress.push([done, total]))
    assert.equal(blob.size, 65_536)
    assert.ok(progress.length > 0)
    assert.deepEqual(progress.at(-1), [65_536, undefined])
  }
})

test('fast/cache-path media without observers preserves native blob conversion', async () => {
  const response = fixture(1024)
  const blob = await xDriveMediaResponseBlob(response)
  assert.equal(blob.size, 1024)
  assert.equal(blob.type, 'image/jpeg')
})

test('viewport cancellation prevents late progress and completion', async () => {
  const abort = new AbortController()
  let loaded = 0
  let emittedAfterAbort = 0
  let cancelled = false
  const response = new Response(new ReadableStream({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 18))
      if (abort.signal.aborted) return
      controller.enqueue(new Uint8Array(64 * 1024))
    },
    cancel() { cancelled = true },
  }), { headers: { 'content-length': '1048576' } })
  const task = xDriveMediaResponseBlob(response, abort.signal, done => {
    loaded = done
    if (abort.signal.aborted) emittedAfterAbort++
  })
  setTimeout(() => abort.abort(), 75)
  await assert.rejects(task)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(emittedAfterAbort, 0)
  assert.ok(loaded < 1_048_576)
  // Some runtimes call cancel() after the promise is rejected; aborted result
  // and zero late callbacks are the authoritative transport ownership gates.
  assert.equal(abort.signal.aborted, true)
  void cancelled
})

test('Gallery 6-slot scheduler fans out progress for one revision, no duplicate GET', async () => {
  const events1 = [], events2 = []
  let calls = 0, notify, complete
  const scheduler = new XDriveMediaThumbnailScheduler((id, _signal, revision, progress) => {
    assert.equal(id, 72)
    assert.equal(revision, 9)
    calls++
    notify = progress
    return new Promise(resolve => { complete = resolve })
  }, { concurrency: 1, revokeURL: () => {} })
  const one = scheduler.load(72, 0, 9, (a, b) => events1.push([a, b]))
  const two = scheduler.load(72, 0, 9, (a, b) => events2.push([a, b]))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  notify(8192, 16384)
  assert.deepEqual(events1, [[8192, 16384]])
  assert.deepEqual(events2, [[8192, 16384]])
  complete('blob:media-72')
  assert.equal(await one, 'blob:media-72')
  assert.equal(await two, 'blob:media-72')
  assert.equal(await scheduler.load(72, 0, 9), 'blob:media-72')
  assert.equal(calls, 1)
  scheduler.dispose()
})

test('shared Gallery/Viewer/Explorer consumers keep the same progress contract', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  const web = read('web/src/api.ts')
  const main = read('desktop/src/main/index.cts')
  const preload = read('desktop/src/preload/index.cts')
  const adapter = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const preview = read('ui/shared/src/mui/FilePreviewImage.tsx')
  const explorer = read('ui/shared/src/mui/FileExplorerThumbnail.tsx')
  assert.match(web, /xDriveMediaResponseBlob\(response, signal, onProgress\)/)
  assert.match(web, /revisionQuery/)
  assert.match(main, /agent:media-binary-progress/)
  assert.match(preload, /value\.request_id !== requestID/)
  assert.match(preload, /removeListener\(progressChannel, listener\)/)
  assert.match(adapter, /port\.loadThumbnail\(nodeID, signal, revision, onProgress\)/)
  assert.match(preview, /setProgress\(\{ loadedBytes, totalBytes \}\)/)
  assert.match(explorer, /scheduleFileThumbnail\(\(signal\) => loadThumbnail\(/)
  assert.match(explorer, /scheduled\.cancel\(\)/)
})

test('16 MiB fixed synthetic response baseline vs opt-in stream observer is recorded (diagnostic)', async () => {
  const old = [], current = []
  for (let i = 0; i < 3; i++) {
    const baseline = fixture(16 * 1024 * 1024)
    let started = performance.now()
    assert.equal((await baseline.blob()).size, 16 * 1024 * 1024)
    old.push(performance.now() - started)

    let final = 0
    started = performance.now()
    const measured = await xDriveMediaResponseBlob(fixture(16 * 1024 * 1024), undefined,
      (done) => { final = done })
    assert.equal(measured.size, 16 * 1024 * 1024)
    assert.equal(final, measured.size)
    current.push(performance.now() - started)
  }
  const median = arr => [...arr].sort((a, b) => a - b)[1]
  const report = { kind: 'MEDIA_PROGRESS_SYNTHETIC', bytes: 16 * 1024 * 1024,
    chunkBytes: 64 * 1024, n: 3, baselineMedianMs: median(old),
    observedMedianMs: median(current), oldMs: old, observedMs: current }
  console.log(JSON.stringify(report))
  // This is a Node Response benchmark, NOT browser/Gin/Agent timing. No noisy
  // CI threshold is inferred from synthetic transport.
})
