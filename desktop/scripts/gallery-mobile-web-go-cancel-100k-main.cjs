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
assert(!p1H264Mode || p1Mode,
  'H264 presented-frame mode requires real Owner P1 Gallery Viewer')
assert(!p1Mode || p0c2SPAMode, 'P1 authentic Owner Viewer requires SPA mode')
assert(!(p0c2PageLeaveMode && p0c2SPAMode), 'P0-C2 document-leave and SPA workloads must be independent')
const out = path.join(__dirname, '..', p1H264Mode ? 'pwa-p1-owner-100k-h264-viewer-results' : p1Mode ? 'pwa-p1-owner-100k-viewer-back-results' : p0c2SPAMode ?
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
    excluded:'iOS Safari installed, Live Motion hold, 115k full CAS, Go video Range cancel',
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
    const p1ViewerBack = p1Mode ? await p1MeasureRealViewerBack(win) : null
    const p1H264Frames = p1H264Mode ? await p1MeasureRealH264ViewerMotion(win) : null
    const row = {
      sample, viewport, streamCount, resources, logicalAssets: 100000, physicalNodes: 115000,
      firstImageNodes: fixture.config.first_image_nodes,
      seedMsExcluded: fixture.config.seed_ms,
      scroll, healthy, p1ViewerBack, p1H264Frames, pageLeaveMode:p0c2PageLeaveMode, spaMode:p0c2SPAMode,
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
    const worst = rows.map(x => x.go.worstContextNotificationMs).sort((a, b) => a - b)
    const summary = {
      status: p1H264Mode ? 'measured-P1-100k-real-Owner-H264-presented-motion' : p1Mode ? 'measured-P1-100k-real-Owner-JPEG-Viewer-Back' : p0c2SPAMode ?
        'measured-CURRENT-P0-C2b2-authenticated-Files-Gallery-Files-SPA-Go-cancellation' :
        p0c2PageLeaveMode ?
        'measured-CURRENT-P0-C2b1-390px-Gallery-pageleave-Go-cancellation' :
        'measured-CURRENT-390px-Mobile-Web-Gallery-Go-cancellation',
      mobileCancelMode: true, cssWindowWidth:390, pageLeaveMode:p0c2PageLeaveMode,
      spaMode:p0c2SPAMode, p1ViewerBackMode:p1Mode, p1H264ViewerMode:p1H264Mode,
      p1H264PresentedP50Ms:p1H264Mode ? rows.map(x=>x.p1H264Frames.presentedMs).sort((a,b)=>a-b)[1] : null,
      p1OriginalDecodedP50Ms:p1Mode ? rows.map(x=>x.p1ViewerBack.originalDecodedMs).sort((a,b)=>a-b)[1] : null,
      sampleCount: rows.length, budgetMs: 160,
      worstGoContextP50Ms: worst[1], worstGoContextMaxMs: worst[2],
      passed: rows.length === 3 && rows.every(row =>
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
      limits: p1H264Mode ? 'n3 real authenticated 390px 100k Gallery -> original H264 Viewer, requestVideoFrameCallback two advancing frames after play(), Back same document/deep anchor; preserves original 4-6 Go JPEG abort under 160ms and zero bytes. NOT Live motion, actual iOS/installed PWA, full CAS or video Range abort' : p1Mode ? 'n3 actual 390px Owner 100k Gallery JPEG Viewer decoded original + Back to exact virtual anchor, original Go abort <=160ms; NOT dynamic video/Live, physical iOS, or 115k physical CAS' : p0c2SPAMode ?
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
