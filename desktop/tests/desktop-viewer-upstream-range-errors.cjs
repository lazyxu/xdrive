'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { DesktopFilePreviewProxy } = require('../dist/main/file_preview_proxy.cjs')

function ticket(kind = 'video') {
  return {
    url: 'https://signed.example.test/api/media?ticket=private-server-token',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    kind,
    mime_type: kind === 'pdf' ? 'application/pdf' : 'video/mp4',
  }
}

test('PDF HEAD admission cannot turn a later expired GET or HTML into a Viewer document', async (t) => {
  let mode = 'unauthorized'
  const proxy = new DesktopFilePreviewProxy(
    async () => ticket('pdf'),
    async (_url, init) => {
      if (init.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
      }
      assert.equal(init.credentials, 'omit')
      assert.equal(init.redirect, 'error')
      if (mode === 'unauthorized') {
        return new Response('<html>private-server-token login</html>', {
          status: 401, headers: { 'Content-Type': 'text/html' },
        })
      }
      if (mode === 'html') {
        return new Response('<html>private-server-token</html>', {
          status: 200, headers: { 'Content-Type': 'text/html' },
        })
      }
      return new Response('%PDF-1.7\nvalid', {
        status: 200, headers: { 'Content-Type': 'application/pdf' },
      })
    },
  )
  t.after(() => proxy.close())
  const localURL = await proxy.createURL(17)
  assert.equal(localURL.includes('private-server-token'), false)
  for (mode of ['unauthorized', 'html']) {
    const response = await fetch(localURL)
    assert.equal(response.status, 502, mode)
    assert.equal(response.headers.get('content-type'), null, 'no HTML response envelope')
    assert.equal(await response.text(), '', 'signed URL error bytes must not enter the PDF iframe')
  }
  mode = 'valid'
  const good = await fetch(localURL)
  assert.equal(good.status, 200)
  assert.equal(await good.text(), '%PDF-1.7\nvalid')
})

test('Chromium video seeks reject invalid 206 envelopes while preserving a valid 416 retry', async (t) => {
  let mode = 'wrong-offset'
  const rangeSeen = []
  const progress = []
  const proxy = new DesktopFilePreviewProxy(
    async () => ticket(),
    async (_url, init) => {
      rangeSeen.push(init.headers?.Range)
      assert.equal(init.credentials, 'omit')
      const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' }
      if (mode === 'wrong-offset') {
        return new Response('4567', { status: 206, headers: {
          ...headers, 'Content-Range': 'bytes 4-7/16', 'Content-Length': '4',
        } })
      }
      if (mode === 'missing-content-range') {
        return new Response('0123', { status: 206, headers })
      }
      if (mode === 'impossible-total') {
        return new Response('0123', { status: 206, headers: {
          ...headers, 'Content-Range': 'bytes 0-3/3',
        } })
      }
      if (mode === 'wrong-length') {
        return new Response('0123', { status: 206, headers: {
          ...headers, 'Content-Range': 'bytes 0-3/16', 'Content-Length': '5',
        } })
      }
      if (mode === 'expired') {
        return new Response('<html>private-server-token</html>', {
          status: 403, headers: { 'Content-Type': 'text/html' },
        })
      }
      if (mode === 'encoded') {
        return new Response('compressed-bytes', { status: 200, headers: {
          ...headers, 'Content-Encoding': 'gzip',
        } })
      }
      if (mode === 'html-success') {
        return new Response('<html>login</html>', {
          status: 200, headers: { 'Content-Type': 'text/html' },
        })
      }
      if (mode === 'json-partial') {
        return new Response('0123', { status: 206, headers: {
          'Content-Type': 'application/problem+json',
          'Content-Range': 'bytes 0-3/16', 'Content-Length': '4',
        } })
      }
      if (mode === 'unsatisfiable') {
        return new Response('{"ticket":"private-server-token"}', {
          status: 416, headers: {
            'Content-Type': 'application/json', 'Content-Range': 'bytes */16',
            'Content-Length': '33',
          },
        })
      }
      return new Response('0123', { status: 206, headers: {
        ...headers, 'Content-Range': 'bytes 0-3/16', 'Content-Length': '4',
      } })
    },
  )
  t.after(() => proxy.close())
  const localURL = await proxy.createURLFromTicket(ticket(), (loaded, total) => {
    progress.push([loaded, total])
  })
  const seek = () => fetch(localURL, { headers: { Range: 'bytes=0-3' } })
  for (mode of ['wrong-offset', 'missing-content-range', 'impossible-total',
    'wrong-length', 'expired', 'encoded', 'html-success', 'json-partial']) {
    const response = await seek()
    assert.equal(response.status, 502, mode)
    assert.equal(await response.text(), '', mode + ' must not relay stale/invalid bytes')
  }
  assert.deepEqual(progress, [], 'invalid upstream responses must not inflate Viewer loading receipts')

  mode = 'unsatisfiable'
  const unsatisfiable = await seek()
  assert.equal(unsatisfiable.status, 416)
  assert.equal(unsatisfiable.headers.get('content-range'), 'bytes */16')
  assert.equal(unsatisfiable.headers.get('content-length'), '0')
  assert.equal(await unsatisfiable.text(), '', 'never relay signed 416 JSON bodies')
  mode = 'valid'
  const good = await seek()
  assert.equal(good.status, 206)
  assert.equal(good.headers.get('content-range'), 'bytes 0-3/16')
  assert.equal(await good.text(), '0123')
  assert.deepEqual(progress.at(-1), [4, 16])
  assert.ok(rangeSeen.every(range => range === 'bytes=0-3'))
  assert.equal(proxy.releaseURL(localURL), true)
  assert.equal((await seek()).status, 410)
})
