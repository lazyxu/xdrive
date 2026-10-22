'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawn, execFileSync} = require('node:child_process')
const {performance} = require('node:perf_hooks')
const {app, BrowserWindow} = require('electron')

const root = path.resolve(__dirname, '../..')
const webDist = path.join(root, 'web', 'dist')
const mobileMode = process.env.XD_GALLERY_WEB_PHYSICAL_MOBILE_100K_PERF === '1'
const output = path.resolve(process.env.XD_GALLERY_WEB_PHYSICAL_VIEWPORT_RESULTS ||
  path.join(root, 'desktop', mobileMode ? 'gallery-mobile-web-physical-mixed-100k-results' : 'gallery-web-physical-mixed-100k-results'))
const goBinary = path.resolve(process.env.XD_GALLERY_WEB_PHYSICAL_GO_BINARY || '')
const fractions = [0, 0.25, 0.5, 0.75, 0.95]
const maxFirstSixMs = 20000
assert.equal(process.env.XD_PWA_P2A_CURRENT_BEFORE,'1','explicit P2-A baseline-only opt-in required')
const maxRSSGrowth = 256 * 1024 * 1024
const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], {encoding:'utf8'}).trim())
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]
const percentile = (values,q) => {
  assert(values.length && values.every(v=>Number.isFinite(v)&&v>=0))
  const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*q
  const lo=Math.floor(at),hi=Math.ceil(at)
  return Number((sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo)).toFixed(3))
}
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('enable-precise-memory-info')

