const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { probeDesktopServer } = require('../dist/main/server_probe.cjs')
const lan = 'https://192.168.2.4:8443'
const ok = (version = '1.0.0') => new Response(JSON.stringify({ version }), {
  headers: { 'Content-Type': 'application/json' },
})

test('private IPv4 HTTPS probe uses exact API root without cookies, redirects or certificate bypass', async () => {
  let requests = 0
  const result = await probeDesktopServer(lan + '/', async (url, init) => {
    ++requests
    assert.equal(url, lan + '/api/v1/version')
    assert.equal(init.method, 'GET')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.referrerPolicy, 'no-referrer')
    assert.equal(init.headers.Accept, 'application/json')
    assert.equal(init.signal.aborted, false)
    assert.equal(init.agent, undefined)
    return ok('2.5.0')
  })
  assert.deepEqual(result, { ok: true, data: { version: '2.5.0' } })
  assert.equal(requests, 1)
})

test('Electron Main calls net.fetch, not Node fetch; no unsafe certificate override', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/index.cts'), 'utf8')
  assert.match(main, /probeDesktopServerWithChromium\(serverValue,\s*\(url, options\)\s*=>\s*net\.fetch\(url,/)
  assert.match(main, /bypassCustomProtocolHandlers:\s*true/)
  assert.doesNotMatch(main, /ignoreCertificateErrors|rejectUnauthorized:\s*false|tls_insecure_skip_verify/)
})

test('rejects non-root, credentialed, and misleading destinations without requests', async () => {
  const disallowed = [
    'http://192.168.2.4:8443',
    'http://drive.example.com',
    'https://alice:secret@192.168.2.4:8443',
    lan + '/admin', lan + '/?token=sensitive', lan + '/#frag',
    'file:///etc/passwd', 'javascript:alert(1)', 'not-an-address',
  ]
  for (const server of disallowed) {
    const result = await probeDesktopServer(server, () => { throw new Error('must not run') })
    assert.equal(result.ok, false, server)
    assert.equal(result.error.code, 'invalid_server', server)
  }
})

test('a redirect or SPA HTML is not a verified xDrive Server', async () => {
  const redirect = await probeDesktopServer(lan, async () => new Response('', {
    status: 302, headers: { Location: 'https://other.example/' },
  }))
  assert.equal(redirect.ok, false)
  assert.equal(redirect.error.status, 302)
  assert.equal(redirect.error.code, 'server_auth_redirect')
  const html = await probeDesktopServer(lan, async () => new Response('<html>login</html>', {
    headers: { 'Content-Type': 'text/html' },
  }))
  assert.equal(html.ok, false)
  assert.equal(html.error.code, 'server_invalid_response')
  const missing = await probeDesktopServer(lan, async () => new Response('{}', {
    headers: { 'Content-Type': 'application/json' },
  }))
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'server_invalid_response')
})

test('reports actionable and bounded TLS versus connection failures', async () => {
  const cases = [
    ['net::ERR_CERT_AUTHORITY_INVALID', 'server_tls_trust'],
    ['net::ERR_CERT_COMMON_NAME_INVALID', 'server_tls_name'],
    ['net::ERR_CERT_DATE_INVALID', 'server_tls_date'],
    ['net::ERR_SSL_PROTOCOL_ERROR', 'server_tls_protocol'],
    ['net::ERR_CONNECTION_REFUSED', 'server_refused'],
    ['net::ERR_ADDRESS_UNREACHABLE', 'server_network'],
  ]
  for (const [message, code] of cases) {
    const result = await probeDesktopServer(lan, async () => { throw new Error(message) })
    assert.equal(result.ok, false, message)
    assert.equal(result.error.code, code, message)
    assert.ok(result.error.message.length < 130)
    assert.doesNotMatch(result.error.message, /192\.168\.2\.4|ERR_|https:\/\//)
  }
  const nested = await probeDesktopServer(lan, async () => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } })
  })
  assert.equal(nested.error.code, 'server_tls_trust')
})

test('times out stalled probe without leaving it running', async () => {
  let aborted = false
  const result = await probeDesktopServer(lan, (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted = true
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }, { once: true })
  }), 15)
  assert.equal(aborted, true)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'server_timeout')
})


test('Desktop shows safe CA enrollment guidance and lets user retry Chromium TLS after trust changes', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/App.tsx'), 'utf8')
  assert.match(app, /serverProbe\.code === 'server_tls_trust'/)
  assert.match(app, /验证此服务器/)
  assert.match(app, /window\.xdriveDesktop\.trustLANServer\(selected\)/)
  assert.match(app, /setServerProbeRetry\(current => current \+ 1\)/)
  assert.match(app, /\[configured, server, username, serverProbeRetry, connectionRoute\]/)
  assert.match(app, /code: result\.error\.code/)
  assert.doesNotMatch(app, /setCertificateVerifyProc|ignoreCertificateErrors/)
})


