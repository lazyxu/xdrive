#!/usr/bin/env node
'use strict'
// Native Chromium OS LevelDB corruption; only the disposable profile is edited.
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http')
const ts=require(path.resolve(__dirname,'../../web/node_modules/typescript'))
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'web/dist')
const exe=process.env.XDRIVE_BROWSER_EXECUTABLE,head=process.env.XD_PR_HEAD
assert(process.env.XD_PWA_CR03D_NATIVE_CORRUPTION==='1'&&exe&&fs.existsSync(exe))
assert(/^[a-f0-9]{40}$/.test(head||''))
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xd-cr03d-disposable-only-'))
const profile=path.join(tmp,'chrome-profile'),output=path.resolve(
 process.env.XD_PWA_CR03D_OUTPUT||path.join(root,'desktop/pwa-cr03d-results'))
fs.mkdirSync(profile,{mode:0o700});fs.mkdirSync(output,{recursive:true,mode:0o700})
const compiled=ts.transpileModule(fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css',
 '.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
 '.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'}
const server=http.createServer((req,res)=>{
 let uri;try{uri=new URL(req.url,'http://127.0.0.1')}catch{res.writeHead(400);res.end();return}
 if(uri.pathname.startsWith('/api/')){res.writeHead(401,{'Cache-Control':'no-store'});res.end();return}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 let rel;try{rel=decodeURIComponent(uri.pathname)}catch{res.writeHead(400);res.end();return}
 if(rel==='/')rel='/index.html'
 if(rel.includes('\\')||rel.includes('\0')||rel.includes('..')){res.writeHead(400);res.end();return}
 const filename=path.resolve(dist,'.'+rel)
 if(!filename.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
 let st;try{st=fs.lstatSync(filename)}catch{res.writeHead(404);res.end();return}
 if(!st.isFile()||st.isSymbolicLink()){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream',
  'Content-Length':String(st.size),'Cache-Control':rel==='/sw.js'||rel==='/index.html'
   ? 'no-cache,must-revalidate':'public,max-age=3600'})
 if(req.method==='HEAD'){res.end();return}fs.createReadStream(filename).pipe(res)
})
const report={sha:head,phase:'init',nativeChromium:false,profileIsDisposable:true,
 originalPersisted:false,positiveColdRestart:false,realLevelDBCurrentCorrupted:false,
 allProcessesClosedDuringCorruption:false,corruptColdLaunched:false,
 corruptionOutcome:'not-run',historicalWarning:false,offlineHistoryNeverAuthorized:false,
 publicSWPrivateBytesAbsent:false,secondCorruptColdLaunch:false,
 kernelEROFS:false,kernelEIO:false,physicalIOS:false,passed:false}
let origin='',browser=null
const ownerID={userID:731,username:'disposable-synthetic-only',
 instanceID:'11111111-1111-4111-8111-111111111111'}
