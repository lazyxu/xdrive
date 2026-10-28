'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/ServiceDependenciesPage.tsx'
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const component = read(file)
function inventoryEffect() {
  const ast = ts.createSourceFile(file, component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback = null, dependencies = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' && node.arguments.length >= 2) {
      const text = node.arguments[0].getText(ast)
      if (text.includes('snapshotSourceRef.current !== source') &&
          text.includes('source.load(controller.signal)')) {
        callback = text
        dependencies = node.arguments[1].elements?.map(x => x.getText(ast)) ?? []
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback, 'real shared Admin inventory effect must be found, not mocked')
  assert.deepEqual(dependencies, ['source', 'refreshID'])
  const compiled = ts.transpileModule('const callback = ' + callback + ';', {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return env => new Function(...Object.keys(env), compiled + '\nreturn callback')(...Object.values(env))
}
const invoke = inventoryEffect()
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
async function until(condition, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timeout waiting for ' + label)
}

test('accepted Admin inventory A→B cancels stale A without clearing new Owner snapshot', async () => {
  const old = deferred()
  const calls = [], accepted = [], errors = []
  const a = { load: signal => { calls.push({ owner: 'A', signal }); return old.promise } }
  const b = { load: signal => { calls.push({ owner: 'B', signal }); return Promise.resolve({ owner: 'B' }) } }
  const snapshotSourceRef = { current: null }
  const cachedSnapshotRef = { current: null }
  const env = source => ({
    source, snapshotSourceRef, cachedSnapshotRef,
    setSnapshot: value => accepted.push(value),
    setLoading: () => {}, setRefreshing: () => {}, setError: value => errors.push(value),
    xDriveCoreDependencyErrorMessage: e => String(e),
  })
  const cleanupA = invoke(env(a))()
  assert.equal(calls[0].signal.aborted, false)
  cleanupA()
  assert.equal(calls[0].signal.aborted, true, 'departing Admin page aborts old HTTP signal')
  const cleanupB = invoke(env(b))()
  await flush()
  assert.equal(calls[1].signal.aborted, false, 'new Owner never inherits the old abort')
  assert.deepEqual(accepted.at(-1), { owner: 'B' })
  old.resolve({ owner: 'A' })
  await flush()
  assert.deepEqual(accepted.at(-1), { owner: 'B' }, 'stale A cannot override current B')
  assert.equal(cachedSnapshotRef.current.owner, 'B')
  assert.deepEqual(errors, [])
  cleanupB()
  assert.equal(calls[1].signal.aborted, true)
})

test('Admin refresh aborts previous same-Owner inventory and preserves accepted status while pending', async () => {
  const pending = deferred()
  const calls = [], displays = [], errors = []
  const source = { load: signal => {
    calls.push(signal)
    return calls.length === 1 ? pending.promise : Promise.resolve({ id: 'fresh' })
  } }
  const snapshotSourceRef = { current: source }
  const cachedSnapshotRef = { current: { id: 'last-accepted' } }
  const makeEnv = () => ({
    source, snapshotSourceRef, cachedSnapshotRef,
    setSnapshot: value => displays.push(value),
    setLoading: () => {}, setRefreshing: () => {}, setError: value => errors.push(value),
    xDriveCoreDependencyErrorMessage: error => String(error),
  })
  const cleanupOld = invoke(makeEnv())()
  assert.equal(displays.length, 0,
    'status-only refresh does not clear last accepted snapshot while GET is pending')
  cleanupOld()
  const cleanupNew = invoke(makeEnv())()
  await flush()
  assert.deepEqual(displays, [{ id: 'fresh' }])
  pending.reject(new Error('obsolete response failed'))
  await flush()
  assert.deepEqual(errors.filter(Boolean), [], 'old rejected GET cannot show a false error')
  assert.equal(cachedSnapshotRef.current.id, 'fresh')
  cleanupNew()
})

test('actual loopback Admin GET closes obsolete socket while successor obtains fresh status', async () => {
  const state = { started: 0, closed: 0, oldBytes: 0 }
  const server = http.createServer((req, res) => {
    if (req.url === '/old') {
      state.started++
      const timer = setTimeout(() => {
        if (res.destroyed) return
        state.oldBytes += 16384
        res.end(Buffer.alloc(16384))
      }, 650)
      res.once('close', () => { clearTimeout(timer); state.closed++ })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ state: 'verified' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const env = source => ({
    source, snapshotSourceRef: { current: source }, cachedSnapshotRef: { current: null },
    setSnapshot: () => {}, setLoading: () => {}, setRefreshing: () => {}, setError: () => {},
    xDriveCoreDependencyErrorMessage: e => String(e),
  })
  let cleanupA, cleanupB
  try {
    const base = 'http://127.0.0.1:' + server.address().port
    cleanupA = invoke(env({ load: signal => fetch(base + '/old', { signal }).then(r => r.json()) }))()
    await until(() => state.started === 1, 'old Admin GET admitted')
    cleanupA()
    cleanupB = invoke(env({ load: signal => fetch(base + '/new', { signal }).then(r => r.json()) }))()
    await flush()
    await until(() => state.closed === 1, 'obsolete HTTP socket closed')
    assert.equal(state.oldBytes, 0, 'old Admin GET sends no delayed payload bytes')
  } finally {
    cleanupA?.()
    cleanupB?.()
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})

test('only inventory GET passes its optional signal: Save, Caddy deploy and rollback are unchanged', () => {
  const api = read('web/src/api.ts')
  const app = read('web/src/App.tsx')
  const src = read(file)
  assert.match(src, /load: \(signal\?: AbortSignal\) => Promise<XDriveServiceDependenciesSnapshot>/)
  assert.match(src, /source\.load\(controller\.signal\)/)
  assert.match(src, /return \(\) => \{ active = false; controller\.abort\(\) \}/)
  assert.match(src, /const status = await source\.load\(\)/,
    'explicit authorized post-save status refreshes are not blindly aborted')
  assert.match(api, /adminServices\(signal\?: AbortSignal\) \{\s*return this\.request<XDriveServiceDependenciesSnapshot>\('\/api\/v1\/admin\/services', \{ signal \}\)/)
  assert.match(app, /load: \(signal\?: AbortSignal\) => api\.adminServices\(signal\)/)
  for (const prohibited of ['cancelTransfer', 'cancelBackup', 'cancelUpload', 'terminateWorker']) {
    assert.ok(!src.slice(src.indexOf('const sourceChanged = snapshotSourceRef.current !== source'),
      src.indexOf('const revealBaiduAK = async')).includes(prohibited))
  }
})
