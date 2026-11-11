'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { DesktopFilePreviewProxy } = require('../dist/main/file_preview_proxy.cjs')

test('slow video upstream streams initial Range bytes before complete response; next Viewer can release old ticket', async (t) => {
  let releaseRemainder
  const remainder = new Promise(resolve => { releaseRemainder = resolve })
  const seen = []
  const proxy = new DesktopFilePreviewProxy(
    async () => { throw new Error('Ticket provided explicitly in test') },
    async (_url, init) => {
      seen.push({
        method: init.method, range: init.headers?.Range,
        credentials: init.credentials, redirect: init.redirect,
      })
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([0, 1, 2, 3]))
          void remainder.then(() => {
            try {
              controller.enqueue(Uint8Array.from([4, 5, 6, 7]))
              controller.close()
            } catch { /* Old Viewer was cancelled; never retain its stream. */ }
          })
        },
      })
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes 0-7/16', 'Content-Length': '8',
        },
      })
    },
  )
  t.after(async () => { releaseRemainder(); await proxy.close() })
  const localURL = await proxy.createURLFromTicket({
    url: 'https://signed.example.test/large-video?ticket=secret',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    kind: 'video', mime_type: 'video/mp4',
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(localURL, {
      headers: { Range: 'bytes=0-7' }, signal: controller.signal,
    })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), 'bytes 0-7/16')
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.equal(first.done, false)
    assert.deepEqual([...first.value], [0, 1, 2, 3],
      'first bytes must arrive before a slow upstream completes')
    assert.deepEqual(seen, [{
      method: 'GET', range: 'bytes=0-7',
      credentials: 'omit', redirect: 'error',
    }])
    releaseRemainder()
    const second = await reader.read()
    assert.equal(second.done, false)
    assert.deepEqual([...second.value], [4, 5, 6, 7])
    assert.equal((await reader.read()).done, true)
    assert.equal(proxy.releaseURL(localURL), true)
    assert.equal((await fetch(localURL, { headers: { Range: 'bytes=0-7' } })).status, 410,
      'released Viewer stream must not be available to the next media session')
  } finally {
    clearTimeout(timeout)
    controller.abort()
    releaseRemainder()
  }
})
