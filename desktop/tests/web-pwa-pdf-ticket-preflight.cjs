const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = path.join(__dirname, '../../web/src/webPDFTicketPreflight.ts')
const output = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  fileName: source,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleUnderTest = { exports: {} }
new Function('exports', 'module', 'require', output)(
  moduleUnderTest.exports, moduleUnderTest, require)
const { xDrivePreflightWebPDFTicket } = moduleUnderTest.exports

const ticket = (origin = 'https://api.xdrive.example') =>
  origin + '/api/v1/file-preview/27?ticket=opaque-ticket'
const response = (status, contentType = 'application/pdf') => ({
  status,
  headers: { get: (key) => key.toLowerCase() === 'content-type' ? contentType : null },
})
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

test('Web/PWA PDF preflight accepts exact authenticated API-origin tickets, not arbitrary HTML', async () => {
  const oldFetch = global.fetch
  const oldWindow = global.window
  const calls = []
  global.window = { location: { href: 'https://web.xdrive.example/#/files' } }
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return response(206, 'application/pdf; charset=binary')
  }
  try {
    const signal = new AbortController().signal
    await xDrivePreflightWebPDFTicket(ticket(), signal)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, ticket(),
      'the known XDrive API origin may differ from the Web/PWA origin')
    assert.equal(calls[0].options.method, 'HEAD')
    assert.equal(calls[0].options.signal, signal)
    assert.equal(calls[0].options.credentials, 'omit')
    assert.equal(calls[0].options.redirect, 'error')
    assert.equal(calls[0].options.referrerPolicy, 'no-referrer')
    assert.equal(calls[0].options.cache, 'no-store')
  } finally {
    global.fetch = oldFetch
    global.window = oldWindow
  }
})

test('Web/PWA PDF iframe is gated on HTTP status and PDF MIME, including retry attempts', async () => {
  const oldFetch = global.fetch
  const failures = [
    response(401, 'text/html'),
    response(404, 'text/html'),
    response(500, 'application/pdf'),
    response(200, 'text/html; charset=utf-8'),
    response(206, 'application/json'),
  ]
  let attempts = 0
  global.fetch = async () => failures[attempts++] ?? response(200)
  try {
    for (const candidate of failures) {
      await assert.rejects(
        xDrivePreflightWebPDFTicket(ticket()),
        /PDF preview stream is not available|PDF preview returned a non-PDF resource/,
        'HTTP ' + candidate.status + ' cannot become iframe-ready')
    }
    await xDrivePreflightWebPDFTicket(ticket())
    assert.equal(attempts, failures.length + 1,
      'a subsequent explicit preview attempt may acquire a working ticket')
  } finally {
    global.fetch = oldFetch
  }
})

test('Web/PWA PDF preflight rejects malformed ticket paths without making requests', async () => {
  const oldFetch = global.fetch
  const calls = []
  global.fetch = async (...args) => { calls.push(args); return response(200) }
  try {
    for (const url of [
      'https://api.xdrive.example/api/v1/file-preview/27',
      'https://api.xdrive.example/api/v1/file-preview/27?ticket=valid&debug=1',
      'https://api.xdrive.example/api/v1/file-preview/abc?ticket=valid',
      'https://user:password@api.xdrive.example/api/v1/file-preview/27?ticket=valid',
      'javascript:alert(1)',
      'not-a-ticket',
    ]) {
      await assert.rejects(xDrivePreflightWebPDFTicket(url), /Invalid PDF preview ticket/)
    }
    assert.equal(calls.length, 0)
  } finally {
    global.fetch = oldFetch
  }
})

test('Web/PWA PDF preflight cannot publish success after a Viewer replacement abort', async () => {
  const oldFetch = global.fetch
  const pending = deferred()
  let requestSignal
  global.fetch = async (_url, options) => {
    requestSignal = options.signal
    return pending.promise
  }
  try {
    const controller = new AbortController()
    const operation = xDrivePreflightWebPDFTicket(ticket(), controller.signal)
    controller.abort()
    pending.resolve(response(200))
    await assert.rejects(operation, { name: 'AbortError' })
    assert.equal(requestSignal.aborted, true,
      'the replaced Viewer cancels its PDF status request')
  } finally {
    global.fetch = oldFetch
  }
})
