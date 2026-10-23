#!/usr/bin/env node
'use strict'
// CR03e: genuine Linux kernel EROFS on an isolated tmpfs containing real
// Chromium IndexedDB. No injected DOMException, no user/production files.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const {spawnSync}=require('node:child_process')
const ts=require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const repo=path.resolve(__dirname,'../..'),dist=path.join(repo,'web/dist')
const runner=process.env.RUNNER_TEMP
const browserBinary=process.env.XDRIVE_BROWSER_EXECUTABLE
const output=path.resolve(process.env.XD_PWA_CR03E_OUTPUT||path.join(repo,'desktop/pwa-cr03e-results'))
assert.equal(process.env.XD_PWA_CR03E_NATIVE_EROFS,'1','isolated opt-in required')
assert(process.platform==='linux'&&process.getuid()!==0)
assert(runner&&path.isAbsolute(runner)&&fs.realpathSync(runner)===path.resolve(runner))
assert(browserBinary&&fs.existsSync(browserBinary))
assert(fs.statSync(path.join(dist,'index.html')).isFile())
const profile=path.join(runner,'pwa-cr03e-private-profile')
const dbDir=path.join(profile,'Default','IndexedDB')
assert(fs.realpathSync(profile)===profile&&fs.realpathSync(dbDir)===dbDir)
assert(fs.statSync(profile).dev!==fs.statSync(dbDir).dev,
 'actual IndexedDB must be on a distinct disposable mounted filesystem')
const compiled=ts.transpileModule(
 fs.readFileSync(path.join(repo,'web/src/pwaOfflineDirectory.ts'),'utf8'),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}
).outputText
const summary={schema:'xdrive-pwa-cr03e-kernel-erofs-v1',
 sha:process.env.XD_PR_HEAD||'',nativeChromium:false,physicalIOS:false,
 isolatedMount:true,kernelEROFS:false,mountRestored:false,
 originalConsent:false,originalDirectory:false,originalAlbum:false,
 readOnlyUIHistoricalOrEmpty:false,productWriteRejected:false,
 durablePurgeRejected:false,peerPurgeNotified:false,
 postRestoreNoNewRow:false,postRestoreNotAuthorized:false,
 publicSWOnly:false,physicalDiskEIO:false,productionCodeModified:false,
 passed:false,phase:'init',nativeIDBErrorName:'not-run'}
let readonly=false
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css',
 '.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
 '.png':'image/png','.woff2':'font/woff2'}
const server=http.createServer((req,res)=>{
 let url;try{url=new URL(req.url,'http://127.0.0.1')}catch{res.writeHead(400);res.end();return}
 if(url.pathname.startsWith('/api/')){
  res.writeHead(401,{'Cache-Control':'no-store'});res.end();return
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 let rel;try{rel=decodeURIComponent(url.pathname)}catch{res.writeHead(400);res.end();return}
 if(rel==='/')rel='/index.html'
 if(rel.includes('\\')||rel.includes('\0')||rel.includes('..')){
  res.writeHead(400);res.end();return
 }
 const file=path.resolve(dist,'.'+rel)
 if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
 let stat;try{stat=fs.lstatSync(file)}catch{res.writeHead(404);res.end();return}
 if(!stat.isFile()||stat.isSymbolicLink()){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream',
  'Content-Length':String(stat.size),'X-Content-Type-Options':'nosniff',
  'Cache-Control':rel==='/sw.js'||rel==='/index.html'?'no-cache, must-revalidate':'public,max-age=3600'})
 if(req.method==='HEAD'){res.end();return}
 fs.createReadStream(file).pipe(res)
})
const doMount=mode=>{
 assert(mode==='ro'||mode==='rw')
 const result=spawnSync('sudo',['mount','-o','remount,'+mode,dbDir],
  {timeout:12000,encoding:'utf8',shell:false})
 assert.equal(result.status,0,'fixed private tmpfs remount must succeed')
}
const openBrowser=()=>chromium.launchPersistentContext(profile,{
 executablePath:browserBinary,headless:true,
 viewport:{width:390,height:844},deviceScaleFactor:3,
 isMobile:true,hasTouch:true,serviceWorkers:'allow',
 args:['--no-sandbox','--disable-dev-shm-usage']})
