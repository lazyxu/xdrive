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
const dist = path.join(root,'web/dist')
const output = path.resolve(process.env.XD_FILEEXPLORER_PHYSICAL_RESULTS ||
  path.join(desktop,'file-explorer-physical-jpeg-100k-results'))
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
    '-test.run=^TestFileExplorerRealWebScrollCancelFixture100K$',
    '-test.count=1','-test.timeout=25m','-test.v'
  ],{
    ...process.env,
    XD_FILEEXPLORER_REAL_WEB_SCROLL_100K_PERF:'1',
    XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF:'1',
    XD_FILEEXPLORER_REAL_WEB_DIST:dist,
    XD_FILEEXPLORER_REAL_WEB_READY_FILE:ready,
  },'go-'+sample)
  try{
    const info=await until(()=>{
      if(proc.child.exitCode!==null)throw Error('native 100k physical CAS fixture stopped early')
      return fs.existsSync(ready)?JSON.parse(fs.readFileSync(ready,'utf8')):null
    },12*60_000,'100k real distinct JPEGs persisted to PostgreSQL and physical CAS')
    assert.equal(info.logical_count,100000)
    assert.equal(info.physical_images,100000)
    assert.equal(info.physical_mode,true)
    assert(info.physical_source_bytes>=100000*500)
    return {proc,info}
  }catch(e){await stopProcess(proc,1000);throw e}
}
async function stats(base){
  const response=await fetch(base+'/__perf/physical-jpeg-stats',{cache:'no-store'})
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
  return {
    scrollTop:host?.scrollTop??null,extent:host?host.scrollHeight-host.clientHeight:0,
    mounted:tiles.length,decoded:decoded.length,
    ids:decoded.map(tile=>tile.getAttribute('data-xdrive-file-explorer-item-id')),
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
  const win=new BrowserWindow({show:true,width:1440,height:900,
    webPreferences:{partition:'physical-100k-'+sample+'-'+view,sandbox:false,
      nodeIntegration:false,contextIsolation:true,webSecurity:true,backgroundThrottling:false}})
  const failures=[]
  win.webContents.on('render-process-gone',(_e,value)=>failures.push('renderer: '+JSON.stringify(value)))
  win.webContents.on('did-fail-load',(_e,code,msg)=>failures.push('load '+code+' '+msg))
  let timer
  let peak=0
  const measurements=[]
  try {
    await win.loadURL(fixture.info.url+'/?xdriveFileExplorerRealScroll=1&xdriveFileExplorerPhysical100k=1&xdriveFileExplorerViewMode='+view)
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
      const actual=await until(async()=>{
        if(failures.length)throw Error(failures.join('; '))
        const state=await DOM(win)
        if(state.mounted<1||state.mounted>=1000)return null
        const ids=[...new Set(state.ids)].filter(Boolean)
        if(ids.length<6)return null
        const fresh=ids.filter(id=>!previous.has(id))
        // The virtual list intentionally retains old overscan thumbnails
        // briefly while the new range resolves. Wait for SIX decoded new
        // IDs, not merely one new ID followed by a premature assertion.
        if(fraction>0&&fresh.length<6)return null
        return {...state,ids}
      },40000,'six actual decoded JPEG tiles at FileExplorer '+view+' viewport '+fraction)
      const loadedMs=performance.now()-startedAt
      const ids=actual.ids
      const uniqueNew=ids.filter(id=>!previous.has(id)).length
      assert(fraction===0||uniqueNew>=6,'virtual FileExplorer thumbnail window recycled stale source')
      previous=new Set(ids)
      peak=Math.max(peak,rendererWS())
      const requestState=await stats(fixture.info.url)
      measurements.push({fraction,firstSixDecodedMs:loadedMs,decoded:ids.length,
        newIDs:uniqueNew,mounted:actual.mounted,scrollTop:actual.scrollTop,
        realGoThumbnailRequestsSoFar:requestState.started,realGoThumbnailBytesSoFar:requestState.response_bytes,
        canceledAbandonedRequestsSoFar:requestState.canceled,actualThumbnailErrorsSoFar:requestState.failed})
    }
    const cpu=process.cpuUsage(cpuBefore)
    const end=await stats(fixture.info.url)
    assert(end.started>firstCounter.started,'actual authenticated production thumbnail handler unused')
    assert(end.failed===0,'genuine JPEG thumbnail HTTP failures (excluding scoped canceled old requests): '+JSON.stringify(end))
    assert(end.response_bytes>0,'no real CAS image bytes served')
    assert(end.max_active<=6,'production FileExplorer exceeded six thumbnail requests in flight')
    const growth=Math.max(0,peak-memoryBefore)
    const row={sample,view,itemCount:100000,physicalDistinctJpegOriginals:100000,
      bitmapDimensions:'80x64 JPEG',renderedViewportPositions:fractions.length,
      metrics:measurements,totalRequestsForSample:end.started-firstCounter.started,
      totalRealHTTPBytesForSample:end.response_bytes-firstCounter.response_bytes,
      peakRealGoThumbnailConcurrency:end.max_active,
      expectedAbandonedViewportRequestCancels:end.canceled,actualThumbnailHTTPErrors:end.failed,
      rendererWorkingSetStartBytes:memoryBefore,rendererWorkingSetPeakBytes:peak,
      rendererWorkingSetGrowthBytes:growth,
      electronMainCPUUserMs:cpu.user/1000,electronMainCPUSystemMs:cpu.system/1000,
      firstSixP50Ms:median(measurements.map(x=>x.firstSixDecodedMs)),
      worstFirstSixMs:Math.max(...measurements.map(x=>x.firstSixDecodedMs))}
    row.passed=measurements.length===5&&measurements.every(m=>
      m.decoded>=6&&m.mounted>0&&m.mounted<1000&&m.firstSixDecodedMs<=maxFirstSixMs)&&
      growth<=memoryBudgetBytes&&end.max_active<=6
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
        const sampleRow={sample,logicalNodes:100000,distinctPhysicalJpegOriginals:100000,
          physicalSourceBytes:fixture.info.physical_source_bytes,seedMsExcluded:fixture.info.seed_ms,
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
      name:'real-web-shared-fileexplorer-100k-distinct-physical-jpeg-viewports',
      independentPostgreSQLCASFixtures:3,itemsPerFixture:100000,distinctPhysicalJpegsPerFixture:100000,
      views,viewportFractions:fractions,viewSamples:rows.length,
      minDecodedPerViewport:6,maxViewportDecodeMs:maxFirstSixMs,
      maxMountedItems:999,maxConcurrentThumbnailHTTP:6,maxRendererAndGoRssGrowthBytes:memoryBudgetBytes,
      p50GridFirstSixMs:median(rows.filter(x=>x.view==='grid').map(x=>x.firstSixP50Ms)),
      p50DetailsFirstSixMs:median(rows.filter(x=>x.view==='details').map(x=>x.firstSixP50Ms)),
      maxRendererGrowthBytes:Math.max(...rows.map(x=>x.rendererWorkingSetGrowthBytes)),
      samples:rows,
      passed:rows.length===6&&rows.every(x=>x.passed),
      limitations:'Each of 100k physical JPEG originals is real and unique; browser decodes only a bounded viewport sample at 0/25/50/75/95%, NOT all 100k concurrently. Real Web shared FileExplorer Grid/Details, not Desktop Agent, H264/HEVC/RAW/LIVP physical decode, WAN, or durable Task Center cancellation.'}
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2)+'\n')
    console.log('FILEEXPLORER_REAL_PHYSICAL_100K_SUMMARY '+JSON.stringify(result))
    assert(result.passed,'100k physical JPEG native FileExplorer performance gate failed')
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
main().then(()=>app.exit(0)).catch(e=>{console.error('FILEEXPLORER_REAL_PHYSICAL_100K_ERROR '+(e?.stack||String(e)));app.exit(1)})
