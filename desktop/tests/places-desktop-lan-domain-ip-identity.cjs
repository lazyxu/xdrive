'use strict'
// Controlled actual HTTPS/SNI enrollment for the same approved LAN target that
// Desktop's private-IP map guest uses. No system trust changes or live accounts.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const tls = require('node:tls')
const { spawnSync } = require('node:child_process')
const { createHash, X509Certificate } = require('node:crypto')
const {
  enrollLANRootViaTrustedDomain, probeWithTrustedLANRoot,
  verifiedLANRootPEM,
} = require('../dist/main/lan_root_auto.cjs')
const {
  readTrustedPlacesLANPeerFingerprint, verifyDesktopPlacesLANCertificate,
} = require('../dist/main/places_guest_lan_tls.cjs')

const ip = process.env.XD_PLACES_TEST_LAN_IP || '10.233.15.10'
const domain = 'drive.example.invalid'

function openssl(dir, args) {
  const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, 'openssl fixture failed: ' + r.stderr)
}
function rootCA(dir, name) {
  openssl(dir, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=xDrive synthetic ' + name,
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout', name + '.key', '-out', name + '.pem',
  ])
  return fs.readFileSync(path.join(dir, name + '.pem'), 'utf8')
}
function signedLeaf(dir, name, ca, san) {
  openssl(dir, [
    'req', '-new', '-newkey', 'rsa:2048', '-nodes',
    '-subj', '/CN=xDrive synthetic ' + name,
    '-keyout', name + '.key', '-out', name + '.csr',
  ])
  const ext = name + '.ext'
  fs.writeFileSync(path.join(dir, ext),
    'basicConstraints=critical,CA:FALSE\n' +
    'keyUsage=critical,digitalSignature,keyEncipherment\n' +
    'extendedKeyUsage=serverAuth\n' +
    'subjectAltName=' + san + '\n')
  openssl(dir, [
    'x509', '-req', '-in', name + '.csr',
    '-CA', ca + '.pem', '-CAkey', ca + '.key', '-CAcreateserial',
    '-days', '1', '-out', name + '.pem', '-extfile', ext,
  ])
  return {
    key: fs.readFileSync(path.join(dir, name + '.key'), 'utf8'),
    cert: fs.readFileSync(path.join(dir, name + '.pem'), 'utf8'),
  }
}
async function openFixture(ipLeaf, domainLeaf, ca, onRequest, t) {
  const domainContext = tls.createSecureContext({ key: domainLeaf.key, cert: domainLeaf.cert })
  const server = https.createServer({
    key: ipLeaf.key, cert: ipLeaf.cert,
    SNICallback: (_servername, done) => done(null, domainContext),
  }, (req, res) => {
    onRequest(req)
    if (req.url === '/_xdrive/desktop/lan-root.crt') {
      res.writeHead(200, { 'Content-Type': 'application/x-pem-file', 'Cache-Control': 'no-store' })
      res.end(ca)
    } else if (req.url === '/api/v1/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"version":"fixture-identity"}')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, ip, resolve)
  })
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  })
  const port = server.address().port
  return { origin: 'https://' + ip + ':' + port, port }
}

