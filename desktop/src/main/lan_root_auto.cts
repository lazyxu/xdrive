// Establish LAN trust through either a previously authenticated public domain
// OR an explicit local user approval of first-use CA identity. Never treat a
// mere private-IP address or an untrusted TLS response as user consent, and
// never install any trust anchor in the operating system.
import { X509Certificate, createHash } from 'node:crypto'
import * as https from 'node:https'
import * as tls from 'node:tls'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

export type TrustedLANProfile = { server: string; username: string }
export type TrustedLANRoot = {
  server: string
  username: string
  domain: string
  root_pem: string
  sha256: string
  // Empty username/domain are reserved for one explicitly approved IP origin.
  source?: 'verified-domain' | 'user-approved-lan'
}

type PrivateTarget = { origin: string; ip: string; port: number }
type HTTPSName = { hostname: string }
const CA_PATH = '/_xdrive/desktop/lan-root.crt'
const MAX_PEM = 8192

export function privateLANOrigin(value: string): PrivateTarget | null {
  if (typeof value !== 'string' || value !== value.trim()) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || !/^[0-9.]+$/.test(url.hostname) ||
      url.origin !== value.replace(/\/$/, '')) return null
  const parts = url.hostname.split('.')
  if (parts.length !== 4 || parts.some(v => !/^(0|[1-9][0-9]{0,2})$/.test(v) || Number(v) > 255)) {
    return null
  }
  const [a, b] = parts.map(Number)
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) return null
  const port = url.port ? Number(url.port) : 443
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { origin: url.origin, ip: url.hostname, port }
}

export function trustedDomainCandidates(profiles: readonly TrustedLANProfile[], username: string): HTTPSName[] {
  if (!username.trim()) return []
  const hosts = new Set<string>()
  for (const profile of profiles) {
    if (profile.username !== username.trim()) continue
    try {
      const url = new URL(profile.server)
      if (url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash &&
          !url.username && !url.password && isIP(url.hostname) === 0 &&
          url.hostname.includes('.') && /^[a-z0-9.-]+$/i.test(url.hostname)) hosts.add(url.hostname)
    } catch { /* Legacy malformed profile is not an identity. */ }
  }
  return [...hosts].slice(0, 4).map(hostname => ({ hostname }))
}

export function verifiedLANRootPEM(value: string): { pem: string; sha256: string } | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PEM) return null
  const pem = value.replace(/\r\n/g, '\n')
  if (!/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+\/=\n]+-----END CERTIFICATE-----\n?$/.test(pem)) return null
  try {
    const cert = new X509Certificate(pem)
    const now = Date.now()
    if (!cert.ca || cert.subject !== cert.issuer || !cert.verify(cert.publicKey) ||
        Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now) return null
    return { pem, sha256: createHash('sha256').update(cert.raw).digest('hex') }
  } catch { return null }
}

function readHTTPS(options: https.RequestOptions, maxBytes: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      ...options,
      method: 'GET',
      headers: { Accept: 'application/json, application/x-pem-file' },
      rejectUnauthorized: true,
      timeout: 6000,
      agent: false,
    }, response => {
      const status = response.statusCode || 0
      let size = 0
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) { request.destroy(new Error('response too large')); return }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ status, text: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', reject)
    request.end()
  })
}

export async function probeWithTrustedLANRoot(server: string, rootPEM: string): Promise<string | null> {
  const target = privateLANOrigin(server)
  if (!target || !verifiedLANRootPEM(rootPEM)) return null
  try {
    const response = await readHTTPS({
      hostname: target.ip,
      port: target.port,
      path: '/api/v1/version',
      ca: rootPEM,
      servername: '', // IP URLs do not send SNI; require the genuine IP SAN.
      checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(target.ip, certificate),
    }, 16384)
    if (response.status !== 200) return null
    const version: unknown = JSON.parse(response.text)
    if (!version || typeof version !== 'object' || Array.isArray(version) ||
        typeof (version as { version?: unknown }).version !== 'string' ||
        !(version as { version: string }).version.trim()) return null
    return (version as { version: string }).version.trim()
  } catch { return null }
}

// A narrow, *unauthenticated* certificate discovery path for a user-initiated
// first-use approval. This is deliberately NOT a general insecure HTTP client.
// No Cookie, password, Authorization, redirects, or arbitrary URL ever enter
// this request. The response is untrusted until the user explicitly approves
// the SHA-256 shown by Electron Main.
function readUntrustedLocalCertificateOnly(target: PrivateTarget): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: string | null) => {
      if (!settled) { settled = true; resolve(value) }
    }
    const request = https.request({
      hostname: target.ip, port: target.port, path: CA_PATH,
      method: 'GET', servername: '', agent: false, timeout: 6000,
      headers: { Accept: 'application/x-pem-file', 'Cache-Control': 'no-store' },
      // This exception is permitted ONLY for pre-auth public-CA inspection.
      // All account requests and the subsequent IP-SAN probe use strict TLS.
      rejectUnauthorized: false,
    }, response => {
      if (response.statusCode !== 200) {
        response.resume()
        finish(null)
        return
      }
      let length = 0
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > MAX_PEM) {
          request.destroy()
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
      response.on('error', () => finish(null))
    })
    request.on('timeout', () => { request.destroy(); finish(null) })
    request.on('error', () => finish(null))
    request.end()
  })
}

