const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const mainFile = path.join(__dirname, '..', 'src', 'main', 'index.cts')
const productionFunctions = ['publishAgentState', 'refreshAgentState']

function originalMainFunctions() {
  const source = ts.createSourceFile(mainFile, fs.readFileSync(mainFile, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name &&
      productionFunctions.includes(statement.name.text)) {
      found.set(statement.name.text, statement.getText(source))
    }
  }
  assert.deepEqual([...found.keys()].sort(), [...productionFunctions].sort(),
    'exercise original Electron Main publication and refresh bodies')
  return productionFunctions.map((name) => found.get(name)).join('\n\n')
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const oldReply = deferred()
  const oldEntered = deferred()
  let statusCalls = 0
  const events = []
  const oldHello = { agent_version: 'test-v1' }
  const currentHello = { agent_version: 'test-v2' }
  const newest = { configured: true, auth_status: 'authenticated', username: 'current-B' }
  const old = { configured: false, auth_status: 'unauthenticated', username: 'obsolete-A' }
  const initial = { connected: false, error: 'booting' }
  const extracted = [
    'let agentState = initialState',
    originalMainFunctions(),
  ].join('\n\n')
  const emitted = ts.transpileModule(extracted, {
    fileName: mainFile,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const deps = {
    exports: {}, initialState: initial,
    requireAgentLifecycle: () => ({
      ensureRunning: async () => statusCalls === 0 ? oldHello : currentHello,
    }),
    requireAgentClient: () => ({ status: async () => {
      if (++statusCalls === 1) {
        oldEntered.resolve()
        return oldReply.promise
      }
      return newest
    } }),
    agentError: (err) => ({
      message: err instanceof Error ? err.message : String(err),
    }),
    resetSourceRunNotificationState: () => {},
    notifyAgentTransition: () => {},
    rebuildTrayMenu: () => {},
    updateTaskbarOverlay: () => {},
    updateTaskbarProgress: () => {},
    mainWindow: {
      isDestroyed: () => false,
      webContents: { send: (type, state) => events.push({ type, state }) },
    },
  }
  const keys = Object.keys(deps)
  const main = new Function(...keys, emitted +
    '\nreturn { refreshAgentState, publishAgentState, current: () => agentState }')(
    ...keys.map((key) => deps[key]))
  return { ...main, oldReply, oldEntered, old, newest, events,
    statusCallCount: () => statusCalls }
}

async function overlappingRefresh(oldOutcome) {
  const f = fixture()
  const earlier = f.refreshAgentState()
  await f.oldEntered.promise
  assert.equal(f.statusCallCount(), 1, 'old status request must be held')
  const newer = f.refreshAgentState()
  await newer
  assert.equal(f.current().status.username, 'current-B',
    'new B committed while A remains suspended')
  assert.equal(f.events.length, 1)

  if (oldOutcome === 'success') f.oldReply.resolve(f.old)
  else f.oldReply.reject(new Error('obsolete A status failure'))
  await earlier

  assert.equal(f.current().connected, true, 'old result must not disconnect B')
  assert.equal(f.current().status.username, 'current-B',
    'old result must not rewind newer authenticated account B')
  assert.equal(f.events.length, 1,
    'stale refresh must not publish a new IPC agent:state event')
}

test('old Main refresh success must not rewind newer authenticated Agent status', async () => {
  await overlappingRefresh('success')
})

test('old Main refresh error must not disconnect a newly authenticated Agent', async () => {
  await overlappingRefresh('error')
})

test('old Main refresh cannot overwrite newer monitor-published Agent status', async () => {
  const f = fixture()
  const earlier = f.refreshAgentState()
  await f.oldEntered.promise
  f.publishAgentState({
    connected: true, hello: { agent_version: 'monitor' }, status: f.newest,
  })
  assert.equal(f.events.length, 1)
  f.oldReply.resolve(f.old)
  await earlier
  assert.equal(f.current().status.username, 'current-B')
  assert.equal(f.events.length, 1)
})

test('uncontested sequential Main refresh preserves genuine Agent updates', async () => {
  const f = fixture()
  const earlier = f.refreshAgentState()
  await f.oldEntered.promise
  f.oldReply.resolve(f.old)
  await earlier
  assert.equal(f.current().status.username, 'obsolete-A')
  assert.equal(f.events.length, 1)
  await f.refreshAgentState()
  assert.equal(f.current().status.username, 'current-B')
  assert.equal(f.events.length, 2)
})
