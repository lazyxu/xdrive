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

test('file availability and selective sync use dedicated agent endpoints', async (t) => {
  const seen = []
  const { client } = await fixture(t, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    let body = null
    if (req.method !== 'GET') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    seen.push({ method: req.method, path: url.pathname, query: url.searchParams.get('path'), body })
    if (url.pathname === '/v1/settings/sync-rule') {
      json(res, 200, { mount_path: '/xDrive', cache_limit_bytes: 0, sync_rules: [{ path: 'Projects/Archive', mode: 'exclude' }] })
      return
    }
    json(res, 200, {
      Path: '/xDrive/report.docx',
      Mode: 'always-local',
      Placeholder: true,
      Pinned: true,
      OnlineOnly: false,
      AvailableOffline: true,
      InSync: true,
      Syncing: false,
    })
  })

  const state = await client.fileAvailability('/xDrive/report.docx')
  assert.equal(state.Mode, 'always-local')
  await client.setFileAvailability('/xDrive/report.docx', 'release')
  const settings = await client.setSyncRule('Projects/Archive', 'exclude')
  assert.equal(settings.sync_rules[0].mode, 'exclude')

  assert.deepEqual(seen, [
    { method: 'GET', path: '/v1/file-availability', query: '/xDrive/report.docx', body: null },
    { method: 'POST', path: '/v1/file-availability', query: null, body: { path: '/xDrive/report.docx', action: 'release' } },
    { method: 'PUT', path: '/v1/settings/sync-rule', query: null, body: { path: 'Projects/Archive', mode: 'exclude' } },
  ])
})


test('hello validates protocol compatibility and shutdown endpoint', async (t) => {
  const { client } = await fixture(t, (req, res) => {
    if (req.url === '/v1/hello') {
      json(res, 200, {
        discovery_version: 1,
        protocol_min: 1,
        protocol_max: 1,
        agent_version: 'snapshot-test',
        pid: 42,
        platform: 'linux',
        arch: 'amd64',
        capabilities: ['status', 'lifecycle-shutdown'],
      })
      return
    }
    if (req.url === '/v1/lifecycle/shutdown') {
      json(res, 200, { ok: true })
      return
    }
    json(res, 404, { error: 'not_found', message: 'not found' })
  })

  const hello = await client.hello()
  assert.equal(hello.protocol_min, 1)
  assert.equal(hello.protocol_max, 1)
  assert.equal(hello.agent_version, 'snapshot-test')
  assert.deepEqual(await client.shutdown(), { ok: true })
})

test('hello rejects an incompatible agent protocol', async (t) => {
  const { client } = await fixture(t, (_req, res) => {
    json(res, 200, {
      discovery_version: 1,
      protocol_min: 2,
      protocol_max: 3,
      agent_version: 'future',
      pid: 42,
      platform: 'linux',
      arch: 'amd64',
      capabilities: [],
    })
  })
  await assert.rejects(client.hello(), (error) => {
    assert.ok(error instanceof AgentIPCError)
    assert.equal(error.code, 'incompatible_agent')
    return true
  })
})
