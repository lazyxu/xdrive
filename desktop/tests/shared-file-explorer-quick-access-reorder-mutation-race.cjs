const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

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
    useMemo(factory, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { deps: deps ? [...deps] : undefined, value: factory() }
      }
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

function loadQuickAccessHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerQuickAccessController.ts',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => request === 'react' ? react : require(request)
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerQuickAccess
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function item(id) {
  return {
    node: { id, name: 'Folder ' + id },
    path: '/Folder ' + id,
    crumbs: [{ id, name: 'Folder ' + id }],
    position: id - 1,
    pinned_at: '2026-10-09T00:00:00Z',
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('Quick Access failed reorder rollback cannot erase a newer successful pin', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)
  const reorder = deferred()
  const errors = []

  const render = () => runtime.render(() => useQuickAccess({
    lifecycleKey: 'server:user',
    enabled: true,
    loadItems: async () => [item(1), item(2)],
    pinItem: async (nodeID) => item(nodeID),
    unpinItem: async () => {},
    reorderItems: async () => reorder.promise,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let quick = render()
  assert.deepEqual(quick.items.map((entry) => entry.id), [1, 2])

  const pendingReorder = quick.reorder([2, 1])
  quick = render()
  assert.deepEqual(quick.items.map((entry) => entry.id), [2, 1])

  assert.equal(await quick.pin(3), true)
  await flushAsync()
  quick = render()
  assert.equal(quick.pinnedIDs.has(3), true, 'newer successful pin must be visible before old reorder failure')

  reorder.reject(new Error('older reorder failed'))
  assert.equal(await pendingReorder, false)
  await flushAsync()
  quick = render()

  assert.equal(
    quick.pinnedIDs.has(3),
    true,
    'older reorder rollback must not erase a newer successful pin',
  )
  assert.deepEqual(quick.items.map((entry) => entry.id), [1, 2, 3])
  assert.deepEqual(quick.items.map((entry) => entry.position), [0, 1, 2])
  assert.equal(errors.length, 1)
})

test('Quick Access failed reorder rollback cannot restore a newer successful unpin', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)
  const reorder = deferred()
  const errors = []

  const render = () => runtime.render(() => useQuickAccess({
    lifecycleKey: 'server:user',
    enabled: true,
    loadItems: async () => [item(1), item(2), item(3)],
    pinItem: async (nodeID) => item(nodeID),
    unpinItem: async () => {},
    reorderItems: async () => reorder.promise,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let quick = render()
  assert.deepEqual(quick.items.map((entry) => entry.id), [1, 2, 3])

  const pendingReorder = quick.reorder([3, 2, 1])
  quick = render()
  assert.deepEqual(quick.items.map((entry) => entry.id), [3, 2, 1])

  assert.equal(await quick.unpin(2), true)
  await flushAsync()
  quick = render()
  assert.equal(quick.pinnedIDs.has(2), false, 'newer successful unpin must be visible before old reorder failure')

  reorder.reject(new Error('older reorder failed'))
  assert.equal(await pendingReorder, false)
  await flushAsync()
  quick = render()

  assert.equal(
    quick.pinnedIDs.has(2),
    false,
    'older reorder rollback must not restore a newer successful unpin',
  )
  assert.deepEqual(quick.items.map((entry) => entry.id), [1, 3])
  assert.deepEqual(quick.items.map((entry) => entry.position), [0, 2])
  assert.equal(errors.length, 1)
})

test('Quick Access rollback restores order while preserving current folder records in React', async () => {
  const useQuickAccess = loadQuickAccessHook(React)
  const reorder = deferred()
  const errors = []
  const updated = {
    ...item(1),
    node: { id: 1, name: 'Renamed folder' },
    path: '/Moved/Renamed folder',
    crumbs: [{ id: 10, name: 'Moved' }, { id: 1, name: 'Renamed folder' }],
  }
  let quick
  let renderer
  function Harness() {
    quick = useQuickAccess({
      lifecycleKey: 'server:user',
      loadItems: async () => [item(1), item(2), item(3)],
      pinItem: async (nodeID) => nodeID === 1 ? updated : item(nodeID),
      unpinItem: async () => {},
      reorderItems: () => reorder.promise,
      onError: (error) => errors.push(error),
    })
    return null
  }

  try {
    await act(async () => { renderer = create(React.createElement(Harness)) })
    assert.deepEqual(quick.items.map((entry) => entry.id), [1, 2, 3])

    let pendingReorder
    act(() => { pendingReorder = quick.reorder([3, 2, 1]) })
    assert.deepEqual(quick.items.map((entry) => entry.id), [3, 2, 1])

    await act(async () => {
      assert.equal(await quick.pin(4), true)
      assert.equal(await quick.unpin(2), true)
      assert.equal(await quick.pin(1), true)
    })
    assert.deepEqual(quick.items.map((entry) => entry.id), [3, 1, 4])
    assert.equal(quick.items.find((entry) => entry.id === 1).name, 'Renamed folder')

    const error = new Error('older reorder failed')
    await act(async () => {
      reorder.reject(error)
      assert.equal(await pendingReorder, false)
    })

    assert.deepEqual(quick.items.map((entry) => entry.id), [1, 3, 4])
    assert.deepEqual(quick.items.map((entry) => entry.position), [0, 2, 3])
    assert.deepEqual(quick.items[0], {
      id: 1,
      name: 'Renamed folder',
      path: '/Moved/Renamed folder',
      crumbs: [{ id: 10, name: 'Moved' }, { id: 1, name: 'Renamed folder' }],
      position: 0,
      pinnedAt: '2026-10-09T00:00:00Z',
    })
    assert.equal(quick.busyID, null)
    assert.equal(quick.loading, false)
    assert.deepEqual(errors, [error])
  } finally {
    act(() => { renderer?.unmount() })
  }
})

test('Quick Access rollback keeps a re-pinned folder in its newly appended position', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)
  const reorder = deferred()
  const errors = []
  const repinned = {
    ...item(1),
    position: 3,
    pinned_at: '2026-10-09T01:00:00Z',
  }
  const render = () => runtime.render(() => useQuickAccess({
    lifecycleKey: 'server:user',
    loadItems: async () => [item(1), item(2), item(3)],
    pinItem: async () => repinned,
    unpinItem: async () => {},
    reorderItems: () => reorder.promise,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let quick = render()
  const pendingReorder = quick.reorder([3, 2, 1])
  assert.equal(await quick.unpin(1), true)
  assert.equal(await quick.pin(1), true)
  quick = render()
  assert.deepEqual(quick.items.map((entry) => entry.id), [3, 2, 1])
  assert.equal(quick.items[2].position, 3)

  reorder.reject(new Error('older reorder failed'))
  assert.equal(await pendingReorder, false)
  quick = render()
  assert.deepEqual(quick.items.map((entry) => entry.id), [2, 3, 1])
  assert.deepEqual(quick.items.map((entry) => entry.position), [1, 2, 3])
  assert.equal(quick.items[2].pinnedAt, '2026-10-09T01:00:00Z')
  assert.equal(errors.length, 1)
})

for (const action of ['pin', 'unpin']) {
  test(`Quick Access failed ${action} does not prevent a pending reorder from rolling back`, async () => {
    const runtime = createHookRuntime()
    const useQuickAccess = loadQuickAccessHook(runtime.react)
    const reorder = deferred()
    const mutationError = new Error(`${action} failed`)
    const reorderError = new Error('older reorder failed')
    const errors = []
    const render = () => runtime.render(() => useQuickAccess({
      lifecycleKey: 'server:user',
      loadItems: async () => [item(1), item(2), item(3)],
      pinItem: async () => { throw mutationError },
      unpinItem: async () => { throw mutationError },
      reorderItems: () => reorder.promise,
      onError: (error) => errors.push(error),
    }))

    render()
    await flushAsync()
    let quick = render()
    const pendingReorder = quick.reorder([3, 2, 1])
    quick = render()
    assert.equal(await quick[action](action === 'pin' ? 4 : 2), false)
    quick = render()
    assert.deepEqual(quick.items.map((entry) => entry.id), [3, 2, 1])

    reorder.reject(reorderError)
    assert.equal(await pendingReorder, false)
    quick = render()
    assert.deepEqual(quick.items.map((entry) => entry.id), [1, 2, 3])
    assert.deepEqual(quick.items.map((entry) => entry.position), [0, 1, 2])
    assert.deepEqual(errors, [mutationError, reorderError])
  })
}
