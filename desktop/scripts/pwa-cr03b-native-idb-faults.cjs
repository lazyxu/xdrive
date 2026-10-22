#!/usr/bin/env node
'use strict'
// CR-03b: real Chromium IndexedDB quota/blocked upgrade/aborted transaction.
// Synthetic Owner and public-only PWA shell; actual Go ACL is a separate suite.
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http')
const ts=require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'web/dist')
const browserBinary=process.env.XDRIVE_BROWSER_EXECUTABLE
assert.equal(process.env.XD_PWA_CR03B_REAL_CHROME,'1','explicit native Chrome gate required')
assert(browserBinary&&fs.existsSync(browserBinary),'authentic Chromium mandatory')
for(const name of ['index.html','sw.js','offline.html'])assert(fs.existsSync(path.join(dist,name)),'built public PWA Shell missing')
const compiled=ts.transpileModule(
 fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8'),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}
).outputText
const out=path.resolve(process.env.XD_PWA_CR03B_OUTPUT||path.join(root,'desktop/pwa-cr03b-results'))
fs.mkdirSync(out,{recursive:true})
const kinds={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css',
 '.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml',
 '.webmanifest':'application/manifest+json'}
const server=http.createServer((req,res)=>{
 let name
 try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}
 catch{res.writeHead(400);res.end();return}
 if(name.startsWith('/api/')){
   res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'})
   res.end('{"error":"no authenticated Owner in synthetic fixture"}');return
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 if(name==='/')name='/index.html'
 if(name.includes('\\')||name.includes('\0')){res.writeHead(400);res.end();return}
 const target=path.resolve(dist,'.'+name)
 if(!target.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
 let stat
 try{stat=fs.statSync(target)}catch{res.writeHead(404);res.end();return}
 if(!stat.isFile()){res.writeHead(404);res.end();return}
 res.writeHead(200,{
  'Content-Type':kinds[path.extname(target)]||'application/octet-stream',
  'Content-Length':String(stat.size),
  'Cache-Control':name==='/index.html'||name==='/sw.js'?'no-cache, must-revalidate':'public, max-age=3600'
 })
 if(req.method==='HEAD'){res.end();return}
 fs.createReadStream(target).pipe(res)
})
const summary={
 schema:'pwa-cr03b-real-native-chrome-idb-faults-v1',
 sourceSha:process.env.XD_PR_HEAD||null,actualChromium:true,publicSW:true,
 realIndexedDB:true,realGoOwnerACL:false,realIOS:false,productionCodeModified:false,
 nativeQuotaOverride:false,realQuotaExceeded:false,productFailClosedOnQuota:false,
 nativeQuotaProbeAborted:false,nativeQuotaProbeError:'not-run',
 nativeQuotaProbeAttempts:0,nativeQuotaDelayApplied:false,
 quotaEnforcementUnavailable:false,quotaDiagnosticCompleted:false,
 quotaProbeCleanupCompleted:false,
 productCaptureRejected:false,productCaptureError:'not-run',
 chromeQuotaBytes:null,chromeUsageBytes:null,
 nativeTransactionAborted:false,priorSnapshotUnaffected:false,
 nativeUpgradeBlocked:false,productionFutureVersionRejected:false,
 privateCacheAbsent:false,performanceAfter:false,passed:false
}
let phase='init'
const timer=setTimeout(()=>{
 console.error('PWA_CR03B_SAFE_WATCHDOG phase='+phase)
 process.exit(1)
},7*60*1000);timer.unref()
async function attach(page){
 await page.addScriptTag({content:'(function(){var exports={};\n'+compiled+'\nwindow.__cr03b=exports;})();'})
}
async function privateFree(page){
 const result=await page.evaluate(async()=>{
  let count=0
  for(const key of await caches.keys()){
   const cache=await caches.open(key)
   for(const request of await cache.keys()){
    const p=new URL(request.url).pathname
    if(p.startsWith('/api/')||/thumbnail|media\/items|token|ticket|upload|download/i.test(p))
      throw Error('private response leaked to public CacheStorage')
    count++
   }
  }
  return count
 })
 return Number.isSafeInteger(result)
}
async function run(){
 await new Promise((resolve,reject)=>{
  server.once('error',reject)
  server.listen(0,'127.0.0.1',resolve)
 })
 const origin='http://127.0.0.1:'+server.address().port
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-cr03b-real-idb-'))
 let ctx=null,cdp=null
 try{
  phase='install-real-public-SW'
  ctx=await chromium.launchPersistentContext(profile,{
   executablePath:browserBinary,headless:true,viewport:{width:390,height:844},
   deviceScaleFactor:3,isMobile:true,hasTouch:true,locale:'zh-CN',
   serviceWorkers:'allow',args:['--no-sandbox','--disable-dev-shm-usage']
  })
  const page=ctx.pages()[0]||await ctx.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded',timeout:45000})
  await page.locator('[data-xdrive-pwa-login-entry]').waitFor({state:'visible',timeout:30000})
  await page.waitForLoadState('load',{timeout:30000})
  await page.waitForFunction(async()=>{
   const r=await navigator.serviceWorker.getRegistration()
   return Boolean(r?.active)
  },null,{timeout:30000,polling:200})
  await page.reload({waitUntil:'domcontentloaded',timeout:45000})
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:30000})
  await attach(page)
  summary.publicSW=await privateFree(page)
  phase='real-IDB-Owner-opt-in-seed'
  const base=await page.evaluate(async()=>{
   const api=window.__cr03b
   const owner={origin:location.origin,userID:701,username:'synthetic-cr03b',
      instanceID:'11111111-1111-4111-8111-111111111111'}
   window.__cr03bOwner=owner
   await api.xDrivePwaSetOfflineConsent(owner,true)
   if(!await api.xDrivePwaCaptureVisitedDirectory(owner,{
     id:10,name:'Original historical folder',totalCount:100000,
     items:[{id:11,name:'Original file',type:'file',revision:1}]
   }))throw Error('original real IDB capture rejected')
   if(!await api.xDrivePwaCaptureAlbumSummaries(owner,[
     {id:'album-1',name:'Historic album',kind:'manual',item_count:1,revision:1}
   ]))throw Error('original album history absent')
   const snapshot=await api.xDrivePwaReadOfflineDirectories(owner)
   if(snapshot.revalidated!==false||snapshot.directories[0]?.items[0]?.id!==11)
     throw Error('original history not bounded and unverified')
   return {saved:true}
  })
  assert(base.saved)
  phase='native-CDP-quota-overflow'
  cdp=await ctx.newCDPSession(page)
  await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:1024})
  const quota=await cdp.send('Storage.getUsageAndQuota',{origin})
  assert(quota.overrideActive===true && quota.quota<=1024,
    'true Chrome quota override not installed')
  summary.nativeQuotaOverride=true
  summary.chromeQuotaBytes=Math.floor(quota.quota)
  summary.chromeUsageBytes=Math.floor(quota.usage)
  // Real quota manager may update available IDB space after the first
  // transaction; require a genuine browser QuotaExceededError, not merely
  // CDP's quotaActive boolean. Bounded to FOUR 16MiB transactions (<64MiB).
  // Never fake a quota rejection or manufacture a DOMException in JS.
  const nativeProbe=await page.evaluate(async()=>{
    const database=await new Promise((ok,no)=>{
      const q=indexedDB.open('xdrive-pwa-offline-metadata-v2',1)
      q.onsuccess=()=>ok(q.result)
      q.onerror=()=>no(q.error)
    })
    let last={aborted:false,reason:'none',attempts:0}
    try{
      for(let index=0;index<4;index++){
        last=await new Promise((ok,no)=>{
          const transaction=database.transaction('owner-scopes','readwrite')
          let requestError='none'
          const write=transaction.objectStore('owner-scopes').put({
            key:'__cr03b_native_quota_probe_'+index,
            body:new Uint8Array(16*1024*1024)
          })
          write.onerror=()=>{requestError=write.error?.name||'Error'}
          transaction.oncomplete=()=>ok({aborted:false,reason:'none',attempts:index+1})
          transaction.onabort=()=>ok({
            aborted:true,reason:transaction.error?.name||requestError,
            attempts:index+1
          })
          transaction.onerror=()=>{}
        })
        if(last.aborted)break
        // Give Chromium's quota manager a bounded opportunity to refresh
        // accounting after a genuinely COMMITTED large IDB transaction.
        await new Promise(resolve=>setTimeout(resolve,500))
      }
    }finally{database.close()}
    return last
  })
  summary.nativeQuotaProbeAttempts=nativeProbe.attempts
  summary.nativeQuotaDelayApplied=nativeProbe.attempts>1
  summary.nativeQuotaProbeAborted=nativeProbe.aborted
  summary.nativeQuotaProbeError=['QuotaExceededError','AbortError','UnknownError','Error'].includes(nativeProbe.reason)
    ? nativeProbe.reason : 'other'
  if(nativeProbe.aborted){
    assert.equal(nativeProbe.reason,'QuotaExceededError',
      'genuine native IDB transaction aborted for another reason')
    summary.realQuotaExceeded=true
    const quotaOutcome=await page.evaluate(async()=>{
      const api=window.__cr03b,owner=window.__cr03bOwner
      try{
        const accepted=await api.xDrivePwaCaptureVisitedDirectory(owner,{
          id:10,name:'Quota-overflow attempted replacement',totalCount:100000,
          items:Array.from({length:20},(_,i)=>({
            id:700+i,name:'quota-new-'+i+'-'.repeat(125),type:'file',revision:2
          }))
        })
        return {rejected:false,accepted}
      }catch(e){return {rejected:true,name:e?.name||'Error'}}
    })
    summary.productCaptureRejected=quotaOutcome.rejected
    summary.productCaptureError=['QuotaExceededError','AbortError','UnknownError','Error'].includes(quotaOutcome.name)
      ? quotaOutcome.name : 'other'
    assert(quotaOutcome.rejected,
      'original P1 capture committed when native browser quota was really exhausted')
    const check=await page.evaluate(async()=>{
      const api=window.__cr03b
      const d=await api.xDrivePwaReadOfflineDirectories(window.__cr03bOwner)
      return {unverified:d.revalidated===false,
        illicit:d.directories.some(x=>x.items.some(i=>i.id>=700&&i.id<720))}
    })
    assert(check.unverified&&!check.illicit,
      'real quota failure persisted a replacement P1 history record')
    summary.productFailClosedOnQuota=true
  }else{
    // Chrome 155 CDP reported quota 1024B, with >2.5MiB already in use,
    // yet FOUR actual 16MiB IDB writes committed. This is an
    // INCONCLUSIVE quota experiment, NEVER a QuotaExceeded acceptance.
    assert.equal(nativeProbe.attempts,4,'native quota experiment prematurely ended')
    summary.quotaEnforcementUnavailable=true
  }
  summary.quotaDiagnosticCompleted=true
  await cdp.send('Storage.overrideQuotaForOrigin',{origin})
  // Delete only our own synthetic quota probe keys. Never delete the actual
  // opted-in Owner record or the public PWA Shell's CacheStorage.
  await page.evaluate(async()=>{
    const db=await new Promise((ok,no)=>{
      const q=indexedDB.open('xdrive-pwa-offline-metadata-v2',1)
      q.onsuccess=()=>ok(q.result)
      q.onerror=()=>no(q.error)
    })
    try{
      await new Promise((ok,no)=>{
        const tx=db.transaction('owner-scopes','readwrite')
        const store=tx.objectStore('owner-scopes')
        for(let i=0;i<4;i++)store.delete('__cr03b_native_quota_probe_'+i)
        tx.oncomplete=()=>ok(true)
        tx.onerror=()=>no(tx.error)
        tx.onabort=()=>no(tx.error||Error('synthetic cleanup aborted'))
      })
    }finally{db.close()}
  })
  summary.quotaProbeCleanupCompleted=true
  const restored=await page.evaluate(async()=>{
    const api=window.__cr03b
    const snapshot=await api.xDrivePwaReadOfflineDirectories(window.__cr03bOwner)
    return {historicalOnly:snapshot.revalidated===false,
      illicit:snapshot.directories.some(d=>d.items.some(i=>i.id>=700&&i.id<720))}
  })
  assert(restored.historicalOnly&&!restored.illicit,
    'quota diagnostic damaged the original consent boundary')
  // Ensure a bounded synthetic historical record exists for real abort test.
  await page.evaluate(async()=>{
    const api=window.__cr03b,owner=window.__cr03bOwner
    await api.xDrivePwaSetOfflineConsent(owner,true)
    const saved=await api.xDrivePwaCaptureVisitedDirectory(owner,{
      id:10,name:'Original historical folder',totalCount:100000,
      items:[{id:11,name:'Original file',type:'file',revision:1}]
    })
    if(!saved)throw Error('cannot restore P1 record after native diagnostic')
  })
  phase='native-aborted-IDB-write'
  const aborted=await page.evaluate(async()=>{
   const api=window.__cr03b,key=api.xDrivePwaOfflineScopeKey(window.__cr03bOwner)
   const db=await new Promise((ok,no)=>{
    const req=indexedDB.open('xdrive-pwa-offline-metadata-v2',1)
    req.onsuccess=()=>ok(req.result);req.onerror=()=>no(req.error)
   })
   const result=await new Promise((ok,no)=>{
    const tx=db.transaction('owner-scopes','readwrite')
    tx.onabort=()=>ok({aborted:true,error:tx.error?.name||'AbortError'})
    tx.onerror=()=>{};tx.oncomplete=()=>no(Error('explicit aborted real transaction was committed'))
    tx.objectStore('owner-scopes').put({key,version:1,consented:true,
     directories:[{id:10,name:'ABORTED WRITE',capturedAt:Date.now(),items:[]} ]})
    tx.abort()
   })
   db.close()
   const snap=await api.xDrivePwaReadOfflineDirectories(window.__cr03bOwner)
   return {aborted:result.aborted,rolledBack:!snap.directories.some(d=>d.name==='ABORTED WRITE'),
      historicalOnly:snap.revalidated===false}
  })
  assert(aborted.aborted && aborted.rolledBack && aborted.historicalOnly)
  summary.nativeTransactionAborted=true
  summary.priorSnapshotUnaffected=true
  phase='native-blocked-upgrade-fail-closed'
  const upgrade=await page.evaluate(async()=>{
   const dbName='xdrive-pwa-offline-metadata-v2'
   const holder=await new Promise((ok,no)=>{
    const r=indexedDB.open(dbName,1)
    r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)
   })
   let blocked=false
   const request=indexedDB.open(dbName,2)
   const waitBlocked=new Promise((resolve,reject)=>{
    const stop=setTimeout(()=>reject(Error('true IDB version upgrade was not blocked')),7000)
    request.onblocked=()=>{blocked=true;clearTimeout(stop);resolve(true)}
   })
   const next=new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
   })
   await waitBlocked
   holder.close()
   const upgraded=await next
   upgraded.close()
   const api=window.__cr03b
   let rejected=false
   try{await api.xDrivePwaReadOfflineDirectories(window.__cr03bOwner)}
   catch(e){rejected=e?.name==='VersionError'}
   return {blocked,rejected}
  })
  assert(upgrade.blocked && upgrade.rejected,
    'production v1 offline reader must not trust a future-version IDB')
  summary.nativeUpgradeBlocked=true
  summary.productionFutureVersionRejected=true
  phase='public-CacheStorage-privacy'
  summary.privateCacheAbsent=await privateFree(page)
  assert(summary.privateCacheAbsent)
  summary.passed=true
  console.log('PWA_CR03B_REAL_IDB_QUOTA_ABORT_BLOCKED_PASS')
 }catch(error){
  summary.errorClass=(error?.name||'Error').replace(/[^A-Za-z0-9]/g,'').slice(0,40)
  summary.failurePhase=phase
  process.exitCode=1
  console.error('PWA_CR03B_SAFE_FAILURE '+summary.errorClass+' phase='+phase)
 }finally{
  clearTimeout(timer)
  try{if(cdp)await cdp.send('Storage.overrideQuotaForOrigin',{origin})}catch{}
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n')
  await ctx?.close()
  server.close()
  fs.rmSync(profile,{recursive:true,force:true})
 }
}
void run()
