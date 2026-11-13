'use strict'

// CI-only loopback reproduction of Caddy's dual HTTPS ingress. This exercises
// actual TLS handshakes and the bootstrap -> pinned-IP -> /version sequence;
// it intentionally never contacts a user's NAS or transmits credentials.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const tls = require('node:tls')
const crypto = require('node:crypto')
const { execFileSync, spawn } = require('node:child_process')

const domain = 'drive.example.test'
const ip = '192.168.2.4'
const rootPath = '/_xdrive/desktop/lan-root.crt'

function createFixtures(dir) {
  const file = name => path.join(dir, name)
  const run = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore', timeout: 15000 })
  fs.writeFileSync(file('root.cnf'), `[req]\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n`)
  const root = name => run('req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3',
    '-subj', `/CN=xDrive automated ${name}`, '-config', 'root.cnf', '-keyout', `${name}.key`, '-out', `${name}.pem`)
  for (const name of ['local-root', 'other-root', 'public-root']) root(name)
  const csr = (name, cn) => run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-subj', `/CN=${cn}`, '-keyout', `${name}.key`, '-out', `${name}.csr`)
  const sign = (name, signer, extensions) => {
    fs.writeFileSync(file(`${name}.ext`), extensions)
    run('x509', '-req', '-in', `${name}.csr`, '-CA', `${signer}.pem`, '-CAkey', `${signer}.key`,
      '-CAcreateserial', '-days', '2', '-sha256', '-extfile', `${name}.ext`, '-out', `${name}.pem`)
  }
  const interExt = 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n'
  csr('intermediate', 'xDrive Caddy Local Intermediate')
  sign('intermediate', 'local-root', interExt)
  csr('lan', ip)
  const leafExt = (san, eku='serverAuth') => `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=${eku}\nsubjectAltName=${san}\n`
  for (const [name, signer, san, eku] of [
    ['lan-valid', 'intermediate', `IP:${ip}`, 'serverAuth'],
    ['lan-wrong-ip', 'intermediate', 'IP:192.168.2.5', 'serverAuth'],
    ['lan-dns-only', 'intermediate', `DNS:${ip}`, 'serverAuth'],
    ['lan-client-auth', 'intermediate', `IP:${ip}`, 'clientAuth'],
    ['lan-other-root', 'other-root', `IP:${ip}`, 'serverAuth']
  ]) {
    fs.copyFileSync(file('lan.csr'), file(`${name}.csr`))
    sign(name, signer, leafExt(san, eku))
  }
  csr('public-leaf', domain)
  sign('public-leaf', 'public-root', leafExt(`DNS:${domain}`))
  return {
    read: name => fs.readFileSync(file(name), 'utf8'),
    chain: (name, intermediate=true) => fs.readFileSync(file(`${name}.pem`), 'utf8') +
      (intermediate ? fs.readFileSync(file('intermediate.pem'), 'utf8') : ''),
    key: name => fs.readFileSync(file(`${name}.key`)),
  }
}

function parseHTTP(raw, expectedType, maxBytes) {
  const split = raw.indexOf('\r\n\r\n')
  assert.ok(split > 0 && split < 4096, 'bounded HTTP headers')
  const header = raw.subarray(0, split).toString('ascii')
  const body = raw.subarray(split + 4)
  const status = header.split('\r\n', 1)[0]
  assert.equal(status, 'HTTP/1.0 200 OK', 'no redirects or error responses')
  assert.match(header, new RegExp(`\\r\\nContent-Type: ${expectedType}\\r\\n`, 'i'))
  const length = header.match(/\r\nContent-Length: ([0-9]+)\r\n/i)
  assert.ok(length, 'response must have a Content-Length')
  assert.equal(body.length, Number(length[1]))
  assert.ok(body.length > 0 && body.length <= maxBytes)
  return body
}

function appleProbe(binary, port, expectation, rootPath, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [String(port), expectation, rootPath, label], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_PROXY: '192.168.2.4,127.0.0.1,localhost', no_proxy: '192.168.2.4,127.0.0.1,localhost' }
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000)
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timeout)
      code === 0 ? resolve(output) : reject(new Error(`Apple probe ${label} failed (${code}): ${output.slice(0, 1200)}`))
    })
  })
}

function request(port, ca, expectedName, servername, requestedPath) {
  return new Promise((resolve, reject) => {
    let finished = false
    let buffer = Buffer.alloc(0)
    const socket = tls.connect({ host: '127.0.0.1', port, servername, ca,
      minVersion: 'TLSv1.2', rejectUnauthorized: true,
      checkServerIdentity: (_host, cert) => tls.checkServerIdentity(expectedName, cert) })
    const done = (err, result) => {
      if (finished) return
      finished = true
      socket.destroy()
      err ? reject(err) : resolve(result)
    }
    socket.setTimeout(3000, () => done(new Error('TLS test deadline exceeded')))
    socket.once('error', err => done(err))
    socket.once('secureConnect', () => {
      if (!socket.authorized) return done(new Error('TLS peer was not authorized'))
      socket.write(`GET ${requestedPath} HTTP/1.0\r\nHost: ${domain}\r\nAccept: */*\r\nConnection: close\r\n\r\n`)
    })
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data])
      if (buffer.length > 16384) done(new Error('unbounded response'))
    })
    socket.once('end', () => done(null, buffer))
  })
}

