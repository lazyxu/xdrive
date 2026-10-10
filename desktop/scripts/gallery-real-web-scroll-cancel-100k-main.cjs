'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const dist = path.join(root, 'web', 'dist')
const out = path.join(__dirname, '..', 'gallery-real-scroll-cancel-results')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

async function until(fn, timeoutMs, message) {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw Error('timed out: ' + message)
}
async function startFixture(sample, ready) {
  const log = fs.createWriteStream(path.join(out, 'native-gin-' + sample + '.log'))
  const child = spawn('go', [
    'test', '-run', '^TestGalleryRealWebColdFixture100K$',
    '-count=1', '-timeout=12m', '-v', './internal/api',
  ], {
    cwd: root,
    env: {
      ...process.env,
      XD_GALLERY_REAL_WEB_COLD_PERF: '1',
      XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF: '1',
      XD_GALLERY_REAL_WEB_DIST: dist,
      XD_GALLERY_REAL_WEB_READY_FILE: ready,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  child.once('error', err => log.write('spawn error: ' + String(err)))
  const exited = new Promise(resolve =>
    child.once('exit', (code, signal) => resolve({ code, signal })))
  const config = await until(() => {
    if (child.exitCode !== null) throw Error('native fixture exited before ready: ' + child.exitCode)
    return fs.existsSync(ready) ? JSON.parse(fs.readFileSync(ready, 'utf8')) : null
  }, 180000, 'real 100k Gallery PostgreSQL+Gin fixture')
  return { log, child, exited, config }
}
async function stopFixture(f) {
  if (!f) return
  try { await fetch(f.config.url + '/__perf/stop', { method: 'POST' }) } catch (_) {}
  const exit = await Promise.race([f.exited, sleep(30000).then(() => ({ code: 'timeout' }))])
  f.log.end()
  if (exit.code !== 0) {
    f.child.kill('SIGKILL')
    throw Error('real Gallery fixture did not exit cleanly: ' + JSON.stringify(exit))
  }
}
async function readStats(url) {
  const response = await fetch(url + '/__perf/viewport-cancel-stats', { cache: 'no-store' })
  assert.equal(response.status, 200)
  return response.json()
}

// Runs inside the actual Web Gallery Chromium DOM, not a renderer simulation.
function scrollActualGalleryViewport() {
  try {
    const grid = document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
    if (!(grid instanceof HTMLElement)) {
      return {
        error: 'actual shared Gallery virtual-grid node missing',
        gridCount: document.querySelectorAll('[data-xdrive-media-gallery-virtual-grid]').length,
        bodyText: document.body?.innerText?.slice(0, 180) || '',
      }
    }
    const candidates = []
    let parent = grid.parentElement
    while (parent) {
      const style = getComputedStyle(parent)
      if (/(auto|scroll|overlay)/.test(style.overflowY)) {
        candidates.push({
          element: parent,
          tag: parent.tagName,
          overflow: style.overflowY,
          extent: parent.scrollHeight - parent.clientHeight,
          viewport: parent.clientHeight,
        })
      }
      parent = parent.parentElement
    }
    const available = candidates.filter(c => c.extent > 10000)
    const chosen = available[0]
    if (!chosen) {
      return {
        error: 'no scrollable Gallery ancestor with 100k logical range',
        gridHeight: grid.clientHeight,
        candidates: candidates.map(({ tag, overflow, extent, viewport }) =>
          ({ tag, overflow, extent, viewport })),
      }
    }
    const scroller = chosen.element
    const initial = scroller.scrollTop
    scroller.scrollTop = Math.floor(chosen.extent * 0.5)
    // Actual scrollTop mutation dispatches a browser scroll event. Explicit
    // dispatch also supports CI Chromium builds that coalesce native events.
    scroller.dispatchEvent(new Event('scroll'))
    return {
      oldScrollTop: initial,
      newScrollTop: scroller.scrollTop,
      extent: chosen.extent,
      initialMountedTiles: grid.querySelectorAll('[role="button"]').length,
      ancestorCandidates: candidates.map(({ tag, overflow, extent, viewport }) =>
        ({ tag, overflow, extent, viewport })),
    }
  } catch (error) {
    return { error: String(error), stack: error?.stack || '' }
  }
}
async function newIndependentRange(f) {
  const base = f.config.url
  const configRes = await fetch(base + '/__perf/config')
  assert.equal(configRes.status, 200)
  const config = await configRes.json()
  assert.equal(config.logical_assets, 100000)
  assert.equal(config.physical_nodes, 115000)
  const response = await fetch(base + '/api/v1/media/items?range=true&limit=100&offset=50000', {
    headers: { Authorization: 'Bearer ' + config.token }, cache: 'no-store',
  })
  if (response.status !== 200) {
    const body = await response.text()
    throw Error('independent native Gallery 100k Range returned HTTP ' +
      response.status + ' body=' + body.slice(0, 500))
  }
  const page = await response.json()
  assert.equal(page.total_count, 100000)
  assert.equal(page.items.length, 100)
  return { status: response.status, count: page.total_count, returned: page.items.length }
}
async function sampleOnce(sample, ready) {
  let fixture = null, win = null
  try {
    fixture = await startFixture(sample, ready)
    assert.equal(fixture.config.logical_assets, 100000)
    assert.equal(fixture.config.physical_nodes, 115000)
    win = new BrowserWindow({
      show: true, width: 1440, height: 900,
      webPreferences: {
        partition: 'real-gallery-web-scroll-' + sample, sandbox: false,
        nodeIntegration: false, contextIsolation: true, webSecurity: true,
        backgroundThrottling: false,
      },
    })
    const failures = []
    win.webContents.on('render-process-gone', (_ev, state) =>
      failures.push('renderer gone: ' + JSON.stringify(state)))
    win.webContents.on('did-fail-load', (_ev, code, message) =>
      failures.push('did-fail-load ' + code + ': ' + message))
    await win.loadURL(fixture.config.url +
      '/?xdriveGalleryRealCold=1&xdriveRealViewportCancel=1&xdriveMediaProgress=off')
    const started = await until(async () => {
      if (failures.length) throw Error(failures.join('; '))
      const s = await readStats(fixture.config.url)
      if (s.started > 6) throw Error('more than six real requests admitted: ' + JSON.stringify(s))
      return s.started === 6 && s.active === 6 &&
        s.first_chunks === 6 && s.emitted_bytes === 1536 ? s : null
    }, 45000, 'six real Gallery visible JPEG streams are active')
    const marker = await fetch(fixture.config.url + '/__perf/viewport-cancel-mark',
      { method: 'POST' })
    assert.equal(marker.status, 204)
    const scroll = await win.webContents.executeJavaScript(
      '(' + scrollActualGalleryViewport.toString() + ')()', true)
    assert(!scroll.error, 'real Gallery DOM scroll unavailable: ' + JSON.stringify(scroll))
    assert(scroll.newScrollTop > scroll.oldScrollTop + 10000,
      'real Gallery scrollTop did not advance: ' + JSON.stringify(scroll))
    assert(scroll.initialMountedTiles < 1000)
    await sleep(160)
    const after = await readStats(fixture.config.url)
    // Preserve source-exact UI -> Go cancellation metrics even if a later
    // independent 100k Range exposes a PostgreSQL resource budget failure.
    const cancelDiagnostic = {
      sample, actualScroll: scroll,
      started: started.started, contextDone: after.context_done - started.context_done,
      cancelled: after.cancelled - started.cancelled, active: after.active,
      afterCancelBytes: after.emitted_bytes - started.emitted_bytes,
      worstContextNotificationMs: after.max_cancel_us / 1000,
    }
    console.log('GALLERY_REAL_WEB_SCROLL_CANCEL_100K_PRE_RANGE ' +
      JSON.stringify(cancelDiagnostic))
    const healthy = await newIndependentRange(fixture)
    const row = {
      sample, logicalAssets: 100000, physicalNodes: 115000,
      firstImageNodes: fixture.config.first_image_nodes,
      seedMsExcluded: fixture.config.seed_ms,
      scroll, healthy,
      go: {
        started: started.started, canceled: after.cancelled - started.cancelled,
        contextDone: after.context_done - started.context_done,
        stillActiveAt160ms: after.active,
        wastedBytesAfterScroll: after.emitted_bytes - started.emitted_bytes,
        beforeScrollActualBytes: started.emitted_bytes,
        worstContextNotificationMs: after.max_cancel_us / 1000,
        totalRequestBytesAfterCancel: after.emitted_bytes,
      },
      scope: 'Actual mounted Web shared Gallery VirtualGrid; real Chromium scrollTop/scroll event -> real Gin/PG17/local CAS request cancellation, test-only slow authentic JPEG body. Not Desktop Agent IPC/video decode/real network.',
    }
    if (row.go.canceled !== 6 || row.go.contextDone !== 6 ||
        row.go.stillActiveAt160ms !== 0 || row.go.wastedBytesAfterScroll !== 0 ||
        row.go.worstContextNotificationMs > 160 || after.first_chunks !== 6) {
      throw Error('real Gallery scroll did not release obsolete Go thumbnail work: ' +
        JSON.stringify(row))
    }
    fs.writeFileSync(path.join(out, 'sample-' + sample + '.json'),
      JSON.stringify(row, null, 2) + '\n')
    console.log('GALLERY_REAL_WEB_SCROLL_CANCEL_100K_SAMPLE ' + JSON.stringify(row))
    return row
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    if (fixture) await stopFixture(fixture)
  }
}
async function main() {
  assert(process.env.XD_TEST_DATABASE_URL, 'native PostgreSQL URL needed')
  assert(fs.existsSync(path.join(dist, 'index.html')), 'real Web Gallery bundle missing')
  fs.mkdirSync(out, { recursive: true })
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-real-scroll-cancel-100k-'))
  const rows = []
  try {
    await app.whenReady()
    for (let sample = 1; sample <= 3; sample++) {
      rows.push(await sampleOnce(sample, path.join(temp, 'ready-' + sample + '.json')))
    }
    const worst = rows.map(x => x.go.worstContextNotificationMs).sort((a, b) => a - b)
    const summary = {
      status: 'measured-actual-Web-Gallery-100k-VirtualGrid-scroll-Go-cancellation',
      sampleCount: rows.length, budgetMs: 160,
      worstGoContextP50Ms: worst[1], worstGoContextMaxMs: worst[2],
      passed: rows.length === 3 && rows.every(row =>
        row.go.started === 6 && row.go.canceled === 6 &&
        row.go.contextDone === 6 && row.go.stillActiveAt160ms === 0 &&
        row.go.wastedBytesAfterScroll === 0 && row.go.worstContextNotificationMs <= 160),
      limits: '100k Gallery logical assets, 115k nodes, only initial images contain actual JPEG bytes. True mounted UI Chromium scroll/Go cancellation; no real 100k physical decode, FileExplorer, Desktop Agent, 4K/Live playback, WAN/CPU/RSS peak.',
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('GALLERY_REAL_WEB_SCROLL_CANCEL_100K_SUMMARY ' + JSON.stringify(summary))
    assert(summary.passed, 'real Gallery mounted-scroll cancellation gate failed')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
main().then(() => app.exit(0)).catch(err => {
  console.error('GALLERY_REAL_WEB_SCROLL_CANCEL_100K_ERROR ' + (err?.stack || String(err)))
  app.exit(1)
})
