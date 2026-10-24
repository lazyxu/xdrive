'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const https = require('node:https')
const { spawnSync } = require('node:child_process')
const {
  privateLANOrigin, directLANIPv4Lookup, trustedDomainCandidates, verifiedLANRootPEM,
  enrollLANRootViaTrustedDomain, inspectPrivateLANFirstUse, probeWithTrustedLANRoot,
} = require('../dist/main/lan_root_auto.cjs')

test('auto LAN trust only accepts exact canonical private-IP HTTPS roots', () => {
  assert.deepEqual(privateLANOrigin('https://192.168.2.4:8443'), {
    origin: 'https://192.168.2.4:8443', ip: '192.168.2.4', port: 8443,
  })
  for (const server of [
    '', 'https://8.8.8.8:8443', 'https://127.0.0.1:8443',
    'https://drive.example.com:8443', 'http://192.168.2.4:8443',
    'https://192.168.02.4:8443', 'https://192.168.2.4.evil.example:8443',
    'https://user:pass@192.168.2.4:8443', 'https://192.168.2.4:8443/api',
    'https://192.168.2.4:8443/?secret=1', 'https://192.168.2.4:8443/#frag',
    'https://172.15.2.1:8443', 'https://172.32.2.1:8443',
    'https://192.169.2.4:8443', 'https://192.168.2.256:8443',
    'https://192.168.2.4:8443 ',
  ]) assert.equal(privateLANOrigin(server), null, server)
})

test('private-IP domain bootstrap supplies both Node lookup callback contracts', () => {
  const lookup = directLANIPv4Lookup('192.168.2.4')
  assert.throws(() => directLANIPv4Lookup('drive.example.com'), /IPv4/)
  const observed = []
  lookup('drive.example.com', { family: 4 }, (err, address, family) => {
    observed.push({ err, address, family })
  })
  lookup('drive.example.com', { family: 4, all: true }, (err, address, family) => {
    observed.push({ err, address, family })
  })
  assert.deepEqual(observed, [
    { err: null, address: '192.168.2.4', family: 4 },
    { err: null, address: [{ address: '192.168.2.4', family: 4 }], family: undefined },
  ])
})

test('Node real HTTP connection with autoSelectFamily uses the array lookup result', async t => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.host.startsWith('drive.example.invalid:'), true)
    res.writeHead(200, { 'content-type': 'text/plain', Connection: 'close' })
    res.end('authenticated lookup target reached')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()
  const reply = await new Promise((resolve, reject) => {
    const req = http.get({
      hostname: 'drive.example.invalid',
      port, autoSelectFamily: true, timeout: 2000,
      lookup: directLANIPv4Lookup('127.0.0.1'),
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('unexpected lookup timeout')))
  })
  assert.deepEqual(reply, { status: 200, body: 'authenticated lookup target reached' })
})

test('direct private-IP dialing preserves trusted-domain TLS hostname validation', {
  skip: spawnSync('openssl', ['version']).status !== 0,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-dualstack-tls-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const keyFile = path.join(dir, 'key.pem')
  const certFile = path.join(dir, 'cert.pem')
  const created = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile, '-out', certFile, '-days', '1',
    '-subj', '/CN=drive.example.invalid',
    '-addext', 'subjectAltName=DNS:drive.example.invalid',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,digitalSignature',
  ], { encoding: 'utf8' })
  assert.equal(created.status, 0, created.stderr)
  const ca = fs.readFileSync(certFile)
  const server = https.createServer({
    key: fs.readFileSync(keyFile), cert: ca,
  }, (_req, response) => response.end('trusted identity'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()
  const requestAsDomain = (hostname) => new Promise((resolve, reject) => {
    const req = https.get({
      hostname, servername: hostname, port, ca, rejectUnauthorized: true,
      autoSelectFamily: true, timeout: 2500,
      lookup: directLANIPv4Lookup('127.0.0.1'),
    }, response => {
      const data = []
      response.on('data', chunk => data.push(chunk))
      response.on('error', reject)
      response.on('end', () => resolve({
        status: response.statusCode, body: Buffer.concat(data).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('unexpected TLS fixture timeout')))
  })
  assert.deepEqual(await requestAsDomain('drive.example.invalid'),
    { status: 200, body: 'trusted identity' })
  await assert.rejects(requestAsDomain('other.example.invalid'),
    error => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID')
})

test('only prior successful HTTPS DNS profiles for same account may authorize CA enrollment', async () => {
  const profiles = [
    { username: 'alice', server: 'https://drive.example.com:8443' },
    { username: 'alice', server: 'https://192.168.2.4:8443' },
    { username: 'bob', server: 'https://other.example.net:8443' },
    { username: 'alice', server: 'http://insecure.example.net' },
    { username: 'alice', server: 'https://evil.example.net/path' },
  ]
  assert.deepEqual(trustedDomainCandidates(profiles, 'alice'),
    [{ hostname: 'drive.example.com' }])
  assert.deepEqual(trustedDomainCandidates(profiles, 'bob'),
    [{ hostname: 'other.example.net' }])
  assert.deepEqual(trustedDomainCandidates(profiles, 'charlie'), [])
  assert.equal(await enrollLANRootViaTrustedDomain('https://192.168.2.4:8443',
    'charlie', profiles), null)
  assert.equal(await probeWithTrustedLANRoot('https://192.168.2.4:8443',
    'not a PEM root'), null)
})

test('untrusted CA inspection only accepts canonical private IPv4 HTTPS', async () => {
  // These must fail BEFORE a network request; the IP-only unverified GET is
  // never available as an arbitrary URL fetch or a browser/Renderer capability.
  for (const server of [
    'http://192.168.2.4:8443',
    'https://8.8.8.8:8443',
    'https://192.168.2.4:8443/redirect',
    'https://user:secret@192.168.2.4:8443',
    'https://192.168.2.4.evil.invalid:8443',
  ]) {
    assert.equal(await inspectPrivateLANFirstUse(server), null, server)
  }
})

test('PEM parser accepts a single self-signed current CA but not a forged leaf or chain', {
  skip: spawnSync('openssl', ['version']).status !== 0,
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-lan-root-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const cert = path.join(dir, 'root.crt')
  const key = path.join(dir, 'root.key')
  const cmd = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=xDrive local fixture',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ], { encoding: 'utf8' })
  assert.equal(cmd.status, 0, cmd.stderr)
  const root = fs.readFileSync(cert, 'utf8')
  const validated = verifiedLANRootPEM(root)
  assert.equal(typeof validated?.sha256, 'string')
  assert.equal(validated.sha256.length, 64)
  for (const bad of [
    '', 'not a PEM certificate', root + root, root + 'untrusted-tail',
    '-----BEGIN PRIVATE KEY-----\nxxx\n-----END PRIVATE KEY-----',
  ]) assert.equal(verifiedLANRootPEM(bad), null)
})
