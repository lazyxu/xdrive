'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/api.ts')
const source = fs.readFileSync(filename, 'utf8')
const web = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
const names = [
  'backgroundTaskActiveSummary',
  'backgroundTaskPage',
  'adminBackgroundTaskPage',
]
function realAPI() {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const klass = ast.statements.find(item =>
    ts.isClassDeclaration(item) && item.name?.text === 'XDriveApi')
  assert.ok(klass)
  const methods = names.map(name => {
    const method = klass.members.find(item =>
      ts.isMethodDeclaration(item) && item.name?.getText(ast) === name)
    assert.ok(method, 'real XDriveApi.' + name + ' is required')
    return method.getText(ast)
  })
  const js = ts.transpileModule('const api = {\n' + methods.join(',\n') + '\n};', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(js + '\nreturn api')()
}
async function until(predicate, label) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('timed out: ' + label)
}

test('real Web task read methods forward optional signal without altering cursor or durable controls', async () => {
  const api = realAPI(), calls = []
  api.request = async (url, init) => {
    calls.push({ url, signal: init?.signal })
    return { current_items: [], history_items: [], next_cursor: '' }
  }
  const controller = new AbortController()
  await api.backgroundTaskActiveSummary(controller.signal)
  await api.backgroundTaskPage(50, 'opaque:mine', controller.signal)
  await api.adminBackgroundTaskPage(20, 'opaque:global', controller.signal)
  assert.deepEqual(calls.map(x => x.signal), Array(3).fill(controller.signal))
  assert.equal(calls[0].url, '/api/v1/background-tasks/active-summary')
  assert.match(calls[1].url, /^\/api\/v1\/background-tasks\/page\?/)
  assert.match(calls[1].url, /cursor=opaque%3Amine/)
  assert.match(calls[2].url, /^\/api\/v1\/admin\/background-tasks\/page\?/)
  assert.match(calls[2].url, /cursor=opaque%3Aglobal/)
  assert.ok(web.includes('loadActiveSummary: (signal?: AbortSignal) => api.backgroundTaskActiveSummary(signal)'))
  assert.ok(web.includes('api.backgroundTaskPage(limit, cursor, signal)'))
  assert.ok(web.includes('api.adminBackgroundTaskPage(limit, cursor, signal)'))
  assert.ok(web.includes('api.controlBackgroundTask(id, action, global)'))
  assert.ok(!web.includes('api.controlBackgroundTask(id, action, global, signal)'),
    'durable Server control must never inherit page-disposable AbortSignal')
})

test('real task summary, Mine and Global history methods abort old HTTP sockets, new reads work', async () => {
  const count = new Map(), received = []
  const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0]
    const index = (count.get(pathname) ?? 0) + 1
    count.set(pathname, index)
    const item = { pathname, index, bytes: 0, closedEarly: false }
    received.push(item)
    res.once('close', () => { item.closedEarly = !res.writableEnded })
    if (index === 1) return // a slow, obsolete GET awaiting preemption
    const body = JSON.stringify(pathname.endsWith('active-summary')
      ? { active_total: 0, file_operation: 0 }
      : { current_items: [], history_items: [], next_cursor: '' })
    item.bytes = Buffer.byteLength(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const api = realAPI()
  api.request = async (route, init) => {
    const response = await fetch(base + route, init)
    assert.equal(response.status, 200)
    return response.json()
  }
  const cases = [
    ['/api/v1/background-tasks/active-summary', signal => api.backgroundTaskActiveSummary(signal)],
    ['/api/v1/background-tasks/page', signal => api.backgroundTaskPage(50, 'opaque:one', signal)],
    ['/api/v1/admin/background-tasks/page', signal => api.adminBackgroundTaskPage(50, 'opaque:two', signal)],
  ]
  try {
    for (const [pathname, get] of cases) {
      const old = new AbortController()
      const stale = get(old.signal)
      await until(() => received.some(item => item.pathname === pathname && item.index === 1),
        pathname + ' slow GET starts')
      old.abort()
      await assert.rejects(stale, error => error?.name === 'AbortError')
      await until(() => received.some(item => item.pathname === pathname &&
        item.index === 1 && item.closedEarly), pathname + ' old socket disconnects')
      const row = received.find(item => item.pathname === pathname && item.index === 1)
      assert.equal(row.bytes, 0, 'cancelled task read must not send stale body bytes')
      const fresh = await get(undefined)
      assert.ok(fresh && typeof fresh === 'object')
      assert.ok(received.some(item => item.pathname === pathname && item.index === 2),
        'subsequent current task GET succeeds without waiting for the stale one')
    }
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
