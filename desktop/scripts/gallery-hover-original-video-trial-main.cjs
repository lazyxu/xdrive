'use strict'

// P3 measure-first feasibility probe: HTMLVideoElement with original bytes.
// This is intentionally NOT a Gallery hover implementation and uses a tiny
// known H.264 fixture; do not extrapolate these bytes to 4K/HEVC/long-GOP.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { performance } = require('node:perf_hooks')
const { app, BrowserWindow } = require('electron')

const benchmark = Object.freeze({
  samples: 3,
  logicalVideoNamespace: 100_000,
  sampleVideos: 1,
  hoverDelayMs: 400,
  quickPassMs: 150,
  activePlayMs: 350,
  cancelAfterStartMs: 125,
  delayedResponseMs: 900,
  abortObservationMs: 160,
  readyDeadlineMs: 3000,
})
const filepath = path.join(__dirname, 'gallery-video-poster-performance-main.cjs')
const source = fs.readFileSync(filepath, 'utf8')
const fixtureMatch = source.match(/const videoBase64 = '([^']+)'/)
if (!fixtureMatch) throw new Error('Existing H.264 fixture not found')
const fixture = Buffer.from(fixtureMatch[1], 'base64')
if (fixture.length < 64) throw new Error('H.264 fixture is too short')

