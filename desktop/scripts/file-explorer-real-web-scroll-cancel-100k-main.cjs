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
// P040 is a new narrow-viewport measurement, not a re-run of accepted wide-Web P015.
const mobileCancelMode = process.env.XD_FILEEXPLORER_MOBILE_GO_CANCEL_100K_PERF === '1'
const physicalCancelMode = process.env.XD_FILEEXPLORER_MOBILE_PHYSICAL_GO_CANCEL_100K_PERF === '1'
if (physicalCancelMode) assert(mobileCancelMode, 'P052 requires actual Mobile Web viewport mode')
const out = path.resolve(process.env.XD_FILEEXPLORER_REAL_SCROLL_RESULTS ||
  path.join(__dirname, '..', mobileCancelMode ?
    'file-explorer-mobile-go-cancel-100k-results' : 'file-explorer-real-scroll-results'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const ticksPerSecond = mobileCancelMode ?
  Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) : 0
if (mobileCancelMode) assert(ticksPerSecond > 0, 'Linux CLK_TCK required for real Go/Renderer CPU')
function processSnapshot(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, 'real native process PID required')
  const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8')
  const rss = status.match(/^VmRSS:\s+(\d+) kB/m)
  const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8')
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
  const ticks = Number(fields[11]) + Number(fields[12])
  assert(rss && Number.isFinite(ticks), 'real Linux process CPU/RSS unavailable')
  return { pid, rssBytes: Number(rss[1]) * 1024, cpuMs: ticks * 1000 / ticksPerSecond }
}
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

async function until(fn, timeoutMs, what) {
  const began = performance.now()
  while (performance.now() - began < timeoutMs) {
    const result = await fn()
    if (result) return result
    await sleep(25)
  }
  throw Error('timed out: ' + what)
}

