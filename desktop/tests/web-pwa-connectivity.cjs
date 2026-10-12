const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root,'web/src/pwaConnectivity.ts'), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mod = {exports:{}}
new Function('module','exports','fetch','AbortController','setTimeout','clearTimeout',compiled)(mod,mod.exports,async()=>({status:200}),AbortController,setTimeout,clearTimeout)
const probe = mod.exports.xDriveProbePwaServer

test('S3B: only public uncredentialed same-origin readiness is queried', async () => {
  let captured
  assert.deepEqual(await probe({request:async (...args)=>{captured=args;return {status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true})}}}),{state:'ready',httpStatus:200})
  assert.equal(captured[0],'/api/v1/readyz')
  assert.equal(captured[1].method,'GET')
  assert.equal(captured[1].mode,'same-origin')
  assert.equal(captured[1].credentials,'omit')
  assert.equal(captured[1].cache,'no-store')
  assert.equal(captured[1].redirect,'error')
  assert.ok(captured[1].signal)
})
test('S3B: HTML SPA fallback or malformed readiness 200 cannot pass as healthy', async () => {
  for (const response of [
    {status:200,headers:{get:()=> 'text/html'},json:async()=>({ok:true})},
    {status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:false})},
    {status:200,headers:{get:()=> 'application/json'},json:async()=>{throw Error('corrupt')}},
  ]) assert.deepEqual(await probe({request:async()=>response}),{state:'unexpected-response',httpStatus:200})
})
test('S3B: unavailable, throttled and access-blocked statuses do not become online successes', async()=>{
  for (const [status,state] of [[503,'server-unavailable'],[429,'rate-limited'],[403,'access-blocked'],[401,'access-blocked'],[500,'unexpected-response']]) {
    assert.deepEqual(await probe({request:async()=>({status})}),{state,httpStatus:status})
  }
})
test('S3B: network failure and user cancellation remain different states',async()=>{
  assert.deepEqual(await probe({request:async()=>{throw Error('offline')}}),{state:'network-unavailable'})
  const controller=new AbortController();controller.abort()
  assert.deepEqual(await probe({signal:controller.signal,request:async()=>({status:200})}),{state:'cancelled'})
})
test('S3B: a hanging probe can be aborted and never leaves a running request',async()=>{
  let aborted=false
  const outcome=await probe({timeoutMs:1000,request:async(_path,init)=>new Promise((_resolve,reject)=>{
    init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('timeout'))},{once:true})
  })})
  assert.equal(aborted,true)
  assert.deepEqual(outcome,{state:'timed-out'})
})
test('S3B: unmount cancellation never surfaces as server offline',async()=>{
  const controller=new AbortController()
  const running=probe({signal:controller.signal,request:async(_path,init)=>new Promise((_resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})
  })})
  controller.abort()
  assert.deepEqual(await running,{state:'cancelled'})
  assert.doesNotMatch(source,/Authorization|localStorage|sessionStorage|POST|PUT|DELETE|skipWaiting|location.reload/)
})
test('S3B: real update section includes explicit no-credentials Server check',()=>{
  const section=fs.readFileSync(path.join(root,'web/src/PwaUpdateSection.tsx'),'utf8')
  const docs=fs.readFileSync(path.join(root,'docs/pwa-delivery.md'),'utf8')
  assert.ok(section.includes("import { xDriveProbePwaServer } from './pwaConnectivity'"))
  assert.ok(section.includes('data-xdrive-pwa-check-server'))
  assert.ok(section.includes('serverRequestRef.current?.abort()'))
  assert.ok(section.includes('不传输登录凭据'))
  assert.ok(docs.includes('PWA-S3B'))
  assert.doesNotMatch(section,/window.location.reload|skipWaiting|localStorage/)
})
