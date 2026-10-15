'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const cli = path.join(root, 'desktop/scripts/pwa-s5a-live-https-audit.cjs')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pwa-s5a-'))
const cert = path.join(temp, 's5a-synthetic-ca.pem')
const key = path.join(temp, 's5a-synthetic-key.pem')
const makeCA = spawnSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1',
  '-keyout', key, '-out', cert, '-subj', '/CN=localhost',
  '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
], { stdio: 'ignore' })
assert.equal(makeCA.status, 0, 'real ephemeral TLS certificate required')
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }))

const manifest = JSON.stringify({
  id: '/', start_url: '/', scope: '/', display: 'standalone', name: 'xDrive',
  icons: [
    { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
  ],
})
const assets = {
  '/site.webmanifest': ['application/manifest+json', manifest],
  '/sw.js': ['text/javascript', 'self.addEventListener("fetch",()=>{})'],
  '/offline.html': ['text/html', '<!doctype html><title>Offline</title>'],
  '/pwa-192.png': ['image/png', 'S5-fixture-icon'],
  '/pwa-512.png': ['image/png', 'S5-fixture-icon'],
}

async function liveFixture(t, mode = 'good') {
  let privateRequests = 0
  let credentialsSeen = 0
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    if (req.headers.authorization || req.headers.cookie) credentialsSeen++
    const pathname = new URL(req.url, 'https://localhost').pathname
    let status = 200
    let data = ''
    let type = 'application/json'
    let cache = 'no-store'
    if (assets[pathname]) {
      ;[type, data] = assets[pathname]
      cache = pathname.endsWith('.png') ? 'public, max-age=86400' : 'no-cache, must-revalidate'
      if (mode === 'html_fallback' && pathname === '/sw.js') type = 'text/html'
      if (mode === 'stale_worker' && pathname === '/sw.js') cache = 'public, max-age=86400'
      if (mode === 'redirect' && pathname === '/site.webmanifest') status = 302
    } else if (pathname === '/api/v1/readyz') {
      data = '{"ok":true}'
      if (mode === 'down') status = 503
    } else if (pathname === '/api/v1/nodes/root' || pathname === '/api/v1/file-operations') {
      privateRequests++
      status = mode === 'private_leak' ? 200 : 401
      data = status === 200 ? '{"private":"LEAK_SENTINEL"}' : '{"error":"unauthorized"}'
      if (mode === 'cacheable_401') cache = 'public,max-age=86400'
    } else {
      status = 404
    }
    const headers = {
      'Content-Type': type,
      'Cache-Control': cache,
      'Strict-Transport-Security': mode === 'no_hsts' ? '' : 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': mode === 'no_nosniff' ? '' : 'nosniff',
    }
    if (mode === 'redirect' && pathname === '/site.webmanifest') headers.Location = '/unexpected-login'
    if (mode === 'public_cookie' && pathname === '/sw.js') headers['Set-Cookie'] = 'synthetic=1'
    res.writeHead(status, headers)
    res.end(req.method === 'HEAD' ? undefined : data)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => { await new Promise(resolve => server.close(resolve)) })
  return { origin: 'https://127.0.0.1:' + server.address().port,
    counts: () => ({ privateRequests, credentialsSeen }) }
}
async function execute(origin, { trusted = true, fixture = true, args = [], environment = {} } = {}) {
  const env = {
    ...process.env,
    NODE_EXTRA_CA_CERTS: trusted ? cert : '',
    XD_PWA_S5_FIXTURE: fixture ? '1' : '0',
    ...environment,
  }
  const flags = ['--origin', origin, ...(fixture ? ['--fixture-loopback'] : []), ...args]
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...flags], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', stderr = ''
    child.stdout.on('data', data => { out += data; if (out.length > 50000) child.kill() })
    child.stderr.on('data', data => { stderr += data; if (stderr.length > 50000) child.kill() })
    child.on('error', reject)
    child.on('close', code => {
      try { resolve({ code, report: JSON.parse(out), raw: out, stderr }) }
      catch { reject(Error('S5-A audit emitted invalid JSON')) }
    })
  })
}

