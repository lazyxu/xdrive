'use strict'

// SH-P003: real production Web app in Chromium -> live Gin -> PostgreSQL17.
// Wide (1440px) and Mobile Web CSS (390px), each three browser sessions.
// No mocked fetch/route and no production instrumentation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '../..')
const out = path.resolve(process.env.XD_SH_P003_RESULTS || path.join(root, 'desktop/sh-p003-results'))
const dist = path.join(root, 'web/dist')
const readyPath = path.join(out, 'private-ready.json')
const bin = process.env.XD_SH_P003_GO_TEST_BIN
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

async function until(fn, durationMs, label) {
  const start = performance.now()
  while (performance.now() - start < durationMs) {
    const found = await fn()
    if (found) return found
    await pause(15)
  }
  throw Error('timed out: ' + label)
}

async function readJSON(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw Error('real Gin fixture HTTP ' + response.status + ' ' + url)
  return response.json()
}
async function post(url) {
  const response = await fetch(url, { method: 'POST', cache: 'no-store' })
  if (response.status !== 204) throw Error('real Gin POST ' + url + ' -> ' + response.status)
}

function startFixture() {
  if (!bin || !fs.existsSync(bin)) throw Error('missing compiled authentic internal/api test binary')
  const log = fs.createWriteStream(path.join(out, 'real-gin-postgres.log'))
  const proc = spawn(bin, ['-test.run=^TestSHP003RealBrowserPublicShare100KFixture$', '-test.timeout=18m', '-test.v'], {
    cwd: root,
    env: { ...process.env, XD_SH_P003_REAL_BROWSER_PERF: '1',
      XD_SH_P003_WEB_DIST: dist, XD_SH_P003_READY_FILE: readyPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.pipe(log, { end: false })
  proc.stderr.pipe(log, { end: false })
  proc.on('error', error => log.write('fixture spawn error: ' + error + '\n'))
  const exited = new Promise(resolve => proc.once('exit', (code, signal) => resolve({ code, signal })))
  return { proc, exited, log }
}

async function createWindow(width, sample) {
  const win = new BrowserWindow({
    show: true,
    width,
    height: width === 390 ? 844 : 900,
    webPreferences: {
      partition: 'shp003-' + width + '-' + sample,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  win.webContents.on('render-process-gone', (_event, details) =>
    console.error('SH_P003_RENDERER_GONE ' + JSON.stringify({ width, sample, details })))
  if (width === 390) {
    // First create a live Chromium renderer target. Initializing CDP device
    // emulation on an un-navigated Electron WebContents was not accepted by
    // the prior native CI, which crashed before six valid browser samples.
    await win.loadURL('about:blank')
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled',
      { enabled: true, maxTouchPoints: 1 })
  }
  return win
}
// Retire each isolated BrowserWindow and detach its CDP session before
// creating the next sample, rather than accumulating WebContents/X11 work.
async function closeWindow(win) {
  if (!win || win.isDestroyed()) return
  if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
  const closed = new Promise(resolve => win.once('closed', resolve))
  win.close()
  await Promise.race([closed, pause(750)])
  if (!win.isDestroyed()) win.destroy()
  await closed
  await pause(60)
}
async function dom(win, fn) {
  if (win.isDestroyed()) throw Error('Chromium window unexpectedly destroyed')
  return win.webContents.executeJavaScript('(' + fn.toString() + ')()', true)
}
function buttonsAndRows() {
  const labels = [...document.querySelectorAll('button')].map(x => x.textContent.trim())
  const rows = [...document.querySelectorAll('[role="listitem"]')].map(x => x.textContent.trim())
  return { labels, rows, body: document.body.innerText.slice(0, 500),
    publicSlot: !!document.querySelector('[data-xdrive-public-share-read-slot]'),
    width: innerWidth, touch: matchMedia('(pointer: coarse)').matches,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 }
}
async function click(win, label) {
  const result = await win.webContents.executeJavaScript(
    '(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === ' +
    JSON.stringify(label) + '); if (!b || b.disabled) return false; b.click(); return true })()', true)
  assert.equal(result, true, 'missing/disabled real public share button: ' + label)
}

async function main() {
  if (process.env.XD_SH_P003_REAL_BROWSER_PERF !== '1') {
    throw Error('SH-P003 is a branch-scoped opt-in physical browser/PG benchmark')
  }
  fs.mkdirSync(out, { recursive: true })
  if (fs.existsSync(readyPath)) fs.unlinkSync(readyPath)
  const metricsStart = process.resourceUsage()
  const fixture = startFixture()
  let base = '', win = null
  const result = {
    workload: 'SH-P003/live-Chromium-Web-and-MobileWeb-public-share-100k-PG-cancel',
    exact_source_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    physical_cas_originals: 0,
    target_metadata_nodes: 100000,
    cancel_budget_ms: 500,
    page_budget_ms: 2000,
    sample_count_per_viewport: 3,
    scopes: ['1440px-Linux-Chromium-Web', '390px-Linux-Chromium-MobileWeb-emulation'],
    excludes: 'Native Electron App/Agent IPC, installed PWA, Android/iOS hardware, WAN, 100k physical image/video/Live CAS, durable transfer cancellation',
    cancel_samples: [], page_samples: [],
  }
  try {
    const ready = await until(() => {
      if (fixture.proc.exitCode !== null) throw Error('real Go fixture exited before ready: ' + fixture.proc.exitCode)
      return fs.existsSync(readyPath) ? JSON.parse(fs.readFileSync(readyPath, 'utf8')) : null
    }, 240000, '100k real PostgreSQL/Gin file-share source ready')
    base = ready.url
    assert.equal(ready.metadata_nodes, 100000)
    assert.equal(ready.physical_cas_originals, 0)
    const config = await readJSON(base + '/__perf/config')
    assert.equal(config.metadata_nodes, 100000)
    assert.equal(config.physical_cas_originals, 0)
    assert.equal(typeof config.share_token, 'string')
    assert.ok(config.share_token.length >= 40)
    const shareURL = base + '/#/s/' + encodeURIComponent(config.share_token)
    let expected = 0
    // Complete each browser's own SQL blocked GET before opening the next.
    // Reuse one genuine 100k PG source but create SIX independent renderers.
    for (const width of [1440, 390]) {
      for (let sample = 1; sample <= 3; sample++) {
        console.log('SH_P003_BROWSER_PHASE ' + JSON.stringify({ phase: 'cancel-start', width, sample }))
        win = await createWindow(width, sample)
        await win.loadURL(shareURL)
        expected++
        await until(async () => {
          const stats = await readJSON(base + '/__perf/state')
          return stats.started === expected && stats.sql_waiters === 1 && stats.completed === expected - 1 ? stats : null
        }, 15000, 'actual public GET SQL waiter in PostgreSQL17')
        const beforeUI = await dom(win, buttonsAndRows)
        assert.equal(beforeUI.publicSlot, true, 'production PublicShare not mounted')
        assert.equal(beforeUI.touch, width === 390, 'mobile Web pointer emulation mismatch')
        assert.equal(beforeUI.horizontalOverflow, false, 'actual share overflows viewport')
        await post(base + '/__perf/mark')
        const t0 = performance.now()
        await win.webContents.executeJavaScript("window.location.hash = '#/'; true", true)
        const after = await until(async () => {
          const stats = await readJSON(base + '/__perf/state')
          return stats.completed === expected && stats.cancelled === expected && stats.sql_waiters === 0 ? stats : null
        }, 4500, 'browser abort propagated to Gin Request.Context and PG SQL waiter')
        const cancelMS = performance.now() - t0
        const afterUI = await dom(win, buttonsAndRows)
        assert.equal(afterUI.publicSlot, false, 'public share view survived route navigation')
        assert.ok(after.last_handler_ms >= 0 && after.last_handler_ms <= result.cancel_budget_ms,
          'Go Context.Handler stayed active after browser navigation: ' + JSON.stringify(after))
        assert.ok(cancelMS <= result.cancel_budget_ms,
          'actual browser->Gin->PG waiter release exceeded frozen budget: ' + cancelMS)
        result.cancel_samples.push({ width, sample, real_sql_waiter: true, browser_nav_to_pg_release_ms: cancelMS,
          handler_since_pre_nav_mark_ms: after.last_handler_ms,
          sql_waiters_after: after.sql_waiters, canceled_requests: after.cancelled })
        console.log('SH_P003_BROWSER_CANCEL ' + JSON.stringify(result.cancel_samples.at(-1)))
        await closeWindow(win)
        win = null
      }
    }
    assert.equal(result.cancel_samples.length, 6)
    await post(base + '/__perf/release-lock')
    // Separately verify the genuine public UI remains bounded to 100 children
    // and next-page navigation works for the same 100k PG Node population.
    for (const width of [1440, 390]) {
      for (let sample = 1; sample <= 3; sample++) {
        console.log('SH_P003_BROWSER_PHASE ' + JSON.stringify({ phase: 'page-start', width, sample }))
        win = await createWindow(width, sample + 10)
        await win.loadURL(shareURL)
        await until(async () => {
          const view = await dom(win, buttonsAndRows)
          return view.labels.includes('浏览文件夹') ? view : null
        }, 12000, 'production public directory title')
        const before = performance.now()
        await click(win, '浏览文件夹')
        const first = await until(async () => {
          const v = await dom(win, buttonsAndRows)
          return v.rows.length === 100 && v.rows.some(x => x.includes('entry-000000')) ? v : null
        }, 12000, 'real 100k share bounded first page of 100')
        const firstMS = performance.now() - before
        assert.equal(first.rows.length, 100)
        assert.equal(first.horizontalOverflow, false)
        await click(win, '下一页')
        const second = await until(async () => {
          const v = await dom(win, buttonsAndRows)
          return v.rows.length === 100 && v.rows.some(x => x.includes('entry-000100')) ? v : null
        }, 12000, 'real public share next keyset page')
        assert.equal(second.rows.length, 100)
        assert.ok(!second.rows.some(x => x.includes('entry-000000')))
        assert.ok(firstMS <= result.page_budget_ms,
          'first 100-item production share page exceeded frozen 2s budget: ' + firstMS)
        result.page_samples.push({ width, sample, first_page_ms: firstMS,
          first_dom_rows: first.rows.length, second_dom_rows: second.rows.length,
          new_page_has_entry_100: true, horizontal_overflow: false })
        console.log('SH_P003_BROWSER_PAGE ' + JSON.stringify(result.page_samples.at(-1)))
        await closeWindow(win)
        win = null
      }
    }
    const resource = process.resourceUsage()
    result.all_passed = true
    result.electron_main_maxrss_kib = resource.maxRSS
    result.electron_main_user_cpu_us = resource.userCPUTime - metricsStart.userCPUTime
    result.electron_main_system_cpu_us = resource.systemCPUTime - metricsStart.systemCPUTime
    result.max_browser_pg_cancel_ms = Math.max(...result.cancel_samples.map(x => x.browser_nav_to_pg_release_ms))
    result.max_first_page_ms = Math.max(...result.page_samples.map(x => x.first_page_ms))
    assert.equal(result.page_samples.length, 6)
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n')
    console.log('SH_P003_REAL_BROWSER_100K ' + JSON.stringify(result))
  } catch (err) {
    result.all_passed = false
    result.failure = err instanceof Error ? err.stack || err.message : String(err)
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n')
    throw err
  } finally {
    if (win && !win.isDestroyed()) await closeWindow(win)
    if (base) {
      try { await post(base + '/__perf/stop') } catch (_error) {}
    }
    const exit = await Promise.race([
      fixture.exited,
      pause(30000).then(() => ({ code: 'timeout', signal: null })),
    ])
    fixture.log.end()
    if (exit.code !== 0) {
      fixture.proc.kill('SIGKILL')
      console.error('SH_P003_REAL_GIN_EXIT ' + JSON.stringify(exit))
    }
    if (fs.existsSync(readyPath)) fs.unlinkSync(readyPath)
  }
}

app.whenReady().then(main).then(() => app.quit()).catch(error => {
  console.error('SH_P003_REAL_BROWSER_FAILED ' + (error.stack || error.message || String(error)))
  process.exitCode = 1
  app.quit()
})