test('iOS LAN Caddy wire: authenticated DNS SNI bootstrap + pinned IP identity', { timeout: 60000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-lan-tls-wire-'))
  let server
  try {
    const fixture = createFixtures(dir)
    const publicContext = tls.createSecureContext({ key: fixture.key('public-leaf'), cert: fixture.read('public-leaf.pem') })
    let currentRoot = fixture.read('local-root.pem')
    let versionResponse = { status: 200, body: JSON.stringify({ version: 'test' }) }
    let sawNoSNI = false
    let sawDomainSNI = false
    server = tls.createServer({
      key: fixture.key('lan'), cert: fixture.chain('lan-valid'), minVersion: 'TLSv1.2',
      SNICallback(name, callback) {
        callback(null, name === domain ? publicContext : undefined)
      }
    }, socket => {
      let requestText = ''
      if (socket.servername === domain) sawDomainSNI = true
      if (!socket.servername) sawNoSNI = true
      socket.on('data', data => {
        requestText += data.toString('ascii')
        if (!requestText.includes('\r\n\r\n')) return
        if (requestText.length > 4096 || /\r\n(?:Authorization|Cookie):/i.test(requestText)) {
          socket.destroy()
          return
        }
        const requested = requestText.split('\r\n', 1)[0]
        const bootstrap = requested === `GET ${rootPath} HTTP/1.0` && socket.servername === domain
        const version = requested === 'GET /api/v1/version HTTP/1.0'
        const status = bootstrap ? 200 : version ? versionResponse.status : 404
        const body = bootstrap ? currentRoot : version ? versionResponse.body : 'not found'
        const mime = bootstrap ? 'application/x-pem-file' : 'application/json'
        const reason = status === 200 ? 'OK' : status === 302 ? 'Found' : 'Not Found'
        socket.end(`HTTP/1.0 ${status} ${reason}\r\nContent-Type: ${mime}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
      })
    })
    server.on('tlsClientError', () => {}) // expected failures are asserted by the client
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, process.env.XDRIVE_LAN_APPLE_TEST_BINARY ? '0.0.0.0' : '127.0.0.1', resolve) })
    const port = server.address().port
    const setIPLeaf = (name, sendIntermediate=true) => server.setSecureContext({
      key: fixture.key('lan'), cert: fixture.chain(name, sendIntermediate)
    })
    const runApple = async (expectation, rootName, label) => {
      const binary = process.env.XDRIVE_LAN_APPLE_TEST_BINARY
      if (!binary) return
      const caPath = path.join(dir, rootName)
      assert.match(await appleProbe(binary, port, expectation, caPath, label), /Apple URLSession/)
    }
    const pair = async () => {
      const bootstrap = await request(port, fixture.read('public-root.pem'), domain, domain, rootPath)
      const root = parseHTTP(bootstrap, 'application/x-pem-file', 8192)
      assert.match(root.toString('ascii'), /^-----BEGIN CERTIFICATE-----/)
      assert.equal((root.toString('ascii').match(/-----BEGIN CERTIFICATE-----/g) || []).length, 1)
      let version
      try {
        version = await request(port, root, ip, undefined, '/api/v1/version')
      } catch (error) {
        throw new Error(`stage3 strict TLS/IP/CA: ${error.code || error.message}`)
      }
      let json
      try {
        json = JSON.parse(parseHTTP(version, 'application/json', 16384).toString('utf8'))
        assert.equal(json.version, 'test')
      } catch (error) {
        throw new Error(`stage4 version response: ${error.message}`)
      }
      return crypto.createHash('sha256').update(root).digest('hex')
    }

    await t.test('valid dual-ingress chain and /version succeed, without credentials', async () => {
      assert.equal((await pair()).length, 64)
      assert.ok(sawDomainSNI, 'domain bootstrap must use DNS SNI')
      assert.ok(sawNoSNI, 'IP probe must not rely on public-domain SNI')
      await runApple('trusted', 'local-root.pem', 'valid-ip')
    })
    for (const [name, leaf, intermediate, responseRoot] of [
      ['wrong IP SAN', 'lan-wrong-ip', true, 'local-root.pem'],
      ['DNS SAN does not authenticate IP', 'lan-dns-only', true, 'local-root.pem'],
      ['missing Caddy intermediate', 'lan-valid', false, 'local-root.pem'],
      ['wrong issuing CA', 'lan-other-root', false, 'local-root.pem'],
      ['invalid TLS serverAuth usage', 'lan-client-auth', true, 'local-root.pem'],
      ['downloaded CA differs from IP chain', 'lan-valid', true, 'other-root.pem']
    ]) {
      await t.test(name + ' fails closed in step 3', async () => {
        setIPLeaf(leaf, intermediate)
        currentRoot = fixture.read(responseRoot)
        await assert.rejects(pair(), /stage3 strict TLS\/IP\/CA/)
        if (name === 'wrong IP SAN' || name === 'downloaded CA differs from IP chain') {
          await runApple(name === 'wrong IP SAN' ? 'identity' : 'chain',
            responseRoot, name)
        }
      })
    }
    await t.test('public-domain certificate on IP default fails IP SAN and pinned CA', async () => {
      server.setSecureContext({ key: fixture.key('public-leaf'), cert: fixture.read('public-leaf.pem') })
      currentRoot = fixture.read('local-root.pem')
      await assert.rejects(pair(), /stage3 strict TLS\/IP\/CA/)
    })
    setIPLeaf('lan-valid')
    currentRoot = fixture.read('local-root.pem')
    for (const [name, response] of [
      ['redirect is a step-4 error', { status: 302, body: '{}' }],
      ['malformed version is a step-4 error', { status: 200, body: '<html></html>' }]
    ]) {
      await t.test(name + ', not an IP CA failure', async () => {
        versionResponse = response
        await assert.rejects(pair(), /stage4 version response/)
      })
    }
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
