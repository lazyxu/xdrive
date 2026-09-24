const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { AgentIPCClient, AgentIPCError } = require('../dist/main/agent_client.cjs')

async function fixture(t, handler) {
  const token = 'a'.repeat(64)
  const server = http.createServer((req, res) => handler(req, res, token))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xdrive-desktop-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const discovery = path.join(dir, 'desktop-ipc.json')
  await fs.writeFile(discovery, JSON.stringify({
    version: 1, base_url: `http://127.0.0.1:${address.port}`, token, pid: process.pid,
  }))
  return { client: new AgentIPCClient(discovery), token }
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

test('status uses bearer token and parses status', async (t) => {
  const { client, token } = await fixture(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    assert.equal(req.url, '/v1/status')
    json(res, 200, {
      revision: 4, configured: true, username: 'alice', auth_status: '已登录',
      sync_status: '同步正常', paused: false, must_change_password: false,
      has_conflict: false, conflict_count: 0, version: 'test',
    })
  })
  const status = await client.status()
  assert.equal(status.revision, 4)
  assert.equal(status.username, 'alice')
})

test('events support 204 and changed status', async (t) => {
  let calls = 0
  const { client } = await fixture(t, (req, res) => {
    calls++
    assert.match(req.url, /^\/v1\/events\?/)
    if (calls === 1) {
      res.statusCode = 204
      res.end()
      return
    }
    json(res, 200, {
      type: 'status.changed', revision: 8,
      status: {
        revision: 8, configured: true, auth_status: '已登录', sync_status: '已暂停',
        paused: true, must_change_password: false, has_conflict: false, conflict_count: 0, version: 'test',
      },
    })
  })
  assert.equal(await client.events(7, 10), null)
  const event = await client.events(7, 10)
  assert.equal(event.revision, 8)
  assert.equal(event.status.paused, true)
})

test('login sends credentials through main transport', async (t) => {
  let body
  const { client } = await fixture(t, async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    json(res, 200, {
      revision: 2, configured: true, username: 'alice', auth_status: '已登录',
      sync_status: '正在启动同步', paused: false, must_change_password: false,
      has_conflict: false, conflict_count: 0, version: 'test',
    })
  })
  await client.login({ server: 'https://drive.test', username: 'alice', password: 'secret' })
  assert.deepEqual(body, { server: 'https://drive.test', username: 'alice', password: 'secret' })
})

test('agent errors preserve code and status', async (t) => {
  const { client } = await fixture(t, (_req, res) => json(res, 409, { error: 'revision_conflict', message: 'stale state' }))
  await assert.rejects(client.syncNow(), (error) => {
    assert.ok(error instanceof AgentIPCError)
    assert.equal(error.code, 'revision_conflict')
    assert.equal(error.status, 409)
    return true
  })
})

test('discovery rejects non-loopback endpoints', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xdrive-desktop-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const discovery = path.join(dir, 'desktop-ipc.json')
  await fs.writeFile(discovery, JSON.stringify({
    version: 1, base_url: 'http://192.0.2.1:1234', token: 'b'.repeat(64), pid: process.pid,
  }))
  const client = new AgentIPCClient(discovery)
  await assert.rejects(client.status(), (error) => {
    assert.ok(error instanceof AgentIPCError)
    assert.equal(error.code, 'invalid_discovery')
    return true
  })
})