async function launch(){
 return chromium.launchPersistentContext(profile,{executablePath:exe,
  headless:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true,
  serviceWorkers:'allow',args:['--no-sandbox','--disable-dev-shm-usage']})
}
async function save(){
 browser=await launch();report.nativeChromium=true
 const p=browser.pages()[0]||await browser.newPage()
 await p.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded'})
 await p.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.active))
 await p.reload({waitUntil:'domcontentloaded'})
 await p.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
 await p.addScriptTag({content:'(function(){const exports={};\n'+compiled+
  '\nwindow.__cr03d=exports})()'})
 report.originalPersisted=await p.evaluate(async identity=>{
  const store=window.__cr03d,owner={...identity,origin:location.origin}
  await store.xDrivePwaSetOfflineConsent(owner,true)
  const d=await store.xDrivePwaCaptureVisitedDirectory(owner,{
   id:271,name:'Disposable directory',totalCount:1,
   items:[{id:272,name:'Synthetic entry',type:'file',revision:1}]})
  const a=await store.xDrivePwaCaptureAlbumSummaries(owner,[{
   id:'synthetic-album',name:'Disposable album',kind:'manual',item_count:1,revision:1}])
  const dr=await store.xDrivePwaReadOfflineDirectories(owner)
  const ar=await store.xDrivePwaReadAlbumSummaries(owner)
  return d&&a&&dr.consented&&dr.revalidated===false &&
   dr.directories[0]?.items[0]?.id===272&&
   ar.snapshot?.albums[0]?.id==='synthetic-album'
 },ownerID)
 assert(report.originalPersisted,'authentic P1 IndexedDB write must succeed before corruption')
 await browser.close();browser=null
}
async function coldRead(){
 browser=await launch()
 await browser.setOffline(true)
 const p=browser.pages()[0]||await browser.newPage()
 await p.goto(origin+'/#/offline/files',{waitUntil:'domcontentloaded',timeout:30000})
 await p.locator('[data-xdrive-pwa-offline-browser]').waitFor({state:'visible',timeout:30000})
 await p.waitForFunction(()=>!document.querySelector('[role="status"]')?.textContent?.includes('正在读取本设备'),null,{timeout:30000})
 const ui=await p.evaluate(()=>{
  const summary=document.querySelector('[data-xdrive-pwa-offline-historical]')?.textContent||''
  const items=document.querySelectorAll('[data-xdrive-pwa-offline-item]').length
  const albums=document.querySelectorAll('[data-xdrive-pwa-offline-album]').length
  const empty=!!document.querySelector('[data-xdrive-pwa-offline-empty]')
  return {warning:summary.includes('未经当前权限验证'),historical:items===1&&albums===1,
   empty,unknownRows:items>1||albums>1,noLive:!document.querySelector('[data-xdrive-workspace-background]'),
   anonymous:!(localStorage.getItem('xdrive.access_token')||'')}
 })
 const cachesSafe=await p.evaluate(async()=>{
  let sawOffline=false
  for(const key of await caches.keys()){
   for(const req of await (await caches.open(key)).keys()){
    const pathname=new URL(req.url).pathname
    if(pathname.startsWith('/api/')||/thumb|token|ticket|upload|download|media/i.test(pathname))
     return false
    if(pathname==='/offline.html')sawOffline=true
   }
  }
  return sawOffline
 })
 await browser.close();browser=null
 return {...ui,cachesSafe}
}
function corrupt(){
 assert(browser===null,'never modify an open Chromium LevelDB profile')
 report.allProcessesClosedDuringCorruption=true
 const rootDir=path.join(profile,'Default','IndexedDB')
 const dirs=fs.readdirSync(rootDir,{withFileTypes:true})
  .filter(x=>x.isDirectory()&&x.name.endsWith('.indexeddb.leveldb'))
 assert.equal(dirs.length,1,'exactly one native origin LevelDB expected')
 const current=path.join(rootDir,dirs[0].name,'CURRENT')
 const st=fs.lstatSync(current)
 assert(st.isFile()&&!st.isSymbolicLink())
 assert(/^MANIFEST-[0-9]+\n?$/.test(fs.readFileSync(current,'utf8')))
 const payload=Buffer.from('MANIFEST-999999999\n')
 const fd=fs.openSync(current,'r+')
 try{fs.writeSync(fd,payload,0,payload.length,0);fs.ftruncateSync(fd,payload.length);fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 assert.equal(fs.readFileSync(current,'utf8'),payload.toString())
 report.realLevelDBCurrentCorrupted=true
}
async function run(){
 try{
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)})
  origin='http://127.0.0.1:'+server.address().port
  report.phase='native-positive-Owner-history'
  await save()
  report.phase='uncorrupted-second-Chrome-process-positive'
  const good=await coldRead()
  assert(good.warning&&good.historical&&good.noLive&&good.anonymous&&good.cachesSafe)
  report.positiveColdRestart=true
  report.phase='fsync-corrupt-original-closed-LevelDB-CURRENT'
  corrupt()
  report.phase='third-native-Chrome-post-corruption'
  const damaged=await coldRead()
  report.corruptColdLaunched=true
  report.corruptionOutcome=damaged.historical?'historical':
   damaged.empty&&!damaged.unknownRows?'empty':'unexpected'
  report.historicalWarning=damaged.warning
  report.offlineHistoryNeverAuthorized=damaged.noLive&&damaged.anonymous
  report.publicSWPrivateBytesAbsent=damaged.cachesSafe
  assert(damaged.warning&&damaged.noLive&&damaged.anonymous&&damaged.cachesSafe)
  assert(['historical','empty'].includes(report.corruptionOutcome))
  report.phase='fourth-native-Chrome-post-corruption'
  const repeated=await coldRead()
  assert(repeated.warning&&repeated.noLive&&repeated.anonymous&&repeated.cachesSafe)
  assert(repeated.historical||(repeated.empty&&!repeated.unknownRows))
  report.secondCorruptColdLaunch=true
  report.passed=true;report.phase='complete'
 }catch(e){
  console.error('PWA_CR03D_SAFE_FAIL phase='+report.phase+' kind='+
   String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32))
  process.exitCode=1
 }finally{
  await browser?.close().catch(()=>{})
  await new Promise(resolve=>server.close(()=>resolve()))
  fs.rmSync(tmp,{recursive:true,force:true})
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
 }
}
run()
