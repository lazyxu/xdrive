'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const out = path.resolve(__dirname, '..', 'gallery-web-real-fold-results')
const webDist = path.join(root, 'web', 'dist')
const samples = 3
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const p50 = values => [...values].sort((a, b) => a - b)[1]
const assert = (condition, message) => { if (!condition) throw new Error(message) }

app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

async function until(check, maxMs, reason) {
  const begin = Date.now()
  while (Date.now() - begin < maxMs) {
    const value = await check()
    if (value) return value
    await delay(100)
  }
  throw new Error('timeout: ' + reason)
}

async function serveSample(sample, ready) {
  const serverLog = fs.createWriteStream(path.join(out, 'postgres-gin-sample-' + sample + '.log'))
  const child = spawn('go', [
    'test', '-run', '^TestGalleryRealWebColdFixture100K$',
    '-count=1', '-timeout=16m', '-v', './internal/api',
  ], {
    cwd: root,
    env: {
      ...process.env,
      XD_GALLERY_REAL_WEB_COLD_PERF: '1',
      XD_GALLERY_REAL_WEB_FOLD_PERF: '1',
      XD_GALLERY_REAL_WEB_READY_FILE: ready,
      XD_GALLERY_REAL_WEB_DIST: webDist,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(serverLog, { end: false })
  child.stderr.pipe(serverLog, { end: false })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  try {
    const config = await until(() => {
      if (child.exitCode !== null) throw new Error('fold Gin fixture exited before ready')
      if (!fs.existsSync(ready)) return null
      return JSON.parse(fs.readFileSync(ready, 'utf8'))
    }, 240000, 'real 100k verified fold PostgreSQL fixture')
    assert(config.logical_assets === 100000 && config.physical_nodes === 115000 &&
      config.fold_enabled === true && config.fold_groups === 2000 &&
      config.fold_visible_count === 92000, 'verified fold fixture count mismatch')
    return { config, child, exited, serverLog }
  } catch (error) {
    child.kill('SIGTERM')
    serverLog.end()
    throw error
  }
}

async function measureBrowser(sample, url) {
  const win = new BrowserWindow({
    show: true,
    width: 1440,
    height: 900,
    webPreferences: {
      partition: 'gallery-web-real-fold-100k-' + sample,
      contextIsolation: true, nodeIntegration: false,
      sandbox: false, webSecurity: true,
    },
  })
  let failure = null
  win.webContents.on('did-fail-load', (_ev, code, message, uri) => {
    failure = 'did-fail-load ' + code + ': ' + message + ' ' + uri
  })
  win.webContents.on('render-process-gone', (_ev, details) => {
    failure = 'renderer gone ' + JSON.stringify(details)
  })
  try {
    await win.loadURL(url + '/?xdriveGalleryRealFold=1')
    const result = await until(async () => {
      if (failure) throw new Error(failure)
      const output = await win.webContents.executeJavaScript(
        '({result:window.__xdriveGalleryRealFoldResult||null,error:window.__xdriveGalleryRealFoldError||null})',
      )
      if (output.error) throw new Error('real fold Gallery: ' + output.error)
      return output.result
    }, 95000, 'actual ON/OFF Gallery first 12 decoded images')
    const metrics = app.getAppMetrics()
    const renderer = metrics.find(x => x.pid === win.webContents.getOSProcessId())
    return {
      sample,
      ...result,
      rendererWorkingSetKibSnapshot: renderer?.memory?.workingSetSize ?? null,
      browserSource: 'Actual React Gallery fold toggle, Chromium Web, authenticated Gin/PostgreSQL17/CAS',
    }
  } finally {
    win.destroy()
  }
}

async function main() {
  assert(fs.existsSync(path.join(webDist, 'index.html')), 'opt-in Web fold bundle missing')
  assert(process.env.XD_TEST_DATABASE_URL, 'native PostgreSQL 17 URL required')
  fs.mkdirSync(out, { recursive: true })
  await app.whenReady()
  const all = []
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-gallery-fold-ui-'))
  try {
    for (let sample = 1; sample <= samples; sample++) {
      const ready = path.join(temp, 'ready-' + sample + '.json')
      const server = await serveSample(sample, ready)
      try {
        const result = await measureBrowser(sample, server.config.url)
        const storeResponse = await fetch(server.config.url + '/__perf/stats')
        assert(storeResponse.ok, 'actual CAS counters unavailable')
        result.storeStats = await storeResponse.json()
        result.seedMs = server.config.seed_ms
        assert(result.logicalItems === 100000 && result.physicalNodes === 115000 &&
          result.livePhotoGroups === 15000 && result.verifiedFoldGroups === 2000 &&
          result.expectedFoldVisible === 92000 && result.stages?.length === 5 &&
          result.nToggleOn === 2 && result.nToggleOff === 2, 'invalid browser toggle sample')
        const modes = [false, true, false, true, false]
        for (let stageIndex = 0; stageIndex < modes.length; stageIndex++) {
          const stage = result.stages[stageIndex]
          const desired = modes[stageIndex] ? 92000 : 100000
          assert(stage.fold === modes[stageIndex] && stage.total === desired &&
            stage.rangeItemCount === 100 && stage.mountedTiles < 1000 &&
            stage.imageDecodeCount >= 12 &&
            Number.isFinite(stage.rangeHTTPMs) &&
            Number.isFinite(stage.clickToDecoded12TwoRAFMs),
          'real browser 100k folded range/paint failed: ' + JSON.stringify(stage))
        }
        all.push(result)
        console.log('GALLERY_REAL_WEB_FOLD_SAMPLE ' + JSON.stringify(result))
      } finally {
        await fetch(server.config.url + '/__perf/stop', { method: 'POST' }).catch(() => {})
        const ended = await Promise.race([
          server.exited, delay(30000).then(() => ({ code: 'timeout' })),
        ])
        if (ended.code !== 0) {
          server.child.kill('SIGTERM')
          throw new Error('real 100k verified-fold Gin fixture failed to stop: ' + JSON.stringify(ended))
        }
        server.serverLog.end()
      }
    }
    const on = all.map(x => x.stages.filter(s => s.fold).map(s => s.clickToDecoded12TwoRAFMs))
    const off = all.map(x => x.stages.filter(s => !s.fold && s.step !== 'fresh-initial-off')
      .map(s => s.clickToDecoded12TwoRAFMs))
    const medianON = p50(on.map(values => (values[0] + values[1]) / 2))
    const medianOFF = p50(off.map(values => (values[0] + values[1]) / 2))
    const report = {
      name: 'gallery-web-real-browser-verified-duplicate-fold-100k',
      status: 'measured-baseline-only-no-production-optimization',
      n: all.length, samples: all,
      medianWarmFoldToggleOnPaintMs: medianON,
      medianWarmFoldToggleOffPaintMs: medianOFF,
      budgetDiagnostic: 'warm ON >3000ms is red for follow-up profiling; not a failing acceptance condition for this exploratory baseline',
      limitations: 'Initial OFF cold and two warm ON/OFF toggles per fresh 100k process. Not cold ON/OFF equivalence, literal GPU paint, physical devices, real duplicate bytes for offscreen metadata, or proven production acceleration.',
    }
    assert(report.n === 3, 'three independent real browser fold samples required')
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n')
    console.log('GALLERY_REAL_WEB_FOLD_REPORT ' + JSON.stringify(report))
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
    app.quit()
  }
}

main().catch(error => {
  console.error('GALLERY_REAL_WEB_FOLD_ERROR ' + (error?.stack || String(error)))
  app.exit(1)
})
