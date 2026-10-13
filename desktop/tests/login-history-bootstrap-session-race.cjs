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
      if (body.includes('xdriveDesktop.getLoginHistory().then') &&
          body.includes('xdriveDesktop.onLoginHistory(') &&
          body.includes('unsubscribeTransfers()')) {
        callback = body
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, 'must exercise the real Desktop login history bootstrap effect')
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

function mountBootstrap(pendingHistory) {
  const noop = () => {}
  const noSubscription = () => noop
  let historyListener = null
  let latestHistory = null
  const historyWrites = []
  const profileInputs = []
  const window = {
    xdriveDesktop: {
      getInfo: async () => ({}),
      getPreferences: async () => ({}),
      getLoginHistory: () => pendingHistory.promise,
      getWindowState: async () => ({ maximized: false }),
      onLoginHistory: (handler) => {
        historyListener = handler
        return () => { historyListener = null }
      },
      onWindowState: noSubscription,
      onNavigate: noSubscription,
      agent: {
        getState: async () => ({ connected: false, status: null }),
        onState: noSubscription,
        onTransfers: noSubscription,
      },
    },
  }
  const effect = compileBootstrap(bootstrapEffect(), {
    window,
    setInfo: noop,
    setDesktopPreferences: noop,
    setLoginHistory: (value) => {
      latestHistory = value
      historyWrites.push(value.profiles[0]?.server || '')
    },
    setServer: (value) => { profileInputs.push(['server', value]) },
    setUsername: (value) => { profileInputs.push(['username', value]) },
    setLoginMount: (value) => { profileInputs.push(['mount', value]) },
    setRememberPassword: (value) => { profileInputs.push(['remember', value]) },
    setAutoLogin: (value) => { profileInputs.push(['auto', value]) },
    setWindowMaximized: noop,
    setAgent: noop,
    transfersRevisionRef: { current: 0 },
    setTransfers: noop,
    setSettingsOpen: noop,
    setView: noop,
    setTransferPopoverOpen: noop,
  })
  const cleanup = effect()
  return {
    emit: (value) => {
      assert.equal(typeof historyListener, 'function', 'must subscribe to actual login history IPC')
      historyListener(value)
    },
    latest: () => latestHistory,
    writes: historyWrites,
    inputs: profileInputs,
    cleanup,
  }
}

const oldHistory = {
  profiles: [{
    server: 'https://old.example', username: 'account-a',
    mount_path: '/mnt/a', remember_password: true, auto_login: true,
  }],
  secure_password_storage: true,
}
const newHistory = {
  profiles: [{
    server: 'https://new.example', username: 'account-b',
    mount_path: '/mnt/b', remember_password: true, auto_login: false,
  }],
  secure_password_storage: true,
}

test('Desktop old login history bootstrap must not erase newer IPC history or restore old account inputs', async () => {
  const pendingOld = deferred()
  const renderer = mountBootstrap(pendingOld)
  try {
    renderer.emit(newHistory)
    assert.equal(renderer.latest()?.profiles[0]?.server, 'https://new.example')
    pendingOld.resolve(oldHistory)
    await flush()
    assert.equal(renderer.latest()?.profiles[0]?.server, 'https://new.example',
      'late account A bootstrap must not replace newer account B login history')
    assert.deepEqual(renderer.writes, ['https://new.example'],
      'old initial history must not be published after IPC change')
    assert.deepEqual(renderer.inputs, [],
      'old account must not silently overwrite server, user and login preference inputs')
  } finally {
    renderer.cleanup()
  }
})

test('Desktop first login history snapshot still populates form when no IPC update occurred', async () => {
  const pendingInitial = deferred()
  const renderer = mountBootstrap(pendingInitial)
  try {
    pendingInitial.resolve(oldHistory)
    await flush()
    assert.equal(renderer.latest()?.profiles[0]?.server, 'https://old.example')
    assert.deepEqual(renderer.writes, ['https://old.example'])
    assert.deepEqual(renderer.inputs, [
      ['server', 'https://old.example'],
      ['username', 'account-a'],
      ['mount', '/mnt/a'],
      ['remember', true],
      ['auto', true],
    ])
  } finally {
    renderer.cleanup()
  }
})