test('LAN CA trust is scoped: automatic via authenticated domain or user-approved IP TOFU', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/index.cts'), 'utf8')
  const helper = fs.readFileSync(path.join(__dirname, '../src/main/lan_root_auto.cts'), 'utf8')
  const agent = fs.readFileSync(path.join(__dirname, '../src/main/agent_client.cts'), 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload/index.cts'), 'utf8')
  const caddy = fs.readFileSync(path.join(__dirname, '../../deploy/Caddyfile.common'), 'utf8')
  assert.match(main, /ensurePrivateLANRoot\(server, username\)/)
  assert.match(main, /trusted_lan_root_pem: trustedLAN\.root/)
  assert.match(main, /loadPrivateLANRoots\(\)/)
  assert.match(main, /privateLANRootsName = 'desktop-private-lan-roots\.json'/)
  assert.match(helper, /rejectUnauthorized: true/)
  assert.match(helper, /tls\.checkServerIdentity\(target\.ip, certificate\)/)
  assert.match(helper, /lookup: directLANIPv4Lookup\(target\.ip\)/)
  assert.match(helper, /servername: domain\.hostname/)
  assert.match(helper, /response\.status !== 200/)
  assert.match(preload, /desktop:probe-server', server, username/)
  assert.match(agent, /trusted_lan_root_pem\?: string/)
  assert.match(caddy, /handle \/_xdrive\/desktop\/lan-root\.crt/)
  assert.doesNotMatch(caddy, /root\.key|intermediate\.key|private_key/)
  // The one insecure request is for unauthenticated PUBLIC CERTIFICATE inspection.
  // No login action or ordinary TLS probe is allowed to disable verification.
  assert.match(helper, /function readUntrustedLocalCertificateOnly/)
  assert.match(helper, /rejectUnauthorized:\s*false/)
  assert.match(helper, /path: CA_PATH/)
  assert.match(helper, /method: 'GET'/)
  assert.match(helper, /inspectPrivateLANFirstUse/)
  assert.match(main, /dialog\.showMessageBox/)
  assert.match(main, /confirmation\.response !== 1/)
  assert.match(main, /source: 'user-approved-lan'/)
  assert.match(main, /probeWithTrustedLANRoot\(target\.origin, candidate\.root_pem\)/)
  assert.match(main, /pin\.source === 'user-approved-lan'/)
  // Once the user has approved an IP identity, do not silently downgrade the
  // pre-login probe or credential-bearing Agent calls to platform CA trust.
  assert.match(main, /if \(requiresApprovedLANPin\(serverValue\)\)/)
  assert.match(main, /const pinned = await ensurePrivateLANRoot\(serverValue, username\)/)
  assert.match(main, /code: 'server_tls_pin_changed'/)
  assert.match(main, /if \(requiresApprovedLANPin\(server\) && !trustedLAN\)/)
  assert.match(main, /if \(requiresApprovedLANPin\(profile\.server\) && !trustedLAN\)/)
  const goController = fs.readFileSync(path.join(__dirname, '../../cmd/xdrive-agent/controller.go'), 'utf8')
  assert.match(goController, /rootPEM = previous\.TrustedLANRootPEM/)
  assert.match(goController, /sameAgentLoginOrigin\(previous\.Server, server\)/)
  assert.match(main, /trusted_lan_root_pem: trustedLAN\.root/)
  assert.match(fs.readFileSync(path.join(__dirname, '../src/renderer/App.tsx'), 'utf8'), /serverProbe\.code === 'server_tls_pin_changed'/)
  assert.match(main, /return version \? \{ root: manual\.root_pem, version \} : null/)
  assert.match(main, /rejectedManualLANOrigins\.has\(target\.origin\)/)
  assert.match(main, /privateLANTrustStoreCorrupt/)
  assert.match(main, /if \(pin\.source === 'user-approved-lan'\) rejectedManualLANOrigins\.add/)
  assert.match(main, /if \(pin\.source === 'user-approved-lan'\) rejectedManualLANOrigins\.delete/)
  assert.match(main, /pin\.source === 'user-approved-lan'/)
  assert.match(preload, /desktop:trust-lan-server', server/)
  for (const file of [main, agent]) {
    assert.doesNotMatch(file, /rejectUnauthorized:\s*false|ignoreCertificateErrors|setCertificateVerifyProc|certutil/)
  }
})
