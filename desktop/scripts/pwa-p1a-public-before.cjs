#!/usr/bin/env node
'use strict'
// Normal production Vite Web public shell: BEFORE only, not 100k Go/PG/CAS.
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http')
const {gzipSync}=require('node:zlib'),{performance}=require('node:perf_hooks')
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core')
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'web/dist')
const chrome=process.env.XDRIVE_BROWSER_EXECUTABLE,head=process.env.XD_PR_HEAD
const outfile=process.env.XD_PWA_P1A_OUT||path.join(root,'desktop/pwa-p1a-results/summary.json')
const WIDTHS=[390,430,899,900,1280],N=3
assert(chrome&&fs.existsSync(chrome)&&/^[a-f0-9]{40}$/.test(head||''))
const manifest=JSON.parse(fs.readFileSync(path.join(dist,'.vite/manifest.json'),'utf8'))
const entry=Object.keys(manifest).filter(k=>manifest[k]?.isEntry)
assert.equal(entry.length,1)
const seen=new Set(),synchronous=new Set(),deferred=new Set()
function walk(key,initial){
 if(!manifest[key]||seen.has((initial?'s':'d')+key))return
 seen.add((initial?'s':'d')+key)
 if(initial)synchronous.add(key);else deferred.add(key)
 for(const child of manifest[key].imports||[])walk(child,initial)
 for(const child of manifest[key].dynamicImports||[])walk(child,false)
}
walk(entry[0],true)
function graph(keys){
 const paths=new Set()
 for(const k of keys)for(const file of [manifest[k].file,...(manifest[k].css||[]),...(manifest[k].assets||[])])if(file)paths.add(file)
 return [...paths].sort().map(file=>{
  assert(/^assets\/[A-Za-z0-9_./-]+\.(?:js|css|svg|png|webp|woff2?)$/.test(file))
  const full=path.resolve(dist,file),st=fs.lstatSync(full)
  assert(full.startsWith(dist+path.sep)&&st.isFile()&&!st.isSymbolicLink())
  const b=fs.readFileSync(full)
  return {file,raw:b.length,gzip:gzipSync(b).length}
 })
}
const initial=graph(synchronous),dynamic=graph(deferred)
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css',
 '.webmanifest':'application/manifest+json','.json':'application/json',
 '.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'}
