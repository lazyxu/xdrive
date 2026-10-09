const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { DesktopFilePreviewProxy } = require('../dist/main/file_preview_proxy.cjs')

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  return `http://127.0.0.1:${address.port}`
}

test('file preview proxy hides upstream ticket and preserves Range responses', async (t) => {
  const payload = Buffer.from('%PDF-1.7\n0123456789abcdef')
  let seenRange = ''
  const upstream = http.createServer((req, res) => {
    seenRange = req.headers.range || ''
    if (seenRange === 'bytes=0-3') {
      res.statusCode = 206
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Range', `bytes 0-3/${payload.length}`)
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Content-Length', '4')
      res.end(payload.subarray(0, 4))
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Length', String(payload.length))
    res.end(payload)
  })
  const upstreamBase = await listen(upstream)
  t.after(() => new Promise((resolve) => upstream.close(resolve)))

  const proxy = new DesktopFilePreviewProxy(
    async () => ({
      url: `${upstreamBase}/file.pdf?ticket=signed-upstream-secret`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      kind: 'pdf',
      mime_type: 'application/pdf',
    }),
    (input, init) => fetch(input, init),
  )
  t.after(() => proxy.close())

  const localURL = await proxy.createURL(31)
  const parsed = new URL(localURL)
  assert.equal(parsed.hostname, '127.0.0.1')
  assert.equal(parsed.pathname.startsWith('/preview/'), true)
  assert.equal(localURL.includes('signed-upstream-secret'), false)

  const response = await fetch(localURL, { headers: { Range: 'bytes=0-3' } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.equal(response.headers.get('content-range'), `bytes 0-3/${payload.length}`)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  const exposed = (response.headers.get('access-control-expose-headers') || '').toLowerCase()
  for (const header of ['content-range', 'content-length', 'accept-ranges', 'etag',
    'last-modified', 'cache-control', 'x-content-type-options']) {
    assert.ok(exposed.split(',').map(value => value.trim()).includes(header),
      'Renderer must see signed Range/progress response header: ' + header)
  }
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin')
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '%PDF')
  assert.equal(seenRange, 'bytes=0-3')
})

test('file preview proxy rejects already expired upstream tickets', async (t) => {
  const proxy = new DesktopFilePreviewProxy(
    async () => ({
      url: 'https://drive.example/api/v1/file-preview/31?ticket=expired',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      kind: 'pdf',
      mime_type: 'application/pdf',
    }),
    (input, init) => fetch(input, init),
  )
  t.after(() => proxy.close())
  await assert.rejects(() => proxy.createURL(31), /expired/)
})


test('file preview proxy reports unique Range coverage and releases streamed tickets', async (t) => {
  const payload = Buffer.from('0123456789abcdef')
  const upstream = http.createServer((req, res) => {
    const raw = req.headers.range || ''
    const match = /^bytes=(\d+)-(\d+)$/.exec(raw)
    if (!match) {
      res.statusCode = 416
      res.end()
      return
    }
    const start = Number(match[1])
    const end = Math.min(payload.length - 1, Number(match[2]))
    res.statusCode = 206
    res.setHeader('Content-Type', 'video/quicktime')
    res.setHeader('Content-Range', `bytes ${start}-${end}/${payload.length}`)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Length', String(end - start + 1))
    res.end(payload.subarray(start, end + 1))
  })
  const upstreamBase = await listen(upstream)
  t.after(() => new Promise((resolve) => upstream.close(resolve)))

  const progress = []
  const proxy = new DesktopFilePreviewProxy(
    async () => {
      throw new Error('default preview ticket loader must not be used')
    },
    (input, init) => fetch(input, init),
  )
  t.after(() => proxy.close())

  const localURL = await proxy.createURLFromTicket({
    url: `${upstreamBase}/motion.mov?ticket=motion-secret`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    kind: 'video',
    mime_type: 'video/quicktime',
  }, (loaded, total) => progress.push([loaded, total]))

  let response = await fetch(localURL, { headers: { Range: 'bytes=0-7' } })
  assert.equal(response.status, 206)
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '01234567')

  response = await fetch(localURL, { headers: { Range: 'bytes=4-11' } })
  assert.equal(response.status, 206)
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '456789ab')

  assert.deepEqual(progress.at(-1), [12, payload.length])
  assert.equal(proxy.releaseURL(localURL), true)
  response = await fetch(localURL)
  assert.equal(response.status, 410)
})
