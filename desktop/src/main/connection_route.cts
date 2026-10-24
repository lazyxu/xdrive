import { Resolver } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import * as https from 'node:https'
import { Readable } from 'node:stream'
import type { LookupOptions, LookupAddress } from 'node:dns'

export type ConnectionRoute = { mode: 'auto' | 'lan' | 'public'; lan_ip: string; public_ip: string }
const messages: Record<string, string> = {
  invalid_route: '连接模式或 IP 无效。内网请填写私有 IP，公网 IP 可留空使用 DNS。',
  invalid_server: '连接选路需要 HTTPS 根地址；原域名用于证书验证。',
  server_dns: '公网 DNS 未返回可用的公网 IP。请检查 DNS，或填写公网 IP。',
  server_refused: '服务器端口拒绝连接。请检查服务监听、端口映射及防火墙。',
  server_timeout: '服务器连接超时。请检查网络及服务器端口。',
  server_network: '服务器网络不可达。请检查当前网络和 IP。',
  server_tls_name: 'HTTPS 证书与原服务器域名不匹配，已停止连接。',
  server_tls_trust: 'HTTPS 证书验证失败，已停止连接；不会跳过证书校验。',
  server_invalid_response: '服务器未返回有效的 xDrive 版本信息，请检查反向代理。',
  server_auth_redirect: '服务器重定向了 API 请求，已停止连接；不会转发登录凭据。',
  server_canceled: '连接检查已取消。',
}
export class ConnectionRouteError extends Error {
  constructor(readonly code: string) { super(messages[code] || '服务器连接失败，请检查网络和地址。') }
}
const privateIPs = new BlockList()
for (const [ip, prefix] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) privateIPs.addSubnet(ip, prefix)
privateIPs.addSubnet('fc00::', 7, 'ipv6')
const nonPublic = new BlockList()
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['192.88.99.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) nonPublic.addSubnet(ip, prefix)
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6')
const reservedV6 = new BlockList(); reservedV6.addSubnet('2001:db8::', 32, 'ipv6')
for (const [ip, prefix] of [['2001::', 27], ['2001:20::', 28], ['2002::', 16], ['3fff::', 16]] as const) reservedV6.addSubnet(ip, prefix, 'ipv6')

export function publicConnectionIP(ip: string): boolean {
  const family = isIP(ip)
  return family === 4 ? !nonPublic.check(ip) : family === 6 && !ip.includes('.') && globalV6.check(ip, 'ipv6') && !reservedV6.check(ip, 'ipv6')
}
export function parseConnectionRoute(value: unknown): ConnectionRoute {
  if (value === undefined) return { mode: 'auto', lan_ip: '', public_ip: '' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectionRouteError('invalid_route')
  const raw = value as Partial<ConnectionRoute>
  const mode = raw.mode
  const lan = raw.lan_ip === undefined ? '' : raw.lan_ip; const wan = raw.public_ip === undefined ? '' : raw.public_ip
  if (typeof mode !== 'string' || !['auto', 'lan', 'public'].includes(mode) || typeof lan !== 'string' || typeof wan !== 'string' ||
      (lan !== '' && (!isIP(lan) || !privateIPs.check(lan, isIP(lan) === 6 ? 'ipv6' : 'ipv4'))) ||
      (wan !== '' && !publicConnectionIP(wan)) || (mode === 'lan' && !lan)) throw new ConnectionRouteError('invalid_route')
  return { mode, lan_ip: lan, public_ip: wan }
}
export function hasConnectionRoute(route: ConnectionRoute): boolean { return route.mode !== 'auto' || !!route.lan_ip || !!route.public_ip }
function origin(value: string): URL {
  let target: URL
  try { target = new URL(value) } catch { throw new ConnectionRouteError('invalid_server') }
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
      isIP(target.hostname.replace(/^\[|\]$/g, ''))) throw new ConnectionRouteError('invalid_server')
  return target
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new ConnectionRouteError('server_canceled') }
function safeFailure(error: unknown): ConnectionRouteError {
  if (error instanceof ConnectionRouteError) return error
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code || '') : ''
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return new ConnectionRouteError('server_tls_name')
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|EPROTO/.test(code)) return new ConnectionRouteError('server_tls_trust')
  if (code === 'ECONNREFUSED') return new ConnectionRouteError('server_refused')
  if (/TIMEDOUT/.test(code)) return new ConnectionRouteError('server_timeout')
  if (/ENOTFOUND|EAI_AGAIN|ENODATA/.test(code)) return new ConnectionRouteError('server_dns')
  return new ConnectionRouteError('server_network')
}
function lookupIP(ip: string) {
  return (_host: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    const family = isIP(ip)
    if (options.all) callback(null, [{ address: ip, family }]); else callback(null, ip, family)
  }
}

// Resolver.resolve* uses the configured DNS servers, not getaddrinfo/hosts.
async function resolvePublic(hostname: string, signal?: AbortSignal): Promise<string[]> {
  checkAbort(signal)
  const resolver = new Resolver({ timeout: 1500, tries: 1 })
  const cancel = () => resolver.cancel()
  const timer = setTimeout(cancel, 4000)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)])
    checkAbort(signal)
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : []).filter(publicConnectionIP).slice(0, 8)
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}

