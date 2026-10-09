'use strict'

// P4 measurement ONLY: same original 4K codecs and 6s/60s durations as P3,
// but two 3-second low-bitrate H.264 preview candidates. No product change.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')
const { app, BrowserWindow } = require('electron')

const workload = Object.freeze({
  logicalVideoNamespace: 100_000,
  width: 3840, height: 2160, fps: 8, sourceGOPFrames: 48,
  sourceSeconds: 6, longSeconds: 60, previewStartSeconds: 0.75,
  previewSeconds: 3, samples: 3, quickPassMs: 150, hoverDelayMs: 400,
  playMs: 350, abandonAfterMs: 125, delayedBodyMs: 900,
  abortObserveMs: 160, firstFrameTimeoutMs: 9000,
  previewByteBudget: 1024 * 1024, warmFirstFrameBudgetMs: 2000,
  offlineGenerationMedianBudgetMs: 3000,
})
const profiles = Object.freeze([
  { id: '480p-450k', height: 480, bitrate: '450k', maxrate: '600k', bufsize: '900k' },
  { id: '720p-850k', height: 720, bitrate: '850k', maxrate: '1100k', bufsize: '1700k' },
])
const fixtureSpecs = [
  { id: 'h264-4k-6s', codec: 'h264', seconds: 6 },
  { id: 'hevc-4k-6s', codec: 'hevc', seconds: 6 },
  { id: 'h264-4k-60s', codec: 'h264', seconds: 60 },
  { id: 'hevc-4k-60s', codec: 'hevc', seconds: 60 },
]
const outDir = path.resolve(__dirname, '../perf-results')
const fixtureDir = path.join(outDir, 'gallery-short-preview-4k-fixtures')
fs.mkdirSync(fixtureDir, { recursive: true })
const artifacts = new Map()
const fixtures = []
const generations = []
const previewDetails = []
const counters = new Map()

function run(cmd, args, timeout = 240000) {
  const begin = performance.now()
  const result = spawnSync(cmd, args, {
    encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(cmd + ' failed: ' +
      (result.error?.message || result.stderr?.slice(-2200) || result.status))
  }
  return { stdout: result.stdout, stderr: result.stderr, ms: performance.now() - begin }
}

function probe(file) {
  const info = JSON.parse(run('ffprobe', [
    '-v', 'error', '-show_entries',
    'format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,pix_fmt',
    '-of', 'json', file,
  ]).stdout)
  const stream = info.streams?.[0]
  if (!stream || !info.format) throw new Error('Missing video stream: ' + file)
  return {
    codec: stream.codec_name, width: stream.width, height: stream.height,
    fps: stream.r_frame_rate, pixFmt: stream.pix_fmt,
    duration: Number(info.format.duration),
    size: fs.statSync(file).size, bitrate: Number(info.format.bit_rate),
  }
}

function generateSources() {
  for (const codec of ['h264', 'hevc']) {
    const id = codec + '-4k-6s'
    const shortFile = path.join(fixtureDir, id + '.mp4')
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=8',
      '-t', '6', '-an', '-c:v', codec === 'h264' ? 'libx264' : 'libx265',
      '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p',
      '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
      '-b:v', '12M', '-maxrate', '18M', '-bufsize', '24M',
    ]
    if (codec === 'hevc') args.push('-x265-params',
      'pools=2:frame-threads=2:keyint=48:min-keyint=48:scenecut=0:log-level=error')
    args.push('-tag:v', codec === 'h264' ? 'avc1' : 'hvc1',
      '-movflags', '+faststart', shortFile)
    const generation = run('ffmpeg', args)
    artifacts.set(id + '/original', shortFile)
    const longId = codec + '-4k-60s'
    const longFile = path.join(fixtureDir, longId + '.mp4')
    const longGeneration = run('ffmpeg', [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-stream_loop', '9', '-i', shortFile, '-c', 'copy',
      '-movflags', '+faststart', longFile,
    ])
    artifacts.set(longId + '/original', longFile)
    fixtures.push({ id, ...probe(shortFile), sourceGenerationMs: generation.ms })
    fixtures.push({ id: longId, ...probe(longFile),
      sourceGenerationMs: longGeneration.ms, copiedGOPs: 10 })
  }
  for (const spec of fixtureSpecs) {
    const item = fixtures.find(f => f.id === spec.id)
    if (!item || item.codec !== spec.codec || item.width !== workload.width ||
        item.height !== workload.height ||
        Math.abs(item.duration - spec.seconds) > 0.3) {
      throw new Error('4K source fixture identity mismatch: ' + spec.id)
    }
  }
}

