#!/usr/bin/env node
'use strict'
// CR03c: genuine Chromium IndexedDB exhaustion on an OS-limited tmpfs.
// No synthetic JS QuotaExceededError, no privileged/production Owner data.
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http')
const ts=require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const root=path.resolve(__dirname,'../..')
const mount=fs.realpathSync(process.env.XD_PWA_CR03C_LIMITED_MOUNT||'')
const chrome=process.env.XDRIVE_BROWSER_EXECUTABLE
assert.equal(process.env.XD_PWA_CR03C_REAL_FS,'1')
assert(chrome&&fs.existsSync(chrome))
const disk=()=>{const s=fs.statfsSync(mount);return {total:s.blocks*s.bsize,free:s.bavail*s.bsize}}
assert(disk().total<=3*1024*1024*1024 && disk().total>=1536*1024*1024,
 'the browser MUST run on an OS bounded scratch filesystem')
const profile=path.join(mount,'chrome-profile')
fs.mkdirSync(profile,{recursive:true,mode:0o700})
const output=path.resolve(process.env.XD_PWA_CR03C_OUTPUT||path.join(root,'desktop/pwa-cr03c-results'))
fs.mkdirSync(output,{recursive:true,mode:0o700})
const dist=path.join(root,'web/dist')
const compiled=ts.transpileModule(
 fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8'),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}
).outputText
const summary={
 phase:'init',commit:process.env.XD_PR_HEAD||'',
 nativeChrome:false,physicalFilesystemCap:true,
 actualBrowserQuotaError:false,nativeError:'not-run',
 nativeWriteRejected:false,nativeQuotaFailClosed:false, nativeQuotaProbeAttempts:0, browserOriginQuotaEstimate:null,
 productRejected:false,oldHistoryIntact:false,
 explicitConsent:false,publicSWOnly:false,physicalDevice:false,
 goACLTestedHere:false,passed:false,syntheticIDBBytes:0,initialScratchBytes:null,physicalStorageBytes:null,
 remainingScratchBytes:null
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript',
 '.css':'text/css','.webmanifest':'application/manifest+json',
 '.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}
const server=http.createServer((req,res)=>{
 let pathname
 try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}
 catch {res.writeHead(400);res.end();return}
 if(pathname.startsWith('/api/')){res.writeHead(401,{'Cache-Control':'no-store'});res.end();return}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 if(pathname==='/')pathname='/index.html'
 if(pathname.includes('\\')||pathname.includes('\0')){res.writeHead(400);res.end();return}
 const target=path.resolve(dist,'.'+pathname)
 if(!target.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
 let st;try{st=fs.statSync(target)}catch{res.writeHead(404);res.end();return}
 if(!st.isFile()){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream',
 'Cache-Control':pathname==='/sw.js'||pathname==='/index.html'?'no-cache, must-revalidate':'public,max-age=3600',
 'Content-Length':String(st.size)})
 if(req.method==='HEAD'){res.end();return}
 fs.createReadStream(target).pipe(res)
})
async function connect(page) {
 await page.addScriptTag({content:'(function(){var exports={};\n'+compiled+
   '\nwindow.__quotaStore=exports})();'})
}
async function cachePublic(page){
 return page.evaluate(async()=>{
  let publicCount=0
  for(const key of await caches.keys()){
   const c=await caches.open(key)
   for(const req of await c.keys()){
    const p=new URL(req.url).pathname
    if(p.startsWith('/api/')||/token|ticket|media|upload|download/i.test(p))
      return false
    publicCount++
   }
  }
  return publicCount>0
 })
}
// Keep real OS headroom so quota-manager rejection, not ENOSPC, is being
// exercised. Chromium itself performs every IDBTransaction; no fake exceptions.
async function browserNativeWrite(page,ordinal,bytes) {
 return page.evaluate(async ({ordinal,bytes})=>{
   const db=await new Promise((yes,no)=>{
     const r=indexedDB.open('xdrive-pwa-offline-metadata-v2',1)
     r.onsuccess=()=>yes(r.result)
     r.onerror=()=>no(r.error)
   })
   try {
     return await new Promise(resolve=>{
       let tx,put
       try {
         tx=db.transaction('owner-scopes','readwrite')
         put=tx.objectStore('owner-scopes').put({
           key:'__cr03c_native_quota_probe_'+ordinal,
           value:(()=>{
             const result=new Uint8Array(bytes)
             // The original zero-filled values compressed instead of
             // physically exercising the OS-limited quota.
             for(let offset=0;offset<result.length;offset+=65536)
               crypto.getRandomValues(result.subarray(offset,Math.min(offset+65536,result.length)))
             return result
           })()
         })
       }catch(error){resolve({committed:false,name:error?.name||'Error'});return}
       let requestError=null
       put.onerror=()=>{requestError=put.error?.name||'Error'}
       tx.oncomplete=()=>resolve({committed:true,name:'none'})
       tx.onabort=()=>resolve({committed:false,
         name:requestError||tx.error?.name||'Error'})
       tx.onerror=()=>{}
     })
   }finally{db.close()}
 },{ordinal,bytes})
}
async function exhaustNativeOriginQuota(page) {
 const initial=disk().free
 summary.initialScratchBytes=initial
 const usage=await page.evaluate(async()=>navigator.storage.estimate())
 summary.browserOriginQuotaEstimate=Number.isSafeInteger(usage.quota)?usage.quota:null
 let ordinal=0
 const stages=[
   [8*1024*1024,224],
   [1024*1024,12],
   [64*1024,20],
   [1024,20],
 ]
 for(const [bytes,maxWrites] of stages){
   let rejected=false
   for(let attempt=0;attempt<maxWrites;attempt++){
     // Stop BEFORE the OS itself runs out of disk; otherwise Chrome may
     // legitimately surface DataError / UnknownError rather than quota.
     const remaining=disk().free
     summary.remainingScratchBytes=remaining
     if(remaining<32*1024*1024)
       return {committed:false,name:'PhysicalHeadroomLow',attempts:ordinal}
     const outcome=await browserNativeWrite(page,ordinal++,bytes)
     summary.nativeQuotaProbeAttempts=ordinal
     summary.physicalStorageBytes=Math.max(0,initial-disk().free)
     if(outcome.committed){
       summary.syntheticIDBBytes+=bytes
       summary.physicalStorageBytes=Math.max(0,initial-disk().free)
       continue
     }
     if(outcome.name!=='QuotaExceededError')
       return {committed:false,name:outcome.name,attempts:ordinal}
     rejected=true
     break
   }
   if(!rejected)
     return {committed:false,name:'OriginQuotaNotReached',attempts:ordinal}
 }
 return {committed:false,name:'QuotaExceededError',attempts:ordinal}
}

