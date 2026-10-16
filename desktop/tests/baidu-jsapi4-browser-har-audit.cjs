'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { auditJSAPIHar } = require(path.resolve(__dirname, '../../scripts/ci/baidu-jsapi4-browser-har-audit.cjs'))
const ORIGIN = 'https://gallery.example.invalid'
const SECRET = 'synthetic-browser-ak-never-use-live'
const prefix = ORIGIN + '/_BMapService/'
const headers = (type = 'application/javascript') => [
  { name: 'Content-Type', value: type },
  { name: 'Cache-Control', value: 'private, no-store' },
  { name: 'X-Content-Type-Options', value: 'nosniff' },
  { name: 'Referrer-Policy', value: 'no-referrer' },
]
function entry(url, type, body, options = {}) {
  return {
    request: { url, method: options.method || 'GET', headers: [],
      cookies: options.cookies === false ? [] : [{ name: 'XD_BMAP_SESSION', value: 'opaque' }] },
    response: { status: options.status || 200, headers: headers(type), content: { mimeType: type, text: body } },
  }
}
function fixture() {
  const session = entry(ORIGIN + '/api/v1/media/places/baidu-jsapi/session',
    'application/json', '{}', { method: 'POST', cookies: false })
  session.response.headers.push({ name: 'Set-Cookie',
    value: 'XD_BMAP_SESSION=opaque; Max-Age=120; Path=/_BMapService/; Secure; HttpOnly; SameSite=Strict' })
  return { log: { entries: [
    session,
    entry(prefix + 'api?v=4.0', 'application/javascript', 'window.BMap = {};'),
    entry(prefix + 'tiles/0.png', 'image/png', undefined),
  ] } }
}
const audit = h => auditJSAPIHar(h, { origin: ORIGIN, client: 'mobile-web', secret: SECRET })
const code = (h, value) => assert.ok(audit(h).codes.includes(value), JSON.stringify(audit(h)))

test('full synthetic three-step map network evidence can pass without exposing either AK', () => {
  const h = fixture()
  assert.deepEqual(audit(h).codes, [])
  assert.equal(audit(h).proxied_entries, 2)
  for (const client of ['web', 'mobile-web', 'desktop']) {
    assert.equal(auditJSAPIHar(h, { origin: ORIGIN, client, secret: SECRET }).ok, true)
  }
})

test('reject missing login-derived short-lived cookie, absent loader or child', () => {
  const a = fixture(); a.log.entries[0].response.headers.pop(); code(a, 'INVALID_MAP_SESSION_COOKIE')
  const b = fixture(); b.log.entries[1].request.cookies = []; code(b, 'MISSING_MAP_SESSION_COOKIE')
  const c = fixture(); c.log.entries.pop(); code(c, 'INCOMPLETE_JSAPI_RESOURCE_EVIDENCE')
  const d = fixture(); d.log.entries[0].response.headers.at(-1).value =
    'XD_BMAP_SESSION=opaque; Max-Age=301; Path=/_BMapService/; Secure; HttpOnly; SameSite=Strict'
  code(d, 'INVALID_MAP_SESSION_COOKIE')
})

test('fail on secret in URL, headers, JavaScript body and encoded query', () => {
  const a = fixture(); a.log.entries[1].request.url += '&ak=' + SECRET; code(a, 'BROWSER_SECRET_LEAK')
  const b = fixture(); b.log.entries[2].response.headers.push({ name: 'X-Debug', value: SECRET }); code(b, 'BROWSER_SECRET_LEAK')
  const c = fixture(); c.log.entries[1].response.content.text = 'var secret = "' + SECRET + '"'; code(c, 'BROWSER_SECRET_LEAK')
  const d = fixture(); d.log.entries[1].request.url += '&AK=wrong'; code(d, 'BROWSER_AK_PARAMETER')
  const e = fixture(); e.log.entries[1].response.content.text = 'const config = {ak:"obviously-key"}'
  code(e, 'BROWSER_AK_PARAMETER')
})