function generatePreviews() {
  for (const spec of fixtureSpecs) {
    const source = artifacts.get(spec.id + '/original')
    for (const profile of profiles) {
      const rows = []
      for (let sample = 1; sample <= workload.samples; sample++) {
        const output = path.join(fixtureDir, spec.id + '-' + profile.id +
          '-sample-' + sample + '.mp4')
        // Seek after opening input to retain exact output timing from a 6s GOP.
        // No audio; two-second keyframe GOP inside the short preview.
        const r = run('ffmpeg', [
          '-hide_banner', '-nostdin', '-benchmark', '-loglevel', 'info', '-y',
          '-i', source, '-ss', String(workload.previewStartSeconds),
          '-t', String(workload.previewSeconds),
          '-vf', 'scale=-2:' + profile.height + ',fps=8',
          '-an', '-c:v', 'libx264', '-preset', 'veryfast',
          '-threads', '2', '-pix_fmt', 'yuv420p',
          '-g', '16', '-keyint_min', '16', '-sc_threshold', '0',
          '-b:v', profile.bitrate, '-maxrate', profile.maxrate,
          '-bufsize', profile.bufsize, '-tag:v', 'avc1',
          '-movflags', '+faststart', output,
        ])
        const p = probe(output)
        if (p.codec !== 'h264' || p.height !== profile.height ||
            p.width <= 0 || p.width >= workload.width ||
            p.duration < 2.75 || p.duration > 3.2) {
          throw new Error('Preview not a usable 3s H.264 derivative: ' + output +
            ' ' + JSON.stringify(p))
        }
        const bench = r.stderr.match(/bench:\s*utime=([\d.]+)s\s+stime=([\d.]+)s\s+rtime=([\d.]+)s/)
        const rss = r.stderr.match(/bench:\s*maxrss=(\d+)kB/)
        const sha256 = crypto.createHash('sha256')
          .update(fs.readFileSync(output)).digest('hex')
        const measured = {
          asset: spec.id, profile: profile.id, sample,
          generationMs: r.ms, ffmpegUserSeconds: bench ? Number(bench[1]) : null,
          ffmpegSystemSeconds: bench ? Number(bench[2]) : null,
          ffmpegMaxRssKB: rss ? Number(rss[1]) : null,
          sha256, ...p,
        }
        rows.push(measured)
        generations.push(measured)
        console.log('GALLERY_SHORT_GEN ' + JSON.stringify(measured))
        if (sample === workload.samples) artifacts.set(spec.id + '/' + profile.id, output)
      }
      previewDetails.push({
        asset: spec.id, profile: profile.id,
        medianGenerationMs: median(rows.map(x => x.generationMs)),
        latestBytes: rows[rows.length - 1].size,
        stableSha: rows.every(x => x.sha256 === rows[0].sha256),
      })
    }
  }
}

function meter(key) {
  if (!counters.has(key)) counters.set(key, {
    requests: 0, active: 0, peakActive: 0, earlyClosed: 0,
    responseBytes: 0, requestedBytes: 0, ranges: [],
  })
  return counters.get(key)
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  const file = artifacts.get(u.searchParams.get('asset') + '/' +
    u.searchParams.get('profile'))
  if (!file) { res.writeHead(404); res.end(); return }
  const row = meter(u.searchParams.get('key') || 'no-scenario')
  const size = fs.statSync(file).size
  const range = req.headers.range || ''
  const match = /^bytes=(\d+)-(\d*)$/.exec(range)
  const start = match ? Number(match[1]) : 0
  const end = match && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  row.requests++
  row.active++
  row.peakActive = Math.max(row.peakActive, row.active)
  row.ranges.push(range)
  row.requestedBytes += Math.max(0, end - start + 1)
  let finished = false
  let timer = null
  let stream = null
  res.on('close', () => {
    if (timer) clearTimeout(timer)
    stream?.destroy()
    row.active--
    if (!finished) row.earlyClosed++
  })
  if (!Number.isSafeInteger(start) || start < 0 ||
      !Number.isSafeInteger(end) || end < start || start >= size) {
    finished = true
    res.writeHead(416, { 'Content-Range': 'bytes */' + size })
    res.end()
    return
  }
  const serve = () => {
    if (res.destroyed) return
    const headers = {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    }
    if (match) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size
    res.writeHead(match ? 206 : 200, headers)
    stream = fs.createReadStream(file, { start, end, highWaterMark: 64 * 1024 })
    stream.on('data', chunk => {
      if (res.destroyed) return
      row.responseBytes += chunk.length // emitted, not acknowledged TCP bytes
      if (!res.write(chunk)) stream.pause()
    })
    res.on('drain', () => stream?.resume())
    stream.on('end', () => { if (!res.destroyed) { finished = true; res.end() } })
    stream.on('error', error => { if (!res.destroyed) res.destroy(error) })
  }
  if (u.searchParams.get('mode') === 'abandon') {
    timer = setTimeout(serve, workload.delayedBodyMs)
  } else serve()
})
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const median = values => {
  const a = [...values].sort((x, y) => x - y)
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
}

