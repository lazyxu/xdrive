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


test('transfers support list events and retry', async (t) => {
  const seen = []
  const task = {
    id: 'transfer-1',
    file_name: 'movie.bin',
    path: 'Media/movie.bin',
    kind: 'upload',
    direction: 'upload',
    state: 'failed',
    bytes_done: 10,
    bytes_total: 100,
    percent: 10,
    instant_bytes_per_second: 0,
    average_bytes_per_second: 20,
    elapsed_ms: 500,
    error: 'network down',
    retry_count: 0,
    retryable: true,
    started_at: new Date(0).toISOString(),
    updated_at: new Date(500).toISOString(),
  }
  const { client } = await fixture(t, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/v1/transfers') {
      seen.push('list')
      json(res, 200, { revision: 4, transfers: [task] })
      return
    }
    if (url.pathname === '/v1/transfer-events') {
      seen.push(`event:${url.searchParams.get('after_revision')}`)
      json(res, 200, { type: 'transfers.changed', revision: 5, transfers: [{ ...task, state: 'running' }] })
      return
    }
    if (url.pathname === '/v1/transfers/retry') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      seen.push(`retry:${body.id}`)
      json(res, 200, { revision: 6, transfers: [{ ...task, state: 'completed', retry_count: 1, error: undefined }] })
      return
    }
    json(res, 404, { error: 'not_found', message: 'not found' })
  })

  const snapshot = await client.transfers()
  assert.equal(snapshot.revision, 4)
  assert.equal(snapshot.transfers[0].file_name, 'movie.bin')

  const event = await client.transferEvents(4, 10)
  assert.equal(event.revision, 5)
  assert.equal(event.transfers[0].state, 'running')

  const retried = await client.retryTransfer('transfer-1')
  assert.equal(retried.revision, 6)
  assert.equal(retried.transfers[0].retry_count, 1)
  assert.deepEqual(seen, ['list', 'event:4', 'retry:transfer-1'])
})