test('S5-A trusted fixture checks real TLS, public install assets, HSTS and two private auth fences', async t => {
  const fixture = await liveFixture(t)
  const result = await execute(fixture.origin)
  assert.equal(result.code, 0)
  assert.equal(result.report.actual_https_preflight, 'pass')
  assert.equal(result.report.evidence_environment, 'test-fixture-https')
  assert.equal(result.report.release_gate, 'NO_GO_PHYSICAL_INSTALL_NOT_RUN')
  assert.deepEqual(Object.values(result.report.physical_platforms), ['not-run', 'not-run', 'not-run'])
  assert.equal(result.report.checks.length, 10)
  assert.ok(result.report.checks.every(c => c.status === 'pass'))
  assert.equal(fixture.counts().privateRequests, 2)
  assert.equal(fixture.counts().credentialsSeen, 0)
  assert.doesNotMatch(result.raw, /LEAK_SENTINEL|synthetic=|privateRequests/)
  assert.doesNotMatch(result.raw, /https:\/\/127\.0\.0\.1/)
})

test('S5-A rejects self-signed/unknown certificate without disabling verification', async t => {
  const fixture = await liveFixture(t)
  const result = await execute(fixture.origin, { trusted: false })
  assert.equal(result.code, 1)
  assert.equal(result.report.actual_https_preflight, 'fail')
  assert.equal(result.report.release_gate, 'NO_GO_HTTPS_PREFLIGHT')
  assert.ok(result.report.checks.some(c => c.reason === 'tls_or_network'))
})

test('S5-A rejects HTTP, URL secrets, and unsafe TLS bypass before touching transport', async () => {
  for (const uri of ['http://example.org/', 'https://alice:password@example.org/',
    'https://example.org/?ticket=secret', 'https://example.org/#/files']) {
    const result = await execute(uri, { fixture: false })
    assert.equal(result.code, 2, uri)
    assert.equal(result.report.release_gate, 'NO_GO_INVALID_INPUT')
    assert.doesNotMatch(result.raw, /alice|password|ticket=secret/)
  }
  const bypass = await execute('https://example.org/', {
    fixture: false, environment: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  })
  assert.equal(bypass.code, 2)
  assert.equal(bypass.report.reason, 'tls_verification_disabled')
  const fixtureOnly = await execute('https://127.0.0.1:8443/', { fixture: false })
  assert.equal(fixtureOnly.code, 2, 'loopback may not masquerade as production')
  const fixtureWithoutAuthorization = await execute('https://127.0.0.1:8443/', {
    environment: { XD_PWA_S5_FIXTURE: '0' },
  })
  assert.equal(fixtureWithoutAuthorization.code, 2)
})

test('S5-A catches HTML fallback, redirects, unsafe caching and missing security headers', async t => {
  for (const [mode, expected] of [
    ['html_fallback', 'mime_or_html_fallback'],
    ['redirect', 'redirect'],
    ['stale_worker', 'unsafe_static_cache'],
    ['no_hsts', 'hsts_or_security_headers'],
    ['no_nosniff', 'security_headers'],
    ['public_cookie', 'security_headers'],
  ]) {
    await t.test(mode, async inner => {
      const fixture = await liveFixture(inner, mode)
      const result = await execute(fixture.origin)
      assert.equal(result.code, 1)
      assert.equal(result.report.actual_https_preflight, 'fail')
      assert.ok(result.report.checks.some(c => c.reason === expected), mode)
      assert.equal(fixture.counts().credentialsSeen, 0)
    })
  }
})

test('S5-A rejects public private-API access, cacheable unauthorized replies and Server down', async t => {
  for (const [mode, expected] of [
    ['private_leak', 'private_route_not_protected_or_uncacheable'],
    ['cacheable_401', 'private_route_not_protected_or_uncacheable'],
    ['down', 'server_not_ready'],
  ]) {
    await t.test(mode, async inner => {
      const fixture = await liveFixture(inner, mode)
      const result = await execute(fixture.origin)
      assert.equal(result.code, 1)
      assert.ok(result.report.checks.some(c => c.reason === expected))
      assert.doesNotMatch(result.raw, /LEAK_SENTINEL/)
    })
  }
})

test('S5-A writes mode-0600 sanitized evidence without cert, auth or private bytes', async t => {
  const fixture = await liveFixture(t)
  const file = path.join(temp, 'redacted-' + process.pid + '.json')
  const result = await execute(fixture.origin, { args: ['--output', file] })
  assert.equal(result.code, 0)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), result.report)
  assert.equal((await execute(fixture.origin, { args: ['--output', file] })).code, 2,
    'an existing evidence record must never be silently overwritten')
})
