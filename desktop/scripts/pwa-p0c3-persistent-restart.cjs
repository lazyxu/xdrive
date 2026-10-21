#!/usr/bin/env node
'use strict'
// P0-C3 BEFORE: genuine native Chromium process exit/relaunch with the SAME
// persisted profile, public SW shell, offline transport, then weak recovery.
// NOT installed iOS Safari, Home Screen, WAN, Owner media or AFTER speedup.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const http=require('node:http')
const {performance}=require('node:perf_hooks')
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const {assertXDrivePublicShellCache}=require('./pwa-public-shell-cache.cjs')
const root=path.resolve(__dirname,'../..')
const dist=path.join(root,'web/dist')
const out=path.resolve(process.env.XD_PWA_P0C3_RESULT_DIR||path.join(root,'desktop/pwa-p0c3-results'))
const executable=process.env.XDRIVE_BROWSER_EXECUTABLE
assert(executable&&fs.existsSync(executable),'native Chromium binary required')
assert(fs.existsSync(path.join(dist,'sw.js'))&&fs.existsSync(path.join(dist,'index.html')))
fs.mkdirSync(out,{recursive:true})
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
'.png':'image/png','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2',
'.ico':'image/x-icon','.webmanifest':'application/manifest+json'}
let transportDown=false
const totals={dropped:0,ready:0,privateDenied:0,static:0}
const server=http.createServer((req,res)=>{
  let u
  try{u=new URL(req.url,'http://localhost')}catch{res.writeHead(400);res.end();return}
  if(transportDown){totals.dropped++;res.destroy();return}
  if(u.pathname==='/api/v1/readyz'&&req.method==='GET'){
    totals.ready++
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'})
    res.end('{"ok":true}');return
  }
  if(u.pathname.startsWith('/api/')){
    totals.privateDenied++
    res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'})
    res.end('{"error":"private fixture unavailable"}');return
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
  let name
  try{name=decodeURIComponent(u.pathname)}catch{res.writeHead(400);res.end();return}
  if(name==='/')name='/index.html'
  if(name.includes('\\')||name.includes('\0')){res.writeHead(400);res.end();return}
  const file=path.resolve(dist,'.'+name)
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
  let stat
  try{stat=fs.statSync(file)}catch{res.writeHead(404);res.end();return}
  if(!stat.isFile()){res.writeHead(404);res.end();return}
  totals.static++
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream',
    'Content-Length':String(stat.size),'Cache-Control':name==='/sw.js'||name==='/index.html'
      ?'no-store':'public,max-age=3600'})
  if(req.method==='HEAD'){res.end();return}
  fs.createReadStream(file).pipe(res)
})
async function launch(profile){
  return chromium.launchPersistentContext(profile,{
    executablePath:executable,headless:true,viewport:{width:390,height:844},
    isMobile:true,hasTouch:true,deviceScaleFactor:3,locale:'zh-CN',serviceWorkers:'allow',
    args:['--no-sandbox','--disable-dev-shm-usage']
  })
}
async function pageOf(context){
  const page=context.pages()[0]||await context.newPage()
  page.setDefaultTimeout(30000)
  return page
}
async function visible(page){
  await page.locator('[data-xdrive-pwa-login-entry]').waitFor({state:'visible',timeout:30000})
  await page.waitForFunction(()=>performance.getEntriesByType('paint')
    .some(e=>e.name==='first-contentful-paint'),null,{timeout:15000})
  const sample=await page.evaluate(()=>{
    const paint=performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint')
    const nav=performance.getEntriesByType('navigation')[0]
    const res=performance.getEntriesByType('resource')
    return {fcpMs:paint?.startTime??null,domReadyMs:nav?.domContentLoadedEventEnd??null,
      controlled:!!navigator.serviceWorker?.controller,filesHash:location.hash==='#/app/files',
      width:document.documentElement.clientWidth,
      resourceCount:1+res.length,
      // This ResourceTiming estimate MUST NEVER be called actual wire bytes.
      estimatedTransferBytes:(nav?.transferSize||0)+res.reduce((a,b)=>a+(b.transferSize||0),0)}
  })
  assert(sample.filesHash&&sample.width>=360&&sample.width<=390)
  assert(Number.isFinite(sample.fcpMs)&&sample.fcpMs>0)
  assert(Number.isFinite(sample.domReadyMs)&&sample.domReadyMs>0)
  return sample
}
async function cacheAudit(page){
  const snapshot=await page.evaluate(async()=>{
    const names=await caches.keys(),paths=[]
    for(const name of names){const store=await caches.open(name)
      for(const key of await store.keys())paths.push(new URL(key.url).pathname)}
    return {names,paths}
  })
  assertXDrivePublicShellCache(snapshot)
  return {cacheNames:snapshot.names.length,cacheEntries:snapshot.paths.length}
}
function percentile(xs,q){
  assert(xs.length===3&&xs.every(x=>Number.isFinite(x)&&x>0))
  const a=[...xs].sort((x,y)=>x-y),at=(a.length-1)*q
  const lo=Math.floor(at),hi=Math.ceil(at)
  return Number((a[lo]+(a[hi]-a[lo])*(at-lo)).toFixed(3))
}
async function runOne(n,origin){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-p0c3-public-'))
  const address=origin+'/#/app/files'
  let ctx=null
  try{
    transportDown=false
    ctx=await launch(profile)
    let page=await pageOf(ctx)
    await page.goto(address,{waitUntil:'load',timeout:30000})
    await page.evaluate(async()=>{
      const reg=await Promise.race([navigator.serviceWorker.ready,
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('sw-not-ready')),25000))])
      if(!reg.active)throw new Error('SW not active')
    })
    await page.reload({waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:25000})
    const initial={...(await visible(page)),...(await cacheAudit(page))}
    assert(initial.controlled)
    await ctx.close();ctx=null

    // Close the entire first browser process, then lose the real HTTP transport.
    transportDown=true
    ctx=await launch(profile)
    page=await pageOf(ctx)
    await page.goto(address,{waitUntil:'domcontentloaded',timeout:30000})
    const offline={...(await visible(page)),...(await cacheAudit(page))}
    assert(offline.controlled,'new process must relaunch from persisted public SW')
    await ctx.close();ctx=null

    // Reopen the same profile a THIRD time over real throttled HTTP.
    transportDown=false
    ctx=await launch(profile)
    page=await pageOf(ctx)
    const cdp=await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions',
      {offline:false,latency:450,downloadThroughput:16384,uploadThroughput:16384})
    const started=performance.now()
    await page.goto(address,{waitUntil:'domcontentloaded',timeout:30000})
    const recovered={...(await visible(page)),...(await cacheAudit(page))}
    assert(recovered.controlled)
    recovered.ready=await page.evaluate(async()=>{
      const r=await fetch('/api/v1/readyz',{credentials:'omit',cache:'no-store'})
      return r.status===200&&(await r.json()).ok===true
    })
    assert(recovered.ready,'real readyz must recover at limited throughput')
    recovered.elapsedMs=Number((performance.now()-started).toFixed(3))
    await ctx.close();ctx=null
    return {n,persistedAcrossThreeProcesses:true,initial,offline,recovered}
  }finally{
    transportDown=false
    if(ctx)await ctx.close().catch(()=>{})
    fs.rmSync(profile,{recursive:true,force:true})
  }
}
async function main(){
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolve)
  })
  const origin='http://127.0.0.1:'+server.address().port
  const summary={schema:'xdrive-pwa-p0c3-persistent-native-chromium-before-v1',
    testedSha:process.env.XD_PR_HEAD||null,physicalIOS:false,installedHomeScreen:false,
    realWAN:false,actual100k:false,privateCache:false,afterOptimization:null,
    speedupClaim:null,samples:[],passed:false}
  try{
    for(let n=1;n<=3;n++)summary.samples.push(await runOne(n,origin))
    summary.phases=Object.fromEntries(['initial','offline','recovered'].map(key=>[key,{
      fcpP50Ms:percentile(summary.samples.map(r=>r[key].fcpMs),0.5),
      fcpP95Ms:percentile(summary.samples.map(r=>r[key].fcpMs),0.95)}]))
    assert(summary.samples.every(s=>s.persistedAcrossThreeProcesses&&
      s.initial.controlled&&s.offline.controlled&&s.recovered.controlled&&s.recovered.ready&&
      s.initial.cacheNames===2&&s.offline.cacheNames===2&&s.recovered.cacheNames===2&&
      s.initial.cacheEntries===s.offline.cacheEntries&&
      s.offline.cacheEntries===s.recovered.cacheEntries))
    assert(totals.ready>=3,'each weak-network recovery requires a real HTTP request')
    summary.transportCounts={...totals}
    summary.passed=true
  }catch(error){
    summary.errorKind=error?.name||'Error'
    console.error('PWA_P0C3_NATIVE_CHROME_ERROR '+String(error?.stack||error))
    process.exitCode=1
  }finally{
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n')
    await new Promise(resolve=>server.close(resolve))
    console.log('PWA_P0C3_NATIVE_SUMMARY '+JSON.stringify(summary))
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
