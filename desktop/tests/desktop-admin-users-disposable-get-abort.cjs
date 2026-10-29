'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const agent = read('desktop/src/main/agent_client.cts')
const main = read('desktop/src/main/index.cts')
const preload = read('desktop/src/preload/index.cts')
const types = read('desktop/src/renderer/global.d.ts')
const renderer = read('desktop/src/renderer/App.tsx')

test('Desktop administrator Users listing alone carries sender-scoped HTTP cancellation', () => {
  const segment = main.split("ipcMain.handle('agent:cloud-admin-users',")[1]
    ?.split("ipcMain.handle('agent:cloud-admin-users-create'")[0]
  assert.ok(segment, 'GET handler and existing CREATE mutation must remain distinct')
  assert.match(segment, /viewportRequests\.run\(event\.sender, requestID, async signal =>/)
  assert.match(segment, /await requireDesktopAdminUsers\(\)/,
    'Server-confirmed administrator capability must be checked before issuing GET')
  assert.match(segment, /if \(signal\?\.aborted\) throw new AgentIPCError\('aborted'/)
  assert.match(segment, /admin\.cloudAdminUsers\(signal\)/)
  assert.match(agent, /cloudAdminUsers\(signal\?: AbortSignal\)/)
  const readSegment = agent.split('  cloudAdminUsers(')[1]
    ?.split('  cloudAdminCreateUser(')[0]
  assert.ok(readSegment)
  assert.match(readSegment, /this\.request<AgentAdminUser\[\]>\('GET', '\/v1\/cloud\/admin-users',[\s\S]*?10_000, signal\)/)
  assert.match(preload, /cloudAdminUsers: \(requestID\?: string\) => ipcRenderer\.invoke\('agent:cloud-admin-users', requestID\)/)
  assert.match(types, /cloudAdminUsers: \(requestID\?: string\)/)
  assert.match(renderer, /adminUsers: async \(signal\?: AbortSignal\) => \{[\s\S]*?xDriveDesktopViewportRequest\(signal, requestID =>[\s\S]*?cloudAdminUsers\(requestID\)/)
  for (const operation of [
    'cloudAdminCreateUser', 'cloudAdminUpdateUser', 'cloudAdminResetUserPassword',
    'cloudAdminRevokeUserSessions', 'cloudAdminDeleteUser',
  ]) {
    assert.match(renderer, new RegExp('agent\\.' + operation + '\\('),
      'existing durable administrator action must remain independent')
  }
  assert.doesNotMatch(segment, /create|update|revoke|delete|reset-password/i,
    'disposable GET handler must not contain mutation control')
})

function realViewportHelper() {
  const file = 'desktop/src/renderer/abortableViewportRequest.ts'
  const js = ts.transpileModule(read(file), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', js)(mod.exports, mod)
  return mod.exports.xDriveDesktopViewportRequest
}
async function until(predicate, reason) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('timed out: ' + reason)
}

test('real HTTP: superseded Admin Users GET closes while authorized create POST continues', async () => {
  const oldReads = [], mutations = []
  const server = http.createServer((req, res) => {
    const entry = { res, closedEarly: false, bytes: 0 }
    res.once('close', () => { entry.closedEarly = !res.writableEnded })
    if (req.method === 'POST') {
      mutations.push(entry)
      req.resume()
      return
    }
    oldReads.push(entry)
    if (oldReads.length === 1) return // old Admin Users GET, held pending
    const body = JSON.stringify([{ id: 20, username: 'current-user' }])
    entry.bytes = Buffer.byteLength(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = 'http://127.0.0.1:' + server.address().port
  const controllers = new Map(), cancelled = []
  const oldWindow = global.window
  global.window = { xdriveDesktop: { agent: {
    cancelViewportRequest: async id => {
      cancelled.push(id)
      controllers.get(id)?.abort()
      return { ok: true, data: { cancelled: true } }
    },
  } } }
  try {
    const persistentWrite = new AbortController()
    const write = fetch(url + '/users', {
      method: 'POST', body: 'approved admin mutation', signal: persistentWrite.signal,
    }).then(r => r.text())
    const stale = new AbortController()
    const helper = realViewportHelper()
    const older = helper(stale.signal, id => {
      const fetchAbort = new AbortController()
      controllers.set(id, fetchAbort)
      return fetch(url + '/users', { signal: fetchAbort.signal }).then(r => r.json())
    })
    await until(() => oldReads.length === 1 && mutations.length === 1,
      'old authorized list GET and real separate pending write POST')
    stale.abort()
    await assert.rejects(older, error => error?.name === 'AbortError')
    await until(() => oldReads[0].closedEarly, 'cancelled GET disconnect')
    assert.equal(oldReads[0].bytes, 0)
    assert.equal(cancelled.length, 1)
    assert.equal(persistentWrite.signal.aborted, false)
    assert.equal(mutations[0].res.destroyed, false)
    const next = await helper(undefined, () => fetch(url + '/users').then(r => r.json()))
    assert.deepEqual(next, [{ id: 20, username: 'current-user' }])
    mutations[0].res.writeHead(200, { 'Content-Type': 'text/plain' })
    mutations[0].res.end('committed')
    assert.equal(await write, 'committed')
    assert.equal(mutations[0].closedEarly, false)
  } finally {
    if (oldWindow === undefined) delete global.window
    else global.window = oldWindow
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
