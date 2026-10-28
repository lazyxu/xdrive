'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const file = 'desktop/src/main/viewport_requests.cts'
const out = { exports: {} }
new Function('exports', 'module', 'require', ts.transpileModule(read(file), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(out.exports, out, require)
const { DesktopViewportRequests } = out.exports
async function until(check, label) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timed out: ' + label)
}

test('Desktop quota+statistics readers use exactly the existing sender-scoped GET IPC path', () => {
  const renderer = read('desktop/src/renderer/App.tsx')
  const preload = read('desktop/src/preload/index.cts')
  const typings = read('desktop/src/renderer/global.d.ts')
  const main = read('desktop/src/main/index.cts')
  const agent = read('desktop/src/main/agent_client.cts')
  for (const x of [
    { method: 'cloudQuota', channel: 'cloud-quota', capability: 'cloud-files', url: 'cloud/quota' },
    { method: 'cloudStorageStats', channel: 'cloud-storage-stats', capability: 'storage-intelligence', url: 'cloud/storage-stats' },
  ]) {
    assert.match(renderer, new RegExp('agent\\.' + x.method + '\\(requestID\\)'),
      x.method + ' must receive the renderer-owned cancellation ID')
    assert.match(preload, new RegExp(x.method + ': \\(requestID\\?: string\\) => ipcRenderer\\.invoke\\(\\'agent:' + x.channel + '\\', requestID\\)'))
    assert.match(typings, new RegExp(x.method + ': \\(requestID\\?: string\\) => Promise<DesktopResult'))
    const handler = main.split("ipcMain.handle('agent:" + x.channel + "'")[1]
      ?.split('  ipcMain.handle(')[0]
    assert.ok(handler, x.channel + ' must exist')
    assert.match(handler, /viewportRequests\.run\(event\.sender, requestID, async signal =>/)
    assert.ok(handler.includes("requireAgentCapability(hello, '" + x.capability + "')"))
    assert.ok(handler.includes('requireAgentClient().' + x.method + '(signal)'))
    assert.doesNotMatch(handler, /releaseCache|setSyncRule|cancelBackup|cancelUpload|cancelDownload|cancelTransfer/)
    assert.ok(agent.includes("'/v1/" + x.url + "'"))
  }
  assert.match(renderer, /getQuota: \(signal\?: AbortSignal\) => xDriveDesktopViewportRequest\(signal,/)
  assert.match(renderer, /getStats: storageStatsSupported\s*\? \(signal\?: AbortSignal\) => xDriveDesktopViewportRequest\(signal,/)
  assert.match(agent, /cloudQuota\(signal\?: AbortSignal\) \{\s*return this\.request<AgentCloudQuota>\('GET', '\/v1\/cloud\/quota', undefined, 10_000, signal\)/)
  assert.match(agent, /cloudStorageStats\(signal\?: AbortSignal\) \{\s*return this\.request<AgentCloudStorageStats>\('GET', '\/v1\/cloud\/storage-stats', undefined, 10_000, signal\)/)
  assert.match(main, /agent:cloud-storage-cache-cleanup/,
    'non-disposable cleanup command and existing capability must remain independent')
})

test('real slow Desktop Cloud GETs close on sender A abort, but successor/B and durable tasks stay active', async () => {
  const requests = new DesktopViewportRequests()
  const senderA = Object.assign(new EventEmitter(), { id: 1001 })
  const senderB = Object.assign(new EventEmitter(), { id: 1002 })
  const durables = ['upload','download','backup','sync','mutation']
    .map(() => new AbortController())
  const state = { pending: 0, closed: 0, oldBytes: 0 }
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('?old')) {
      state.pending++
      const timer = setTimeout(() => {
        if (res.destroyed) return
        state.oldBytes += 32768
        res.end(Buffer.alloc(32768))
      }, 650)
      res.once('close', () => { clearTimeout(timer); state.closed++ })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = 'http://127.0.0.1:' + server.address().port
    const paths = ['/v1/cloud/quota', '/v1/cloud/storage-stats']
    const obsolete = paths.map((p, i) =>
      requests.run(senderA, 'old-' + i, async signal =>
        (await fetch(base + p + '?old', { signal })).text())
        .then(() => 'unexpected', () => 'cancelled'))
    await until(() => state.pending === 2, 'two old authenticated GETs admitted')
    const newer = paths.map((p, i) => requests.run(senderA, 'new-' + i, async signal =>
      (await fetch(base + p + '?new', { signal })).json()))
    const independent = requests.run(senderB, 'old-0', async signal =>
      (await fetch(base + '/v1/cloud/quota?new', { signal })).json())
    requests.cancel(senderA, 'old-0')
    requests.cancel(senderA, 'old-1')
    assert.deepEqual(await Promise.all(obsolete), ['cancelled', 'cancelled'])
    await until(() => state.closed === 2, 'both obsolete sockets closed')
    assert.equal(state.oldBytes, 0, 'no delayed stale quota or stats bytes')
    for (const answer of await Promise.all([...newer, independent])) {
      assert.deepEqual(answer, { ok: true })
    }
    for (const d of durables) assert.equal(d.signal.aborted, false)
    requests.cancel(senderA, 'before-admission')
    await assert.rejects(requests.run(senderA, 'before-admission', async () => 'bad'),
      /cancelled before admission/)
    assert.equal(await requests.run(senderB, 'before-admission', async () => 'allowed'), 'allowed')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
