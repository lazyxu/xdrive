const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaSafeReadRetry.ts'), 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'pwaSafeReadRetry.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function browser(visibilityState = 'visible', timers = {}) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'document', 'fetch', 'DOMException', 'setTimeout', 'clearTimeout', code)(
    mod, mod.exports, { visibilityState }, () => { throw Error('Unexpected implicit fetch') },
    DOMException, timers.setTimeout ?? setTimeout, timers.clearTimeout ?? clearTimeout,
  )
  return mod.exports.xDriveFetchPwaSafeRead
}
function response(status, retryAfter = '0') {
  let cancelled = 0
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([4, 2, 9])) },
    cancel() { cancelled++ },
  })
  return {
    response: new Response(stream, { status, headers: { 'Retry-After': retryAfter } }),
    cancelled: () => cancelled,
  }
}
const pathName = '/api/v1/nodes/42/children?range=true'

test('PWA safe GET retry releases first 503 stream before second owner request', async () => {
  const first = response(503)
  let requests = 0
  const result = await browser()(pathName, pathName, {}, async () => {
    requests++
    if (requests === 2) {
      assert.equal(first.cancelled(), 1, 'abandoned first response must release HTTP stream before retry')
      return new Response('{}', {status:200})
    }
    return first.response
  })
  assert.equal(result.status, 200)
  assert.equal(first.cancelled(), 1)
  assert.equal(requests, 2)
})

test('PWA safe GET with long Retry-After keeps original 429 body readable and never cancels', async () => {
  const first = response(429, '180')
  let requests = 0
  const returned = await browser()(pathName, pathName, {}, async () => { requests++; return first.response })
  assert.strictEqual(returned, first.response)
  assert.equal(requests, 1)
  assert.equal(first.cancelled(), 0)
  await first.response.body.cancel()
})

test('PWA safe GET abort releases abandoned body and prevents second HTTP request', async () => {
  const first = response(503, '1')
  const controller = new AbortController()
  let requests = 0
  const pending = browser()(pathName, pathName, {signal:controller.signal}, async () => { requests++; return first.response })
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(pending, {name:'AbortError'})
  assert.equal(first.cancelled(), 1)
  assert.equal(requests, 1)
})

test('PWA safe GET does not cancel mutation or nonretry response bodies', async () => {
  const first = response(503)
  const result = await browser()(pathName, pathName, {method:'POST'}, async () => first.response)
  assert.strictEqual(result, first.response)
  assert.equal(first.cancelled(), 0)
  await first.response.body.cancel()
})

test('PWA body cancellation rejection does not stop bounded retry or leak an unhandled promise', async () => {
  let cancelCalls = 0
  const first = { status:503, headers:{get:()=> '0'}, body:{cancel(){cancelCalls++;return Promise.reject(new Error('already closed'))}} }
  let attempts = 0
  const result = await browser()(pathName, pathName, {}, async () => ++attempts === 1 ? first : new Response(null,{status:200}))
  assert.equal(cancelCalls, 1)
  assert.equal(attempts, 2)
  assert.equal(result.status, 200)
})

test('restricted WebKit abort listener refuses HTTP retry without cancelling original 503 or scheduling a timer', async () => {
  const original = response(503, '0')
  let timers = 0
  let attempts = 0
  const read = browser('visible', {
    setTimeout(...args) { timers++; return setTimeout(...args) },
  })
  const signal = {
    aborted: false,
    addEventListener() { throw new Error('WebKit refuses abort listener') },
    removeEventListener() { throw new Error('WebKit refuses cleanup') },
  }
  const returned = await read(pathName, pathName, { signal }, async () => {
    attempts++
    return original.response
  })
  assert.strictEqual(returned, original.response, 'HTTP 503 with readable body must be returned unchanged')
  assert.equal(original.cancelled(), 0, 'unobservable cancellation must never discard first HTTP body')
  assert.equal(attempts, 1, 'unobservable cancellation must not issue second Owner GET')
  assert.equal(timers, 0, 'denied abort listeners must not leave orphan retry timers')
  await returned.body.cancel()
})

test('restricted WebKit abort listener preserves first offline TypeError without a retry timer', async () => {
  const original = new TypeError('first network failure')
  const signal = {
    aborted: false,
    addEventListener() { throw new Error('WebKit listener denied') },
    removeEventListener() { throw new Error('cleanup denied') },
  }
  let attempts = 0
  let timers = 0
  const read = browser('visible', {
    setTimeout(...args) { timers++; return setTimeout(...args) },
  })
  await assert.rejects(read(pathName, pathName, { signal }, async () => {
    attempts++
    throw original
  }), error => error === original)
  assert.equal(attempts, 1)
  assert.equal(timers, 0)
})

test('WebKit refusing abort-listener removal never crashes an otherwise successful safe GET retry', async () => {
  const original = response(503, '0')
  const signal = {
    aborted: false,
    addEventListener() { /* successfully armed */ },
    removeEventListener() { throw new Error('WebKit removal denied') },
  }
  let attempts = 0
  const result = await browser()(pathName, pathName, { signal }, async () => {
    attempts++
    return attempts === 1 ? original.response : new Response(null, { status: 200 })
  })
  assert.equal(result.status, 200)
  assert.equal(attempts, 2)
  assert.equal(original.cancelled(), 1, 'the first body remains released for healthy retriers')
})
