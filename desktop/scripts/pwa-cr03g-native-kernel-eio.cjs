#!/usr/bin/env node
'use strict'
// CR03g: genuine dm-error Linux block EIO on a disposable loopback ext4
// containing native Chromium IndexedDB. No forged JS errors or user files.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const {spawnSync}=require('node:child_process')
const ts=require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const repo=path.resolve(__dirname,'../..'),dist=path.join(repo,'web/dist')
const runner=process.env.RUNNER_TEMP
const browserBinary=process.env.XDRIVE_BROWSER_EXECUTABLE
const output=path.resolve(process.env.XD_PWA_CR03G_OUTPUT||path.join(repo,'desktop/pwa-cr03g-results'))
assert.equal(process.env.XD_PWA_CR03G_NATIVE_EIO,'1','isolated opt-in required')
assert(process.platform==='linux'&&process.getuid()!==0)
assert(runner&&path.isAbsolute(runner)&&fs.realpathSync(runner)===path.resolve(runner))
assert(browserBinary&&fs.existsSync(browserBinary))
assert(fs.statSync(path.join(dist,'index.html')).isFile())
const profile=path.join(runner,'xdrive-pwa-cr03g-private','pwa-cr03g-private-profile')
const dbDir=path.join(profile,'Default','IndexedDB')
assert(fs.realpathSync(profile)===profile&&fs.realpathSync(dbDir)===dbDir)
assert(fs.statSync(profile).dev!==fs.statSync(dbDir).dev,
 'actual IndexedDB must be on a distinct disposable mounted filesystem')
const compiled=ts.transpileModule(
 fs.readFileSync(path.join(repo,'web/src/pwaOfflineDirectory.ts'),'utf8'),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}
).outputText
const summary={schema:'xdrive-pwa-cr03g-chromium-kernel-block-eio-v1',
 sha:process.env.XD_PR_HEAD||'',nativeChromium:false,physicalIOS:false,
 isolatedMount:true,kernelEIO:false,mountRestored:false,chromiumIndexedDBTested:false,
 originalConsent:false,originalDirectory:false,originalAlbum:false,
 readOnlyUIHistoricalOrEmpty:false,productWriteRejected:false,
 durablePurgeRejected:false,peerPurgeNotified:false,
 postRestoreNoNewRow:false,postRestoreNotAuthorized:false,
 publicSWOnly:false,physicalDiskEIO:false,productionCodeModified:false,nativeIDBFailureObserved:false,
 passed:false,phase:'init',nativeIDBErrorName:'not-run'}
let faulted=false
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
// Test-only privileged operations are constrained to the exact disposable
// device-mapper name derived from GitHub's numerical RUN_ID, never user paths.
assert.equal(process.env.GITHUB_ACTIONS,'true')
const runID=process.env.GITHUB_RUN_ID||''
assert(/^\d{1,20}$/.test(runID))
const dmName='xd-pwa-cr03g-'+runID
const loopDev=process.env.XD_PWA_CR03G_LOOP_DEV
assert.equal(process.env.XD_PWA_CR03G_DM_NAME,dmName)
assert(/^\/dev\/loop\d+$/.test(loopDev||''))
const mapper='/dev/mapper/'+dmName
assert(fs.statSync(mapper).isBlockDevice(),'isolated block mapper is missing')
const execute=(args,timeout=12000)=>{
 const ret=spawnSync('sudo',args,{encoding:'utf8',timeout,shell:false})
 assert.equal(ret.status,0,'isolated kernel device operation rejected')
 return ret
}
const sectors=Number(execute(['blockdev','--getsz',loopDev]).stdout.trim())
assert(Number.isSafeInteger(sectors)&&sectors>=262144&&sectors<=1048576)
const changeBlock=(mode)=>{
 assert(mode==='linear'||mode==='error')
 execute(['timeout','12s','dmsetup','suspend','--noflush',dmName],15000)
 try{
  const table=mode==='error'?`0 ${sectors} error`:`0 ${sectors} linear ${loopDev} 0`
  execute(['timeout','12s','dmsetup','reload',dmName,'--table',table],15000)
 }finally{
  execute(['timeout','12s','dmsetup','resume',dmName],15000)
 }
}
const directKernelProof=expectedError=>{
 const result=spawnSync('sudo',['timeout','12s','dd','if='+mapper,
  'of=/dev/null','bs=4096','count=1','iflag=direct','status=none'],
  {encoding:'utf8',timeout:15000,shell:false})
 if(expectedError){
  assert.notEqual(result.status,0,'real dm-error did not fail direct read')
  assert(/Input\/output error/i.test(result.stderr||''),
   'kernel must produce EIO, not EROFS/EACCES/timeout or a fake JS error')
 }else assert.equal(result.status,0,'restored private dm-linear read still fails')
}
const repairPrivateExt4=()=>{
 // All native Chrome processes must be closed before repairing ONLY the
 // private scratch ext4. Exit failure if true recovery is not possible.
 execute(['timeout','15s','umount',dbDir],20000)
 const repair=spawnSync('sudo',['timeout','30s','e2fsck','-fp',mapper],
  {encoding:'utf8',timeout:35000,shell:false})
 assert([0,1].includes(repair.status),'private fsck failed')
 execute(['timeout','15s','mount','-t','ext4','-o','nodev,nosuid',mapper,dbDir],20000)
 execute(['chown',process.getuid()+':'+process.getgid(),dbDir])
 assert(fs.statSync(profile).dev!==fs.statSync(dbDir).dev)
}
const openBrowser=()=>chromium.launchPersistentContext(profile,{
 executablePath:browserBinary,headless:true,
 viewport:{width:390,height:844},deviceScaleFactor:3,
 isMobile:true,hasTouch:true,serviceWorkers:'allow',
 args:['--no-sandbox','--disable-dev-shm-usage']})
