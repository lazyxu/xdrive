const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, '..', 'src', 'renderer', 'App.tsx')

function bootstrapEffect() {
  const file = ts.createSourceFile(
    filename, fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  )
  let callback = null
  function visit(node) {
    if (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'useEffect' &&
        node.arguments.length >= 2) {
      const body = node.arguments[0].getText(file)
      if (body.includes('xdriveDesktop.agent.getState().then') &&
          body.includes('xdriveDesktop.agent.onState(') &&
          body.includes('unsubscribeTransfers()')) {
        callback = body
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, 'Desktop must retain its authentic initial Agent state/IPC subscription effect')
  return callback
}

function compileBootstrap(callback, bindings) {
  const output = ts.transpileModule(
    'const effect = ' + callback + ';',
    { fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    } },
  ).outputText
  const names = Object.keys(bindings)
  return new Function(...names, output + '\nreturn effect')(...names.map((name) => bindings[name]))
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('Desktop late bootstrap Agent IPC response cannot replace newer switched-account state', async () => {
  const callback = bootstrapEffect()
  const pendingOld = deferred()
  const old = { connected: true, status: { server: 'server-a', username: 'account-a' } }
  const current = { connected: true, status: { server: 'server-b', username: 'account-b' } }
  let listener = null
  let latest = null
  const writes = []
  const noop = () => {}
  const unsubscribe = () => noop
  const window = {
    xdriveDesktop: {
      getInfo: async () => ({}),
      getPreferences: async () => ({}),
      getLoginHistory: async () => ({ profiles: [], secure_password_storage: false }),
      getWindowState: async () => ({ maximized: false }),
      onLoginHistory: unsubscribe,
      onWindowState: unsubscribe,
      onNavigate: unsubscribe,
      agent: {
        getState: () => pendingOld.promise,
        onState: (onState) => {
          listener = onState
          return () => { listener = null }
        },
        onTransfers: unsubscribe,
      },
    },
  }
  const effect = compileBootstrap(callback, {
    window,
    setAgent: (value) => {
      latest = value
      writes.push(value)
    },
    setInfo: noop,
    setDesktopPreferences: noop,
    setLoginHistory: noop,
    setServer: noop,
    setUsername: noop,
    setLoginMount: noop,
    setRememberPassword: noop,
    setAutoLogin: noop,
    setWindowMaximized: noop,
    transfersRevisionRef: { current: 0 },
    setTransfers: noop,
    setSettingsOpen: noop,
    setView: noop,
    setTransferPopoverOpen: noop,
  })
  const cleanup = effect()
  try {
    assert.equal(typeof listener, 'function', 'real App effect must subscribe to Agent IPC state')
    listener(current)
    assert.equal(latest?.status?.server, 'server-b', 'new account state IPC event must apply')
    pendingOld.resolve(old)
    await flush()
    assert.equal(latest?.status?.server, 'server-b',
      'late bootstrap response for old server must not overwrite newer onState session')
    assert.equal(latest?.status?.username, 'account-b')
    assert.deepEqual(writes.map((entry) => entry.status?.server), ['server-b'],
      'stale bootstrap response must never be published to renderer state')
  } finally {
    if (typeof cleanup === 'function') cleanup()
  }
})
