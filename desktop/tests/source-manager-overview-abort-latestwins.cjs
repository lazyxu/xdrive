'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const component = 'ui/shared/src/mui/SourceManager.tsx'
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = read(component)

function actualLoad(env) {
  const ast = ts.createSourceFile(component, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const owner = ast.statements.find(item =>
    ts.isFunctionDeclaration(item) && item.name?.text === 'XDriveSourceManager')
  assert.ok(owner, 'real common SourceManager must exist')
  let initializer
  function walk(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.name.text === 'load') initializer = node.initializer?.getText(ast)
    ts.forEachChild(node, walk)
  }
  walk(owner)
  assert.ok(initializer?.startsWith('useCallback('), 'test executes actual production load callback')
  const code = ts.transpileModule('const actual = ' + initializer + ';', {
    fileName: component, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const names = Object.keys(env)
  return new Function(...names, code + '\nreturn actual')(
    ...names.map(name => env[name]))
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(adapter, { directionFilter, mounted = true } = {}) {
  const reads = [], accepted = [], errors = [], loading = [], loaded = [], failures = []
  const overviewMountedRef = { current: mounted }
  const overviewReadRef = { current: null }
  const overviewRequestRef = { current: 0 }
  const overviewOwnerRef = { current: { adapter, directionFilter } }
  let selected = null
  const env = {
    useCallback: callback => callback, adapter, directionFilter,
    overviewMountedRef, overviewReadRef, overviewRequestRef, overviewOwnerRef,
    setLoading: next => loading.push(next),
    setLoadError: value => failures.push(value),
    setHasLoaded: value => loaded.push(value),
    setRows: rows => accepted.push(rows),
    setSelected: update => { selected = typeof update === 'function' ? update(selected) : update },
    onError: error => errors.push(error),
  }
  return {
    load: actualLoad(env), overviewMountedRef, overviewReadRef, overviewOwnerRef,
    reads, accepted, errors, loading, loaded, failures,
    get selected() { return selected },
    close() {
      overviewMountedRef.current = false
      overviewReadRef.current?.abort()
      overviewRequestRef.current += 1
    },
  }
}
function overview(id, direction = 'pull') {
  return [{ source: { id, direction }, latest_run: null, credential: null }]
}

test('SourceManager new Owner and same-kind route supersede old GET without showing private rows', async () => {
  const aGate = deferred(), bGate = deferred(), signals = []
  const a = { sourceOverview: signal => { signals.push(['A', signal]); return aGate.promise } }
  const b = { sourceOverview: signal => { signals.push(['B', signal]); return bGate.promise } }
  const old = fixture(a), newPage = fixture(b)
  const pendingA = old.load()
  assert.equal(signals[0][1].aborted, false)
  old.overviewOwnerRef.current = { adapter: b, directionFilter: undefined }
  old.close()
  assert.equal(signals[0][1].aborted, true)
  const pendingB = newPage.load()
  bGate.resolve(overview(22))
  await pendingB
  aGate.resolve(overview(11))
  await pendingA
  assert.deepEqual(old.accepted, [], 'old account must not repaint a stale Source overview')
  assert.deepEqual(newPage.accepted.map(rows => rows.map(row => row.source.id)), [[22]])
  assert.deepEqual(old.errors, [], 'late old Owner completion must be silent')
  assert.equal(newPage.loaded.at(-1), true)
  newPage.close()
})

test('SourceManager new refresh cancels in-flight overview even if old transport ignores abort', async () => {
  const old = deferred(), current = deferred(), signals = []
  let attempt = 0
  const port = { sourceOverview: signal => {
    signals.push(signal)
    return ++attempt === 1 ? old.promise : current.promise
  } }
  const page = fixture(port, { directionFilter: 'pull' })
  const stale = page.load()
  const winner = page.load(true)
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[1].aborted, false)
  current.resolve([...overview(50), ...overview(51, 'push')])
  await winner
  old.resolve(overview(49))
  await stale
  assert.deepEqual(page.accepted.map(rows => rows.map(row => row.source.id)), [[50]],
    'only the newest exact direction-filtered source rows are admitted')
  assert.deepEqual(page.errors, [])
  assert.equal(page.loading.at(-1), true, 'silent poll does not show a new full-page overlay')
  page.close()
})

test('SourceManager latest rejected GET retains previous rows and shows a genuine error', async () => {
  const rejectable = deferred()
  const api = { sourceOverview: () => rejectable.promise }
  const page = fixture(api)
  const load = page.load()
  rejectable.reject(new Error('Server temporarily unavailable'))
  await load
  assert.equal(page.failures.at(-1), true)
  assert.equal(page.loaded.at(-1), true)
  assert.equal(page.loading.at(-1), false)
  assert.equal(page.errors.length, 1)
  assert.equal(page.accepted.length, 0, 'failure must not invent an authoritative empty list')
  page.close()
})

test('SourceManager closed page cannot launch a new read after an old mutation finishes', async () => {
  let count = 0
  const port = { sourceOverview: async () => { count++; return overview(60) } }
  const page = fixture(port)
  await page.load()
  page.close()
  await page.load()
  assert.equal(count, 1)
  assert.equal(page.accepted.length, 1)
  for (const name of ['triggerSource', 'cancelSourceRun', 'updateSource', 'deleteSource',
    'setSourceCredential', 'setSourceConnectorConfig']) {
    assert.match(source, new RegExp('adapter\\.' + name + '\\('),
      name + ' remains an independent durable operation')
  }
})

test('Host normalizer passes optional SourceOverview signal but fences legacy synthetic aggregate', () => {
  const factory = read('ui/shared/src/mui/SourceManagerAdapter.ts')
  assert.match(factory, /sourceOverview: \(signal\) => port\.sourceOverview/)
  assert.match(factory, /port\.sourceOverview\(signal\)/)
  assert.match(factory, /synthesizedSourceOverview\(port, signal\)/)
  assert.match(factory, /port\.sources\(signal\)/)
  assert.match(factory, /signal\?\.throwIfAborted\(\)/)
  assert.match(source, /overviewReadRef\.current\?\.abort\(\)/)
  assert.match(source, /overviewMountedRef\.current = false/)
  assert.doesNotMatch(source.slice(source.indexOf('  const load = useCallback(async (silent'),
      source.indexOf('  const loadRunFailures = useCallback')),
    /cancelSourceRun\(|deleteSource\(|triggerSource\(/,
    'a disposable overview read cannot command a durable source mutation')
})
