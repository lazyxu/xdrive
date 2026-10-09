'use strict'

// P3 measurement ONLY. Generates actual 3840x2160 H.264/HEVC source bytes
// on the benchmark runner. No production Gallery hover/player is installed.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { performance } = require('node:perf_hooks')
const { execFileSync } = require('node:child_process')
const { app, BrowserWindow } = require('electron')

const workload = Object.freeze({
  logicalVideoNamespace: 100_000,
  samplesPerMode: 3,
  width: 3840,
  height: 2160,
  fps: 8,
  segmentSeconds: 6,
  longVideoSeconds: 60,
  keyframeIntervalFrames: 48,
  targetBitrateBitsPerSecond: 12_000_000,
  quickPassMs: 150,
  hoverDelayMs: 400,
  activePlayMs: 350,
  delayedResponseMs: 900,
  cancelAfterStartMs: 125,
  abortObservationMs: 160,
  firstFrameDeadlineMs: 9000,
  bytesPerHoverPromotionBudget: 8 * 1024 * 1024,
  warmFirstFramePromotionBudgetMs: 2000,
  memoryDiagnosticBudgetKiB: 128 * 1024,
})
const outDir = path.resolve(__dirname, '../perf-results')
const sourceDir = path.join(outDir, 'hover-4k-synthetic-source')
fs.mkdirSync(sourceDir, { recursive: true })
const filename = (id) => path.join(sourceDir, id + '.mp4')
const fixtures = [
  { id: 'h264-4k-6s', codec: 'h264', repeats: 1 },
  { id: 'hevc-4k-6s', codec: 'hevc', repeats: 1 },
  { id: 'h264-4k-60s', codec: 'h264', repeats: 10 },
  { id: 'hevc-4k-60s', codec: 'hevc', repeats: 10 },
]
const fixturePaths = new Map()
const fixtureDetails = []

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(cmd + ' ' + args.join(' ') + ': ' +
      (error.stderr?.toString()?.slice(-2400) || String(error)))
  }
}

function makeFixtures() {
  // Reproducible moving 4K synthetic pixels. Long files concatenate ten
  // 6-second segments by stream copy; GOP length is 48 frames / 6 seconds,
  // not a 60-second contiguous single-GOP clip nor real camera footage.
  for (const codec of ['h264', 'hevc']) {
    const id = codec + '-4k-6s'
    const output = filename(id)
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=8',
      '-t', String(workload.segmentSeconds), '-an',
      '-c:v', codec === 'h264' ? 'libx264' : 'libx265',
      '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-threads', '2', '-g', '48', '-keyint_min', '48',
      '-sc_threshold', '0',
      '-b:v', '12M', '-maxrate', '18M', '-bufsize', '24M',
    ]
    if (codec === 'hevc') {
      args.push('-x265-params',
        'pools=2:frame-threads=2:keyint=48:min-keyint=48:scenecut=0:log-level=error')
    }
    args.push('-tag:v', codec === 'hevc' ? 'hvc1' : 'avc1',
      '-movflags', '+faststart', output)
    run('ffmpeg', args)
    fixturePaths.set(id, output)
    const long = filename(codec + '-4k-60s')
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-stream_loop', '9', '-i', output, '-c', 'copy',
      '-movflags', '+faststart', long,
    ])
    fixturePaths.set(codec + '-4k-60s', long)
  }
  for (const spec of fixtures) {
    const probe = JSON.parse(run('ffprobe', [
      '-v', 'error', '-show_entries',
      'format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate',
      '-of', 'json', fixturePaths.get(spec.id),
    ]))
    const stream = probe.streams?.[0]
    const expectedCodec = spec.codec === 'h264' ? 'h264' : 'hevc'
    if (stream?.codec_name !== expectedCodec ||
      stream.width !== workload.width || stream.height !== workload.height) {
      throw new Error('Generated video metadata does not match: ' + spec.id)
    }
    if (Number(probe.format?.duration) < spec.repeats * 5.9) {
      throw new Error('Generated video duration unexpectedly short: ' + spec.id)
    }
    const bytes = fs.statSync(fixturePaths.get(spec.id)).size
    fixtureDetails.push({
      ...spec, width: stream.width, height: stream.height,
      frameRate: stream.r_frame_rate, seconds: Number(probe.format.duration),
      bytes, bitrate: Number(probe.format.bit_rate),
      keyframeIntervalFrames: workload.keyframeIntervalFrames,
      repeatedStreamCopy: spec.repeats > 1,
    })
  }
}

