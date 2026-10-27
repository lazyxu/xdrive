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
const p0c2SPAMode = process.env.XD_PWA_P0C2_SPA_BEFORE === '1'
const p1Mode = process.env.XD_PWA_P1_100K_VIEWER_BACK === '1'
const p1H264Mode = process.env.XD_PWA_P1_H264_VIEWER_FRAME === '1'
const p1LiveMode = process.env.XD_PWA_P1_LIVE_MOTION_HOLD === '1'
const p1ViewerVideoAbortMode = process.env.XD_PWA_P1_VIEWER_VIDEO_RANGE_CANCEL === '1'
// P1P is opt-in only: 100k Owner PhotoAssets backed by 115k SHA-distinct
// genuine LocalCAS originals, not the older bounded physical Viewer fixture.
const physicalP1Mode = process.env.XD_PWA_P1_PHYSICAL_115K_VIEWER === '1'
const p1CrossTabLogoutMode = process.env.XD_PWA_P1Q_CROSS_TAB_LOGOUT_VIDEO_RANGE === '1'
assert(!p1CrossTabLogoutMode || (p1ViewerVideoAbortMode && p0c2SPAMode &&
  !physicalP1Mode && !p0c2PageLeaveMode),
  'P1Q requires authenticated bounded Owner signed H264 Range, not physical mode')
assert(!physicalP1Mode || (p0c2SPAMode && p1Mode && p1H264Mode && p1LiveMode &&
  !p1ViewerVideoAbortMode && !p0c2PageLeaveMode),
  '115k physical P1P requires real routed JPEG/H264/Live SPA without padded Range probe')
assert(!p1ViewerVideoAbortMode || p1LiveMode, 'real Viewer video Range Abort requires original P1-C Live stage')
assert(!p1LiveMode || p1H264Mode, 'Live native hold requires genuine P1 H264 video stage')
assert(!p1H264Mode || p1Mode,
  'H264 presented-frame mode requires real Owner P1 Gallery Viewer')
assert(!p1Mode || p0c2SPAMode, 'P1 authentic Owner Viewer requires SPA mode')
assert(!(p0c2PageLeaveMode && p0c2SPAMode), 'P0-C2 document-leave and SPA workloads must be independent')
const out = path.join(__dirname, '..', physicalP1Mode ? 'pwa-p1p-physical-115k-viewer-results' : p1CrossTabLogoutMode ? 'pwa-p1q-cross-tab-owner-logout-range-results' : p1ViewerVideoAbortMode ? 'pwa-p1-owner-100k-viewer-range-abort-results' : p1LiveMode ? 'pwa-p1-owner-100k-live-hold-results' : p1H264Mode ? 'pwa-p1-owner-100k-h264-viewer-results' : p1Mode ? 'pwa-p1-owner-100k-viewer-back-results' : p0c2SPAMode ?
  'pwa-p0c2-spa-go-results' : p0c2PageLeaveMode ?
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
    '-test.count=1', physicalP1Mode ? '-test.timeout=20m' : '-test.timeout=12m', '-test.v',
  ], {
    cwd: root,
    env: {
      ...process.env,
      XD_GALLERY_REAL_WEB_COLD_PERF: '1',
      XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF: physicalP1Mode ? '0' : '1',
      XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF: physicalP1Mode ? '1' : '0',
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
  }, physicalP1Mode ? 12*60*1000 : 180000, 'real 100k Gallery PostgreSQL+Gin fixture')
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


/** Native Chromium inputs invoke the existing production Mobile App Header and
 * Sidebar buttons. No window.location.hash assignment or synthetic router. */
