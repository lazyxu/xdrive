'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { auditBaiduUpstreamHAR } = require(path.resolve(__dirname, '../../scripts/ci/baidu-jsapi4-upstream-har-audit.cjs'))

const ORIGIN = 'https://gallery.example.invalid'
const AK = 'synthetic-browser-ak-server-secret'
const HOST = 'https://api.map.baidu.com'
const hdr = [{ name: 'BMAP_PROXY_URL', value: ORIGIN + '/_BMapService/' }]
function resource(pathname, mime = 'application/javascript', body = 'window.BMap = {};') {
  const url = HOST + pathname + (pathname.startsWith('/api?') ? '&' : '?') + 'ak=' + encodeURIComponent(AK)
  return { request: { method: 'GET', url, headers: [...hdr] }, response: {
    status: 200, headers: [{ name: 'Content-Type', value: mime }], content: { mimeType: mime, text: body },
  } }
}
const load = () => ({ log: { entries: [
  resource('/api?v=4.0'),
  resource('/tiles/0.png', 'image/png', Buffer.from('synthetic-png').toString('base64')),
] } })
function audit(har, options = {}) {
  return auditBaiduUpstreamHAR(har, { origin: ORIGIN, client: 'web', scenario: 'load', secret: AK, ...options })
}
function fails(har, code, options) {
  const result = audit(har, options)
  assert.equal(result.release_authorized, false)
  assert.ok(result.codes.includes(code), JSON.stringify(result))
}

test('captured loader and child can pass a private audit without authorizing runtime', () => {
  const result = audit(load())
  assert.equal(result.capture_valid, true)
  assert.equal(result.release_authorized, false)
  assert.equal(result.loader_entries, 1)
  assert.equal(result.child_entries, 1)
  assert.equal(result.candidate_fingerprints.length, 1)
  assert.match(result.candidate_fingerprints[0], /^[a-f0-9]{20}$/)
  for (const client of ['web', 'mobile-web', 'desktop']) {
    assert.equal(audit(load(), { client }).capture_valid, true)
  }
})

test('pan and zoom require new child resources, not a second loader', () => {
  const child = { log: { entries: [resource('/tiles/1.png', 'image/png', 'new-tile')] } }
  for (const scenario of ['pan', 'zoom']) assert.equal(audit(child, { scenario }).capture_valid, true)
  fails({ log: { entries: [resource('/api?v=4.0')] } }, 'INCOMPLETE_UPSTREAM_SCENARIO', { scenario: 'pan' })
  fails(load(), 'INVALID_SCENARIO', { scenario: 'rotate' })
})

test('reject arbitrary host, unreviewed method and canonicalization attacks', () => {
  const a = load(); a.log.entries[1].request.url = 'https://evil.invalid/tiles/0.png?ak=' + AK
  fails(a, 'UNREVIEWED_UPSTREAM_ORIGIN')
  const b = load(); b.log.entries[1].request.method = 'POST'
  fails(b, 'UNREVIEWED_UPSTREAM_METHOD')
  const c = load(); c.log.entries[1].request.url = HOST + '/tiles/../api?v=4.0&ak=' + AK
  fails(c, 'NONCANONICAL_UPSTREAM_PATH')
  const d = load(); d.log.entries[1].request.url = HOST + '/tiles/%2e%2e/api?v=4.0&ak=' + AK
  fails(d, 'NONCANONICAL_UPSTREAM_PATH')
})

test('reject absent, forged and duplicate upstream secret injection', () => {
  const a = load(); a.log.entries[0].request.url = HOST + '/api?v=4.0'
  fails(a, 'INVALID_UPSTREAM_AK_INJECTION')
  const b = load(); b.log.entries[0].request.url += '&ak=forged'
  fails(b, 'INVALID_UPSTREAM_AK_INJECTION')
  const c = load(); c.log.entries[0].request.url = HOST + '/api?v=4.0&ak=forged'
  fails(c, 'INVALID_UPSTREAM_AK_INJECTION')
  const d = load(); d.log.entries[0].request.headers = [{ name: 'BMAP_PROXY_URL', value: 'https://forged.invalid/_BMapService/' }]
  fails(d, 'INVALID_PROXY_IDENTITY')
  const e = load(); e.log.entries[0].request.headers.push({ name: 'Cookie', value: 'XD_BMAP_SESSION=leaked' })
  fails(e, 'FORWARDED_CLIENT_CREDENTIAL')
})

test('reject response leaks in bytes, encodings and headers', () => {
  const a = load(); a.log.entries[0].response.content.text = 'var k="' + AK + '"'
  fails(a, 'UPSTREAM_RESPONSE_AK_LEAK')
  const b = load(); b.log.entries[1].response.content.text = Buffer.from(AK).toString('base64')
  b.log.entries[1].response.content.encoding = 'base64'
  fails(b, 'UPSTREAM_RESPONSE_AK_LEAK')
  const c = load(); c.log.entries[0].response.headers.push({ name: 'X-Debug', value: AK })
  fails(c, 'UPSTREAM_RESPONSE_AK_LEAK')
  const d = load(); d.log.entries[0].response.content.text = undefined
  fails(d, 'MISSING_RAW_RESPONSE_BYTES')
  const e = load(); e.log.entries[0].response.content.text = '*'.repeat(2 * 1024 * 1024 + 1)
  fails(e, 'UNBOUNDED_UPSTREAM_BYTES')
})

test('reject unsafe responses without leaking private materials in diagnostics', () => {
  const a = load(); a.log.entries[1].response.status = 301
  fails(a, 'UNSAFE_UPSTREAM_STATUS')
  const b = load(); b.log.entries[1].response.headers.push({ name: 'Set-Cookie', value: 'user=unsafe' })
  fails(b, 'UPSTREAM_SET_COOKIE')
  const c = load(); c.log.entries[0].response.headers[0].value = 'text/html'
  fails(c, 'UNREVIEWED_UPSTREAM_MIME')
  const d = load(); d.log.entries[0].response.content.text = AK
  const output = JSON.stringify(audit(d))
  assert.doesNotMatch(output, /synthetic-browser-ak|gallery\.example|api\.map\.baidu|tiles\/|_BMapService|secret/)
  assert.match(output, /UPSTREAM_RESPONSE_AK_LEAK/)
})