test('diagnostics use dedicated agent endpoints', async (t) => {
  const seen = []
  const { client } = await fixture(t, async (req, res) => {
    seen.push(`${req.method} ${req.url}`)
    if (req.url === '/v1/diagnostics') {
      json(res, 200, {
        generated_at: new Date(0).toISOString(),
        platform: 'linux',
        arch: 'amd64',
        checks: [{ name: 'server health', status: 'PASS', detail: 'HTTP 200' }],
        summary: { pass: 1, warn: 0, fail: 0 },
      })
      return
    }
    if (req.url === '/v1/diagnostics/report') {
      json(res, 200, { report: 'xDrive diagnostic report\n' })
      return
    }
    if (req.url === '/v1/diagnostics/reconnect' || req.url === '/v1/diagnostics/repair-sync-root') {
      json(res, 200, {
        revision: 9, configured: true, auth_status: '已登录', sync_status: '正在启动同步',
        paused: false, must_change_password: false, has_conflict: false, conflict_count: 0, version: 'test',
      })
      return
    }
    if (req.url === '/v1/diagnostics/open-logs') {
      json(res, 200, { ok: true })
      return
    }
    json(res, 404, { error: 'not_found', message: 'not found' })
  })

  const report = await client.diagnostics()
  assert.equal(report.checks[0].name, 'server health')
  assert.match((await client.diagnosticReport()).report, /diagnostic report/)
  assert.equal((await client.reconnect()).revision, 9)
  assert.equal((await client.repairSyncRoot()).revision, 9)
  assert.deepEqual(await client.openLogs(), { ok: true })
  assert.deepEqual(seen, [
    'GET /v1/diagnostics',
    'GET /v1/diagnostics/report',
    'POST /v1/diagnostics/reconnect',
    'POST /v1/diagnostics/repair-sync-root',
    'POST /v1/diagnostics/open-logs',
  ])
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


test('storage tree and cache use dedicated agent endpoints', async (t) => {
  const seen = []
  const { client } = await fixture(t, async (req, res) => {
    seen.push(`${req.method} ${req.url}`)
    if (req.url === '/v1/storage-tree') {
      json(res, 200, {
        path: '', name: 'xDrive', mode: 'default', effective_mode: 'default',
        file_count: 3, total_bytes: 60,
        children: [{ path: 'Projects', name: 'Projects', mode: 'always-local', effective_mode: 'always-local', file_count: 2, total_bytes: 30 }],
      })
      return
    }
    if (req.url === '/v1/cache') {
      json(res, 200, {
        supported: true, used_bytes: 100, limit_bytes: 200,
        reclaimable_bytes: 40, pinned_bytes: 60,
        cached_files: 4, reclaimable_files: 2, pinned_files: 2,
      })
      return
    }
    if (req.url === '/v1/cache/release') {
      json(res, 200, {
        stats: {
          supported: true, used_bytes: 60, limit_bytes: 200,
          reclaimable_bytes: 0, pinned_bytes: 60,
          cached_files: 2, reclaimable_files: 0, pinned_files: 2,
        },
        released_bytes: 40, released_files: 2, failed_files: 0,
      })
      return
    }
    json(res, 404, { error: 'not_found', message: 'not found' })
  })

  const tree = await client.storageTree()
  assert.equal(tree.children[0].mode, 'always-local')
  const cache = await client.cacheStats()
  assert.equal(cache.reclaimable_bytes, 40)
  const released = await client.releaseCache()
  assert.equal(released.released_files, 2)
  assert.deepEqual(seen, [
    'GET /v1/storage-tree',
    'GET /v1/cache',
    'POST /v1/cache/release',
  ])
})


test('cloud management uses dedicated agent endpoints', async (t) => {
  const seen = []
  const { client } = await fixture(t, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const chunks = []
    if (req.method !== 'GET') {
      for await (const chunk of req) chunks.push(chunk)
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
    seen.push({ method: req.method, path: url.pathname, query: url.search, body })

    switch (url.pathname) {
      case '/v1/cloud/root':
        json(res, 200, { id: 1, name: 'root', type: 'dir', size: 0, revision: 1, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() })
        return
      case '/v1/cloud/children':
        json(res, 200, [{ id: 2, parent_id: 1, name: 'Projects', type: 'dir', size: 0, revision: 1, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() }])
        return
      case '/v1/cloud/search':
        json(res, 200, [{ node: { id: 3, name: 'report.pdf', type: 'file', size: 12, revision: 2, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() }, path: 'Projects/report.pdf', crumbs: [{ id: 1, name: 'My files' }, { id: 2, name: 'Projects' }] }])
        return
      case '/v1/cloud/quota':
        json(res, 200, { quota_bytes: 1000, physical_used_bytes: 400, logical_file_bytes: 300, trash_bytes: 50, history_bytes: 50, over_quota: false })
        return
      case '/v1/cloud/trash':
        json(res, 200, [{ id: 4, name: 'old.txt', type: 'file', size: 5, revision: 3, deleted_at: new Date(0).toISOString(), created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() }])
        return
      case '/v1/cloud/storage-stats':
        json(res, 200, {
          scope: 'self',
          cas_blob_count: 9,
          cas_physical_bytes: 400,
          cas_logical_referenced_bytes: 600,
          cas_dedup_saved_bytes: 200,
          cas_dedup_ratio: 1.5,
          cas_savings_ratio: 1 / 3,
          average_blob_size_bytes: 44,
          p50_blob_size_bytes: 12,
          p90_blob_size_bytes: 100,
          p99_blob_size_bytes: 200,
          legacy_blob_count: 0,
          legacy_physical_bytes: 0,
          buckets: [],
          generated_at: new Date(0).toISOString(),
        })
        return
      case '/v1/cloud/trash/restore':
        json(res, 200, { id: 4, name: 'old.txt', type: 'file', size: 5, revision: 4, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() })
        return
      case '/v1/cloud/trash/delete':
        json(res, 200, { ok: true })
        return
      case '/v1/cloud/versions':
        json(res, 200, [{ id: 5, node_id: 3, revision: 1, size: 10, created_at: new Date(0).toISOString() }])
        return
      case '/v1/cloud/versions/restore':
        json(res, 200, { id: 3, name: 'report.pdf', type: 'file', size: 10, revision: 3, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() })
        return
      case '/v1/cloud/shares':
        if (req.method === 'POST') {
          json(res, 201, { share: { id: 7, node_id: 3, token: 'share-token', has_password: false, max_downloads: 2, download_count: 0, status: 'active', created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() }, url: 'https://drive.example/#/s/share-token' })
        } else {
          json(res, 200, [{ id: 6, node_id: 3, has_password: false, max_downloads: 0, download_count: 0, status: 'active', created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() }])
        }
        return
      case '/v1/cloud/shares/revoke':
        json(res, 200, { ok: true })
        return
      default:
        json(res, 404, { error: 'not_found', message: 'not found' })
    }
  })

  assert.equal((await client.cloudRoot()).id, 1)
  assert.equal((await client.cloudChildren(1))[0].name, 'Projects')
  assert.equal((await client.cloudSearch('report'))[0].path, 'Projects/report.pdf')
  assert.equal((await client.cloudQuota()).physical_used_bytes, 400)
  assert.equal((await client.cloudStorageStats()).cas_blob_count, 9)
  assert.equal((await client.cloudTrash())[0].id, 4)
  assert.equal((await client.cloudRestoreTrash(4, 3)).revision, 4)
  assert.equal((await client.cloudDeleteTrash(4, 3)).ok, true)
  assert.equal((await client.cloudVersions(3))[0].id, 5)
  assert.equal((await client.cloudRestoreVersion(3, 2, 5)).revision, 3)
  assert.equal((await client.cloudShares(3))[0].id, 6)
  assert.match((await client.cloudCreateShare(3, { max_downloads: 2 })).url, /share-token/)
  assert.equal((await client.cloudRevokeShare(6)).ok, true)

  assert.deepEqual(seen.map((item) => [item.method, item.path]), [
    ['GET', '/v1/cloud/root'],
    ['GET', '/v1/cloud/children'],
    ['GET', '/v1/cloud/search'],
    ['GET', '/v1/cloud/quota'],
    ['GET', '/v1/cloud/storage-stats'],
    ['GET', '/v1/cloud/trash'],
    ['POST', '/v1/cloud/trash/restore'],
    ['POST', '/v1/cloud/trash/delete'],
    ['GET', '/v1/cloud/versions'],
    ['POST', '/v1/cloud/versions/restore'],
    ['GET', '/v1/cloud/shares'],
    ['POST', '/v1/cloud/shares'],
    ['POST', '/v1/cloud/shares/revoke'],
  ])
  assert.equal(seen[1].query, '?parent_id=1')
  assert.equal(seen[2].query, '?q=report')
  assert.deepEqual(seen[6].body, { id: 4, revision: 3 })
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
