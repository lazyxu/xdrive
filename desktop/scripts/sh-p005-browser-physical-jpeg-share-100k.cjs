'use strict'

// SH-P005: real production Web app in Chromium -> live Gin -> PostgreSQL17.
// Wide (1440px) and Mobile Web CSS (390px), each three browser sessions.
// No mocked fetch/route and no production instrumentation.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const { app, BrowserWindow } = require('electron')

const root = path.resolve(__dirname, '../..')
const out = path.resolve(process.env.XD_SH_P005_RESULTS || path.join(root, 'desktop/sh-p005-results'))
const dist = path.join(root, 'web/dist')
const readyPath = path.join(out, 'private-ready.json')
const bin = process.env.XD_SH_P005_GO_TEST_BIN
const shP018 = process.env.XD_SH_P018_REAL_CACHED_THUMBNAIL === '1'
const pairedNextPage = process.env.XD_SH_P018_PAIRED_NEXT_PAGE === '1'
const allowSlowOriginal = process.env.XD_SH_P018_ALLOW_SLOW_ORIGINAL === '1'
if (allowSlowOriginal && (!pairedNextPage || process.env.XD_SH_P018_VARIANT !== 'original'))
  throw Error('over-budget original only permitted within genuine physical A/B test')
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
  const proc = spawn(bin, ['-test.run=^TestSHP005RealBrowserPhysicalJPEG100KFixture$', '-test.timeout=18m', '-test.v'], {
    cwd: root,
    env: { ...process.env, XD_SH_P005_BROWSER_PHYSICAL_PERF: '1',
      XD_SH_P005_WEB_DIST: dist, XD_SH_P005_READY_FILE: readyPath },
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
      partition: 'shp005-' + width + '-' + sample,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  win.webContents.on('render-process-gone', (_event, details) =>
    console.error('SH_P005_RENDERER_GONE ' + JSON.stringify({ width, sample, details })))
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
  const rows = [...document.querySelectorAll('[data-xdrive-file-explorer-item]')].map(x => x.textContent.trim())
  const explorer = document.querySelector('[data-xdrive-public-share-explorer-workspace]')
  const acceptedRows = Number(/当前页\s*(\d+)\s*项/.exec(document.body.innerText)?.[1] ?? rows.length)
  return { labels, rows, acceptedRows, body: document.body.innerText.slice(0, 500),
    publicSlot: !!document.querySelector('[data-xdrive-public-share-read-slot]'),
    publicTitlebar: !!document.querySelector('[data-xdrive-public-share-titlebar]'),
    publicWorkspace: !!document.querySelector('[data-xdrive-public-share-workspace]'),
    publicExplorer: !!explorer,
    unifiedCore: !!document.querySelector('[data-xdrive-public-share-unified-core="true"]') &&
      !!document.querySelector('[data-xdrive-file-explorer-scroll-host]'),
    explorerWidth: explorer?.getBoundingClientRect().width || 0,
    detailsHeader: !!document.querySelector('[data-xdrive-public-share-details-header], [role="table"] > [role="row"][aria-rowindex="1"]'),
    pageFilter: !!document.querySelector('input[placeholder="筛选当前页"]'),
    width: innerWidth, touch: matchMedia('(pointer: coarse)').matches,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 }
}
async function click(win, label) {
  const result = await win.webContents.executeJavaScript(
    '(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === ' +
    JSON.stringify(label) + '); if (!b || b.disabled) return false; b.click(); return true })()', true)
  assert.equal(result, true, 'missing/disabled real public share button: ' + label)
}


async function clickFirstDownload(win, expected, width, n, page) {
  const save = path.join(out, 'download-' + width + '-' + n + '-' + page + '.jpg')
  if (fs.existsSync(save)) fs.unlinkSync(save)
  const begin = performance.now()
  const received = new Promise((resolve, reject) => {
    const session = win.webContents.session
    const abort = setTimeout(() => {
      session.removeListener('will-download', onDownload)
      reject(Error('genuine Chromium download event was not received'))
    }, 10000)
    function onDownload(_event, item) {
      session.removeListener('will-download', onDownload)
      item.setSavePath(save)
      item.once('done', (_doneEvent, state) => {
        clearTimeout(abort)
        try {
          assert.equal(state, 'completed', 'real browser download did not complete')
          assert.equal(item.getFilename(), expected.name)
          const bytes = fs.readFileSync(save)
          assert.equal(bytes.length, expected.bytes)
          assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256)
          resolve({ms: performance.now() - begin, bytes: bytes.length, sha_ok: true})
        } catch (e) { reject(e) }
        finally { if (fs.existsSync(save)) fs.unlinkSync(save) }
      })
    }
    session.on('will-download', onDownload)
  })
  // Exercise the real read-only FileExplorer context menu instead of a
  // legacy per-row fifth "操作" column. Context menu works in both desktop
  // pointer and 390px emulated touch viewports; no Owner API is used.
  if (width === 390 && process.env.XD_SH_P021_UNIFIED_CORE === '1') {
    // Mobile Files uses an explicit touch selection mode. A synthetic mouse
    // contextmenu is not a valid substitute for its touch/selection action.
    // Exercise a REAL CDP touch on a visible Share row, then use the real
    // selection command with its actual browser-native download ticket.
    assert(win.webContents.debugger.isAttached(), 'real CDP touch target missing')
    const hasSelectionEntry = await dom(win, () => [...document.querySelectorAll('button')]
      .some(button => button.textContent.trim() === '选择' && !button.disabled))
    if (hasSelectionEntry) await click(win, '选择')
    const point = await dom(win, () => {
      const row = document.querySelector('[data-xdrive-file-explorer-item]')
      if (!row) return null
      const bounds = row.getBoundingClientRect()
      return {
        x: Math.round(bounds.left + Math.min(bounds.width / 2, 72)),
        y: Math.round(bounds.top + Math.min(bounds.height / 2, 18)),
        name: row.textContent,
      }
    })
    assert(point && point.name.includes(expected.name), 'first visible mobile Share row wrong')
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }],
    })
    await pause(65) // Genuine short tap, not a synthetic contextmenu/long-press.
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchEnd', touchPoints: [],
    })
    const enabled = await until(async () => dom(win, () => {
      const row = document.querySelector('[data-xdrive-file-explorer-item]')
      const button = document.querySelector('button[aria-label="下载所选项目"]')
      return row?.getAttribute('aria-selected') === 'true' &&
        button && !button.disabled
    }), 3000, 'real CDP390 Share row selection and authorized download action')
    assert(enabled, 'mobile Share selection action unavailable')
    const started = await dom(win, () => {
      const button = document.querySelector('button[aria-label="下载所选项目"]')
      if (!button || button.disabled) return false
      button.click()
      return true
    })
    assert(started, 'mobile selection did not hand off signed original to Chromium')
  } else {
    const targeted = await win.webContents.executeJavaScript(
      '(() => {' +
      'const row=document.querySelectorAll("[data-xdrive-file-explorer-item]")[0];' +
      'if(!row || !row.textContent.includes(' + JSON.stringify(expected.name) + ')) return false;' +
      'row.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:80,clientY:80}));' +
      'return true;' +
      '})()', true)
    assert.equal(targeted, true, 'native public row context action missing')
    const clicked = await until(async () => win.webContents.executeJavaScript(
      '(() => {' +
      'const item=[...document.querySelectorAll("[role=menuitem]")].find(el=>' +
      'el.textContent.trim()==="下载文件" && el.getAttribute("aria-disabled")!=="true");' +
      'if(!item) return false;' +
      'item.click();return true;' +
      '})()', true),
      3000, 'real public Share read-only context Download item')
    assert.equal(clicked, true, 'real Share-only context download unavailable')
  }
  const response = await received
  assert(response.ms <= 5000, 'actual native original download exceeded 5s budget')
  return response
}
// Original signed thumbnail ticket POST and JPEG GET execute in Chromium.
 // SH-P018 waits for the genuine in-flight Gin handler's bounded test-only
 // slow transport gate; then an actual scroll, page change or unload aborts
 // the SAME browser request all the way to Go Request.Context().Done.
