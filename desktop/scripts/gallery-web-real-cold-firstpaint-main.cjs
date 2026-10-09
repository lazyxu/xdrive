'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const out = path.resolve(__dirname, '..', 'gallery-real-cold-results')
const webDist = path.join(root, 'web', 'dist')
const samples = 3
const maxWaitMs = 180000

// Closing the last measured BrowserWindow is not an instruction to quit:
 // this runner must execute all three independent Web cold-start samples.
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(check, budget, message) {
  const started = Date.now()
  while (Date.now() - started < budget) {
    const result = await check()
    if (result) return result
    await delay(100)
  }
  throw new Error('timed out: ' + message)
}

async function serveSample(sample, ready) {
  const serverLog = fs.createWriteStream(path.join(out, 'postgres-gin-sample-' + sample + '.log'))
  const child = spawn('go', [
    'test', '-run', '^TestGalleryRealWebColdFixture100K$',
    '-count=1', '-timeout=14m', '-v', './internal/api',
  ], {
    cwd: root,
    env: {
      ...process.env,
      XD_GALLERY_REAL_WEB_COLD_PERF: '1',
      XD_GALLERY_REAL_WEB_READY_FILE: ready,
      XD_GALLERY_REAL_WEB_DIST: webDist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(serverLog, { end: false })
  child.stderr.pipe(serverLog, { end: false })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const config = await until(async () => {
    if (child.exitCode !== null) {
      throw new Error('real Gin server stopped before fixture was ready, exit=' + child.exitCode)
    }
    if (!fs.existsSync(ready)) return null
    return JSON.parse(fs.readFileSync(ready, 'utf8'))
  }, maxWaitMs, '100k PostgreSQL fixture start')
  return { child, exited, config, serverLog }
}

async function browserSample(sample, url, mode) {
  const win = new BrowserWindow({
    show: true,
    width: 1440,
    height: 900,
    webPreferences: {
      partition: 'gallery-real-cold-sample-' + sample + '-' + mode,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })
  let failure = null
  win.webContents.on('did-fail-load', (_ev, code, message, uri) => {
    failure = 'did-fail-load ' + code + ': ' + message + ' ' + uri
  })
  win.webContents.on('render-process-gone', (_ev, details) => {
    failure = 'renderer exited: ' + JSON.stringify(details)
  })
  try {
    await win.loadURL(url + '/?xdriveGalleryRealCold=1&xdriveMediaProgress=' + mode)
    const result = await until(async () => {
      if (failure) throw new Error(failure)
      const status = await win.webContents.executeJavaScript(
        '({ result: window.__xdriveGalleryRealColdResult || null, error: window.__xdriveGalleryRealColdError || null })',
      )
      if (status.error) throw new Error(status.error)
      return status.result
    }, 45000, 'actual Web cold first-12 decoded Gallery thumbnails')
    const electron = app.getAppMetrics()
    const tab = electron.find(entry => entry.type === 'Tab')
    return {
      sample,
      progressMode: mode,
      ...result,
      rendererWorkingSetKib: tab?.memory?.workingSetSize || null,
      browserSource: 'Electron Chromium Web bundle against localhost real Gin/PostgreSQL/CAS',
    }
  } finally {
    win.destroy()
  }
}

async function main() {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) {
    throw new Error('real Web Gallery performance bundle was not built')
  }
  if (!process.env.XD_TEST_DATABASE_URL) {
    throw new Error('XD_TEST_DATABASE_URL is needed for real native PostgreSQL')
  }
  fs.mkdirSync(out, { recursive: true })
  await app.whenReady()
  const results = []
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-web-cold-'))
  try {
    for (let sample = 1; sample <= samples; sample++) {
      // Alternate paired ON/OFF order for every 100k cold fixture.
      for (const mode of sample % 2 === 0 ? ['on', 'off'] : ['off', 'on']) {
      const ready = path.join(tempDir, 'ready-' + sample + '-' + mode + '.json')
      const server = await serveSample(sample + '-' + mode, ready)
      try {
        const result = await browserSample(sample, server.config.url, mode)
        const statsResponse = await fetch(server.config.url + '/__perf/stats')
        result.storeStats = await statsResponse.json()
        result.seedMs = server.config.seed_ms
        result.firstImageNodes = server.config.first_image_nodes
        result.firstLiveAssets = server.config.first_live_assets
        if (result.logicalItems !== 100000 || result.physicalNodes !== 115000 ||
            result.mountedTiles >= 1000 || result.imagesDecodedAtCompletion < 12 ||
            !Number.isFinite(result.navigationToFirstImagePaintMs) ||
            result.progressMode !== mode || result.thumbnailProgressErrors !== 0 ||
            (mode === 'on' && (result.thumbnailProgressRequests < 1 ||
              result.thumbnailProgressEvents < 1 || result.thumbnailProgressCompleted < 1 ||
              result.thumbnailProgressReportedBytes <= 0)) ||
            (mode === 'off' && (result.thumbnailProgressRequests !== 0 ||
              result.thumbnailProgressEvents !== 0 || result.thumbnailProgressCompleted !== 0 ||
              result.thumbnailProgressReportedBytes !== 0))) {
          throw new Error('real 100k browser integrity guard failed: ' + JSON.stringify(result))
        }
        results.push(result)
        console.log('GALLERY_REAL_WEB_COLD_SAMPLE ' + JSON.stringify(result))
      } finally {
        await fetch(server.config.url + '/__perf/stop', { method: 'POST' }).catch(() => {})
        const ended = await Promise.race([
          server.exited,
          delay(30000).then(() => ({ code: 'timeout' })),
        ])
        if (ended.code !== 0) {
          server.child.kill('SIGTERM')
          throw new Error('Go fixture server exit failed: ' + JSON.stringify(ended))
        }
        server.serverLog.end()
      }
      }
    }
    const modes = ['off', 'on']
    const grouped = Object.fromEntries(modes.map(mode => [mode, results.filter(row => row.progressMode === mode)]))
    if (grouped.off.length !== samples || grouped.on.length !== samples || results.length !== samples * 2) {
      throw new Error('paired 100k progress modes were not both executed three times')
    }
    const median = values => {
      if (!values.length) throw new Error('missing paired metric samples')
      const nums = [...values].sort((a, b) => a - b)
      return nums[Math.floor(nums.length / 2)]
    }
    const fields = [
      'navigationToFirstImagePaintMs', 'navigationToFirst12DecodedMs',
      'firstRangeHttpMs', 'thumbnailRequests', 'thumbnailResponseBytes',
      'rendererWorkingSetKib', 'longestLongTaskMs',
    ]
    const medians = Object.fromEntries(modes.map(mode => [mode, Object.fromEntries(
      fields.map(field => [field, median(grouped[mode].map(row => row[field]).filter(Number.isFinite))]),
    )]))
    const pairs = Array.from({ length: samples }, (_, index) => {
      const sample = index + 1
      const off = grouped.off.find(row => row.sample === sample)
      const on = grouped.on.find(row => row.sample === sample)
      if (!off || !on) throw new Error('sample missing A/B mode: ' + sample)
      return {
        sample, offFirstPaintMs: off.navigationToFirstImagePaintMs,
        onFirstPaintMs: on.navigationToFirstImagePaintMs,
        firstPaintDeltaMs: on.navigationToFirstImagePaintMs - off.navigationToFirstImagePaintMs,
        offRendererWorkingSetKib: off.rendererWorkingSetKib,
        onRendererWorkingSetKib: on.rendererWorkingSetKib,
        offThumbRequests: off.thumbnailRequests, onThumbRequests: on.thumbnailRequests,
        offThumbResponseBytes: off.thumbnailResponseBytes,
        onThumbResponseBytes: on.thumbnailResponseBytes,
      }
    })
    const firstPaintDeltaMs = median(pairs.map(row => row.firstPaintDeltaMs))
    const offFirstPaintMs = medians.off.navigationToFirstImagePaintMs
    const onFirstPaintMs = medians.on.navigationToFirstImagePaintMs
    const firstPaintRegression = firstPaintDeltaMs > 100 && firstPaintDeltaMs > offFirstPaintMs * 0.10
    const rssDeltaKib = medians.on.rendererWorkingSetKib - medians.off.rendererWorkingSetKib
    const rssRegression = Number.isFinite(rssDeltaKib) && rssDeltaKib > 32 * 1024 &&
      rssDeltaKib > medians.off.rendererWorkingSetKib * 0.25
    if (!Number.isFinite(medians.off.rendererWorkingSetKib) ||
        !Number.isFinite(medians.on.rendererWorkingSetKib)) {
      throw new Error('missing Chromium renderer working-set metric')
    }
    const firstPaint2sBudgetMet = onFirstPaintMs <= 2000
    const noExcessRequests = medians.on.thumbnailRequests <= medians.off.thumbnailRequests * 1.25 + 2
    const noExcessBytes = medians.on.thumbnailResponseBytes <= medians.off.thumbnailResponseBytes * 1.3 + 65536
    const report = {
      name: 'web-gallery-real-cold-first-visible-100k',
      status: 'measured-opt-in-progress-on-off-paired',
      baseline: 'progress OFF: same production Web collector native Blob fast path',
      samples: results, pairs, groupedMedians: medians,
      nPerMode: samples, n: results.length,
      medianNavigationToFirstPaintMs: onFirstPaintMs,
      medianFirstPaintDeltaMs: firstPaintDeltaMs, medianRssDeltaKib: rssDeltaKib,
      firstPaint2sBudgetMet,
      noRepeatableFirstPaintRegression: !firstPaintRegression,
      noRepeatableRssRegression: !rssRegression,
      noExcessRequests, noExcessBytes,
      acceptance: 'three real authenticated 100k Go/Gin/PostgreSQL/local CAS + Chromium pairs, first-12 JPEG decode, actual byte progress ON, zero invented progress OFF, sparse DOM and no material first-paint/RSS regression',
      limitations: 'Each ON/OFF mode reseeds independent Gin/PostgreSQL/CAS fixture processes on the same Actions runner; order alternated. No Desktop Agent IPC, WAN, physical mobile, duplicate fold mode or true 4K decode.',
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
    console.log('GALLERY_REAL_WEB_COLD_REPORT ' + JSON.stringify(report))
    if (!firstPaint2sBudgetMet || firstPaintRegression || rssRegression ||
        !noExcessRequests || !noExcessBytes) {
      throw new Error('100k progress A/B exceeded frozen first-paint/RSS budget; raw report preserved: ' + JSON.stringify({ medians, pairs }))
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
    app.quit()
  }
}

main().catch(error => {
  console.error('GALLERY_REAL_WEB_COLD_ERROR', error?.stack || String(error))
  app.exit(1)
})
