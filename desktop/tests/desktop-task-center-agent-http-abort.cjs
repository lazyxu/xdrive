'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const ts = require('typescript')
const repo = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(repo, name), 'utf8')
const agent = read('desktop/src/main/agent_client.cts')
const main = read('desktop/src/main/index.cts')
const preload = read('desktop/src/preload/index.cts')
const globals = read('desktop/src/renderer/global.d.ts')
const renderer = read('desktop/src/renderer/App.tsx')

test('Desktop Task Center GETs use an existing sender-scoped viewport contract end-to-end', () => {
  for (const [channel, method, capability] of [
    ['agent:cloud-background-task-summary', 'cloudBackgroundTaskActiveSummary', 'background-task-summary'],
    ['agent:cloud-background-task-page', 'cloudBackgroundTaskPage', 'background-tasks'],
  ]) {
    const segment = main.split("ipcMain.handle(").find(s => s.includes("'" + channel + "'"))
    assert.ok(segment, 'must register ' + channel)
    assert.match(segment, /viewportRequests\.run\(event\.sender, requestID, async signal =>/,
      'sender ownership and cancel-before-admission required: ' + channel)
    assert.ok(segment.includes("requireAgentCapability(hello, '" + capability + "')"),
      'existing capability gate must remain: ' + channel)
    assert.match(segment, new RegExp('requireAgentClient\\(\\)\\.' + method + '\\([^)]*signal'),
      'actual HTTP method must receive the scoped AbortSignal: ' + channel)
  }
  assert.match(agent, /cloudBackgroundTaskActiveSummary\(signal\?: AbortSignal\)/)
  assert.match(agent, /cloudBackgroundTaskPage\(global = false, limit = 50, cursor = '', signal\?: AbortSignal\)/)
  const summary = agent.split('  cloudBackgroundTaskActiveSummary(')[1]?.split('  cloudBackgroundTaskPage(')[0]
  const page = agent.split('  cloudBackgroundTaskPage(')[1]?.split('  cloudBackgroundTasks(')[0]
  for (const segment of [summary, page]) {
    assert.ok(segment)
    assert.match(segment, /this\.request<AgentBackgroundTask.*?>\([\s\S]*?'GET',[\s\S]*?10_000, signal/,
      'GET must forward AbortSignal to Node Agent HTTP, not only fence late UI')
  }
  assert.match(preload, /ipcRenderer\.invoke\('agent:cloud-background-task-summary', requestID\)/)
  assert.match(preload, /ipcRenderer\.invoke\('agent:cloud-background-task-page', global, limit, cursor, requestID\)/)
  assert.match(globals, /cloudBackgroundTaskActiveSummary: \(requestID\?: string\)/)
  assert.match(globals, /cloudBackgroundTaskPage: \([\s\S]*?requestID\?: string/)
  assert.match(renderer, /loadActiveSummary:[\s\S]*?xDriveDesktopViewportRequest\(signal, requestID =>/)
  assert.match(renderer, /loadMinePage:[\s\S]*?xDriveDesktopViewportRequest\(signal, requestID =>/)
  assert.match(renderer, /loadGlobalPage:[\s\S]*?xDriveDesktopViewportRequest\(signal, requestID =>/)
  const control = main.split("ipcMain.handle('agent:cloud-background-task-control'")[1]
  assert.ok(control)
  assert.doesNotMatch(control.split("ipcMain.handle(", 1)[0], /viewportRequests\.run/,
    'durable Server control cannot be registered as a disposable GET')
  assert.match(agent, /cloudBackgroundTaskControl\(id: string, action: string, global = false\)/)
  assert.match(renderer, /cloudBackgroundTaskControl\(\s*id,\s*action,\s*global/)
})

function loadRealViewportHelper() {
  const file = 'desktop/src/renderer/abortableViewportRequest.ts'
  const js = ts.transpileModule(read(file), {
    fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', js)(mod.exports, mod)
  return mod.exports.xDriveDesktopViewportRequest
}
async function until(predicate, label) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('timed out: ' + label)
}

test('real HTTP: Task Center viewport cancels only obsolete GET sockets; durable POST remains live', async () => {
  const requests = [], controls = []
  const server = http.createServer((req, res) => {
    const item = { path: req.url, method: req.method, closedEarly: false, bytes: 0, res }
    if (req.method === 'POST') {
      controls.push(item)
      req.resume()
    } else requests.push(item)
    res.once('close', () => { item.closedEarly = !res.writableEnded })
    if (req.method === 'GET' && req.url === '/current') {
      const body = '{"current_items":[]}'
      item.bytes = Buffer.byteLength(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const requestControllers = new Map(), cancelledIDs = [], userWindow = global.window
  const helper = loadRealViewportHelper()
  global.window = { xdriveDesktop: { agent: {
    cancelViewportRequest: async id => {
      cancelledIDs.push(id)
      requestControllers.get(id)?.abort()
      return { ok: true, data: { cancelled: true } }
    },
  } } }
  try {
    const persistentControl = new AbortController()
    const post = fetch(base + '/task-control', { method: 'POST',
      body: 'approved durable task control', signal: persistentControl.signal }).then(r => r.text())
    const older = new AbortController()
    const oldTaskGET = helper(older.signal, requestID => {
      assert.match(requestID, /^viewport-/)
      const physical = new AbortController()
      requestControllers.set(requestID, physical)
      return fetch(base + '/tasks', { signal: physical.signal }).then(r => r.text())
    })
    await until(() => requests.some(x => x.path === '/tasks') && controls.length === 1,
      'one task GET and one durable Server control POST')
    older.abort()
    await assert.rejects(oldTaskGET, error => error?.name === 'AbortError')
    await until(() => requests.find(x => x.path === '/tasks').closedEarly,
      'old task HTTP socket closes after scoped IPC Cancel')
    assert.equal(requests.find(x => x.path === '/tasks').bytes, 0,
      'old task GET must not transfer discarded response bytes')
    assert.equal(cancelledIDs.length, 1)
    assert.equal(persistentControl.signal.aborted, false)
    assert.ok(!controls[0].res.destroyed,
      'durable task control POST is still in flight during read cancellation')
    const newRead = await helper(undefined, () =>
      fetch(base + '/current').then(r => r.json()))
    assert.deepEqual(newRead, { current_items: [] })
    controls[0].res.writeHead(200, { 'Content-Type': 'text/plain' })
    controls[0].res.end('completed')
    assert.equal(await post, 'completed')
    assert.equal(controls[0].closedEarly, false)
  } finally {
    if (userWindow === undefined) delete global.window
    else global.window = userWindow
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