async function probePublicCachedThumbnailCancellation(win, base, width, sample) {
  const number = (width === 1440 ? 0 : 3) + sample
  const loaded = await until(async () => {
    const remote = await readJSON(base + '/__perf/state')
    const view = await dom(win, () => {
      const images = [...document.querySelectorAll('[data-xdrive-public-share-thumbnail-viewport] img[src^="blob:"], [data-xdrive-file-explorer-item-visual] img[src^="blob:"]')]
      return { decoded: images.filter(x => x.complete && x.naturalWidth > 0).length,
        visibleSlots: document.querySelectorAll('[data-xdrive-public-share-thumbnail-viewport], [data-xdrive-file-explorer-item-visual]').length,
        rows: document.querySelectorAll('[data-xdrive-file-explorer-item]').length }
    })
    return remote.thumbnail_held_starts >= number && view.decoded >= 2 &&
      view.visibleSlots > 0 ? {remote, view} : null
  }, 12000, 'actual Share cached JPEG decoded and signed GET held in Gin')
  assert(loaded.view.decoded >= 2, 'public Share thumbnail list never decoded source pixels')
  assert(loaded.remote.thumbnail_stream_calls >= number, 'no real signed thumbnail GET')
  await post(base + '/__perf/mark-thumbnail-eviction')
  let cause
  if (!pairedNextPage && sample === 1) {
    cause = 'scroll-out-of-viewport'
    const scrolled = await dom(win, () => {
      const root = document.querySelector('[data-xdrive-file-explorer-scroll-host], [data-xdrive-public-share-scroll-host]')
      if (!root) return false
      root.scrollTop = root.scrollHeight
      root.dispatchEvent(new Event('scroll', { bubbles: true }))
      return root.scrollTop > 0
    })
    assert(scrolled, '100-row Share scroll host did not scroll')
  } else if (!pairedNextPage && sample === 2) {
    cause = 'real-window-pagehide'
    await win.loadURL('about:blank')
  } else {
    cause = 'bounded-next-page'
    await click(win, '下一页')
    const next = await until(async () => {
      const view = await dom(win,buttonsAndRows)
      return view.acceptedRows === 100 && view.rows.some(x => x.includes('photo-000100.jpg')) ? view : null
    }, 12000, 'Share next page after thumbnail request cancel')
    assert(!next.rows.some(x => x.includes('photo-000000.jpg')))
  }
  const stopped = await until(async () => {
    const remote = await readJSON(base + '/__perf/state')
    return remote.thumbnail_cancelled_go >= number && remote.thumbnail_active_held === 0 ? remote : null
  }, 2000, 'real canceled signed Share GET Go handler exit')
  const latencyMs = stopped.thumbnail_cancel_max_us / 1000
  const eventLatencyMs = stopped.thumbnail_cancel_last_us / 1000
  assert(eventLatencyMs > 0, 'Go Context.Done event latency missing')
  if (!allowSlowOriginal) assert(latencyMs > 0 && latencyMs <= 160,
    'real Share thumbnail request did not cancel to Go within 160ms: ' + latencyMs)
  assert.equal(stopped.thumbnail_stale_body_bytes,0,
    'no abandoned cached JPEG body may continue writing to inactive viewport')
  return { width, sample, cause, decoded_cached_jpegs:loaded.view.decoded,
    actual_signed_thumbnail_GETs:stopped.thumbnail_stream_calls,
    observed_go_cancelled_requests:stopped.thumbnail_cancelled_go,
    go_cancel_max_ms:latencyMs, go_cancel_event_ms:eventLatencyMs,
    abandoned_body_bytes:stopped.thumbnail_stale_body_bytes,
    cancelled_active_handlers_at_observation:stopped.thumbnail_active_held }
}
async function main() {
  assert.equal(process.env.XD_SH_P005_BROWSER_PHYSICAL_PERF, '1', 'explicit opt-in required')
  fs.mkdirSync(out, {recursive: true})
  if (fs.existsSync(readyPath)) fs.unlinkSync(readyPath)
  const fixture = startFixture()
  const firstResource = process.resourceUsage()
  let base = '', win = null
  const result = {
    workload: shP018
      ? 'SH-P018-100k-real-CAS-public-cached-JPEG-viewport-to-Go-cancel'
      : 'SH-P005-real-physical-JPEG-100k-public-share-Web-and-MobileWeb',
    exact_source_head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    paired_next_page:pairedNextPage,
    variant:process.env.XD_SH_P018_VARIANT || 'current',
    variant_web_sha256:process.env.XD_SH_P018_WEB_SHA256 || null,
    original_jpeg_cas:100000, browser_sessions:6,
    page_budget_ms:2000, original_download_budget_ms:5000,
    cached_thumbnail_go_cancel_budget_ms:shP018?160:undefined,
    scope:shP018
      ? 'Production public Share 1440px/390px Chromium, real Gin/PG17 100k SHA-distinct physical JPEG originals; 16 real cached derivatives, first-page decoded previews and signed GET held by bounded TEST-ONLY response writer, actual scroll/next-page/pagehide -> Go Request.Context().Done; no fake fetch'
      : 'Production public share React / Chromium 1440px Web and 390px CDP Mobile Web on one 100k SHA-distinct physical JPEG CAS/PG17 corpus; real native downloads, not OS-installed PWA or Gallery thumbnails',
    excluded:'Native Desktop Agent IPC, installed PWA, real handset, WAN, H264/Live Motion; SH-P018 does not decode 100k thumbnails simultaneously and does not cancel durable ZIP/user tasks',
    sessions:[],
  }
  try {
    const ready = await until(() => {
      if (fixture.proc.exitCode !== null) throw Error('real Go 100k source fixture exited early')
      return fs.existsSync(readyPath) ? JSON.parse(fs.readFileSync(readyPath,'utf8')) : null
    }, 10*60*1000, '100k distinct real JPEG physical CAS seed')
    base = ready.url
    assert.equal(ready.physical_jpeg_originals,100000)
    assert.equal(ready.physical_cas_inodes,100001)
    assert(ready.allocated_bytes>=100001*4096)
    assert(ready.original_bytes>50000000)
    const cfg = await readJSON(base + '/__perf/config')
    assert.equal(cfg.physical_jpeg_originals,100000)
    assert.equal(cfg.physical_cas_inodes,100001)
    assert(cfg.share_token && cfg.share_token.length >= 40)
    assert.deepEqual(cfg.downloads.map(x=>x.name),['photo-000000.jpg','photo-000100.jpg'])
    if (shP018) assert.equal(cfg.cached_thumbnail_candidates,16,'real cached derivative corpus missing')
    result.original_bytes=ready.original_bytes
    result.allocated_cas_bytes=ready.allocated_bytes
    result.seed_excluded_ms=ready.seed_ms_excluded
    result.source_aggregate_sha256=cfg.source_aggregate_sha256
    const shareURL=base+'/#/s/'+encodeURIComponent(cfg.share_token)
    for(const width of [1440,390]){
      for(let sample=1;sample<=3;sample++){
        win=await createWindow(width,sample)
        // SH-P011: link navigation -> first bounded 100 rows is a NEW
        // workload, not comparable to prior browse-button -> 100 timings.
        const firstStart=performance.now()
        await win.loadURL(shareURL)
        const meta=await until(async()=>{
          const v=await dom(win,buttonsAndRows)
          return v.publicSlot&&v.publicExplorer?v:null
        },12000,'production public share folder metadata')
        assert.equal(meta.touch,width===390)
        assert.equal(meta.horizontalOverflow,false)
        assert.equal(meta.publicSlot,true)
        assert.equal(meta.publicTitlebar,true,'real full-width share titlebar missing')
        assert.equal(meta.publicWorkspace,true,'real public share workspace missing')
        assert.equal(meta.publicExplorer,true,'bounded shared Explorer missing')
        if (process.env.XD_SH_P021_UNIFIED_CORE === '1') {
          assert.equal(meta.unifiedCore, true, 'Share must mount actual Owner FileExplorer, not a duplicate renderer')
        }
        assert(meta.explorerWidth >= (width === 1440 ? 1000 : 300),
          'public share is still a narrow login card')
        assert.equal(meta.labels.includes('浏览文件夹'),false,
          'unrestricted link must not require an extra Browse click')
        const first=await until(async()=>{
          const v=await dom(win,buttonsAndRows)
          return v.acceptedRows===100&&v.rows.some(x=>x.includes('photo-000000.jpg'))?v:null
        },12000,'actual first 100 physical file list rows')
        const firstMs=performance.now()-firstStart
        assert(firstMs<=2000)
        if (process.env.XD_SH_P021_UNIFIED_CORE === '1') {
          assert(first.rows.length < first.acceptedRows && first.rows.length > 0,
            'Share must virtualize and evict offscreen media, not mount all 100 rows')
        }
        assert.equal(first.detailsHeader,true,'shared Details columns not mounted')
        assert.equal(first.pageFilter,true,'local page filter not available')
        assert.equal(first.publicExplorer,true,'shared Explorer remounted away during initial page')
        if (process.env.XD_SH_P021_UNIFIED_CORE === '1') assert.equal(first.unifiedCore, true)
        assert(first.explorerWidth >= (width === 1440 ? 1000 : 300))
        if (shP018) {
          const observed = await probePublicCachedThumbnailCancellation(win,base,width,sample)
          result.sessions.push({ ...observed, first_page_ms:firstMs, first_rows:first.acceptedRows,
            horizontal_overflow:first.horizontalOverflow })
          console.log('SH_P018_BROWSER_GO_CANCEL_RESULT '+JSON.stringify(result.sessions.at(-1)))
          await closeWindow(win)
          win=null
          continue
        }
        const downloadA=await clickFirstDownload(win,cfg.downloads[0],width,sample,'first')
        const nextStart=performance.now()
        await click(win,'下一页')
        const next=await until(async()=>{
          const v=await dom(win,buttonsAndRows)
          return v.acceptedRows===100&&v.rows.some(x=>x.includes('photo-000100.jpg'))?v:null
        },12000,'actual next 100 physical file list rows')
        const nextMs=performance.now()-nextStart
        assert(nextMs<=2000)
        assert.equal(next.acceptedRows,100)
        assert.equal(next.horizontalOverflow,false)
        assert(!next.rows.some(x=>x.includes('photo-000000.jpg')))
        const downloadB=await clickFirstDownload(win,cfg.downloads[1],width,sample,'next')
        result.sessions.push({
          width,sample,first_page_ms:firstMs,next_page_ms:nextMs,
          first_rows:first.acceptedRows,next_rows:next.acceptedRows,
          first_download_ms:downloadA.ms,next_download_ms:downloadB.ms,
          actual_original_bytes:downloadA.bytes+downloadB.bytes,
          original_sha_verified:downloadA.sha_ok&&downloadB.sha_ok,
          no_stale_rows:true,horizontal_overflow:false,
        })
        console.log('SH_P005_BROWSER_RESULT '+JSON.stringify(result.sessions.at(-1)))
        await closeWindow(win)
        win=null
      }
    }
    const server=await readJSON(base+'/__perf/state')
    if (shP018) {
      assert(server.public_page_calls>=6,'no actual bounded Share page POST')
      assert(server.thumbnail_ticket_calls>=6,'no actual Share-only signed thumbnail POST')
      assert(server.thumbnail_stream_calls>=6,'no real cached JPEG GET')
      assert.equal(server.thumbnail_held_starts,6,'no genuine held Go signed GET for every browser')
      assert.equal(server.thumbnail_cancelled_go,6,'not all browser evictions reached actual Go ctx.Done')
      assert.equal(server.thumbnail_active_held,0,'old Go handler leaked')
      assert.equal(server.thumbnail_stale_body_bytes,0,'stale cached JPEG bytes leaked')
      assert(server.thumbnail_cancel_max_us>0 &&
        (allowSlowOriginal || server.thumbnail_cancel_max_us<=160000),
        'Go viewport cancellation exceeds frozen 160ms')
      assert.equal(server.original_download_calls,0,'Share thumbnail tests must not start original downloads')
      result.http_counts=server
      result.cancel_max_ms=server.thumbnail_cancel_max_us/1000
      result.all_passed=result.sessions.length===6&&result.sessions.every(x=>
        x.first_rows===100&&x.decoded_cached_jpegs>=2&&
        (allowSlowOriginal || x.go_cancel_max_ms<=160)&&x.go_cancel_event_ms>0&&
        x.abandoned_body_bytes===0&&!x.horizontal_overflow)
      assert(result.all_passed,'SH-P018 original production Share request cancellation failed')
      fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n')
      console.log('SH_P018_SOURCE_EXACT_BASELINE '+JSON.stringify(result))
      return
    }
    assert(server.public_page_calls>=12,'no actual PG page POST')
    assert(server.signed_ticket_calls>=12,'no real ticket POST')
    assert(server.original_download_calls>=12,'no actual original GET')
    result.http_counts=server
    result.first_page_max_ms=Math.max(...result.sessions.map(r=>r.first_page_ms))
    result.next_page_max_ms=Math.max(...result.sessions.map(r=>r.next_page_ms))
    result.native_download_max_ms=Math.max(...result.sessions.flatMap(r=>[r.first_download_ms,r.next_download_ms]))
    const ending=process.resourceUsage()
    result.electron_main_maxrss_kib=ending.maxRSS
    result.electron_main_cpu_user_us=ending.userCPUTime-firstResource.userCPUTime
    result.electron_main_cpu_system_us=ending.systemCPUTime-firstResource.systemCPUTime
    result.all_passed=result.sessions.length===6&&result.sessions.every(r=>
      r.first_rows===100&&r.next_rows===100&&r.original_sha_verified&&
      r.no_stale_rows&&!r.horizontal_overflow&&
      r.first_page_ms<=2000&&r.next_page_ms<=2000&&
      r.first_download_ms<=5000&&r.next_download_ms<=5000)
    assert(result.all_passed)
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n')
    console.log('SH_P005_REAL_BROWSER_PHYSICAL_100K '+JSON.stringify(result))
  }catch(error){
    result.all_passed=false
    result.failure=error?.stack||String(error)
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2)+'\n')
    throw error
  }finally{
    if(win&&!win.isDestroyed())await closeWindow(win)
    if(base)await post(base+'/__perf/stop').catch(()=>{})
    const closed=await Promise.race([fixture.exited,pause(40000).then(()=>({code:'timeout'}))])
    fixture.log.end()
    if(closed.code!==0){fixture.proc.kill('SIGKILL');console.error('SH_P005_GO_EXIT '+JSON.stringify(closed))}
    if(fs.existsSync(readyPath))fs.unlinkSync(readyPath)
  }
}
app.whenReady().then(main).then(()=>app.quit()).catch(error=>{
  console.error('SH_P005_BROWSER_ERROR '+(error?.stack||String(error)))
  process.exitCode=1;app.quit()
})
