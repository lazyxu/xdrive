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
const out = path.join(__dirname, '..', 'file-explorer-real-scroll-results')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
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
  }, 180000, 'native 100k FileExplorer signed PostgreSQL fixture')
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
  assert.equal(config.physical_images, 16)
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
    window = new BrowserWindow({
      show: true, width: 1440, height: 900,
      webPreferences: {
        partition: 'real-file-explorer-scroll-' + view + '-' + sample,
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
      '/?xdriveFileExplorerRealScroll=1&xdriveFileExplorerViewMode=' + view)
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
    const healthy = await independentRange(fixture)
    const row = {
      view, sample, logicalNodes: 100000, physicalJPEGOriginals: 16,
      seedMsExcluded: fixture.config.seed_ms, scroll, go, healthy,
      scope: 'Mounted shared Web FileExplorer Grid/Details, native PostgreSQL 17/Gin/auth/Local CAS genuine JPEG GETs; deliberate test-only slow-writer 1500ms after 256 bytes. Not Desktop Agent, Live/H264/RAW decoding or real WAN.',
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
      status: 'measured-real-Web-FileExplorer-Grid-Details-100k-scroll-to-Go-cancellation',
      sampleCount: rows.length, eachModeSamples: 3, budgetMs: 160,
      views: ['grid', 'details'],
      worstGoContextMs: Math.max(...rows.map(row => row.go.worstContextNotificationMs)),
      passed: rows.length === 6 && rows.every(row =>
        row.go.contextDone === 6 && row.go.canceled === 6 &&
        row.go.stillActiveAt160ms === 0 && row.go.staleBytesAfterScroll === 0 &&
        row.go.worstContextNotificationMs <= 160 &&
        row.healthy.total === 100000 && row.healthy.returned === 200),
      limits: '100k image Nodes/Files/MediaMetadata but only 16 distinct physical JPEG CAS originals; actual mounted Web Grid/Details and Go HTTP; no Windows or Desktop Main/Agent, native Live/RAW/video codec, full-file network throughput or peak RSS.',
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
    console.log('FILEEXPLORER_REAL_WEB_SCROLL_100K_SUMMARY ' + JSON.stringify(summary))
    assert(summary.passed, 'mounted FileExplorer Grid/Details cancellation budget failed')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0)).catch(error => {
  console.error('FILEEXPLORER_REAL_WEB_SCROLL_100K_ERROR ' + (error?.stack || String(error)))
  app.exit(1)
})
