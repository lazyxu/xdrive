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

export type DesktopFilePreviewProgressHandler = (
  loadedBytes: number,
  totalBytes?: number,
) => void

type ByteRange = {
  start: number
  end: number
}

type LocalPreviewTicket = {
  upstreamURL: string
  expiresAt: number
  onProgress?: DesktopFilePreviewProgressHandler
  coveredRanges: ByteRange[]
  loadedBytes: number
  totalBytes?: number
  lastProgressAt: number
  controllers: Set<AbortController>
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

function mergeByteRanges(ranges: ByteRange[]) {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
  const merged: ByteRange[] = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (!previous || range.start > previous.end) {
      merged.push({ ...range })
      continue
    }
    if (range.end > previous.end) previous.end = range.end
  }
  return merged
}

function coveredByteCount(ranges: readonly ByteRange[]) {
  return ranges.reduce((total, range) => total + (range.end - range.start), 0)
}

function responseByteRange(response: Response) {
  const raw = response.headers.get('content-range') || ''
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(raw.trim())
  if (match) {
    const start = Number(match[1])
    const endInclusive = Number(match[2])
    const total = match[3] === '*' ? undefined : Number(match[3])
    if (
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(endInclusive) &&
      start >= 0 &&
      endInclusive >= start
    ) {
      return {
        start,
        total: Number.isSafeInteger(total) && (total ?? 0) > 0 ? total : undefined,
      }
    }
  }
  if (response.status === 200) {
    const total = Number(response.headers.get('content-length') || '')
    return {
      start: 0,
      total: Number.isSafeInteger(total) && total > 0 ? total : undefined,
    }
  }
  return { start: undefined, total: undefined }
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
    return this.createURLFromTicket(await this.loadTicket(nodeID))
  }

  async createURLFromTicket(
    upstreamTicket: DesktopFilePreviewTicket,
    onProgress?: DesktopFilePreviewProgressHandler,
  ) {
    await this.start()
    const ticket = validateUpstreamTicket(upstreamTicket)
    this.purgeExpiredTickets()
    const localToken = randomBytes(32).toString('hex')
    this.tickets.set(localToken, {
      upstreamURL: ticket.url,
      expiresAt: ticket.expiresAt,
      onProgress,
      coveredRanges: [],
      loadedBytes: 0,
      lastProgressAt: 0,
      controllers: new Set(),
    })
    return `${this.baseURL}${localPreviewPathPrefix}${localToken}`
  }

  releaseURL(value: string) {
    if (!this.baseURL) return false
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return false
    }
    if (
      parsed.origin !== this.baseURL ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.startsWith(localPreviewPathPrefix)
    ) return false
    const token = parsed.pathname.slice(localPreviewPathPrefix.length)
    if (!localPreviewTokenPattern.test(token)) return false
    const ticket = this.tickets.get(token)
    if (!ticket) return false
    this.tickets.delete(token)
    for (const controller of ticket.controllers) controller.abort()
    ticket.controllers.clear()
    return true
  }

  async close() {
    const server = this.server
    this.server = null
    this.baseURL = ''
    for (const ticket of this.tickets.values()) {
      for (const controller of ticket.controllers) controller.abort()
      ticket.controllers.clear()
    }
    this.tickets.clear()
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private purgeExpiredTickets() {
    const now = Date.now()
    for (const [token, ticket] of this.tickets) {
      if (ticket.expiresAt > now) continue
      this.tickets.delete(token)
      for (const controller of ticket.controllers) controller.abort()
      ticket.controllers.clear()
    }
  }

  private emitProgress(ticket: LocalPreviewTicket, force = false) {
    if (!ticket.onProgress) return
    const now = Date.now()
    if (
      !force &&
      now - ticket.lastProgressAt < 100 &&
      !(ticket.totalBytes && ticket.loadedBytes >= ticket.totalBytes)
    ) return
    ticket.lastProgressAt = now
    ticket.onProgress(ticket.loadedBytes, ticket.totalBytes)
  }

  private noteRange(
    ticket: LocalPreviewTicket,
    start: number,
    end: number,
    totalBytes?: number,
  ) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start
    ) return
    if (totalBytes && totalBytes > 0) ticket.totalBytes = totalBytes
    ticket.coveredRanges = mergeByteRanges([
      ...ticket.coveredRanges,
      { start, end },
    ])
    ticket.loadedBytes = coveredByteCount(ticket.coveredRanges)
    if (ticket.totalBytes && ticket.loadedBytes > ticket.totalBytes) {
      ticket.loadedBytes = ticket.totalBytes
    }
    this.emitProgress(ticket)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    let activeTicket: LocalPreviewTicket | undefined
    let activeController: AbortController | undefined
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
      activeTicket = ticket
      activeController = controller
      ticket.controllers.add(controller)
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
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      res.statusCode = upstream.status

      if (req.method === 'HEAD' || !upstream.body) {
        res.end()
        return
      }
      const range = responseByteRange(upstream)
      if (range.total) ticket.totalBytes = range.total
      this.emitProgress(ticket, true)
      const reader = upstream.body.getReader()
      let responseOffset = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.byteLength) continue
        if (range.start !== undefined) {
          this.noteRange(
            ticket,
            range.start + responseOffset,
            range.start + responseOffset + value.byteLength,
            range.total,
          )
        }
        responseOffset += value.byteLength
        if (!res.write(Buffer.from(value))) await once(res, 'drain')
      }
      this.emitProgress(ticket, true)
      res.end()
    } catch (error) {
      if (!res.headersSent) {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.writeHead(502)
      }
      res.end()
    } finally {
      if (activeTicket && activeController) {
        activeTicket.controllers.delete(activeController)
      }
    }
  }
}
