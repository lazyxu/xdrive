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
const output = path.resolve(process.env.XD_GALLERY_WEB_PHYSICAL_VIEWPORT_RESULTS ||
  path.join(root, 'desktop', 'gallery-web-physical-mixed-100k-results'))
const goBinary = path.resolve(process.env.XD_GALLERY_WEB_PHYSICAL_GO_BINARY || '')
const fractions = [0, 0.25, 0.5, 0.75, 0.95]
const maxFirstSixMs = 20000
const maxRSSGrowth = 256 * 1024 * 1024
const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], {encoding:'utf8'}).trim())
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]
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
  for(const tile of tiles){
    const box=tile.getBoundingClientRect()
    if(box.bottom<=clip.top||box.top>=clip.bottom)continue
    const img=tile.querySelector('img')
    if(!(img instanceof HTMLImageElement) || !img.complete ||
       img.naturalWidth<=0 || img.naturalHeight<=0 ||
       !(img.currentSrc||img.src).startsWith('blob:'))continue
    const index=Number(tile.getAttribute('data-xdrive-media-index'))
    if(Number.isSafeInteger(index)&&index>=0&&index<100000)
      decoded.push({index,source:img.currentSrc,naturalWidth:img.naturalWidth})
  }
  return {mounted:tiles.length,decoded,extent:host.scrollHeight-host.clientHeight,
    scrollTop:host.scrollTop,viewportHeight:host.clientHeight}
}
async function decodeAndPaint(win,indices){
  const script='(async()=>{'+
    'const selected=new Set('+JSON.stringify(indices)+');'+
    'const grid=document.querySelector("[data-xdrive-media-gallery-virtual-grid]");'+
    'if(!grid)throw Error("VirtualGrid disappeared before real image decode");'+
    'const imgs=Array.from(grid.querySelectorAll("[data-xdrive-media-tile]")).filter(t=>'+
    'selected.has(Number(t.getAttribute("data-xdrive-media-index")))).map(t=>t.querySelector("img"));'+
    'if(imgs.length<6)throw Error("fewer than six fresh real blob JPEG images");'+
    'await Promise.all(imgs.slice(0,6).map(x=>x.decode()));'+
    'await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));'+
    'return imgs.slice(0,6).every(x=>x.complete&&x.naturalWidth>0&&x.naturalHeight>0);'+
    '})()'
  return win.webContents.executeJavaScript(script,true)
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
    window=new BrowserWindow({show:true,width:1440,height:900,
      webPreferences:{partition:'xdrive-physical-web-gallery-'+sample,
        contextIsolation:true,nodeIntegration:false,sandbox:false,webSecurity:true,
        backgroundThrottling:false}})
    window.webContents.on('render-process-gone',(_event,state)=>
      failures.push('Renderer disappeared: '+JSON.stringify(state)))
    window.webContents.on('did-fail-load',(_event,code,message)=>
      failures.push('Web bundle failed: '+code+': '+message))
    const navigationStart=performance.now()
    await window.loadURL(fixture.info.url+
      '/?xdriveGalleryRealCold=1&xdriveRealViewportCancel=1&xdriveMediaProgress=off')
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
        return fresh.length>=6?{...view,fresh}:null
      },maxFirstSixMs,'6 never-before-viewed authentic Blob JPEG images at '+fraction)
      const freshIDs=state.fresh.slice(0,6).map(x=>x.index)
      assert(await decodeAndPaint(window,freshIDs),'real decoded images / two animation frames failed')
      const measuredMs=performance.now()-since
      assert(measuredMs<=maxFirstSixMs,'Web Gallery physical 100k viewport exceeded frozen 20s')
      for(const item of state.decoded)seen.add(item.index)
      const http=await readJSON(fixture.info.url+'/__perf/physical-thumbnail-stats')
      const store=await readJSON(fixture.info.url+'/__perf/stats')
      assert(http.started>before.started,'new Grid viewport generated no actual thumbnail HTTP requests')
      assert(http.response_bytes>before.response_bytes,'Grid viewport served no actual CAS thumbnail bytes')
      assert.equal(http.failed,0,'non-cancelled real thumbnail HTTP failure')
      assert(http.max_active<=6,'native Gin thumbnail peak exceeded six bounded handlers')
      before=http
      maxWS=Math.max(maxWS,rendererWorkingSet())
      const row={fraction,scroll,firstSixDecodedAndTwoFramesMs:measuredMs,
        freshDecodedIndices:freshIDs,mountedTiles:state.mounted,
        visibleDecodedBlobImages:state.decoded.length,http,store,
        rendererWSBytes:maxWS}
      views.push(row)
      console.log('GALLERY_WEB_PHYSICAL_100K_VIEW '+JSON.stringify({sample,...row}))
    }
    clearInterval(sampler);sampler=null
    const finalGo=nativeStats(fixture.child.pid)
    assert(views.length===5&&seen.size>=30,'five independent physical-image windows missing')
    assert(maxWS-initialWS<=maxRSSGrowth,'Chromium Renderer WS growth over 256MiB')
    assert(peakGoRSS-baselineGo.rssBytes<=maxRSSGrowth,'native Go post-seed RSS growth over 256MiB')
    assert(finalGo.cpuMs>=baselineGo.cpuMs,'Go process CPU sampling invalid')
    const result={
      sample,workload:'100k-logical-115k-physical-mixed-actual-Web-Gallery-five-Grid-viewports',
      physicalOriginals:fixture.info.physical_sources,
      physicalOriginalBytes:fixture.info.physical_bytes,
      seedMsExcluded:fixture.info.seed_ms,
      distinctDecodedVisibleIndices:seen.size,views,
      fiveViewportP50Ms:median(views.map(x=>x.firstSixDecodedAndTwoFramesMs)),
      go:{initial:baselineGo,final:finalGo,sampledPeakRSSBytes:peakGoRSS,
        RSSGrowthBytes:Math.max(0,peakGoRSS-baselineGo.rssBytes),
        cpuDeltaMs:finalGo.cpuMs-baselineGo.cpuMs},
      chromium:{firstWSBytes:initialWS,peakWSBytes:maxWS,
        growthBytes:maxWS-initialWS},
      limitations:'real Web Gallery Grid + API + 115k different physical CAS with new visible JPEG/Live stills decoded and two rAF only; NOT 100k independent H264 encodes, video/Live motion playback, RAW/HEVC, Desktop Main/Agent, Timeline, physical mobile or WAN'
    }
    fs.writeFileSync(path.join(output,'sample-'+sample+'.json'),
      JSON.stringify(result,null,2)+'\n')
    console.log('GALLERY_WEB_PHYSICAL_100K_SAMPLE '+JSON.stringify(result))
    return result
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
      status:'measured-current-source-only-no-product-after',
      samples,n:3,logicalCount:100000,physicalOriginals:115000,
      medianOfFixtureFiveViewportP50Ms:median(samples.map(x=>x.fiveViewportP50Ms)),
      maxRendererWorkingSetGrowthBytes:Math.max(...samples.map(x=>x.chromium.growthBytes)),
      maxNativeGoRSSGrowthBytes:Math.max(...samples.map(x=>x.go.RSSGrowthBytes)),
      peakHTTPThumbnailHandlers:Math.max(...samples.flatMap(s=>s.views.map(v=>v.http.max_active))),
      accepted:samples.length===3&&samples.every(s=>s.views.length===5&&
        s.distinctDecodedVisibleIndices>=30&&
        s.go.RSSGrowthBytes<=maxRSSGrowth&&s.chromium.growthBytes<=maxRSSGrowth&&
        s.views.every(v=>v.mountedTiles>0&&v.mountedTiles<1000&&
          v.firstSixDecodedAndTwoFramesMs<=maxFirstSixMs&&
          v.visibleDecodedBlobImages>=6&&v.http.max_active<=6&&
          v.http.failed===0&&v.http.response_bytes>0)),
      limits:'five positions 0/25/50/75/95%; first-six fresh blob JPEG decode + 2 rAF <=20s, mounted<1000, HTTP concurrency<=6, Renderer/Go after-seed RSS growth<=256MiB',
      caveats:'No matching production BEFORE/AFTER, no validated video H264/Live motion browser playback, RAW/HEVC/LIVP, Timeline, Desktop Agent, WAN or durable task cancellation'
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
