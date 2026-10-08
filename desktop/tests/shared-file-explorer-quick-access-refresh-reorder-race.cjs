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
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

test('Quick Access successful reorder invalidates an older pending refresh completion', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)
  const staleRefresh = deferred()
  let loadCalls = 0
  let reorderCalls = 0
  const errors = []

  const render = () => runtime.render(() => useQuickAccess({
    lifecycleKey: 'server:user',
    enabled: true,
    loadItems: async () => {
      loadCalls += 1
      if (loadCalls === 1) return [item(1), item(2), item(3)]
      if (loadCalls === 2) return staleRefresh.promise
      throw new Error('unexpected loadItems call')
    },
    pinItem: async (nodeID) => item(nodeID),
    unpinItem: async () => {},
    reorderItems: async (ids) => {
      reorderCalls += 1
      assert.deepEqual(ids, [3, 2, 1])
    },
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let quick = render()
  assert.deepEqual(quick.items.map((entry) => entry.id), [1, 2, 3])

  const pendingRefresh = quick.refresh()
  await flushAsync()

  const reordered = quick.reorder([3, 2, 1])
  assert.equal(await reordered, true)
  quick = render()
  assert.deepEqual(
    quick.items.map((entry) => entry.id),
    [3, 2, 1],
    'the successful reorder must own the visible order before the older refresh returns',
  )
  assert.equal(reorderCalls, 1)

  staleRefresh.resolve([item(1), item(2), item(3)])
  await pendingRefresh
  await flushAsync()
  quick = render()

  assert.deepEqual(
    quick.items.map((entry) => entry.id),
    [3, 2, 1],
    'an older refresh completion must not overwrite a newer successful optimistic reorder',
  )
  assert.deepEqual(errors, [])
})
