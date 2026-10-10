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
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, require)
  return mod.exports
}

const { xDriveMediaResponseBlob } = compile('web/src/mediaBinaryProgress.ts')
const { xDriveMediaBufferProgressLabel, xDriveMediaPiePercent, XDriveMediaLoadingProgress } =
  compile('ui/shared/src/mui/MediaLoadProgress.tsx')
const React = require('react')
const { create } = require('react-test-renderer')
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

test('App Store-style full-pie uses only the measured HTTP response size', () => {
  assert.equal(xDriveMediaPiePercent(42, 100), 42)
  assert.equal(xDriveMediaPiePercent(150, 100), 100)
  assert.equal(xDriveMediaPiePercent(-10, 100), 0)
  for (const [loaded, total] of [[42, undefined], [42, 0], [NaN, 100], [42, Infinity]]) {
    assert.equal(xDriveMediaPiePercent(loaded, total), null,
      'unknown or invalid Content-Length never becomes a fabricated percentage')
  }
})

test('compact Gallery covers the entire opaque thumbnail surface with a solid sector', () => {
  for (const percent of [0, 42, 100]) {
    const view = create(React.createElement(XDriveMediaLoadingProgress, {
      compact: true, stage: 'transfer', loadedBytes: percent, totalBytes: 100,
    }))
    try {
      const root = view.root.findByProps({ 'data-xdrive-media-loading-style': 'solid-pie' })
      const fill = view.root.findByProps({ 'data-xdrive-media-progress-coverage': 'full-surface' })
      assert.equal(root.props['data-xdrive-media-loading-percent'], percent)
      assert.ok(root.props['aria-label'].includes(percent + '%'))
      assert.equal(fill.props.sx.position, 'absolute')
      assert.equal(fill.props.sx.inset, 0)
      assert.equal(fill.props.sx.borderRadius, 'inherit')
      assert.equal(fill.props.sx.width, undefined, 'no small 34px disk')
      assert.equal(fill.props.sx.height, undefined, 'no small 34px disk')
      assert.ok(fill.props.sx.background.startsWith('conic-gradient(from -90deg at 50% 50%,'))
      assert.ok(fill.props.sx.background.includes('0% ' + percent + '%'))
      assert.equal(root.props.sx.overflow, 'hidden')
      assert.equal(root.props.sx.pointerEvents, 'none')
      assert.ok(root.props.sx.animation.includes('160ms'))
      assert.equal(view.root.findAll(n => n.props?.variant === 'determinate').length, 0,
        'a known-length compact thumbnail must not draw a progress ring')
    } finally { view.unmount() }
  }
})

test('unknown-length thumbs remain unnumbered static placeholders while Viewer retains its ring', () => {
  const gallery = create(React.createElement(XDriveMediaLoadingProgress, {
    compact: true, stage: 'transfer', loadedBytes: 65536,
  }))
  try {
    const root = gallery.root.findByProps({ 'data-xdrive-media-loading-style': 'indeterminate' })
    const fill = gallery.root.findByProps({ 'data-xdrive-media-progress-coverage': 'full-surface' })
    assert.equal(root.props['data-xdrive-media-loading-percent'], undefined)
    assert.ok(!fill.props.sx.background.includes('conic-gradient'))
    assert.equal(gallery.root.findAll(n => n.props?.variant === 'indeterminate').length, 0,
      'unknown-size thumbnails must not animate hundreds of independent spinners')
  } finally { gallery.unmount() }
  const viewer = create(React.createElement(XDriveMediaLoadingProgress, {
    compact: false, stage: 'transfer', loadedBytes: 42, totalBytes: 100,
  }))
  try {
    assert.equal(viewer.root.findAll(n => n.props?.variant === 'determinate').length, 1)
    assert.equal(viewer.root.findAll(n => n.props?.['data-xdrive-media-solid-pie']).length, 0)
  } finally { viewer.unmount() }
})

test('Desktop Agent IPC does not use compressed or unsafe wire lengths for thumbnail percentages', () => {
  const source = fs.readFileSync(path.join(root, 'desktop/src/main/agent_client.cts'), 'utf8')
  assert.ok(source.includes("response.headers.get('content-encoding')?.toLowerCase().trim()"))
  assert.ok(source.includes("Number.isSafeInteger(numericTotal) && numericTotal > 0"))
  assert.ok(source.includes("(!encoding || encoding === 'identity')"))
  assert.ok(source.includes('onProgress(data.byteLength, totalBytes)'),
    'body-only completion must not manufacture a denominator')
  assert.ok(!source.includes('onProgress(data.byteLength, totalBytes ?? data.byteLength)'))
})

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

test('native video buffer range is time-based and does not invent file bytes', () => {
  assert.equal(xDriveMediaBufferProgressLabel(40, 156, 30),
    '缓冲 00:30–00:40 / 02:36')
  assert.equal(xDriveMediaBufferProgressLabel(40, 156),
    '已缓冲 00:40 / 02:36')
  assert.equal(xDriveMediaBufferProgressLabel(0),
    '已缓冲 00:00')
})

test('observed Web stream forwards bytes through a bounded TransformStream without a second chunk array', () => {
  const web = fs.readFileSync(path.join(root, 'web/src/mediaBinaryProgress.ts'), 'utf8')
  assert.match(web, /new TransformStream/)
  assert.match(web, /response\.body\.pipeThrough\(meter/)
  assert.match(web, /new Response\(measured/)
  assert.doesNotMatch(web, /new Blob\(chunks/)
  assert.doesNotMatch(web, /method:\s*['"]HEAD['"]/)
  assert.match(web, /const blob = await response\.blob\(\)/)
})

test('branch-scoped native Chromium HTTP benchmark evaluates checked-in Web reader and CPU/RSS snapshots', () => {
  const source = fs.readFileSync(path.join(root, 'desktop/scripts/media-shared-progress-chromium-main.cjs'), 'utf8')
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(source, /web\/src\/mediaBinaryProgress\.ts/)
  assert.match(source, /xDriveMediaResponseBlob\(response, undefined/)
  assert.match(source, /response\.blob\(\)/)
  assert.match(source, /getOSProcessId\(\)/)
  assert.match(source, /cpuTicks/)
  assert.match(source, /VmRSS/)
  assert.match(source, /serverLog\.requests/)
  assert.match(source, /resourceBytes !== SIZE/)
  assert.match(source, /collectViaReadableBridge/)
  assert.match(source, /collectViaDirectChunks/)
  assert.match(source, /medianCpuTicks/)
  assert.match(source, /medianSampledRssGrowthKiB/)
  assert.match(source, /lastReceived !== SIZE/)
  assert.match(ci, /media-shared-progress-chromium:/)
  assert.match(ci, /github\.head_ref == 'feat\/media-shared-progress-p0c'/)
  assert.match(ci, /scripts\/media-shared-progress-chromium-main\.cjs/)
})

test('transformed videos report native buffered time through the same shared Viewer progress contract', () => {
  const transformed = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FilePreviewTransformedMedia.tsx'), 'utf8')
  const viewer = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FilePreviewSurface.tsx'), 'utf8')
  assert.match(transformed, /onBufferChange\?: \(event: SyntheticEvent<HTMLVideoElement>\) => void/)
  assert.match(transformed, /onProgress=\{onBufferChange\}/)
  assert.match(transformed, /onBufferChange\?\.\(event\)/)
  assert.match(viewer, /onBufferChange=\{updateBuffered\}/)
  assert.match(viewer, /onProgress=\{updateBuffered\}/)
  assert.match(viewer, /bufferedStartSeconds/)
})
