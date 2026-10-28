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
test('S3B: a stalled JSON body after valid 200 headers times out instead of reporting malformed JSON', async () => {
  let bodyAborted = false
  const result = await probe({ timeoutMs: 1000, request: async (_path, init) => ({
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        bodyAborted = true
        reject(new Error('interrupted response body'))
      }, { once: true })
    }),
  }) })
  assert.equal(bodyAborted, true)
  assert.deepEqual(result, { state: 'timed-out' })
})

test('S3B: an explicit cancellation during JSON body consumption is not reported as malformed HTTP 200', async () => {
  const controller = new AbortController()
  let notifyBodyStarted
  const bodyStarted = new Promise(resolve => { notifyBodyStarted = resolve })
  const pending = probe({ signal: controller.signal, request: async (_path, init) => ({
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('cancelled body')), { once: true })
      notifyBodyStarted()
    }),
  }) })
  await bodyStarted
  controller.abort()
  assert.deepEqual(await pending, { state: 'cancelled' })
})

test('S3B: a late ready JSON body after cancellation cannot masquerade as a healthy Server', async () => {
  const controller = new AbortController()
  let notifyBodyStarted
  let resolveBody
  const bodyStarted = new Promise(resolve => { notifyBodyStarted = resolve })
  const pending = probe({ signal: controller.signal, request: async () => ({
    status: 200,
    headers: { get: () => 'application/json' },
    // A faulty reader that ignores AbortSignal must still not report success.
    json: () => new Promise(resolve => {
      resolveBody = resolve
      notifyBodyStarted()
    }),
  }) })
  await bodyStarted
  controller.abort()
  resolveBody({ ok: true })
  assert.deepEqual(await pending, { state: 'cancelled' })
})

// Keep intentionally non-cooperative Promise fixtures bounded even if a
// regression removes the production deadline, rather than hanging all CI.
async function expectBoundedProbe(options) {
  let watchdog
  try {
    return await Promise.race([
      probe(options),
      new Promise((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error('readiness probe never returned')), 4000)
      }),
    ])
  } finally {
    clearTimeout(watchdog)
  }
}

test('S3B: a request that ignores AbortSignal cannot strand the readiness UI after deadline', async () => {
  let requestSignal
  const result = await expectBoundedProbe({ timeoutMs: 1000, request: (_path, init) => {
    requestSignal = init.signal
    return new Promise(() => {}) // Broken native adapter never rejects on abort.
  } })
  assert.deepEqual(result, { state: 'timed-out' })
  assert.equal(requestSignal.aborted, true, 'the original transport is still asked to abort')
})

test('S3B: an unresponsive JSON body cannot strand the readiness UI after deadline', async () => {
  let requestSignal
  const result = await expectBoundedProbe({ timeoutMs: 1000, request: async (_path, init) => {
    requestSignal = init.signal
    return {
      status: 200, headers: { get: () => 'application/json' },
      json: () => new Promise(() => {}), // Headers arrived, body never settles.
    }
  } })
  assert.deepEqual(result, { state: 'timed-out' })
  assert.equal(requestSignal.aborted, true)
})

test('S3B: user cancellation returns even when the browser transport ignores AbortSignal', async () => {
  const controller = new AbortController()
  let signal
  let notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  const pending = expectBoundedProbe({ signal: controller.signal, timeoutMs: 10000, request: (_path, init) => {
    signal = init.signal
    notifyStarted()
    return new Promise(() => {})
  } })
  await started
  controller.abort()
  assert.deepEqual(await pending, { state: 'cancelled' })
  assert.equal(signal.aborted, true)
})


test('S3B Safari: denied caller AbortSignal read or subscription prevents all readiness requests', async () => {
  for (const denied of ['getter', 'subscription', 'recheck']) {
    let reads = 0
    let subscriptions = 0
    let cleanup = 0
    let requests = 0
    const signal = {
      get aborted() {
        reads++
        if (denied === 'getter' || (denied === 'recheck' && reads === 2)) {
          throw Error('WebKit denied AbortSignal.aborted')
        }
        return false
      },
      addEventListener() {
        subscriptions++
        if (denied === 'subscription') throw Error('WebKit denied AbortSignal listener')
      },
      removeEventListener() { cleanup++ },
    }
    const result = await probe({signal, request:()=>{requests++;return Promise.resolve({status:200})}})
    assert.deepEqual(result, {state:'browser-restricted'}, denied)
    assert.equal(requests, 0, 'no public GET may start without observable cancellation')
    assert.equal(subscriptions, denied === 'getter' ? 0 : 1)
    assert.equal(cleanup, denied === 'recheck' ? 1 : 0)
  }
})

test('S3B Safari: cancellation during listener admission never dispatches readiness GET', async () => {
  let reads = 0
  let removals = 0
  let requests = 0
  const signal = {
    get aborted() { reads++; return reads === 2 },
    addEventListener() {},
    removeEventListener() { removals++ },
  }
  assert.deepEqual(await probe({signal, request:()=>{requests++;return Promise.resolve({status:200})}}),
    {state:'cancelled'})
  assert.equal(reads, 2)
  assert.equal(requests, 0)
  assert.equal(removals, 1)
})

test('S3B Safari: denied cleanup cannot discard the actual healthy response', async () => {
  let removed = 0
  const signal = {
    aborted:false,
    addEventListener() {},
    removeEventListener() { removed++; throw Error('WebKit denied removeEventListener') },
  }
  const result = await probe({signal,request:async()=>({
    status:200, headers:{get:()=> 'application/json'},json:async()=>({ok:true}),
  })})
  assert.deepEqual(result,{state:'ready',httpStatus:200})
  assert.equal(removed,1)
})

test('S3B Safari: restricted browser is distinct from offline Server and never a green probe', () => {
  const ui = fs.readFileSync(path.join(root,'web/src/PwaUpdateSection.tsx'),'utf8')
  assert.ok(ui.includes("serverResult?.state === 'browser-restricted'"))
  assert.ok(ui.includes('未发送服务器请求'))
  assert.doesNotMatch(source,/Authorization|localStorage|sessionStorage|POST|PUT|DELETE|skipWaiting|location.reload/)
})
