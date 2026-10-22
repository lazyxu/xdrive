#!/usr/bin/env node
'use strict'
// Genuine Chromium HTTP AbortSignal -> Go Context.Done; Server durable
// file-operation worker continues independently in the same Gin/PG17/CAS.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const chromium=require(process.env.XDRIVE_PLAYWRIGHT_MODULE||'playwright-core').chromium
const opts=Object.fromEntries(process.argv.slice(2).map(s=>{
  const m=/^--(ready|output-dir)=(.+)$/.exec(s);assert(m,'only --ready and --output-dir accepted');return[m[1],m[2]]
}))
assert(opts.ready&&opts['output-dir'])
const ready=JSON.parse(fs.readFileSync(opts.ready,'utf8'))
assert(ready.real_gin&&ready.postgresql&&ready.local_cas&&ready.pwa_s4d3_durable)
assert(ready.pwa_cr01b4_cancel_durable && ready.intercepted_api===false&&ready.physical_device===false)
const operationID=ready.durable_task_id.slice('file-operation:'.length)
assert(/^[a-f0-9-]{36}$/.test(operationID))
const output=path.resolve(opts['output-dir']);fs.mkdirSync(output,{recursive:true})
const info={sha:process.env.XD_PR_HEAD||'',realGin:true,postgresql:true,localCAS:true,
  browser:'native-Chromium-390px',installedIOS:false,interceptedAPI:false,
  authOwnerReady:false,readPhysicalBytes:false,readActualContextCancelled:false,
  readGoHandlerExited:false,queuedDurableUnaffected:false,durableWorkerStartedBeforeReadAbort:false,
  serverWorkerCompleted:false,
  ownerScopedTaskPersisted:false,publicSWOnly:false,passed:false,phase:'setup'}
let browser
async function poll(fn,ms=20000){
  const until=Date.now()+ms
  while(Date.now()<until){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,120))}
  throw Error('bounded real Go/Worker acceptance timed out')
}
async function main(){
  try{
    assert(process.env.XDRIVE_BROWSER_EXECUTABLE)
    browser=await chromium.launch({executablePath:process.env.XDRIVE_BROWSER_EXECUTABLE,
      headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
    const ctx=await browser.newContext({viewport:{width:390,height:844},
      isMobile:true,hasTouch:true,serviceWorkers:'allow'})
    const p=await ctx.newPage()
    p.setDefaultTimeout(30000)
    info.phase='real-owner-login'
    await p.goto(ready.url+'/#/app/files',{waitUntil:'domcontentloaded'})
    await p.locator('#web-login-username').fill(ready.username)
    await p.locator('#web-login-password').fill('PwaRealGin-TestOnly_2026!')
    await p.getByRole('button',{name:'登录',exact:true}).click()
    await p.waitForFunction(()=>(localStorage.getItem('xdrive.access_token')||'').length>16)
    info.authOwnerReady=true
    await p.waitForLoadState('load')
    await p.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.active))
    await p.reload({waitUntil:'domcontentloaded'})
    await p.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
    const check=await p.evaluate(async operationID=>{
      const token=localStorage.getItem('xdrive.access_token')
      const r=await fetch('/api/v1/file-operations/'+operationID,{
        headers:{Authorization:'Bearer '+token},cache:'no-store'})
      return {status:r.status,state:r.ok?(await r.json()).status:null}
    },operationID)
    assert.deepEqual(check,{status:200,state:'queued'})
    info.queuedDurableUnaffected=true
    info.phase='real-go-chunked-read-and-browser-abort'
    const read=await p.evaluate(async targetID=>{
      const token=localStorage.getItem('xdrive.access_token')
      const controller=new AbortController()
      const response=await fetch('/api/v1/nodes/'+targetID+
        '/children?offset=0&limit=1&sort=name&order=asc&include_count=false',{
        cache:'no-store',signal:controller.signal,
        headers:{Authorization:'Bearer '+token,'X-PWA-CR01B4-Slow-Read':'real-go-context'}})
      if(response.status!==200||!response.body)throw Error('genuine Gin Owner Range denied')
      const reader=response.body.getReader()
      const part=await reader.read()
      if(part.done||!part.value||part.value.byteLength<1)throw Error('no real Go response bytes')
      window.__pwaCR01b4HeldRead={controller,reader}
      return {bytesReceived:part.value.byteLength,pending:!controller.signal.aborted}
    },ready.target_id)
    assert(read.bytesReceived>0 && read.pending)
    info.readPhysicalBytes=true
    const before=await ctx.request.get(ready.url+'/__test/pwa-cr01b4/proof')
    assert.equal(before.status(),200)
    const initial=await before.json()
    assert(initial.read_started && !initial.read_context_cancelled && !initial.read_handler_exited)
    info.phase='start-durable-Worker-before-short-read-abort'
    const start=await ctx.request.post(ready.url+'/__test/pwa-s4d3/start-worker',
      {headers:{'X-PWA-Durable-Test-Start':'s4d3-server-worker-only'}})
    assert.equal(start.status(),204)
    info.durableWorkerStartedBeforeReadAbort=true
    info.phase='abort-held-original-Gin-HTTP-read'
    const aborted=await p.evaluate(async()=>{
      const held=window.__pwaCR01b4HeldRead
      if(!held || held.controller.signal.aborted)throw Error('original stream not pending')
      held.controller.abort()
      let rejected=false
      try{await held.reader.read()}catch(e){rejected=e?.name==='AbortError'}
      return {aborted:held.controller.signal.aborted,rejected}
    })
    assert(aborted.aborted)
    const proof=await poll(async()=>{
      const r=await ctx.request.get(ready.url+'/__test/pwa-cr01b4/proof')
      if(r.status()!==200)return false
      const value=await r.json()
      return value.read_started && value.read_context_cancelled && value.read_handler_exited ? value:false
    })
    assert(proof.read_context_cancelled&&proof.read_handler_exited)
    info.readActualContextCancelled=true
    info.readGoHandlerExited=true
    info.phase='verify-original-durable-Worker-completion'
    const done=await poll(async()=>p.evaluate(async op=>{
      const token=localStorage.getItem('xdrive.access_token')
      const r=await fetch('/api/v1/file-operations/'+op,
        {headers:{Authorization:'Bearer '+token},cache:'no-store'})
      if(r.status!==200)return null
      const data=await r.json()
      return data.status==='completed' && data.processed_items===1 && data.finished_at ? data:null
    },operationID),30000)
    assert.equal(done.status,'completed')
    info.serverWorkerCompleted=true
    info.ownerScopedTaskPersisted=true
    const cache=await p.evaluate(async()=>{
      const entries=[]
      for(const key of await caches.keys()){
        const c=await caches.open(key)
        for(const req of await c.keys())entries.push(new URL(req.url).pathname)
      }
      return entries
    })
    assert(cache.includes('/offline.html'))
    assert(!cache.some(x=>x.startsWith('/api/')||/uploads|token|media\/items|file-operations/.test(x)))
    info.publicSWOnly=true
    info.phase='authentic-sql-postflight'
    const finished=await ctx.request.post(ready.url+'/__test/pwa-s2b3/finish')
    assert.equal(finished.status(),204)
    info.passed=true;info.phase='done'
    await ctx.close()
  }catch(e){
    console.error('PWA_CR01B4_SAFE_FAIL phase='+info.phase+' kind='+
      String(e?.name||'Error').replace(/[^A-Za-z]/g,'').slice(0,32))
    process.exitCode=1
  }finally{
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(info,null,2)+'\n',{mode:0o600})
    await browser?.close()
  }
}
main()
