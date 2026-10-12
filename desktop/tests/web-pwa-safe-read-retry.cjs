const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaSafeReadRetry.ts'), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const exported = {}
new Function('exports', 'document', 'fetch', 'DOMException', code)(
  exported, { visibilityState: 'visible' }, async () => { throw Error('unexpected fetch') }, DOMException,
)
const { xDriveFetchPwaSafeRead: request, xDrivePwaRetryableRead: eligible } = exported
const itemPath = '/api/v1/nodes/42/children?range=true'
const ok = { status: 200, headers: { get: () => null } }
function limited(status, header) {
  return { status, headers: { get(name) { return name === 'Retry-After' ? header ?? null : null } } }
}

test('S3C safe method/path allowlist excludes every mutable request and ticket', () => {
  for (const name of ['/api/v1/nodes/42/children', '/api/v1/search?query=a',
    '/api/v1/media/items', '/api/v1/file-favorites', '/api/v1/file-saved-searches']) {
    assert.equal(eligible(name, {}), true, name)
  }
  for (const name of ['/api/v1/auth/refresh', '/api/v1/uploads', '/api/v1/download/file',
    '/api/v1/archive-download/2', '/api/v1/file-download/2', '/api/v1/public/share',
    '/api/v1/admin/update', '/not-api', '/api/v1/nodes2']) {
    assert.equal(eligible(name, {}), false, name)
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    assert.equal(eligible(itemPath, { method }), false)
  }
  assert.equal(eligible(itemPath, { method: 'GET', body: 'unsafe' }), false)
})

test('S3C 503 read retry occurs once, preserving caller signal and options', async () => {
  const ac = new AbortController(), calls = []
  const init = { method: 'GET', signal: ac.signal, headers: { Authorization: 'Bearer private' } }
  const result = await request(itemPath, itemPath, init, async (url, options) => {
    calls.push([url, options]); return calls.length === 1 ? limited(503) : ok
  })
  assert.equal(result.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[1][1].signal, ac.signal)
  assert.equal(calls[1][1].headers.Authorization, 'Bearer private')
})

test('S3C 429 Retry-After honoured, long cooldown not shortened', async () => {
  for (const [header, expectedCalls] of [['0', 2], ['180', 1]]) {
    let count = 0
    const outcome = await request(itemPath, itemPath, {}, async () => {
      count++; return count === 1 ? limited(429, header) : ok
    })
    assert.equal(count, expectedCalls)
    assert.equal(outcome.status, expectedCalls === 2 ? 200 : 429)
  }
})

test('S3C 401/403/404/500 not retried and side-effecting GET routes excluded', async () => {
  for (const status of [401, 403, 404, 500]) {
    let calls = 0
    await request(itemPath, itemPath, {}, async () => { calls++; return limited(status) })
    assert.equal(calls, 1)
  }
  for (const opts of [{ method: 'POST' }, { method: 'GET' }]) {
    let calls = 0
    const path = opts.method === 'POST' ? '/api/v1/uploads' : '/api/v1/download/ticket'
    await request(path, path, opts, async () => { calls++; return limited(503) })
    assert.equal(calls, 1)
  }
})

test('S3C abort while waiting prevents second request', async () => {
  const ac = new AbortController(); let calls = 0
  const running = request(itemPath, itemPath, { signal: ac.signal }, async () => {
    calls++; return limited(503)
  })
  setTimeout(() => ac.abort(), 20)
  await assert.rejects(running, e => e.name === 'AbortError')
  assert.equal(calls, 1)
})

test('S3C network failure retry only for safe visible GET; second failure is terminal', async () => {
  let count = 0
  await assert.rejects(request(itemPath, itemPath, {}, async () => {
    count++; throw new TypeError('network failed')
  }), TypeError)
  assert.equal(count, 2)
})

test('S3C hidden documents never retry stale reads', async () => {
  const hidden = {}
  new Function('exports', 'document', 'fetch', 'DOMException', code)(
    hidden, { visibilityState: 'hidden' }, async () => { throw Error('unexpected fetch') }, DOMException,
  )
  let count = 0
  const response = await hidden.xDriveFetchPwaSafeRead(itemPath, itemPath, {}, async () => {
    count++; return limited(503)
  })
  assert.equal(count, 1)
  assert.equal(response.status, 503)
})

test('S3C invalid Retry-After is not reinterpreted as an early retry', async () => {
  let calls = 0
  const result = await request(itemPath, itemPath, {}, async () => {
    calls++; return limited(429, 'not-a-date-or-seconds')
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 429)
})

test('S3C production request adapter only invokes bounded retry helper on known paths', () => {
  const api = fs.readFileSync(path.join(root, 'web/src/api.ts'), 'utf8')
  const docs = fs.readFileSync(path.join(root, 'docs/pwa-delivery.md'), 'utf8')
  assert.ok(api.includes("import { xDriveFetchPwaSafeRead } from './pwaSafeReadRetry'"))
  const urlTemplate = '$' + '{API_BASE}' + '$' + '{path}'
  assert.ok(api.includes('xDriveFetchPwaSafeRead(' + String.fromCharCode(96) + urlTemplate + String.fromCharCode(96) + ', path, { ...init, headers })'))
  assert.ok(docs.includes('PWA-S3C'))
  assert.doesNotMatch(source, /skipWaiting\s*\(|window.location.reload|localStorage|sessionStorage/)
})
