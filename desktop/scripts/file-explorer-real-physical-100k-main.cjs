'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawn,execFileSync} = require('node:child_process')
const {performance} = require('node:perf_hooks')
const {app,BrowserWindow} = require('electron')

const root = path.resolve(__dirname,'../..')
const desktop = path.join(root,'desktop')
const mixedMobileMode = process.env.XD_FILEEXPLORER_MOBILE_MIXED_100K_PERF === '1'
const mobileMode = process.env.XD_FILEEXPLORER_MOBILE_PHYSICAL_100K_PERF === '1' || mixedMobileMode
const requiredDecoded = mobileMode ? 4 : 6
const dist = path.join(root,'web/dist')
const output = path.resolve(process.env.XD_FILEEXPLORER_PHYSICAL_RESULTS ||
  path.join(desktop,mixedMobileMode ? 'mobile-mixed-p049-results' : mobileMode ? 'file-explorer-mobile-physical-jpeg-100k-results' : 'file-explorer-physical-jpeg-100k-results'))
const apiBinary = path.resolve(process.env.XD_FILEEXPLORER_PHYSICAL_TEST_BINARY || '')
const views = ['grid','details']
const fractions = [0,0.25,0.50,0.75,0.95]
const independentSamples = 3
const maxFirstSixMs = 20000
const memoryBudgetBytes = 256*1024*1024
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms))
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('enable-precise-memory-info')
app.on('window-all-closed',()=>{})