async function until(check, timeoutMs, label) {
  const start = performance.now()
  while(performance.now() - start < timeoutMs) {
    const found = await check()
    if(found) return found
    await delay(50)
  }
  throw Error('timeout waiting for ' + label)
}
function nativeStats(pid) {
  const status = fs.readFileSync('/proc/' + pid + '/status','utf8')
  const rss = status.match(/^VmRSS:\s+(\d+) kB/m)
  const stat = fs.readFileSync('/proc/' + pid + '/stat','utf8')
  const fields = stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)
  const cpuTicks = Number(fields[11]) + Number(fields[12])
  assert(rss && Number.isFinite(cpuTicks) && ticksPerSecond > 0,
    'native Go process RSS and CPU missing')
  return {rssBytes:Number(rss[1])*1024, cpuMs:cpuTicks*1000/ticksPerSecond}
}
function rendererWorkingSet() {
  const process = app.getAppMetrics().find(p=>p.type==='Tab') ||
    app.getAppMetrics().find(p=>p.type==='Renderer')
  const kib = process?.memory?.workingSetSize
  assert(Number.isFinite(kib) && kib > 0, 'real Chromium Renderer working set missing')
  return kib * 1024
}
async function startNative(sample, readyFile) {
  const log = fs.createWriteStream(path.join(output, 'native-go-'+sample+'.log'))
  const child = spawn(goBinary,[
    '-test.run=^TestGalleryRealWebColdFixture100K$',
    '-test.count=1','-test.timeout=20m','-test.v'
  ],{cwd:root,env:{
    ...process.env,
    XD_GALLERY_REAL_WEB_COLD_PERF:'1',
    XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF:'1',
    XD_GALLERY_REAL_WEB_DIST:webDist,
    XD_GALLERY_REAL_WEB_READY_FILE:readyFile,
  },stdio:['ignore','pipe','pipe']})
  child.stdout.pipe(log,{end:false})
  child.stderr.pipe(log,{end:false})
  child.on('error',err=>log.write('SPAWN ERROR '+String(err)+'\n'))
  const exited = new Promise(resolve=>child.once('exit',(code,signal)=>{
    log.end();resolve({code,signal})
  }))
  try{
    const info = await until(()=>{
      if(child.exitCode !== null) throw Error('real Go mixed 100k fixture exited before ready')
      return fs.existsSync(readyFile) ?
        JSON.parse(fs.readFileSync(readyFile,'utf8')) : null
    },12*60*1000,'115k distinct CAS source preparation')
    assert.equal(info.logical_assets,100000)
    assert.equal(info.physical_nodes,115000)
    assert.equal(info.live_photo_groups,15000)
    assert.equal(info.physical_mode,true)
    assert.equal(info.physical_sources,115000)
    assert.equal(info.physical_bytes,149285128)
    assert.equal(info.physical_verified,12)
    return {child,exited,info}
  }catch(error){
    child.kill('SIGTERM')
    throw error
  }
}
async function stopNative(fixture){
  if(!fixture)return
  try{await fetch(fixture.info.url+'/__perf/stop',{method:'POST'})}catch(_){}
  const ended=await Promise.race([
    fixture.exited,delay(60000).then(()=>({code:'timeout'}))
  ])
  if(ended.code!==0){
    fixture.child.kill('SIGKILL')
    throw Error('real fixture did not finish cleanly: '+JSON.stringify(ended))
  }
}
async function readJSON(url) {
  const response=await fetch(url,{cache:'no-store'})
  assert.equal(response.status,200,'native Go performance HTTP stats missing')
  return response.json()
}
// Functions below execute inside the REAL Web Chromium renderer on the
// production shared XDriveMediaGalleryPage / MediaVirtualGrid DOM.
function moveNativeGalleryScroll(fraction){
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  if(!grid)return {error:'production shared Gallery VirtualGrid missing'}
  let host=grid.parentElement
  while(host){
    if(/(auto|scroll|overlay)/.test(getComputedStyle(host).overflowY) &&
      host.scrollHeight-host.clientHeight>10000)break
    host=host.parentElement
  }
  if(!host)return {error:'real Gallery 100k scrolling ancestor missing'}
  const extent=host.scrollHeight-host.clientHeight
  host.scrollTop=Math.floor(fraction*extent)
  host.dispatchEvent(new Event('scroll'))
  return {fraction,extent,scrollTop:host.scrollTop,viewportHeight:host.clientHeight}
}
function snapshotActualGallery(){
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  if(!grid)return {error:'production shared Gallery VirtualGrid absent'}
  let host=grid.parentElement
  while(host){
    if(/(auto|scroll|overlay)/.test(getComputedStyle(host).overflowY) &&
      host.scrollHeight-host.clientHeight>10000)break
    host=host.parentElement
  }
  if(!host)return {error:'real 100k scrolling ancestor vanished'}
  const clip=host.getBoundingClientRect()
  const tiles=Array.from(grid.querySelectorAll('[data-xdrive-media-tile]'))
  const decoded=[]
  let visibleTiles=0
  for(const tile of tiles){
    const box=tile.getBoundingClientRect()
    if(box.bottom<=clip.top||box.top>=clip.bottom)continue
    visibleTiles++
    const img=tile.querySelector('img')
    if(!(img instanceof HTMLImageElement) || !img.complete ||
       img.naturalWidth<=0 || img.naturalHeight<=0 ||
       !(img.currentSrc||img.src).startsWith('blob:'))continue
    const index=Number(tile.getAttribute('data-xdrive-media-index'))
    if(Number.isSafeInteger(index)&&index>=0&&index<100000)
      decoded.push({index,source:img.currentSrc,naturalWidth:img.naturalWidth})
  }
  return {mounted:tiles.length,visibleTiles,decoded,extent:host.scrollHeight-host.clientHeight,
    scrollTop:host.scrollTop,viewportHeight:host.clientHeight}
}
async function decodeAndPaint(win,indices,required=6){
  const script='(async()=>{'+
    'const selected=new Set('+JSON.stringify(indices)+');'+
    'const grid=document.querySelector("[data-xdrive-media-gallery-virtual-grid]");'+
    'if(!grid)throw Error("VirtualGrid disappeared before real image decode");'+
    'const imgs=Array.from(grid.querySelectorAll("[data-xdrive-media-tile]")).filter(t=>'+
    'selected.has(Number(t.getAttribute("data-xdrive-media-index")))).map(t=>t.querySelector("img"));'+
    'if(imgs.length<'+required+')throw Error("fewer than required new real blob JPEG images");'+
    'await Promise.all(imgs.slice(0,'+required+').map(x=>x.decode()));'+
    'await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));'+
    'return imgs.slice(0,'+required+').every(x=>x.complete&&x.naturalWidth>0&&x.naturalHeight>0);'+
    '})()'
  return win.webContents.executeJavaScript(script,true)
}

