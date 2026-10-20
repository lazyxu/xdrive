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
  const rows = [...document.querySelectorAll('[role="listitem"]')].map(x => x.textContent.trim())
  const explorer = document.querySelector('[data-xdrive-public-share-explorer-workspace]')
  return { labels, rows, body: document.body.innerText.slice(0, 500),
    publicSlot: !!document.querySelector('[data-xdrive-public-share-read-slot]'),
    publicTitlebar: !!document.querySelector('[data-xdrive-public-share-titlebar]'),
    publicWorkspace: !!document.querySelector('[data-xdrive-public-share-workspace]'),
    publicExplorer: !!explorer,
    explorerWidth: explorer?.getBoundingClientRect().width || 0,
    detailsHeader: !!document.querySelector('[data-xdrive-public-share-details-header]'),
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
  const targeted = await win.webContents.executeJavaScript(
    '(() => {' +
    'const row=document.querySelectorAll("[role=listitem]")[0];' +
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
  const response = await received
  assert(response.ms <= 5000, 'actual native original download exceeded 5s budget')
  return response
}
async function main() {
  assert.equal(process.env.XD_SH_P005_BROWSER_PHYSICAL_PERF, '1', 'explicit opt-in required')
  fs.mkdirSync(out, {recursive: true})
  if (fs.existsSync(readyPath)) fs.unlinkSync(readyPath)
  const fixture = startFixture()
  const firstResource = process.resourceUsage()
  let base = '', win = null
  const result = {
    workload:'SH-P005-real-physical-JPEG-100k-public-share-Web-and-MobileWeb',
    exact_source_head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    original_jpeg_cas:100000, browser_sessions:6,
    page_budget_ms:2000, original_download_budget_ms:5000,
    scope:'Production public share React / Chromium 1440px Web and 390px CDP Mobile Web on one 100k SHA-distinct physical JPEG CAS/PG17 corpus; real native downloads, not OS-installed PWA or Gallery thumbnails',
    excluded:'Native Desktop Agent IPC, installed PWA, real handset, WAN, H264/Live Motion, 100k thumbnail decode and user-owned transfer cancellation',
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
        assert(meta.explorerWidth >= (width === 1440 ? 1000 : 300),
          'public share is still a narrow login card')
        assert.equal(meta.labels.includes('浏览文件夹'),false,
          'unrestricted link must not require an extra Browse click')
        const first=await until(async()=>{
          const v=await dom(win,buttonsAndRows)
          return v.rows.length===100&&v.rows.some(x=>x.includes('photo-000000.jpg'))?v:null
        },12000,'actual first 100 physical file list rows')
        const firstMs=performance.now()-firstStart
        assert(firstMs<=2000)
        assert.equal(first.detailsHeader,true,'shared Details columns not mounted')
        assert.equal(first.pageFilter,true,'local page filter not available')
        assert.equal(first.publicExplorer,true,'shared Explorer remounted away during initial page')
        assert(first.explorerWidth >= (width === 1440 ? 1000 : 300))
        const downloadA=await clickFirstDownload(win,cfg.downloads[0],width,sample,'first')
        const nextStart=performance.now()
        await click(win,'下一页')
        const next=await until(async()=>{
          const v=await dom(win,buttonsAndRows)
          return v.rows.length===100&&v.rows.some(x=>x.includes('photo-000100.jpg'))?v:null
        },12000,'actual next 100 physical file list rows')
        const nextMs=performance.now()-nextStart
        assert(nextMs<=2000)
        assert.equal(next.rows.length,100)
        assert.equal(next.horizontalOverflow,false)
        assert(!next.rows.some(x=>x.includes('photo-000000.jpg')))
        const downloadB=await clickFirstDownload(win,cfg.downloads[1],width,sample,'next')
        result.sessions.push({
          width,sample,first_page_ms:firstMs,next_page_ms:nextMs,
          first_rows:first.rows.length,next_rows:next.rows.length,
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
