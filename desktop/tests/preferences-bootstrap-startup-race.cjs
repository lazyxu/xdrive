const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, '..', 'src', 'renderer', 'App.tsx')

function authenticCallbacks() {
  const sourceFile = ts.createSourceFile(
    filename, fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  )
  let bootstrap = null
  let setStartup = null
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'useEffect' && node.arguments.length >= 2) {
      const source = node.arguments[0].getText(sourceFile)
      if (source.includes('xdriveDesktop.getPreferences().then') &&
          source.includes('unsubscribeTransfers()')) {
        bootstrap = source
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === 'changeStartAtLogin' && node.initializer) {
      setStartup = node.initializer.getText(sourceFile)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(bootstrap, 'must exercise the authentic Desktop bootstrap effect')
  assert.ok(setStartup, 'must exercise the authentic Desktop start-at-login handler')
  return { bootstrap, setStartup }
}

function compile(source, bindings) {
  const output = ts.transpileModule(
    source,
    { fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    } },
  ).outputText
  const keys = Object.keys(bindings)
  return new Function(...keys, output + '\nreturn { bootstrap, changeStartAtLogin }')(
    ...keys.map((key) => bindings[key]))
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

function preferences(startAtLogin) {
  return {
    appearance: 'system',
    start_at_login: startAtLogin,
    close_to_tray: true,
    close_behavior_prompted: false,
    window_maximized: false,
  }
}

function mountBootstrap(pending, initialEnabled) {
  const noop = () => {}
  const noSubscription = () => noop
  let current = preferences(initialEnabled)
  const writes = []
  const window = {
    xdriveDesktop: {
      getInfo: async () => ({}),
      getPreferences: () => pending.promise,
      getLoginHistory: async () => ({ profiles: [], secure_password_storage: false }),
      getWindowState: async () => ({ maximized: false }),
      onLoginHistory: noSubscription,
      onWindowState: noSubscription,
      onNavigate: noSubscription,
      setStartup: async (enabled) => ({ ok: true, data: { start_at_login: enabled } }),
      agent: {
        getState: async () => ({ connected: false, status: null }),
        onState: noSubscription,
        onTransfers: noSubscription,
      },
    },
  }
  const setDesktopPreferences = (update) => {
    current = typeof update === 'function' ? update(current) : update
    writes.push(current.start_at_login)
  }
  const callbacks = authenticCallbacks()
  const actual = compile(
    'const bootstrap = ' + callbacks.bootstrap +
    ';\nconst changeStartAtLogin = ' + callbacks.setStartup + ';',
    {
      window,
      setInfo: noop,
      setDesktopPreferences,
      setLoginHistory: noop,
      setServer: noop,
      setUsername: noop,
      setLoginMount: noop,
      setRememberPassword: noop,
      setAutoLogin: noop,
      setWindowMaximized: noop,
      setAgent: noop,
      transfersRevisionRef: { current: 0 },
      setTransfers: noop,
      setSettingsOpen: noop,
      setView: noop,
      setTransferPopoverOpen: noop,
      setError: noop,
      setNotice: noop,
    },
  )
  const cleanup = actual.bootstrap()
  return {
    changeStartAtLogin: actual.changeStartAtLogin,
    current: () => current,
    writes,
    cleanup,
  }
}

test('Desktop stale preferences bootstrap cannot re-enable startup after a saved disable', async () => {
  const pendingOld = deferred()
  const app = mountBootstrap(pendingOld, true)
  try {
    await app.changeStartAtLogin(false)
    assert.equal(app.current().start_at_login, false, 'saved disable must update Renderer')
    pendingOld.resolve(preferences(true))
    await flush()
    assert.equal(app.current().start_at_login, false,
      'late startup-enabled snapshot must not overwrite the successfully saved disable')
    assert.deepEqual(app.writes, [false],
      'older initial preferences must not publish after a successful user change')
  } finally {
    app.cleanup()
  }
})

test('Desktop stale preferences bootstrap cannot disable startup after a saved enable', async () => {
  const pendingOld = deferred()
  const app = mountBootstrap(pendingOld, false)
  try {
    await app.changeStartAtLogin(true)
    assert.equal(app.current().start_at_login, true, 'saved enable must update Renderer')
    pendingOld.resolve(preferences(false))
    await flush()
    assert.equal(app.current().start_at_login, true,
      'late startup-disabled snapshot must not overwrite the successfully saved enable')
    assert.deepEqual(app.writes, [true])
  } finally {
    app.cleanup()
  }
})

test('Desktop uncontested initial preferences response still initializes the UI', async () => {
  const initial = deferred()
  const app = mountBootstrap(initial, true)
  try {
    initial.resolve(preferences(false))
    await flush()
    assert.equal(app.current().start_at_login, false)
    assert.deepEqual(app.writes, [false])
  } finally {
    app.cleanup()
  }
})

test('Desktop unmounted preferences effect discards a delayed initial response', async () => {
  const pending = deferred()
  const app = mountBootstrap(pending, true)
  app.cleanup()
  pending.resolve(preferences(false))
  await flush()
  assert.deepEqual(app.writes, [])
})
