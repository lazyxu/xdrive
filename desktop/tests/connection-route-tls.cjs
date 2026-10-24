const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const { spawnSync, execFile } = require('node:child_process')
const { promisify } = require('node:util')

test('direct IP probes and previews preserve domain Host/SNI and reject wrong or untrusted certificates before HTTP', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-route-tls-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const key = path.join(dir, 'key.pem'); const cert = path.join(dir, 'cert.pem')
  const config = path.join(dir, 'openssl.cnf')
  fs.writeFileSync(config, '[req]\ndistinguished_name=dn\n[dn]\n')
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-config', config, '-days', '1', '-subj', '/CN=drive.example.invalid', '-addext', 'subjectAltName=DNS:drive.example.invalid',
    '-addext', 'basicConstraints=critical,CA:TRUE'], { encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.error?.message || generated.stderr)
  const requests = []
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    requests.push({ host: req.headers.host, sni: req.socket.servername, path: req.url,
      authorization: req.headers.authorization, cookie: req.headers.cookie, range: req.headers.range })
    if (req.url === '/redirect') { res.writeHead(307, { Location: 'https://foreign.example.invalid/' }); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/json', Connection: 'close' })
    res.end(req.url === '/api/v1/version' ? '{"version":"fixture-v1"}' : 'fixture-preview')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const port = server.address().port
  const modulePath = path.resolve(__dirname, '../dist/main/connection_route.cjs')
  const run = async (body, trusted = true) => {
    const script = `const assert=require('node:assert/strict');const{probeConnectionIP,fetchWithConnectionIP}=require(${JSON.stringify(modulePath)});(async()=>{${body}})().catch(()=>process.exitCode=1)`
    const env = { ...process.env }; delete env.NODE_TLS_REJECT_UNAUTHORIZED
    if (trusted) env.NODE_EXTRA_CA_CERTS = cert; else delete env.NODE_EXTRA_CA_CERTS
    return promisify(execFile)(process.execPath, ['-e', script], { env, timeout: 10000 })
  }
  const origin = `https://drive.example.invalid:${port}/`
  await run(`assert.equal(await probeConnectionIP(${JSON.stringify(origin)},'127.0.0.1'),'fixture-v1');
    const response=await fetchWithConnectionIP(${JSON.stringify(origin + 'preview')},{headers:{Range:'bytes=0-15'}},${JSON.stringify(origin)},'127.0.0.1');assert.equal(await response.text(),'fixture-preview');
    await assert.rejects(fetchWithConnectionIP('https://foreign.example.invalid/private',{},${JSON.stringify(origin)},'127.0.0.1'));
    await assert.rejects(fetchWithConnectionIP(${JSON.stringify(origin+'redirect')},{},${JSON.stringify(origin)},'127.0.0.1'),e=>e.code==='server_auth_redirect');`)
  assert.equal(requests.length, 3)
  for (const req of requests) {
    assert.equal(req.host, `drive.example.invalid:${port}`)
    assert.equal(req.sni, 'drive.example.invalid')
    assert.equal(req.authorization, undefined); assert.equal(req.cookie, undefined)
  }
  assert.equal(requests[1].range, 'bytes=0-15')
  await run(`await assert.rejects(probeConnectionIP('https://other.example.invalid:${port}/','127.0.0.1'),e=>e.code==='server_tls_name'&&!e.cause);`)
  await run(`await assert.rejects(probeConnectionIP(${JSON.stringify(origin)},'127.0.0.1'),e=>e.code==='server_tls_trust'&&!e.cause);`, false)
  assert.equal(requests.length, 3, 'TLS denial sends no HTTP request')
})
