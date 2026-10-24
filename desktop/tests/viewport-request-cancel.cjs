const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { EventEmitter } = require('node:events')
const { performance } = require('node:perf_hooks')

const { DesktopViewportRequests } = require('../dist/main/viewport_requests.cjs')
const { AgentIPCClient } = require('../dist/main/agent_client.cjs')

async function until(predicate, timeoutMs = 2_000) {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('timeout waiting for request event')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

class WindowSender extends EventEmitter {
  constructor(id) { super(); this.id = id }
}

async function withSlowAgent(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xdrive-viewport-context-'))
  const events = { started: 0, aborted: 0, bytes: 0 }
  const server = http.createServer((_req, response) => {
    events.started++
    const timer = setTimeout(() => {
      events.bytes += 8192
      response.end(Buffer.alloc(8192))
    }, 500)
    response.on('close', () => {
      clearTimeout(timer)
      if (!response.writableEnded) events.aborted++
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const discovery = path.join(dir, 'discovery.json')
    await fs.writeFile(discovery, JSON.stringify({
      version: 1,
      base_url: 'http://127.0.0.1:' + server.address().port + '/',
      token: 'a'.repeat(64),
      pid: process.pid,
    }))
    await run({ events, client: new AgentIPCClient(discovery) })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dir, { recursive: true, force: true })
  }
}

test('Desktop viewport cancel reaches an in-flight Agent HTTP thumbnail GET and stops its bytes', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const sender = new WindowSender(123)
    const pending = mgr.run(sender, 'thumbnail-1', (signal) => client.mediaThumbnail(1, signal))
    await until(() => events.started === 1)
    mgr.cancel(sender, 'thumbnail-1')
    await assert.rejects(pending, /cancel/i)
    await until(() => events.aborted === 1, 160)
    assert.equal(events.bytes, 0)
  })
})

test('Desktop viewport cancel reaches an in-flight Agent HTTP 100k range GET', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const sender = new WindowSender(124)
    const pending = mgr.run(sender, 'range-1', (signal) =>
      client.cloudChildrenRange(1, 50000, 200, 'name', 'asc', false, undefined, signal))
    await until(() => events.started === 1)
    mgr.cancel(sender, 'range-1')
    await assert.rejects(pending, /cancel/i)
    await until(() => events.aborted === 1, 160)
    assert.equal(events.bytes, 0)
  })
})

test('Desktop Gallery 100k media range abort reaches Agent HTTP transport', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const sender = new WindowSender(125)
    const pending = mgr.run(sender, 'gallery-media-range-1', (signal) =>
      client.mediaItemRange('', 200, 50000, {}, signal))
    await until(() => events.started === 1)
    mgr.cancel(sender, 'gallery-media-range-1')
    await assert.rejects(pending, /cancel|abort/i)
    await until(() => events.aborted === 1, 160)
    assert.equal(events.bytes, 0)
  })
})

test('Desktop request IDs belong to their sender and survive pre-admission cancellation', async () => {
  const mgr = new DesktopViewportRequests()
  const one = new WindowSender(1)
  const two = new WindowSender(2)
  let resolveBlocked
  const blocked = new Promise((resolve) => { resolveBlocked = resolve })
  let firstSignal
  let secondSignal
  const first = mgr.run(one, 'same-id', async (signal) => { firstSignal = signal; return blocked })
  const second = mgr.run(two, 'same-id', async (signal) => { secondSignal = signal; return blocked })
  assert.equal(firstSignal?.aborted, false)
  assert.equal(secondSignal?.aborted, false)
  mgr.cancel(one, 'same-id')
  assert.equal(firstSignal?.aborted, true)
  assert.equal(secondSignal?.aborted, false)
  two.emit('destroyed')
  assert.equal(secondSignal?.aborted, true)
  resolveBlocked('completed')
  await assert.rejects(first, /cancel/i)
  await assert.rejects(second, /cancel/i)

  mgr.cancel(one, 'before-start')
  let executed = false
  await assert.rejects(mgr.run(one, 'before-start', async () => { executed = true }), /before admission/i)
  assert.equal(executed, false)
})


test('Desktop text preview cancels genuine slow Agent HTTP bytes on navigation', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const sender = new WindowSender(161)
    const pending = mgr.run(sender, 'text-preview-cancel-161', signal =>
      client.cloudFileTextPreview(71, signal))
    await until(() => events.started === 1)
    mgr.cancel(sender, 'text-preview-cancel-161')
    await assert.rejects(pending, /cancel|abort/i)
    await until(() => events.aborted === 1, 160)
    assert.equal(events.bytes, 0, 'cancelled preview must not consume 1 MiB of old text')
  })
})

test('Desktop text preview survives cross-window ID collisions and aborts on window destruction', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const first = new WindowSender(162)
    const second = new WindowSender(163)
    const a = mgr.run(first, 'shared-text-id', signal => client.cloudFileTextPreview(71, signal))
    const b = mgr.run(second, 'shared-text-id', signal => client.cloudFileTextPreview(72, signal))
    await until(() => events.started === 2)
    mgr.cancel(first, 'shared-text-id')
    await assert.rejects(a, /cancel|abort/i)
    await until(() => events.aborted === 1, 160)
    second.emit('destroyed')
    await assert.rejects(b, /cancel|abort/i)
    await until(() => events.aborted === 2, 160)
    assert.equal(events.bytes, 0)
  })
})

test('Desktop text preview cancel-before-admission avoids an Agent HTTP read', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const sender = new WindowSender(164)
    mgr.cancel(sender, 'future-text-read')
    await assert.rejects(mgr.run(sender, 'future-text-read', signal =>
      client.cloudFileTextPreview(71, signal)), /before admission/i)
    assert.equal(events.started, 0)
  })
})


test('Desktop Live Photo motion-ticket cancellation closes actual Agent HTTP before response bytes', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const sender = new WindowSender(165)
    const pending = mgr.run(sender, 'live-motion-ticket', signal =>
      client.mediaLivePhotoMotionTicket(71, signal))
    await until(() => events.started === 1)
    mgr.cancel(sender, 'live-motion-ticket')
    await assert.rejects(pending, /cancel|abort/i)
    await until(() => events.aborted === 1, 160)
    assert.equal(events.bytes, 0, 'abandoned ticket must not read Agent response bytes')
  })
})

test('Desktop Live motion ticket cancellation is sender-scoped, including pre-admission', async () => {
  await withSlowAgent(async ({ events, client }) => {
    const mgr = new DesktopViewportRequests()
    const firstSender = new WindowSender(166)
    const secondSender = new WindowSender(167)
    const first = mgr.run(firstSender, 'live-same-id', signal =>
      client.mediaLivePhotoMotionTicket(71, signal))
    const second = mgr.run(secondSender, 'live-same-id', signal =>
      client.mediaLivePhotoMotionTicket(72, signal))
    await until(() => events.started === 2)
    mgr.cancel(firstSender, 'live-same-id')
    await assert.rejects(first, /cancel|abort/i)
    await until(() => events.aborted === 1, 160)
    assert.equal(events.bytes, 0)
    secondSender.emit('destroyed')
    await assert.rejects(second, /cancel|abort/i)
    await until(() => events.aborted === 2, 160)
    mgr.cancel(firstSender, 'live-before-admission')
    await assert.rejects(mgr.run(firstSender, 'live-before-admission', signal =>
      client.mediaLivePhotoMotionTicket(73, signal)), /before admission/i)
    assert.equal(events.started, 2, 'cancel-before-admission must not fetch ticket')
  })
})
