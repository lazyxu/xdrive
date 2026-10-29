'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const apiFile = path.join(root, 'web/src/api.ts')
const apiSource = fs.readFileSync(apiFile, 'utf8')

function extractRealMethod() {
  const ast = ts.createSourceFile(apiFile, apiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) &&
    node.name?.text === 'XDriveApi')
  assert.ok(klass, 'actual authenticated XDriveApi class required')
  const method = klass.members.find(node =>
    ts.isMethodDeclaration(node) && node.name?.getText(ast) === 'sourceOverview')
  assert.ok(method, 'real read-only Source Overview method required')
  const compiled = ts.transpileModule('const api = {' + method.getText(ast) + '};', {
    fileName: apiFile, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(compiled + '\nreturn api')()
}
async function until(predicate, label) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('timed out: ' + label)
}

test('actual Web SourceOverview GET uses optional signal without adding any mutation cancellation', async () => {
  const api = extractRealMethod(), calls = []
  api.request = async (url, options) => {
    calls.push({ url, signal: options?.signal, method: options?.method })
    return []
  }
  const controller = new AbortController()
  assert.deepEqual(await api.sourceOverview(controller.signal), [])
  assert.deepEqual(calls, [{
    url: '/api/v1/sources/overview', signal: controller.signal, method: undefined,
  }])
  assert.match(apiSource, /private async request<T>\(path: string, init: RequestInit = \{\}/)
  assert.match(apiSource, /xDriveFetchPwaSafeRead\(`\$\{API_BASE\}\$\{path\}`, path, \{ \.\.\.init, headers \}\)/)
  for (const mutation of [
    'triggerSource(sourceID: number)', 'cancelSourceRun(sourceID: number, runID: string)',
    'updateSource(', 'deleteSource(', 'setSourceCredential(',
  ]) {
    assert.ok(apiSource.includes(mutation), 'durable Source operation must stay available: ' + mutation)
  }
})

test('actual SourceOverview GET abort disconnects old local HTTP socket and admits a later valid GET', async () => {
  const received = []
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/api/v1/sources/overview') {
      res.writeHead(404); res.end(); return
    }
    const record = { response: res, earlyClosed: false, bytes: 0 }
    received.push(record)
    res.once('close', () => { record.earlyClosed = !res.writableEnded })
    if (received.length === 1) return // an obsolete slow, owner-bound read
    const bytes = Buffer.from(JSON.stringify([{ source: { id: 3, direction: 'pull' } }]))
    record.bytes = bytes.length
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(bytes)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const api = extractRealMethod()
  api.request = async (route, options) => {
    const response = await fetch(base + route, options)
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    const old = new AbortController()
    const stale = api.sourceOverview(old.signal)
    await until(() => received.length === 1, 'old Source GET is admitted')
    old.abort()
    await assert.rejects(stale, error => error?.name === 'AbortError')
    await until(() => received[0].earlyClosed, 'old owner read socket closes')
    assert.equal(received[0].bytes, 0, 'old owner must transfer no stale response bytes')
    const accepted = await api.sourceOverview()
    assert.equal(accepted[0].source.id, 3)
    assert.equal(received.length, 2)
    assert.equal(received[1].earlyClosed, false)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
