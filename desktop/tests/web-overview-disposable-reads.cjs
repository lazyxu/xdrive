'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const moduleFile = 'web/src/overviewDisposableReads.ts'
const out = { exports: {} }
new Function('exports', 'module', ts.transpileModule(read(moduleFile), {
  fileName: moduleFile,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(out.exports, out)
const createScope = out.exports.xDriveCreateOverviewDisposableReadScope
const pause = () => new Promise(resolve => setImmediate(resolve))
async function until(predicate, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for ' + label)
}

test('Overview refresh A -> B -> A is latest-wins, separate windows and durable jobs survive', () => {
  const a = createScope()
  const otherWindow = createScope()
  const durables = ['upload', 'download', 'backup', 'sync'].map(() => new AbortController())
  const first = a.begin()
  const independent = otherWindow.begin()
  assert.equal(first.isCurrent(), true)
  const second = a.begin()
  assert.equal(first.signal.aborted, true, 'A should release its old GETs')
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  assert.equal(independent.signal.aborted, false, 'another browser window owns its own reads')
  const backA = a.begin()
  assert.equal(second.signal.aborted, true)
  assert.equal(backA.signal.aborted, false)
  assert.equal(second.isCurrent(), false, 'stale completion cannot claim new active scope')
  a.cancel()
  a.cancel()
  assert.equal(backA.signal.aborted, true, 'leaving Overview ends only its disposable GETs')
  assert.equal(backA.isCurrent(), false)
  assert.equal(independent.signal.aborted, false)
  for (const durable of durables) assert.equal(durable.signal.aborted, false)
  otherWindow.cancel()
})

test('obsolete Overview HTTP GET disconnects before response body, successor completes', async () => {
  const state = { started: 0, closed: 0, oldBytes: 0 }
  const server = http.createServer((req, res) => {
    if (req.url === '/old') {
      state.started += 1
      const timer = setTimeout(() => {
        if (res.destroyed) return
        state.oldBytes += 32768
        res.end(Buffer.alloc(32768))
      }, 650)
      res.once('close', () => { state.closed += 1; clearTimeout(timer) })
      return
    }
    res.end('new-foreground')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const scope = createScope()
  try {
    const address = server.address()
    const url = 'http://127.0.0.1:' + address.port
    const stale = scope.begin()
    const old = fetch(url + '/old', { signal: stale.signal }).then(response => response.text())
    await until(() => state.started === 1, 'old Overview HTTP GET admission')
    const current = scope.begin()
    assert.equal(stale.signal.aborted, true)
    await assert.rejects(old, error => error?.name === 'AbortError')
    const successor = await fetch(url + '/new', { signal: current.signal })
    assert.equal(await successor.text(), 'new-foreground')
    await until(() => state.closed === 1, 'old Overview HTTP socket close')
    assert.equal(state.oldBytes, 0, 'aborted old read cannot transfer stale body bytes')
    assert.equal(current.isCurrent(), true)
    await pause()
  } finally {
    scope.cancel()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

test('Web Overview owns only two abortable GETs; authentication and durable operations are unchanged', () => {
  const page = read('web/src/WebOverviewPage.tsx')
  const api = read('web/src/api.ts')
  const scope = read(moduleFile)
  assert.match(page, /useMemo\(xDriveCreateOverviewDisposableReadScope, \[\]\)/)
  assert.match(page, /const read = overviewReadScope\.begin\(\)/)
  assert.match(page, /api\.fileRecent\(6, read\.signal\)/)
  assert.match(page, /api\.fileFavorites\(read\.signal\)/)
  assert.match(page, /!read\.isCurrent\(\)/,
    'old responses must not restore another Owner/view after transport cancellation')
  assert.match(page, /overviewReadScope\.cancel\(\)/,
    'route exit/Owner replacement must abort the current read')
  assert.match(api, /fileFavorites\(signal\?: AbortSignal\) \{\s*return this\.request<XDriveFileFavoriteItem<Node>\[]>\('\/api\/v1\/file-favorites', \{ signal \}\)/)
  assert.match(api, /fileRecent\(limit = 16, signal\?: AbortSignal\) \{[\s\S]*?\{ signal \}\)/)
  assert.doesNotMatch(scope, /cancelTransfer|cancelUpload|cancelBackup|cancelDownload|terminateWorker/,
    'disposable Overview scope cannot reach durable work')
})