const attach=page=>page.addScriptTag({content:
 '(function(){var exports={};\n'+compiled+'\nwindow.__pwaEIOStore=exports})();'})
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
   const s=window.__pwaEIOStore
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
  summary.phase='genuine-kernel-block-EIO'
  changeBlock('error');faulted=true
  directKernelProof(true)
  summary.kernelEIO=true;summary.physicalDiskEIO=true
  summary.phase='cold-Chromium-under-kernel-EIO'
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
  summary.phase='native-indexeddb-write-failure-on-real-dm-error'
  const raw=await first.evaluate(async()=>{
   return new Promise(resolve=>{
    let settled=false
    const done=out=>{if(settled)return;settled=true;resolve(out)}
    const watchdog=setTimeout(()=>done({committed:false,timedOut:true,name:'TimedOut'}),12000)
    const finish=out=>{clearTimeout(watchdog);done(out)}
    try{
     const r=indexedDB.open('xdrive-pwa-offline-metadata-v2',1)
     r.onerror=()=>finish({committed:false,name:r.error?.name||'Error'})
     r.onblocked=()=>finish({committed:false,name:'Blocked'})
     r.onsuccess=()=>{
      const db=r.result
      try{
       const tx=db.transaction('owner-scopes','readwrite')
       tx.objectStore('owner-scopes').put({key:'__cr03g-native-probe__',
         syntheticOnly:true})
       tx.oncomplete=()=>{db.close();finish({committed:true,name:'none'})}
       tx.onabort=()=>{const n=tx.error?.name||'Error';db.close();
        finish({committed:false,name:n})}
       tx.onerror=()=>{}
      }catch(e){db.close();finish({committed:false,name:e?.name||'Error'})}
     }
    }catch(e){finish({committed:false,name:e?.name||'Error'})}
   })
  })
  assert(!raw.committed&&!raw.timedOut,'native Chromium IDB must fail under real kernel EIO')
  summary.nativeIDBFailureObserved=true
  summary.chromiumIndexedDBTested=true
  summary.phase='native-P1-write-must-not-claim-commit'
  const write=await first.evaluate(async()=>{
   const owner={origin:location.origin,userID:42,username:'synthetic-only',
    instanceID:'11111111-1111-4111-8111-111111111111'}
   try{
    const accepted=await window.__pwaEIOStore.xDrivePwaCaptureVisitedDirectory(owner,{
     id:19,name:'new-but-forbidden',totalCount:1,
     items:[{id:99999,name:'never authorized',type:'file',revision:2}]})
    return {accepted:accepted===true,name:'none'}
   }catch(e){return {accepted:false,name:String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32)}}
  })
  assert.equal(write.accepted,false,'EIO cannot be misreported as committed P1 history')
  summary.productWriteRejected=true;summary.nativeIDBErrorName=write.name
  await peer.evaluate(()=>{
   window.__eioPeerPurge=false
   window.__eioStop=window.__pwaEIOStore.xDrivePwaObserveOfflinePurge(()=>{
    window.__eioPeerPurge=true
   })
  })
  summary.phase='native-EIO-durable-clear-must-fail-and-notify'
  const clear=await first.evaluate(async()=>{
   try{await window.__pwaEIOStore.xDrivePwaClearOfflineMetadata();return true}
   catch{return false}
  })
  assert.equal(clear,false,'EIO purge must not falsely report durable deletion')
  summary.durablePurgeRejected=true
  await peer.waitForFunction(()=>window.__eioPeerPurge===true,null,{timeout:12000})
  summary.peerPurgeNotified=true
  assert(await publicOnly(first))
  summary.phase='restore-isolated-mapping-and-repair-ext4'
  await ctx.close();ctx=null
  changeBlock('linear');faulted=false
  directKernelProof(false)
  repairPrivateExt4()
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
  console.error('PWA_CR03G_SAFE_FAILURE phase='+summary.phase+
   ' kind='+String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32))
  process.exitCode=1
 }finally{
  await ctx?.close().catch(()=>{})
  if(faulted)try{changeBlock('linear')}catch{
   console.error('PWA_CR03G_PRIVATE_MAPPING_RESTORE_FAILED');process.exitCode=1
  }
  await new Promise(resolve=>server.close(()=>resolve()))
  fs.mkdirSync(output,{recursive:true,mode:0o700})
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600})
 }
}
main()
