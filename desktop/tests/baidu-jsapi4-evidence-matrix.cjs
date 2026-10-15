'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { auditEvidenceMatrix } = require(path.resolve(__dirname, '../../scripts/ci/baidu-jsapi4-evidence-matrix.cjs'))

const ORIGIN = 'https://gallery.example.invalid'
const SECRET = 'fixture-ak-not-a-real-secret'
const clients = ['web', 'mobile-web', 'desktop']
const scenarios = ['load', 'pan', 'zoom']
const goodPair = (b, u, options) => ({
  capture_valid: true, release_authorized: false,
  client: options.client, scenario: options.scenario, codes: [],
})
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-jsapi-matrix-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let i = 0
  const captures = []
  for (const client of clients) for (const scenario of scenarios) {
    const browser = 'browser-' + i + '.har', upstream = 'upstream-' + i + '.har'
    fs.writeFileSync(path.join(root, browser), JSON.stringify({ fake: 'browser', seq: i }))
    fs.writeFileSync(path.join(root, upstream), JSON.stringify({ fake: 'upstream', seq: i }))
    captures.push({ client, scenario, browser, upstream })
    i++
  }
  return { root, manifest: { version: 1, captures } }
}
const audit = (fixture, fn = goodPair) => auditEvidenceMatrix(fixture.manifest, {
  root: fixture.root, origin: ORIGIN, secret: SECRET, auditPair: fn,
})
const rejected = (result, code) => {
  assert.equal(result.capture_valid, false)
  assert.equal(result.release_authorized, false)
  assert.ok(result.codes.includes(code), JSON.stringify(result))
}

test('all nine Web, Mobile Web and Desktop scenarios are required, never release authority', t => {
  const f = fixture(t)
  const r = audit(f)
  assert.deepEqual(r, {
    capture_valid: true, release_authorized: false, required_pairs: 9,
    inspected_pairs: 9, rejected_pairs: 0, codes: [],
  })
  const m = fixture(t)
  m.manifest.captures.pop()
  rejected(audit(m), 'MISSING_MATRIX_CASE')
  rejected(audit(m), 'INVALID_MATRIX_SHAPE')
})

test('reject duplicate or malformed matrix cases and unknown platforms', t => {
  const f = fixture(t)
  f.manifest.captures[8].client = 'web'
  f.manifest.captures[8].scenario = 'load'
  rejected(audit(f), 'DUPLICATE_MATRIX_CASE')
  rejected(audit(f), 'MISSING_MATRIX_CASE')
  const g = fixture(t)
  g.manifest.captures[0].client = 'android-claimed'
  rejected(audit(g), 'INVALID_MATRIX_ENTRY')
  const h = fixture(t)
  h.manifest.captures[0].extra = 'untrusted'
  rejected(audit(h), 'INVALID_MATRIX_ENTRY')
})

test('reject swapped files, byte-for-byte repeated captures and traversal names', t => {
  const f = fixture(t)
  f.manifest.captures[1].browser = f.manifest.captures[0].browser
  rejected(audit(f), 'REUSED_CAPTURE_FILE')
  const g = fixture(t)
  fs.copyFileSync(path.join(g.root, g.manifest.captures[0].browser),
    path.join(g.root, g.manifest.captures[1].browser))
  rejected(audit(g), 'REUSED_CAPTURE_BYTES')
  const h = fixture(t)
  h.manifest.captures[0].upstream = '../outside.har'
  rejected(audit(h), 'INVALID_CAPTURE_NAME')
})

test('reject symlinks, oversized files and pair-audit failure', t => {
  const f = fixture(t)
  const target = path.join(f.root, 'outside.har')
  fs.writeFileSync(target, '{}')
  const capture = path.join(f.root, f.manifest.captures[0].browser)
  fs.rmSync(capture)
  fs.symlinkSync(target, capture)
  rejected(audit(f), 'INVALID_PRIVATE_CAPTURE')
  const g = fixture(t)
  fs.truncateSync(path.join(g.root, g.manifest.captures[0].browser), 20 * 1024 * 1024 + 1)
  rejected(audit(g), 'INVALID_PRIVATE_CAPTURE')
  const h = fixture(t)
  rejected(audit(h, () => ({ ...goodPair(null, null, {client:'web',scenario:'load'}), capture_valid:false })),
    'PAIR_AUDIT_REJECTED')
  rejected(audit(h, () => { throw Error('sensitive path or token') }), 'PAIR_AUDIT_ERROR')
})

