'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { create, act } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/TaskCenterController.ts')
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText
const stubs = {
  react: React,
  '..': {
    XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT: 50,
    xDriveActiveFileOperationCount: () => 0,
    xDriveBackgroundTaskPollIntervalMs: () => 60_000,
    xDriveBackgroundTaskSummaryPollIntervalMs: () => 60_000,
    xDriveFileOperationHasHistory: () => false,
    xDriveNormalizeBackgroundTaskPage: value => value,
  },
  './TaskWakeRefresh': { xDriveBindTaskWakeRefresh: () => () => {} },
  '../transfers': {
    xDriveActiveTransferCount: () => 0,
    xDriveNetworkTransferTasks: () => [],
    xDriveTransferHasHistory: () => false,
  },
}
const moduleInstance = { exports: {} }
new Function('exports', 'module', 'require', code)(
  moduleInstance.exports, moduleInstance,
  name => {
    if (!Object.hasOwn(stubs, name)) throw new Error('unexpected dependency ' + name)
    return stubs[name]
  },
)
const useController = moduleInstance.exports.useXDriveTaskCenterController
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const emptyPage = { current_items: [], history_items: [], next_cursor: '' }
function pending() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}
const operationActions = { busy: false, clearHistoryLoading: false }
const makeProps = (backgroundTaskPort, extras = {}) => ({
  transfers: [], operations: [], operationActions,
  backgroundTaskPort, backgroundTasksLifecycleKey: 'owner-one',
  backgroundTasksEnabled: true, backgroundTasksVisible: true,
  globalTasksEnabled: true, ...extras,
})

async function mount(initialPort, extras = {}) {
  const oldWindow = globalThis.window
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} }
  const holder = { current: null }
  function Harness(props) {
    holder.current = useController(props)
    return React.createElement('task-probe')
  }
  let view
  try {
    await act(async () => {
      view = create(React.createElement(Harness, makeProps(initialPort, extras)))
      await flush()
    })
  } catch (error) {
    globalThis.window = oldWindow
    throw error
  }
  return {
    get controller() { return holder.current },
    async update(port = initialPort, next = {}) {
      await act(async () => {
        view.update(React.createElement(Harness, makeProps(port, next)))
        await flush()
      })
    },
    async close() {
      try { await act(async () => { view.unmount(); await flush() }) }
      finally { globalThis.window = oldWindow }
    },
  }
}

test('Task Center route exit abandons only Mine/Global list GET; badge summary remains usable', async () => {
  const mine = pending(), summary = pending()
  const signals = { mine: [], summary: [] }
  const port = {
    loadActiveSummary: signal => {
      signals.summary.push(signal)
      return summary.promise
    },
    loadMinePage: (_limit, _cursor, signal) => {
      signals.mine.push(signal)
      return mine.promise
    },
    loadGlobalPage: async () => emptyPage,
  }
  const app = await mount(port)
  try {
    assert.equal(signals.mine.length, 1)
    assert.equal(signals.summary.length, 1)
    assert.equal(signals.mine[0].aborted, false)
    await app.update(port, { backgroundTasksVisible: false })
    assert.equal(signals.mine[0].aborted, true,
      'leaving Task Center must abort disposable list transport, not merely fence stale rows')
    assert.equal(signals.summary[0].aborted, false,
      'summary badge is still needed while the Task Center is offscreen')
  } finally {
    mine.resolve(emptyPage)
    summary.resolve({ active_total: 0, file_operation: 0 })
    await app.close()
  }
})

test('Task Center latest-wins pagination and scope switch never abort durable task controls', async () => {
  const summary = pending(), first = pending(), oldCursor = pending(), global = pending()
  const signals = { first: [], cursor: [], global: [], control: [] }
  let pageNumber = 0
  const port = {
    loadActiveSummary: () => summary.promise,
    loadMinePage: (_limit, cursor, signal) => {
      if (cursor) { signals.cursor.push(signal); return oldCursor.promise }
      signals.first.push(signal)
      pageNumber++
      return pageNumber === 1
        ? Promise.resolve({ ...emptyPage, next_cursor: 'mine-old' })
        : first.promise
    },
    loadGlobalPage: (_limit, _cursor, signal) => {
      signals.global.push(signal)
      return global.promise
    },
    control: async (id, action, isGlobal) => {
      signals.control.push([id, action, isGlobal])
    },
  }
  const app = await mount(port)
  try {
    assert.equal(app.controller.pageProps.backgroundHasMore, true)
    await act(async () => {
      app.controller.pageProps.onLoadMoreBackground()
      await flush()
    })
    assert.equal(signals.cursor.length, 1)
    assert.equal(signals.cursor[0].aborted, false)
    await act(async () => {
      app.controller.refreshBackgroundTasks()
      await flush()
    })
    assert.equal(signals.cursor[0].aborted, true,
      'new first Range must abort old cursor even when old loader ignores signal')
    assert.equal(signals.first.length, 2)
    assert.equal(signals.first[1].aborted, false)
    await app.update(port, { backgroundScope: 'global' })
    assert.equal(signals.first[1].aborted, true,
      'scope Mine -> Global must cancel obsolete in-flight Mine GET')
    assert.equal(signals.global.at(-1)?.aborted, false)
    await act(async () => {
      app.controller.pageProps.onBackgroundTaskControl({ id: 'durable-1' }, 'retry')
      await flush()
    })
    assert.deepEqual(signals.control, [['durable-1', 'retry', true]],
      'foreground read preemption must not abort, retry or duplicate durable controls')
    assert.equal(signals.global.at(-1)?.aborted, false)
  } finally {
    first.resolve(emptyPage)
    oldCursor.resolve(emptyPage)
    global.resolve(emptyPage)
    summary.resolve({ active_total: 0, file_operation: 0 })
    await app.close()
  }
})

test('Task Center unmount aborts read-only summary and list but never sends task Cancel', async () => {
  const summary = pending(), mine = pending()
  const signals = { summary: null, mine: null }
  const controlCalls = []
  const port = {
    loadActiveSummary: signal => { signals.summary = signal; return summary.promise },
    loadMinePage: (_limit, _cursor, signal) => { signals.mine = signal; return mine.promise },
    control: async (...args) => { controlCalls.push(args) },
  }
  const app = await mount(port, { globalTasksEnabled: false })
  await app.close()
  assert.equal(signals.summary.aborted, true)
  assert.equal(signals.mine.aborted, true)
  assert.deepEqual(controlCalls, [])
  summary.resolve({ active_total: 0, file_operation: 0 })
  mine.resolve(emptyPage)
})