async function mobileFirstViewportDiagnostics(window,fixture,sample,fraction,reason){
  try{
    const dom=await window.webContents.executeJavaScript(
      '('+function(){
        const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
        const tiles=Array.from(grid?.querySelectorAll('[data-xdrive-media-tile]')||[])
        const first=tiles.slice(0,18).map(tile=>{
          const img=tile.querySelector('img')
          const box=tile.getBoundingClientRect()
          return {index:tile.getAttribute('data-xdrive-media-index'),
            y:Math.round(box.y),height:Math.round(box.height),visible:box.bottom>0&&box.top<innerHeight,
            complete:Boolean(img?.complete),decoded:Boolean(img?.naturalWidth),
            srcKind:(img?.currentSrc||img?.src||'').slice(0,15)}
        })
        return {width:innerWidth,height:innerHeight,tiles:tiles.length,first,
          gallery:Boolean(grid),body:document.body?.innerText?.slice(0,300)}
      }.toString()+')()',true)
    const http=await readJSON(fixture.info.url+'/__perf/physical-thumbnail-stats')
    console.error('GALLERY_MOBILE_PHYSICAL_100K_DIAGNOSTIC '+JSON.stringify({
      sample,fraction,reason:String(reason),dom,http}))
  }catch(error){console.error('GALLERY_MOBILE_PHYSICAL_100K_DIAGNOSTIC_FAILED '+String(error))}
}
async function oneSession(sample,tmp){
  let fixture=null,window=null,sampler=null
  const failures=[]
  try{
    fixture=await startNative(sample,path.join(tmp,'ready-'+sample+'.json'))
    const baselineGo=nativeStats(fixture.child.pid)
    let peakGoRSS=baselineGo.rssBytes
    sampler=setInterval(()=>{
      try{peakGoRSS=Math.max(peakGoRSS,nativeStats(fixture.child.pid).rssBytes)}catch(_){}
    },25)
    let before=await readJSON(fixture.info.url+'/__perf/physical-thumbnail-stats')
    window=new BrowserWindow({show:true,width:mobileMode ? 390 : 1440,height:mobileMode ? 844 : 900,
      webPreferences:{partition:'xdrive-physical-'+(mobileMode ? 'mobile' : 'web')+'-gallery-'+sample,
        contextIsolation:true,nodeIntegration:false,sandbox:false,webSecurity:true,
        backgroundThrottling:false}})
    window.webContents.on('render-process-gone',(_event,state)=>
      failures.push('Renderer disappeared: '+JSON.stringify(state)))
    window.webContents.on('did-fail-load',(_event,code,message)=>
      failures.push('Web bundle failed: '+code+': '+message))
    const navigationStart=performance.now()
    await window.loadURL(fixture.info.url+
      '/?xdriveGalleryRealCold=1&xdriveRealViewportCancel=1&xdriveMediaProgress=off')
    // CSS-narrow Mobile Web app shell must use the actual shared virtual Gallery Grid.
    const viewport=await window.webContents.executeJavaScript(
      '({width:window.innerWidth,height:window.innerHeight,narrow:window.matchMedia("(max-width:899.95px)").matches})',true)
    if(mobileMode)assert(viewport.narrow&&viewport.width>=360&&viewport.width<=390&&
      viewport.height>=700,'actual 390px mobile Web viewport did not activate: '+JSON.stringify(viewport))
    const initialWS=rendererWorkingSet()
    // Native loadURL resolves before the React Gallery has necessarily
    // committed the real Grid. Mount readiness is still charged against the
    // original navigation-to-six-decodes <=20s deadline, never prewarmed.
    await until(async()=>{
      if(failures.length)throw Error(failures.join('; '))
      const state=await window.webContents.executeJavaScript(
        '('+snapshotActualGallery.toString()+')()',true)
      return !state.error && state.extent>10000 ? state : null
    },maxFirstSixMs,'native mounted Gallery Grid and scroll host (inside first-view stopwatch)')
    let maxWS=initialWS
    const seen=new Set()
    const views=[]
    for(const fraction of fractions){
      const since=fraction===0?navigationStart:performance.now()
      const scroll=await window.webContents.executeJavaScript(
        '('+moveNativeGalleryScroll.toString()+')('+fraction+')',true)
      assert(!scroll.error,'real Gallery grid scroll unavailable: '+JSON.stringify(scroll))
      assert(scroll.extent>10000 && scroll.scrollTop>=0)
      const state=await until(async()=>{
        if(failures.length)throw Error(failures.join('; '))
        const view=await window.webContents.executeJavaScript(
          '('+snapshotActualGallery.toString()+')()',true)
        if(view.error)throw Error(view.error)
        if(view.mounted>=1000)throw Error('unbounded Web Gallery mounted tile count: '+view.mounted)
        const fresh=view.decoded.filter(x=>!seen.has(x.index))
        // A 390px Mobile Web viewport can hold only about five visible tiles;
        // a six-image visibility requirement is geometrically invalid here.
        // The original 1440px Web workload still requires six new images.
        const enough=mobileMode ? (view.visibleTiles>=4&&fresh.length>=4) : fresh.length>=6
        return enough?{...view,fresh}:null
      },maxFirstSixMs,(mobileMode?'4':'6')+' never-before-viewed authentic Blob JPEG images at '+fraction)
      const requiredFresh=mobileMode?4:6
      const freshIDs=state.fresh.slice(0,requiredFresh).map(x=>x.index)
      assert(await decodeAndPaint(window,freshIDs,requiredFresh),'real decoded images / two animation frames failed')
      const measuredMs=performance.now()-since
      assert(measuredMs<=maxFirstSixMs,'Web Gallery physical 100k viewport exceeded frozen 20s')
      for(const item of state.decoded)seen.add(item.index)
      const http=await readJSON(fixture.info.url+'/__perf/physical-thumbnail-stats')
      const store=await readJSON(fixture.info.url+'/__perf/stats')
      assert(http.started>before.started,'new Grid viewport generated no actual thumbnail HTTP requests')
      assert(http.response_bytes>before.response_bytes,'Grid viewport served no actual CAS thumbnail bytes')
      assert.equal(http.failed,0,'non-cancelled real thumbnail HTTP failure')
      assert(http.max_active<=6,'native Gin thumbnail peak exceeded six bounded handlers')
      const firstVisitHTTP={requests:http.started-before.started,
        responseBodyBytes:http.response_bytes-before.response_bytes}
      assert(firstVisitHTTP.requests>0&&firstVisitHTTP.responseBodyBytes>0,
        'first-time visible Owner thumbnails require genuine HTTP/CAS transfer')
      before=http
      maxWS=Math.max(maxWS,rendererWorkingSet())
      const row={fraction,scroll,
        firstSixDecodedAndTwoFramesMs:mobileMode?null:measuredMs,
        firstFourDecodedAndTwoFramesMs:mobileMode?measuredMs:null,
        firstFreshDecodedAndTwoFramesMs:measuredMs,requiredFresh,
        freshDecodedIndices:freshIDs,mountedTiles:state.mounted,
        visibleTileCount:state.visibleTiles,
        visibleDecodedBlobImages:state.decoded.length,firstVisitHTTP,http,store,
        rendererWSBytes:maxWS}
      views.push(row)
      console.log('GALLERY_WEB_PHYSICAL_100K_VIEW '+JSON.stringify({sample,...row}))
    }

    // P2-A CURRENT/BEFORE: reuse exact visible IDs after five distant views.
    // No P2 persistent cache, no prefetch, no change to actual Gallery/Go.
    // A revisit may legitimately use the existing in-memory object URL cache.
    const revisits=[]
    for(const first of [views[0],views[2],views[4]]) {
      const indices=first.freshDecodedIndices
      assert.equal(indices.length,mobileMode?4:6)
      const httpBefore=await readJSON(fixture.info.url+'/__perf/physical-thumbnail-stats')
      const began=performance.now()
      const scroll=await window.webContents.executeJavaScript(
        '('+moveNativeGalleryScroll.toString()+')('+first.fraction+')',true)
      assert(!scroll.error,'physical Gallery revisit scroll failed')
      const found=await until(async()=>{
        if(failures.length)throw Error(failures.join('; '))
        const view=await window.webContents.executeJavaScript(
          '('+snapshotActualGallery.toString()+')()',true)
        if(view.error)throw Error(view.error)
        if(view.mounted>=1000)throw Error('revisit mounted unbounded Gallery tiles')
        return indices.every(id=>view.decoded.some(node=>node.index===id))?view:null
      },maxFirstSixMs,'revisited exact original visible node indices at '+first.fraction)
      assert(await decodeAndPaint(window,indices,indices.length),
        'same physical JPEG/Live-still bytes must decode and paint')
      const elapsed=performance.now()-began
      const httpAfter=await readJSON(fixture.info.url+'/__perf/physical-thumbnail-stats')
      const requests=httpAfter.started-httpBefore.started
      const responseBodyBytes=httpAfter.response_bytes-httpBefore.response_bytes
      assert(requests>=0&&responseBodyBytes>=0,'HTTP counters must be monotonic')
      assert(httpAfter.failed===0&&httpAfter.max_active<=6,
        'revisit must preserve authenticated Go HTTP/concurrency contract')
      assert(elapsed<=maxFirstSixMs,'revisited same-node image decode exceeded fixed 20s budget')
      maxWS=Math.max(maxWS,rendererWorkingSet())
      const row={fraction:first.fraction,exactSameIndices:indices,
        firstVisitMs:first.firstFreshDecodedAndTwoFramesMs,
        revisitDecodedAndTwoFramesMs:elapsed,firstVisitHTTP:first.firstVisitHTTP,
        revisitHTTP:{requests,responseBodyBytes},
        mountedTiles:found.mounted,visibleTiles:found.visibleTiles,
        httpCounters:httpAfter}
      revisits.push(row)
      console.log('PWA_P2A_100K_REVISIT_CURRENT '+JSON.stringify({sample,...row}))
    }
    const originStorage=await window.webContents.executeJavaScript(
      '(async()=>{try{if(!navigator.storage?.estimate)return null;'+
      'const e=await navigator.storage.estimate();return {'+
      'usageBytes:Number.isFinite(e.usage)?e.usage:null,'+
      'quotaBytes:Number.isFinite(e.quota)?e.quota:null};}catch{return null}})()',true)
    clearInterval(sampler);sampler=null
    const finalGo=nativeStats(fixture.child.pid)
    assert(views.length===5&&seen.size>=(mobileMode?20:30),'five independent physical-image windows missing')
    assert(maxWS-initialWS<=maxRSSGrowth,'Chromium Renderer WS growth over 256MiB')
    assert(peakGoRSS-baselineGo.rssBytes<=maxRSSGrowth,'native Go post-seed RSS growth over 256MiB')
    assert(finalGo.cpuMs>=baselineGo.cpuMs,'Go process CPU sampling invalid')
    const result={
      sample,mobileViewport:mobileMode,viewport,
      workload: mobileMode
        ? '100k-logical-115k-physical-mixed-Mobile-Web-390px-shared-Gallery-five-Grid-viewports'
        : '100k-logical-115k-physical-mixed-actual-Web-Gallery-five-Grid-viewports',
      physicalOriginals:fixture.info.physical_sources,
      physicalOriginalBytes:fixture.info.physical_bytes,
      seedMsExcluded:fixture.info.seed_ms,
      distinctDecodedVisibleIndices:seen.size,views,revisits,originStorage,
      fiveViewportP50Ms:median(views.map(x=>x.firstFreshDecodedAndTwoFramesMs)),
      go:{initial:baselineGo,final:finalGo,sampledPeakRSSBytes:peakGoRSS,
        RSSGrowthBytes:Math.max(0,peakGoRSS-baselineGo.rssBytes),
        cpuDeltaMs:finalGo.cpuMs-baselineGo.cpuMs},
      chromium:{firstWSBytes:initialWS,peakWSBytes:maxWS,
        growthBytes:maxWS-initialWS},
      limitations:mobileMode
        ? 'Native Chromium/Electron 390px Mobile Web app shell and shared Gallery Grid + API + 115k different physical CAS, four newly visible JPEG/Live stills decoded + two rAF per viewport; physical mobile screen has fewer visible media tiles than 1440px desktop. NOT physical iOS/Android, video/Live motion playback, RAW/HEVC, Desktop Agent, Timeline, WAN'
        : 'real Web Gallery Grid + API + 115k different physical CAS with new visible JPEG/Live stills decoded and two rAF only; NOT 100k independent H264 encodes, video/Live motion playback, RAW/HEVC, Desktop Main/Agent, Timeline, physical mobile or WAN'
    }
    fs.writeFileSync(path.join(output,'sample-'+sample+'.json'),
      JSON.stringify(result,null,2)+'\n')
    console.log('GALLERY_WEB_PHYSICAL_100K_SAMPLE '+JSON.stringify(result))
    return result
  }catch(error){
    if(mobileMode && fixture && window && !window.isDestroyed())
      await mobileFirstViewportDiagnostics(window,fixture,sample,0,error)
    throw error
  }finally{
    if(sampler)clearInterval(sampler)
    if(window&&!window.isDestroyed())window.destroy()
    if(fixture)await stopNative(fixture)
  }
}
async function main(){
  assert(process.env.XD_TEST_DATABASE_URL,'native PostgreSQL URL required')
  assert(process.env.XD_GALLERY_WEB_PHYSICAL_GO_BINARY,'native Go binary path required')
  assert(fs.existsSync(goBinary),'compiled real Go fixture executable missing')
  assert(fs.existsSync(path.join(webDist,'index.html')),'real Web bundle not built')
  fs.mkdirSync(output,{recursive:true})
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-100k-physical-web-'))
  try{
    await app.whenReady()
    const samples=[]
    for(let sample=1;sample<=3;sample++)samples.push(await oneSession(sample,tmp))
    const summary={
      status:'pwa-p2a-current-before-only-no-private-thumbnail-persistence',
      sourceSha:process.env.XD_PR_HEAD||null,
      chromiumVersion:process.versions.chrome||null,
      electronVersion:process.versions.electron||null,
      mobileMode,cssViewportWidth:mobileMode ? 390 : 1440,
      samples,n:3,logicalCount:100000,physicalOriginals:115000,
      medianOfFixtureFiveViewportP50Ms:median(samples.map(x=>x.fiveViewportP50Ms)),
      firstVisitP50Ms:percentile(samples.flatMap(s=>s.revisits.map(r=>r.firstVisitMs)),0.5),
      firstVisitP95Ms:percentile(samples.flatMap(s=>s.revisits.map(r=>r.firstVisitMs)),0.95),
      revisitP50Ms:percentile(samples.flatMap(s=>s.revisits.map(r=>r.revisitDecodedAndTwoFramesMs)),0.5),
      revisitP95Ms:percentile(samples.flatMap(s=>s.revisits.map(r=>r.revisitDecodedAndTwoFramesMs)),0.95),
      firstVisitServerThumbnailBodyBytes:samples.reduce((a,s)=>a+s.revisits.reduce((n,r)=>n+r.firstVisitHTTP.responseBodyBytes,0),0),
      revisitServerThumbnailBodyBytes:samples.reduce((a,s)=>a+s.revisits.reduce((n,r)=>n+r.revisitHTTP.responseBodyBytes,0),0),
      revisitHTTPRequests:samples.reduce((a,s)=>a+s.revisits.reduce((n,r)=>n+r.revisitHTTP.requests,0),0),
      matchedPairedWindows:9,afterOptimization:null,
      maxRendererWorkingSetGrowthBytes:Math.max(...samples.map(x=>x.chromium.growthBytes)),
      maxNativeGoRSSGrowthBytes:Math.max(...samples.map(x=>x.go.RSSGrowthBytes)),
      peakHTTPThumbnailHandlers:Math.max(...samples.flatMap(s=>s.views.map(v=>v.http.max_active))),
      accepted:samples.length===3&&samples.every(s=>s.revisits.length===3&&
        s.revisits.every(r=>r.exactSameIndices.length===(mobileMode?4:6)&&
          r.revisitHTTP.requests>=0&&r.revisitHTTP.responseBodyBytes>=0&&
          r.revisitDecodedAndTwoFramesMs<=maxFirstSixMs))&&
        samples.every(s=>s.views.length===5&&
        s.distinctDecodedVisibleIndices>=(mobileMode?20:30)&&
        s.go.RSSGrowthBytes<=maxRSSGrowth&&s.chromium.growthBytes<=maxRSSGrowth&&
        s.views.every(v=>v.mountedTiles>0&&v.mountedTiles<1000&&
          v.firstFreshDecodedAndTwoFramesMs<=maxFirstSixMs&&
          v.visibleTileCount>=(mobileMode?4:6)&&
          v.visibleDecodedBlobImages>=(mobileMode?4:6)&&v.http.max_active<=6&&
          v.http.failed===0&&v.http.response_bytes>0)) &&
        (!mobileMode || samples.every(s=>s.mobileViewport && s.viewport.narrow &&
          s.viewport.width>=360 && s.viewport.width<=390)),
      limits:mobileMode ? '390px mobile 0/25/50/75/95%; first-four NEW visible blob JPEG/Live still decode + 2 rAF <=20s per viewport, visible tiles>=4, mounted<1000, HTTP concurrency<=6, Renderer/Go post-seed RSS<=256MiB' : 'five positions 0/25/50/75/95%; first-six fresh blob JPEG decode + 2 rAF <=20s, mounted<1000, HTTP concurrency<=6, Renderer/Go after-seed RSS growth<=256MiB',
      p2aCaveat:'Same-process exact-node 100k historical thumbnail revisit before any private offline thumbnail persistence. Authenticated Gin/CAS response-body bytes, not all TCP wire bytes; no iOS Safari, process-restart cache, full video/Live motion, or optimization AFTER.',
      caveats:mobileMode
        ? 'Mobile Web 390px Chromium App Frame only; not physical iOS/Android; four decoded NEW JPEG/Live stills per viewport with two rAF (at least four visible tiles confirmed); no H264/Live motion browser playback, RAW/HEVC/LIVP, Timeline, Desktop Agent, WAN or durable task cancellation. CURRENT only, AFTER=N/A.'
        : 'No matching production BEFORE/AFTER, no validated video H264/Live motion browser playback, RAW/HEVC/LIVP, Timeline, Desktop Agent, WAN or durable task cancellation'
    }
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n')
    console.log('GALLERY_WEB_PHYSICAL_100K_SUMMARY '+JSON.stringify(summary))
    assert(summary.accepted,'real physical mixed Gallery Web CURRENT qualification failed')
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
main().then(()=>app.exit(0)).catch(error=>{
  console.error('GALLERY_WEB_PHYSICAL_100K_ERROR '+(error?.stack||String(error)))
  app.exit(1)
})
