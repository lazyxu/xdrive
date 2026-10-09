const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/ServerUpdateController.ts')
const source = fs.readFileSync(filename, 'utf8')
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function actual(name, env) {
  const hook = ast.statements.find((node) => ts.isFunctionDeclaration(node) &&
    node.name?.text === 'useXDriveServerUpdateController')
  assert.ok(hook, 'must extract real shared Server Update hook')
  let initializer
  function walk(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      initializer = node.initializer?.getText(ast)
    }
    ts.forEachChild(node, walk)
  }
  walk(hook)
  assert.ok(initializer?.startsWith('useCallback('), 'missing original ' + name + ' callback')
  const code = ts.transpileModule('const actualCallback = ' + initializer + ';', {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
    fileName: filename,
  }).outputText
  const keys = Object.keys(env)
  return new Function(...keys, code + '\nreturn actualCallback;')(...keys.map((key) => env[key]))
}

function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function update(state, extras = {}) {
  return { supported: true, state, source: 'github', channel: 'stable', ...extras }
}
function fixture(port) {
  const events = []
  let state = null
  let busy = false
  let error = ''
  const stateRef = { current: null }
  const fields = {
    enabled: true, supported: true, busy: false,
    useCallback: (fn) => fn,
    resolveXDriveTransport: async (response) => response,
    port,
    source: 'github', channel: 'stable', backupFileData: false,
    forbiddenMessage: 'forbidden', loadErrorMessage: 'load failed',
    activeReconnectMessage: 'reconnect',
    errorStatus: (e) => typeof e?.status === 'number' ? e.status : undefined,
    updateActive: (s) => s?.state === 'queued' || s?.state === 'running',
    errorMessage: (e, fallback) => e instanceof Error && e.message.trim()
      ? e.message.trim() : fallback,
    stateRef,
    refreshRequestRef: { current: 0 },
    startInFlightRef: { current: false },
    applyState: (next) => { state = next; stateRef.current = next; error = '' },
    setState: (next) => { state = next; stateRef.current = next },
    setBusy: (next) => { busy = next },
    setError: (next) => { error = next },
    onBusyChange: (next) => { events.push(next) },
  }
  return {
    fields, events,
    get state() { return state },
    get busy() { return busy },
    get error() { return error },
    refresh: () => actual('refresh', fields),
    start: () => actual('start', fields),
  }
}

test('Server Update: slow old poll must not overwrite newer completed poll status', async () => {
  const old = deferred()
  let index = 0
  const f = fixture({ getState: () => ++index === 1
    ? old.promise : Promise.resolve(update('running', {stage: 'download', stage_current: 8})) })
  const inFlight = f.refresh()()
  await f.refresh()()
  assert.equal(f.state.stage_current, 8)
  old.resolve(update('idle', {stage_current: 0}))
  await inFlight
  assert.equal(f.state.state, 'running', 'stale interval response must not regress Server Update progress')
  assert.equal(f.state.stage_current, 8)
})

test('Server Update: stale unauthorized error must not replace newer successful status', async () => {
  const old = deferred()
  let index = 0
  const f = fixture({ getState: () => ++index === 1
    ? old.promise : Promise.resolve(update('queued', {request_id: 'req-1'})) })
  const inFlight = f.refresh()()
  await f.refresh()()
  const forbidden = Object.assign(new Error('stale 403'), {status: 403})
  old.reject(forbidden)
  await inFlight
  assert.equal(f.state.state, 'queued', 'stale 403 must not turn a current Server Update into unavailable')
})

test('Server Update: old poll must not overwrite startUpdate accepted task', async () => {
  const old = deferred()
  const f = fixture({
    getState: () => old.promise,
    startUpdate: async () => update('queued', {request_id: 'new-task'}),
  })
  const pendingPoll = f.refresh()()
  await f.start()()
  assert.equal(f.state.request_id, 'new-task')
  old.resolve(update('idle'))
  await pendingPoll
  assert.equal(f.state.request_id, 'new-task', 'poll started before Start must not overwrite accepted task')
})

test('Server Update: two same-tick Start clicks must not submit duplicate update requests', async () => {
  const completion = deferred()
  let count = 0
  const f = fixture({startUpdate: () => { count += 1; return completion.promise }})
  const callback = f.start()
  const first = callback()
  const second = callback()
  assert.equal(count, 1, 'pending Start action must be immediate single-flight before React re-render')
  completion.resolve(update('queued', {request_id: 'new-task'}))
  await Promise.all([first, second])
  assert.deepEqual(f.events, [true, false])
})
