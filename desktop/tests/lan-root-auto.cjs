'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const {
  privateLANOrigin, trustedDomainCandidates, verifiedLANRootPEM,
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