const attach=page=>page.addScriptTag({content:
 '(function(){var exports={};\n'+compiled+'\nwindow.__pwaEROFSStore=exports})();'})
const ownerForPage=()=>({origin:location.origin,userID:42,username:'synthetic-only',
 instanceID:'11111111-1111-4111-8111-111111111111'})
const publicOnly=page=>page.evaluate(async()=>{
 let allowed=0
 for(const key of await caches.keys()){
  const c=await caches.open(key)
  for(const request of await c.keys()){
   const p=new URL(request.url).pathname
   if(p.startsWith('/api/')||/thumbnail|media\/items|token|ticket|upload|download|original/i.test(p))
    throw Error('private bytes in public SW CacheStorage')
   allowed++
  }
 }
 return allowed>0
})
async function main(){
 let ctx
 try{
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)})
  const origin='http://127.0.0.1:'+server.address().port
  summary.phase='seed-real-opted-in-native-IndexedDB'
  ctx=await openBrowser();summary.nativeChromium=true
  const page=ctx.pages()[0]||await ctx.newPage()
  await page.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded'})
  await page.waitForLoadState('load')
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.active))
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
  await attach(page)
  const seeded=await page.evaluate(async()=>{
   const owner={origin:location.origin,userID:42,username:'synthetic-only',
    instanceID:'11111111-1111-4111-8111-111111111111'}
   const s=window.__pwaEROFSStore
   await s.xDrivePwaSetOfflineConsent(owner,true)
   const d=await s.xDrivePwaCaptureVisitedDirectory(owner,{id:19,name:'original',
    totalCount:1,items:[{id:20,name:'authorized-then-historical',type:'file',revision:1}]})
   const a=await s.xDrivePwaCaptureAlbumSummaries(owner,[{
    id:'original-album',name:'historical only',kind:'manual',item_count:1,revision:1}])
   const rd=await s.xDrivePwaReadOfflineDirectories(owner)
   const ra=await s.xDrivePwaReadAlbumSummaries(owner)
   return {d,a,dir:rd.revalidated===false&&rd.directories[0]?.items[0]?.id===20,
    album:ra.revalidated===false&&ra.snapshot?.albums[0]?.id==='original-album'}
  })
  assert(seeded.d&&seeded.a&&seeded.dir&&seeded.album)
  summary.originalConsent=true;summary.originalDirectory=true;summary.originalAlbum=true
  assert(await publicOnly(page));summary.publicSWOnly=true
  await ctx.close();ctx=null
  const nativeFiles=fs.readdirSync(dbDir)
  assert(nativeFiles.some(x=>x.endsWith('.indexeddb.leveldb')||x.endsWith('.indexeddb.blob')),
   'real Chromium storage must actually be located in mounted IndexedDB directory')
  summary.phase='kernel-remount-to-read-only'
  doMount('ro');readonly=true
  let errno='none'
  try{fs.writeFileSync(path.join(dbDir,'__erofs_syscall_probe__'),'x',{flag:'wx'})}
  catch(e){errno=e?.code||'unknown'}
  assert.equal(errno,'EROFS','Linux kernel, not JavaScript, must return EROFS')
  summary.kernelEROFS=true
  summary.phase='cold-Chromium-under-kernel-EROFS'
  ctx=await openBrowser()
  const first=ctx.pages()[0]||await ctx.newPage()
  await first.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded'})
  await attach(first)
  const peer=await ctx.newPage()
  await peer.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded'})
  await attach(peer)
  await first.locator('[data-xdrive-pwa-offline-browser]').waitFor({state:'visible',timeout:25000})
  const historical=await first.evaluate(()=>{
   const b=document.querySelector('[data-xdrive-pwa-offline-browser]')
   const text=b?.textContent||''
   return {noGoAuthorization:!text.includes('服务器已重新核验本目录访问权限'),
    readonlyOrEmpty:text.includes('历史摘要')||text.includes('未经当前权限验证')||
     Boolean(document.querySelector('[data-xdrive-pwa-offline-empty]')),
    noLiveWorkspace:!document.querySelector('[data-xdrive-workspace-background]')}
  })
  assert(historical.noGoAuthorization&&historical.readonlyOrEmpty&&historical.noLiveWorkspace)
  summary.readOnlyUIHistoricalOrEmpty=true
  summary.phase='native-P1-write-must-not-claim-commit'
  const write=await first.evaluate(async()=>{
   const owner={origin:location.origin,userID:42,username:'synthetic-only',
    instanceID:'11111111-1111-4111-8111-111111111111'}
   try{
    const accepted=await window.__pwaEROFSStore.xDrivePwaCaptureVisitedDirectory(owner,{
     id:19,name:'new-but-forbidden',totalCount:1,
     items:[{id:99999,name:'never authorized',type:'file',revision:2}]})
    return {accepted:accepted===true,name:'none'}
   }catch(e){return {accepted:false,name:String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32)}}
  })
  assert.equal(write.accepted,false,'EROFS cannot be misreported as committed P1 history')
  summary.productWriteRejected=true;summary.nativeIDBErrorName=write.name
  await peer.evaluate(()=>{
   window.__eroPeerPurge=false
   window.__eroStop=window.__pwaEROFSStore.xDrivePwaObserveOfflinePurge(()=>{
    window.__eroPeerPurge=true
   })
  })
  summary.phase='native-readonly-durable-clear-must-fail-and-notify'
  const clear=await first.evaluate(async()=>{
   try{await window.__pwaEROFSStore.xDrivePwaClearOfflineMetadata();return true}
   catch{return false}
  })
  assert.equal(clear,false,'EROFS purge must not falsely report durable deletion')
  summary.durablePurgeRejected=true
  await peer.waitForFunction(()=>window.__eroPeerPurge===true,null,{timeout:12000})
  summary.peerPurgeNotified=true
  assert(await publicOnly(first))
  summary.phase='restore-filesystem-and-restart-fresh-Chromium'
  await ctx.close();ctx=null
  doMount('rw');readonly=false
  const proof=path.join(dbDir,'__rw_syscall_probe__')
  fs.writeFileSync(proof,'ok',{flag:'wx'});fs.unlinkSync(proof)
  summary.mountRestored=true
  ctx=await openBrowser()
  const restored=ctx.pages()[0]||await ctx.newPage()
  await restored.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded'})
  await restored.locator('[data-xdrive-pwa-offline-browser]').waitFor({state:'visible',timeout:30000})
  const after=await restored.evaluate(()=>{
   const b=document.querySelector('[data-xdrive-pwa-offline-browser]')
   const text=b?.textContent||''
   return {stillNotAuthorized:!text.includes('服务器已重新核验本目录访问权限')&&
    !document.querySelector('[data-xdrive-workspace-background]'),
    oldOrEmpty:text.includes('历史摘要')||text.includes('未经当前权限验证')||
      Boolean(document.querySelector('[data-xdrive-pwa-offline-empty]')),
    noForbiddenRow:![...document.querySelectorAll('[data-xdrive-pwa-offline-item]')]
      .some(x=>x.textContent?.includes('never authorized'))}
  })
  assert(after.stillNotAuthorized&&after.oldOrEmpty&&after.noForbiddenRow)
  summary.postRestoreNotAuthorized=true;summary.postRestoreNoNewRow=true
  summary.phase='completed';summary.passed=true
 }catch(e){
  console.error('PWA_CR03E_SAFE_FAILURE phase='+summary.phase+
   ' kind='+String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32))
  process.exitCode=1
 }finally{
  await ctx?.close().catch(()=>{})
  if(readonly)try{doMount('rw')}catch{
   console.error('PWA_CR03E_PRIVATE_MOUNT_RESTORE_FAILED');process.exitCode=1
  }
  await new Promise(resolve=>server.close(()=>resolve()))
  fs.mkdirSync(output,{recursive:true,mode:0o700})
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600})
 }
}
main()
