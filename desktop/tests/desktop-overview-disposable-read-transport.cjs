'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const source = read('ui/shared/src/mui/OverviewPage.tsx')
const adapter = read('desktop/src/renderer/desktopOverviewAdapter.ts')
const preload = read('desktop/src/preload/index.cts')
const types = read('desktop/src/renderer/global.d.ts')
const main = read('desktop/src/main/index.cts')
const agent = read('desktop/src/main/agent_client.cts')
const moduleFile = 'desktop/src/main/viewport_requests.cts'
const compiled = ts.transpileModule(read(moduleFile), {
  fileName: moduleFile,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const out = { exports: {} }
new Function('exports', 'module', 'require', compiled)(out.exports, out, require)
const { DesktopViewportRequests } = out.exports

const endpoints = [
  { name: 'cloud-recent', method: 'GET', url: '/v1/cloud/recent?limit=6',
    agent: 'cloudFileRecent', capability: 'file-recent' },
  { name: 'cloud-favorites', method: 'GET', url: '/v1/cloud/favorites',
    agent: 'cloudFileFavorites', capability: 'file-favorites' },
  { name: 'get-local-disk-space', method: 'GET', url: '/v1/local-disk-space',
    agent: 'localDiskSpace', capability: 'local-disk-space' },
  { name: 'get-file-availability-batch', method: 'POST', url: '/v1/file-availability/batch',
    agent: 'fileAvailabilityBatch', capability: 'file-availability-batch' },
]
const waitUntil = async (condition, description) => {
  for (let i = 0; i < 160; i += 1) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timeout: ' + description)
}

test('all four shared Overview read-only sources propagate scoped AbortSignal through renderer, IPC and Agent', () => {
  assert.match(source, /cloudFileRecent\(6, controller\.signal\)/)
  assert.match(source, /cloudFileFavorites\(controller\.signal\)/)
  assert.match(source, /getLocalDiskSpace\(controller\.signal\)/)
  assert.match(source, /getFileAvailabilityBatch\(paths, controller\.signal\)/)
  assert.match(source, /activeLists\?\.abort\(\)/)
  assert.match(source, /activeDisk\?\.abort\(\)/)
  assert.match(source, /return \(\) => \{ active = false; controller\.abort\(\) \}/,
    'each stale availability source must be cancelled on Owner/route replacement')
  for (const [method, args] of [
    ['cloudFileRecent', 'limit, requestID'],
    ['cloudFileFavorites', 'requestID'],
    ['getLocalDiskSpace', 'requestID'],
    ['getFileAvailabilityBatch', 'paths, requestID'],
  ]) {
    assert.ok(adapter.includes('xDriveDesktopViewportRequest(signal,'), 'shared IPC bridge is used')
    assert.ok(adapter.includes('window.xdriveDesktop.agent.' + method + '(' + args + ')'),
      method + ' has a renderer-owned request ID')
    assert.match(preload, new RegExp(method + ': \\([^)]*requestID\\?: string\\)[^\\n]*ipcRenderer\\.invoke'),
      method + ' retains legacy optional request ID')
    assert.ok(types.includes(method + ': ('), method + ' must have an explicit typed IPC contract')
  }
  for (const endpoint of endpoints) {
    const handler = main.split("ipcMain.handle('agent:" + endpoint.name + "'")[1]
      ?.split("  ipcMain.handle(")[0]
    assert.ok(handler, endpoint.name + ' must retain its original authorized channel')
    assert.match(handler, /viewportRequests\.run\(event\.sender, requestID, async signal =>/,
      endpoint.name + ' must bind cancellation to originating WebContents only')
    assert.ok(handler.includes("requireAgentCapability(hello, '" + endpoint.capability + "')"),
      endpoint.name + ' must preserve its original capability')
    assert.ok(handler.includes('requireAgentClient().' + endpoint.agent + '('),
      endpoint.name + ' must forward only its read-only Agent call')
    assert.doesNotMatch(handler, /cancelTransfer|cancelUpload|cancelBackup|cancelDownload|terminateWorker/)
  }
  for (const endpoint of ['/v1/cloud/recent?', '/v1/cloud/favorites', '/v1/local-disk-space',
    '/v1/file-availability/batch']) assert.ok(agent.includes(endpoint))
  assert.match(agent, /cloudFileRecent\(limit = 16, signal\?: AbortSignal\)/)
  assert.match(agent, /cloudFileFavorites\(signal\?: AbortSignal\)/)
  assert.match(agent, /localDiskSpace\(signal\?: AbortSignal\)/)
  assert.match(agent, /fileAvailabilityBatch\(paths: string\[\], signal\?: AbortSignal\)/)
  assert.match(agent, /30_000,\s*signal,\s*\)/,
    'read-only availability POST retains its original 30s timeout and abort signal')
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer/,
    'shared Desktop/DSM UI must never reach native cancellation IPC directly')
})

test('sender-scoped Overview GETs and read-only batch POST close obsolete HTTP without stopping durable jobs', async () => {
  const requests = new DesktopViewportRequests()
  const senderA = Object.assign(new EventEmitter(), { id: 901 })
  const senderB = Object.assign(new EventEmitter(), { id: 902 })
  const durable = ['upload', 'download', 'backup', 'sync', 'mutation']
    .map(() => new AbortController())
  const state = { oldActive: 0, oldClosed: 0, oldBytes: 0, fresh: 0 }
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('/old')) {
      state.oldActive += 1
      const timer = setTimeout(() => {
        if (res.destroyed) return
        state.oldBytes += 16384
        res.end(Buffer.alloc(16384))
      }, 650)
      res.once('close', () => {
        clearTimeout(timer)
        state.oldActive -= 1
        state.oldClosed += 1
      })
      // Consume tiny read-only POST input so its abort behavior is equivalent.
      req.resume()
      return
    }
    state.fresh += 1
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = 'http://127.0.0.1:' + server.address().port
    for (const { name, method } of endpoints) {
      const oldRequestID = name + '-old'
      const options = method === 'POST' ? {
        method, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths: ['foo'] }),
      } : { method }
      const old = requests.run(senderA, oldRequestID, async signal => {
        const result = await fetch(base + '/' + name + '/old', { ...options, signal })
        return result.text()
      })
      const obsolete = old.then(() => 'unexpected completion', () => 'cancelled')
      await waitUntil(() => state.oldActive === 1, 'admit old ' + name)
      const newPromise = requests.run(senderA, name + '-new', async signal => {
        const response = await fetch(base + '/' + name + '/new', { ...options, signal })
        return response.json()
      })
      const independent = requests.run(senderB, oldRequestID, async signal => {
        const response = await fetch(base + '/' + name + '/new', { ...options, signal })
        return response.json()
      })
      requests.cancel(senderA, oldRequestID)
      assert.equal(await obsolete, 'cancelled', name + ' obsolete request must reject')
      await waitUntil(() => state.oldActive === 0, 'old ' + name + ' socket close')
      assert.deepEqual(await newPromise, { ok: true }, 'foreground read must complete')
      assert.deepEqual(await independent, { ok: true }, 'another window must remain independent')
      assert.equal(state.oldBytes, 0, 'old request body bytes must be zero')
      for (const task of durable) assert.equal(task.signal.aborted, false)
    }
    assert.equal(state.oldClosed, endpoints.length)
    assert.equal(state.fresh, endpoints.length * 2)
    requests.cancel(senderA, 'pre-admission')
    await assert.rejects(requests.run(senderA, 'pre-admission', () => Promise.resolve('bad')),
      /cancelled before admission/)
    assert.equal(await requests.run(senderB, 'pre-admission', () => Promise.resolve('good')), 'good')
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
