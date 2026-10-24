'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash, X509Certificate } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { fetchWithPinnedLANRoot } = require('../dist/main/lan_root_auto.cjs')

test('Desktop previews use only the exact previously trusted IP:port CA, not global Chromium bypass', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/index.cts'), 'utf8')
  const helper = fs.readFileSync(path.join(__dirname, '../src/main/lan_root_auto.cts'), 'utf8')
  assert.match(main, /async function fetchDesktopPreview\(input: string, init: RequestInit\)/)
  assert.match(main, /return fetchWithPinnedLANRoot\(input, init, pin\)/)
  assert.match(main, /filePreviewProxy = new DesktopFilePreviewProxy\(/)
  assert.match(main, /\(input, init\) => fetchDesktopPreview\(input, init\)/)
  assert.match(helper, /target\.origin !== expected\.origin/)
  assert.match(helper, /rejectUnauthorized: true/)
  assert.match(helper, /tls\.checkServerIdentity\(expected\.ip, certificate\)/)
  assert.match(helper, /incoming\.statusCode/)
  assert.match(helper, /status >= 300 && status < 400/)
  assert.match(helper, /Readable\.toWeb\(incoming\)/)
  assert.match(helper, /requestHeaders\.has\('range'\)/)
  assert.match(helper, /init\.signal\?\.addEventListener\('abort', abort/)
  for (const file of [main, helper]) assert.doesNotMatch(file, /setCertificateVerifyProc|ignoreCertificateErrors/)
})

test('Pinned media transport rejects foreign origins and credential-bearing headers before network', {
  skip: spawnSync('openssl', ['version']).status !== 0,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-pinned-media-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const cert = path.join(dir, 'ca.pem')
  const key = path.join(dir, 'ca.key')
  const req = spawnSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',key,'-out',cert,'-days','1','-subj','/CN=xDrive pinned media fixture',
    '-addext','basicConstraints=critical,CA:TRUE',
    '-addext','keyUsage=critical,keyCertSign,cRLSign'], { encoding: 'utf8' })
  assert.equal(req.status, 0, req.stderr)
  const pem = fs.readFileSync(cert, 'utf8')
  const sha256 = createHash('sha256').update(new X509Certificate(pem).raw).digest('hex')
  const pin = { server: 'https://192.168.2.4:8443', username: '',
    domain: '', source: 'user-approved-lan', root_pem: pem, sha256 }
  for (const destination of [
    'https://192.168.2.5:8443/file',
    'https://example.com:8443/file',
    'http://192.168.2.4:8443/file',
    'https://192.168.2.4:9443/file',
    'https://alice:secret@192.168.2.4:8443/file',
    'https://192.168.2.4:8443/file#fragment',
  ]) {
    await assert.rejects(fetchWithPinnedLANRoot(destination, { method: 'GET' }, pin),
      /pinned LAN media origin mismatch/, destination)
  }
  await assert.rejects(fetchWithPinnedLANRoot(
    'https://192.168.2.4:8443/file', { method: 'POST' }, pin),
    /unsupported pinned LAN media method/)
  await assert.rejects(fetchWithPinnedLANRoot(
    'https://192.168.2.4:8443/file', {
      method: 'GET', headers: { Authorization: 'Bearer not-sent' },
    }, pin), /unsupported pinned LAN media request header/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchWithPinnedLANRoot(
    'https://192.168.2.4:8443/file', { method: 'GET', signal: controller.signal }, pin),
    /pinned LAN media request aborted/)
})
