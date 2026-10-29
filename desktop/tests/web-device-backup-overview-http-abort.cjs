'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/api.ts')
const source = fs.readFileSync(filename, 'utf8')
const web = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')

function realOverviewMethod() {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const klass = ast.statements.find(node =>
    ts.isClassDeclaration(node) && node.name?.text === 'XDriveApi')
  assert.ok(klass)
  const method = klass.members.find(node =>
    ts.isMethodDeclaration(node) && node.name?.getText(ast) === 'deviceBackups')
  assert.ok(method)
  const js = ts.transpileModule('const api = {' + method.getText(ast) + '};', {
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
  assert.fail('timeout: ' + label)
}

test('real Web Device Backup GET passes optional read signal with unchanged Owner endpoint', async () => {
  const api = realOverviewMethod(), calls = []
  api.request = async (route, options) => {
    calls.push([route, options?.signal])
    return { devices: [] }
  }
  const controller = new AbortController()
  assert.deepEqual(await api.deviceBackups(controller.signal), { devices: [] })
  assert.deepEqual(calls, [['/api/v1/device-backups', controller.signal]])
  assert.match(web, /list: \(signal\?: AbortSignal\) => api\.deviceBackups\(signal\)/)
  assert.match(source, /private async request<T>\(path: string, init: RequestInit = \{\}/)
  assert.match(source, /xDriveFetchPwaSafeRead\(`\$\{API_BASE\}\$\{path\}`, path, \{ \.\.\.init, headers \}\)/)
  for (const forbidden of ['api.deviceBackupsPage(limit, afterDeviceID, signal)',
    'api.deviceBackupFoldersPage(deviceID, limit, afterSourceID, signal)']) {
    assert.equal(web.includes(forbidden), false, 'do not expand cancellation to unrelated page loads')
  }
})

test('real Web device overview GET releases stale socket and admits successor', async () => {
  const requests = []
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/api/v1/device-backups') {
      res.writeHead(404); res.end(); return
    }
    const row = { sentBytes: 0, earlyClosed: false }
    requests.push(row)
    res.once('close', () => { row.earlyClosed = !res.writableEnded })
    if (requests.length === 1) return
    const bytes = Buffer.from(JSON.stringify({ devices: [] }))
    row.sentBytes = bytes.length
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(bytes)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const api = realOverviewMethod()
  api.request = async (route, options) => {
    const response = await fetch(base + route, options)
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    const oldController = new AbortController()
    const stale = api.deviceBackups(oldController.signal)
    await until(() => requests.length === 1, 'old overview GET started')
    oldController.abort()
    await assert.rejects(stale, err => err?.name === 'AbortError')
    await until(() => requests[0].earlyClosed, 'old socket released')
    assert.equal(requests[0].sentBytes, 0)
    assert.deepEqual(await api.deviceBackups(), { devices: [] })
    assert.equal(requests.length, 2)
    assert.equal(requests[1].earlyClosed, false)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

test('device overview cancellation never sends durable backup command', () => {
  const api = realOverviewMethod()
  const controller = new AbortController()
  const calls = []
  api.request = async (url, init) => { calls.push({ url, init }); return { devices: [] } }
  return api.deviceBackups(controller.signal).then(() => {
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.signal, controller.signal)
    assert.equal(calls[0].init.method, undefined)
    assert.equal(calls[0].url, '/api/v1/device-backups')
    assert.doesNotMatch(source.slice(source.indexOf('  deviceBackups('),
      source.indexOf('  deviceBackupsPage(')), /POST|PATCH|DELETE|\/run|\/trigger/)
  })
})
