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
          kind: 'state',
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
      if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initialValue } }
      return slots[index].value
    },
    useMemo(factory, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { kind: 'memo', deps: deps ? [...deps] : undefined, value: factory() }
      }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { kind: 'callback', deps: deps ? [...deps] : undefined, value: callback }
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
          kind: 'effect',
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return result
    },
  }
}

function loadHook(react, fileName, exportName) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    fileName,
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    (request) => request === 'react' ? react : require(request),
  )
  return mod.exports[exportName]
}

function loadQuickAccessHook(react) {
  return loadHook(
    react,
    'FileExplorerQuickAccessController.ts',
    'useXDriveFileExplorerQuickAccess',
  )
}

function loadFavoritesHook(react) {
  return loadHook(
    react,
    'FileExplorerFavoriteController.ts',
    'useXDriveFileExplorerFavorites',
  )
}

function loadRecentHook(react) {
  return loadHook(
    react,
    'FileExplorerRecentController.ts',
    'useXDriveFileExplorerRecent',
  )
}

function quickItem(id, name) {
  return {
    node: { id, name, type: 'dir' },
    path: '/' + name,
    crumbs: [{ id: 100, name: '我的文件' }, { id, name }],
    pinned_at: '2026-10-08T00:00:00Z',
  }
}

function favoriteItem(id, name) {
  return {
    node: { id, name, type: 'file', revision: 1 },
    path: '/' + name,
    crumbs: [{ id: 100, name: '我的文件' }],
    favorited_at: '2026-10-08T00:00:00Z',
  }
}

function recentItem(id, name) {
  return {
    node: { id, name, type: 'file', revision: 1 },
    path: '/' + name,
    crumbs: [{ id: 100, name: '我的文件' }],
    accessed_at: '2026-10-08T00:00:00Z',
  }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('Quick Access account lifecycle change breaks stale mutation serialization while enabled stays true', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  let releaseA
  let pinBCalls = 0
  const errors = []

  const pinItem = (nodeID) => {
    if (nodeID === 1) {
      return new Promise((resolve) => {
        releaseA = () => resolve(quickItem(1, 'A'))
      })
    }
    pinBCalls += 1
    return Promise.resolve(quickItem(2, 'B'))
  }

  const render = () => runtime.render(() => useQuickAccess({
    enabled: true,
    lifecycleKey,
    loadItems: async () => [],
    pinItem,
    unpinItem: async () => {},
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let quick = render()

  const pendingA = quick.pin(1)
  await flushAsync()
  quick = render()
  assert.equal(typeof releaseA, 'function')
  assert.equal(quick.busyID, 1)

  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  quick = render()

  assert.equal(
    quick.busyID,
    null,
    'account lifecycle change must release the old Quick Access busy ownership',
  )

  const pendingB = quick.pin(2)
  await flushAsync()

  assert.equal(
    pinBCalls,
    1,
    'new account Quick Access mutation must not wait behind the previous account mutation',
  )

  await pendingB
  releaseA()
  await pendingA
  await flushAsync()
  quick = render()

  assert.deepEqual(quick.items.map((item) => item.id), [2])
  assert.equal(quick.busyID, null)
  assert.deepEqual(errors, [])
})


test('Favorites account lifecycle change breaks stale mutation serialization while enabled stays true', async () => {
  const runtime = createHookRuntime()
  const useFavorites = loadFavoritesHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  let releaseA
  let favoriteBCalls = 0
  const errors = []

  const favorite = (nodeID) => {
    if (nodeID === 1) {
      return new Promise((resolve) => {
        releaseA = () => resolve(favoriteItem(1, 'A.txt'))
      })
    }
    favoriteBCalls += 1
    return Promise.resolve(favoriteItem(2, 'B.txt'))
  }

  const render = () => runtime.render(() => useFavorites({
    enabled: true,
    lifecycleKey,
    loadItems: async () => [],
    favoriteItem: favorite,
    unfavoriteItem: async () => {},
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let favorites = render()
  const pendingA = favorites.favorite(1)
  await flushAsync()
  favorites = render()
  assert.equal(favorites.busyID, 1)

  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  favorites = render()
  assert.equal(favorites.busyID, null)

  const pendingB = favorites.favorite(2)
  await flushAsync()
  assert.equal(favoriteBCalls, 1)

  await pendingB
  releaseA()
  await pendingA
  await flushAsync()
  favorites = render()

  assert.deepEqual(favorites.items.map((item) => item.id), [2])
  assert.equal(favorites.busyID, null)
  assert.deepEqual(errors, [])
})

test('Recent account lifecycle change breaks stale mutation serialization while enabled stays true', async () => {
  const runtime = createHookRuntime()
  const useRecent = loadRecentHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  let releaseA
  let clearBCalls = 0

  const render = () => runtime.render(() => useRecent({
    enabled: true,
    lifecycleKey,
    loadItems: async () => [],
    touchItem: (nodeID) => {
      if (nodeID !== 1) throw new Error('unexpected recent id')
      return new Promise((resolve) => {
        releaseA = () => resolve(recentItem(1, 'A.txt'))
      })
    },
    clearItems: async () => {
      clearBCalls += 1
    },
  }))

  render()
  await flushAsync()
  let recent = render()
  const pendingA = recent.record(1)
  await flushAsync()

  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  recent = render()

  const pendingClear = recent.clear()
  await flushAsync()
  assert.equal(
    clearBCalls,
    1,
    'new account Recent clear must not wait behind the previous account record',
  )

  await pendingClear
  releaseA()
  await pendingA
  await flushAsync()
  recent = render()

  assert.deepEqual(recent.items, [])
})


test('Quick Access stale reorder failure cannot rollback a newer account list', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  let rejectA
  const errors = []

  const loadItems = async () => lifecycleKey === 'server-a:user-a'
    ? [
        { ...quickItem(1, 'A1'), position: 0 },
        { ...quickItem(2, 'A2'), position: 1 },
      ]
    : [
        { ...quickItem(10, 'B1'), position: 0 },
        { ...quickItem(20, 'B2'), position: 1 },
      ]

  const reorderItems = () => new Promise((resolve, reject) => {
    if (lifecycleKey === 'server-a:user-a') {
      rejectA = () => reject(new Error('stale A reorder failed'))
      return
    }
    resolve()
  })

  const render = () => runtime.render(() => useQuickAccess({
    enabled: true,
    lifecycleKey,
    loadItems,
    pinItem: async () => { throw new Error('unexpected pin') },
    unpinItem: async () => {},
    reorderItems,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let quick = render()
  assert.deepEqual(quick.items.map((item) => item.id), [1, 2])

  const pendingA = quick.reorder([2, 1])
  await flushAsync()
  quick = render()
  assert.deepEqual(quick.items.map((item) => item.id), [2, 1])
  assert.equal(typeof rejectA, 'function')

  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  quick = render()
  assert.deepEqual(
    quick.items.map((item) => item.id),
    [10, 20],
    'account B must publish its own Quick Access list before stale A settles',
  )

  rejectA()
  await pendingA
  await flushAsync()
  quick = render()

  assert.deepEqual(
    quick.items.map((item) => item.id),
    [10, 20],
    'late account-A reorder failure must not rollback account B to A items',
  )
  assert.deepEqual(
    errors,
    [],
    'late account-A reorder failure must not publish an error into account B',
  )
})
