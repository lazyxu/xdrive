'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const file = 'desktop/src/main/viewport_requests.cts'
const compiled = ts.transpileModule(read(file), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', compiled)(mod.exports, mod, require)
const { DesktopViewportRequests } = mod.exports
const wait = async (predicate, label) => {
  for (let i = 0; i < 180; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw Error('timeout waiting for ' + label)
}

test('Desktop local Storage uses read-only Owner-scoped HTTP abort with all original capabilities', () => {
  const renderer = read('desktop/src/renderer/App.tsx')
  const main = read('desktop/src/main/index.cts')
  const preload = read('desktop/src/preload/index.cts')
  const types = read('desktop/src/renderer/global.d.ts')
  const agent = read('desktop/src/main/agent_client.cts')
  for (const p of [
    { method: 'getStorageTree', channel: 'get-storage-tree',
      agent: 'storageTree', capability: 'storage-tree', url: '/v1/storage-tree' },
    { method: 'getCache', channel: 'get-cache',
      agent: 'cacheStats', capability: 'cache-management', url: '/v1/cache' },
  ]) {
    assert.ok(preload.includes(p.method + ": (requestID?: string) => ipcRenderer.invoke('agent:" +
      p.channel + "', requestID)"), p.method + ' optional ID remains source compatible')
    assert.ok(types.includes(p.method + ': (requestID?: string) => Promise<DesktopResult<'))
    const ipc = main.split("ipcMain.handle('agent:" + p.channel + "'")[1]
      ?.split('  ipcMain.handle(')[0]
    assert.ok(ipc)
    assert.match(ipc, /viewportRequests\.run\(event\.sender, requestID, async signal =>/,
      p.method + ' must use the sender-only cancellation registry')
    assert.ok(ipc.includes("requireAgentCapability(hello, '" + p.capability + "')"),
      p.method + ' retains its existing capability guard')
    assert.ok(ipc.includes('requireAgentClient().' + p.agent + '(signal)'))
    assert.ok(agent.includes("'/v1/" + p.url.replace(/^\//, '').slice(3) + "'") ||
      agent.includes("'" + p.url + "'"))
    assert.doesNotMatch(ipc, /clearBrowserCache|releaseCache|setFolderMode|cancelTransfer|cancelBackup/)
  }
  assert.match(renderer, /load: async \(signal\?: AbortSignal\) => \{/)
  assert.match(renderer, /xDriveDesktopViewportRequest\(signal,\s*requestID => window\.xdriveDesktop\.agent\.getStorageTree\(requestID\)\)/)
  assert.match(renderer, /xDriveDesktopViewportRequest\(signal,\s*requestID => window\.xdriveDesktop\.agent\.getCache\(requestID\)\)/)
  assert.match(renderer, /window\.xdriveDesktop\.getBrowserCache\(\)/)
  assert.match(renderer, /signal\?\.throwIfAborted\(\)\s*if \(!browserResult\.ok\)/)
  assert.match(agent, /storageTree\(signal\?: AbortSignal\) \{\s*return this\.request<AgentStorageTreeNode>\('GET', '\/v1\/storage-tree', undefined, 45_000, signal\)/)
  assert.match(agent, /cacheStats\(signal\?: AbortSignal\) \{\s*return this\.request<AgentCacheStats>\('GET', '\/v1\/cache', undefined, 10_000, signal\)/)
  assert.ok(renderer.includes('window.xdriveDesktop.agent.releaseCache()'),
    'intentional cache release must never use disposable read cancellation')
  assert.ok(renderer.includes('window.xdriveDesktop.clearBrowserCache()'))
})

test('old Desktop Storage tree/cache sockets release while new Host and independent window continue', async () => {
  const requests = new DesktopViewportRequests()
  const senderA = Object.assign(new EventEmitter(), { id: 2101 })
  const senderB = Object.assign(new EventEmitter(), { id: 2102 })
  const durables = ['upload','download','backup','sync','cache-release','policy-change']
    .map(() => new AbortController())
  const state = { oldActive: 0, oldClosed: 0, oldBytes: 0 }
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('?old')) {
      state.oldActive++
      const timer = setTimeout(() => {
        if (res.destroyed) return
        state.oldBytes += 32768
        res.end(Buffer.alloc(32768))
      }, 650)
      res.once('close', () => {
        clearTimeout(timer)
        state.oldActive--
        state.oldClosed++
      })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ confirmed: true }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = 'http://127.0.0.1:' + server.address().port
    const urls = ['/v1/storage-tree', '/v1/cache']
    const stale = urls.map((u, i) =>
      requests.run(senderA, 'obsolete-' + i, async signal =>
        (await fetch(base + u + '?old', { signal })).text()).then(
        () => 'unexpected completion', () => 'cancelled'))
    await wait(() => state.oldActive === 2, 'two old Agent GETs')
    const next = urls.map((u, i) =>
      requests.run(senderA, 'current-' + i, async signal =>
        (await fetch(base + u + '?new', { signal })).json()))
    const separate = requests.run(senderB, 'obsolete-0', async signal =>
      (await fetch(base + '/v1/cache?new', { signal })).json())
    requests.cancel(senderA, 'obsolete-0')
    requests.cancel(senderA, 'obsolete-1')
    assert.deepEqual(await Promise.all(stale), ['cancelled', 'cancelled'])
    await wait(() => state.oldActive === 0, 'old sockets physically closed')
    assert.equal(state.oldClosed, 2)
    assert.equal(state.oldBytes, 0, 'no old payload bytes are served')
    for (const confirmed of await Promise.all([...next, separate])) {
      assert.deepEqual(confirmed, { confirmed: true })
    }
    for (const d of durables) assert.equal(d.signal.aborted, false)
    requests.cancel(senderA, 'cancel-before-admission')
    await assert.rejects(requests.run(senderA, 'cancel-before-admission',
      async () => 'invalid'), /cancelled before admission/)
    assert.equal(await requests.run(senderB, 'cancel-before-admission',
      async () => 'valid'), 'valid')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