async function startFixture(view, sample, readyFile) {
  const name = view + '-sample-' + sample
  const log = fs.createWriteStream(path.join(out, 'native-' + name + '.log'))
  const child = spawn('go', [
    'test', '-run', '^TestFileExplorerRealWebScrollCancelFixture100K$',
    '-count=1', '-timeout=15m', '-v', './internal/api',
  ], {
    cwd: root,
    env: {
      ...process.env,
      XD_FILEEXPLORER_REAL_WEB_SCROLL_100K_PERF: '1',
      XD_FILEEXPLORER_REAL_WEB_DIST: dist,
      XD_FILEEXPLORER_REAL_WEB_READY_FILE: readyFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  child.once('error', error => log.write('fixture spawn error: ' + String(error)))
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const config = await until(() => {
    if (child.exitCode !== null) throw Error('native fixture exited before ready: ' + child.exitCode)
    return fs.existsSync(readyFile) ? JSON.parse(fs.readFileSync(readyFile, 'utf8')) : null
  }, physicalCancelMode ? 480000 : 180000, 'native 100k FileExplorer signed PostgreSQL fixture')
  return { child, config, exited, log }
}

async function stopFixture(fixture) {
  if (!fixture) return
  try { await fetch(fixture.config.url + '/__perf/stop', { method: 'POST' }) } catch (_) {}
  const exit = await Promise.race([fixture.exited, sleep(30000).then(() => ({ code: 'timeout' }))])
  fixture.log.end()
  if (exit.code !== 0) {
    fixture.child.kill('SIGKILL')
    throw Error('FileExplorer native 100k fixture exit: ' + JSON.stringify(exit))
  }
}

async function stats(url) {
  const response = await fetch(url + '/__perf/viewport-cancel-stats', { cache: 'no-store' })
  assert.equal(response.status, 200)
  return response.json()
}

// Executed inside the real shared FileExplorer component's DOM.
function scrollMountedFileExplorer() {
  try {
    const host = document.querySelector('[data-xdrive-file-explorer-scroll-host]')
    if (!(host instanceof HTMLElement)) {
      return { error: 'actual FileExplorer scroll host is absent', body: document.body?.innerText?.slice(0, 180) }
    }
    const extent = host.scrollHeight - host.clientHeight
    const mountedBefore = document.querySelectorAll('[data-xdrive-file-explorer-item]').length
    const oldScrollTop = host.scrollTop
    host.scrollTop = Math.floor(extent * 0.5)
    host.dispatchEvent(new Event('scroll'))
    return {
      clientWidth: document.documentElement.clientWidth,
      narrowBreakpoint: matchMedia('(max-width: 899px)').matches,
      oldScrollTop, newScrollTop: host.scrollTop,
      extent, viewportHeight: host.clientHeight, mountedBefore,
      loadedImagesBefore: document.querySelectorAll('[data-xdrive-file-explorer-item-visual]').length,
    }
  } catch (error) {
    return { error: String(error), stack: error?.stack || '' }
  }
}

async function independentRange(fixture) {
  const base = fixture.config.url
  const configResponse = await fetch(base + '/__perf/config', { cache: 'no-store' })
  assert.equal(configResponse.status, 200)
  const config = await configResponse.json()
  assert.equal(config.logical_count, 100000)
  assert.equal(config.physical_images, physicalCancelMode ? 100000 : 16)
  const request = await fetch(base + '/api/v1/nodes/' + config.folder_id +
    '/children?offset=50000&limit=200&sort=name&order=asc', {
      headers: { Authorization: 'Bearer ' + config.token }, cache: 'no-store',
    })
  if (request.status !== 200) {
    throw Error('real FileExplorer independent 100k range HTTP ' + request.status +
      ' body=' + (await request.text()).slice(0, 500))
  }
  const page = await request.json()
  assert.equal(page.total_count, 100000)
  assert.equal(page.items.length, 200)
  return { status: request.status, total: page.total_count, returned: page.items.length }
}

async function sampleOnce(view, sample, readyFile) {
  let fixture = null
  let window = null
  try {
    fixture = await startFixture(view, sample, readyFile)
    assert.equal(fixture.config.logical_count, 100000)
    assert.equal(fixture.config.first_image_nodes.length, 6)
    if (physicalCancelMode) {
      assert.equal(fixture.config.physical_images, 100000)
      assert.equal(fixture.config.physical_mode, true)
      assert.equal(fixture.config.physical_cancel_mode, true)
      assert(fixture.config.physical_source_bytes >= 50000000,
        'P052 requires 100k real unique decodable JPEG CAS source bytes')
    }
    window = new BrowserWindow({
      show: true, width: mobileCancelMode ? 390 : 1440,
      height: mobileCancelMode ? 844 : 900,
      webPreferences: {
        partition: (mobileCancelMode ? 'mobile-file-explorer-go-cancel-' :
          'real-file-explorer-scroll-') + view + '-' + sample,
        sandbox: false, nodeIntegration: false, contextIsolation: true,
        webSecurity: true, backgroundThrottling: false,
      },
    })
    const failures = []
    window.webContents.on('render-process-gone', (_event, state) =>
      failures.push('renderer gone: ' + JSON.stringify(state)))
    window.webContents.on('did-fail-load', (_event, code, message) =>
      failures.push('did-fail-load ' + code + ': ' + message))
    await window.loadURL(fixture.config.url +
      '/?xdriveFileExplorerRealScroll=1&xdriveFileExplorerViewMode=' + view +
      (physicalCancelMode ? '&xdriveFileExplorerPhysical100k=1' : ''))
    const started = await until(async () => {
      if (failures.length) throw Error(failures.join('; '))
      const error = await window.webContents.executeJavaScript(
        'window.__xdriveFileExplorerRealScrollError || ""', true)
      if (error) throw Error('real FileExplorer render/range: ' + error)
      const current = await stats(fixture.config.url)
      if (current.started > 6) throw Error('more than six watched JPEG requests admitted: ' + JSON.stringify(current))
      return current.started === 6 && current.active === 6 &&
        current.first_chunks === 6 && current.emitted_bytes === 1536 ? current : null
    }, 60000, 'six first-viewport genuine HTTP JPEG streams (' + view + ')')
    // Read resource counters from the actual Go test process and Electron Renderer.
    // Only the 160 ms cancellation interval is compared; cold boot/100k seed excluded.
    if (mobileCancelMode) assert(Number.isSafeInteger(fixture.config.server_pid) &&
      fixture.config.server_pid > 0, 'real Go fixture PID missing')
    const goBefore = mobileCancelMode ? processSnapshot(fixture.config.server_pid) : null
    const rendererBefore = mobileCancelMode ? processSnapshot(window.webContents.getOSProcessId()) : null
    const electronCPUStart = mobileCancelMode ? process.cpuUsage() : null
    const marker = await fetch(fixture.config.url + '/__perf/viewport-cancel-mark', {
      method: 'POST',
    })
    assert.equal(marker.status, 204)
    const scroll = await window.webContents.executeJavaScript(
      '(' + scrollMountedFileExplorer.toString() + ')()', true)
    assert(!scroll.error, 'FileExplorer real DOM scroll unavailable: ' + JSON.stringify(scroll))
    assert(scroll.newScrollTop > scroll.oldScrollTop + 10000,
      'real 100k FileExplorer scroll did not advance: ' + JSON.stringify(scroll))
    assert(scroll.mountedBefore > 0 && scroll.mountedBefore < 1000,
      'mounted FileExplorer item window is unbounded: ' + JSON.stringify(scroll))
    if (mobileCancelMode) assert(scroll.narrowBreakpoint &&
      scroll.clientWidth >= 375 && scroll.clientWidth <= 390,
      'actual shared Mobile Web 390px breakpoint is not active: ' + JSON.stringify(scroll))
    await sleep(160)
    const after = await stats(fixture.config.url)
    const go = {
      started: started.started,
      contextDone: after.context_done - started.context_done,
      canceled: after.cancelled - started.cancelled,
      stillActiveAt160ms: after.active,
      oldBytesBeforeScroll: started.emitted_bytes,
      staleBytesAfterScroll: after.emitted_bytes - started.emitted_bytes,
      worstContextNotificationMs: after.max_cancel_us / 1000,
    }
    console.log('FILEEXPLORER_REAL_WEB_SCROLL_100K_PRE_RANGE ' +
      JSON.stringify({ view, sample, scroll, go }))
    const resource = mobileCancelMode ? (() => {
      const goAfter = processSnapshot(fixture.config.server_pid)
      const rendererAfter = processSnapshot(window.webContents.getOSProcessId())
      const cpu = process.cpuUsage(electronCPUStart)
      return {
        scope: 'actual native process CPU/RSS sampled before viewport eviction and after 160ms; not a whole-app peak',
        goRssBeforeBytes: goBefore.rssBytes, goRssAfterBytes: goAfter.rssBytes,
        goRssGrowthBytes: Math.max(0, goAfter.rssBytes - goBefore.rssBytes),
        goCpuDeltaMs: Math.max(0, goAfter.cpuMs - goBefore.cpuMs),
        rendererRssBeforeBytes: rendererBefore.rssBytes,
        rendererRssAfterBytes: rendererAfter.rssBytes,
        rendererRssGrowthBytes: Math.max(0, rendererAfter.rssBytes - rendererBefore.rssBytes),
        rendererCpuDeltaMs: Math.max(0, rendererAfter.cpuMs - rendererBefore.cpuMs),
        electronMainCpuDeltaMs: (cpu.user + cpu.system) / 1000,
      }
    })() : null
    const healthy = await independentRange(fixture)
    const row = {
      view, sample, logicalNodes: 100000,
      physicalJPEGOriginals: physicalCancelMode ? 100000 : 16,
      physicalCASSourceBytes: fixture.config.physical_source_bytes,
      physicalCancelMode,
      seedMsExcluded: fixture.config.seed_ms, mobileCancelMode,
      mobileCssWindowWidth: mobileCancelMode ? 390 : 1440,
      scroll, go, resource, healthy,
      scope: physicalCancelMode ?
        'P052 mounted narrow Web Files Grid/Details, 100k SHA-distinct true 80x64 JPEG original CAS. Six real slow original-backed HTTP thumbnail responses and 160ms AbortSignal -> Gin Request.Context.Done, Go/Renderer process RSS and CPU. Not real Android/iOS/PWA or Live/H264, and not Task Center cancellation.' :
        'Mounted shared Web FileExplorer Grid/Details, native PostgreSQL 17/Gin/auth/Local CAS genuine JPEG GETs; deliberate test-only slow-writer 1500ms after 256 bytes. Not Desktop Agent, Live/H264/RAW decoding or real WAN.',
    }
    if (mobileCancelMode && (resource.goRssGrowthBytes > 134217728 ||
      resource.rendererRssGrowthBytes > 134217728)) {
      throw Error('P040 real 160ms Go/Renderer RSS growth exceeded 128MiB: ' + JSON.stringify(row))
    }
    if (go.started !== 6 || go.contextDone !== 6 || go.canceled !== 6 ||
      go.stillActiveAt160ms !== 0 || go.staleBytesAfterScroll !== 0 ||
      go.worstContextNotificationMs > 160) {
      throw Error('actual FileExplorer scroll leaves obsolete native Go work: ' + JSON.stringify(row))
    }
    fs.writeFileSync(path.join(out, view + '-sample-' + sample + '.json'),
      JSON.stringify(row, null, 2) + '\n')
    console.log('FILEEXPLORER_REAL_WEB_SCROLL_100K_SAMPLE ' + JSON.stringify(row))
    return row
  } finally {
    if (window && !window.isDestroyed()) window.destroy()
    if (fixture) await stopFixture(fixture)
  }
}

async function main() {
  assert(process.env.XD_TEST_DATABASE_URL, 'native PostgreSQL URL required')
  assert(fs.existsSync(path.join(dist, 'index.html')), 'real Web build missing')
  fs.mkdirSync(out, { recursive: true })
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'file-explorer-real-scroll-100k-'))
  const rows = []
  try {
    await app.whenReady()
    for (const view of ['grid', 'details']) {
      for (let sample = 1; sample <= 3; sample += 1) {
        rows.push(await sampleOnce(view, sample, path.join(temp, view + '-' + sample + '.json')))
      }
    }
    const summary = {
      status: physicalCancelMode ?
        'measured-P052-Mobile-Web-100k-DISTINCT-physical-CAS-JPEG-scroll-Go-cancellation' : mobileCancelMode ?
        'measured-Mobile-Web-390px-FileExplorer-100k-scroll-to-real-Go-cancellation' :
        'measured-real-Web-FileExplorer-Grid-Details-100k-scroll-to-Go-cancellation',
      mobileCancelMode, physicalCancelMode,
      physicalOriginalsPerFixture: physicalCancelMode ? 100000 : 16,
      cssWindowWidth: mobileCancelMode ? 390 : 1440,
      observedDocumentWidth: mobileCancelMode ? 375 : null,
      sampleCount: rows.length, eachModeSamples: 3, budgetMs: 160,
      views: ['grid', 'details'],
      worstGoContextMs: Math.max(...rows.map(row => row.go.worstContextNotificationMs)),
      passed: rows.length === 6 && rows.every(row =>
        row.go.contextDone === 6 && row.go.canceled === 6 &&
        row.go.stillActiveAt160ms === 0 && row.go.staleBytesAfterScroll === 0 &&
        row.go.worstContextNotificationMs <= 160 &&
        (!mobileCancelMode || (row.scroll.narrowBreakpoint &&
          row.scroll.clientWidth >= 375 && row.scroll.clientWidth <= 390 &&
          row.resource?.goRssGrowthBytes <= 134217728 &&
          row.resource?.rendererRssGrowthBytes <= 134217728)) &&
        row.healthy.total === 100000 && row.healthy.returned === 200 &&
        (!physicalCancelMode || (row.physicalJPEGOriginals === 100000 &&
          row.physicalCASSourceBytes >= 50000000 && row.physicalCancelMode))),
      limits: physicalCancelMode ?
        'P052 real 100k SHA-distinct physical JPEG CAS originals per fresh PG/Go fixture; 390px shared Web FileExplorer mounted Grid/Details; 6 genuine first-body JPEG HTTP GETs per view intentionally delayed 1500ms after 256B, n3 each view. At +160ms 0 Go handlers/SQL work, 6/6 Context.Done, zero wasted response bytes, native CPU/RSS <=128MiB; does NOT claim live Android/iOS/PWA or persistent task cancellation.' : mobileCancelMode ?
        '390px shared Web FileExplorer, 100k metadata + only 16 physical JPEG originals, 6 first-chunk slow HTTP requests per Grid/Details view; 3 independent runs each. Actual Electron Chromium 375px document and Linux native Go Context.Done, not full Mobile App Frame, real iOS/Android device, installed PWA, sustained Go/Renderer peak or durable Task Center cancellation.' :
        '100k image Nodes/Files/MediaMetadata but only 16 distinct physical JPEG CAS originals; actual mounted Web Grid/Details and Go HTTP; no Windows or Desktop Main/Agent, native Live/RAW/video codec, full-file network throughput or peak RSS.',
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log((mobileCancelMode ?
      'FILEEXPLORER_MOBILE_WEB_GO_CANCEL_100K_SUMMARY ' :
      'FILEEXPLORER_REAL_WEB_SCROLL_100K_SUMMARY ') + JSON.stringify(summary))
    assert(summary.passed, 'mounted FileExplorer Grid/Details cancellation budget failed')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => {
  console.error('FILEEXPLORER_REAL_WEB_SCROLL_100K_ERROR ' + (error?.stack || String(error)))
  app.exit(1)
})
