const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

// Execute the actual shared Web/Desktop hook with React state/effects rather
// than a rewritten version of the background control callback.
const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'ui/shared/src/mui/TaskCenterController.ts')
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText
const modules = {
  react: React,
  '..': {
    XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT: 50,
    xDriveActiveFileOperationCount: () => 0,
    xDriveBackgroundTaskPollIntervalMs: () => 60_000,
    xDriveBackgroundTaskSummaryPollIntervalMs: () => 60_000,
    xDriveFileOperationHasHistory: () => false,
    xDriveNormalizeBackgroundTaskPage: value => value,
  },
  '../transfers': {
    xDriveActiveTransferCount: () => 0,
    xDriveNetworkTransferTasks: () => [],
    xDriveTransferHasHistory: () => false,
  },
}
const bundle = { exports: {} }
new Function('exports', 'module', 'require', code)(
  bundle.exports, bundle,
  name => {
    if (!Object.hasOwn(modules, name)) throw Error('unexpected dependency ' + name)
    return modules[name]
  },
)
const useController = bundle.exports.useXDriveTaskCenterController

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const emptyPage = { current_items: [], history_items: [], next_cursor: '' }
const port = control => ({ loadMinePage: async () => emptyPage, control })
const operationActions = { busy: false, clearHistoryLoading: false }
function makeProps(backgroundTaskPort, backgroundTasksLifecycleKey, onBackgroundTaskError) {
  return {
    transfers: [], operations: [], operationActions,
    backgroundTaskPort, backgroundTasksLifecycleKey, backgroundTasksEnabled: true,
    backgroundTasksVisible: true, globalTasksEnabled: false,
    onBackgroundTaskError,
  }
}
async function mount(backgroundTaskPort, lifecycleKey = 'account-A', onError = () => {}) {
  const oldWindow = globalThis.window
  globalThis.window = {
    setInterval: () => Symbol('controller poll'),
    clearInterval: () => {},
  }
  const holder = { controller: null }
  function Harness(props) {
    holder.controller = useController(props)
    return React.createElement('task-probe', {
      controlKey: holder.controller.pageProps.backgroundControlKey,
    })
  }
  let view
  try {
    await act(async () => {
      view = renderer.create(React.createElement(Harness,
        makeProps(backgroundTaskPort, lifecycleKey, onError)))
      await flush()
    })
  } catch (error) {
    globalThis.window = oldWindow
    throw error
  }
  return {
    get page() { return holder.controller.pageProps },
    async switchTo(nextPort, nextIdentity, onErrorHandler = onError) {
      await act(async () => {
        view.update(React.createElement(Harness,
          makeProps(nextPort, nextIdentity, onErrorHandler)))
        await flush()
      })
    },
    async dispose() {
      try { await act(async () => { view.unmount(); await flush() }) }
      finally { globalThis.window = oldWindow }
    },
  }
}

test('Background Task Center: same-render Cancel must send one Server control command', async () => {
  const held = deferred(), calls = []
  const f = await mount(port((id, action, global) => {
    calls.push([id, action, global])
    return held.promise
  }))
  try {
    const click = f.page.onBackgroundTaskControl
    assert.equal(typeof click, 'function')
    await act(async () => {
      click({ id: 'durable-A' }, 'cancel')
      click({ id: 'durable-A' }, 'cancel')
      await flush()
    })
    const received = [...calls]
    await act(async () => { held.resolve(); await flush() })
    assert.deepEqual(received, [['durable-A', 'cancel', false]],
      'two clicks using the same rendered handler must not duplicate a durable Cancel')
  } finally {
    held.resolve()
    await f.dispose()
  }
})

test('Background Task Center: old-account Busy must not block new-account control', async () => {
  const heldA = deferred(), callsA = [], callsB = []
  const accountA = port((id, action) => { callsA.push([id, action]); return heldA.promise })
  const accountB = port(async (id, action) => { callsB.push([id, action]) })
  const f = await mount(accountA, 'session-A')
  try {
    await act(async () => {
      f.page.onBackgroundTaskControl({ id: 'private-A' }, 'cancel')
      await flush()
    })
    assert.deepEqual(callsA, [['private-A', 'cancel']])
    await f.switchTo(accountB, 'session-B')
    await act(async () => {
      f.page.onBackgroundTaskControl({ id: 'public-B' }, 'retry')
      await flush()
    })
    assert.deepEqual(callsB, [['public-B', 'retry']],
      'pending work from another account must not disable the new owner Task Center')
  } finally {
    await act(async () => { heldA.resolve(); await flush() })
    await f.dispose()
  }
})

test('Background Task Center: late old-account failure must not surface in new account', async () => {
  const heldA = deferred(), errors = []
  const accountA = port(() => heldA.promise)
  const accountB = port(async () => {})
  const f = await mount(accountA, 'session-A', reason => errors.push(reason.message))
  try {
    await act(async () => {
      f.page.onBackgroundTaskControl({ id: 'private-A' }, 'retry')
      await flush()
    })
    await f.switchTo(accountB, 'session-B')
    await act(async () => {
      heldA.reject(new Error('private account A stale control error'))
      await flush()
    })
    assert.deepEqual(errors, [],
      'a stale A request must not publish an error after session B is current')
  } finally {
    heldA.resolve()
    await f.dispose()
  }
})

test('Background Task Center: ordinary one-shot control still refreshes once', async () => {
  const calls = []
  const f = await mount(port(async (id, action) => { calls.push([id, action]) }))
  try {
    await act(async () => {
      f.page.onBackgroundTaskControl({ id: 'durable-A' }, 'cancel')
      await flush()
    })
    assert.deepEqual(calls, [['durable-A', 'cancel']])
    assert.equal(f.page.backgroundControlKey, '')
  } finally { await f.dispose() }
})
