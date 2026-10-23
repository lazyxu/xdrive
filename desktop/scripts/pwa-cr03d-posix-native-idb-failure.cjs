#!/usr/bin/env node
'use strict'
// CR03d: real POSIX permission failure of a disposable Chromium IndexedDB
// profile; not a synthetic DOMException, not a physical OS disk EIO test.
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http')
const ts=require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'web/dist')
const executable=process.env.XDRIVE_BROWSER_EXECUTABLE
const output=path.resolve(process.env.XD_PWA_CR03D_OUTPUT||
 path.join(root,'desktop/pwa-cr03d-results'))
assert.equal(process.env.XD_PWA_CR03D_POSIX,'1')
assert(process.platform==='linux'&&process.getuid()!==0,'unprivileged native Linux required')
assert(executable&&fs.existsSync(executable),'real Chromium binary mandatory')
assert(fs.statSync(path.join(dist,'index.html')).isFile())
const source=fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'xd-cr03d-native-profile-'))
const dbDir=path.join(profile,'Default','IndexedDB')
const summary={schema:'xdrive-pwa-cr03d-real-posix-idb-permission-v1',
 sha:process.env.XD_PR_HEAD||'',physicalDevice:false,realChrome:false,
 nativeFilePermissionDenied:false,syntheticExceptions:false,
 originalConsentPersisted:false,originalP1Directory:false,originalP1Album:false,
 coldBrowserClosed:true,nativeIDBReadFailed:false,nativeErrorName:'not-run',
 offlineOwnerUIHidden:false,crossTabPurgeNotified:false,
 publicCachePrivateBytes:false,restoredPermissions:false,
 postRestoreHistoricalOnly:false,postRestoreNoFabricatedAuthorization:false,
 productionCodeModified:false,physicalDiskEIOTested:false,passed:false,phase:'init'}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css',
 '.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
 '.png':'image/png','.woff2':'font/woff2','.webp':'image/webp'}