// Caller MUST show the CA certificate fingerprint to the local user and
// receive explicit approval before persisting the returned root. This proves
// chain/IP SAN syntax but not remote identity on first use (TOFU).
export async function inspectPrivateLANFirstUse(
  server: string,
): Promise<{ root_pem: string; sha256: string; version: string } | null> {
  const target = privateLANOrigin(server)
  if (!target) return null
  const candidate = await readUntrustedLocalCertificateOnly(target)
  if (!candidate) return null
  const root = verifiedLANRootPEM(candidate)
  if (!root) return null
  const version = await probeWithTrustedLANRoot(target.origin, root.pem)
  if (!version) return null
  return { root_pem: root.pem, sha256: root.sha256, version }
}

// Optional CA argument is for locally generated offline TLS fixture tests; no
// renderer or IPC caller can choose one. Production only uses platform trust.
export async function enrollLANRootViaTrustedDomain(
  server: string, username: string, profiles: readonly TrustedLANProfile[],
  fixtureDomainCA?: string,
): Promise<{ pin: TrustedLANRoot; version: string } | null> {
  const target = privateLANOrigin(server)
  if (!target) return null
  for (const domain of trustedDomainCandidates(profiles, username)) {
    try {
      const response = await readHTTPS({
        hostname: domain.hostname,
        port: target.port,
        path: CA_PATH,
        servername: domain.hostname,
        lookup: (_hostname, _options, callback) => callback(null, target.ip, 4),
        ...(fixtureDomainCA ? { ca: fixtureDomainCA } : {}),
      }, MAX_PEM)
      if (response.status !== 200) continue // Never follow 30x.
      const root = verifiedLANRootPEM(response.text)
      if (!root) continue
      // Second independent handshake validates the actual IP SAN and chain.
      const version = await probeWithTrustedLANRoot(server, root.pem)
      if (!version) continue
      return {
        pin: {
          server: target.origin, username: username.trim(),
          domain: domain.hostname, root_pem: root.pem, sha256: root.sha256,
          source: 'verified-domain',
        },
        version,
      }
    } catch {
      // Never leak upstream hostnames, certificates or transport errors to UI.
    }
  }
  return null
}


// Stream signed file-preview bytes for the currently logged-in private IP
// using ONLY the user's accepted CA; Electron net.fetch does not inherit this
// app-local root. This transport is scoped to the exact origin and never
// touches Chromium's global certificate decisions.
export async function fetchWithPinnedLANRoot(
  input: string,
  init: RequestInit,
  pin: TrustedLANRoot,
): Promise<Response> {
  let target: URL
  try { target = new URL(input) } catch { throw new Error('invalid pinned media URL') }
  const expected = privateLANOrigin(pin.server)
  const pem = verifiedLANRootPEM(pin.root_pem)
  if (!expected || !pem || pem.sha256 !== pin.sha256 ||
      target.origin !== expected.origin || target.protocol !== 'https:' ||
      target.username || target.password || target.hash) {
    throw new Error('pinned LAN media origin mismatch')
  }
  const method = init.method?.toUpperCase() || 'GET'
  if (method !== 'GET' && method !== 'HEAD') throw new Error('unsupported pinned LAN media method')
  const requestHeaders = new Headers(init.headers)
  for (const key of requestHeaders.keys()) {
    if (key.toLowerCase() !== 'range') throw new Error('unsupported pinned LAN media request header')
  }
  if (init.signal?.aborted) throw new Error('pinned LAN media request aborted')

  return new Promise<Response>((resolve, reject) => {
    let settled = false
    const request = https.request({
      hostname: expected.ip,
      port: expected.port,
      path: target.pathname + target.search,
      method,
      agent: false,
      ca: pin.root_pem,
      servername: '',
      rejectUnauthorized: true,
      checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(expected.ip, certificate),
      ...(requestHeaders.has('range') ? { headers: { Range: requestHeaders.get('range')! } } : {}),
    }, incoming => {
      const status = incoming.statusCode || 0
      if (status < 200 || status > 599 || (status >= 300 && status < 400)) {
        incoming.destroy()
        if (!settled) { settled = true; reject(new Error('pinned LAN media redirect or invalid status')) }
        return
      }
      const headers = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(key, value)
        else if (Array.isArray(value)) for (const item of value) headers.append(key, item)
      }
      try {
        const body = method === 'HEAD' || status === 204 || status === 205 || status === 304
          ? null : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>)
        const response = new Response(body, { status, headers })
        settled = true
        resolve(response)
        if (!body) incoming.resume()
      } catch {
        incoming.destroy()
        if (!settled) { settled = true; reject(new Error('invalid pinned LAN media response')) }
      }
    })
    const abort = () => request.destroy(new Error('pinned LAN media request aborted'))
    init.signal?.addEventListener('abort', abort, { once: true })
    request.on('close', () => init.signal?.removeEventListener('abort', abort))
    request.on('error', () => {
      if (!settled) { settled = true; reject(new Error('pinned LAN media TLS or network failure')) }
    })
    request.setTimeout(30_000, () => request.destroy(new Error('pinned LAN media idle timeout')))
    request.end()
  })
}