// Anonymous bounded identity probe. No cookies, Authorization, login body or redirects.
export async function probeConnectionIP(server: string, ip: string, signal?: AbortSignal): Promise<string> {
  const target = origin(server); checkAbort(signal)
  if (!isIP(ip)) throw new ConnectionRouteError('invalid_route')
  return new Promise((resolve, reject) => {
    let bytes = 0
    const chunks: Buffer[] = []
    const request = https.get({ hostname: target.hostname, port: target.port || 443, servername: target.hostname,
      path: '/api/v1/version', lookup: lookupIP(ip), agent: false, rejectUnauthorized: true,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' } }, response => {
      if (response.statusCode !== 200) { response.destroy(); reject(new ConnectionRouteError(response.statusCode && response.statusCode >= 300 && response.statusCode < 400 ? 'server_auth_redirect' : 'server_invalid_response')); return }
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 16384) request.destroy(new ConnectionRouteError('server_invalid_response')); else chunks.push(chunk)
      })
      response.on('error', error => reject(safeFailure(error)))
      response.on('end', () => {
        try {
          const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!data || typeof data !== 'object' || Array.isArray(data) || typeof (data as { version?: unknown }).version !== 'string' || !(data as { version: string }).version.trim()) throw new Error()
          resolve((data as { version: string }).version.trim().slice(0, 256))
        } catch { reject(new ConnectionRouteError('server_invalid_response')) }
      })
    })
    const abort = () => request.destroy(new ConnectionRouteError('server_canceled'))
    const timer = setTimeout(() => request.destroy(new ConnectionRouteError('server_timeout')), 3500)
    signal?.addEventListener('abort', abort, { once: true })
    request.on('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) })
    request.on('error', error => reject(safeFailure(error)))
    if (signal?.aborted) abort()
  })
}
type Selection = { ip: string; kind: 'lan' | 'public'; version: string }
type Dependencies = { resolvePublic: (hostname: string, signal?: AbortSignal) => Promise<string[]>; probe: (server: string, ip: string, signal?: AbortSignal) => Promise<string> }
export async function selectConnectionRoute(server: string, value: unknown, signal?: AbortSignal,
  dependencies: Dependencies = { resolvePublic, probe: probeConnectionIP }): Promise<Selection> {
  const target = origin(server); const route = parseConnectionRoute(value); checkAbort(signal)
  let last: ConnectionRouteError | undefined
  const attempt = async (ip: string, kind: Selection['kind']): Promise<Selection | null> => {
    checkAbort(signal)
    try {
      const version = await dependencies.probe(server, ip, signal); checkAbort(signal)
      return { ip, kind, version }
    } catch (error) {
      checkAbort(signal); last = safeFailure(error)
      if (!['server_refused', 'server_timeout', 'server_network', 'server_dns'].includes(last.code)) throw last
      return null
    }
  }
  if (route.mode !== 'public' && route.lan_ip) {
    const result = await attempt(route.lan_ip, 'lan'); if (result) return result
  }
  if (route.mode !== 'lan') {
    const ips = route.public_ip ? [route.public_ip] : await dependencies.resolvePublic(target.hostname, signal)
    checkAbort(signal)
    for (const ip of [...new Set(ips)].filter(publicConnectionIP).slice(0, 8)) {
      const result = await attempt(ip, 'public'); if (result) return result
    }
    if (!last) last = new ConnectionRouteError('server_dns')
  }
  throw last || new ConnectionRouteError('server_network')
}

/** Exact-origin signed preview only; no cookies/credentials or arbitrary request headers. */
export async function fetchWithConnectionIP(input: string, init: RequestInit, server: string, ip: string): Promise<Response> {
  const expected = origin(server)
  let target: URL
  try { target = new URL(input) } catch { throw new ConnectionRouteError('invalid_server') }
  const method = init.method?.toUpperCase() || 'GET'
  const headers = new Headers(init.headers)
  if (!isIP(ip) || target.origin !== expected.origin || target.username || target.password || target.hash ||
      !['GET', 'HEAD'].includes(method) || [...headers.keys()].some(key => key.toLowerCase() !== 'range')) throw new ConnectionRouteError('invalid_route')
  checkAbort(init.signal || undefined)
  return new Promise((resolve, reject) => {
    let settled = false
    const request = https.request({ hostname: target.hostname, port: target.port || 443, servername: target.hostname,
      path: target.pathname + target.search, lookup: lookupIP(ip), agent: false, rejectUnauthorized: true, method,
      ...(headers.has('range') ? { headers: { Range: headers.get('range')! } } : {}) }, incoming => {
      const status = incoming.statusCode || 0
      if (status < 200 || status > 599 || (status >= 300 && status < 400)) { incoming.destroy(); reject(new ConnectionRouteError('server_auth_redirect')); return }
      const outgoing = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') outgoing.set(key, value)
        else if (Array.isArray(value)) value.forEach(item => outgoing.append(key, item))
      }
      const body = method === 'HEAD' || status === 204 || status === 205 ? null : Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>
      settled = true
      resolve(new Response(body, { status, headers: outgoing }))
      if (!body) incoming.resume()
    })
    const abort = () => request.destroy(new ConnectionRouteError('server_canceled'))
    init.signal?.addEventListener('abort', abort, { once: true })
    request.on('close', () => init.signal?.removeEventListener('abort', abort))
    request.on('error', error => { if (!settled) reject(safeFailure(error)) })
    request.setTimeout(30000, () => request.destroy(new ConnectionRouteError('server_timeout')))
    request.end()
    if (init.signal?.aborted) abort()
  })
}
