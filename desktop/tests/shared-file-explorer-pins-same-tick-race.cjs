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
      const value = factory()
      for (const pending of pendingEffects) {
        const previous = slots[pending.index]
        if (typeof previous?.cleanup === 'function') previous.cleanup()
        const cleanup = pending.effect()
        slots[pending.index] = {
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return value
    },
  }
}

function loadHook(relativePath, exportName, react) {
  const filename = path.join(repo, ...relativePath)
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
  const localRequire = (request) => {
    if (request === 'react') return react
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    localRequire,
  )
  return mod.exports[exportName]
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function quickAccessTransport(nodeID) {
  return {
    node: { id: nodeID, name: 'Folder ' + nodeID },
    path: '/Folder ' + nodeID,
    crumbs: [{ id: nodeID, name: 'Folder ' + nodeID }],
    position: 0,
    pinned_at: '2026-10-09T00:00:00Z',
  }
}

function favoriteTransport(nodeID) {
  return {
    node: {
      id: nodeID,
      name: 'File ' + nodeID + '.txt',
      size: 1,
      revision: 1,
      updated_at: '2026-10-09T00:00:00Z',
    },
    path: '/File ' + nodeID + '.txt',
    crumbs: [{ id: 1, name: 'My Files' }],
    favorited_at: '2026-10-09T00:00:00Z',
  }
}

test('Quick Access same-tick duplicate toggle submits one pin mutation', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadHook(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerQuickAccessController.ts'],
    'useXDriveFileExplorerQuickAccess',
    runtime.react,
  )
  let pinCalls = 0
  const errors = []

  const render = () => runtime.render(() => useQuickAccess({
    lifecycleKey: 'server:user',
    enabled: true,
    loadItems: async () => [],
    pinItem: async (nodeID) => {
      pinCalls += 1
      return quickAccessTransport(nodeID)
    },
    unpinItem: async () => {},
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  const quick = render()

  const first = quick.toggle(7)
  const duplicate = quick.toggle(7)
  await Promise.all([first, duplicate])
  await flushAsync()

  assert.equal(
    pinCalls,
    1,
    'two same-tick Quick Access toggles from the same render must submit only one pin mutation',
  )
  assert.deepEqual(errors, [])
})

test('Favorites same-tick duplicate toggle submits one favorite mutation', async () => {
  const runtime = createHookRuntime()
  const useFavorites = loadHook(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerFavoriteController.ts'],
    'useXDriveFileExplorerFavorites',
    runtime.react,
  )
  let favoriteCalls = 0
  const errors = []

  const render = () => runtime.render(() => useFavorites({
    lifecycleKey: 'server:user',
    enabled: true,
    loadItems: async () => [],
    favoriteItem: async (nodeID) => {
      favoriteCalls += 1
      return favoriteTransport(nodeID)
    },
    unfavoriteItem: async () => {},
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  const favorites = render()

  const first = favorites.toggle(9)
  const duplicate = favorites.toggle(9)
  await Promise.all([first, duplicate])
  await flushAsync()

  assert.equal(
    favoriteCalls,
    1,
    'two same-tick Favorite toggles from the same render must submit only one favorite mutation',
  )
  assert.deepEqual(errors, [])
})
