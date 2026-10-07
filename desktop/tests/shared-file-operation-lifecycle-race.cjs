const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createHookRuntime() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

  const react = {
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = {
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        }
      }
      const setValue = (nextValue) => {
        const current = slots[index].value
        slots[index].value = typeof nextValue === 'function'
          ? nextValue(current)
          : nextValue
      }
      return [slots[index].value, setValue]
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initialValue } }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { deps: deps ? [...deps] : undefined, value: callback }
      }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        pendingEffects.push({ index, effect, deps: deps ? [...deps] : undefined })
      }
    },
  }

  return {
    react,
    render(factory) {
      cursor = 0
      pendingEffects = []
      const result = factory()
      for (const pending of pendingEffects) {
        const previous = slots[pending.index]
        if (typeof previous?.cleanup === 'function') previous.cleanup()
        const cleanup = pending.effect()
        slots[pending.index] = {
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return result
    },
  }
}

function loadTypeScript(relativePath) {
  const filename = path.join(repo, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, require)
  return mod.exports
}

function loadLifecycleHook(react) {
  const model = loadTypeScript(['ui', 'shared', 'src', 'file-operations.ts'])
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileOperationLifecycle.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../file-operations') return model
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileOperationLifecycle
}

function loadActionsHook(react) {
  const model = loadTypeScript(['ui', 'shared', 'src', 'file-operations.ts'])
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileOperationActions.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../file-operations') return model
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileOperationActions
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('stale operation refresh cannot erase a newer remembered FileExplorer operation', async () => {
  const originalWindow = global.window
  global.window = {
    setInterval: () => 1,
    clearInterval: () => {},
  }

  try {
    const runtime = createHookRuntime()
    const useLifecycle = loadLifecycleHook(runtime.react)
    const oldOperation = { id: 'old', status: 'completed' }
    const queuedOperation = { id: 'new', status: 'queued' }
    let loadCalls = 0
    let releaseRefresh

    const loadOperations = async () => {
      loadCalls += 1
      if (loadCalls === 1) return [oldOperation]
      if (loadCalls === 2) {
        return new Promise((resolve) => {
          releaseRefresh = () => resolve([oldOperation])
        })
      }
      return [queuedOperation, oldOperation]
    }

    const render = () => runtime.render(() => useLifecycle({
      enabled: true,
      taskCenterVisible: false,
      loadOperations,
    }))

    render()
    await flushAsync()
    let lifecycle = render()
    assert.deepEqual(lifecycle.operations.map((item) => item.id), ['old'])

    const staleRefresh = lifecycle.refreshOperations()
    await flushAsync()
    assert.equal(typeof releaseRefresh, 'function')

    lifecycle.rememberOperation(queuedOperation)
    lifecycle = render()
    await flushAsync()
    lifecycle = render()
    assert.ok(
      lifecycle.operations.some((item) => item.id === queuedOperation.id),
      'newly queued FileExplorer operation must appear immediately',
    )

    releaseRefresh()
    await staleRefresh

    lifecycle = render()
    assert.ok(
      lifecycle.operations.some((item) => item.id === queuedOperation.id),
      'an older refresh response must not erase a newer remembered operation',
    )
  } finally {
    global.window = originalWindow
  }
})


test('newer file-operation refresh wins when responses complete out of order', async () => {
  const originalWindow = global.window
  global.window = {
    setInterval: () => 1,
    clearInterval: () => {},
  }

  try {
    const runtime = createHookRuntime()
    const useLifecycle = loadLifecycleHook(runtime.react)
    const initialOperation = { id: 'initial', status: 'completed' }
    const olderOperation = { id: 'older', status: 'completed' }
    const newerOperation = { id: 'newer', status: 'completed' }
    let loadCalls = 0
    const pending = []

    const loadOperations = async () => {
      loadCalls += 1
      if (loadCalls === 1) return [initialOperation]
      return new Promise((resolve) => pending.push(resolve))
    }

    const render = () => runtime.render(() => useLifecycle({
      enabled: true,
      taskCenterVisible: false,
      loadOperations,
    }))

    render()
    await flushAsync()
    let lifecycle = render()
    assert.deepEqual(lifecycle.operations.map((item) => item.id), ['initial'])

    const olderRefresh = lifecycle.refreshOperations()
    const newerRefresh = lifecycle.refreshOperations()
    await flushAsync()
    assert.equal(pending.length, 2)

    pending[1]([newerOperation])
    await newerRefresh
    pending[0]([olderOperation])
    await olderRefresh

    lifecycle = render()
    assert.deepEqual(
      lifecycle.operations.map((item) => item.id),
      ['newer'],
      'an older operation refresh must not overwrite a newer refresh result',
    )
  } finally {
    global.window = originalWindow
  }
})

test('disabling file-operation lifecycle invalidates a pending explicit refresh', async () => {
  const originalWindow = global.window
  global.window = {
    setInterval: () => 1,
    clearInterval: () => {},
  }

  try {
    const runtime = createHookRuntime()
    const useLifecycle = loadLifecycleHook(runtime.react)
    const initialOperation = { id: 'initial', status: 'completed' }
    const staleOperation = { id: 'stale', status: 'completed' }
    let enabled = true
    let loadCalls = 0
    let releaseRefresh

    const loadOperations = async () => {
      loadCalls += 1
      if (loadCalls === 1) return [initialOperation]
      return new Promise((resolve) => {
        releaseRefresh = () => resolve([staleOperation])
      })
    }

    const render = () => runtime.render(() => useLifecycle({
      enabled,
      taskCenterVisible: false,
      loadOperations,
    }))

    render()
    await flushAsync()
    let lifecycle = render()
    assert.deepEqual(lifecycle.operations.map((item) => item.id), ['initial'])

    const staleRefresh = lifecycle.refreshOperations()
    await flushAsync()
    assert.equal(typeof releaseRefresh, 'function')

    enabled = false
    render()
    await flushAsync()
    lifecycle = render()
    assert.deepEqual(lifecycle.operations, [])

    releaseRefresh()
    await staleRefresh

    lifecycle = render()
    assert.deepEqual(
      lifecycle.operations,
      [],
      'a refresh started before disable must not repopulate disabled lifecycle state',
    )
  } finally {
    global.window = originalWindow
  }
})


test('stale refresh cannot roll back a newer remembered status for the same operation', async () => {
  const originalWindow = global.window
  global.window = {
    setInterval: () => 1,
    clearInterval: () => {},
  }

  try {
    const runtime = createHookRuntime()
    const useLifecycle = loadLifecycleHook(runtime.react)
    const runningOperation = { id: 'same', status: 'running' }
    const cancelRequestedOperation = { id: 'same', status: 'cancel_requested' }
    let loadCalls = 0
    let releaseRefresh

    const loadOperations = async () => {
      loadCalls += 1
      if (loadCalls === 1) return [runningOperation]
      return new Promise((resolve) => {
        releaseRefresh = () => resolve([runningOperation])
      })
    }

    const render = () => runtime.render(() => useLifecycle({
      enabled: true,
      taskCenterVisible: false,
      loadOperations,
    }))

    render()
    await flushAsync()
    let lifecycle = render()
    assert.equal(lifecycle.operations[0]?.status, 'running')

    const staleRefresh = lifecycle.refreshOperations()
    await flushAsync()
    assert.equal(typeof releaseRefresh, 'function')

    lifecycle.rememberOperation(cancelRequestedOperation)
    lifecycle = render()
    assert.equal(
      lifecycle.operations[0]?.status,
      'cancel_requested',
      'newer local operation status must be visible immediately',
    )

    releaseRefresh()
    await staleRefresh

    lifecycle = render()
    assert.equal(
      lifecycle.operations[0]?.status,
      'cancel_requested',
      'a stale refresh must not roll back a newer remembered status for the same operation',
    )
  } finally {
    global.window = originalWindow
  }
})


test('FileOperation actions cannot cross Desktop session identity lifecycles', async () => {
  const runtime = createHookRuntime()
  const useActions = loadActionsHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  let releaseA
  let releaseB
  const remembered = []
  const feedback = []
  const errors = []
  let refreshCalls = 0

  const retryOperation = (id) => new Promise((resolve) => {
    if (id === 'op-a') {
      releaseA = () => resolve({ id: 'op-a', status: 'queued' })
    } else if (id === 'op-b') {
      releaseB = () => resolve({ id: 'op-b', status: 'queued' })
    } else {
      throw new Error('unexpected retry id')
    }
  })

  const render = () => runtime.render(() => useActions({
    lifecycleKey,
    cancelOperation: async (id) => ({ id, status: 'cancel_requested' }),
    retryOperation,
    clearOperationHistory: async () => {},
    clearTransferHistory: async () => undefined,
    rememberOperation: (operation) => remembered.push(operation),
    refreshOperations: async () => {
      refreshCalls += 1
      return []
    },
    onError: (error) => errors.push(error),
    onFeedback: (message) => feedback.push(message),
  }))

  let actions = render()
  const pendingA = actions.retryOperation('op-a')
  await flushAsync()
  actions = render()
  assert.equal(actions.retryingID, 'op-a')
  assert.equal(typeof releaseA, 'function')

  // Desktop can keep App mounted while Agent identity changes. The new
  // lifecycle must immediately release A's visible action ownership so B can
  // start independently.
  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  actions = render()
  assert.equal(
    actions.busy,
    false,
    'changing Server+username lifecycle must release the old account action busy ownership',
  )

  const pendingB = actions.retryOperation('op-b')
  await flushAsync()
  actions = render()
  assert.equal(actions.retryingID, 'op-b')
  assert.equal(typeof releaseB, 'function')

  // A finishes late. It must not inject A's operation/feedback/refresh into B,
  // and must not clear B's busy state.
  releaseA()
  assert.equal(
    await pendingA,
    false,
    'an action completion owned by the previous session identity must report stale',
  )
  await flushAsync()
  actions = render()

  assert.equal(
    actions.retryingID,
    'op-b',
    'stale A finally work must not clear the newer B action busy ownership',
  )
  assert.deepEqual(remembered, [])
  assert.deepEqual(feedback, [])
  assert.equal(refreshCalls, 0)
  assert.deepEqual(errors, [])

  releaseB()
  assert.equal(await pendingB, true)
  await flushAsync()
  actions = render()

  assert.equal(actions.busy, false)
  assert.deepEqual(remembered.map((operation) => operation.id), ['op-b'])
  assert.equal(refreshCalls, 1)
  assert.deepEqual(feedback, ['文件操作已重新加入队列。'])
  assert.deepEqual(errors, [])
})


test('FileOperation list refresh cannot cross session identity lifecycles', async () => {
  const originalWindow = global.window
  global.window = {
    setInterval: () => 1,
    clearInterval: () => {},
  }

  try {
    const runtime = createHookRuntime()
    const useLifecycle = loadLifecycleHook(runtime.react)
    const operationA = { id: 'op-a', status: 'running' }
    const staleOperationA = { id: 'op-a-stale', status: 'completed' }
    const operationB = { id: 'op-b', status: 'queued' }

    let lifecycleKey = 'server-a:user-a'
    let identity = 'a'
    let holdNextARefresh = false
    let releaseA
    let loadCalls = 0

    const loadOperations = () => {
      loadCalls += 1
      const capturedIdentity = identity
      if (capturedIdentity === 'a' && holdNextARefresh) {
        holdNextARefresh = false
        return new Promise((resolve) => {
          releaseA = () => resolve([staleOperationA])
        })
      }
      return Promise.resolve(
        capturedIdentity === 'a' ? [operationA] : [operationB],
      )
    }

    const render = () => runtime.render(() => useLifecycle({
      enabled: true,
      lifecycleKey,
      taskCenterVisible: false,
      loadOperations,
    }))

    render()
    await flushAsync()
    let lifecycle = render()
    assert.deepEqual(lifecycle.operations.map((item) => item.id), ['op-a'])

    holdNextARefresh = true
    const pendingARefresh = lifecycle.refreshOperations()
    await flushAsync()
    assert.equal(typeof releaseA, 'function')

    identity = 'b'
    lifecycleKey = 'server-b:user-b'
    render()
    await flushAsync()
    lifecycle = render()

    assert.deepEqual(
      lifecycle.operations.map((item) => item.id),
      ['op-b'],
      'changing Server+username lifecycle while enabled must clear A state and load B operations',
    )

    releaseA()
    await pendingARefresh
    await flushAsync()
    lifecycle = render()

    assert.deepEqual(
      lifecycle.operations.map((item) => item.id),
      ['op-b'],
      'a late explicit refresh from account A must not overwrite account B operations',
    )
    assert.ok(loadCalls >= 3)
  } finally {
    global.window = originalWindow
  }
})


test('stale rememberOperation callback cannot cross session identity lifecycles', async () => {
  const originalWindow = global.window
  global.window = {
    setInterval: () => 1,
    clearInterval: () => {},
  }

  try {
    const runtime = createHookRuntime()
    const useLifecycle = loadLifecycleHook(runtime.react)
    const operationA = { id: 'op-a', status: 'running' }
    const operationB = { id: 'op-b', status: 'queued' }
    const lateOperationA = { id: 'op-a-late', status: 'queued' }

    let lifecycleKey = 'server-a:user-a'
    let identity = 'a'
    const loadOperations = async () => (
      identity === 'a' ? [operationA] : [operationB]
    )
    const render = () => runtime.render(() => useLifecycle({
      enabled: true,
      lifecycleKey,
      taskCenterVisible: false,
      loadOperations,
    }))

    render()
    await flushAsync()
    let lifecycle = render()
    assert.deepEqual(lifecycle.operations.map((item) => item.id), ['op-a'])

    // Keep the callback that an async FileExplorer operation submission from
    // account A would have captured before the session identity changed.
    const staleRememberA = lifecycle.rememberOperation

    identity = 'b'
    lifecycleKey = 'server-b:user-b'
    render()
    await flushAsync()
    lifecycle = render()
    assert.deepEqual(lifecycle.operations.map((item) => item.id), ['op-b'])

    // The old A submit resolves after B is already current.
    staleRememberA(lateOperationA)
    await flushAsync()
    lifecycle = render()

    assert.deepEqual(
      lifecycle.operations.map((item) => item.id),
      ['op-b'],
      'an operation completion captured by account A must not inject A state into account B after the lifecycle identity changed',
    )
  } finally {
    global.window = originalWindow
  }
})
