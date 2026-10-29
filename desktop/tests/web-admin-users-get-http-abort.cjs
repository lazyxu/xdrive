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
function realAdminUsers() {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const owner = ast.statements.find(node =>
    ts.isClassDeclaration(node) && node.name?.text === 'XDriveApi')
  assert.ok(owner, 'real Web authenticated API class must exist')
  const method = owner.members.find(node =>
    ts.isMethodDeclaration(node) && node.name?.getText(ast) === 'adminUsers')
  assert.ok(method, 'real Web adminUsers method must exist')
  const js = ts.transpileModule('const delegate = {' + method.getText(ast) + '};', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(js + '\nreturn delegate;')()
}
async function until(predicate, label) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('timed out: ' + label)
}

test('actual Web adminUsers method aborts old HTTP GET before its body and allows successor', async () => {
  const received = []
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/api/v1/admin/users') {
      res.writeHead(404); res.end(); return
    }
    const entry = { res, sentBytes: 0, earlyClosed: false }
    received.push(entry)
    res.once('close', () => { entry.earlyClosed = !res.writableEnded })
    if (received.length === 1) return // slow obsolete Owner list
    const body = JSON.stringify([{ id: 22, username: 'current' }])
    entry.sentBytes = Buffer.byteLength(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const api = realAdminUsers()
  api.request = async (route, init = {}) => {
    const response = await fetch(base + route, init)
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    const stale = new AbortController()
    const abandoned = api.adminUsers(stale.signal)
    await until(() => received.length === 1, 'old Users list GET starts')
    stale.abort()
    await assert.rejects(abandoned, error => error?.name === 'AbortError')
    await until(() => received[0].earlyClosed, 'old Users list socket closed')
    assert.equal(received[0].sentBytes, 0)
    const result = await api.adminUsers()
    assert.deepEqual(result, [{ id: 22, username: 'current' }])
    assert.equal(received.length, 2)
    assert.equal(received[1].earlyClosed, false)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

test('adminUsers forwards optional abort through authenticated request, not through mutations', () => {
  const api = realAdminUsers()
  const received = []
  api.request = async (route, init) => {
    received.push({ route, signal: init?.signal })
    return []
  }
  const controller = new AbortController()
  return api.adminUsers(controller.signal).then(() => {
    assert.deepEqual(received, [{ route: '/api/v1/admin/users', signal: controller.signal }])
    assert.match(source, /private async request<T>\(path: string, init: RequestInit = \{\}/)
    assert.match(source, /xDriveFetchPwaSafeRead\(\x60\$\{API_BASE\}\$\{path\}\x60, path, \{ \.\.\.init, headers \}\)/)
    for (const method of ['adminCreateUser', 'adminUpdateUser', 'adminResetPassword',
      'adminRevokeSessions', 'adminDeleteUser']) {
      assert.ok(source.includes(method + '('), 'durable mutation unaffected: ' + method)
    }
  })
})
