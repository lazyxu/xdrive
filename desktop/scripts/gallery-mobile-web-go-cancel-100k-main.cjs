'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '..', '..')
const dist = path.join(root, 'web', 'dist')
// P0-C2b1: opt-in cross-document navigation; this is not an SPA route switch.
const p0c2PageLeaveMode = process.env.XD_PWA_P0C2_PAGELEAVE_BEFORE === '1'
const out = path.join(__dirname, '..', p0c2PageLeaveMode ?
  'pwa-p0c2-pageleave-go-results' : 'gallery-mobile-web-go-cancel-100k-results')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// P048: 390px native Chromium running the actual shared Mobile Web Gallery.
// This measures a different platform than the accepted P016 wide-Web baseline.
const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], {encoding:'utf8'}).trim())
assert(ticksPerSecond > 0, 'real Linux process clock required')
// First P048 #38716968108 was Invalid harness: Go wrapper /proc children=[].
// Launch compiled genuine api.test directly, and confirm the exact process executable.
function actualFixtureGoPID(serverPid) {
  assert(Number.isSafeInteger(serverPid) && serverPid > 0, 'real Gin Server PID required')
  const executable = fs.readlinkSync('/proc/' + serverPid + '/exe')
  assert(executable.endsWith('/api.test'), 'not a genuine compiled Gin api.test process: ' + executable)
  return serverPid
}
function nativeProcessStats(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, 'real Go/Renderer process ID needed')
  const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8')
  const match = status.match(/^VmRSS:\s+(\d+) kB/m)
  const rawStat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8')
  const fields = rawStat.slice(rawStat.lastIndexOf(')') + 2).trim().split(/\s+/)
  const ticks = Number(fields[11]) + Number(fields[12])
  assert(match && Number.isFinite(ticks), 'Linux /proc RSS/CPU unavailable')
  return {pid, rssBytes: Number(match[1])*1024, cpuMs: ticks * 1000 / ticksPerSecond}
}
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
  const goBinary = process.env.XD_GALLERY_MOBILE_NATIVE_GO_BINARY
  assert(goBinary && fs.existsSync(goBinary) && path.basename(goBinary) === 'api.test',
    'compiled actual Go api.test fixture required')
  const child = spawn(goBinary, [
    '-test.run=^TestGalleryRealWebColdFixture100K$',
    '-test.count=1', '-test.timeout=12m', '-test.v',
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
  let fixture = null, win = null, resourceSampler = null
  try {
    fixture = await startFixture(sample, ready)
    assert.equal(fixture.config.logical_assets, 100000)
    assert.equal(fixture.config.physical_nodes, 115000)
    win = new BrowserWindow({
      show: true, width: 390, height: 844,
      webPreferences: {
        partition: 'real-mobile-gallery-web-scroll-' + sample, sandbox: false,
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
    const viewport = await win.webContents.executeJavaScript(
      '({width:document.documentElement.clientWidth,height:innerHeight,narrow:matchMedia("(max-width:899.95px)").matches})', true)
    assert(viewport.narrow && viewport.width >= 360 && viewport.width <= 390 &&
      viewport.height >= 700, 'actual Mobile Web responsive Gallery not mounted: ' + JSON.stringify(viewport))
    await until(async () => {
      if (failures.length) throw Error(failures.join('; '))
      const s = await readStats(fixture.config.url)
      if (s.started > 6) throw Error('more than six real requests admitted: '+JSON.stringify(s))
      return s.started >= 4 && s.started <= 6 && s.active === s.started &&
        s.first_chunks === s.started && s.emitted_bytes === 256 * s.started ? s : null
    }, 45000, 'four to six real Mobile Web JPEG streams in Go Handler')
    await sleep(160)
    const started = await readStats(fixture.config.url)
    const streamCount = started.started
    assert(streamCount >= 4 && streamCount <= 6 && started.active === streamCount &&
      started.first_chunks === streamCount && started.emitted_bytes === 256 * streamCount,
      'mobile actual real JPEG streams unstable: ' + JSON.stringify(started))
    const actualGoPID = actualFixtureGoPID(fixture.child.pid)
    const goStart = nativeProcessStats(actualGoPID)
    const rendererPID = win.webContents.getOSProcessId()
    const rendererStart = nativeProcessStats(rendererPID)
    let peakGoRSS = goStart.rssBytes
    let peakRendererRSS = rendererStart.rssBytes
    resourceSampler = setInterval(() => {
      try {
        peakGoRSS = Math.max(peakGoRSS, nativeProcessStats(actualGoPID).rssBytes)
        peakRendererRSS = Math.max(peakRendererRSS, nativeProcessStats(rendererPID).rssBytes)
      } catch { /* end snapshot and cancellation assertions fail a dead process */ }
    }, 25)
    const marker = await fetch(fixture.config.url + '/__perf/viewport-cancel-mark',
      { method: 'POST' })
    assert.equal(marker.status, 204)
    let scroll
    let leaveNavigation = null
    if (p0c2PageLeaveMode) {
      const beforeLeave = await win.webContents.executeJavaScript(
        '({mounted:!!document.querySelector("[data-xdrive-media-gallery-virtual-grid]"),width:document.documentElement.clientWidth})', true)
      assert(beforeLeave.mounted && beforeLeave.width >= 360 && beforeLeave.width <= 390,
        'cannot leave nonmounted shared Mobile Gallery: ' + JSON.stringify(beforeLeave))
      scroll = {kind:'cross-document-navigation',mountedGalleryBefore:true}
      // Keep navigation asynchronous until after the 160ms Go deadline.
      leaveNavigation = win.loadURL(fixture.config.url +
        '/?xdriveP0C2PageLeave=1&xdriveMediaProgress=off')
    } else {
      scroll = await win.webContents.executeJavaScript(
      '(' + scrollActualGalleryViewport.toString() + ')()', true)
    assert(!scroll.error, 'real Gallery DOM scroll unavailable: ' + JSON.stringify(scroll))
    assert(scroll.newScrollTop > scroll.oldScrollTop + 10000,
      'real Gallery scrollTop did not advance: ' + JSON.stringify(scroll))
    assert(scroll.initialMountedTiles > 0 && scroll.initialMountedTiles < 1000)
    }
    await sleep(160)
    const after = await readStats(fixture.config.url)
    if (p0c2PageLeaveMode) {
      await leaveNavigation
      const left = await win.webContents.executeJavaScript(
        '({stillGallery:!!document.querySelector("[data-xdrive-media-gallery-virtual-grid]")})', true)
      assert.equal(left.stillGallery, false, 'page leave must unmount actual Gallery')
      scroll.galleryUnmounted = true
    }
    clearInterval(resourceSampler); resourceSampler = null
    const goEnd = nativeProcessStats(actualGoPID)
    const rendererEnd = nativeProcessStats(rendererPID)
    peakGoRSS = Math.max(peakGoRSS, goEnd.rssBytes)
    peakRendererRSS = Math.max(peakRendererRSS, rendererEnd.rssBytes)
    const resources = {
      go: {initial:goStart,final:goEnd,peakGrowthBytes:Math.max(0,peakGoRSS-goStart.rssBytes),
        cpuDeltaMs:goEnd.cpuMs-goStart.cpuMs},
      renderer: {initial:rendererStart,final:rendererEnd,
        peakGrowthBytes:Math.max(0,peakRendererRSS-rendererStart.rssBytes),
        cpuDeltaMs:rendererEnd.cpuMs-rendererStart.cpuMs},
    }
    // Preserve source-exact UI -> Go cancellation metrics even if a later
    // independent 100k Range exposes a PostgreSQL resource budget failure.
    const cancelDiagnostic = {
      sample, viewport, streamCount, actualScroll: scroll,
      started: started.started, contextDone: after.context_done - started.context_done,
      cancelled: after.cancelled - started.cancelled, active: after.active,
      afterCancelBytes: after.emitted_bytes - started.emitted_bytes,
      worstContextNotificationMs: after.max_cancel_us / 1000,
    }
    console.log('GALLERY_MOBILE_WEB_GO_CANCEL_100K_PRE_RANGE ' +
      JSON.stringify(cancelDiagnostic))
    const healthy = await newIndependentRange(fixture)
    const row = {
      sample, viewport, streamCount, resources, logicalAssets: 100000, physicalNodes: 115000,
      firstImageNodes: fixture.config.first_image_nodes,
      seedMsExcluded: fixture.config.seed_ms,
      scroll, healthy, pageLeaveMode:p0c2PageLeaveMode,
      go: {
        started: started.started, canceled: after.cancelled - started.cancelled,
        contextDone: after.context_done - started.context_done,
        stillActiveAt160ms: after.active,
        wastedBytesAfterScroll: after.emitted_bytes - started.emitted_bytes,
        wastedBytesAfterAction: after.emitted_bytes - started.emitted_bytes,
        beforeScrollActualBytes: started.emitted_bytes,
        worstContextNotificationMs: after.max_cancel_us / 1000,
        totalRequestBytesAfterCancel: after.emitted_bytes,
      },
      scope: p0c2PageLeaveMode ?
        'Compiled 390px Mobile Web Gallery mounted with real Gin/PG17/CAS, 100k logical assets/115k nodes, 4-6 slow thumbnails: cross-document unload -> Go Context.Done in 160ms. NOT Files/Gallery SPA route; NOT 100k physical originals, iOS installed PWA/WAN or durable task cancellation.' :
        'Actual mounted 390px Mobile Web shared Gallery VirtualGrid; Chromium scrollTop -> Gin/PG17/CAS Go Request.Context().Done; 100k logical assets/115k metadata Nodes; only first 4-6 slow JPEG physical streams; NOT real iOS/Android/PWA, independent 100k original files, Agent IPC, H264 or Live playback, WAN, or durable task cancellation.',
    }
    if (row.go.canceled !== streamCount || row.go.contextDone !== streamCount ||
        row.go.stillActiveAt160ms !== 0 || row.go.wastedBytesAfterScroll !== 0 ||
        row.go.worstContextNotificationMs > 160 || after.first_chunks !== streamCount ||
        resources.go.peakGrowthBytes > 128 * 1024 * 1024 ||
        resources.renderer.peakGrowthBytes > 128 * 1024 * 1024 ||
        resources.go.cpuDeltaMs < 0 || resources.renderer.cpuDeltaMs < 0) {
      throw Error('real Gallery scroll did not release obsolete Go thumbnail work: ' +
        JSON.stringify(row))
    }
    fs.writeFileSync(path.join(out, 'sample-' + sample + '.json'),
      JSON.stringify(row, null, 2) + '\n')
    console.log('GALLERY_MOBILE_WEB_GO_CANCEL_100K_SAMPLE ' + JSON.stringify(row))
    return row
  } finally {
    if (resourceSampler) clearInterval(resourceSampler)
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
      status: p0c2PageLeaveMode ?
        'measured-CURRENT-P0-C2b1-390px-Gallery-pageleave-Go-cancellation' :
        'measured-CURRENT-390px-Mobile-Web-Gallery-Go-cancellation',
      mobileCancelMode: true, cssWindowWidth:390, pageLeaveMode:p0c2PageLeaveMode,
      sampleCount: rows.length, budgetMs: 160,
      worstGoContextP50Ms: worst[1], worstGoContextMaxMs: worst[2],
      passed: rows.length === 3 && rows.every(row =>
        (!p0c2PageLeaveMode || (row.pageLeaveMode === true &&
          row.scroll.kind === 'cross-document-navigation' &&
          row.scroll.mountedGalleryBefore === true &&
          row.scroll.galleryUnmounted === true)) &&
        row.go.started === row.streamCount && row.streamCount >= 4 && row.streamCount <= 6 &&
        row.viewport.narrow && row.viewport.width >= 360 && row.viewport.width <= 390 &&
        row.resources.go.peakGrowthBytes <= 128 * 1024 * 1024 &&
        row.resources.renderer.peakGrowthBytes <= 128 * 1024 * 1024 &&
        row.go.canceled === row.streamCount && row.go.contextDone === row.streamCount &&
        row.go.stillActiveAt160ms === 0 &&
        row.go.wastedBytesAfterScroll === 0 && row.go.worstContextNotificationMs <= 160),
      limits: p0c2PageLeaveMode ?
        'P0-C2b1 cross-document pageleave, true Chromium/Go/PG17/CAS, 100k logical and 115k metadata, 4-6 actual JPEG streams; Go Context.Done and RSS/CPU, not iOS, SPA route or 100k originals.' :
        '100k logical PhotoAssets and 115k metadata nodes, only first viewport 4-6 real physical JPEG streams; 390px Chromium shared Mobile Gallery; n3 independent real Gin/PG17/CAS, exact Go Handler Context.Done; Go/Renderer CPU RSS. Not iOS/Android native, installed PWA, all 100k real media, video/Live playback, slow WAN, durable task cancellation.',
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('GALLERY_MOBILE_WEB_GO_CANCEL_100K_SUMMARY ' + JSON.stringify(summary))
    assert(summary.passed, 'real Gallery mounted-scroll cancellation gate failed')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
main().then(() => app.exit(0)).catch(err => {
  console.error('GALLERY_MOBILE_WEB_GO_CANCEL_100K_ERROR ' + (err?.stack || String(err)))
  app.exit(1)
})
