'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const file = 'desktop/src/main/viewport_requests.cts'
const transpiled = ts.transpileModule(read(file), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', transpiled)(mod.exports, mod, require)
const { DesktopViewportRequests } = mod.exports
async function until(fn, label) {
  for (let i = 0; i < 160; i++) {
    if (fn()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timeout waiting for ' + label)
}

test('Desktop admin GET carries only optional sender-scoped request ID; edit/mutation IPC remains separate', () => {
  const renderer = read('desktop/src/renderer/App.tsx')
  const types = read('desktop/src/renderer/global.d.ts')
  const preload = read('desktop/src/preload/index.cts')
  const main = read('desktop/src/main/index.cts')
  const agent = read('desktop/src/main/agent_client.cts')
  const shared = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(renderer, /load: async \(signal\?: AbortSignal\) => \{[\s\S]*?xDriveDesktopViewportRequest\(signal,\s*requestID => window\.xdriveDesktop\.agent\.cloudAdminServices\(requestID\)\)/)
  assert.match(preload, /cloudAdminServices: \(requestID\?: string\) => ipcRenderer\.invoke\('agent:cloud-admin-services', requestID\)/)
  assert.match(types, /cloudAdminServices: \(requestID\?: string\) => Promise<DesktopResult<XDriveServiceDependenciesSnapshot>>/)
  const handler = main.split("ipcMain.handle('agent:cloud-admin-services'")[1]
    ?.split('  const adminStorageOperations')[0]
  assert.ok(handler)
  assert.match(handler, /viewportRequests\.run\(event\.sender, requestID, async signal =>/)
  assert.match(handler, /requireAgentCapability\(hello, 'admin-services'\)/)
  assert.match(handler, /requireAgentClient\(\)\.cloudAdminServices\(signal\)/)
  assert.doesNotMatch(handler, /cancelBackup|cancelUpload|cancelTransfer|cloudSave|cloudSetAdmin|cloudAdminStorage/)
  assert.match(agent, /cloudAdminServices\(signal\?: AbortSignal\) \{\s*return this\.request<AgentServiceDependenciesSnapshot>\('GET', '\/v1\/cloud\/admin-services', undefined, 10_000, signal\)/)
  assert.match(agent, /cloudAdminStorage\(query: AgentAdminStorageRequest\) \{\s*return this\.request<unknown>\('POST'/)
  assert.match(agent, /cloudSetAdminBaiduMapConfig\(input: AgentAdminBaiduMapUpdate\)/)
  // This parallel PR supplies Host transport; #2978 supplies the shared page
  // mount-effect AbortSignal in a separate source change, not via this PR.
  assert.match(shared, /source\.load\(\)/)
})

test('real slow admin GET aborts before body; different WebContents and durable signals remain active', async () => {
  const requests = new DesktopViewportRequests()
  const senderA = Object.assign(new EventEmitter(), { id: 712 })
  const senderB = Object.assign(new EventEmitter(), { id: 713 })
  const durable = ['backup', 'upload', 'download', 'sync', 'mutation']
    .map(() => new AbortController())
  const state = { pending: 0, closed: 0, oldBytes: 0 }
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/cloud/admin-services?old') {
      state.pending++
      const timer = setTimeout(() => {
        if (res.destroyed) return
        state.oldBytes += 16 * 1024
        res.end(Buffer.alloc(16 * 1024))
      }, 650)
      res.once('close', () => { state.closed++; clearTimeout(timer) })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ state: 'verified' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = 'http://127.0.0.1:' + server.address().port
    const old = requests.run(senderA, 'services-old', async signal =>
      (await fetch(base + '/v1/cloud/admin-services?old', { signal })).json())
    const outcome = old.then(() => 'unexpected', () => 'cancelled')
    await until(() => state.pending === 1, 'old admin HTTP GET accepted')
    const next = requests.run(senderA, 'services-new', async signal =>
      (await fetch(base + '/v1/cloud/admin-services?new', { signal })).json())
    const independent = requests.run(senderB, 'services-old', async signal =>
      (await fetch(base + '/v1/cloud/admin-services?new', { signal })).json())
    requests.cancel(senderA, 'services-old')
    assert.equal(await outcome, 'cancelled')
    await until(() => state.closed === 1, 'obsolete socket released')
    assert.equal(state.oldBytes, 0)
    assert.deepEqual(await next, { state: 'verified' })
    assert.deepEqual(await independent, { state: 'verified' })
    for (const task of durable) assert.equal(task.signal.aborted, false)
    requests.cancel(senderA, 'not-admitted')
    await assert.rejects(requests.run(senderA, 'not-admitted', async () => 'wrong'),
      /cancelled before admission/)
    assert.equal(await requests.run(senderB, 'not-admitted', async () => 'right'), 'right')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
