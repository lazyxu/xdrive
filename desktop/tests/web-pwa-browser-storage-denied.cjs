const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/browserStorage.ts'), 'utf8')
const js = ts.transpileModule(source, {
  fileName: 'browserStorage.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness({ cacheStorage, cacheGetterThrows = false, storageGetterThrows = false, estimate } = {}) {
  const win = {}
  Object.defineProperty(win, 'caches', {
    get() {
      if (cacheGetterThrows) throw new Error('SecurityError: Cache Storage is denied')
      return cacheStorage
    },
  })
  const nav = {}
  Object.defineProperty(nav, 'storage', {
    get() {
      if (storageGetterThrows) throw new Error('SecurityError: storage getter denied')
      return estimate ? { estimate } : undefined
    },
  })
  const exports = {}
  new Function('exports', 'window', 'navigator', js)(exports, win, nav)
  return exports
}

function cache(names = ['xdrive-public-shell', 'xdrive-public-offline']) {
  const stored = new Set(names)
  const deleted = []
  const cacheStorage = {
    async keys() { return Array.from(stored) },
    async delete(name) { deleted.push(name); return stored.delete(name) },
  }
  return { cacheStorage, deleted }
}

test('PWA Safari denied CacheStorage AND navigator.storage getters do not crash Local Storage page', async () => {
  const api = harness({ cacheGetterThrows: true, storageGetterThrows: true })
  const state = await api.createWebBrowserStorageSnapshot()
  assert.equal(state.supported, false)
  assert.equal(state.clear_supported, false)
  assert.equal(state.cache_entries, undefined)
  assert.match(state.reason, /不提供站点存储统计/)
  assert.deepEqual(await api.clearWebBrowserCache(), { released_bytes: 0, cleared_entries: 0 })
})

test('PWA denied CacheStorage.keys cannot claim cache deletion is supported', async () => {
  let deleteCalls = 0
  const api = harness({
    cacheStorage: {
      async keys() { throw new Error('SecurityError: cache keys denied') },
      async delete() { deleteCalls++; return true },
    },
    estimate: async () => ({ usage: 1234, quota: 2000 }),
  })
  const state = await api.createWebBrowserStorageSnapshot()
  assert.equal(state.supported, true, 'still show the available storage estimate')
  assert.equal(state.total_used_bytes, 1234)
  assert.equal(state.clear_supported, false)
  assert.equal(state.cache_entries, undefined)
  await assert.rejects(api.clearWebBrowserCache(), /SecurityError/)
  assert.equal(deleteCalls, 0, 'no destructive delete when listing is denied')
})

test('PWA rejected optional storage estimates preserve CacheStorage read and clear', async () => {
  const data = cache()
  const api = harness({ cacheStorage: data.cacheStorage, estimate: async () => {
    throw new Error('QuotaExceededError: estimate denied')
  } })
  const state = await api.createWebBrowserStorageSnapshot()
  assert.equal(state.supported, true)
  assert.equal(state.clear_supported, true)
  assert.equal(state.cache_entries, 2)
  assert.equal(state.total_used_bytes, undefined)
  const result = await api.clearWebBrowserCache()
  assert.equal(result.cleared_entries, 2)
  assert.equal(result.released_bytes, undefined)
  assert.deepEqual(data.deleted, ['xdrive-public-shell', 'xdrive-public-offline'])
})

test('PWA normal CacheStorage snapshot and user-triggered deletion retain byte evidence', async () => {
  const data = cache()
  let estimates = 0
  const api = harness({ cacheStorage: data.cacheStorage, estimate: async () => ({
    usage: (++estimates === 1 ? 2000 : estimates === 2 ? 1800 : 700),
    quota: 10_000, usageDetails: { caches: 1300 },
  }) })
  const state = await api.createWebBrowserStorageSnapshot()
  assert.equal(state.cache_entries, 2)
  assert.equal(state.cache_bytes, 1300)
  assert.equal(state.quota_bytes, 10_000)
  const result = await api.clearWebBrowserCache()
  assert.deepEqual(result, { cleared_entries: 2, released_bytes: 1100 })
  assert.equal((await api.createWebBrowserStorageSnapshot()).cache_entries, 0)
})