const server=http.createServer((req,res)=>{
 let uri;try{uri=new URL(req.url,'http://127.0.0.1')}catch{res.writeHead(400);res.end();return}
 if(uri.pathname.startsWith('/api/')){
  res.writeHead(401,{'Cache-Control':'no-store','Content-Type':'application/json'})
  res.end('{"error":"not authenticated"}');return
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 let rel;try{rel=decodeURIComponent(uri.pathname)}catch{res.writeHead(400);res.end();return}
 if(rel==='/')rel='/index.html'
 if(rel.includes('\0')||rel.includes('\\')||rel.includes('..')){res.writeHead(400);res.end();return}
 const filename=path.resolve(dist,'.'+rel)
 if(!filename.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
 let st;try{st=fs.lstatSync(filename)}catch{res.writeHead(404);res.end();return}
 if(!st.isFile()||st.isSymbolicLink()){res.writeHead(404);res.end();return}
 res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream',
  'Content-Length':String(st.size),'X-Content-Type-Options':'nosniff',
  'Cache-Control':rel==='/sw.js'||rel==='/index.html'?'no-cache':'public,max-age=31536000,immutable'})
 if(req.method==='HEAD'){res.end();return}
 fs.createReadStream(filename).pipe(res)
})
async function sample(page,origin,warm){
 let bytes=0,scripts=0,requests=0
 const cdp=await page.context().newCDPSession(page)
 await cdp.send('Network.enable')
 const kind=new Map()
 cdp.on('Network.responseReceived',x=>{
  if(!x.response.url.startsWith(origin))return
  kind.set(x.requestId,/\/assets\/.*\.js(?:$|\?)/.test(x.response.url)?'js':'other')
 })
 cdp.on('Network.loadingFinished',x=>{
  const k=kind.get(x.requestId);if(!k)return
  requests++;bytes+=x.encodedDataLength
  if(k==='js')scripts+=x.encodedDataLength
 })
 const t=performance.now()
 const resp=warm?await page.reload({waitUntil:'domcontentloaded'}):
   await page.goto(origin+'/#/app/files',{waitUntil:'domcontentloaded'})
 assert.equal(resp?.status(),200)
 await page.locator('#web-login-username').waitFor({state:'visible',timeout:30000})
 const visible=Number((performance.now()-t).toFixed(3))
 await page.waitForTimeout(150)
 const paints=await page.evaluate(()=>{
  const nav=performance.getEntriesByType('navigation')[0]
  const fcp=performance.getEntriesByType('paint').find(x=>x.name==='first-contentful-paint')
  return {fcpMs:fcp?Number(fcp.startTime.toFixed(3)):null,
    domContentLoadedMs:Number((nav?.domContentLoadedEventEnd||0).toFixed(3))}
 })
 await cdp.detach()
 return {visibleMs:visible,bytes,scripts,requests,...paints}
}
const p50=items=>[...items].sort((a,b)=>a-b)[Math.floor((items.length-1)/2)]
async function main(){
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)})
 const origin='http://127.0.0.1:'+server.address().port,samples=[]
 try{
  for(const width of WIDTHS)for(let n=0;n<N;n++){
   const profile=fs.mkdtempSync(path.join(os.tmpdir(),'xd-pwa-public-'))
   let browser
   try{
    browser=await chromium.launchPersistentContext(profile,{
     executablePath:chrome,headless:true,viewport:{width,height:844},
     isMobile:width<900,hasTouch:width<900,serviceWorkers:'allow',
     args:['--no-sandbox','--disable-dev-shm-usage']})
    const page=browser.pages()[0]||await browser.newPage()
    const cold=await sample(page,origin,false)
    const warm=await sample(page,origin,true)
    samples.push({width,repeat:n,cold,warm})
   }finally{await browser?.close();fs.rmSync(profile,{force:true,recursive:true})}
  }
  const summary={sha:head,schema:'pwa-p1a-normal-web-public-before-v1',
   physicalIOS:false,authenticated100k:false,productionSourceChanged:false,
   after:null,pairedAfter:false,viewports:WIDTHS,n:N,samples,
   initial,optional:dynamic,initialGzipBytes:initial.reduce((v,f)=>v+f.gzip,0),
   initialRawBytes:initial.reduce((v,f)=>v+f.raw,0),
   perViewport:WIDTHS.map(width=>{
    const r=samples.filter(s=>s.width===width)
    return {width,coldP50Ms:p50(r.map(s=>s.cold.visibleMs)),
      warmP50Ms:p50(r.map(s=>s.warm.visibleMs)),
      coldByteP50:p50(r.map(s=>s.cold.bytes)),
      warmByteP50:p50(r.map(s=>s.warm.bytes))}
   })}
  assert.equal(samples.length,15)
  assert(summary.initialGzipBytes>0)
  fs.mkdirSync(path.dirname(outfile),{recursive:true})
  fs.writeFileSync(outfile,JSON.stringify(summary,null,2)+'\n',{mode:0o600})
  console.log('PWA_P1A_REAL_PUBLIC_BEFORE '+JSON.stringify({
   sha:head,n:samples.length,initialGzipBytes:summary.initialGzipBytes,
   cold390P50:summary.perViewport[0].coldP50Ms}))
 }finally{server.close()}
}
main().catch(e=>{console.error('PWA_P1A_SAFE_FAIL '+String(e?.name||'Error').replace(/[^A-Za-z]/g,''));process.exitCode=1})