async function visibleButtonCenter(win, label) {
  return win.webContents.executeJavaScript(`(() => {
    const label = ${JSON.stringify(label)}
    const isOpener = label === '打开应用导航'
    const selector = isOpener
      ? 'button[data-xdrive-mobile-app-navigation-trigger]'
      : '[role="dialog"] button,[role="dialog"] [role="button"]'
    const candidates = [...document.querySelectorAll(selector)].filter(button => {
      const bounds = button.getBoundingClientRect()
      const style = getComputedStyle(button)
      if (bounds.width < 2 || bounds.height < 2 || bounds.left < 0 ||
          bounds.top < 0 || bounds.right > innerWidth || bounds.bottom > innerHeight ||
          style.visibility === 'hidden' || style.pointerEvents === 'none') return false
      const accessible = button.getAttribute('aria-label') || ''
      const text = (button.textContent || '').trim()
      if (accessible !== label && text !== label) return false
      const x = bounds.left + bounds.width/2, y = bounds.top + bounds.height/2
      const hit = document.elementFromPoint(x, y)
      return hit === button || button.contains(hit)
    })
    if (candidates.length !== 1) return {error:'expected exactly one interactable '+label+' button; got '+candidates.length}
    const rect = candidates[0].getBoundingClientRect()
    return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}
  })()`, true)
}
function sendActualPointer(win, where) {
  assert(!where.error && Number.isSafeInteger(where.x) && Number.isSafeInteger(where.y),
    'cannot click genuine Mobile App button: ' + JSON.stringify(where))
  win.focus()
  win.webContents.focus()
  win.webContents.sendInputEvent({type:'mouseMove',x:where.x,y:where.y})
  win.webContents.sendInputEvent({type:'mouseDown',x:where.x,y:where.y,button:'left',clickCount:1})
  win.webContents.sendInputEvent({type:'mouseUp',x:where.x,y:where.y,button:'left',clickCount:1})
}
async function prepareAppDestination(win, name) {
  const opener = await until(async () => {
    const pos = await visibleButtonCenter(win, '打开应用导航')
    return pos.error ? null : pos
  }, 25000, 'real 52px Mobile App Header navigation button')
  sendActualPointer(win, opener)
  await until(async () => win.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('[role="dialog"][aria-modal="true"]')
    return !!drawer && !drawer.hasAttribute('inert') &&
      drawer.getBoundingClientRect().height > 200
  })()`, true), 12000, 'real fully opened App drawer')
  // MUI sliding bottom Drawer is not clickable at its final coordinates until
  // its enter transition has completed; never tap a moving/or obscured target.
  await sleep(430)
  return until(async () => {
    const pos = await visibleButtonCenter(win, name)
    return pos.error ? null : pos
  }, 12000, 'real unobscured Sidebar destination '+name)
}
async function safeSPARouteState(win, target) {
  return win.webContents.executeJavaScript(`(() => ({
    target:${JSON.stringify(target)},
    matchingTarget:location.hash.startsWith('#/app/'+${JSON.stringify(target)}),
    stillInFiles:location.hash.startsWith('#/app/files'),
    stillInGallery:location.hash.startsWith('#/app/gallery'),
    drawerDialogPresent:!!document.querySelector('[role="dialog"][aria-modal="true"]'),
    mobileHeaderPresent:!!document.querySelector('[data-xdrive-mobile-app-header]'),
    galleryGridPresent:!!document.querySelector('[data-xdrive-media-gallery-virtual-grid]'),
    sameDocument:document.documentElement === window.__pwaC2SPADocument
  }))()`, true)
}
async function switchActualApp(win, name, target) {
  const pos = await prepareAppDestination(win, name)
  sendActualPointer(win, pos)
  try {
    await until(async () => win.webContents.executeJavaScript(
      `location.hash.startsWith('#/app/${target}')`, true), 30000,
    'actual in-document app route '+target)
  } catch (error) {
    // Never write location.hash, user paths, token or entire DOM to the CI log.
    const anonymous = await safeSPARouteState(win, target)
    throw Error('P0C2_REAL_UI_ROUTE_REJECTED '+JSON.stringify(anonymous)+
      ' | '+String(error))
  }
}
async function bootOriginalAuthenticatedApp(win, base) {
  // The token is created by the native Go fixture. It is used only in the
  // isolated Chromium session; do not log or write it to CI artifacts.
  const response = await fetch(base + '/__perf/config', {cache:'no-store'})
  assert.equal(response.status, 200)
  const config = await response.json()
  assert.equal(config.logical_assets, 100000)
  assert.equal(config.physical_nodes, 115000)
  assert(typeof config.token === 'string' && config.token.length > 20)
  const ownerResponse = await fetch(base + '/api/v1/me', {
    headers: {Authorization:'Bearer '+config.token}, cache:'no-store',
  })
  assert.equal(ownerResponse.status, 200,
    'actual Go Owner token must be authorized before Web App bootstrap')
  await win.loadURL(base + '/#/app/files')
  await win.webContents.executeJavaScript(`(() => {
    localStorage.setItem('xdrive.access_token', ${JSON.stringify(config.token)})
    localStorage.setItem('xdrive.username', 'gallery-web-cold-100k')
    localStorage.setItem('xdrive.access_expires_at', String(Date.now()+3600000))
  })()`, true)
  // Electron loadURL() to an identical URL may not reinitialize the React
  // document; use a distinct harmless test-only query for a FULL navigation.
  // The ordinary App root is still mounted, no performance harness selected.
  await win.loadURL(base + '/?xdriveP0C2OwnerBootstrap=1#/app/files')
  try {
    await until(async () => win.webContents.executeJavaScript(`(() => {
      return location.hash.startsWith('#/app/files') &&
        !!document.querySelector('[data-xdrive-mobile-app-frame]') &&
        !!document.querySelector('[data-xdrive-mobile-app-header]') &&
        !!document.querySelector('main')
    })()`, true), 30000, 'actual signed Owner Files App mount')
  } catch (error) {
    // Keep the original hard fail and frozen deadline. Only anonymous
    // booleans and a bounded count are emitted: no token, user name, URL,
    // API response, private file path or full browser text.
    const state = await win.webContents.executeJavaScript(`(() => ({
      locationIsFiles:location.hash.startsWith('#/app/files'),
      hasStoredSession:!!localStorage.getItem('xdrive.access_token'),
      hasAppFrame:!!document.querySelector('[data-xdrive-mobile-app-frame]'),
      hasMobileHeader:!!document.querySelector('[data-xdrive-mobile-app-header]'),
      hasMain:!!document.querySelector('main'),
      hasLoginPanel:!!document.querySelector('#web-login-username'),
      htmlRootPresent:!!document.querySelector('#root'),
      alertCount:document.querySelectorAll('[role="alert"]').length,
      width:document.documentElement.clientWidth,
      renderedRootChildCount:document.querySelector('#root')?.childElementCount || 0
    }))()`, true)
    throw new Error('REAL_P0C2_SPA_FILES_MOUNT_REJECTED ' + JSON.stringify(state) +
      ' | ' + String(error))
  }
  // The only stored DOM identity is private within this browser session.
  await win.webContents.executeJavaScript(`(() => {
    window.__pwaC2SPAMain = document.querySelector('main')
    window.__pwaC2SPADocument = document.documentElement
  })()`, true)
  await switchActualApp(win, '图库', 'gallery')
  await until(async () => win.webContents.executeJavaScript(`(() => {
    return !!document.querySelector('[data-xdrive-media-gallery-virtual-grid]') &&
      document.querySelector('main') === window.__pwaC2SPAMain &&
      document.documentElement === window.__pwaC2SPADocument &&
      !!document.querySelector('[data-xdrive-mobile-app-header]')
  })()`, true), 30000, 'real Files→Gallery mounted grid on SAME document and main')
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

// P1 stage A: one genuine decoded JPEG Viewer/Back per 100k logical Owner run.
// The P0C2 Gin/PG17/CAS cancellation scenario remains untouched without opt-in.
function p1VisiblePhotoTile() {
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  const host=document.querySelector('[data-xdrive-workspace-background] main')
  if(!(grid instanceof HTMLElement)||!(host instanceof HTMLElement))return null
  const extent=host.scrollHeight-host.clientHeight
  if(extent<10000)return null
  if(host.scrollTop<extent*0.7){
    host.scrollTop=extent
    host.dispatchEvent(new Event('scroll'))
    return null
  }
  const clip=host.getBoundingClientRect()
  const tiles=Array.from(grid.querySelectorAll('[data-xdrive-media-tile]'))
  for(const tile of tiles){
    const name=tile.querySelector('.media-name')?.textContent?.trim()||''
    if(!/^photo-\d+\.jpg$/.test(name))continue
    const rect=tile.getBoundingClientRect()
    if(rect.bottom<=clip.top+16||rect.top>=clip.bottom-16)continue
    const x=Math.round(rect.left+rect.width/2)
    const y=Math.round(Math.max(clip.top+16,Math.min(rect.top+rect.height/2,clip.bottom-16)))
    const hit=document.elementFromPoint(x,y)
    if(hit!==tile&&!tile.contains(hit))continue
    window.__xdriveP1Entry={document:document.documentElement,host,grid,
      scrollTop:host.scrollTop,route:location.hash}
    return {x,y,depth:host.scrollTop/extent,tiles:tiles.length}
  }
  return null
}
async function p1DecodedOriginal() {
  const img=Array.from(document.querySelectorAll(
    '[data-xdrive-web-viewer] [data-xdrive-image-phase="original"] img'
  )).find(x=>x.complete&&x.naturalWidth>0&&x.naturalHeight>0)
  if(!img)return false
  await img.decode()
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
  return img.isConnected&&img.complete&&img.naturalWidth>0
}
function p1BackPoint() {
  const button=document.querySelector('[data-xdrive-web-viewer] button[aria-label="返回"]')
  if(!(button instanceof HTMLButtonElement))return null
  const r=button.getBoundingClientRect()
  const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2)
  const hit=document.elementFromPoint(x,y)
  return hit===button||button.contains(hit)?{x,y}:null
}
function p1ReturnedToCaller() {
  const saved=window.__xdriveP1Entry
  if(!saved||document.querySelector('[data-xdrive-web-viewer]'))return null
  const host=document.querySelector('[data-xdrive-workspace-background] main')
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  if(location.hash!==saved.route||saved.document!==document.documentElement||
    host!==saved.host||grid!==saved.grid||!saved.host.isConnected||!saved.grid.isConnected||
    Math.abs((host?.scrollTop??-1)-saved.scrollTop)>2)return null
  const measuredScrollDelta=Math.abs(host.scrollTop-saved.scrollTop)
  const tiles=grid.querySelectorAll('[data-xdrive-media-tile]').length
  if(tiles<1||tiles>=1000)return null
  delete window.__xdriveP1Entry
  return {sameCaller:true,sameDocument:true,sameHost:true,sameGrid:true,scrollDelta:measuredScrollDelta,tiles}
}
async function p1MeasureRealViewerBack(win) {
  await switchActualApp(win,'图库','gallery')
  const entry=await until(async()=>win.webContents.executeJavaScript(
    '('+p1VisiblePhotoTile.toString()+')()',true),30000,
    'real Owner 100k deep Gallery photo tile')
  assert(entry.depth>=0.7&&entry.tiles<1000)
  const started=performance.now()
  sendActualPointer(win,entry)
  await until(async()=>win.webContents.executeJavaScript(
    "location.hash.startsWith('#/app/media-viewer?') && !!document.querySelector('[data-xdrive-web-viewer]')",true),
    30000,'real Owner 100k Gallery tile opens Viewer')
  await until(async()=>win.webContents.executeJavaScript(
    '('+p1DecodedOriginal.toString()+')()',true),30000,
    'real Owner JPEG original decode + two rAF')
  const originalDecodedMs=performance.now()-started
  win.webContents.sendInputEvent({type:'mouseMove',x:18,y:20})
  const back=await until(async()=>win.webContents.executeJavaScript(
    '('+p1BackPoint.toString()+')()',true),12000,'real visible Viewer Back button')
  const returnedAt=performance.now()
  sendActualPointer(win,back)
  const returned=await until(async()=>win.webContents.executeJavaScript(
    '('+p1ReturnedToCaller.toString()+')()',true),20000,
    'exact mounted Gallery caller route and deep scroll restoration')
  return {passed:true,depth:entry.depth,originalDecodedMs,
    returnMs:performance.now()-returnedAt,returned,
    scope:'100k logical PhotoAssets / 115k metadata nodes, only bounded actual JPEG original',
    notMeasured:'dynamic H264 or Live motion, full 115k physical CAS, installed iOS Safari'}
}


// P1 stage B uses the SAME already-mounted authenticated 100k Mobile Gallery
// that passed the original JPEG Viewer Back and Go Context.Done controls.
// A signed MP4 H264 CAS resource must present two genuinely advancing browser
// video frames; "canplay", poster decode, play() resolution or static rAF
// alone cannot establish motion.
function p1VisibleH264Tile() {
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  const host=document.querySelector('[data-xdrive-workspace-background] main')
  if(!(grid instanceof HTMLElement)||!(host instanceof HTMLElement))return null
  const extent=host.scrollHeight-host.clientHeight
  if(extent<10000)return null
  const clip=host.getBoundingClientRect()
  for(const tile of grid.querySelectorAll('[data-xdrive-media-tile]')){
    const name=tile.querySelector('.media-name')?.textContent?.trim()||''
    if(!/^video-\d+\.mp4$/.test(name))continue
    const rect=tile.getBoundingClientRect()
    if(rect.bottom<=clip.top+16||rect.top>=clip.bottom-16)continue
    const x=Math.round(rect.left+rect.width/2)
    const y=Math.round(Math.max(clip.top+16,Math.min(rect.top+rect.height/2,clip.bottom-16)))
    const hit=document.elementFromPoint(x,y)
    if(hit!==tile&&!tile.contains(hit))continue
    window.__xdriveP1Entry={
      document:document.documentElement,host,grid,
      scrollTop:host.scrollTop,route:location.hash,
    }
    return {x,y,depth:host.scrollTop/extent,tiles:grid.querySelectorAll('[data-xdrive-media-tile]').length}
  }
  const scan=window.__xdriveP1H264Scan||(window.__xdriveP1H264Scan={steps:0})
  if(scan.steps<7&&host.scrollTop>extent*0.997){
    scan.steps++
    host.scrollTop=Math.max(extent*0.997,host.scrollTop-Math.max(80,host.clientHeight*0.65))
    host.dispatchEvent(new Event('scroll'))
  }
  return null
}
function p1H264PlayerReady() {
  const video=document.querySelector(
    '[data-xdrive-web-viewer] [data-xdrive-preview-media-state="video"] video'
  )
  // The original must be the current Owner-scoped, same-origin signed CAS
  // preview stream. A thumbnail/poster, remote URL or Blob substitute cannot
  // count as native H264 Viewer motion; never print the private ticket.
  const signed=video instanceof HTMLVideoElement && video.currentSrc
    ? new URL(video.currentSrc, location.href) : null
  return video instanceof HTMLVideoElement &&
    video.isConnected && Boolean(signed) &&
    signed.origin===location.origin &&
    /^\/api\/v1\/file-preview\/\d+$/.test(signed.pathname) &&
    signed.searchParams.has('ticket') &&
    typeof video.requestVideoFrameCallback==='function' &&
    video.videoWidth>0 && video.videoHeight>0
}
async function p1ObserveAdvancingVideoFrames() {
  const video=document.querySelector(
    '[data-xdrive-web-viewer] [data-xdrive-preview-media-state="video"] video'
  )
  if(!(video instanceof HTMLVideoElement)||!video.currentSrc||
    typeof video.requestVideoFrameCallback!=='function'){
    throw Error('actual signed original HTMLVideoElement RVFC unavailable')
  }
  let callbackID=null,timeoutID=null
  const frames=[]
  let rejectFrame
  const presented=new Promise((resolve,reject)=>{
    rejectFrame=reject
    timeoutID=setTimeout(()=>reject(Error('two distinct presented H264 frames not observed')),18000)
    const frame=(now,metadata)=>{
      if(!video.isConnected){
        reject(Error('Owner video unmounted before presented frame'))
        return
      }
      if(metadata.presentedFrames>0&&Number.isFinite(metadata.mediaTime)&&
        metadata.width>0&&metadata.height>0){
        const last=frames[frames.length-1]
        if(!last||metadata.mediaTime>last.mediaTime+0.001){
          frames.push({mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames})
        }
        if(frames.length>=2){
          const first=frames[0],latest=frames[frames.length-1]
          if(latest.mediaTime>first.mediaTime+0.005&&
            latest.presentedFrames>first.presentedFrames){
            resolve({
              h264Presented:true,
              frameMediaDeltaMs:(latest.mediaTime-first.mediaTime)*1000,
              presentedFrameDelta:latest.presentedFrames-first.presentedFrames,
              width:video.videoWidth,height:video.videoHeight,
              decodedVideoFrames:video.getVideoPlaybackQuality?.().totalVideoFrames??null,
            })
            return
          }
        }
      }
      callbackID=video.requestVideoFrameCallback(frame)
    }
    callbackID=video.requestVideoFrameCallback(frame)
  })
  // Prevent an unhandled rejection if the OS rejects the play() gesture first.
  void presented.catch(()=>{})
  try{
    // Real Chromium media pipeline, actual signed CAS byte response. This is
    // explicit in-browser play() initiation, not a fake "playing" event.
    await video.play()
    return await presented
  }catch(error){
    throw Error('original H264 playback/frame failure: '+(error?.name||'unknown'))
  }finally{
    if(timeoutID!==null)clearTimeout(timeoutID)
    if(callbackID!==null&&typeof video.cancelVideoFrameCallback==='function')
      video.cancelVideoFrameCallback(callbackID)
    video.pause()
  }
}
async function p1MeasureRealH264ViewerMotion(win) {
  // Caller is already in deep Gallery after genuine JPEG Viewer Back.
  const tile=await until(async()=>win.webContents.executeJavaScript(
    '('+p1VisibleH264Tile.toString()+')()',true
  ),25000,'real 100k Owner visible deep H264 tile')
  assert(tile.depth>=0.7&&tile.tiles>0&&tile.tiles<1000,
    'real deep bounded Gallery H264 tile not visible')
  const started=performance.now()
  sendActualPointer(win,tile)
  await until(async()=>win.webContents.executeJavaScript(
    "location.hash.startsWith('#/app/media-viewer?') && !!document.querySelector('[data-xdrive-web-viewer]')",
    true),30000,'actual Gallery H264 tile clicked into shared Viewer')
  await until(async()=>win.webContents.executeJavaScript(
    '('+p1H264PlayerReady.toString()+')()',true
  ),30000,'signed H264 original Video ready for native Chromium decoder')
  const played=await win.webContents.executeJavaScript(
    '('+p1ObserveAdvancingVideoFrames.toString()+')()',true
  )
  assert(played.h264Presented&&played.frameMediaDeltaMs>5&&
    played.presentedFrameDelta>=1&&played.width>0&&played.height>0,
    'requestVideoFrameCallback did not prove advancing decoded H264 motion')
  const presentedMs=performance.now()-started
  win.webContents.sendInputEvent({type:'mouseMove',x:18,y:20})
  const back=await until(async()=>win.webContents.executeJavaScript(
    '('+p1BackPoint.toString()+')()',true
  ),12000,'actual video Viewer chrome Back')
  sendActualPointer(win,back)
  const returned=await until(async()=>win.webContents.executeJavaScript(
    '('+p1ReturnedToCaller.toString()+')()',true
  ),20000,'H264 Viewer Back returns to exact Gallery route and scroll')
  return {
    passed:true,deepFraction:tile.depth,presentedMs,
    frameMediaDeltaMs:played.frameMediaDeltaMs,
    presentedFrameDelta:played.presentedFrameDelta,
    videoWidth:played.width,videoHeight:played.height,
    decodedVideoFrames:played.decodedVideoFrames,
    sameCaller:returned.sameCaller,sameDocument:returned.sameDocument,
    sameHost:returned.sameHost,sameGrid:returned.sameGrid,
    restoredScrollDelta:returned.scrollDelta,
    claim:'two distinct H264 original presented video mediaTime frames in native Chromium after explicit play()',
    excluded:physicalP1Mode ? 'iOS Safari installed, HEIC/HEVC, independent H264 bitstreams, Go Range cancellation' : 'iOS Safari installed, Live Motion hold, 115k full CAS, Go video Range cancel',
  }
}


// P1-C: the real shared Live Photo Viewer is activated only by user-owned
// native pointer hold. RVFC records compositor-bound advancing motion frames
// without injecting fake video events, calling play() from a test or caching
// private media. Short taps/touch controls are separate future OS acceptance.
function p1VisibleLivePhotoTile() {
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  const host=document.querySelector('[data-xdrive-workspace-background] main')
  if(!(grid instanceof HTMLElement)||!(host instanceof HTMLElement))return null
  const extent=host.scrollHeight-host.clientHeight
  if(extent<10000)return null
  const clip=host.getBoundingClientRect()
  for(const tile of grid.querySelectorAll('[data-xdrive-media-tile]')){
    if(!tile.getAttribute('aria-label')?.includes('实况照片'))continue
    const rect=tile.getBoundingClientRect()
    if(rect.bottom<=clip.top+16||rect.top>=clip.bottom-16)continue
    const x=Math.round(rect.left+rect.width/2)
    const y=Math.round(Math.max(clip.top+16,Math.min(rect.top+rect.height/2,clip.bottom-16)))
    const hit=document.elementFromPoint(x,y)
    if(hit!==tile&&!tile.contains(hit))continue
    window.__xdriveP1Entry={document:document.documentElement,host,grid,
      scrollTop:host.scrollTop,route:location.hash}
    return {x,y,depth:host.scrollTop/extent,tiles:grid.querySelectorAll('[data-xdrive-media-tile]').length}
  }
  const seek=window.__xdriveP1LiveSeek||(window.__xdriveP1LiveSeek={steps:0})
  if(seek.steps<12&&host.scrollTop>extent*0.7){
    seek.steps++
    host.scrollTop=Math.max(extent*0.7,host.scrollTop-Math.max(80,host.clientHeight*0.7))
    host.dispatchEvent(new Event('scroll'))
  }
  return null
}
function p1LiveStillReady(){
  const viewer=document.querySelector('[data-xdrive-web-viewer]')
  const surface=Array.from(viewer?.querySelectorAll('[role="button"]')||[]).find(x=>
    x.getAttribute('aria-label')?.includes('按住播放'))
  if(!(surface instanceof HTMLElement)||surface.getAttribute('aria-disabled')==='true')return null
  const imgs=Array.from(surface.querySelectorAll('img'))
  if(!imgs.some(x=>x.complete&&x.naturalWidth>0&&x.naturalHeight>0))return null
  const rect=surface.getBoundingClientRect()
  if(rect.width<50||rect.height<50)return null
  const x=Math.round(rect.left+rect.width/2)
  const y=Math.round(rect.top+rect.height/2)
  const hit=document.elementFromPoint(x,y)
  if(hit!==surface&&!surface.contains(hit))return null
  return {x,y,stillReady:true}
}
function p1StartLiveVideoFrameObservation(){
  const viewer=document.querySelector('[data-xdrive-web-viewer]')
  const surface=Array.from(viewer?.querySelectorAll('[role="button"]')||[]).find(x=>
    x.getAttribute('aria-label')?.includes('按住播放'))
  if(!(surface instanceof HTMLElement))return false
  const probe={frames:[],video:null,observer:null,disposed:false,requestID:null}
  window.__xdriveP1LiveProbe=probe
  const connect=()=>{
    if(probe.disposed)return
    const video=surface.querySelector('video')
    if(!(video instanceof HTMLVideoElement)||probe.video===video)return
    if(typeof video.requestVideoFrameCallback!=='function')return
    probe.video=video
    const frame=(now,metadata)=>{
      if(probe.disposed||!video.isConnected)return
      const last=probe.frames[probe.frames.length-1]
      if(metadata.presentedFrames>0&&Number.isFinite(metadata.mediaTime)&&
        metadata.width>0&&metadata.height>0&&
        (!last||metadata.mediaTime>last.time+0.001)){
        probe.frames.push({time:metadata.mediaTime,count:metadata.presentedFrames})
      }
      if(probe.frames.length<4)
        probe.requestID=video.requestVideoFrameCallback(frame)
    }
    probe.requestID=video.requestVideoFrameCallback(frame)
  }
  probe.observer=new MutationObserver(connect)
  probe.observer.observe(surface,{subtree:true,childList:true,attributes:true,attributeFilter:['src']})
  connect()
  return true
}
function p1LiveMotionFrameStatus(){
  const probe=window.__xdriveP1LiveProbe
  if(!probe)return null
  const surface=Array.from(document.querySelectorAll('[data-xdrive-web-viewer] [role="button"]')).find(x=>
    x.getAttribute('aria-label')?.includes('按住播放'))
  if(!surface)return null
  const frames=probe.frames
  if(frames.length<2||!probe.video?.isConnected)return null
  const first=frames[0],last=frames[frames.length-1]
  if(last.time<=first.time+0.005||last.count<=first.count)return null
  if(surface.getAttribute('aria-pressed')!=='true')return null
  const video=probe.video
  // Real held Live motion must use this Owner's same-origin signed original.
  // Inspect only URI shape/ticket presence; do not persist signed URLs.
  const signed=video.currentSrc ? new URL(video.currentSrc,location.href) : null
  if(!signed||signed.origin!==location.origin||
    !/^\/api\/v1\/media-live-photo-motion\/\d+$/.test(signed.pathname)||
    !signed.searchParams.has('ticket'))return null
  return {frames:frames.length,mediaDeltaMs:(last.time-first.time)*1000,
    frameDelta:last.count-first.count,width:video.videoWidth,height:video.videoHeight,
    held:true,decodeFrames:video.getVideoPlaybackQuality?.().totalVideoFrames??null}
}
function p1LiveReleasedStatus(){
  const probe=window.__xdriveP1LiveProbe
  if(!probe)return null
  const surface=Array.from(document.querySelectorAll('[data-xdrive-web-viewer] [role="button"]')).find(x=>
    x.getAttribute('aria-label')?.includes('按住播放'))
  if(!surface)return null
  const video=probe.video
  if(!(video instanceof HTMLVideoElement))return null
  const hasStill=Array.from(surface.querySelectorAll('img')).some(img=>
    img.complete&&img.naturalWidth>0&&img.naturalHeight>0)
  const opacity=Number(getComputedStyle(video).opacity)
  if(surface.getAttribute('aria-pressed')!=='false'||!video.paused||
    !hasStill||!Number.isFinite(opacity)||opacity>0.05)return null
  probe.disposed=true
  probe.observer?.disconnect()
  if(probe.requestID!==null&&typeof video.cancelVideoFrameCallback==='function')
    video.cancelVideoFrameCallback(probe.requestID)
  delete window.__xdriveP1LiveProbe
  return {released:true,stillDecoded:true,paused:true,videoOpacity:opacity}
}
async function p1MeasureLivePhotoHold(win){
  const tile=await until(async()=>win.webContents.executeJavaScript(
    '('+p1VisibleLivePhotoTile.toString()+')()',true
  ),25000,'real deep Owner Live Photo pair tile')
  assert(tile.depth>=0.7&&tile.tiles>0&&tile.tiles<1000,'real Live tile missing')
  sendActualPointer(win,tile)
  await until(async()=>win.webContents.executeJavaScript(
    "location.hash.startsWith('#/app/media-viewer?') && !!document.querySelector('[data-xdrive-web-viewer]')",
    true),30000,'real shared Live Photo Viewer')
  const point=await until(async()=>win.webContents.executeJavaScript(
    '('+p1LiveStillReady.toString()+')()',true
  ),30000,'decoded original Live still ready before motion')
  assert(await win.webContents.executeJavaScript(
    '('+p1StartLiveVideoFrameObservation.toString()+')()',true))
  // REAL native Chromium mouse down is held through the signed ticket,
  // playback and two distinct compositor frames; no forced play() or URL.
  win.focus()
  win.webContents.focus()
  win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y})
  const started=performance.now()
  win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,
    button:'left',clickCount:1})
  let presented,release,back
  try{
    presented=await until(async()=>win.webContents.executeJavaScript(
      '('+p1LiveMotionFrameStatus.toString()+')()',true
    ),25000,'actual held Live motion two advancing compositor frames')
  }finally{
    win.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,
      button:'left',clickCount:1})
  }
  release=await until(async()=>win.webContents.executeJavaScript(
    '('+p1LiveReleasedStatus.toString()+')()',true
  ),12000,'Live pointer-up pauses motion and displays original still')
  const displayedMs=performance.now()-started
  win.webContents.sendInputEvent({type:'mouseMove',x:18,y:20})
  back=await until(async()=>win.webContents.executeJavaScript(
    '('+p1BackPoint.toString()+')()',true
  ),12000,'real Live Viewer Back chrome')
  sendActualPointer(win,back)
  const returned=await until(async()=>win.webContents.executeJavaScript(
    '('+p1ReturnedToCaller.toString()+')()',true
  ),20000,'real Live Viewer returns to same mounted Gallery')
  assert(presented.mediaDeltaMs>5&&presented.frameDelta>=1&&
    release.paused&&release.stillDecoded&&returned.sameCaller&&returned.sameGrid)
  return {passed:true,deepFraction:tile.depth,displayedMs,
    mediaDeltaMs:presented.mediaDeltaMs,frameDelta:presented.frameDelta,
    width:presented.width,height:presented.height,
    decodedVideoFrames:presented.decodeFrames,
    pausedOnRelease:release.paused,stillAfterRelease:release.stillDecoded,
    videoOpacityAfterRelease:release.videoOpacity,
    sameCaller:returned.sameCaller,sameDocument:returned.sameDocument,
    sameHost:returned.sameHost,sameGrid:returned.sameGrid,
    restoredScrollDelta:returned.scrollDelta,
    scope:'actual native Chromium mouse hold shared Live still and paired CAS MP4 motion',
    notMeasured:physicalP1Mode ? 'native iOS touch long press; Owner revoke, HEIC/HEVC or in-flight Range Go cancel' : 'native iOS touch long press; owner revoke while Video Range inflight; 115k physical CAS'}
}


// P1-D: actual shared Owner Viewer creates a genuine signed original H264
// Range GET. Its real Back control must abort the in-progress Gin handler;
// no direct AbortController, injected route or synthetic browser response.
function p1RestoreDeepVideoViewport(){
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  const host=document.querySelector('[data-xdrive-workspace-background] main')
  if(!(grid instanceof HTMLElement)||!(host instanceof HTMLElement))return false
  const extent=host.scrollHeight-host.clientHeight
  if(extent<=10000)return false
  window.__xdriveP1H264Scan={steps:0}
  host.scrollTop=extent
  host.dispatchEvent(new Event('scroll'))
  return true
}
// Test the browser video element's original signed URL before it decodes.
// Requiring videoWidth here would wait for an HTTP Range to finish and would
// make a genuine in-flight Viewer cancellation unmeasurable.
function p1OriginalSignedVideoElement(){
  const video=document.querySelector(
    '[data-xdrive-web-viewer] [data-xdrive-preview-media-state="video"] video'
  )
  if(!(video instanceof HTMLVideoElement)||!video.currentSrc)return false
  const source=new URL(video.currentSrc,location.href)
  return source.origin===location.origin &&
    /^\/api\/v1\/file-preview\/\d+$/.test(source.pathname) &&
    source.searchParams.has('ticket')
}

async function p1ViewerVideoProbeStats(base){
  const response=await fetch(base+'/__perf/viewer-video-range-stats',{cache:'no-store'})
  assert.equal(response.status,200,'genuine Go signed Viewer video range probe absent')
  return response.json()
}
async function p1MeasureRealViewerRangeAbort(win,base){
  const enabled=await fetch(base+'/__perf/viewer-video-range-enable',{method:'POST'})
  assert.equal(enabled.status,204,'real Owner H264 signed video range probe enable failed')
  const zero=await p1ViewerVideoProbeStats(base)
  assert.equal(zero.started,0,'unscoped pre-enable original Range must not be counted')
  assert(await win.webContents.executeJavaScript(
    '('+p1RestoreDeepVideoViewport.toString()+')()',true
  ),'genuine 100k Owner Gallery deep scroll host is absent')
  const tile=await until(async()=>win.webContents.executeJavaScript(
    '('+p1VisibleH264Tile.toString()+')()',true
  ),25000,'genuine visible deep H264 tile before signed Range cancellation')
  assert(tile.depth>=0.7&&tile.tiles<1000,'real bounded video tile absent')
  sendActualPointer(win,tile)
  await until(async()=>win.webContents.executeJavaScript(
    "location.hash.startsWith('#/app/media-viewer?') && !!document.querySelector('[data-xdrive-web-viewer]')",
    true),30000,'real video Viewer route')
  // A real 206 Range must be canceled WHILE decoding/buffering the original.
  // Waiting for videoWidth can drain the padded real stream before Back.
  await until(async()=>win.webContents.executeJavaScript(
    '('+p1OriginalSignedVideoElement.toString()+')()',true
  ),12000,'real Owner signed original Video element before Range completes')

  let inFlight
  try{
    inFlight=await until(async()=>{
      const stats=await p1ViewerVideoProbeStats(base)
      return stats.signed_range>=1 && stats.partial_content>=1 &&
        stats.first_chunks>=1 && stats.active>=1 &&
        stats.emitted_bytes>0 ? stats : null
    },12000,'real signed original H264 HTTP Range still in-flight')
  }catch(error){
    // Never expose signed URL, ticket, Authorization or original bytes.
    const stats=await p1ViewerVideoProbeStats(base)
    const browser=await win.webContents.executeJavaScript(
      '(()=>{const v=document.querySelector("[data-xdrive-web-viewer] [data-xdrive-preview-media-state=video] video");return v?{mounted:true,readyState:v.readyState,networkState:v.networkState,videoWidth:v.videoWidth,videoHeight:v.videoHeight,bufferedCount:v.buffered.length,paused:v.paused,seekableCount:v.seekable.length}: {mounted:false}})()',true)
    console.error('P1D_SANITIZED_RANGE_DIAGNOSTIC '+JSON.stringify({
      requests:stats.started,ranged:stats.signed_range,
      noRange:stats.signed_no_range,status206:stats.partial_content,
      chunks:stats.first_chunks,active:stats.active,bytes:stats.emitted_bytes,
      browser,
    }))
    throw error
  }
  // Resolve the actual visible Back button before starting the 160 ms
  // Go Request.Context.Done stopwatch. Do not stop a standalone fetch.
  win.webContents.sendInputEvent({type:'mouseMove',x:18,y:20})
  const back=await until(async()=>win.webContents.executeJavaScript(
    '('+p1BackPoint.toString()+')()',true
  ),12000,'real video Viewer Back button while original Range is active')
  const preClick=await p1ViewerVideoProbeStats(base)
  assert(preClick.active>=1&&preClick.emitted_bytes===inFlight.emitted_bytes,
    'signed original Range finished before genuine Viewer exit click')
  const marked=await fetch(base+'/__perf/viewer-video-range-mark',{method:'POST'})
  assert.equal(marked.status,204,'server Range cancellation stopwatch unavailable')
  const markStats=await p1ViewerVideoProbeStats(base)
  assert(markStats.active>=1&&markStats.mark_emitted_bytes===markStats.emitted_bytes,
    'video Range emitted bytes before actual Viewer Back click')
  const started=performance.now()
  sendActualPointer(win,back)
  const returned=await until(async()=>win.webContents.executeJavaScript(
    '('+p1ReturnedToCaller.toString()+')()',true
  ),12000,'real Owner video Viewer Back restores same Gallery virtual anchor')
  await sleep(160)
  const after=await p1ViewerVideoProbeStats(base)
  const browserBackMs=performance.now()-started
  const row={
    passed:after.context_done>=1&&after.cancelled>=1&&
      after.active===0&&after.max_cancel_us>0&&after.max_cancel_us<=160000&&
      after.emitted_bytes===markStats.mark_emitted_bytes&&
      returned.sameCaller&&returned.sameDocument&&
      returned.sameHost&&returned.sameGrid&&returned.scrollDelta<=2,
    watchedOriginals:after.watched_paths,rangeStarted:after.started,
    signedPartialContent:after.partial_content,
    firstChunks:after.first_chunks,activeAtMark:markStats.active,
    goContextDone:after.context_done,cancelledHandlers:after.cancelled,
    stillActiveAt160Ms:after.active,
    wastedBytesAfterViewerBack:after.emitted_bytes-markStats.mark_emitted_bytes,
    goContextMaxMs:after.max_cancel_us/1000,
    backElapsedMs:browserBackMs,
    sameCaller:returned.sameCaller,sameDocument:returned.sameDocument,
    sameHost:returned.sameHost,sameGrid:returned.sameGrid,
    restoredScrollDelta:returned.scrollDelta,
    proof:'native Viewer Back unmount -> signed original H264 Range HTTP Go Request.Context.Done',
    exclusions:'owner-switch cancellation, physical iOS Safari, 115k full original CAS',
  }
  assert(row.passed,'genuine Viewer video Range did not stop Go work: '+JSON.stringify(row))
  return row
}


// Test-only P1Q: second real authenticated native Chromium window clicks
// Logout while the FIRST Owner Viewer's genuine signed H264 206 Range is in
// flight. No synthetic BroadcastChannel event or JavaScript DOM .click().
function p1QAccountButtonPoint(mode) {
  const avatar=mode==='avatar'
  const query=avatar?'button[aria-label="账户菜单"]':'[role="menuitem"]'
  const target=avatar?'账户菜单':'退出登录'
  const matches=[...document.querySelectorAll(query)].filter(button=>{
    const label=(button.getAttribute('aria-label')||button.textContent||'')
      .replace(/\s+/g,'').trim()
    if(label!==target)return false
    const rect=button.getBoundingClientRect(),style=getComputedStyle(button)
    if(rect.width<12||rect.height<12||rect.left<0||rect.top<0||
      rect.right>innerWidth||rect.bottom>innerHeight||
      style.visibility==='hidden'||style.pointerEvents==='none')return false
    const x=rect.left+rect.width/2,y=rect.top+rect.height/2
    const hit=document.elementFromPoint(x,y)
    return hit===button||button.contains(hit)
  })
  if(matches.length!==1)return null
  const rect=matches[0].getBoundingClientRect()
  return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}
}
async function p1QVisibleAccountPoint(win,mode) {
  return win.webContents.executeJavaScript(
    '('+p1QAccountButtonPoint.toString()+')('+JSON.stringify(mode)+')',true)
}
async function p1QBrowserOwnerState(win) {
  return win.webContents.executeJavaScript('(() => ({'+
    'viewerMounted:!!document.querySelector("[data-xdrive-web-viewer]"),'+
    'galleryMounted:!!document.querySelector("[data-xdrive-media-gallery-virtual-grid]"),'+
    'loginMounted:!!document.querySelector("#web-login-username"),'+
    'hasOwnerSession:!!localStorage.getItem("xdrive.access_token"),'+
    'nativeVideoMounted:!!document.querySelector("[data-xdrive-web-viewer] video"),'+
    'sameDocument:document.documentElement===window.__pwaC2SPADocument'+
    '}))()',true)
}
async function p1MeasureRealCrossTabViewerLogout(win,base,sample) {
  const auditor=new BrowserWindow({show:true,x:520,y:12,width:390,height:844,
    webPreferences:{partition:'real-mobile-gallery-web-scroll-'+sample,
      sandbox:false,nodeIntegration:false,contextIsolation:true,
      webSecurity:true,backgroundThrottling:false}})
  try {
    await bootOriginalAuthenticatedApp(auditor,base)
    await switchActualApp(auditor,'文件','files')
    await switchActualApp(win,'图库','gallery')
    // The accepted real JPEG Viewer/Back path hydrates the same deep,
    // authenticated Gallery virtual-grid and preserves its scroll anchor.
    // Crucially DO NOT open H264 before enabling the independent Range probe:
    // reopening the warmed video can reuse Chromium media resources, so a
    // second signed HTTP 206 in-flight Range is not guaranteed. The first
    // genuinely opened H264 Viewer must be the measured logout target.
    const warmJPEG=await p1MeasureRealViewerBack(win)
    assert(warmJPEG.passed&&warmJPEG.returned.sameDocument&&
      warmJPEG.returned.sameHost&&warmJPEG.returned.sameGrid&&
      warmJPEG.returned.scrollDelta<=2,
      'P1Q cannot begin logout without real decoded JPEG Viewer Back')
    const enabled=await fetch(base+'/__perf/viewer-video-range-enable',{method:'POST'})
    assert.equal(enabled.status,204,'P1Q original Go signed Range probe disabled')
    const zero=await p1ViewerVideoProbeStats(base)
    assert.equal(zero.started,0,'signed Range measurement must start at zero')
    // Keep the original deep JPEG Viewer Back anchor. A genuine unvisited
    // H264 tile is selected from the same actual mounted virtualized Grid.
    const tile=await until(async()=>win.webContents.executeJavaScript(
      '('+p1VisibleH264Tile.toString()+')()',true),
      25000,'real Owner deep H264 photo wall tile missing')
    assert(tile.depth>=0.7&&tile.tiles>0&&tile.tiles<1000,
      'not a real bounded 100k Owner Gallery tile')
    sendActualPointer(win,tile)
    await until(async()=>win.webContents.executeJavaScript(
      "location.hash.startsWith('#/app/media-viewer?') && !!document.querySelector('[data-xdrive-web-viewer]')",
      true),30000,'first window actual routed H264 Viewer')
    await until(async()=>win.webContents.executeJavaScript(
      '('+p1OriginalSignedVideoElement.toString()+')()',true),
      12000,'actual signed original video before logout')
    const inflight=await until(async()=>{
      const s=await p1ViewerVideoProbeStats(base)
      return s.signed_range>=1&&s.partial_content>=1&&s.first_chunks>=1&&
        s.active>=1&&s.emitted_bytes>0?s:null
    },12000,'real signed 206 Range must be in flight during logout')
    // Compact iOS-style 52px Header intentionally has no avatar:
    // the REAL account action lives inside the bottom App navigation drawer.
    // Open it using the genuine header control, not a synthetic DOM click,
    // an injected menu or an offscreen account shortcut.
    const navPoint=await until(async()=>{
      const p=await visibleButtonCenter(auditor,'打开应用导航')
      return p.error?null:p
    },12000,'second window real mobile App navigation button')
    sendActualPointer(auditor,navPoint)
    await until(async()=>auditor.webContents.executeJavaScript(
      '(()=>{const d=document.querySelector("[role=dialog][aria-modal=true]");'+
      'return !!d&&!d.hasAttribute("inert")&&d.getBoundingClientRect().height>200})()',true),
      12000,'second window mounted real account navigation drawer')
    // As in prepareAppDestination, wait for the actual MUI Drawer slide.
    // Final hit testing remains authoritative; no fake state transition.
    await sleep(430)
    const avatar=await until(async()=>p1QVisibleAccountPoint(auditor,'avatar'),
      10000,'second window real account avatar inside open App drawer')
    sendActualPointer(auditor,avatar)
    const logout=await until(async()=>p1QVisibleAccountPoint(auditor,'logout'),
      10000,'second window actual Logout MenuItem')
    const before=await p1ViewerVideoProbeStats(base)
    // Original bytes may advance while the real Logout menu is prepared.
    // The invariant is an ACTIVE, authenticated Range at the actual click;
    // zero extra bytes is enforced separately AFTER the server mark.
    assert(before.active>=1&&before.context_done===0&&
      before.signed_range>=inflight.signed_range&&
      before.emitted_bytes>=inflight.emitted_bytes,
      'Viewer original Range no longer active before native Logout click: '+
      JSON.stringify({active:before.active,contextDone:before.context_done,
        signedRanges:before.signed_range,
        bytesBeforeClick:before.emitted_bytes-inflight.emitted_bytes}))
    const marked=await fetch(base+'/__perf/viewer-video-range-mark',{method:'POST'})
    assert.equal(marked.status,204,'Go signed Range cancellation timer absent')
    const mark=await p1ViewerVideoProbeStats(base)
    assert(mark.active>=1&&mark.mark_emitted_bytes===mark.emitted_bytes,
      'not an active original H264 Range at logout mark')
    const started=performance.now()
    sendActualPointer(auditor,logout)
    await sleep(160)
    const after=await p1ViewerVideoProbeStats(base)
    const logoutElapsedMs=performance.now()-started
    const browser=await until(async()=>{
      const b=await p1QBrowserOwnerState(win)
      return b.sameDocument&&!b.viewerMounted&&!b.galleryMounted&&
        !b.nativeVideoMounted&&!b.hasOwnerSession&&b.loginMounted?b:null
    },10000,'logout must retire first Owner Viewer and private media')
    await sleep(200)
    const stable=await p1ViewerVideoProbeStats(base)
    const passed=after.context_done>=mark.active&&after.cancelled>=1&&
      after.active===0&&after.max_cancel_us>0&&after.max_cancel_us<=160000&&
      after.emitted_bytes===mark.mark_emitted_bytes&&
      stable.active===0&&stable.started===after.started&&
      stable.emitted_bytes===mark.mark_emitted_bytes&&
      browser.sameDocument&&!browser.hasOwnerSession&&
      !browser.viewerMounted&&!browser.nativeVideoMounted&&browser.loginMounted
    const row={passed,ownerAuthenticatedBefore:true,crossWindowNativeLogout:true,
      signedPartialContent:after.partial_content,signedRangeStarted:after.signed_range,
      activeAtMark:mark.active,contextDone:after.context_done,
      cancelledHandlers:after.cancelled,stillActiveAt160Ms:after.active,
      wastedBytesAfterLogout:after.emitted_bytes-mark.mark_emitted_bytes,
      goContextMaxMs:after.max_cancel_us/1000,logoutElapsedMs,
      noNewRequestAfterLogout:stable.started===after.started,
      browser:{sameDocument:browser.sameDocument,loggedOut:!browser.hasOwnerSession,
        loginMounted:browser.loginMounted,viewerUnmounted:!browser.viewerMounted,
        mediaUnmounted:!browser.nativeVideoMounted&&!browser.galleryMounted},
      proof:'second authenticated native App Logout -> BroadcastChannel Owner teardown -> first actual signed H264 Range Go Context.Done',
      exclusions:'Not Server access-token revocation proof, physical iOS, HEIC, HEVC or full 115k original CAS'}
    assert(row.passed,'P1Q cross-tab Owner video Range cancellation failed: '+JSON.stringify(row))
    return row
  } finally {
    if(!auditor.isDestroyed())auditor.destroy()
  }
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
    if (p0c2SPAMode) {
      await bootOriginalAuthenticatedApp(win, fixture.config.url)
    } else {
      await win.loadURL(fixture.config.url +
        '/?xdriveGalleryRealCold=1&xdriveRealViewportCancel=1&xdriveMediaProgress=off')
    }
    const viewport = await win.webContents.executeJavaScript(
      '({width:document.documentElement.clientWidth,height:innerHeight,narrow:matchMedia("(max-width:899.95px)").matches})', true)
    assert(viewport.narrow && viewport.width >= 360 && viewport.width <= 390 &&
      viewport.height >= 700, 'actual Mobile Web responsive Gallery not mounted: ' + JSON.stringify(viewport))

    if (physicalP1Mode) {
      // The same 115k independently hashed physical CAS objects are read by
      // genuine signed Owner routes for all three consecutive Viewer types.
      // The original 160ms synthetic slow-stream gate is intentionally NOT
      // enabled here: this is a separate physical-source lifecycle workload.
      assert.equal(fixture.config.physical_mode, true)
      assert.equal(fixture.config.physical_sources, 115000)
      assert.equal(fixture.config.physical_verified, 12)
      assert.equal(fixture.config.live_photo_groups, 15000)
      const healthy = await newIndependentRange(fixture)
      const goPID = actualFixtureGoPID(fixture.child.pid)
      const rendererPID = win.webContents.getOSProcessId()
      const goStart = nativeProcessStats(goPID)
      const rendererStart = nativeProcessStats(rendererPID)
      let peakGoRSS = goStart.rssBytes
      let peakRendererRSS = rendererStart.rssBytes
      resourceSampler = setInterval(() => {
        try {
          peakGoRSS = Math.max(peakGoRSS, nativeProcessStats(goPID).rssBytes)
          peakRendererRSS = Math.max(peakRendererRSS, nativeProcessStats(rendererPID).rssBytes)
        } catch { /* a vanished process still fails the mandatory final read */ }
      }, 25)
      const jpeg = await p1MeasureRealViewerBack(win)
      const h264 = await p1MeasureRealH264ViewerMotion(win)
      const live = await p1MeasureLivePhotoHold(win)
      clearInterval(resourceSampler)
      resourceSampler = null
      const goEnd = nativeProcessStats(goPID)
      const rendererEnd = nativeProcessStats(rendererPID)
      peakGoRSS = Math.max(peakGoRSS, goEnd.rssBytes)
      peakRendererRSS = Math.max(peakRendererRSS, rendererEnd.rssBytes)
      const resources = {
        go: {initial:goStart,final:goEnd,
          rssGrowthBytes:Math.max(0,peakGoRSS-goStart.rssBytes),
          cpuDeltaMs:goEnd.cpuMs-goStart.cpuMs},
        renderer: {initial:rendererStart,final:rendererEnd,
          rssGrowthBytes:Math.max(0,peakRendererRSS-rendererStart.rssBytes),
          cpuDeltaMs:rendererEnd.cpuMs-rendererStart.cpuMs},
      }
      const accepted = failures.length===0 && healthy.status===200 &&
        jpeg.passed && jpeg.returned.sameDocument && jpeg.returned.sameHost &&
        jpeg.returned.sameGrid && jpeg.returned.scrollDelta<=2 &&
        h264.passed && h264.presentedFrameDelta>=1 && h264.frameMediaDeltaMs>5 &&
        h264.sameDocument && h264.sameHost && h264.sameGrid &&
        h264.restoredScrollDelta<=2 &&
        live.passed && live.frameDelta>=1 && live.mediaDeltaMs>5 &&
        live.pausedOnRelease && live.stillAfterRelease &&
        live.sameDocument && live.sameHost && live.sameGrid &&
        live.restoredScrollDelta<=2 &&
        resources.go.cpuDeltaMs>=0 && resources.renderer.cpuDeltaMs>=0 &&
        resources.go.rssGrowthBytes<=256*1024*1024 &&
        resources.renderer.rssGrowthBytes<=256*1024*1024
      const row = {
        sample,passed:accepted,physicalMode:true,ownerAuthenticated:true,
        logicalAssets:fixture.config.logical_assets,
        physicalOriginals:fixture.config.physical_sources,
        physicalBytes:fixture.config.physical_bytes,
        physicalReadbacks:fixture.config.physical_verified,
        liveGroups:fixture.config.live_photo_groups,seedMsExcluded:fixture.config.seed_ms,
        viewport,healthy,jpeg,h264,live,resources,
        limitations:'CURRENT n=1 physical Owner session, not iOS Safari; 115k SHA-distinct containers but videos reuse one real 96x64 H264 bitstream; no HEIC/HEVC, full weak-network/logout/revoke or in-flight signed-Range Go cancellation; NOT a measured causal speedup',
      }
      fs.writeFileSync(path.join(out, 'sample-'+sample+'.json'),JSON.stringify(row,null,2)+'\n')
      console.log('PWA_P1P_PHYSICAL_115K_SAMPLE '+JSON.stringify(row))
      assert(accepted,'actual 115k physical Owner JPEG/H264/Live Viewer lifecycle failed')
      return row
    }
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
    // Open the genuine navigation Drawer before the 160ms cancellation mark:
    // the frozen budget must measure the Files click -> Go Context.Done,
    // not the time it takes to find/open a Sidebar destination.
    const targetFiles = p0c2SPAMode ? await prepareAppDestination(win, '文件') : null
    if (p0c2SPAMode) {
      // Opening the Drawer is intentionally OUTSIDE the frozen click deadline.
      // Do not claim a Files-click abort if opening the Drawer already stopped
      // the requests: every original Go stream must still be active now.
      const preClick = await readStats(fixture.config.url)
      assert.equal(preClick.active, streamCount,
        'App menu prematurely aborted Gallery streams before route click')
      assert.equal(preClick.context_done, started.context_done,
        'Go cancellation predated Files route click')
      assert.equal(preClick.emitted_bytes, started.emitted_bytes,
        'Gallery unexpectedly emitted body bytes while preparing the route click')
    }
    const marker = await fetch(fixture.config.url + '/__perf/viewport-cancel-mark',
      { method: 'POST' })
    assert.equal(marker.status, 204)
    let scroll
    let leaveNavigation = null
    if (p0c2SPAMode) {
      const before = await win.webContents.executeJavaScript(`(() => ({
        sameMain:document.querySelector('main') === window.__pwaC2SPAMain,
        sameDocument:document.documentElement === window.__pwaC2SPADocument,
        galleryMounted:!!document.querySelector('[data-xdrive-media-gallery-virtual-grid]'),
        route:location.hash
      }))()`, true)
      assert(before.sameMain && before.sameDocument && before.galleryMounted &&
        before.route.startsWith('#/app/gallery'), 'not the original signed Gallery SPA')
      scroll = {kind:'same-document-app-route',sameMainBefore:before.sameMain,
        galleryMountedBefore:before.galleryMounted}
      sendActualPointer(win, targetFiles)
    } else if (p0c2PageLeaveMode) {
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
    if (p0c2SPAMode) {
      const finalRoute = await until(async () => {
        const next = await win.webContents.executeJavaScript(`(() => ({
          route:location.hash,
          noGallery:!document.querySelector('[data-xdrive-media-gallery-virtual-grid]'),
          filesMounted:!!document.querySelector('[data-xdrive-mobile-files]'),
          sameMain:document.querySelector('main') === window.__pwaC2SPAMain,
          sameDocument:document.documentElement === window.__pwaC2SPADocument
        }))()`, true)
        return next.route.startsWith('#/app/files') && next.noGallery &&
          next.sameMain && next.sameDocument ? next : null
      }, 12000, 'true Files SPA destination in unchanged app document')
      scroll.sameMainAfter = finalRoute.sameMain
      scroll.sameDocumentAfter = finalRoute.sameDocument
      scroll.galleryUnmounted = finalRoute.noGallery
      scroll.filesMounted = finalRoute.filesMounted
    } else if (p0c2PageLeaveMode) {
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
    if(p1CrossTabLogoutMode){
      const ownerLogout=await p1MeasureRealCrossTabViewerLogout(
        win,fixture.config.url,sample)
      clearInterval(resourceSampler);resourceSampler=null
      const goEnd=nativeProcessStats(actualGoPID)
      const rendererEnd=nativeProcessStats(rendererPID)
      peakGoRSS=Math.max(peakGoRSS,goEnd.rssBytes)
      peakRendererRSS=Math.max(peakRendererRSS,rendererEnd.rssBytes)
      const resources={
        goRSSGrowthBytes:Math.max(0,peakGoRSS-goStart.rssBytes),
        rendererRSSGrowthBytes:Math.max(0,peakRendererRSS-rendererStart.rssBytes),
        goCPUMs:goEnd.cpuMs-goStart.cpuMs,
        rendererCPUMs:rendererEnd.cpuMs-rendererStart.cpuMs,
      }
      const oldGalleryCancelled=after.active===0&&
        after.context_done-started.context_done===streamCount&&
        after.cancelled-started.cancelled===streamCount&&
        after.emitted_bytes===started.emitted_bytes&&
        after.max_cancel_us<=160000
      const row={sample,passed:failures.length===0&&healthy.status===200&&
          oldGalleryCancelled&&ownerLogout.passed&&
          resources.goRSSGrowthBytes<=128*1024*1024&&
          resources.rendererRSSGrowthBytes<=128*1024*1024&&
          resources.goCPUMs>=0&&resources.rendererCPUMs>=0,
        logicalAssets:100000,physicalNodes:115000,
        ownerLogout,oldGalleryCancelled,resources,
        scope:'Real Gin PG17 bounded CAS 100k Owner SPA; genuine second-window Logout unmounts original Viewer and cancels signed H264 206 Range within 160ms',
        exclusions:'Not physical iOS, HEIC, HEVC, independent token revocation proof, or causal speedup'}
      fs.writeFileSync(path.join(out,'sample-'+sample+'.json'),
        JSON.stringify(row,null,2)+'\n')
      console.log('PWA_P1Q_OWNER_LOGOUT_SAMPLE '+JSON.stringify(row))
      assert(row.passed,'P1Q authentic Owner logout lifecycle not accepted')
      return row
    }
    const p1ViewerBack = p1Mode ? await p1MeasureRealViewerBack(win) : null
    const p1H264Frames = p1H264Mode ? await p1MeasureRealH264ViewerMotion(win) : null
    const p1LiveMotion = p1LiveMode ? await p1MeasureLivePhotoHold(win) : null
    const p1ViewerRangeAbort = p1ViewerVideoAbortMode ? await p1MeasureRealViewerRangeAbort(win,fixture.config.url) : null
    const row = {
      sample, viewport, streamCount, resources, logicalAssets: 100000, physicalNodes: 115000,
      firstImageNodes: fixture.config.first_image_nodes,
      seedMsExcluded: fixture.config.seed_ms,
      scroll, healthy, p1ViewerBack, p1H264Frames, p1LiveMotion, p1ViewerRangeAbort, pageLeaveMode:p0c2PageLeaveMode, spaMode:p0c2SPAMode,
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
      scope: p0c2SPAMode ?
        'Actual 52px Mobile App Frame authentic Owner Files→Gallery→Files buttons in SAME React document/main, real Gin/PG17/CAS/100k logical Gallery; 4-6 actual HTTP JPEG thumbnails aborted in Go within 160ms; NOT physical iOS, 100k distinct JPEG, LAN/WAN or durable upload.' :
        p0c2PageLeaveMode ?
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

    if(p1CrossTabLogoutMode){
      const report={
        status:'measured-P1Q-cross-tab-Owner-logout-signed-H264-Range',
        sampleCount:rows.length,
        passed:rows.length===3&&rows.every(row=>row.passed&&
          row.logicalAssets===100000&&row.physicalNodes===115000&&
          row.oldGalleryCancelled&&row.ownerLogout?.passed&&
          row.ownerLogout?.crossWindowNativeLogout&&
          row.ownerLogout?.contextDone>=row.ownerLogout?.activeAtMark&&
          row.ownerLogout?.stillActiveAt160Ms===0&&
          row.ownerLogout?.wastedBytesAfterLogout===0&&
          row.ownerLogout?.goContextMaxMs<=160&&
          row.ownerLogout?.browser?.loggedOut&&
          row.ownerLogout?.browser?.viewerUnmounted&&
          row.ownerLogout?.noNewRequestAfterLogout),
        goLogoutMaxMs:Math.max(...rows.map(row=>row.ownerLogout.goContextMaxMs)),
        wastedBytes:rows.reduce((sum,row)=>sum+row.ownerLogout.wastedBytesAfterLogout,0),
        logicalAssets:100000,physicalNodes:115000,
        sameRunner:true,authenticCrossWindowButton:true,goNativeHTTPRange:true,
        actualServerRevocationVerified:false,realIOSSafari:false,
        causalConclusion:'NOT_ESTABLISHED',samples:rows,
      }
      fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2)+'\n')
      console.log('PWA_P1Q_OWNER_LOGOUT_SUMMARY '+JSON.stringify({
        passed:report.passed,n:report.sampleCount,maxGoCancelMs:report.goLogoutMaxMs,
        wastedBytes:report.wastedBytes,causalConclusion:report.causalConclusion}))
      assert(report.passed,'P1Q original Owner cross-tab Logout signed Range gate failed')
      return
    }
    if (physicalP1Mode) {
      const median = key => rows.map(row=>key(row)).sort((a,b)=>a-b)[1]
      const summary = {
        status:'measured-CURRENT-Owner-115k-distinct-physical-CAS-routed-JPEG-H264-Live',
        accepted:rows.length===3 && rows.every(row=>row.passed &&
          row.ownerAuthenticated && row.physicalMode &&
          row.logicalAssets===100000 && row.physicalOriginals===115000 &&
          row.physicalReadbacks===12 && row.liveGroups===15000 &&
          row.viewport.narrow && row.viewport.width>=360 &&
          row.viewport.width<=390 && row.jpeg.returned.scrollDelta<=2 &&
          row.h264.restoredScrollDelta<=2 && row.live.restoredScrollDelta<=2),
        n:rows.length,logicalAssets:100000,physicalOriginals:115000,
        p50JpegOriginalMs:median(row=>row.jpeg.originalDecodedMs),
        p50H264PresentedMs:median(row=>row.h264.presentedMs),
        p50LiveHeldMs:median(row=>row.live.displayedMs),
        maxGoRSSGrowthBytes:Math.max(...rows.map(row=>row.resources.go.rssGrowthBytes)),
        maxRendererRSSGrowthBytes:Math.max(...rows.map(row=>row.resources.renderer.rssGrowthBytes)),
        samples:rows,
        causalConclusion:'NOT_ESTABLISHED',
        caveats:'Not a paired BEFORE/AFTER or iOS device result. Distinct physical CAS sources are small synthetic camera-like JPEG and BMFF containers with shared validated H264 bitstream, not 115k independent encodes, HEIC/HEVC, WAN, OS install/background/revocation or signed Range cancellation.',
      }
      fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n')
      console.log('PWA_P1P_PHYSICAL_115K_SUMMARY '+JSON.stringify({
        accepted:summary.accepted,n:summary.n,
        p50JpegOriginalMs:summary.p50JpegOriginalMs,
        p50H264PresentedMs:summary.p50H264PresentedMs,
        p50LiveHeldMs:summary.p50LiveHeldMs,
        causalConclusion:summary.causalConclusion,
      }))
      assert(summary.accepted,'P1P three independent physical Viewer sessions failed')
      return
    }
    const worst = rows.map(x => x.go.worstContextNotificationMs).sort((a, b) => a - b)
    const summary = {
      status: p1ViewerVideoAbortMode ? 'measured-P1-100k-real-Owner-Viewer-H264-Range-Go-cancel' : p1LiveMode ? 'measured-P1-100k-real-Owner-Live-hold-motion' : p1H264Mode ? 'measured-P1-100k-real-Owner-H264-presented-motion' : p1Mode ? 'measured-P1-100k-real-Owner-JPEG-Viewer-Back' : p0c2SPAMode ?
        'measured-CURRENT-P0-C2b2-authenticated-Files-Gallery-Files-SPA-Go-cancellation' :
        p0c2PageLeaveMode ?
        'measured-CURRENT-P0-C2b1-390px-Gallery-pageleave-Go-cancellation' :
        'measured-CURRENT-390px-Mobile-Web-Gallery-Go-cancellation',
      mobileCancelMode: true, cssWindowWidth:390, pageLeaveMode:p0c2PageLeaveMode,
      spaMode:p0c2SPAMode, p1ViewerBackMode:p1Mode, p1H264ViewerMode:p1H264Mode,
      p1LiveHoldMode:p1LiveMode, p1ViewerVideoAbortMode,
      p1ViewerRangeGoMaxMs:p1ViewerVideoAbortMode ? Math.max(...rows.map(x=>x.p1ViewerRangeAbort.goContextMaxMs)) : null,
      p1LivePresentedP50Ms:p1LiveMode ? rows.map(x=>x.p1LiveMotion.displayedMs).sort((a,b)=>a-b)[1] : null,
      p1H264PresentedP50Ms:p1H264Mode ? rows.map(x=>x.p1H264Frames.presentedMs).sort((a,b)=>a-b)[1] : null,
      p1OriginalDecodedP50Ms:p1Mode ? rows.map(x=>x.p1ViewerBack.originalDecodedMs).sort((a,b)=>a-b)[1] : null,
      sampleCount: rows.length, budgetMs: 160,
      worstGoContextP50Ms: worst[1], worstGoContextMaxMs: worst[2],
      passed: rows.length === 3 && rows.every(row =>
        (!p1ViewerVideoAbortMode || (row.p1ViewerRangeAbort?.passed===true &&
          row.p1ViewerRangeAbort.signedPartialContent>=1 &&
          row.p1ViewerRangeAbort.goContextDone>=1 &&
          row.p1ViewerRangeAbort.cancelledHandlers>=1 &&
          row.p1ViewerRangeAbort.stillActiveAt160Ms===0 &&
          row.p1ViewerRangeAbort.wastedBytesAfterViewerBack===0 &&
          row.p1ViewerRangeAbort.goContextMaxMs<=160 &&
          row.p1ViewerRangeAbort.sameCaller &&
          row.p1ViewerRangeAbort.sameDocument &&
          row.p1ViewerRangeAbort.sameHost && row.p1ViewerRangeAbort.sameGrid &&
          row.p1ViewerRangeAbort.restoredScrollDelta<=2)) &&
        (!p1LiveMode || (row.p1LiveMotion?.passed===true &&
          row.p1LiveMotion.deepFraction>=0.7 &&
          row.p1LiveMotion.mediaDeltaMs>5 &&
          row.p1LiveMotion.frameDelta>=1 &&
          row.p1LiveMotion.pausedOnRelease &&
          row.p1LiveMotion.stillAfterRelease &&
          row.p1LiveMotion.videoOpacityAfterRelease<=0.05 &&
          row.p1LiveMotion.sameCaller && row.p1LiveMotion.sameDocument &&
          row.p1LiveMotion.sameHost && row.p1LiveMotion.sameGrid &&
          row.p1LiveMotion.restoredScrollDelta<=2)) &&
        (!p1H264Mode || (row.p1H264Frames?.passed===true &&
          row.p1H264Frames.deepFraction>=0.7 &&
          row.p1H264Frames.presentedMs>0 &&
          row.p1H264Frames.presentedMs<=60000 &&
          row.p1H264Frames.presentedFrameDelta>=1 &&
          row.p1H264Frames.frameMediaDeltaMs>5 &&
          row.p1H264Frames.sameCaller && row.p1H264Frames.sameDocument &&
          row.p1H264Frames.sameHost && row.p1H264Frames.sameGrid &&
          row.p1H264Frames.restoredScrollDelta<=2)) &&
        (!p1Mode || (row.p1ViewerBack?.passed === true && row.p1ViewerBack.depth >= 0.7 &&
          row.p1ViewerBack.originalDecodedMs > 0 && row.p1ViewerBack.originalDecodedMs <= 30000 &&
          row.p1ViewerBack.returnMs > 0 && row.p1ViewerBack.returnMs <= 20000 &&
          row.p1ViewerBack.returned.sameCaller && row.p1ViewerBack.returned.sameDocument &&
          row.p1ViewerBack.returned.sameHost && row.p1ViewerBack.returned.sameGrid)) &&
        (!p0c2SPAMode || (row.spaMode === true &&
          row.scroll.kind === 'same-document-app-route' &&
          row.scroll.sameMainBefore === true && row.scroll.sameMainAfter === true &&
          row.scroll.sameDocumentAfter === true &&
          row.scroll.galleryMountedBefore === true &&
          row.scroll.galleryUnmounted === true)) &&
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
      limits: p1ViewerVideoAbortMode ? 'n3 real Owner 390px 100k Gallery signed H264 preview Range in actual Viewer, native Back unmount -> Go Context.Done <=160ms with 0 stale response bytes and same virtual grid/anchor. Reuses original JPEG/H264/Live checks. NOT owner switch, installed iOS or full 115k physical CAS' : p1LiveMode ? 'n3 authentic 390px Owner 100k Live still + real signed motion CAS, held pointer via shared LivePhotoSurface RVFC two advancing frames, release pause/restore, Viewer Back exact virtual anchor; parent H264/JPEG/Go Abort gates retained, not physical iOS touch or full 115k physical files' : p1H264Mode ? 'n3 real authenticated 390px 100k Gallery -> original H264 Viewer, requestVideoFrameCallback two advancing frames after play(), Back same document/deep anchor; preserves original 4-6 Go JPEG abort under 160ms and zero bytes. NOT Live motion, actual iOS/installed PWA, full CAS or video Range abort' : p1Mode ? 'n3 actual 390px Owner 100k Gallery JPEG Viewer decoded original + Back to exact virtual anchor, original Go abort <=160ms; NOT dynamic video/Live, physical iOS, or 115k physical CAS' : p0c2SPAMode ?
        'Actual Web App.tsx real Files→Gallery→Files same-document route click in Chromium 390px, true Go/Gin/PG17/CAS, 100k logical Gallery/115k nodes, 4-6 active JPEG requests, exact Context.Done + RSS/CPU; not iPhone/Safari, 100k independent originals or durable transfer.' :
        p0c2PageLeaveMode ?
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