async function main(){
 let context=null
 try{
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)})
  const origin='http://127.0.0.1:'+server.address().port
  summary.phase='real-Chromium-launch-with-tmpfs-user-data-dir'
  context=await chromium.launchPersistentContext(profile,{
    executablePath:chrome,headless:true,viewport:{width:390,height:844},
    isMobile:true,hasTouch:true,serviceWorkers:'allow',
    args:['--no-sandbox','--disable-dev-shm-usage']
  })
  summary.nativeChrome=true
  const page=context.pages()[0]||await context.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.active))
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
  await connect(page)
  summary.publicSWOnly=await cachePublic(page)
  assert(summary.publicSWOnly)
  summary.phase='original-consented-history'
  const saved=await page.evaluate(async()=>{
   const app=window.__quotaStore
   const owner={origin:location.origin,userID:733,username:'scratch-owner',
     instanceID:'11111111-1111-4111-8111-111111111111'}
   window.__quotaOwner=owner
   await app.xDrivePwaSetOfflineConsent(owner,true)
   if(!await app.xDrivePwaCaptureVisitedDirectory(owner,{id:10,name:'Before disk pressure',
     items:[{id:11,name:'Original row',type:'file',revision:1}],totalCount:1}))
     throw Error('initial real IndexedDB capture did not commit')
   return (await app.xDrivePwaReadOfflineDirectories(owner)).directories[0]?.items[0]?.id===11
  })
  assert(saved);summary.explicitConsent=true
  summary.phase='origin-quota-manager-with-real-IDB-writes'
  const native=await exhaustNativeOriginQuota(page)
  summary.nativeError=typeof native.name==='string' &&
    /^[A-Za-z]{1,48}$/.test(native.name)?native.name:'other'
  summary.nativeWriteRejected=!native.committed
  summary.actualBrowserQuotaError=native.name==='QuotaExceededError'
  assert(summary.actualBrowserQuotaError,
    'Chrome did not produce a native quota error with 32MiB real OS headroom')
  summary.phase='production-P1-capture-under-native-Origin-quota'
  const attempt=await page.evaluate(async()=>{
    const app=window.__quotaStore,owner=window.__quotaOwner
    let accepted=false,rejected=false,kind='none'
    try{accepted=await app.xDrivePwaCaptureVisitedDirectory(owner,{
      id:10,name:'Attempted replacement after real disk limit',totalCount:20000,
      items:Array.from({length:20},(_,i)=>({
        id:i+700,type:'file',name:'配额'.repeat(64),revision:2}))
    })}catch(e){rejected=true;kind=typeof e?.name==='string'?
      e.name.replace(/[^A-Za-z]/g,'').slice(0,48):'other'}
    return {rejected,accepted,kind}
  })
  summary.productRejected=attempt.rejected&&!attempt.accepted
  summary.phase='remove-only-test-scratch-pressure-and-verify-history'
  // The product must fail while pressure is active, then recover access to
  // the pre-existing record once only the disposable ballast is removed.
  await new Promise(resolve=>setTimeout(resolve,150))
  const preserved=await page.evaluate(async()=>{
    const app=window.__quotaStore,owner=window.__quotaOwner
    try{
      const snap=await app.xDrivePwaReadOfflineDirectories(owner)
      return snap.revalidated===false &&
        snap.directories.some(d=>d.items.some(i=>i.id===11)) &&
        !snap.directories.some(d=>d.items.some(i=>i.id>=700&&i.id<720))
    }catch{return false}
  })
  summary.oldHistoryIntact=preserved
  summary.nativeQuotaFailClosed=summary.nativeWriteRejected &&
    summary.productRejected && summary.oldHistoryIntact
  assert(summary.nativeQuotaFailClosed,
    'native browser quota handling did not preserve the preexisting opt-in history')
  // A real OS UnknownError is NOT the specific QuotaExceededError acceptance.
  // Keep this strict to make the quota work visible rather than fake green.
  assert.equal(summary.nativeError,'QuotaExceededError',
    'browser Origin quota was not confirmed: no fake quota acceptance')
  summary.passed=true;summary.phase='completed'
 }catch(e){
  console.error('PWA_CR03C_SAFE_FAILURE phase='+summary.phase+
    ' category='+String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32))
  process.exitCode=1
 }finally{
  await context?.close().catch(()=>{})
  await new Promise(resolve=>server.close(()=>resolve()))
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600})
 }
}
main()
