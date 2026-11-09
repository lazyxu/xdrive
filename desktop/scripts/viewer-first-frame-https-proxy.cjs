'use strict'
// Isolated test-only TLS front for the genuine Go/Gin/PG17/CAS test server.
// The production Web App correctly refuses HTTP credential restoration.
// This single-use localhost HTTPS origin preserves that policy, Owner auth,
// actual Go signed Range requests and both compiled production Web bundles.
const assert = require('node:assert/strict')
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { X509Certificate } = require('node:crypto')

async function startViewerFirstFrameHTTPSProxy(upstreamURL) {
  const upstream = new URL(upstreamURL)
  assert.equal(upstream.protocol, 'http:', 'upstream must be original Go HTTP test server')
  assert.equal(upstream.hostname, '127.0.0.1', 'never proxy non-loopback infrastructure')
  assert(upstream.port && !upstream.username && !upstream.password &&
    upstream.pathname === '/' && !upstream.search && !upstream.hash,
    'only the exact fresh Go test origin can be proxied')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-viewer-ff-tls-'))
  const certPath = path.join(dir, 'localhost.crt')
  const keyPath = path.join(dir, 'localhost.key')
  let server
  try {
    const generated = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', keyPath, '-out', certPath,
    ], { stdio: 'ignore' })
    assert.equal(generated.status, 0, 'one-use test TLS certificate required')
    const certificate = fs.readFileSync(certPath)
    // Electron's certificate fingerprint representation is not guaranteed
    // to be the same digest/format as Node's SHA-1 fingerprint. Pin the
    // exact ephemeral leaf certificate by its SHA-256 of DER bytes instead.
    const fingerprint = new X509Certificate(certificate).fingerprint256.toLowerCase()
    server = https.createServer({
      cert: certificate, key: fs.readFileSync(keyPath),
    }, (req, res) => {
      // No arbitrary URL proxying, CONNECT, or credential forwarding to a
      // non-test host. Every request reaches the original fixed Go endpoint.
      if (!req.url || !req.url.startsWith('/') || req.url.startsWith('//') ||
          req.method === 'CONNECT') {
        res.writeHead(400).end()
        return
      }
      const url = new URL(req.url, upstream)
      if (url.origin !== upstream.origin) {
        res.writeHead(400).end()
        return
      }
      const headers = { ...req.headers, host: req.headers.host,
        'x-forwarded-proto': 'https' }
      delete headers['proxy-authorization']
      const remote = http.request({
        hostname: upstream.hostname, port: Number(upstream.port),
        method: req.method, path: url.pathname + url.search, headers,
      }, response => {
        if (res.destroyed || res.headersSent) {
          response.destroy()
          return
        }
        res.writeHead(response.statusCode || 502, response.headers)
        response.pipe(res)
      })
      remote.once('error', () => {
        if (!res.headersSent) res.writeHead(502)
        if (!res.destroyed) res.end()
      })
      req.once('aborted', () => remote.destroy())
      res.once('close', () => remote.destroy())
      req.pipe(remote)
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    assert(address && typeof address !== 'string' && address.port > 0)
    return {
      origin: 'https://127.0.0.1:' + address.port,
      fingerprint,
      certificatePEM: certificate.toString('utf8'),
      async close() {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
        fs.rmSync(dir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (server?.listening) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

function installPinnedViewerFixtureCertificate(electronSession, fixture) {
  const url = new URL(fixture.origin)
  assert(url.protocol === 'https:' && url.hostname === '127.0.0.1' && url.port &&
    /^[0-9a-f:]+$/.test(fixture.fingerprint),
    'only a single ephemeral localhost certificate may be pinned')
  // Isolated Electron session per sample; never change global TLS settings.
  // -3 means use Chromium's usual verification for any other certificate.
  electronSession.setCertificateVerifyProc((request, callback) => {
    let fingerprint = null
    try {
      // Electron provides the actual PEM leaf. Compute the identical SHA-256
      // digest on both sides, independent of Chromium's display fingerprint.
      // Never accept a missing/malformed certificate or another TLS identity.
      fingerprint = new X509Certificate(request.certificate?.data || '')
        .fingerprint256.toLowerCase()
    } catch { /* Fail closed for absent or invalid leaf PEM. */ }
    if (request.hostname === url.hostname && fingerprint === fixture.fingerprint) {
      callback(0)
    } else {
      // A different certificate on the loopback benchmark host is denied.
      // All non-fixture hosts keep Chromium's standard verification result.
      callback(request.hostname === url.hostname ? -2 : -3)
    }
  })
}
module.exports = { startViewerFirstFrameHTTPSProxy, installPinnedViewerFixtureCertificate }
