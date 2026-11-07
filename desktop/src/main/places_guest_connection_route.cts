import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { BlockList, createConnection, isIP, type Socket } from 'node:net'
import { publicConnectionIP } from './connection_route.cjs'

// Chromium still owns the certificate chain, SAN/SNI, Same-Origin Cookie and
// browser authorization. The local tunnel forwards opaque TLS bytes ONLY to
// the exact selected Agent IP. It cannot serve HTTP, change HTTPS origins,
// read Cookies, resolve alternate hosts, or act as an arbitrary web proxy.
export type DesktopPlacesPinnedRoute = {
  origin: string
  selectedIP: string
  proxyDirective: string
  pacURL: string
  isActive: () => boolean
  close: () => void
}

const privateIPs = new BlockList()
for (const [cidr, bits] of [
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
] as const) privateIPs.addSubnet(cidr, bits)
privateIPs.addSubnet('fc00::', 7, 'ipv6')

export function desktopPlacesSelectedRoute(
  server: unknown, selectedIP: unknown,
): { origin: string; hostname: string; port: number; authority: string; ip: string } | null {
  if (typeof server !== 'string' || typeof selectedIP !== 'string' ||
    selectedIP.length > 45 || !selectedIP || !isIP(selectedIP)) return null
  const family = isIP(selectedIP)
  if (!privateIPs.check(selectedIP, family === 6 ? 'ipv6' : 'ipv4') &&
    !publicConnectionIP(selectedIP)) return null
  try {
    const target = new URL(server)
    if (target.protocol !== 'https:' || target.username || target.password ||
      target.search || target.hash || (target.pathname !== '/' && target.pathname !== '') ||
      isIP(target.hostname) || target.hostname.length > 253 ||
      !target.hostname.includes('.') || target.hostname.endsWith('.') ||
      !/^[a-z0-9.-]+$/.test(target.hostname)) return null
    const port = target.port ? Number(target.port) : 443
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    return { origin: target.origin, hostname: target.hostname, port,
      authority: target.hostname + ':' + port, ip: selectedIP }
  } catch { return null }
}

function loopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' ||
    address === '::ffff:127.0.0.1'
}

export async function createDesktopPlacesPinnedRoute(
  server: string, selectedIP: string, stillAuthorized: () => boolean,
): Promise<DesktopPlacesPinnedRoute> {
  const target = desktopPlacesSelectedRoute(server, selectedIP)
  if (!target || !stillAuthorized()) throw new Error('untrusted Desktop Places route')
  const token = randomUUID()
  const sockets = new Set<Socket>()
  let closed = false
  const active = () => !closed && stillAuthorized()

  const serverSocket = createServer((req, response) => {
    if (!active() || !loopback(req.socket.remoteAddress) ||
      req.method !== 'GET' || req.url !== '/' + token + '.pac' ||
      req.headers.cookie || req.headers.authorization) {
      response.writeHead(403, { 'Cache-Control': 'no-store' })
      response.end()
      return
    }
    const directive = 'PROXY 127.0.0.1:' + (serverSocket.address() &&
      typeof serverSocket.address() === 'object'
      ? (serverSocket.address() as { port: number }).port : 0)
    // Use BOTH URL origin and canonical hostname: non-Server HTTPS provider
    // requests remain DIRECT, with their usual Chromium CA/SAN checking.
    const pac = 'function FindProxyForURL(url,host){' +
      'if(host===' + JSON.stringify(target.hostname) +
      ' && url.indexOf(' + JSON.stringify(target.origin + '/') + ')===0)' +
      'return ' + JSON.stringify(directive) + ';return "DIRECT";}'
    response.writeHead(200, {
      'Content-Type': 'application/x-ns-proxy-autoconfig',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': Buffer.byteLength(pac),
    })
    response.end(pac)
  })

  serverSocket.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  serverSocket.on('connect', (request, downstream, head) => {
    if (!active() || !loopback((downstream as Socket).remoteAddress) ||
      request.url !== target.authority || request.headers.cookie ||
      request.headers.authorization || request.headers['proxy-authorization'] ||
      head.length > 16384) {
      downstream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    // Never DNS-resolve the Server domain here. Chromium sends the ORIGINAL
    // domain SNI and verifies the ORIGINAL domain certificate end-to-end.
    const upstream = createConnection({ host: target.ip, port: target.port })
    sockets.add(upstream)
    upstream.once('close', () => sockets.delete(upstream))
    upstream.setTimeout(7000, () => upstream.destroy())
    upstream.once('error', () => downstream.destroy())
    downstream.once('error', () => upstream.destroy())
    upstream.once('connect', () => {
      if (!active()) { upstream.destroy(); downstream.destroy(); return }
      upstream.setTimeout(0)
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(downstream)
      downstream.pipe(upstream)
    })
    downstream.once('close', () => upstream.destroy())
    upstream.once('close', () => downstream.destroy())
  })

  const close = () => {
    if (closed) return
    closed = true
    for (const socket of sockets) socket.destroy()
    serverSocket.close()
  }

  try {
    await new Promise<void>((resolve, reject) => {
      serverSocket.once('error', reject)
      serverSocket.listen(0, '127.0.0.1', () => {
        serverSocket.off('error', reject)
        resolve()
      })
    })
    if (!active()) throw new Error('Desktop Places route identity changed')
    const address = serverSocket.address()
    if (!address || typeof address === 'string') throw new Error('invalid loopback route')
    const port = address.port
    const proxyDirective = 'PROXY 127.0.0.1:' + port
    return { origin: target.origin, selectedIP: target.ip,
      proxyDirective, pacURL: 'http://127.0.0.1:' + port + '/' + token + '.pac',
      isActive: active, close }
  } catch (error) {
    close()
    throw error
  }
}
