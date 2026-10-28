'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const transpile = file => ts.transpileModule(read(file), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function load(file, getModule = require) {
  const out = { exports: {} }
  new Function('exports', 'module', 'require', transpile(file))(out.exports, out, getModule)
  return out.exports
}
const transport = load('ui/shared/src/transport-result.ts')
const { createXDriveCloudStorageDataSource } = load('ui/shared/src/mui/CloudStorageAdapter.ts',
  name => name === '../transport-result' ? transport : require(name))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function until(predicate, message) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for ' + message)
}

test('Cloud Storage adopts only current Owner quota, even after a non-cooperative old response', async () => {
  const oldQuota = deferred(), oldStats = deferred()
  const newestQuota = { quota_bytes: 999, physical_used_bytes: 14 }
  const accepted = []
  const durables = ['upload','download','backup','sync'].map(() => new AbortController())
  let called = 0
  const signals = []
  const source = createXDriveCloudStorageDataSource({
    getQuota: signal => {
      signals.push(signal)
      return ++called === 1 ? oldQuota.promise : Promise.resolve(newestQuota)
    },
    getStats: signal => {
      signals.push(signal)
      return called === 1 ? oldStats.promise : Promise.resolve({ scope: 'self' })
    },
  }, { onQuota: quota => accepted.push(quota), tolerateStatsError: true })
  const first = new AbortController(), second = new AbortController()
  const stale = source.load(first.signal)
  await Promise.resolve()
  assert.equal(signals.length, 2)
  first.abort()
  const fresh = await source.load(second.signal)
  assert.equal(fresh.quota, newestQuota)
  assert.deepEqual(accepted, [newestQuota])
  oldStats.resolve({ scope: 'self' })
  oldQuota.resolve({ quota_bytes: 1, physical_used_bytes: 1 })
  await assert.rejects(stale, error => error?.name === 'AbortError')
  assert.deepEqual(accepted, [newestQuota], 'old scope cannot overwrite global quota')
  assert.ok(signals.slice(0, 2).every(signal => signal === first.signal))
  assert.ok(signals.slice(2).every(signal => signal === second.signal))
  for (const durable of durables) assert.equal(durable.signal.aborted, false)
})

test('an aborted optional statistics failure cannot be swallowed as unavailable', async () => {
  const stats = deferred()
  const c = new AbortController()
  const writes = []
  const source = createXDriveCloudStorageDataSource({
    getQuota: async () => ({ quota_bytes: 10 }),
    getStats: () => stats.promise,
  }, { onQuota: quota => writes.push(quota), tolerateStatsError: true })
  const pending = source.load(c.signal)
  c.abort()
  stats.reject(new Error('old Owner transient error'))
  await assert.rejects(pending, error => error?.name === 'AbortError')
  assert.deepEqual(writes, [])
})

test('legacy unscoped data source and ordinary tolerated Stats failure remain compatible', async () => {
  const quota = { quota_bytes: 900 }
  const updates = []
  const source = createXDriveCloudStorageDataSource({
    getQuota: async () => ({ ok: true, data: quota }),
    getStats: async () => ({ ok: false, error: { message: 'not implemented', status: 503 } }),
  }, { onQuota: value => updates.push(value), tolerateStatsError: true,
    statsUnavailableMessage: 'Not supported' })
  const result = await source.load()
  assert.equal(result.quota, quota)
  assert.equal(result.stats, null)
  assert.equal(result.statsUnavailableMessage, 'Not supported')
  assert.deepEqual(updates, [quota])
})

test('actual Web HTTP quota+stats GETs abort stale sockets without affecting new page', async () => {
  const state = { pending: 0, closed: 0, delayedBytes: 0 }
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/old/')) {
      state.pending++
      const timer = setTimeout(() => {
        if (res.destroyed) return
        state.delayedBytes += 32768
        res.end(Buffer.alloc(32768))
      }, 650)
      res.once('close', () => { clearTimeout(timer); state.closed++ })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(req.url?.endsWith('/stats') ? { scope: 'self' } : { quota_bytes: 300 }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = 'http://127.0.0.1:' + server.address().port
    let old = true
    const source = createXDriveCloudStorageDataSource({
      getQuota: async signal => (await fetch(base + '/' + (old ? 'old' : 'new') + '/quota', { signal })).json(),
      getStats: async signal => (await fetch(base + '/' + (old ? 'old' : 'new') + '/stats', { signal })).json(),
    })
    const stale = new AbortController()
    const result = source.load(stale.signal)
    await until(() => state.pending === 2, 'two old storage GETs accepted')
    stale.abort()
    old = false
    const next = await source.load(new AbortController().signal)
    assert.equal(next.quota.quota_bytes, 300)
    await assert.rejects(result, error => error?.name === 'AbortError')
    await until(() => state.closed === 2, 'old connections closed')
    assert.equal(state.delayedBytes, 0, 'no stale response bytes after abort')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

test('Web source and shared page preserve the exact abort signal and disposable-only boundary', () => {
  const adapter = read('ui/shared/src/mui/CloudStorageAdapter.ts')
  const page = read('ui/shared/src/mui/CloudStoragePage.tsx')
  const api = read('web/src/api.ts')
  const app = read('web/src/App.tsx')
  assert.match(adapter, /load: async \(signal\?: AbortSignal\)/)
  assert.match(adapter, /port\.getQuota\(signal\)/)
  assert.match(adapter, /port\.getStats\(signal\)/)
  assert.match(adapter, /signal\?\.throwIfAborted\(\)\s*onQuota\?\.\(quota\)/)
  assert.match(page, /source\.load\(controller\.signal\)/)
  assert.match(page, /activeRequest\.current\?\.abort\(\)/)
  assert.match(api, /quota\(signal\?: AbortSignal\) \{\s*return this\.request<QuotaUsage>\('\/api\/v1\/me\/quota', \{ signal \}\)/)
  assert.match(api, /storageStats\(signal\?: AbortSignal\) \{\s*return this\.request<StorageStats>\('\/api\/v1\/me\/storage', \{ signal \}\)/)
  assert.match(app, /getQuota: signal => api\.quota\(signal\)/)
  assert.match(app, /getStats: signal => api\.storageStats\(signal\)/)
  assert.doesNotMatch(adapter, /cancelUpload|cancelDownload|cancelBackup|terminateWorker|cancelTransfer/)
})
