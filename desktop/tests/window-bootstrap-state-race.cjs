const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, '..', 'src', 'renderer', 'App.tsx')

function originalBootstrapEffect() {
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
      if (body.includes('xdriveDesktop.getWindowState().then') &&
          body.includes('xdriveDesktop.onWindowState(') &&
          body.includes('unsubscribeTransfers()')) {
        callback = body
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, 'must execute the authentic Desktop window state bootstrap effect')
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

function mountBootstrap(initialWindowState) {
  const noop = () => {}
  const noSubscription = () => noop
  let onWindowState = null
  let maximized = null
  const writes = []
  const window = {
    xdriveDesktop: {
      getInfo: async () => ({}),
      getPreferences: async () => ({}),
      getLoginHistory: async () => ({ profiles: [], secure_password_storage: false }),
      getWindowState: () => initialWindowState.promise,
      onLoginHistory: noSubscription,
      onWindowState: (handler) => {
        onWindowState = handler
        return () => { onWindowState = null }
      },
      onNavigate: noSubscription,
      agent: {
        getState: async () => ({ connected: false, status: null }),
        onState: noSubscription,
        onTransfers: noSubscription,
      },
    },
  }
  const effect = compileBootstrap(originalBootstrapEffect(), {
    window,
    setInfo: noop,
    setDesktopPreferences: noop,
    setLoginHistory: noop,
    setServer: noop,
    setUsername: noop,
    setLoginMount: noop,
    setRememberPassword: noop,
    setAutoLogin: noop,
    setWindowMaximized: (value) => {
      maximized = value
      writes.push(value)
    },
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
      assert.equal(typeof onWindowState, 'function',
        'original App must subscribe to live Electron window-state IPC')
      onWindowState(value)
    },
    maximized: () => maximized,
    writes,
    cleanup,
  }
}

test('Desktop delayed unmaximized bootstrap cannot undo a newer maximize IPC event', async () => {
  const old = deferred()
  const renderer = mountBootstrap(old)
  try {
    renderer.emit({ maximized: true })
    assert.equal(renderer.maximized(), true, 'new maximize event must publish')
    old.resolve({ maximized: false })
    await flush()
    assert.equal(renderer.maximized(), true,
      'stale initial unmaximized snapshot must not undo a later maximized state')
    assert.deepEqual(renderer.writes, [true],
      'obsolete unmaximized bootstrap must never be re-published')
  } finally {
    renderer.cleanup()
  }
})

test('Desktop delayed maximized bootstrap cannot undo a newer restore IPC event', async () => {
  const old = deferred()
  const renderer = mountBootstrap(old)
  try {
    renderer.emit({ maximized: false })
    assert.equal(renderer.maximized(), false, 'new restore event must publish')
    old.resolve({ maximized: true })
    await flush()
    assert.equal(renderer.maximized(), false,
      'stale initial maximized snapshot must not undo a newer restore')
    assert.deepEqual(renderer.writes, [false])
  } finally {
    renderer.cleanup()
  }
})

test('Desktop first window-state snapshot still applies with no intervening IPC event', async () => {
  const first = deferred()
  const renderer = mountBootstrap(first)
  try {
    first.resolve({ maximized: true })
    await flush()
    assert.equal(renderer.maximized(), true)
    assert.deepEqual(renderer.writes, [true])
  } finally {
    renderer.cleanup()
  }
})

test('Desktop unmounted bootstrap cannot publish a late window-state snapshot', async () => {
  const old = deferred()
  const renderer = mountBootstrap(old)
  renderer.cleanup()
  old.resolve({ maximized: false })
  await flush()
  assert.deepEqual(renderer.writes, [])
})