test('reject wrong origin, credential and return only fixed codes and counts', t => {
  const f = fixture(t)
  const result = auditEvidenceMatrix(f.manifest, {
    root: f.root, origin: 'http://private.example?ak=secret', secret: SECRET,
    auditPair: goodPair,
  })
  rejected(result, 'INVALID_ORIGIN')
  const wrongSecret = auditEvidenceMatrix(f.manifest, {
    root: f.root, origin: ORIGIN, secret: 'too-short', auditPair: goodPair,
  })
  rejected(wrongSecret, 'INVALID_PRIVATE_CANARY')
  const text = JSON.stringify(result) + JSON.stringify(wrongSecret)
  assert.doesNotMatch(text, /private.example|xdrive-jsapi-matrix|\.har|ak=|fixture-ak/)
})

test('CLI rejects missing private canary without disclosing paths', t => {
  const f = fixture(t)
  const manifestPath = path.join(f.root, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(f.manifest))
  const run = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/ci/baidu-jsapi4-evidence-matrix.cjs'), manifestPath, ORIGIN], {
    encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 5000,
  })
  assert.equal(run.status, 1)
  assert.deepEqual(JSON.parse(run.stdout).codes, ['INVALID_AUDIT_INPUT'])
  assert.doesNotMatch(run.stdout + run.stderr, /\.har|private.example|xdrive-jsapi-matrix|fixture-ak/)
})

// This executes only in the complete checkout; the isolated workspace does
// not contain the prior three auditors. Full GitHub desktop CI must run it.
test('real combined browser/upstream auditor validates all nine synthetic pairs', t => {
  const auditRoot = path.resolve(__dirname, '../../scripts/ci')
  if (!fs.existsSync(path.join(auditRoot, 'baidu-jsapi4-cross-har-audit.cjs')) ||
      !fs.existsSync(path.join(auditRoot, 'baidu-jsapi4-upstream-har-audit.cjs'))) {
    t.skip('full repository audit modules unavailable')
    return
  }
  const f = fixture(t)
  const header = mime => [
    { name: 'Content-Type', value: mime },
    { name: 'Cache-Control', value: 'private, no-store' },
    { name: 'X-Content-Type-Options', value: 'nosniff' },
    { name: 'Referrer-Policy', value: 'no-referrer' },
  ]
  for (let i = 0; i < 9; i++) {
    const p = f.manifest.captures[i]
    const route = '/tiles/t.png?sample=' + i
    const session = {
      request: { url: ORIGIN + '/api/v1/media/places/baidu-jsapi/session', method: 'POST', headers: [], cookies: [] },
      response: { status: 200, headers: [...header('application/json'),
        { name: 'Set-Cookie', value: 'XD_BMAP_SESSION=opaque; Max-Age=120; Path=/_BMapService/; Secure; HttpOnly; SameSite=Strict' }],
        content: { mimeType: 'application/json', text: '{}' } },
    }
    const browser = (endpoint, mime, content) => ({
      request: { url: ORIGIN + '/_BMapService' + endpoint, method: 'GET', headers: [],
        cookies: [{ name: 'XD_BMAP_SESSION', value: 'opaque' }] },
      response: { status: 200, headers: header(mime), content: { mimeType: mime, ...content } },
    })
    const upstream = (endpoint, mime, content) => ({
      request: { url: 'https://api.map.baidu.com' + endpoint + (endpoint.includes('?') ? '&' : '?') + 'ak=' + SECRET,
        method: 'GET', headers: [{ name: 'BMAP_PROXY_URL', value: ORIGIN + '/_BMapService/' }] },
      response: { status: 200, headers: [{ name: 'Content-Type', value: mime }],
        content: { mimeType: mime, ...content } },
    })
    const browserHar = { log: { entries: [session,
      browser('/api?v=4.0', 'application/javascript', { text: 'window.BMap = {}; /* ' + i + ' */' }),
      browser(route, 'image/png', {}),
    ] } }
    const upstreamHar = { log: { entries: [
      upstream('/api?v=4.0', 'application/javascript', { text: 'window.BMap = {}; /* ' + i + ' */' }),
      upstream(route, 'image/png', { text: Buffer.from('synthetic-' + i).toString('base64'), encoding: 'base64' }),
    ] } }
    fs.writeFileSync(path.join(f.root, p.browser), JSON.stringify(browserHar))
    fs.writeFileSync(path.join(f.root, p.upstream), JSON.stringify(upstreamHar))
  }
  const { auditCombinedHAR } = require(path.join(auditRoot, 'baidu-jsapi4-cross-har-audit.cjs'))
  const result = auditEvidenceMatrix(f.manifest, { root: f.root, origin: ORIGIN, secret: SECRET, auditPair: auditCombinedHAR })
  assert.equal(result.capture_valid, true, JSON.stringify(result))
  assert.equal(result.release_authorized, false)
})