const scenarios = new Map()
function counter(key) {
  if (!scenarios.has(key)) {
    scenarios.set(key, {
      requests: 0, active: 0, peakActive: 0, earlyClosed: 0,
      completed: 0, responseBytes: 0, requestedBytes: 0, ranges: [],
    })
  }
  return scenarios.get(key)
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const id = url.pathname.slice(1).replace(/\.mp4$/, '')
  const file = fixturePaths.get(id)
  const key = url.searchParams.get('scenario') || 'missing'
  const row = counter(key)
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Fixture missing')
    return
  }
  const size = fs.statSync(file).size
  const rangeHeader = req.headers.range || ''
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
  const start = match ? Number(match[1]) : 0
  const end = match && match[2]
    ? Math.min(size - 1, Number(match[2])) : size - 1
  row.requests += 1
  row.active += 1
  row.peakActive = Math.max(row.peakActive, row.active)
  row.ranges.push(rangeHeader)
  row.requestedBytes += Math.max(0, end - start + 1)
  let finished = false
  let timer = null
  let stream = null
  res.on('close', () => {
    if (timer) clearTimeout(timer)
    stream?.destroy()
    row.active -= 1
    if (!finished) row.earlyClosed += 1
  })
  if (!Number.isSafeInteger(start) || start < 0 ||
      !Number.isSafeInteger(end) || start >= size || end < start) {
    finished = true
    res.writeHead(416, { 'Content-Range': 'bytes */' + size })
    res.end()
    return
  }
  const write = () => {
    if (res.destroyed) return
    const headers = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*',
    }
    if (match) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size
    res.writeHead(match ? 206 : 200, headers)
    stream = fs.createReadStream(file, { start, end, highWaterMark: 64 * 1024 })
    stream.on('data', (chunk) => {
      if (res.destroyed) return
      row.responseBytes += chunk.length // server-emitted bytes, not client TCP ACK
      if (!res.write(chunk)) stream.pause()
    })
    res.on('drain', () => stream?.resume())
    stream.on('end', () => {
      if (res.destroyed) return
      finished = true
      row.completed += 1
      res.end()
    })
    stream.on('error', (error) => {
      if (!res.destroyed) res.destroy(error)
    })
  }
  if (key.includes('-abandon-')) timer = setTimeout(write, workload.delayedResponseMs)
  else write()
})

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
function rendererTrial(input) {
  const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  return (async () => {
    const result = {
      mode: input.mode, codec: input.codec,
      canPlayType: '', loaded: false, assignedSource: false,
      firstFrameMs: null, decodedFrames: 0, videoWidth: 0, videoHeight: 0,
      mediaElementsPeak: 0, mediaElementsAfter: 0, error: '',
    }
    if (input.mode === 'quick-pass') {
      await pause(input.quickPassMs)
      result.mediaElementsAfter = document.querySelectorAll('video').length
      return result
    }
    await pause(input.hoverDelayMs)
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'none'
    video.muted = true
    video.playsInline = true
    video.autoplay = false
    video.loop = false
    video.style.cssText = 'width:320px;height:180px;position:absolute;left:0;top:0'
    document.body.appendChild(video)
    result.mediaElementsPeak = document.querySelectorAll('video').length
    result.canPlayType = video.canPlayType(input.codec === 'hevc'
      ? 'video/mp4; codecs="hvc1"'
      : 'video/mp4; codecs="avc1.42E01E"')
    let resolveReady
    const ready = new Promise(resolve => { resolveReady = resolve })
    video.addEventListener('loadeddata', () => resolveReady('ready'), { once: true })
    video.addEventListener('error', () => resolveReady('error'), { once: true })
    const started = performance.now()
    try {
      video.preload = 'auto'
      video.src = input.url
      video.load()
      result.assignedSource = true
      if (input.mode === 'abandon') {
        await pause(input.cancelAfterStartMs)
      } else {
        const status = await Promise.race([
          ready,
          pause(input.firstFrameDeadlineMs).then(() => 'timeout'),
        ])
        result.loaded = status === 'ready'
        if (result.loaded) {
          result.firstFrameMs = performance.now() - started
          result.videoWidth = video.videoWidth
          result.videoHeight = video.videoHeight
          try {
            await video.play()
            await pause(input.activePlayMs)
            result.decodedFrames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0
          } catch (err) {
            result.error = 'play: ' + String(err)
          }
        } else {
          result.error = status + (video.error ? ':media-error-' + video.error.code : '')
        }
      }
    } finally {
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      result.mediaElementsAfter = document.querySelectorAll('video').length
    }
    return result
  })()
}

function totalAppMemoryKiB() {
  try {
    const metrics = app.getAppMetrics()
    return metrics.reduce((total, item) =>
      total + (Number(item.memory?.workingSetSize) || 0), 0)
  } catch {
    return null
  }
}

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