const rows = new Map()
function rowFor(name) {
  if (!rows.has(name)) rows.set(name, {
    name, requests: 0, bytes: 0, closedBeforeBody: 0,
    active: 0, maxActive: 0, completed: 0, ranges: [],
  })
  return rows.get(name)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const name = url.searchParams.get('scenario') || 'unlabelled'
  const row = rowFor(name)
  row.requests++
  row.active++
  row.maxActive = Math.max(row.maxActive, row.active)
  row.ranges.push(req.headers.range || '')
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
  const start = match ? Number(match[1]) : 0
  const end = match && match[2] ? Math.min(fixture.length - 1, Number(match[2])) : fixture.length - 1
  let ended = false
  let timer
  res.on('close', () => {
    if (timer) clearTimeout(timer)
    row.active--
    if (!ended) row.closedBeforeBody++
  })
  if (start > end || start >= fixture.length) {
    ended = true
    res.writeHead(416, { 'Content-Range': 'bytes */' + fixture.length })
    res.end()
    return
  }
  const payload = fixture.subarray(start, end + 1)
  const respond = () => {
    if (res.destroyed) return
    const headers = {
      'Content-Type': 'video/mp4',
      'Content-Length': String(payload.length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*',
    }
    if (match) headers['Content-Range'] = `bytes ${start}-${end}/${fixture.length}`
    res.writeHead(match ? 206 : 200, headers)
    row.bytes += payload.length
    row.completed++
    ended = true
    res.end(payload)
  }
  if (name.startsWith('abandon-')) timer = setTimeout(respond, benchmark.delayedResponseMs)
  else respond()
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check, timeoutMs, label) {
  const started = performance.now()
  while (!check()) {
    if (performance.now() - started >= timeoutMs) throw new Error('Timed out: ' + label)
    await sleep(10)
  }
}

// A native Chromium trial of the proposed original-file mechanism.
// This intentionally does not call any Gallery component or claim a UI is done.
async function rendererTrial(input) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const result = {
    mode: input.mode,
    sourceAssigned: false,
    loaded: false,
    firstFrameMs: null,
    videoFrames: 0,
    error: '',
    mediaElementsPeak: 0,
  }
  if (input.mode === 'quick-pass') {
    await pause(input.quickPassMs)
    return result
  }
  await pause(input.hoverDelayMs)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.autoplay = false
  video.loop = true
  video.preload = 'none'
  video.crossOrigin = 'anonymous'
  video.style.cssText = 'width:200px;height:132px;position:absolute;top:0;left:0'
  document.body.appendChild(video)
  result.mediaElementsPeak = 1
  const started = performance.now()
  let resolveReady
  const ready = new Promise((resolve) => { resolveReady = resolve })
  video.addEventListener('loadeddata', () => resolveReady('ready'), { once: true })
  video.addEventListener('error', () => resolveReady('error'), { once: true })
  // Acquire original bytes only AFTER the 400ms dwell gate.
  video.preload = 'auto'
  video.src = input.url
  video.load()
  result.sourceAssigned = true
  try {
    if (input.mode === 'abandon') {
      await pause(input.cancelAfterStartMs)
    } else {
      const status = await Promise.race([
        ready,
        pause(input.readyDeadlineMs).then(() => 'timeout'),
      ])
      result.loaded = status === 'ready'
      if (status === 'ready') {
        result.firstFrameMs = performance.now() - started
        try {
          await video.play()
          await pause(input.activePlayMs)
          result.videoFrames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0
        } catch (error) {
          result.error = 'play: ' + String(error)
        }
      } else {
        result.error = status
      }
    }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
  return result
}

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-background-timer-throttling')

async function main() {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = 'http://127.0.0.1:' + server.address().port
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  try {
    await win.loadURL('data:text/html,<html><body style="margin:0;background:#202020"></body></html>')
    const output = []
    for (const mode of ['quick-pass','original-play','abandon']) {
      for (let i = 1; i <= benchmark.samples; i++) {
        const key = mode + '-' + i
        const url = origin + '/original.mp4?scenario=' + key
        const before = performance.now()
        const result = await win.webContents.executeJavaScript(
          '(' + rendererTrial.toString() + ')(' +
            JSON.stringify({ ...benchmark, mode, url }) + ')',
          true,
        )
        // Allow Node to observe a cancelled request before checking the budget.
        await sleep(benchmark.abortObservationMs)
        const network = { ...rowFor(key) }
        output.push({ ...result, sample: i, scenario: key,
          elapsedMs: performance.now() - before,
          network,
        })
        console.log('GALLERY_HOVER_ORIGINAL_SAMPLE ' + JSON.stringify(output.at(-1)))
      }
    }
    const quick = output.filter(x => x.mode === 'quick-pass')
    const play = output.filter(x => x.mode === 'original-play')
    const abort = output.filter(x => x.mode === 'abandon')
    const verdict = {
      noRequestOnQuickPass: quick.every(x => x.network.requests === 0),
      oneMediaElement: output.every(x => x.mediaElementsPeak <= 1),
      playableH264: play.every(x => x.loaded && x.network.requests > 0),
      abortsDelayedHTTP: abort.every(x => x.network.requests > 0 &&
        x.network.active === 0 &&
        x.network.closedBeforeBody === x.network.requests &&
        x.network.bytes === 0),
    }
    const result = {
      status: 'Native original video experiment / not production hover',
      benchmark,
      fixture: {
        format: 'H.264 MP4',
        width: 96,
        height: 64,
        bytes: fixture.length,
        excludes: ['4K','HEVC','long-GOP','real network jitter','true 100k mounted DOM'],
      },
      verdict,
      acceptedForLimitedFixture: Object.values(verdict).every(Boolean),
      rows: output,
      decision: 'Feasibility only: never enable original-video hover by default based on a tiny fixture',
    }
    const outDir = path.join(__dirname, '..', 'perf-results')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir,'gallery-hover-original-video-trial.json'),
      JSON.stringify(result, null, 2) + '\n')
    console.log('GALLERY_HOVER_ORIGINAL_REPORT '+JSON.stringify({
      accepted: result.acceptedForLimitedFixture, verdict,
    }))
    // This is a probe; a red resource result is recorded, not hidden by CI failure.
    // A missing native fixture result is a test-infrastructure failure.
    if (play.every(x => x.network.requests === 0)) throw new Error('HTMLMediaElement did not request fixture bytes')
  } finally {
    win.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

app.whenReady().then(async () => {
  try {
    await main()
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  }
})
