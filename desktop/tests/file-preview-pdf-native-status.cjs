const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { DesktopFilePreviewProxy } = require('../dist/main/file_preview_proxy.cjs')

function ticket(url, kind = 'pdf') {
  return {
    url,
    expires_at: new Date(Date.now() + 90_000).toISOString(),
    kind,
    mime_type: kind === 'pdf' ? 'application/pdf' : 'video/mp4',
  }
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

test('Desktop PDF signed upstream status/MIME is checked before a private token can exist', async (t) => {
  const upstream = http.createServer((req, res) => {
    const id = Number(new URL(req.url, 'http://localhost').pathname.split('/').at(-1))
    res.statusCode = id === 401 ? 401 : id === 404 ? 404 : id === 410 ? 410 : 200
    res.setHeader('Content-Type', id === 200 ? 'text/html; charset=utf-8' : 'application/pdf')
    res.end('<html>Not a valid PDF</html>')
  })
  const base = await listen(upstream)
  t.after(() => new Promise(resolve => upstream.close(resolve)))
  const observations = []
  const proxy = new DesktopFilePreviewProxy(
    async id => ticket(`${base}/document/${id}?ticket=TOP_SECRET_TOKEN`),
    (url, init) => {
      observations.push({ url, method: init.method, credentials: init.credentials,
        redirect: init.redirect, cache: init.cache, referrerPolicy: init.referrerPolicy })
      return fetch(url, init)
    },
  )
  t.after(() => proxy.close())

  for (const id of [401, 404, 410, 200]) {
    await assert.rejects(() => proxy.createURL(id), (error) => {
      assert.equal(String(error).includes('TOP_SECRET_TOKEN'), false,
        'native exception must never disclose a signed upstream token')
      return /unavailable|invalid content/.test(error.message)
    })
  }
  assert.equal(observations.length, 4)
  assert.ok(observations.every(x => x.method === 'HEAD' && x.redirect === 'error' &&
    x.cache === 'no-store' && x.credentials === 'omit' && x.referrerPolicy === 'no-referrer'))
  assert.equal(proxy.tickets.size, 0, 'invalid upstream stream must never mint a local token')
})

test('Desktop PDF valid HEAD allows later local Range read but never exposes signed upstream URL', async (t) => {
  const bytes = Buffer.from('%PDF-1.7\nabcdefghijklmnop')
  const seenMethods = []
  const upstream = http.createServer((req, res) => {
    seenMethods.push({ method: req.method, range: req.headers.range })
    res.setHeader('Content-Type', 'application/pdf')
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': String(bytes.length) }).end()
      return
    }
    if (req.headers.range === 'bytes=0-3') {
      res.writeHead(206, {
        'Content-Range': `bytes 0-3/${bytes.length}`,
        'Content-Length': '4',
      })
      res.end(bytes.subarray(0, 4))
      return
    }
    res.writeHead(200, { 'Content-Length': String(bytes.length) }).end(bytes)
  })
  const base = await listen(upstream)
  t.after(() => new Promise(resolve => upstream.close(resolve)))
  const proxy = new DesktopFilePreviewProxy(
    async () => ticket(`${base}/file.pdf?ticket=SENSITIVE_TOKEN`),
    (url, init) => fetch(url, init),
  )
  t.after(() => proxy.close())
  const localURL = await proxy.createURL(101)
  assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/preview\/[a-f0-9]{64}$/.test(localURL))
  assert.equal(localURL.includes('SENSITIVE_TOKEN'), false)
  assert.equal(seenMethods.length, 1)
  assert.deepEqual(seenMethods[0], { method: 'HEAD', range: undefined })
  const response = await fetch(localURL, { headers: { Range: 'bytes=0-3' } })
  assert.equal(response.status, 206)
  assert.equal(await response.text(), '%PDF')
  assert.deepEqual(seenMethods[1], { method: 'GET', range: 'bytes=0-3' })
  assert.equal(proxy.releaseURL(localURL), true)
  assert.equal((await fetch(localURL)).status, 410)
})

test('Desktop PDF aborted HEAD cannot mint or leak local proxy ticket', async (t) => {
  const controller = new AbortController()
  let onHead
  const pending = new Promise(resolve => { onHead = resolve })
  const seen = []
  const proxy = new DesktopFilePreviewProxy(
    async () => ticket('https://drive.example/api/v1/file-preview/22?ticket=SECRET'),
    (url, init) => {
      seen.push({ url, init })
      return pending
    },
  )
  t.after(() => proxy.close())
  const issued = proxy.createURL(22, controller.signal)
  // Allow asynchronous ticket resolution to reach the HEAD request.
  while (seen.length === 0) await Promise.resolve()
  assert.equal(seen[0].init.method, 'HEAD')
  assert.equal(seen[0].init.signal, controller.signal)
  controller.abort()
  onHead(new Response(null, { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
  await assert.rejects(() => issued, /abort|cancel/i)
  assert.equal(proxy.tickets.size, 0)
})

test('Desktop PDF abort during Agent ticket fetch forbids even HEAD admission', async (t) => {
  const controller = new AbortController()
  let resolveTicket
  const pendingTicket = new Promise(resolve => { resolveTicket = resolve })
  const seen = []
  const proxy = new DesktopFilePreviewProxy(
    async (_id, signal) => {
      assert.equal(signal, controller.signal)
      return pendingTicket
    },
    (...args) => { seen.push(args); throw new Error('HEAD should not run') },
  )
  t.after(() => proxy.close())
  const pending = proxy.createURL(23, controller.signal)
  controller.abort()
  resolveTicket(ticket('https://drive.example/api/v1/file-preview/23?ticket=SECRET'))
  await assert.rejects(() => pending, /abort|cancel/i)
  assert.deepEqual(seen, [])
  assert.equal(proxy.tickets.size, 0)
})

test('Native image/video/audio previews do not trigger the PDF HEAD verification path', async (t) => {
  for (const kind of ['image', 'video', 'audio']) {
    const hits = []
    const proxy = new DesktopFilePreviewProxy(
      async () => ticket(`https://drive.example/${kind}?ticket=SENSITIVE`, kind),
      (url, init) => { hits.push({ url, init }); throw new Error('Unexpected HEAD') },
    )
    t.after(() => proxy.close())
    const url = await proxy.createURL(101)
    assert.ok(url.startsWith('http://127.0.0.1:'))
    assert.equal(hits.length, 0, 'non-PDF tickets must retain existing lazy renderer loading')
    assert.equal(proxy.releaseURL(url), true)
  }
})