test('reject direct provider calls, redirects, caching and missing JavaScript bodies', () => {
  const a = fixture(); a.log.entries[2].request.url = 'https://api.map.baidu.com/tiles/0.png'
  code(a, 'EXTERNAL_BROWSER_REQUEST')
  const b = fixture(); b.log.entries[1].response.redirectURL = 'https://evil.invalid'
  code(b, 'BROWSER_REDIRECT')
  const c = fixture(); c.log.entries[1]._fromServiceWorker = true; code(c, 'BROWSER_CACHED_RESOURCE')
  const d = fixture(); delete d.log.entries[1].response.content.text; code(d, 'UNCAPTURED_TEXT_BODY')
  const e = fixture(); e.log.entries[1].response.headers = []; code(e, 'MISSING_NO_STORE')
})

test('reject malformed, out-of-origin and unauthorized browser proxy traffic', () => {
  const a = fixture(); a.log.entries[2].request.method = 'DELETE'; code(a, 'INVALID_PROXY_METHOD')
  const b = fixture(); b.log.entries[2].request.headers = [{ name: 'Authorization', value: 'Bearer fake' }]
  code(b, 'PROXY_BEARER_EXPOSED')
  const c = fixture(); c.log.entries[1].request.url = prefix + 'api?v=3.0'; code(c, 'INVALID_LOADER_QUERY')
  const d = fixture(); d.log.entries[1].request.url = 'https://other.invalid/_BMapService/api?v=4.0'
  code(d, 'EXTERNAL_BROWSER_REQUEST')
  const e = fixture(); assert.equal(auditJSAPIHar(e, { origin: 'http://gallery.test', client: 'web', secret: SECRET }).ok, false)
  const f = fixture(); assert.equal(auditJSAPIHar(f, { origin: ORIGIN, client: 'web' }).ok, false)
})

test('all diagnostics contain only fixed result codes and counts, never raw URLs or keys', () => {
  const h = fixture(); h.log.entries[1].response.content.text = SECRET
  const output = JSON.stringify(audit(h))
  assert.doesNotMatch(output, /gallery\.example|synthetic-browser-ak|_BMapService|opaque/)
  assert.match(output, /BROWSER_SECRET_LEAK/)
})

test('A3 private HAR rejects noncanonical, junk, unknown and empty JS response encodings', () => {
  for (const [encoding, body] of [
    ['base64', '@@@'], ['base64', 'AB=='],
    ['base64', 'YWJj' + String.fromCharCode(10)],
    ['gzip', 'window.BMap = {};'], ['base64url', 'd2luZG93'],
  ]) {
    const h = fixture()
    h.log.entries[1].response.content = { mimeType: 'application/javascript', encoding, text: body }
    code(h, 'INVALID_BODY_ENCODING')
    assert.equal(audit(h).ok, false)
  }
  const empty = fixture()
  empty.log.entries[1].response.content.text = ''
  code(empty, 'UNCAPTURED_TEXT_BODY')
})

test('A3 private HAR scans original and decoded AK, preserves valid Base64 and bounds bytes', () => {
  const ok = fixture()
  ok.log.entries[1].response.content = {
    mimeType: 'application/javascript', encoding: 'base64',
    text: Buffer.from('window.BMap = {};').toString('base64'),
  }
  assert.equal(audit(ok).ok, true)
  const leaked = fixture()
  leaked.log.entries[1].response.content = {
    mimeType: 'application/javascript', encoding: 'base64',
    text: Buffer.from('window.private = "' + SECRET + '"').toString('base64'),
  }
  code(leaked, 'BROWSER_SECRET_LEAK')
  const mislabeled = fixture()
  mislabeled.log.entries[1].response.content = {
    mimeType: 'application/javascript', encoding: 'base64', text: SECRET,
  }
  code(mislabeled, 'BROWSER_SECRET_LEAK')
  code(mislabeled, 'INVALID_BODY_ENCODING')
  const huge = fixture()
  huge.log.entries[1].response.content = {
    mimeType: 'application/javascript', encoding: 'base64', text: 'A'.repeat(2800000),
  }
  code(huge, 'OVERSIZED_TEXT_BODY')
  const output = JSON.stringify(audit(leaked)) + JSON.stringify(audit(mislabeled))
  assert.doesNotMatch(output, /synthetic-browser-ak|gallery\\.example|_BMapService|window\\.private/)
})
