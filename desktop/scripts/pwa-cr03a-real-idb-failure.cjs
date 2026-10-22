#!/usr/bin/env node
'use strict'
// CR-03a: real native Chromium + production-built public SW + real IndexedDB.
// This deliberately exercises synthetic opted-in history, not Go Owner ACL.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const ts = require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const { chromium } = require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
const root = path.resolve(__dirname,'../..')
const dist = path.join(root,'web/dist')
const binary = process.env.XDRIVE_BROWSER_EXECUTABLE
assert.equal(process.env.XD_PWA_CR03A_REAL_CHROME,'1','explicit real-browser gate')
assert(binary && fs.existsSync(binary),'native Chromium binary is required')
assert(fs.existsSync(path.join(dist,'sw.js')) && fs.existsSync(path.join(dist,'offline.html')),
  'actual production public App Shell must be built')
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText
const output = path.resolve(process.env.XD_PWA_CR03A_OUTPUT ||
  path.join(root,'desktop/pwa-cr03a-results'))
fs.mkdirSync(output,{recursive:true})
let online = true, stage='setup'
const summary={
  schema:'xdrive-pwa-cr03a-real-native-chrome-idb-reliability',
  head:process.env.XD_PR_HEAD || null, realChromium:true, productionPublicSW:true,
  realIndexedDB:true, actualGoACL:false, quotaExceededTested:false,
  blockedIDBOpenTested:false, actualNetwork429503Tested:false,
  expiredSnapshotRejected:false, corruptSchemaRejected:false,
  evictionClearedHistory:false, publicSWPrivateCacheAbsent:false,
  crossProcessNoResurrection:false, physicalIOS:false, performanceAfter:false,
  passed:false
}
const types={
  '.html':'text/html; charset=utf-8','.js':'text/javascript',
  '.css':'text/css','.json':'application/json','.svg':'image/svg+xml',
  '.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'
}
const server=http.createServer((req,res)=>{
  if(!online){res.destroy();return}
  let pathname
  try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}
  catch {res.writeHead(400);res.end();return}
  if(pathname.startsWith('/api/')){
    res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'})
    res.end('{"error":"not authenticated"}');return
  }
  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);res.end();return}
  if(pathname==='/') pathname='/index.html'
  if(pathname.includes('\\') || pathname.includes('\0')){res.writeHead(400);res.end();return}
  const file=path.resolve(dist,'.'+pathname)
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
  let stat
  try {stat=fs.statSync(file)}catch {res.writeHead(404);res.end();return}
  if(!stat.isFile()){res.writeHead(404);res.end();return}
  res.writeHead(200,{
    'Content-Type':types[path.extname(file)] || 'application/octet-stream',
    'Content-Length':String(stat.size),
    'Cache-Control': pathname==='/index.html'||pathname==='/sw.js'
      ? 'no-cache, must-revalidate':'public, max-age=3600'
  })
  if(req.method==='HEAD'){res.end();return}
  fs.createReadStream(file).pipe(res)
})
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-cr03a-native-'))
function inject(page) {
  return page.addScriptTag({content:'(function(){var exports={};\n'+compiled+
    '\nwindow.__cr03a=exports;})();'})
}
function launch() {
  return chromium.launchPersistentContext(profile,{
    executablePath:binary,headless:true,viewport:{width:390,height:844},
    deviceScaleFactor:3,isMobile:true,hasTouch:true,locale:'zh-CN',
    serviceWorkers:'allow',args:['--no-sandbox','--disable-dev-shm-usage']
  })
}
async function cacheAudit(page){
  const report=await page.evaluate(async()=>{
    const paths=[]
    for(const name of await caches.keys()){
      const cache=await caches.open(name)
      for(const request of await cache.keys()) {
        const p=new URL(request.url).pathname
        paths.push(p)
        if(p.startsWith('/api/') || /thumbnail|ticket|original|download|token/i.test(p))
          throw Error('private resource in public CacheStorage')
      }
    }
    return {paths}
  })
  assert(report.paths.includes('/offline.html'),'public offline Shell must be precached')
  summary.publicSWPrivateCacheAbsent=true
}
async function run(){
  await new Promise((resolve,reject)=>{
    server.once('error',reject)
    server.listen(0,'127.0.0.1',resolve)
  })
  const origin='http://127.0.0.1:'+server.address().port
  let context=null
  try {
    stage='install-public-shell'
    context=await launch()
    let page=context.pages()[0]||await context.newPage()
    await page.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded',timeout:40000})
    await page.locator('[data-xdrive-pwa-login-entry]').waitFor({state:'visible',timeout:30000})
    await page.evaluate(async()=>{
      const reg=await navigator.serviceWorker.ready
      if(!reg.active)throw Error('production public SW did not activate')
    })
    await page.reload({waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),
      null,{timeout:30000})
    await inject(page)
    stage='capture-opted-in-history'
    await page.evaluate(async()=>{
      const api=window.__cr03a
      const owner={
        origin:location.origin,userID:41,username:'cr03a-synthetic-owner',
        instanceID:'11111111-1111-4111-8111-111111111111'
      }
      window.__cr03aOwner=owner
      await api.xDrivePwaSetOfflineConsent(owner,true)
      const d=await api.xDrivePwaCaptureVisitedDirectory(owner,{
        id:51,name:'Synthetic remembered folder',totalCount:100000,
        items:[{id:52,name:'Photo A',type:'file',revision:1}]
      })
      const a=await api.xDrivePwaCaptureAlbumSummaries(owner,[
        {id:'album-1',name:'Album A',kind:'manual',revision:1,item_count:2}
      ])
      if(!d||!a)throw Error('real IDB opt-in capture failed')
      const saved=await api.xDrivePwaReadOfflineDirectories(owner)
      if(saved.revalidated!==false||saved.directories.length!==1)
        throw Error('history was not unverified')
    })
    await cacheAudit(page)
    await context.close();context=null
    online=false
    stage='real-offline-cold-restart'
    context=await launch()
    page=context.pages()[0]||await context.newPage()
    await page.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded',timeout:40000})
    await page.locator('[data-xdrive-pwa-offline-item]').first()
      .waitFor({state:'visible',timeout:25000})
    await page.locator('[data-xdrive-pwa-offline-album]').first()
      .waitFor({state:'visible',timeout:25000})
    await inject(page)
    stage='native-idb-expiry'
    const expiry=await page.evaluate(async()=>{
      const api=window.__cr03a
      const owner=await api.xDrivePwaReadRelaunchOwner()
      if(!owner)throw Error('consented owner hint missing')
      const key=api.xDrivePwaOfflineScopeKey(owner)
      const db=await new Promise((resolve,reject)=>{
        const r=indexedDB.open('xdrive-pwa-offline-metadata-v2',1)
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)
      })
      const stale=Date.now()-api.XDRIVE_PWA_OFFLINE_MAX_AGE_MS-1000
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('owner-scopes','readwrite')
        tx.objectStore('owner-scopes').put({
          key,version:1,consented:true,
          directories:[{
            id:51,name:'stale',capturedAt:stale,totalCount:100000,
            items:[{id:52,name:'must-not-appear',type:'file',revision:1}]
          }],
          albumSnapshot:{
            capturedAt:stale,partial:true,totalAtCapture:1,
            albums:[{id:'album-1',name:'expired',kind:'manual',revision:1,item_count:1}]
          }
        })
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)
        tx.onerror=()=>reject(tx.error)
      })
      db.close()
      const d=await api.xDrivePwaReadOfflineDirectories(owner)
      const a=await api.xDrivePwaReadAlbumSummaries(owner)
      return {expired:d.consented && !d.revalidated && d.directories.length===0 &&
        a.consented && !a.revalidated && a.snapshot===null}
    })
    assert(expiry.expired,'expired IndexedDB snapshot was shown as current')
    summary.expiredSnapshotRejected=true
    stage='native-idb-corruption'
    const corruption=await page.evaluate(async()=>{
      const api=window.__cr03a
      const owner=await api.xDrivePwaReadRelaunchOwner()
      if(!owner)throw Error('scope locator missing before corrupt test')
      const key=api.xDrivePwaOfflineScopeKey(owner)
      const db=await new Promise((resolve,reject)=>{
        const r=indexedDB.open('xdrive-pwa-offline-metadata-v2',1)
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)
      })
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('owner-scopes','readwrite')
        tx.objectStore('owner-scopes').put({
          key,version:99,consented:true,
          directories:[{name:'should-never-render',url:'forbidden'}],
          albumSnapshot:{albums:[{exif:'forbidden'}]}
        })
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)
        tx.onerror=()=>reject(tx.error)
      })
      db.close()
      const d=await api.xDrivePwaReadOfflineDirectories(owner)
      const a=await api.xDrivePwaReadAlbumSummaries(owner)
      const hint=await api.xDrivePwaReadRelaunchOwner()
      return {rejected:!d.consented && !d.revalidated &&
        d.directories.length===0 && !a.consented && a.snapshot===null && hint===null}
    })
    assert(corruption.rejected,'malformed IndexedDB record was rendered as consented')
    summary.corruptSchemaRejected=true
    stage='native-idb-eviction'
    const evicted=await page.evaluate(async()=>{
      const api=window.__cr03a
      await api.xDrivePwaClearOfflineMetadata()
      const deleted=await new Promise((resolve,reject)=>{
        const request=indexedDB.deleteDatabase('xdrive-pwa-offline-metadata-v2')
        request.onsuccess=()=>resolve(true)
        request.onerror=()=>reject(request.error)
        request.onblocked=()=>reject(Error('real IDB eviction blocked'))
      })
      const hint=await api.xDrivePwaReadRelaunchOwner()
      return deleted && hint===null
    })
    assert(evicted,'real browser IndexedDB eviction did not clear owner')
    summary.evictionClearedHistory=true
    await cacheAudit(page)
    await context.close();context=null
    stage='post-eviction-process-restart'
    context=await launch()
    page=context.pages()[0]||await context.newPage()
    await page.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded',timeout:40000})
    await page.locator('[data-xdrive-pwa-offline-empty]')
      .waitFor({state:'visible',timeout:25000})
    const count=await page.evaluate(()=>document.querySelectorAll(
      '[data-xdrive-pwa-offline-item], [data-xdrive-pwa-offline-album]').length)
    assert.equal(count,0,'cleared history resurrected in third native Chrome process')
    summary.crossProcessNoResurrection=true
    await cacheAudit(page)
    summary.passed=true
    console.log('PWA_CR03A_REAL_CHROME_IDB_EXPIRY_CORRUPTION_EVICTION_PASS')
  }catch(err){
    summary.errorClass=(err?.name||'Error').replace(/[^A-Za-z0-9]/g,'').slice(0,40)
    summary.failureStage=stage
    process.exitCode=1
    console.error('PWA_CR03A_SAFE_FAILURE '+summary.errorClass+' stage='+stage)
  }finally{
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n')
    await context?.close()
    server.close()
    fs.rmSync(profile,{recursive:true,force:true})
  }
}
void run()