function rendererTrial(input) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  return (async () => {
    const row = {
      loaded: false, firstFrameMs: null, decodedFrames: 0,
      videoWidth: 0, videoHeight: 0, canPlayType: '',
      mediaElementsPeak: 0, mediaElementsAfter: 0, error: '',
    }
    if (input.mode === 'quick') {
      await pause(input.quickPassMs)
      row.mediaElementsAfter = document.querySelectorAll('video').length
      return row
    }
    await pause(input.hoverDelayMs)
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'none'
    video.muted = true
    video.playsInline = true
    video.autoplay = false
    video.style.cssText = 'position:absolute;left:0;top:0;width:320px;height:180px'
    document.body.appendChild(video)
    row.mediaElementsPeak = document.querySelectorAll('video').length
    row.canPlayType = video.canPlayType(input.isOriginalHevc
      ? 'video/mp4; codecs="hvc1"' : 'video/mp4; codecs="avc1.42E01E"')
    const loaded = new Promise(resolve => {
      video.addEventListener('loadeddata', () => resolve('ready'), { once: true })
      video.addEventListener('error', () => resolve('error'), { once: true })
    })
    const started = performance.now()
    try {
      video.preload = 'auto'
      video.src = input.url
      video.load()
      if (input.mode === 'abandon') await pause(input.abandonAfterMs)
      else {
        const ready = await Promise.race([
          loaded, pause(input.firstFrameTimeoutMs).then(() => 'timeout'),
        ])
        row.loaded = ready === 'ready'
        if (row.loaded) {
          row.firstFrameMs = performance.now() - started
          row.videoWidth = video.videoWidth
          row.videoHeight = video.videoHeight
          try {
            await video.play()
            await pause(input.playMs)
            row.decodedFrames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0
          } catch (error) {
            row.error = 'play:' + String(error)
          }
        } else {
          row.error = ready + (video.error ? ':media-error-' + video.error.code : '')
        }
      }
    } finally {
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      row.mediaElementsAfter = document.querySelectorAll('video').length
    }
    return row
  })()
}

function appMemoryKiB() {
  try {
    return app.getAppMetrics().reduce((n, item) =>
      n + (Number(item.memory?.workingSetSize) || 0), 0)
  } catch { return null }
}
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

