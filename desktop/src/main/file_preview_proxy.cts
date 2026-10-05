import { randomBytes } from 'node:crypto'
import http = require('node:http')
import { once } from 'node:events'

export type DesktopFilePreviewTicket = {
  url: string
  expires_at: string
  kind: 'image' | 'video' | 'audio' | 'pdf'
  mime_type: string
}

export type DesktopFilePreviewFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>

type LocalPreviewTicket = {
  upstreamURL: string
  expiresAt: number
}

const localPreviewPathPrefix = '/preview/'
const localPreviewTokenPattern = /^[0-9a-f]{64}$/
const previewResponseHeaders = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
] as const

function isLoopbackAddress(address?: string | null) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function validateUpstreamTicket(ticket: DesktopFilePreviewTicket) {
  if (!ticket || !['image', 'video', 'audio', 'pdf'].includes(ticket.kind)) {
    throw new Error('Invalid file preview ticket kind.')
  }
  const expiresAt = Date.parse(ticket.expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('File preview ticket is expired.')
  }
  const url = new URL(ticket.url)
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('Invalid file preview ticket URL.')
  }
  return { url: url.toString(), expiresAt }
}

export class DesktopFilePreviewProxy {
  private server: http.Server | null = null
  private baseURL = ''
  private readonly tickets = new Map<string, LocalPreviewTicket>()

  constructor(
    private readonly loadTicket: (nodeID: number) => Promise<DesktopFilePreviewTicket>,
    private readonly fetcher: DesktopFilePreviewFetcher,
  ) {}

  async start() {
    if (this.server) return
    const server = http.createServer((req, res) => {
      void this.handle(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('File preview proxy did not receive an IPv4 listener address.')
    }
    this.server = server
    this.baseURL = `http://127.0.0.1:${address.port}`
  }

  async createURL(nodeID: number) {
    if (!Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new Error('File preview node id is required.')
    }
    await this.start()
    const ticket = validateUpstreamTicket(await this.loadTicket(nodeID))
    this.purgeExpiredTickets()
    const localToken = randomBytes(32).toString('hex')
    this.tickets.set(localToken, {
      upstreamURL: ticket.url,
      expiresAt: ticket.expiresAt,
    })
    return `${this.baseURL}${localPreviewPathPrefix}${localToken}`
  }

  async close() {
    const server = this.server
    this.server = null
    this.baseURL = ''
    this.tickets.clear()
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private purgeExpiredTickets() {
    const now = Date.now()
    for (const [token, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(token)
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        res.writeHead(403).end()
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD')
        res.writeHead(405).end()
        return
      }
      const parsed = new URL(req.url || '/', this.baseURL || 'http://127.0.0.1')
      if (!parsed.pathname.startsWith(localPreviewPathPrefix) || parsed.search || parsed.hash) {
        res.writeHead(404).end()
        return
      }
      const token = parsed.pathname.slice(localPreviewPathPrefix.length)
      if (!localPreviewTokenPattern.test(token)) {
        res.writeHead(404).end()
        return
      }
      const ticket = this.tickets.get(token)
      if (!ticket || ticket.expiresAt <= Date.now()) {
        this.tickets.delete(token)
        res.writeHead(410).end()
        return
      }

      const controller = new AbortController()
      res.once('close', () => controller.abort())
      const upstream = await this.fetcher(ticket.upstreamURL, {
        method: req.method,
        headers: req.headers.range ? { Range: req.headers.range } : undefined,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })

      for (const name of previewResponseHeaders) {
        const value = upstream.headers.get(name)
        if (value) res.setHeader(name, value)
      }
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      res.statusCode = upstream.status

      if (req.method === 'HEAD' || !upstream.body) {
        res.end()
        return
      }
      const reader = upstream.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!res.write(Buffer.from(value))) await once(res, 'drain')
      }
      res.end()
    } catch (error) {
      if (!res.headersSent) {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.writeHead(502)
      }
      res.end()
    }
  }
}