test('trusted domain enrollment uses exact selected private IP, two TLS identities and map guest leaf pin', {
  skip: !process.env.XD_PLACES_TEST_LAN_IP || spawnSync('openssl', ['version']).status !== 0,
  timeout: 35000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-places-domain-ip-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const domainCA = rootCA(dir, 'domain-root')
  const lanCA = rootCA(dir, 'lan-root')
  const wrongDomainCA = rootCA(dir, 'unrelated-root')
  const domainLeaf = signedLeaf(dir, 'domain-leaf', 'domain-root', 'DNS:' + domain)
  const ipLeaf = signedLeaf(dir, 'lan-leaf', 'lan-root', 'IP:' + ip)
  const wrongIPLeaf = signedLeaf(dir, 'wrong-ip-leaf', 'lan-root', 'IP:10.233.15.11')
  const verified = verifiedLANRootPEM(lanCA)
  assert.ok(verified, 'test LAN CA must be independently validated')

  const requests = []
  const good = await openFixture(ipLeaf, domainLeaf, lanCA, req => {
    requests.push({ host: req.headers.host, sni: req.socket.servername || '', url: req.url })
    assert.equal(req.headers.authorization, undefined, 'enrollment leaked a bearer')
    assert.equal(req.headers.cookie, undefined, 'enrollment leaked a Cookie')
  }, t)
  const profile = [{ username: 'alice', server: 'https://' + domain + ':' + good.port }]
  const enrolled = await enrollLANRootViaTrustedDomain(good.origin, 'alice', profile, domainCA)
  assert.ok(enrolled, 'trusted domain + matching private IP SAN must enroll')
  assert.deepEqual(enrolled.pin, {
    server: good.origin, username: 'alice', domain, root_pem: lanCA,
    sha256: verified.sha256, source: 'verified-domain',
  })
  assert.equal(enrolled.version, 'fixture-identity')
  assert.ok(requests.some(x => x.host === domain + ':' + good.port && x.sni === domain &&
    x.url === '/_xdrive/desktop/lan-root.crt'), 'CA must come from exact authenticated SNI domain')
  assert.ok(requests.some(x => x.host === ip + ':' + good.port && !x.sni &&
    x.url === '/api/v1/version'), 'IP SAN probe must dial approved IP with no SNI')

  const realFingerprint = await readTrustedPlacesLANPeerFingerprint(ip, good.port, lanCA)
  const expectedFingerprint = createHash('sha256')
    .update(new X509Certificate(ipLeaf.cert).raw).digest('hex')
  assert.equal(realFingerprint, expectedFingerprint)
  const request = { hostname: ip, errorCode: -202, certificate: { data: ipLeaf.cert } }
  assert.equal(await verifyDesktopPlacesLANCertificate(request, enrolled.pin, good.origin,
    () => true), 0, 'map Chromium must accept only the approved TLS peer')
  assert.equal(await verifyDesktopPlacesLANCertificate(request, enrolled.pin, good.origin,
    () => false), -2, 'revoked Owner/CA must fail closed')
  assert.equal(await verifyDesktopPlacesLANCertificate(request,
    { ...enrolled.pin, sha256: '0'.repeat(64) }, good.origin, () => true), -2)
  assert.equal(await verifyDesktopPlacesLANCertificate(request,
    enrolled.pin, 'https://' + ip + ':' + (good.port + 1), () => true), -2)

  assert.equal(await enrollLANRootViaTrustedDomain(good.origin, 'bob', profile, domainCA), null,
    'different Owner must not inherit the trusted domain')
  assert.equal(await enrollLANRootViaTrustedDomain(good.origin, 'alice', profile,
    wrongDomainCA), null, 'a forged domain trust root must not enroll')
  assert.equal(await enrollLANRootViaTrustedDomain(good.origin, 'alice', [{
    username: 'alice', server: 'https://other.example.invalid:' + good.port,
  }], domainCA), null, 'different domain SAN must fail before accepting the CA')

  const bad = await openFixture(wrongIPLeaf, domainLeaf, lanCA, req => {
    assert.equal(req.headers.authorization, undefined)
    assert.equal(req.headers.cookie, undefined)
  }, t)
  assert.equal(await enrollLANRootViaTrustedDomain(bad.origin, 'alice', [{
    username: 'alice', server: 'https://' + domain + ':' + bad.port,
  }], domainCA), null, 'trusted domain alone cannot override a mismatched IP SAN')
  assert.equal(await probeWithTrustedLANRoot(bad.origin, lanCA), null)
  assert.equal(await readTrustedPlacesLANPeerFingerprint(ip, bad.port, lanCA), null)
})