const ticksPerSecond = Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim())
assert(ticksPerSecond>0&&Number.isFinite(ticksPerSecond))
function procStats(pid) {
  const row=fs.readFileSync('/proc/'+pid+'/status','utf8').match(/^VmRSS:\s+(\d+) kB/m)
  const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8')
  const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)
  const ticks=Number(fields[11])+Number(fields[12])
  assert(row&&Number.isFinite(ticks),'native Gin RSS and CPU unavailable')
  return {rss:Number(row[1])*1024,cpuMs:ticks*1000/ticksPerSecond}
}
function rendererWS() {
  const found=app.getAppMetrics().find(x=>x.type==='Tab')||
    app.getAppMetrics().find(x=>x.type==='Renderer')
  const amount=found?.memory?.workingSetSize
  assert(Number.isFinite(amount)&&amount>0,'real Chromium Renderer working set missing')
  return amount*1024
}
async function until(fn,ms,label) {
  const start=performance.now()
  while(performance.now()-start<ms) {
    const found=await fn()
    if(found)return found
    await delay(50)
  }
  throw Error('timeout waiting for '+label)
}
function launch(binary,args,env,name) {
  const stream=fs.createWriteStream(path.join(output,name+'.log'))
  const child=spawn(binary,args,{cwd:root,env,stdio:['ignore','pipe','pipe']})
  child.stdout.pipe(stream,{end:false})
  child.stderr.pipe(stream,{end:false})
  child.on('error',e=>stream.write('SPAWN_ERROR '+String(e)+'\n'))
  const ended=new Promise(resolve=>child.once('exit',(code,signal)=>{stream.end();resolve({code,signal})}))
  return {child,ended}
}
async function stopProcess(proc,waitMs=60000) {
  if(!proc)return
  let timer
  let done=await Promise.race([proc.ended,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),waitMs)})])
  clearTimeout(timer)
  if(done)return done
  proc.child.kill('SIGTERM')
  done=await Promise.race([proc.ended,delay(5000).then(()=>null)])
  if(done)return done
  proc.child.kill('SIGKILL')
  return proc.ended
}
async function startFixture(sample,tmp) {
  const ready=path.join(tmp,'ready-'+sample+'.json')
  const proc=launch(apiBinary,[
    mixedMobileMode ? '-test.run=^TestGalleryRealWebColdFixture100K$' : '-test.run=^TestFileExplorerRealWebScrollCancelFixture100K$',
    '-test.count=1','-test.timeout=25m','-test.v'
  ],{
    ...process.env,
    ...(mixedMobileMode ? {
      XD_GALLERY_REAL_WEB_COLD_PERF:'1',
      XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF:'1',
      XD_GALLERY_DESKTOP_FILES_MIXED_PHYSICAL_100K_PERF:'1',
      XD_GALLERY_REAL_WEB_DIST:dist,
      XD_GALLERY_REAL_WEB_READY_FILE:ready,
    } : {
      XD_FILEEXPLORER_REAL_WEB_SCROLL_100K_PERF:'1',
      XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF:'1',
      XD_FILEEXPLORER_REAL_WEB_DIST:dist,
      XD_FILEEXPLORER_REAL_WEB_READY_FILE:ready,
    }),
  },'go-'+sample)
  try{
    const info=await until(()=>{
      if(proc.child.exitCode!==null)throw Error('native 100k physical CAS fixture stopped early')
      return fs.existsSync(ready)?JSON.parse(fs.readFileSync(ready,'utf8')):null
    },15*60_000,'100k distinct JPEG or 115k mixed original CAS persisted')
    if(mixedMobileMode){
      assert.equal(info.logical_assets,100000)
      assert.equal(info.physical_nodes,115000)
      assert.equal(info.physical_sources,115000)
      assert.equal(info.live_photo_groups,15000)
      assert.equal(info.physical_verified,12)
      assert.equal(info.physical_mode,true)
      assert(info.physical_bytes>100000000)
      assert(Number.isSafeInteger(info.folder_id)&&info.folder_id>0)
    }else{
      assert.equal(info.logical_count,100000)
      assert.equal(info.physical_images,100000)
      assert.equal(info.physical_mode,true)
      assert(info.physical_source_bytes>=100000*500)
    }
    return {proc,info}
  }catch(e){await stopProcess(proc,1000);throw e}
}
async function stats(base){
  const response=await fetch(base+(mixedMobileMode?'/__perf/physical-thumbnail-stats':'/__perf/physical-jpeg-stats'),{cache:'no-store'})
  assert.equal(response.status,200,'real thumbnail Go probe absent')
  return response.json()
}
const snapshotScript=`(()=>{
  const host=document.querySelector('[data-xdrive-file-explorer-scroll-host]')
  const tiles=Array.from(document.querySelectorAll('[data-xdrive-file-explorer-item]'))
  const decoded=tiles.filter(tile=>{
    const img=tile.querySelector('[data-xdrive-file-explorer-item-visual] img')
    return img && img.complete && img.naturalWidth>0 && img.naturalHeight>0
  })
  const decodedKinds={photo:[],video:[],liveStill:[],liveMotion:[],other:[]}
  const visibleKinds={photo:0,video:0,liveStill:0,liveMotion:0,other:0}
  const clip=host?.getBoundingClientRect()
  for(const tile of tiles){
    const label=tile.textContent||''
    const kind=label.includes('live-motion-')?'liveMotion':
      label.includes('live-still-')?'liveStill':
      label.includes('video-')?'video':label.includes('photo-')?'photo':'other'
    const rect=tile.getBoundingClientRect()
    if(!clip||rect.bottom<=clip.top||rect.top>=clip.bottom)continue
    visibleKinds[kind]++
    const img=tile.querySelector('[data-xdrive-file-explorer-item-visual] img')
    const id=tile.getAttribute('data-xdrive-file-explorer-item-id')
    if(id&&img&&img.complete&&img.naturalWidth>0&&img.naturalHeight>0)decodedKinds[kind].push(id)
  }
  return {decodedKinds,visibleKinds,
    scrollTop:host?.scrollTop??null,extent:host?host.scrollHeight-host.clientHeight:0,
    mounted:tiles.length,decoded:decoded.length,
    viewportWidth:document.documentElement.clientWidth,
    narrow:matchMedia('(max-width: 899px)').matches,
    ids:decoded.map(tile=>tile.getAttribute('data-xdrive-file-explorer-item-id')),
    posterStats:window.__xdriveFileExplorerMixedPosterStats||null,
    error:window.__xdriveFileExplorerRealScrollError||null
  }
})()`
async function DOM(win) {
  if(win.isDestroyed())throw Error('real Chromium FileExplorer window destroyed')
  const value=await win.webContents.executeJavaScript(snapshotScript,true)
  if(value.error)throw Error('production shared FileExplorer/range/thumbnail: '+value.error)
  return value
}
function scrollScript(fraction) {
  const host=document.querySelector('[data-xdrive-file-explorer-scroll-host]')
  if(!(host instanceof HTMLElement))return {error:'missing real FileExplorer virtual host'}
  const extent=host.scrollHeight-host.clientHeight
  host.scrollTop=Math.floor(extent*fraction)
  host.dispatchEvent(new Event('scroll'))
  return {top:host.scrollTop,extent}
}
async function viewSample(sample,view,fixture) {
  const win=new BrowserWindow({show:true,width:mobileMode ? 390 : 1440,height:mobileMode ? 844 : 900,
    webPreferences:{partition:(mobileMode ? 'mobile-physical-100k-' : 'physical-100k-')+sample+'-'+view,sandbox:false,
      nodeIntegration:false,contextIsolation:true,webSecurity:true,backgroundThrottling:false}})
  const failures=[]
  win.webContents.on('render-process-gone',(_e,value)=>failures.push('renderer: '+JSON.stringify(value)))
  win.webContents.on('did-fail-load',(_e,code,msg)=>failures.push('load '+code+' '+msg))
  let timer
  let peak=0
  const measurements=[]
  try {
    await win.loadURL(fixture.info.url+'/?xdriveFileExplorerRealScroll=1&'+(mixedMobileMode?'xdriveFileExplorerMixed100k=1':'xdriveFileExplorerPhysical100k=1')+'&xdriveFileExplorerViewMode='+view)
    const memoryBefore=rendererWS()
    peak=memoryBefore
    timer=setInterval(()=>{try{peak=Math.max(peak,rendererWS())}catch{}},25)
    const cpuBefore=process.cpuUsage()
    const firstCounter=await stats(fixture.info.url)
    let previous=new Set()
    for(const fraction of fractions) {
      const startedAt=performance.now()
      let moved=null
      if(fraction>0){
        moved=await win.webContents.executeJavaScript('('+scrollScript.toString()+')('+fraction+')',true)
        assert(!moved.error&&moved.extent>10000&&moved.top>10000,
          'real 100k virtual scroll did not move: '+JSON.stringify(moved))
      }
      const expectedKind=fraction===0?'liveMotion':fraction===0.25?'liveStill':
        fraction===0.95?'video':'photo'
      const minimumDecoded=mixedMobileMode&&
        (expectedKind==='video'||expectedKind==='liveMotion')?2:requiredDecoded
      let lastObserved=null
      const actual=await until(async()=>{
        if(failures.length)throw Error(failures.join('; '))
        const state=await DOM(win)
        lastObserved=state
        if(state.mounted<1||state.mounted>=1000)return null
        const ids=[...new Set(mixedMobileMode?(state.decodedKinds?.[expectedKind]||[]):state.ids)].filter(Boolean)
        if(ids.length<minimumDecoded)return null
        const fresh=ids.filter(id=>!previous.has(id))
        // The virtual list intentionally retains old overscan thumbnails
        // briefly while the new range resolves. Wait for SIX decoded new
        // IDs, not merely one new ID followed by a premature assertion.
        if(fraction>0&&fresh.length<minimumDecoded)return null
        return {...state,ids,expectedKind,minimumDecoded}
      },mixedMobileMode?20000:40000,'required actual decoded JPEG tiles at FileExplorer '+view+' viewport '+fraction)
        .catch(error=>{
          if(!mixedMobileMode)throw error
          throw Error('P049 real visible JPEG/H264/Live thumbnail wait failed '+JSON.stringify({
            view,fraction,expectedKind,minimumDecoded,
            observed:lastObserved,error:String(error),
          }))
        })
      const loadedMs=performance.now()-startedAt
      const ids=actual.ids
      const uniqueNew=ids.filter(id=>!previous.has(id)).length
      assert(fraction===0||uniqueNew>=actual.minimumDecoded,'virtual FileExplorer thumbnail window recycled stale source')
      previous=new Set(ids)
      peak=Math.max(peak,rendererWS())
      const requestState=await stats(fixture.info.url)
      if(mobileMode) assert(actual.narrow&&actual.viewportWidth>=375&&actual.viewportWidth<=390,
        'real 390px mobile FileExplorer was not mounted: '+JSON.stringify(actual))
      measurements.push({fraction,firstSixDecodedMs:loadedMs,firstRequiredDecodedMs:loadedMs,
        expectedKind:actual.expectedKind,visibleKinds:actual.visibleKinds,
        posterStats:actual.posterStats,
        decodedKinds:Object.fromEntries(Object.entries(actual.decodedKinds).map(([k,v])=>[k,v.length])),
        requiredDecoded:actual.minimumDecoded,viewportWidth:actual.viewportWidth,narrow:actual.narrow,decoded:ids.length,
        newIDs:uniqueNew,mounted:actual.mounted,scrollTop:actual.scrollTop,
        realGoThumbnailRequestsSoFar:requestState.started,realGoThumbnailBytesSoFar:requestState.response_bytes,
        canceledAbandonedRequestsSoFar:requestState.canceled,actualThumbnailErrorsSoFar:requestState.failed})
    }
    const cpu=process.cpuUsage(cpuBefore)
    const end=await stats(fixture.info.url)
    assert(end.started>firstCounter.started,'actual authenticated production thumbnail handler unused')
    assert(mixedMobileMode?end.server_errors===0:end.failed===0,
      'non-canceled physical thumbnail HTTP failures: '+JSON.stringify(end))
    assert(end.response_bytes>0,'no real CAS image bytes served')
    assert(end.max_active<=6,'production FileExplorer exceeded six thumbnail requests in flight')
    const growth=Math.max(0,peak-memoryBefore)
    // Each fresh PG/CAS fixture runs Grid first, then Details. Grid must
    // actually decode source H264 and persist its posters; Details must use
    // the real already-cached CAS JPEG when available, not fabricate a second
    // source decode or demand a duplicate PUT for the same node/revision.
    if(mixedMobileMode&&view==='grid'){
      const frameCount=measurements.at(-1)?.posterStats?.realDecodedFrames??0
      const posterPutCount=measurements.at(-1)?.posterStats?.posterPuts??0
      const posterReadbackCount=measurements.at(-1)?.posterStats?.posterReadbacks??0
      assert(frameCount>=4&&posterPutCount>=4&&posterReadbackCount>=4,
        'P049 missing real source video frame decode/poster CAS PUT/readback: '+JSON.stringify({
          frameCount,posterPutCount,posterReadbackCount,
          posterStats:measurements.at(-1)?.posterStats,
        }))
    }
    const row={sample,view,itemCount:mixedMobileMode?115000:100000,
      physicalDistinctJpegOriginals:mixedMobileMode?0:100000,
      physicalDistinctMixedOriginalCAS:mixedMobileMode?115000:0,
      logicalPhotoAssets:100000,livePhotoGroups:mixedMobileMode?15000:0,
      mobileMode,mixedMobileMode,cssViewportWidth:mobileMode?390:1440,minRequiredDecodedPerViewport:requiredDecoded,
      bitmapDimensions:'80x64 JPEG',renderedViewportPositions:fractions.length,
      metrics:measurements,totalRequestsForSample:end.started-firstCounter.started,
      totalRealHTTPBytesForSample:end.response_bytes-firstCounter.response_bytes,
      peakRealGoThumbnailConcurrency:end.max_active,
      expectedAbandonedViewportRequestCancels:end.canceled,actualThumbnailHTTPErrors:end.failed,
      nonCanceled5xx:end.server_errors??0,posterStats:measurements.at(-1)?.posterStats??null,
      rendererWorkingSetStartBytes:memoryBefore,rendererWorkingSetPeakBytes:peak,
      rendererWorkingSetGrowthBytes:growth,
      electronMainCPUUserMs:cpu.user/1000,electronMainCPUSystemMs:cpu.system/1000,
      firstSixP50Ms:median(measurements.map(x=>x.firstSixDecodedMs)),
      firstRequiredP50Ms:median(measurements.map(x=>x.firstRequiredDecodedMs)),
      worstFirstSixMs:Math.max(...measurements.map(x=>x.firstSixDecodedMs))}
    row.passed=measurements.length===5&&measurements.every(m=>
      m.decoded>=m.requiredDecoded&&(!mobileMode||m.narrow)&&m.mounted>0&&m.mounted<1000&&
      m.firstSixDecodedMs<=maxFirstSixMs&&(!mixedMobileMode||
        m.visibleKinds[m.expectedKind]>=m.requiredDecoded))&&
      growth<=memoryBudgetBytes&&end.max_active<=6&&(!mixedMobileMode||end.server_errors===0)
    console.log('FILEEXPLORER_REAL_PHYSICAL_100K_VIEW '+JSON.stringify(row))
    assert(row.passed,'authentic 100k physical JPEG FileExplorer budget exceeded')
    return row
  } finally {
    if(timer)clearInterval(timer)
    if(!win.isDestroyed())win.destroy()
  }
}
async function main() {
  assert(process.env.XD_TEST_DATABASE_URL,'PostgreSQL17 DSN required')
  assert(apiBinary&&fs.existsSync(apiBinary),'compiled genuine Go/Gin/CAS test binary required')
  assert(fs.existsSync(path.join(dist,'index.html')),'real shared FileExplorer Web dist required')
  fs.mkdirSync(output,{recursive:true})
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-fileexplorer-physical-jpeg-100k-'))
  const rows=[]
  try{
    await app.whenReady()
    for(let sample=1;sample<=independentSamples;sample++){
      const fixture=await startFixture(sample,tmp)
      const goStart=procStats(fixture.proc.child.pid)
      let goPeak=goStart.rss
      const rssTicker=setInterval(()=>{try{goPeak=Math.max(goPeak,procStats(fixture.proc.child.pid).rss)}catch{}},50)
      let succeeded=false
      try{
        const views=[]
        for(const view of ['grid','details']){
          const row=await viewSample(sample,view,fixture)
          views.push(row)
          rows.push(row)
          fs.writeFileSync(path.join(output,'sample-'+sample+'-'+view+'.json'),JSON.stringify(row,null,2)+'\n')
        }
        const goEnd=procStats(fixture.proc.child.pid)
        const sampleRow={sample,logicalNodes:mixedMobileMode?115000:100000,
          logicalPhotoAssets:100000,distinctPhysicalJpegOriginals:mixedMobileMode?0:100000,
          distinctMixedOriginalCAS:mixedMobileMode?115000:0,
          physicalSourceBytes:mixedMobileMode?fixture.info.physical_bytes:fixture.info.physical_source_bytes,
          seedMsExcluded:fixture.info.seed_ms,
          goRssStartBytes:goStart.rss,goRssPeakGrowthBytes:Math.max(0,goPeak-goStart.rss),
          goCPUDeltaMs:Math.max(0,goEnd.cpuMs-goStart.cpuMs),
          views}
        succeeded=sampleRow.goRssPeakGrowthBytes<=memoryBudgetBytes
        assert(succeeded,'real Gin/CAS process peak RSS grew beyond 256MiB during browser viewports')
        fs.writeFileSync(path.join(output,'sample-'+sample+'.json'),JSON.stringify(sampleRow,null,2)+'\n')
      }finally {
        clearInterval(rssTicker)
        await fetch(fixture.info.url+'/__perf/stop',{method:'POST'}).catch(()=>{})
        const done=await stopProcess(fixture.proc,120000)
        if(succeeded)assert.equal(done?.code,0,'native physical 100k PostgreSQL/CAS fixture failed after views')
      }
    }
    const result={status:'measured-CURRENT/BEFORE-only-production-unchanged',
      name:mixedMobileMode?'P049 390px Mobile Web FileExplorer 100k logical / 115k physical mixed JPEG H264 Live Grid Details':mobileMode?'390px-real-Mobile-Web-shared-fileexplorer-100k-distinct-JPEG':'real-web-shared-fileexplorer-100k-distinct-physical-jpeg-viewports',
      mobileMode,mixedMobileMode,cssViewportWidth:mobileMode?390:1440,
      independentPostgreSQLCASFixtures:3,logicalPhotoAssetsPerFixture:100000,
      itemsPerFixture:mixedMobileMode?115000:100000,
      distinctPhysicalJpegsPerFixture:mixedMobileMode?0:100000,
      distinctMixedOriginalCASPerFixture:mixedMobileMode?115000:0,
      livePhotoGroupsPerFixture:mixedMobileMode?15000:0,
      views,viewportFractions:fractions,viewSamples:rows.length,
      minDecodedPerViewport:requiredDecoded,minH264OrMotionPosterPerViewport:mixedMobileMode?2:0,
      maxViewportDecodeMs:maxFirstSixMs,
      maxMountedItems:999,maxConcurrentThumbnailHTTP:6,maxRendererAndGoRssGrowthBytes:memoryBudgetBytes,
      p50GridFirstSixMs:median(rows.filter(x=>x.view==='grid').map(x=>x.firstSixP50Ms)),
      p50GridFirstRequiredMs:median(rows.filter(x=>x.view==='grid').map(x=>x.firstRequiredP50Ms)),
      p50DetailsFirstSixMs:median(rows.filter(x=>x.view==='details').map(x=>x.firstSixP50Ms)),
      p50DetailsFirstRequiredMs:median(rows.filter(x=>x.view==='details').map(x=>x.firstRequiredP50Ms)),
      maxRendererGrowthBytes:Math.max(...rows.map(x=>x.rendererWorkingSetGrowthBytes)),
      samples:rows,
      passed:rows.length===6&&rows.every(x=>x.passed),
      limitations:mixedMobileMode?'390px real shared Web FileExplorer: 100k logical PhotoAssets and 115k SHA-distinct physical JPEG/H264/Live originals, H264 containers reuse encoded stream; thumbnail posters only, NOT Live Motion playback, actual iOS/Android phone or OS installed PWA, full Mobile App Frame, WAN, durable task cancellation.' :mobileMode?'390px real shared Web FileExplorer in Electron Chromium, NOT full Mobile Web App Frame or actual iOS Safari/Android Chrome hardware. Only four freshly decoded JPEG per viewport; no H264/Live/RAW/HEVC/LIVP, WAN, OS-installed PWA, Desktop Agent or durable Task Center cancel.':'Each of 100k physical JPEG originals is real and unique; browser decodes only a bounded viewport sample at 0/25/50/75/95%, NOT all 100k concurrently. Real Web shared FileExplorer Grid/Details, not Desktop Agent, H264/HEVC/RAW/LIVP physical decode, WAN, or durable Task Center cancellation.'}
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2)+'\n')
    console.log((mixedMobileMode?'FILEEXPLORER_MOBILE_MIXED_100K_SUMMARY ':'FILEEXPLORER_REAL_PHYSICAL_100K_SUMMARY ')+JSON.stringify(result))
    assert(result.passed,'100k physical JPEG native FileExplorer performance gate failed')
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
main().then(()=>app.exit(0)).catch(e=>{console.error('FILEEXPLORER_REAL_PHYSICAL_100K_ERROR '+(e?.stack||String(e)));app.exit(1)})
