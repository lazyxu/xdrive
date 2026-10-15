#!/usr/bin/env node
'use strict'
// S5-A: read-only HTTPS origin attestation. This NEVER verifies iOS/Android
// OS installation, background execution, authenticated bytes or release GO.
const fs = require('node:fs')
const net = require('node:net')
const crypto = require('node:crypto')

const EXPECTED = Object.freeze([
  { id: 'manifest_head', path: '/site.webmanifest', mime: /^application\/(manifest\+json|json)\b/i, revalidate: true },
  { id: 'worker_head', path: '/sw.js', mime: /^(text|application)\/(javascript|ecmascript)\b/i, revalidate: true },
  { id: 'offline_head', path: '/offline.html', mime: /^text\/html\b/i, revalidate: true },
  { id: 'icon192_head', path: '/pwa-192.png', mime: /^image\/png\b/i, revalidate: false },
  { id: 'icon512_head', path: '/pwa-512.png', mime: /^image\/png\b/i, revalidate: false },
])
function argumentsFrom(argv) {
  const args = { origin: '', fixture: false, output: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--origin' && i + 1 < argv.length) args.origin = argv[++i]
    else if (argv[i] === '--output' && i + 1 < argv.length) args.output = argv[++i]
    else if (argv[i] === '--fixture-loopback') args.fixture = true
    else throw Error('invalid_arguments')
  }
  if (!args.origin) throw Error('origin_required')
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('tls_verification_disabled')
  if (args.fixture && process.env.XD_PWA_S5_FIXTURE !== '1') throw Error('fixture_not_authorized')
  let url
  try { url = new URL(args.origin) } catch { throw Error('invalid_origin') }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || !url.port && args.origin.includes(':0/')) {
    throw Error('unsafe_origin')
  }
  const local = host === 'localhost' || host.endsWith('.localhost') ||
    net.isIP(host) !== 0 || host.endsWith('.test') || host.endsWith('.invalid') ||
    host.endsWith('.example')
  if (args.fixture ? !(host === 'localhost' || host === '127.0.0.1' || host === '::1') : local) {
    throw Error('not_a_production_dns_origin')
  }
  if (args.output && (args.output.includes('\0') || args.output.length > 1024)) throw Error('unsafe_output_path')
  return { base: url.origin, fixture: args.fixture, output: args.output }
}
function outcome(id, pass, code) {
  return { id, status: pass ? 'pass' : 'fail', reason: pass ? 'verified' : code }
}
async function request(base, route, method) {
  // The platform root store or an explicitly supplied Node CA must trust the
  // actual chain AND hostname. No TLS bypass, browser mocks or redirects.
  try {
    return await fetch(base + route, {
      method, credentials: 'omit', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(6000), headers: { Accept: '*/*' },
    })
  } catch {
    return null // Never expose URL, raw TLS errors, DNS, headers or tokens.
  }
}
function secureHeaders(response) {
  return !response.headers.has('set-cookie') &&
    (response.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff'
}
function revalidates(response) {
  return /\bno-cache\b|\bno-store\b/i.test(response.headers.get('cache-control') || '')
}
function hsts(response) {
  const raw = response.headers.get('strict-transport-security') || ''
  const match = /(?:^|;)\s*max-age\s*=\s*(\d+)/i.exec(raw)
  return !!match && Number(match[1]) >= 2592000
}
async function publicHead(base, asset) {
  const res = await request(base, asset.path, 'HEAD')
  if (!res) return outcome(asset.id, false, 'tls_or_network')
  if (res.status >= 300 && res.status < 400) return outcome(asset.id, false, 'redirect')
  if (res.status !== 200) return outcome(asset.id, false, 'http_status')
  if (!asset.mime.test(res.headers.get('content-type') || '')) return outcome(asset.id, false, 'mime_or_html_fallback')
  if (!secureHeaders(res)) return outcome(asset.id, false, 'security_headers')
  if (asset.revalidate && !revalidates(res)) return outcome(asset.id, false, 'unsafe_static_cache')
  return outcome(asset.id, true)
}
async function limitedBody(response, maxBytes) {
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw Error('oversize')
  if (!response.body) throw Error('missing_body')
  let size = 0
  const parts = []
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maxBytes) throw Error('oversize')
    parts.push(chunk)
  }
  return Buffer.concat(parts).toString('utf8')
}
async function manifestContract(base) {
  const res = await request(base, '/site.webmanifest', 'GET')
  if (!res) return outcome('manifest_contract', false, 'tls_or_network')
  if (res.status !== 200) return outcome('manifest_contract', false, 'http_status')
  if (!EXPECTED[0].mime.test(res.headers.get('content-type') || '') || !secureHeaders(res)) {
    return outcome('manifest_contract', false, 'mime_or_security_headers')
  }
  try {
    const m = JSON.parse(await limitedBody(res, 16384))
    const icons = Array.isArray(m.icons) ? m.icons : []
    const hasIcon = (src, size) => icons.some(icon => icon.src === src &&
      icon.sizes?.split(/\s+/).includes(size) && icon.type === 'image/png')
    const valid = m.id === '/' && m.start_url === '/' && m.scope === '/' &&
      m.display === 'standalone' && typeof m.name === 'string' && !!m.name.trim() &&
      hasIcon('/pwa-192.png', '192x192') && hasIcon('/pwa-512.png', '512x512')
    return outcome('manifest_contract', valid, 'invalid_manifest')
  } catch {
    return outcome('manifest_contract', false, 'invalid_or_oversized_manifest')
  }
}
async function protectedAPI(base, route, id) {
  const res = await request(base, route, 'GET')
  if (!res) return outcome(id, false, 'tls_or_network')
  // A login page or a cached private representation is NOT an auth rejection.
  const valid = (res.status === 401 || res.status === 403) &&
    !res.headers.has('set-cookie') && revalidates(res)
  if (res.body) await res.body.cancel()
  return outcome(id, valid, 'private_route_not_protected_or_uncacheable')
}
async function audit(base, fixture) {
  const heads = await Promise.all(EXPECTED.map(asset => publicHead(base, asset)))
  const manifest = await manifestContract(base)
  const probe = await request(base, '/site.webmanifest', 'HEAD')
  const headers = outcome('https_security_headers', !!probe && probe.status === 200 &&
    secureHeaders(probe) && hsts(probe), 'hsts_or_security_headers')
  const ready = await request(base, '/api/v1/readyz', 'GET')
  const readyOutcome = outcome('server_ready', !!ready && ready.status === 200, 'server_not_ready')
  if (ready?.body) await ready.body.cancel()
  const protectedCases = await Promise.all([
    protectedAPI(base, '/api/v1/nodes/root', 'private_nodes_denied'),
    protectedAPI(base, '/api/v1/file-operations', 'private_operations_denied'),
  ])
  const checks = [...heads, manifest, headers, readyOutcome, ...protectedCases]
  const transportPass = checks.every(c => c.status === 'pass')
  return {
    schema: 'xdrive-pwa-s5a-live-origin-v1',
    observed_at: new Date().toISOString(),
    origin_sha256: crypto.createHash('sha256').update(base).digest('hex'),
    evidence_environment: fixture ? 'test-fixture-https' : 'node-trusted-https-origin',
    actual_https_preflight: transportPass ? 'pass' : 'fail',
    // Only the transport/install-asset gate is examined. Mobile OS trust is
    // different from the runner's Node trust; browser install is not inferred.
    release_gate: transportPass ? 'NO_GO_PHYSICAL_INSTALL_NOT_RUN' : 'NO_GO_HTTPS_PREFLIGHT',
    physical_platforms: {
      ios27_safari_home_screen: 'not-run',
      android_chrome_installed: 'not-run',
      desktop_chrome_edge_installed: 'not-run',
    },
    checks,
  }
}
async function main() {
  let options
  try { options = argumentsFrom(process.argv.slice(2)) }
  catch (err) {
    process.stdout.write(JSON.stringify({ schema: 'xdrive-pwa-s5a-live-origin-v1',
      actual_https_preflight: 'fail', release_gate: 'NO_GO_INVALID_INPUT',
      reason: err.message }) + '\n')
    process.exitCode = 2
    return
  }
  const report = await audit(options.base, options.fixture)
  const serialized = JSON.stringify(report, null, 2) + '\n'
  if (options.output) fs.writeFileSync(options.output, serialized, { mode: 0o600, flag: 'wx' })
  process.stdout.write(serialized)
  process.exitCode = report.actual_https_preflight === 'pass' ? 0 : 1
}
if (require.main === module) main().catch(() => {
  process.stdout.write(JSON.stringify({ schema: 'xdrive-pwa-s5a-live-origin-v1',
    actual_https_preflight: 'fail', release_gate: 'NO_GO_AUDIT_ERROR' }) + '\n')
  process.exitCode = 2
})
module.exports = { argumentsFrom, audit, EXPECTED }