async function main() {
  makeFixtures()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = 'http://127.0.0.1:' + server.address().port
  const window = new BrowserWindow({
    width: 1280, height: 800, show: true,
    webPreferences: {
      nodeIntegration: true, contextIsolation: false, sandbox: false,
      backgroundThrottling: false,
    },
  })
  try {
    await window.loadURL('data:text/html,<html><body style="margin:0;background:#1e1e1e"></body></html>')
    const rows = []
    for (const asset of fixtures) {
      for (const mode of ['quick-pass', 'original-play', 'abandon']) {
        for (let sample = 1; sample <= workload.samplesPerMode; sample++) {
          const key = asset.id + '-' + mode + '-' + sample
          const started = performance.now()
          const beforeMemoryKiB = totalAppMemoryKiB()
          const result = await window.webContents.executeJavaScript(
            '(' + rendererTrial.toString() + ')(' +
              JSON.stringify({
                ...workload, mode, codec: asset.codec,
                url: address + '/' + asset.id + '.mp4?scenario=' + key,
              }) + ')',
            true,
          )
          await sleep(workload.abortObservationMs)
          const afterMemoryKiB = totalAppMemoryKiB()
          const network = { ...counter(key) }
          const row = {
            ...result, asset: asset.id, sample,
            elapsedMs: performance.now() - started,
            beforeMemoryKiB, afterMemoryKiB,
            memoryDeltaKiB: beforeMemoryKiB == null || afterMemoryKiB == null
              ? null : afterMemoryKiB - beforeMemoryKiB,
            network,
          }
          rows.push(row)
          console.log('GALLERY_HOVER_4K_SAMPLE ' + JSON.stringify(row))
        }
      }
    }
    const quick = rows.filter(x => x.mode === 'quick-pass')
    const deliberate = rows.filter(x => x.mode === 'original-play')
    const abandoned = rows.filter(x => x.mode === 'abandon')
    const h264Abandoned = abandoned.filter(x => x.codec === 'h264')
    const h264Played = deliberate.filter(x => x.codec === 'h264')
    const verdict = {
      quickPassNoOriginalVideoRequests: quick.every(x => x.network.requests === 0),
      maxOneMediaElement: rows.every(x => x.mediaElementsPeak <= 1 && x.mediaElementsAfter === 0),
      h264OriginalLoads: h264Played.every(x => x.loaded && x.videoWidth === workload.width &&
        x.videoHeight === workload.height),
      h264EarlyDisconnect: h264Abandoned.every(x => x.network.requests > 0 &&
        x.network.active === 0 &&
        x.network.responseBytes === 0 &&
        x.network.earlyClosed === x.network.requests),
      abandonedRequestsRelease: abandoned.every(x => x.network.active === 0),
      abandonedBytesAreZero: abandoned.every(x => x.network.responseBytes === 0),
      withinPromotionByteBudget: deliberate.every(x =>
        x.network.responseBytes <= workload.bytesPerHoverPromotionBudget),
      withinPromotionWarmFirstFrameBudget: h264Played.filter(x => x.sample > 1).every(x =>
        x.loaded && x.firstFrameMs != null &&
        x.firstFrameMs <= workload.warmFirstFramePromotionBudgetMs),
      // App-wide memory delta includes allocator retention, cache/process warmth
      // and unrelated Electron processes; record only, never attribute to one video.
    }
    const hevc = deliberate.filter(x => x.codec === 'hevc')
    const report = {
      status: 'Baseline only / no product Gallery hover enabled',
      workload,
      fixtureGeneration: {
        ffmpeg: run('ffmpeg', ['-version']).split('\n')[0],
        ffprobe: run('ffprobe', ['-version']).split('\n')[0],
        method: 'testsrc2 3840x2160 8fps; ultrafast x264/x265 6s GOP; ten copies by stream_loop for 60s',
        note: 'Synthetic moving pixels and repeated 6s GOPs, not real camera footage or a 60s continuous GOP',
      },
      fixtures: fixtureDetails,
      decision: Object.values(verdict).every(Boolean) && hevc.every(x => x.loaded)
        ? 'Narrow synthetic native trial passes; still require signed-ticket/Web/Desktop and device validation before opt-in UI'
        : 'Do not enable original-video hover: at least one native/synthetic resource or codec budget is not met',
      hevcSupportedSamples: hevc.filter(x => x.loaded).length,
      hevcTotalSamples: hevc.length,
      verdict,
      diagnosticOnly: [
        'App aggregate working-set is not video-only RSS',
        'This does not exercise source Gallery components, signed preview tickets or Agent proxy',
        'No real 4K camera, HDR, variable-fps or hardware-decoder measurements',
        '100k is a logical namespace, not a mounted DOM or 100k simultaneous media elements',
      ],
      rows,
    }
    const out = path.join(outDir, 'gallery-hover-4k-real-codec-trial.json')
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
    console.log('GALLERY_HOVER_4K_REPORT ' + JSON.stringify({
      verdict: report.verdict, decision: report.decision,
      hevcSupportedSamples: report.hevcSupportedSamples,
      hevcTotalSamples: report.hevcTotalSamples,
    }))
    if (!rows.length || !fixtureDetails.length || quick.length !== 12 ||
      !h264Played.length || !h264Abandoned.length) {
      throw new Error('The 4K benchmark workload did not execute fully')
    }
  } finally {
    window.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

app.whenReady().then(async () => {
  try {
    await main()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