async function main() {
  generateSources()
  generatePreviews()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const host = 'http://127.0.0.1:' + server.address().port
  const window = new BrowserWindow({
    width: 1280, height: 800, show: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false,
      sandbox: false, backgroundThrottling: false },
  })
  const nativeRows = []
  try {
    await window.loadURL('data:text/html,<html><body style="margin:0"></body></html>')
    for (const asset of fixtureSpecs) {
      for (const profile of ['original', ...profiles.map(x => x.id)]) {
        const modes = profile === 'original' ? ['play'] : ['quick', 'play', 'abandon']
        for (const mode of modes) {
          for (let sample = 1; sample <= workload.samples; sample++) {
            const key = asset.id + '-' + profile + '-' + mode + '-' + sample
            const before = appMemoryKiB()
            const input = {
              ...workload, mode, isOriginalHevc:
                profile === 'original' && asset.codec === 'hevc',
              url: host + '/preview?asset=' + encodeURIComponent(asset.id) +
                '&profile=' + encodeURIComponent(profile) +
                '&mode=' + mode + '&key=' + encodeURIComponent(key),
            }
            const started = performance.now()
            const measured = await window.webContents.executeJavaScript(
              '(' + rendererTrial.toString() + ')(' + JSON.stringify(input) + ')', true)
            await pause(workload.abortObserveMs)
            const after = appMemoryKiB()
            const row = {
              asset: asset.id, profile, mode, sample, ...measured,
              elapsedMs: performance.now() - started,
              memoryDeltaKiB: before == null || after == null ? null : after - before,
              network: { ...meter(key) },
            }
            nativeRows.push(row)
            console.log('GALLERY_SHORT_NATIVE ' + JSON.stringify(row))
          }
        }
      }
    }
    const originals = nativeRows.filter(x => x.profile === 'original')
    const candidate = nativeRows.filter(x => x.profile !== 'original')
    const quick = candidate.filter(x => x.mode === 'quick')
    const played = candidate.filter(x => x.mode === 'play')
    const abandoned = candidate.filter(x => x.mode === 'abandon')
    const sameRunnerComparisons = []
    for (const asset of fixtureSpecs.filter(x => x.codec === 'h264')) {
      const originalsForAsset = originals.filter(x => x.asset === asset.id)
      const originalMedianBytes = median(originalsForAsset.map(x => x.network.responseBytes))
      for (const profile of profiles) {
        const previewForAsset = played.filter(x =>
          x.asset === asset.id && x.profile === profile.id)
        const previewMedianBytes = median(previewForAsset.map(x => x.network.responseBytes))
        sameRunnerComparisons.push({
          asset: asset.id, profile: profile.id,
          originalMedianBytes, previewMedianBytes,
          byteReductionFactor: previewMedianBytes > 0
            ? originalMedianBytes / previewMedianBytes : 0,
        })
      }
    }
    const verdict = {
      atLeastEightfoldH264ByteReduction: sameRunnerComparisons.length === 4 &&
        sameRunnerComparisons.every(x => x.byteReductionFactor >= 8),
      originalH264ComparisonLoaded: originals.filter(x => x.asset.startsWith('h264'))
        .every(x => x.loaded && x.videoWidth === workload.width),
      previewSourcesValid: previewDetails.length === 8 && generations.length === 24,
      quickPassZeroGet: quick.length === 24 && quick.every(x =>
        x.network.requests === 0 && x.network.responseBytes === 0),
      previewH264Decoded: played.length === 24 && played.every(x =>
        x.loaded && x.decodedFrames > 0 && x.videoHeight ===
          profiles.find(profile => profile.id === x.profile).height),
      abandonedCancelTransport: abandoned.length === 24 && abandoned.every(x =>
        x.network.requests >= 1 && x.network.active === 0 &&
        x.network.responseBytes === 0 &&
        x.network.earlyClosed === x.network.requests),
      maxOneVideoElement: nativeRows.every(x =>
        x.mediaElementsPeak <= 1 && x.mediaElementsAfter === 0),
      previewWithinOneMiB: played.every(x =>
        x.network.responseBytes <= workload.previewByteBudget) &&
        generations.every(x => x.size <= workload.previewByteBudget),
      nativeWarmFirstFrameWithinTwoSeconds: played.filter(x => x.sample > 1)
        .every(x => x.firstFrameMs != null &&
          x.firstFrameMs <= workload.warmFirstFrameBudgetMs),
      offlineGenerationWithinThreeSeconds: previewDetails.every(x =>
        x.medianGenerationMs <= workload.offlineGenerationMedianBudgetMs),
    }
    const report = {
      status: 'P4 synthetic candidate feasibility; no production short preview or hover',
      workload, profiles,
      provenance: {
        ffmpeg: run('ffmpeg', ['-version']).stdout.split('\n')[0],
        ffprobe: run('ffprobe', ['-version']).stdout.split('\n')[0],
        note: 'Actual 4K synthetic encoded pixels, same P3 source parameters; not camera footage, HDR/VFR, real Go handler, signed ticket, Desktop Agent proxy or physical mobile',
      },
      fixtures, generations, previewDetails, nativeRows,
      sameRunnerComparisons, verdict,
      decision: Object.values(verdict).every(Boolean)
        ? 'Synthetic resource gates met; NO production activation without native Server/Agent/device/storage validation'
        : 'At least one synthetic short-preview resource gate failed; retain static posters',
      diagnostics: [
        'Generation is performed offline on the CI runner, not on demand in the xDrive Server',
        'Source copies repeat a six-second GOP; this is not a continuous 60-second GOP',
        'App working-set delta is not isolated video decoder memory or CPU',
        'Server HTTP bytes are emitted bytes, not confirmed client TCP bytes',
        'Poster selection quality and HEVC device compatibility are not measured',
        'No user-facing preview feature, persisted transcode cache or new stream API is installed',
      ],
    }
    if (fixtures.length !== 4 || generations.length !== 24 ||
        nativeRows.length !== 84 || originals.length !== 12 ||
        candidate.length !== 72 || quick.length !== 24 ||
        played.length !== 24 || abandoned.length !== 24) {
      throw new Error('Short-preview benchmark incomplete, no measurements accepted')
    }
    const out = path.join(outDir, 'gallery-hover-short-preview-4k.json')
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
    console.log('GALLERY_SHORT_REPORT ' + JSON.stringify({
      verdict, decision: report.decision,
      fixtures: fixtures.length, generationSamples: generations.length,
      nativeSamples: nativeRows.length,
    }))
  } finally {
    window.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
app.whenReady().then(async () => {
  try { await main(); app.exit(0) }
  catch (error) { console.error(error); app.exit(1) }
})
