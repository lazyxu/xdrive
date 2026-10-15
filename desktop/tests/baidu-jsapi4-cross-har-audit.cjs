'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const auditDir = path.resolve(__dirname, '../../scripts/ci')
const { reconcileBaiduHAR, auditCombinedHAR } = require(path.join(auditDir, 'baidu-jsapi4-cross-har-audit.cjs'))

const ORIGIN = 'https://gallery.example.invalid'
const SECRET = 'synthetic-secret-never-use-production'
const opts = { origin: ORIGIN, secret: SECRET, client: 'web', scenario: 'load' }
const entry = (url, method = 'GET') => ({ request: { method, url } })
function fixture() {
  const browser = { log: { entries: [
    entry(ORIGIN + '/api/v1/media/places/baidu-jsapi/session', 'POST'),
    entry(ORIGIN + '/_BMapService/api?v=4.0'),
    entry(ORIGIN + '/_BMapService/tiles/tile.png?zoom=3&lat=35'),
    entry(ORIGIN + '/_BMapService/tiles/tile.png?lat=35&zoom=3'),
  ] } }
  const upstream = { log: { entries: [
    entry('https://api.map.baidu.com/api?ak=' + SECRET + '&v=4.0'),
    entry('https://api.map.baidu.com/tiles/tile.png?lat=35&ak=' + SECRET + '&zoom=3'),
    entry('https://api.map.baidu.com/tiles/tile.png?zoom=3&ak=' + SECRET + '&lat=35'),
  ] } }
  return { browser, upstream }
}
const check = (code, b, u, options = {}) => {
  const result = reconcileBaiduHAR(b, u, { ...opts, ...options })
  assert.equal(result.release_authorized, false)
  assert.ok(result.codes.includes(code), JSON.stringify(result))
}

test('pair browser and Server-injected AK requests without permitting map runtime', () => {
  const { browser, upstream } = fixture()
  const result = reconcileBaiduHAR(browser, upstream, opts)
  assert.equal(result.matched, true)
  assert.equal(result.release_authorized, false)
  assert.deepEqual(result.codes, [])
  assert.equal(result.browser_resources, 3)
  assert.equal(result.upstream_resources, 3)
})

test('reject missing, additional and duplicated upstream requests', () => {
  const a = fixture(); a.upstream.log.entries.pop()
  check('REQUEST_COUNT_MISMATCH', a.browser, a.upstream)
  check('UPSTREAM_REQUEST_UNMATCHED', a.browser, a.upstream)
  const b = fixture(); b.upstream.log.entries.push(b.upstream.log.entries[2])
  check('BROWSER_REQUEST_UNMATCHED', b.browser, b.upstream)
})

test('reject identical counts but mismatched GPS query and never return raw URLs', () => {
  const a = fixture()
  a.upstream.log.entries[1].request.url = a.upstream.log.entries[1].request.url.replace('lat=35', 'lat=99')
  check('UPSTREAM_REQUEST_UNMATCHED', a.browser, a.upstream)
  const result = reconcileBaiduHAR(a.browser, a.upstream, opts)
  assert.doesNotMatch(JSON.stringify(result), /99|35|tiles|api\.map\.baidu|gallery\.example|synthetic-secret/)
})

test('reject browser AK, forged Server AK and extra direct third-party hosts', () => {
  const a = fixture(); a.browser.log.entries[1].request.url += '&AK=leak'
  check('BROWSER_AK_PARAMETER', a.browser, a.upstream)
  const b = fixture(); b.upstream.log.entries[0].request.url = 'https://api.map.baidu.com/api?v=4.0&ak=forged'
  check('INVALID_SERVER_AK', b.browser, b.upstream)
  const c = fixture(); c.browser.log.entries[2].request.url = 'https://other.invalid/tiles/tile.png'
  check('UNEXPECTED_BROWSER_REQUEST', c.browser, c.upstream)
})

test('reject session bootstrap GET and query-bearing POST even when captures otherwise match', () => {
  const a = fixture(); a.browser.log.entries[0].request.method = 'GET'
  check('INVALID_SESSION_BOOTSTRAP', a.browser, a.upstream)
  const b = fixture(); b.browser.log.entries[0].request.url += '?token=unsafe'
  check('INVALID_SESSION_BOOTSTRAP', b.browser, b.upstream)
})

test('reject malformed captures, disallowed methods and platform', () => {
  const a = fixture(); a.browser.log.entries.push(entry('https://gallery.example.invalid/_BMapService/api?v=4.0', 'DELETE'))
  check('INVALID_REQUEST', a.browser, a.upstream)
  const b = fixture(); b.upstream.log.entries = []
  check('INVALID_CAPTURE', b.browser, b.upstream)
  const c = fixture(); check('INVALID_CLIENT', c.browser, c.upstream, { client: 'other' })
})

test('independent browser and upstream audits must pass before matched captures count', t => {
  if (!fs.existsSync(path.join(auditDir, 'baidu-jsapi4-browser-har-audit.cjs')) ||
      !fs.existsSync(path.join(auditDir, 'baidu-jsapi4-upstream-har-audit.cjs'))) {
    t.skip('shared repository HAR audit dependencies unavailable')
    return
  }
  const responseHeaders = mime => [
    { name: 'Content-Type', value: mime }, { name: 'Cache-Control', value: 'private, no-store' },
    { name: 'X-Content-Type-Options', value: 'nosniff' }, { name: 'Referrer-Policy', value: 'no-referrer' },
  ]
  const session = {
    request: { url: ORIGIN + '/api/v1/media/places/baidu-jsapi/session', method: 'POST', headers: [], cookies: [] },
    response: { status: 200, headers: [
      ...responseHeaders('application/json'),
      { name: 'Set-Cookie', value: 'XD_BMAP_SESSION=opaque; Max-Age=120; Path=/_BMapService/; Secure; HttpOnly; SameSite=Strict' },
    ], content: { mimeType: 'application/json', text: '{}' } },
  }
  const b = (route, mime, content) => ({
    request: { url: ORIGIN + '/_BMapService' + route, method: 'GET', headers: [],
      cookies: [{ name: 'XD_BMAP_SESSION', value: 'opaque' }] },
    response: { status: 200, headers: responseHeaders(mime), content: { mimeType: mime, ...content } },
  })
  const u = (route, mime, content) => ({
    request: { url: 'https://api.map.baidu.com' + route + (route.includes('?') ? '&' : '?') + 'ak=' + SECRET,
      method: 'GET', headers: [{ name: 'BMAP_PROXY_URL', value: ORIGIN + '/_BMapService/' }] },
    response: { status: 200, headers: [{ name: 'Content-Type', value: mime }],
      content: { mimeType: mime, ...content } },
  })
  const browser = { log: { entries: [session,
    b('/api?v=4.0', 'application/javascript', { text: 'window.BMap = {};' }),
    b('/tiles/t.png?x=1', 'image/png', {}),
  ] } }
  const upstream = { log: { entries: [
    u('/api?v=4.0', 'application/javascript', { text: 'window.BMap = {};' }),
    u('/tiles/t.png?x=1', 'image/png', { text: Buffer.from('synthetic').toString('base64'), encoding: 'base64' }),
  ] } }
  const good = auditCombinedHAR(browser, upstream, opts)
  assert.equal(good.capture_valid, true, JSON.stringify(good))
  assert.equal(good.release_authorized, false)
  browser.log.entries[1].response.headers = []
  const bad = auditCombinedHAR(browser, upstream, opts)
  assert.equal(bad.capture_valid, false)
  assert.ok(bad.codes.includes('BROWSER_HAR_AUDIT_FAILED'), JSON.stringify(bad))
})
