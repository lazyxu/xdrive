'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawn,execFileSync} = require('node:child_process')
const {performance} = require('node:perf_hooks')
const {app,BrowserWindow} = require('electron')
const root=path.resolve(__dirname,'../..')
const out=path.resolve(process.env.XD_GALLERY_H264_POSTERS_RESULTS||
  path.join(root,'desktop','gallery-h264-real-posters-100k-results'))
const dist=path.join(root,'web','dist')
const binary=process.env.XD_GALLERY_H264_POSTERS_GO_BINARY
const fractions=[0,.25,.5,.75,.95]
const perViewDeadlineMs=25000
const maxMemGrowth=256*1024*1024
const ticks=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim())
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const middle=items=>[...items].sort((a,b)=>a-b)[Math.floor(items.length/2)]
app.on('window-all-closed',()=>{})
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('enable-precise-memory-info')

async function until(check,timeout,label){
  const began=performance.now()
  while(performance.now()-began<timeout){
    const found=await check()
    if(found)return found
    await sleep(50)
  }
  throw Error('timeout '+label)
}
function resource(pid){
  const s=fs.readFileSync('/proc/'+pid+'/status','utf8')
  const kib=Number(s.match(/^VmRSS:\s+(\d+) kB/m)?.[1])
  const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8')
  const n=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)
  const cpu=(Number(n[11])+Number(n[12]))*1000/ticks
  assert(Number.isFinite(kib)&&Number.isFinite(cpu)&&ticks>0,'native Go CPU/RSS absent')
  return {rssBytes:kib*1024,cpuMs:cpu}
}
function rendererWS(){
  const m=app.getAppMetrics().find(x=>x.type==='Tab')||
    app.getAppMetrics().find(x=>x.type==='Renderer')
  const kib=m?.memory?.workingSetSize
  assert(Number.isFinite(kib)&&kib>0,'actual Chromium Renderer working set missing')
  return kib*1024
}
async function startFixture(n,ready){
  const log=fs.createWriteStream(path.join(out,'native-'+n+'.log'))
  const child=spawn(binary,['-test.run=^TestGalleryRealWebColdFixture100K$',
    '-test.count=1','-test.timeout=20m','-test.v'],{
    cwd:root,env:{...process.env,
      XD_GALLERY_REAL_WEB_COLD_PERF:'1',
      XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF:'1',
      XD_GALLERY_REAL_WEB_DIST:dist,
      XD_GALLERY_REAL_WEB_READY_FILE:ready,
    },stdio:['ignore','pipe','pipe']})
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false})
  child.once('error',e=>log.write('native spawn error '+String(e)+'\n'))
  const ended=new Promise(resolve=>child.once('exit',(code,signal)=>{
    log.end();resolve({code,signal})
  }))
  try{
    const config=await until(()=>{
      if(child.exitCode!==null)throw Error('native PostgreSQL/Gin fixture exited early')
      return fs.existsSync(ready)?JSON.parse(fs.readFileSync(ready,'utf8')):null
    },12*60*1000,'115k different real CAS source seed')
    assert.equal(config.logical_assets,100000)
    assert.equal(config.physical_nodes,115000)
    assert.equal(config.live_photo_groups,15000)
    assert.equal(config.physical_mode,true)
    assert.equal(config.physical_sources,115000)
    assert.equal(config.physical_bytes,149285128)
    assert.equal(config.physical_verified,12)
    return {child,ended,config}
  }catch(e){child.kill('SIGTERM');throw e}
}
async function stopFixture(f){
  if(!f)return
  try{await fetch(f.config.url+'/__perf/stop',{method:'POST'})}catch(_){}
  const finish=await Promise.race([f.ended,sleep(60000).then(()=>({code:'timeout'}))])
  if(finish.code!==0){f.child.kill('SIGKILL');throw Error('native fixture not clean '+JSON.stringify(finish))}
}
async function readJSON(url){
  const r=await fetch(url,{cache:'no-store'})
  if(!r.ok)throw Error('native stats HTTP '+r.status)
  return r.json()
}
function move(fraction){
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  if(!grid)return {error:'production VirtualGrid missing'}
  let host=grid.parentElement
  while(host){
    if(/(auto|scroll|overlay)/.test(getComputedStyle(host).overflowY)&&
      host.scrollHeight-host.clientHeight>10000)break
    host=host.parentElement
  }
  if(!host)return {error:'real scrollable Gallery virtual host missing'}
  const extent=host.scrollHeight-host.clientHeight
  host.scrollTop=Math.floor(extent*fraction)
  host.dispatchEvent(new Event('scroll'))
  return {fraction,extent,scrollTop:host.scrollTop}
}
function snapshotPosters(){
  const grid=document.querySelector('[data-xdrive-media-gallery-virtual-grid]')
  if(!grid)return {error:'production mounted Gallery Grid missing'}
  let scroll=grid.parentElement
  while(scroll){
    if(/(auto|scroll|overlay)/.test(getComputedStyle(scroll).overflowY)&&
      scroll.scrollHeight-scroll.clientHeight>10000)break
    scroll=scroll.parentElement
  }
  if(!scroll)return {error:'real Gallery scroll ancestor missing'}
  const stat=window.__xdriveGalleryRealH264PosterStats
  if(!stat)return {error:'real video poster benchmark observer missing'}
  const box=scroll.getBoundingClientRect(),decoded=[]
  const vids=stat.videoNodeByLogicalIndex
  const saved=new Set(stat.savedPosterNodeIDs)
  const tiles=Array.from(grid.querySelectorAll('[data-xdrive-media-tile]'))
  for(const tile of tiles){
    const r=tile.getBoundingClientRect()
    if(r.bottom<=box.top||r.top>=box.bottom)continue
    const index=Number(tile.getAttribute('data-xdrive-media-index'))
    const nodeID=vids[String(index)]
    if(!nodeID || !saved.has(nodeID))continue
    const img=tile.querySelector('img')
    if(!(img instanceof HTMLImageElement)||!img.complete||
       img.naturalWidth<=0||img.naturalHeight<=0||
       !(img.currentSrc||img.src).startsWith('blob:'))continue
    decoded.push({index,nodeID,src:img.currentSrc||img.src})
  }
  return {mounted:tiles.length,videoDecoded:decoded,counters:{
    signedTickets:stat.signedTickets,posterPuts:stat.posterPuts,
    posterPutBytes:stat.posterPutBytes,coldPosterMisses:stat.coldPosterMisses,
    warmPosterGets:stat.warmPosterGets,errors:stat.errors,
    signedTicketNodeIDs:stat.signedTicketNodeIDs,
    savedPosterNodeIDs:stat.savedPosterNodeIDs,
  }}
}
async function decodePaint(win,indices){
  const js='(async()=>{'+
    'const wanted=new Set('+JSON.stringify(indices)+');'+
    'const grid=document.querySelector("[data-xdrive-media-gallery-virtual-grid]");'+
    'const imgs=Array.from(grid.querySelectorAll("[data-xdrive-media-tile]")).filter(x=>'+
    'wanted.has(Number(x.getAttribute("data-xdrive-media-index")))).map(x=>x.querySelector("img"));'+
    'if(imgs.length<2)throw Error("fewer than two real H264-derived visible JPEG posters");'+
    'await Promise.all(imgs.slice(0,2).map(x=>x.decode()));'+
    'await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));'+
    'return imgs.slice(0,2).every(x=>x.naturalWidth>0&&x.naturalHeight>0);'+
    '})()'
  return win.webContents.executeJavaScript(js,true)
}
async function sampleOnce(n,tmp){
  let fixture=null,win=null,timer=null;const errors=[]
  try{
    fixture=await startFixture(n,path.join(tmp,'ready-'+n+'.json'))
    const baselineGo=resource(fixture.child.pid)
    let maxGoRSS=baselineGo.rssBytes
    timer=setInterval(()=>{
      try{maxGoRSS=Math.max(maxGoRSS,resource(fixture.child.pid).rssBytes)}catch(_){}
    },25)
    win=new BrowserWindow({show:true,width:1440,height:900,
      webPreferences:{partition:'gallery-real-physical-h264-'+n,
        contextIsolation:true,nodeIntegration:false,sandbox:false,
        webSecurity:true,backgroundThrottling:false}})
    win.webContents.on('render-process-gone',(_ev,state)=>errors.push('renderer: '+JSON.stringify(state)))
    win.webContents.on('did-fail-load',(_ev,code,message)=>errors.push('load '+code+': '+message))
    const navStarted=performance.now()
    await win.loadURL(fixture.config.url+
      '/?xdriveGalleryRealCold=1&xdriveRealViewportCancel=1&xdriveMediaProgress=off&xdriveGalleryRealH264Poster=1')
    const initialRenderer=rendererWS()
    let peakRenderer=initialRenderer
    // The initial React mount is included in the original first video timer.
    await until(async()=>{
      if(errors.length)throw Error(errors.join('; '))
      const st=await win.webContents.executeJavaScript('('+snapshotPosters.toString()+')()',true)
      return !st.error ? st : null
    },perViewDeadlineMs,'real mounted Web Gallery H264 performance observer')
    const viewed=new Set(),results=[]
    for(const fraction of fractions){
      const began=fraction===0?navStarted:performance.now()
      const scroll=await win.webContents.executeJavaScript(
        '('+move.toString()+')('+fraction+')',true)
      if(scroll.error)throw Error(scroll.error)
      assert(scroll.extent>10000,'real 100k Gallery Grid not scrollable')
      const view=await until(async()=>{
        if(errors.length)throw Error(errors.join('; '))
        const st=await win.webContents.executeJavaScript('('+snapshotPosters.toString()+')()',true)
        if(st.error)throw Error(st.error)
        if(st.mounted>=1000)throw Error('unbounded Gallery media DOM tiles: '+st.mounted)
        if(st.counters.errors>0)throw Error('signed preview or poster CAS error: '+JSON.stringify(st.counters))
        const fresh=st.videoDecoded.filter(x=>!viewed.has(x.nodeID))
        return fresh.length>=2?{...st,fresh}:null
      },perViewDeadlineMs,'two new visible real signed-H264 captured-and-saved posters fraction '+fraction)
      const selected=view.fresh.slice(0,2)
      assert(await decodePaint(win,selected.map(x=>x.index)),'Chromium JPEG poster decode/two rAF failed')
      const elapsed=performance.now()-began
      assert(elapsed<=perViewDeadlineMs,'H264 poster viewport >25s budget')
      assert(view.counters.signedTickets>=2 && view.counters.posterPuts>=2 &&
        view.counters.posterPutBytes>0,'no actual signed preview or persisted real JPEG')
      for(const item of view.videoDecoded)viewed.add(item.nodeID)
      peakRenderer=Math.max(peakRenderer,rendererWS())
      const row={fraction,scroll,firstTwoNewH264PostersDecodedAndTwoFramesMs:elapsed,
        selectedNodeIDs:selected.map(x=>x.nodeID),
        visibleRealPersistedPosters:view.videoDecoded.length,
        mountedTiles:view.mounted,poster:view.counters,
        realCASStore:await readJSON(fixture.config.url+'/__perf/stats'),
        rendererWorkingSetBytes:peakRenderer}
      results.push(row)
      console.log('GALLERY_REAL_H264_100K_VIEW '+JSON.stringify({sample:n,...row}))
    }
    const prev=await win.webContents.executeJavaScript('('+snapshotPosters.toString()+')()',true)
    await win.webContents.executeJavaScript('('+move.toString()+')(0)',true)
    const warm=await until(async()=>{
      const x=await win.webContents.executeJavaScript('('+snapshotPosters.toString()+')()',true)
      return !x.error&&x.counters.warmPosterGets>=2?x:null
    },12000,'warm cached Server 200 H264 poster GET on revisited Web Grid')
    if(warm.counters.errors!==0)throw Error('H264 warm cached poster GET errors')
    clearInterval(timer);timer=null
    const end=resource(fixture.child.pid)
    assert(viewed.size>=10,'less than ten actually distinct visible persisted video posters')
    assert(warm.counters.signedTickets>=10 && warm.counters.posterPuts>=10 &&
      warm.counters.coldPosterMisses>=10,'missing real video ticket, cold miss or JPEG persistence')
    const diffRenderer=peakRenderer-initialRenderer
    const diffGo=Math.max(0,maxGoRSS-baselineGo.rssBytes)
    assert(diffRenderer<=maxMemGrowth&&diffGo<=maxMemGrowth,'Go/Chromium >256 MiB budget')
    const result={sample:n,logicalAssets:100000,physicalCASOriginals:115000,
      originalCASBytes:fixture.config.physical_bytes,seedMsExcluded:fixture.config.seed_ms,
      distinctVideoPosters:viewed.size,positions:fractions,viewports:results,
      fivePositionP50Ms:middle(results.map(x=>x.firstTwoNewH264PostersDecodedAndTwoFramesMs)),
      countersAfterWarm:warm.counters,posterWarmDelta:warm.counters.warmPosterGets-prev.counters.warmPosterGets,
      go:{baseline:baselineGo,final:end,maxRSSBytes:maxGoRSS,rssGrowthBytes:diffGo,cpuDeltaMs:end.cpuMs-baselineGo.cpuMs},
      renderer:{initialWorkingSetBytes:initialRenderer,peakWorkingSetBytes:peakRenderer,growthBytes:diffRenderer},
      limitations:'Real mounted production Web Gallery VirtualGrid video poster component cold 404 -> signed preview ticket -> actual H264 browser video decode/canvas JPEG -> revisioned Server CAS PUT -> warm GET. 100k logical/115k distinct physical original sources, only selected new video tiles decoded, 30k MP4/MOV containers share same encoded H264 frames; not independently encoded 15k video scenes, no Live motion, RAW/HEVC, Timeline, Desktop Agent or WAN.'}
    fs.writeFileSync(path.join(out,'sample-'+n+'.json'),JSON.stringify(result,null,2)+'\n')
    console.log('GALLERY_REAL_H264_100K_SAMPLE '+JSON.stringify(result))
    return result
  }finally{
    if(timer)clearInterval(timer)
    if(win&&!win.isDestroyed())win.destroy()
    if(fixture)await stopFixture(fixture)
  }
}
async function main(){
  assert(process.env.XD_TEST_DATABASE_URL,'native PostgreSQL DSN required')
  assert(binary&&fs.existsSync(binary),'compiled native Go Gallery fixture binary required')
  assert(fs.existsSync(path.join(dist,'index.html')),'real Web Gallery bundle missing')
  fs.mkdirSync(out,{recursive:true})
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-h264-real-100k-'))
  try{
    await app.whenReady()
    const rows=[]
    for(let n=1;n<=3;n++)rows.push(await sampleOnce(n,tmp))
    const all=rows.flatMap(r=>r.viewports)
    const summary={name:'M001-b-real-mounted-Web-Gallery-H264-physical-100k',
      status:'CURRENT-before-only-n3',n:rows.length,logicalAssets:100000,
      physicalOriginalCASFiles:115000,nRealViewports:all.length,
      medianOfFixtureP50Ms:middle(rows.map(r=>r.fivePositionP50Ms)),
      worstMs:Math.max(...all.map(x=>x.firstTwoNewH264PostersDecodedAndTwoFramesMs)),
      maxDOMTiles:Math.max(...all.map(x=>x.mountedTiles)),
      maxGoRSSGrowthBytes:Math.max(...rows.map(x=>x.go.rssGrowthBytes)),
      maxRendererGrowthBytes:Math.max(...rows.map(x=>x.renderer.growthBytes)),
      accepted:rows.length===3&&all.length===15&&rows.every(r=>r.distinctVideoPosters>=10&&
        r.posterWarmDelta>=1&&r.countersAfterWarm.posterPuts>=10&&
        r.go.rssGrowthBytes<=maxMemGrowth&&r.renderer.growthBytes<=maxMemGrowth&&
        r.viewports.every(v=>v.mountedTiles<1000&&
          v.firstTwoNewH264PostersDecodedAndTwoFramesMs<=perViewDeadlineMs&&
          v.poster.errors===0)),
      samples:rows,
      frozenBudget:'3 independent physical 115k CAS cohorts x 5 real virtual video viewports, >=2 new signed-preview/H264-canvas-captured/persisted JPEG posters and decode+2rAF each, each <=25s, n>=10 distinct per fixture, warm cached poster GET >=1, node count <1000, Go/Renderer memory growth <=256MiB, no HTTP/poster failure',
      limitation:'Does not prove 15k independently encoded H264 movies, Live motion, 4K, HEVC, RAW, Timeline, Desktop Main/Agent or true WAN.'}
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n')
    console.log('GALLERY_REAL_H264_100K_SUMMARY '+JSON.stringify(summary))
    assert(summary.accepted,'frozen 100k real Web Gallery H264 poster CURRENT gate failed')
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
main().then(()=>app.exit(0)).catch(e=>{
  console.error('GALLERY_REAL_H264_100K_ERROR '+(e?.stack||String(e)))
  app.exit(1)
})
