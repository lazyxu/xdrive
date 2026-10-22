#!/usr/bin/env node
'use strict'
// CR-02b1: real Gin/PostgreSQL17/CAS/JWT + actual P1 historical UI, no API mocks.
// Separate real persistent Chromium process restart; source-level fail closed.
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const ts=require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const root=path.resolve(__dirname,'../..')
const opts=Object.fromEntries(process.argv.slice(2).map(v=>{
 const m=/^--(ready|output-dir)=(.+)$/.exec(v);assert(m,'private ready & output required');return[m[1],m[2]]
}))
assert(opts.ready&&opts['output-dir'])
const fixture=JSON.parse(fs.readFileSync(opts.ready,'utf8'))
assert(fixture.real_gin===true&&fixture.postgresql===true&&fixture.local_cas===true)
assert(fixture.intercepted_api===false&&fixture.physical_device===false)
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.url))
assert(Number.isSafeInteger(fixture.root_id)&&Number.isSafeInteger(fixture.target_id))
const chrome=process.env.XDRIVE_BROWSER_EXECUTABLE
assert(chrome&&fs.existsSync(chrome),'authentic native Chromium binary mandatory')
const output=path.resolve(opts['output-dir']);fs.mkdirSync(output,{recursive:true})
const source=fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-cr02b-real-owner-'))
let phase='start'
// Genuine multi-process E2E must fail closed rather than leave CI waiting
// indefinitely on browser registration/IDB/Go if a native process wedges.
// Only the fixed allowlisted phase label is logged (never Owner/URLs/JWT).
const watchdog=setTimeout(()=>{
  console.error('PWA_CR02B1_SAFE_WATCHDOG '+phase)
  process.exit(1)
},7*60*1000)
watchdog.unref()
const summary={
 status:'PWA-CR02B1-GENUINE-GO-ACL-P1-BEFORE',sha:process.env.XD_PR_HEAD||null,
 realGin:true,postgresql:true,localCAS:true,nativeChromium:true,
 installedIOS:false,physicalIOS:false,interceptedAPI:false,ownerJWTInArtifact:false,
 actualOwnerME:false,actualOwnerNode:false,actualOwnerRange:false,
 genuineServerAlbum:false,foreignOwner404:false,
 explicitlyOptedIn:false,directoryPersisted:false,albumPersisted:false,
 realOfflineColdRelaunch:false,postReconnectGoACL:false,
 stillHistoricalAfterAuthorization:false,realGoNodeRevoked:false,
 revocationPurgedBothSnapshots:false,revokedHistoryCannotResurrect:false,
 publicSWOnly:false,passed:false,
}
function localBrowser(){
 return chromium.launchPersistentContext(profile,{executablePath:chrome,headless:true,
  viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,
  locale:'zh-CN',serviceWorkers:'allow',args:['--no-sandbox','--disable-dev-shm-usage']})
}
async function checkedPublicCache(page) {
 const audit=await page.evaluate(async()=>{
   const names=await caches.keys(),paths=[]
   for(const name of names)for(const req of await (await caches.open(name)).keys()){
     const pathname=new URL(req.url).pathname
     paths.push(pathname)
     if(pathname.startsWith('/api/')||/thumbnail|media\/items|auth|ticket|upload|download/i.test(pathname))
       throw Error('owner API persisted in public CacheStorage')
   }
   return {names,paths}
 })
 assert(audit.paths.includes('/offline.html'),'original public offline shell absent')
 summary.publicSWOnly=true
}
async function insertStore(page) {
 await page.addScriptTag({content:'(function(){ var exports={};\n'+compiled+
  '\nwindow.__cr02bHistoricalStore=exports; })();'})
}
async function snapshotFromRealOwner(page){
 return page.evaluate(async ({rootID,targetID})=>{
  const token=localStorage.getItem('xdrive.access_token')
  if(!token || token.length<16)throw Error('real Browser Go login absent')
  const headers={Authorization:'Bearer '+token}
  const req=async(uri,init={})=>{
    const response=await fetch(uri,{cache:'no-store',...init,
      headers:{...headers,...init.headers}})
    return {status:response.status,data:response.ok?await response.json():null}
  }
  const me=await req('/api/v1/me')
  if(me.status!==200||!me.data?.pwa_offline_instance_id)
    throw Error('true Owner and durable instance identity missing')
  const owner={origin:location.origin,userID:me.data.id,username:me.data.username,
    instanceID:me.data.pwa_offline_instance_id}
  const root=await req('/api/v1/nodes/root')
  if(root.status!==200||root.data?.id!==rootID)throw Error('Owner Root mismatch')
  const checked=await req('/api/v1/nodes/'+targetID)
  if(checked.status!==200||checked.data?.type!=='dir')
    throw Error('authentic owner existing directory failed')
  const dir=await req('/api/v1/nodes/'+rootID+'/directories',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'cr02b-test-revokable'})
  })
  if(dir.status!==201||dir.data?.type!=='dir'||!Number.isSafeInteger(dir.data.id))
    throw Error('new live Owner revokable folder absent')
  const child=await req('/api/v1/nodes/'+dir.data.id+'/directories',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'cr02b-originally-authorized-child'})
  })
  if(child.status!==201||child.data?.type!=='dir')throw Error('real nested child failed')
  const currentNode=await req('/api/v1/nodes/'+dir.data.id)
  const range=await req('/api/v1/nodes/'+dir.data.id+
    '/children?offset=0&limit=1&sort=name&order=asc&include_count=false')
  if(currentNode.status!==200||range.status!==200||range.data?.items?.[0]?.id!==child.data.id)
    throw Error('true owner 1-row range denied')
  const album=await req('/api/v1/media/albums',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'CR02b actual authorized album'})
  })
  if(album.status!==201||typeof album.data?.id!=='string'||
    album.data?.kind!=='manual')throw Error('real authenticated Go album creation failed')
  const store=window.__cr02bHistoricalStore
  if(!store.xDrivePwaVerifiedIdentityMatches(owner,me.data))
    throw Error('actual Go durable Owner/Instance fails identity check')
  await store.xDrivePwaSetOfflineConsent(owner,true)
  const d=await store.xDrivePwaCaptureVisitedDirectory(owner,{
    id:dir.data.id,name:dir.data.name,totalCount:1,
    items:range.data.items.map(i=>({id:i.id,name:i.name,type:i.type,revision:i.revision}))
  })
  const a=await store.xDrivePwaCaptureAlbumSummaries(owner,[album.data])
  if(!d||!a)throw Error('authentic authorized scoped data not persisted')
  const saved=await store.xDrivePwaReadOfflineDirectories(owner)
  const albums=await store.xDrivePwaReadAlbumSummaries(owner)
  if(!saved.consented||saved.revalidated!==false||
    saved.directories[0]?.items[0]?.id!==child.data.id||
    albums.snapshot?.albums[0]?.id!==album.data.id||
    albums.revalidated!==false)throw Error('P1 historical projection is not bounded/read-only')
  if(JSON.stringify({saved,albums}).includes(token))
    throw Error('JWT must not be persisted')
  return {folderID:dir.data.id,folderRevision:dir.data.revision,
    targetID,rootID,ownerCreated:true,rangeCount:range.data.items.length,
    albumCreated:true,consented:true,storedDir:true,storedAlbum:true}
 },{rootID:fixture.root_id,targetID:fixture.target_id})
}
async function checkCrossOwner(context,folderID){
 const r=await context.request.post(fixture.url+'/api/v1/auth/login',{
   data:{username:fixture.foreign_username,password:'PwaRealGin-Foreign_2026!'}})
 assert.equal(r.status(),200,'true PostgreSQL foreign owner login failed')
 const j=await r.json()
 assert(j.access_token?.length>16,'actual foreign JWT absent')
 const opts={headers:{Authorization:'Bearer '+j.access_token}}
 const denied=await context.request.get(fixture.url+'/api/v1/nodes/'+folderID,opts)
 assert.equal(denied.status(),404,'Go leaked A folder to actual foreign User B')
 summary.foreignOwner404=true
}
async function deleteLiveFolder(page,id,revision){
 return page.evaluate(async ({id,revision})=>{
  const token=localStorage.getItem('xdrive.access_token')
  const response=await fetch('/api/v1/nodes/'+id,{
    method:'DELETE',cache:'no-store',
    headers:{Authorization:'Bearer '+token,'If-Match':'"'+revision+'"'}})
  return response.status
 },{id,revision})
}
async function waitNode404(page,id){
 await page.waitForFunction(async id=>{
  const token=localStorage.getItem('xdrive.access_token')
  if(!token)return false
  const r=await fetch('/api/v1/nodes/'+id,{
    headers:{Authorization:'Bearer '+token},cache:'no-store'})
  return r.status===404
 },id,{timeout:30000,polling:200})
}
async function closeContext(ctx){if(ctx)await ctx.close()}
async function run(){
 let ctx=null;let folder=null
 try {
  phase='actual-login-and-Owner'
  ctx=await localBrowser()
  const page=ctx.pages()[0]||await ctx.newPage()
  await page.goto(fixture.url+'/#/app/files?dir='+fixture.target_id,
    {waitUntil:'domcontentloaded',timeout:45000})
  phase='wait-login-form'
  await page.locator('#web-login-username').waitFor({state:'visible'})
  await page.locator('#web-login-username').fill(fixture.username)
  await page.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
  phase='submit-login-form'
  await page.getByRole('button',{name:'登录',exact:true}).click()
  phase='wait-real-session'
  await page.waitForFunction(()=>Boolean(localStorage.getItem('xdrive.access_token')),null,{timeout:30000})
  phase='wait-public-shell'
  // Production registerXDrivePwa defers registration until window.load; a
  // real post-login browser must reach that lifecycle before evaluating SW.
  // Do not manually install a worker to make a missing product registration PASS.
  await page.waitForLoadState('load',{timeout:30000})
  const shell=await page.evaluate(async()=>{
    try {
      const r=await fetch('/index.html',{
        cache:'no-store',redirect:'error',credentials:'omit',
      })
      return {status:r.status,redirected:r.redirected,
        mimeOK:(r.headers.get('Content-Type')||'').toLowerCase().startsWith('text/html')}
    } catch {
      return {status:0,redirected:false,mimeOK:false}
    }
  })
  assert(shell.status===200&&!shell.redirected&&shell.mimeOK,
    'Go public /index.html must be direct 200 text/html for real SW installation')
  const sw=await page.evaluate(async()=>{
    const r=await navigator.serviceWorker.getRegistration()
    return {secure:isSecureContext,loaded:document.readyState==='complete',
      hasRegistration:Boolean(r),hasActive:Boolean(r?.active),
      hasController:Boolean(navigator.serviceWorker.controller)}
  })
  console.error('PWA_CR02B1_SAFE_SW_INITIAL '+JSON.stringify(sw))
  const publicSW=await page.evaluate(async()=>{try{const r=await fetch('/sw.js',{cache:'no-store'});return {status:r.status,mimeOK:/javascript|ecmascript/.test(r.headers.get('Content-Type')||'')}}catch{return {status:0,mimeOK:false}}})
  console.error('PWA_CR02B1_SAFE_SW_HTTP '+JSON.stringify(publicSW))
  if (!sw.hasRegistration) {
    // Diagnostic runs ONLY after the product failed to register. A successful
    // explicit probe is still a RED (never evidence of automatic registration).
    const probe=await page.evaluate(async()=>{
      try {
        const reg=await navigator.serviceWorker.register('/sw.js',{
          scope:'/',updateViaCache:'none',
        })
        return {accepted:true,hasInstalling:Boolean(reg.installing),
          hasWaiting:Boolean(reg.waiting),hasActive:Boolean(reg.active)}
      } catch(e) {
        return {accepted:false,errorName:String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,40)}
      }
    })
    console.error('PWA_CR02B1_SAFE_REGISTRATION_PROBE '+JSON.stringify(probe))
    throw Error('product SW auto registration absent after window.load')
  }
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(reg=>{
      if (!reg.active) throw Error('public SW has no active worker')
      return true
    }),
    new Promise((_,reject)=>setTimeout(()=>reject(
      Error('public SW registration took too long')),15000))
  ]))
  phase='reload-authenticated-App'
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:30000})
  phase='attach-pwa-offline-module'
  await insertStore(page)
  phase='authorized-directory-album-capture'
  const recorded=await snapshotFromRealOwner(page)
  folder=recorded
  summary.actualOwnerME=true;summary.actualOwnerNode=recorded.ownerCreated
  summary.actualOwnerRange=recorded.rangeCount===1
  summary.genuineServerAlbum=recorded.albumCreated
  summary.explicitlyOptedIn=recorded.consented
  summary.directoryPersisted=recorded.storedDir
  summary.albumPersisted=recorded.storedAlbum
  await checkCrossOwner(ctx,folder.folderID)
  await checkedPublicCache(page)
  await closeContext(ctx);ctx=null
  phase='offline-Chrome-cold-restart'
  ctx=await localBrowser()
  await ctx.setOffline(true)
  const hist=ctx.pages()[0]||await ctx.newPage()
  await hist.goto(fixture.url+'/#/offline/files',{waitUntil:'domcontentloaded',timeout:30000})
  await hist.locator('[data-xdrive-pwa-offline-directory]').waitFor({state:'visible'})
  await hist.locator('[data-xdrive-pwa-offline-album]').first().waitFor({state:'visible'})
  const offline=await hist.evaluate(()=>({
    itemCount:document.querySelectorAll('[data-xdrive-pwa-offline-item]').length,
    albumCount:document.querySelectorAll('[data-xdrive-pwa-offline-album]').length,
    warning:document.querySelector('[data-xdrive-pwa-offline-historical]')?.textContent?.includes('未经当前权限验证'),
    ownerSurfaceAbsent:!document.querySelector('[data-xdrive-workspace-background]')
  }))
  assert.deepEqual(offline,{itemCount:1,albumCount:1,warning:true,ownerSurfaceAbsent:true})
  summary.realOfflineColdRelaunch=true
  phase='reconnect-current-real-Gin-ACL'
  const seen=[]
  hist.on('response',r=>{let p=new URL(r.url()).pathname
    if(p==='/api/v1/me'||p==='/api/v1/nodes/'+folder.folderID||
      p==='/api/v1/nodes/'+folder.folderID+'/children')seen.push({kind:p.endsWith('/children')?'range':p==='/api/v1/me'?'me':'node',status:r.status()})})
  await ctx.setOffline(false)
  await hist.waitForFunction(()=>Boolean(document.querySelector('[data-xdrive-pwa-offline-browser]')),null,{timeout:12000})
  await hist.getByText('服务器已重新核验本目录访问权限',{exact:false}).waitFor({state:'visible',timeout:30000})
  for(const kind of ['me','node','range'])assert(seen.some(x=>x.kind===kind&&x.status===200),
    'live Go Owner '+kind+' was not actually revalidated')
  const live=await hist.evaluate(()=>({
    historical:document.querySelector('[data-xdrive-pwa-offline-historical]')?.textContent?.includes('历史摘要'),
    noFileExplorer:!document.querySelector('[data-xdrive-workspace-background]'),
    savedNodes:document.querySelectorAll('[data-xdrive-pwa-offline-item]').length
  }))
  assert(live.historical&&live.noFileExplorer&&live.savedNodes===1)
  summary.postReconnectGoACL=true;summary.stillHistoricalAfterAuthorization=true
  phase='actual-Go-node-revocation'
  const deletion=await deleteLiveFolder(hist,folder.folderID,folder.folderRevision)
  assert([200,202,204].includes(deletion),'actual production Go delete API denied')
  await waitNode404(hist,folder.folderID)
  summary.realGoNodeRevoked=true
  await hist.locator('[data-xdrive-pwa-offline-verify]').click()
  await hist.locator('[data-xdrive-pwa-offline-empty]').waitFor({state:'visible',timeout:30000})
  await insertStore(hist)
  const purged=await hist.evaluate(async()=>{
    const s=window.__cr02bHistoricalStore
    return {hint:await s.xDrivePwaReadRelaunchOwner(),
      noDirectory:document.querySelectorAll('[data-xdrive-pwa-offline-item]').length===0,
      noAlbum:document.querySelectorAll('[data-xdrive-pwa-offline-album]').length===0}
  })
  assert.equal(purged.hint,null);assert(purged.noDirectory&&purged.noAlbum)
  summary.revocationPurgedBothSnapshots=true
  await checkedPublicCache(hist)
  await closeContext(ctx);ctx=null
  phase='third-real-Chrome-relaunch-no-resurrection'
  ctx=await localBrowser();await ctx.setOffline(true)
  const third=ctx.pages()[0]||await ctx.newPage()
  await third.goto(fixture.url+'/#/offline/files',{waitUntil:'domcontentloaded',timeout:30000})
  await third.locator('[data-xdrive-pwa-offline-empty]').waitFor({state:'visible',timeout:20000})
  assert.equal(await third.locator('[data-xdrive-pwa-offline-item], [data-xdrive-pwa-offline-album]').count(),0)
  summary.revokedHistoryCannotResurrect=true
  await checkedPublicCache(third)
  await ctx.setOffline(false)
  const finish=await ctx.request.post(fixture.url+'/__test/pwa-s2b3/finish')
  assert.equal(finish.status(),204)
  summary.passed=true
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600})
  console.log('PWA_CR02B1_REAL_GIN_OWNER_ACL_REVOKE_PASS '+JSON.stringify(summary))
 }catch(error){
  // Deliberately no sensitive Exception message or URL; only allowlisted
  // phase and sanitized exception name in publicly searchable CI logs.
  console.error('PWA_CR02B1_SAFE_FAILURE '+phase+' '+String(error?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,40))
  process.exitCode=1
 }finally {
  await closeContext(ctx).catch(()=>{})
  fs.rmSync(profile,{recursive:true,force:true})
 }
}
void run()