const server=http.createServer((req,res)=>{
 let uri;try{uri=new URL(req.url,'http://localhost')}catch{res.writeHead(400);res.end();return}
 if(uri.pathname.startsWith('/api/')){
  res.writeHead(401,{'Cache-Control':'no-store','Content-Type':'application/json'})
  res.end('{"error":"no authentication fixture"}');return
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 let decoded;try{decoded=decodeURIComponent(uri.pathname)}catch{res.writeHead(400);res.end();return}
 if(decoded==='/')decoded='/index.html'
 if(decoded.includes('\\')||decoded.includes('\0')||decoded.includes('..')){
  res.writeHead(400);res.end();return
 }
 const filepath=path.resolve(dist,'.'+decoded)
 if(!filepath.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
 let stat;try{stat=fs.lstatSync(filepath)}catch{res.writeHead(404);res.end();return}
 if(!stat.isFile()||stat.isSymbolicLink()){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':mime[path.extname(filepath)]||'application/octet-stream',
 'Cache-Control':decoded==='/sw.js'||decoded==='/index.html'?'no-cache, must-revalidate':'public,max-age=3600',
 'Content-Length':String(stat.size),'X-Content-Type-Options':'nosniff'})
 if(req.method==='HEAD'){res.end();return}
 fs.createReadStream(filepath).pipe(res)
})
function openBrowser(){
 return chromium.launchPersistentContext(profile,{executablePath:executable,
  headless:true,viewport:{width:390,height:844},deviceScaleFactor:3,
  isMobile:true,hasTouch:true,serviceWorkers:'allow',
  args:['--no-sandbox','--disable-dev-shm-usage']})
}
async function attach(page){
 await page.addScriptTag({content:'(function(){var exports={};\n'+compiled+
  '\nwindow.__cr03dStore=exports})();'})
}
async function publicCache(page){
 return page.evaluate(async()=>{
  let publicShell=0,privateContent=0
  for(const name of await caches.keys()){
   const c=await caches.open(name)
   for(const request of await c.keys()){
    const p=new URL(request.url).pathname
    if(p.startsWith('/api/')||/thumbnail|media\/items|token|ticket|download|upload|original/i.test(p))privateContent++
    else publicShell++
   }
  }
  return {publicShell,privateContent}
 })
}
async function close(ctx){if(ctx)await ctx.close()}
async function run(){
 let ctx=null,oldMode=null
 const ownerID=42
 try{
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)})
  const origin='http://127.0.0.1:'+server.address().port
  summary.phase='real-native-Chrome-public-SW'
  ctx=await openBrowser();summary.realChrome=true
  const page=ctx.pages()[0]||await ctx.newPage()
  await page.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded'})
  await page.waitForLoadState('load')
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.active))
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
  await attach(page)
  summary.phase='original-native-IDB-records'
  const init=await page.evaluate(async ownerID=>{
   const owner={origin:location.origin,userID:ownerID,username:'synthetic-only',
    instanceID:'11111111-1111-4111-8111-111111111111'}
   const store=window.__cr03dStore
   await store.xDrivePwaSetOfflineConsent(owner,true)
   const dir=await store.xDrivePwaCaptureVisitedDirectory(owner,{id:19,name:'Archived dir',
     totalCount:1,items:[{id:20,name:'No private bytes',type:'file',revision:1}]})
   const album=await store.xDrivePwaCaptureAlbumSummaries(owner,[{
     id:'fixture-album',name:'Historic summary',kind:'manual',item_count:1,revision:1}])
   const read=await store.xDrivePwaReadOfflineDirectories(owner)
   const readAlbums=await store.xDrivePwaReadAlbumSummaries(owner)
   const hint=await store.xDrivePwaReadRelaunchOwner()
   return {dir,album,directory:read.directories[0]?.id===19&&read.revalidated===false,
     albums:readAlbums.snapshot?.albums[0]?.id==='fixture-album'&&readAlbums.revalidated===false,
     hint:hint?.userID===ownerID}
  },ownerID)
  assert(init.dir&&init.album&&init.directory&&init.albums&&init.hint)
  summary.originalConsentPersisted=true;summary.originalP1Directory=true
  summary.originalP1Album=true
  const originalCache=await publicCache(page)
  assert(originalCache.publicShell>0&&originalCache.privateContent===0)
  summary.phase='close-all-native-browser-handles'
  await close(ctx);ctx=null
  // The OS, not a JavaScript mock, rejects the next real IndexedDB open.
  const info=fs.lstatSync(dbDir)
  assert(info.isDirectory()&&!info.isSymbolicLink())
  oldMode=info.mode&0o777
  fs.chmodSync(dbDir,0o000)
  assert.equal(fs.statSync(dbDir).mode&0o777,0)
  let denied=false
  try{fs.readdirSync(dbDir)}catch(e){denied=e?.code==='EACCES'}
  assert(denied,'kernel must deny readdir on native IndexedDB directory')
  summary.nativeFilePermissionDenied=true
  summary.phase='fresh-Chrome-real-IDB-read-under-EACCES'
  ctx=await openBrowser()
  const first=ctx.pages()[0]||await ctx.newPage()
  await first.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded'})
  await attach(first)
  const second=await ctx.newPage()
  await second.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded'})
  await attach(second)
  const observed=await first.evaluate(async()=>{
   try{
    const hint=await window.__cr03dStore.xDrivePwaReadRelaunchOwner()
    return {rejected:false,hasOwner:hint!==null,errorName:'none'}
   }catch(e){
    return {rejected:true,hasOwner:false,errorName:String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32)}
   }
  })
  assert(observed.rejected&&!observed.hasOwner,
    'native IDB read must fail, never silently treat denied disk as an authorized snapshot')
  summary.nativeIDBReadFailed=true;summary.nativeErrorName=observed.errorName
  await first.locator('[data-xdrive-pwa-offline-empty]').waitFor({state:'visible',timeout:25000})
  const absent=await first.evaluate(()=>
   document.querySelectorAll('[data-xdrive-pwa-offline-item], [data-xdrive-pwa-offline-album]').length===0)
  assert(absent,'unreadable IndexedDB must never render stale Owner history')
  summary.offlineOwnerUIHidden=true
  // BroadcastChannel must clear the other window even when the disk purge
  // cannot be committed. This verifies notification, not durable deletion.
  await second.evaluate(()=>{
   window.__cr03dPeerPurge=false
   window.__cr03dPurgeStop=window.__cr03dStore.xDrivePwaObserveOfflinePurge(()=>{
    window.__cr03dPeerPurge=true
   })
  })
  const purge=await first.evaluate(async()=>{
   try{await window.__cr03dStore.xDrivePwaClearOfflineMetadata();return 'success'}
   catch{return 'failed'}
  })
  assert.equal(purge,'failed','real native EACCES must reject durable purge, not misreport success')
  await second.waitForFunction(()=>window.__cr03dPeerPurge===true,null,{timeout:12000})
  summary.crossTabPurgeNotified=true
  const cache=await publicCache(first)
  assert(cache.privateContent===0)
  summary.publicCachePrivateBytes=false
  summary.phase='restore-native-POSIX-permissions'
  await close(ctx);ctx=null
  fs.chmodSync(dbDir,oldMode);oldMode=null
  summary.restoredPermissions=true
  ctx=await openBrowser()
  const restored=ctx.pages()[0]||await ctx.newPage()
  await restored.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded'})
  await restored.locator('[data-xdrive-pwa-offline-browser]').waitFor({state:'visible',timeout:30000})
  // A deleted or recovered record is acceptable, but never assert that it
  // has been revalidated by Go during a completely unauthenticated run.
  const recovery=await restored.evaluate(()=>{
   const browser=document.querySelector('[data-xdrive-pwa-offline-browser]')
   const body=browser?.textContent||''
   return {verifiedByGo:body.includes('服务器已重新核验本目录访问权限'),
    noPrivateAPISurface:!document.querySelector('[data-xdrive-workspace-background]'),
    hist:body.includes('历史摘要')||body.includes('未经当前权限验证')||
      !document.querySelector('[data-xdrive-pwa-offline-item]')}
  })
  assert(!recovery.verifiedByGo&&recovery.noPrivateAPISurface&&recovery.hist)
  summary.postRestoreHistoricalOnly=true;summary.postRestoreNoFabricatedAuthorization=true
  summary.phase='completed';summary.passed=true
 }catch(e){
  console.error('PWA_CR03D_SAFE_FAILURE phase='+summary.phase+
   ' kind='+String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32))
  process.exitCode=1
 }finally{
  await close(ctx).catch(()=>{})
  if(oldMode!==null){try{fs.chmodSync(dbDir,oldMode)}catch{}}
  fs.rmSync(profile,{recursive:true,force:true})
  await new Promise(done=>server.close(()=>done()))
  fs.mkdirSync(output,{recursive:true,mode:0o700})
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600})
 }
}
run()
