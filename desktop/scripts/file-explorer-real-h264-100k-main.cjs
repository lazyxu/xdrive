'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const ts = require('typescript')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const resultsDir = path.resolve(__dirname, '..', 'real-h264-100k-results')
const sourcePath = path.join(root, 'ui', 'shared', 'src', 'mui', 'MediaGalleryVideoPoster.ts')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const median = nums => [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)]

app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

async function until(check, timeoutMs, message) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = await check()
    if (result) return result
    await sleep(100)
  }
  throw Error('timed out: ' + message)
}

async function startFixture(sample, readyFile) {
  const log = fs.createWriteStream(path.join(resultsDir, 'native-server-' + sample + '.log'))
  const child = spawn('go', [
    'test', '-run', '^TestFileExplorerRealH264PosterBrowser100K$',
    '-count=1', '-timeout=8m', '-v', './internal/api',
  ], {
    cwd: root,
    env: {
      ...process.env,
      XD_FILEEXPLORER_REAL_H264_100K_PERF: '1',
      XD_FILEEXPLORER_REAL_H264_READY_FILE: readyFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  child.once('error', err => log.write('spawn error: ' + String(err)))
  const ready = await until(() => {
    if (child.exitCode !== null) throw Error('native fixture quit before ready: ' + child.exitCode)
    if (!fs.existsSync(readyFile)) return null
    return JSON.parse(fs.readFileSync(readyFile, 'utf8'))
  }, 180000, 'native 100k PostgreSQL/Gin server fixture')
  return { child, exited, log, ready }
}

async function stopFixture(s) {
  if (!s) return
  try { await fetch(s.ready.url + '/__perf/stop', { method: 'POST' }) } catch (_) {}
  const r = await Promise.race([s.exited, sleep(25000).then(() => ({ code: 'timeout' }))])
  if (r.code !== 0) {
    s.child.kill('SIGKILL')
    s.log.end()
    throw Error('native 100k fixture exit was not successful: ' + JSON.stringify(r))
  }
  s.log.end()
}

// Executed inside a REAL Electron/Chromium renderer. The helper is compiled
// directly from the current production shared TypeScript source, not copied.
async function rendererLogic() {
  const { xDriveResolveMediaVideoPoster, xDriveCaptureVideoPosterBlob } =
    require(window.__xdriveRealH264Compiled)
  const info = window.__xdriveRealH264Config
  if (info.total_count !== 100000 || info.sample_node_ids.length !== 6 ||
      info.video_bytes < 1000 || info.unique_sha256_count !== 6) throw Error('missing native 100k H264 fixture')
  const headers = { Authorization: 'Bearer ' + info.token }
  const response = await fetch('/api/v1/nodes/' + info.folder_id +
    '/children?offset=0&limit=200&sort=name&order=asc', { headers, cache: 'no-store' })
  if (!response.ok) throw Error('100k FileExplorer sparse range HTTP ' + response.status)
  const page = await response.json()
  if (page.total_count !== 100000 || page.items.length !== 200) {
    throw Error('100k counted range invalid: ' + JSON.stringify(page))
  }
  async function stats() {
    const r = await fetch('/__perf/stats', { cache: 'no-store' })
    if (!r.ok) throw Error('native counter HTTP ' + r.status)
    return r.json()
  }
  async function decodePoster(url) {
    if (!url) throw Error('poster resolver returned no image URL')
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      if (!image.naturalWidth || !image.naturalHeight) throw Error('JPEG not decoded')
    } finally {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }
  const before = await stats()
  const cold = [], warm = [], jpegSizes = [], stages = []
  let coldMisses = 0, posterPuts = 0, previews = 0, warmHits = 0, decodedVideos = 0
  const began = performance.now()
  for (const id of info.sample_node_ids) {
    const start = performance.now()
    const source = await xDriveResolveMediaVideoPoster({
      nodeID: id, revision: 1,
      loadCached: async (_id, signal) => {
        const r = await fetch('/api/v1/media/items/' + id + '/thumbnail?revision=1',
          { headers, signal, cache: 'no-store' })
        if (r.status === 404) { coldMisses++; return null }
        throw Error('expected cold 404, got ' + r.status)
      },
      capture: async (signal, onCapturing) => {
        previews++
        const ticketRes = await fetch('/api/v1/files/' + id + '/preview-ticket',
          { method: 'POST', headers, signal, cache: 'no-store' })
        if (!ticketRes.ok) throw Error('preview ticket HTTP ' + ticketRes.status)
        const ticket = await ticketRes.json()
        if (ticket.kind !== 'video' || !ticket.url) throw Error('invalid video preview ticket')
        onCapturing?.()
        const poster = await xDriveCaptureVideoPosterBlob(
          new URL(ticket.url, location.origin).href, 0, 96, 64, 512, signal)
        if (!poster || poster.size < 1 || poster.type !== 'image/jpeg') {
          throw Error('real MP4 H264 canvas/JPEG capture failed')
        }
        decodedVideos++
        jpegSizes.push(poster.size)
        return poster
      },
      save: async (_id, revision, jpeg, signal) => {
        const r = await fetch('/api/v1/media/items/' + id + '/video-poster', {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'image/jpeg', 'If-Match': '"' + revision + '"' },
          signal, body: jpeg,
        })
        if (r.status !== 204) throw Error('poster PUT HTTP ' + r.status)
        posterPuts++
      },
      onStage: stage => stages.push(stage),
    })
    await decodePoster(source)
    cold.push(performance.now() - start)
  }
  const afterCold = await stats()
  await new Promise(resolve => setTimeout(resolve, 200))
  const beforeWarm = await stats()
  for (const id of info.sample_node_ids) {
    const start = performance.now()
    const source = await xDriveResolveMediaVideoPoster({
      nodeID: id, revision: 1,
      loadCached: async (_id, signal) => {
        const r = await fetch('/api/v1/media/items/' + id + '/thumbnail?revision=1',
          { headers, signal, cache: 'no-store' })
        if (r.status !== 200 || !r.headers.get('etag') ||
            r.headers.get('content-type') !== 'image/jpeg') {
          throw Error('warm persisted JPEG GET status=' + r.status)
        }
        warmHits++
        return URL.createObjectURL(await r.blob())
      },
      capture: async () => { throw Error('warm cache must not request original video') },
      save: async () => { throw Error('warm cache must not PUT poster') },
    })
    await decodePoster(source)
    warm.push(performance.now() - start)
  }
  const afterWarm = await stats()
  const originalsCold = afterCold.original_open - before.original_open
  const originalsWarm = afterWarm.original_open - beforeWarm.original_open
  const warmPosterOpens = afterWarm.poster_open - beforeWarm.poster_open
  if (coldMisses !== 6 || posterPuts !== 6 || previews !== 6 ||
      decodedVideos !== 6 || warmHits !== 6 || originalsCold < 6 ||
      originalsWarm !== 0 || warmPosterOpens !== 6 ||
      stages.filter(x => x === 'poster_capture').length !== 6) {
    throw Error('genuine H264 persisted poster lifecycle invalid: ' + JSON.stringify({
      coldMisses, posterPuts, previews, decodedVideos, warmHits,
      originalsCold, originalsWarm, warmPosterOpens, stages, before, afterCold, beforeWarm, afterWarm,
    }))
  }
  return {
    workload: 'real-chromium-h264-poster-signed-server-100k',
    logicalVideoItems: 100000, sampledRealVideoItems: 6, selectedOffsets: [0, 50000, 99998],
    actualMP4BytesPerSample: info.video_bytes,
    realH264FirstFrameDecoded: decodedVideos,
    coldMs: cold, warmMs: warm, jpegSizes,
    coldP50Ms: [...cold].sort((a, b) => a - b)[3],
    warmP50Ms: [...warm].sort((a, b) => a - b)[3],
    coldMisses, posterPuts, warmHits, originalsCold, originalsWarm,
    warmPosterOpens, stages,
    browserWorkMs: performance.now() - began,
    seedMs: info.seed_ms,
    boundary: 'Real Gin/PostgreSQL/Local CAS signed preview -> Chromium H264 decoder -> JPEG canvas -> revisioned PUT -> warm GET; no mounted FileExplorer, Agent IPC, 4K/HEVC, WAN or fast-scroll abort',
  }
}

async function main() {
  if (!process.env.XD_TEST_DATABASE_URL) throw Error('native PostgreSQL URL required')
  fs.mkdirSync(resultsDir, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-real-h264-100k-'))
  const moduleFile = path.join(tmp, 'real-poster.cjs')
  const text = fs.readFileSync(sourcePath, 'utf8')
  fs.writeFileSync(moduleFile, ts.transpileModule(text, {
    fileName: sourcePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)
  const results = []
  try {
    await app.whenReady()
    for (let sample = 1; sample <= 3; sample++) {
      let fixture = null, win = null
      try {
        const ready = path.join(tmp, 'sample-' + sample + '-ready.json')
        fixture = await startFixture(sample, ready)
        win = new BrowserWindow({
          show: true, width: 1280, height: 800,
          webPreferences: {
            partition: 'real-h264-100k-' + sample,
            nodeIntegration: true, contextIsolation: false, sandbox: false,
            backgroundThrottling: false,
          },
        })
        await win.loadURL(fixture.ready.url + '/')
        await win.webContents.executeJavaScript(
          'window.__xdriveRealH264Compiled=' + JSON.stringify(moduleFile) +
          '; window.__xdriveRealH264Config=' + JSON.stringify(fixture.ready.config),
          true,
        )
        const r = await Promise.race([
          win.webContents.executeJavaScript('(' + rendererLogic.toString() + ')()', true),
          sleep(120000).then(() => { throw Error('real H264 Chromium capture timed out') }),
        ])
        const tab = app.getAppMetrics().find(m => m.type === 'Tab')
        r.rendererWorkingSetKiBSnapshot = tab?.memory?.workingSetSize ?? null
        r.sample = sample
        fs.writeFileSync(path.join(resultsDir, 'sample-' + sample + '.json'),
          JSON.stringify(r, null, 2) + '\n')
        results.push(r)
        console.log('FILEEXPLORER_REAL_H264_100K_SAMPLE ' + JSON.stringify(r))
      } finally {
        if (win && !win.isDestroyed()) win.destroy()
        if (fixture) await stopFixture(fixture)
      }
    }
    const summary = {
      status: 'measured-current-production-real-h264-100k',
      sampleCount: results.length,
      coldP50MsAcrossRuns: median(results.map(r => r.coldP50Ms)),
      warmP50MsAcrossRuns: median(results.map(r => r.warmP50Ms)),
      originalsWarm: results.map(r => r.originalsWarm),
      jpegOutputBytes: results.map(r => r.jpegSizes),
      seedMsExcluded: results.map(r => r.seedMs),
      workingSetKiBSnapshots: results.map(r => r.rendererWorkingSetKiBSnapshot),
      accepted: results.length === 3 && results.every(r =>
        r.coldMisses === 6 && r.posterPuts === 6 && r.warmHits === 6 &&
        r.originalsCold >= 6 && r.originalsWarm === 0 &&
        r.warmPosterOpens === 6 && r.coldMs.every(ms => ms < 15000)),
      scope: 'real signed H264-to-JPEG poster lifecycle in 100k metadata; not full FileExplorer UI, Agent IPC, HEVC or 4K',
    }
    fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('FILEEXPLORER_REAL_H264_100K_SUMMARY ' + JSON.stringify(summary))
    if (!summary.accepted) throw Error('real 100k H264 poster invariant/decoder budget failed')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => {
  console.error('FILEEXPLORER_REAL_H264_100K_ERROR ' + (error?.stack || String(error)))
  app.exit(1)
})
