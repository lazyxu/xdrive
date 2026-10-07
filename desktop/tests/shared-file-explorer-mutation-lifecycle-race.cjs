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
        slots[index] = {
          kind: 'memo',
          deps: deps ? [...deps] : undefined,
          value: factory(),
        }
      }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = {
          kind: 'callback',
          deps: deps ? [...deps] : undefined,
          value: callback,
        }
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

function loadTypeScript(relativePath, react) {
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
  const localRequire = (request) => {
    if (request === 'react') return react
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

function loadQuickAccessHook(react) {
  return loadTypeScript(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerQuickAccessController.ts'],
    react,
  ).useXDriveFileExplorerQuickAccess
}

function loadFavoritesHook(react) {
  return loadTypeScript(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerFavoriteController.ts'],
    react,
  ).useXDriveFileExplorerFavorites
}

function loadRecentHook(react) {
  return loadTypeScript(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerRecentController.ts'],
    react,
  ).useXDriveFileExplorerRecent
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function quickItem(id, name) {
  return {
    node: { id, name, type: 'dir' },
    path: '/' + name,
    crumbs: [{ id: 100, name: '我的文件' }, { id, name }],
    pinned_at: '2026-10-07T00:00:00Z',
  }
}

function favoriteItem(id, name) {
  return {
    node: { id, name, type: 'file', revision: 1 },
    path: '/' + name,
    crumbs: [{ id: 100, name: '我的文件' }],
    favorited_at: '2026-10-07T00:00:00Z',
  }
}

function recentItem(id, name) {
  return {
    node: { id, name, type: 'file', revision: 1 },
    path: '/' + name,
    crumbs: [{ id: 100, name: '我的文件' }],
    accessed_at: '2026-10-07T00:00:00Z',
  }
}

test('Quick Access new lifecycle mutation is not serialized behind stale pending mutation', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)

  let enabled = true
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
    enabled,
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

  enabled = false
  render()
  await flushAsync()
  quick = render()
  assert.equal(quick.busyID, null)

  enabled = true
  render()
  await flushAsync()
  quick = render()

  const pendingB = quick.pin(2)
  await flushAsync()

  assert.equal(
    pinBCalls,
    1,
    'new lifecycle Quick Access mutation must start without waiting for stale A mutation',
  )

  await pendingB
  await flushAsync()
  quick = render()
  assert.equal(
    quick.busyID,
    null,
    'completed B mutation must not remain busy because stale A is still pending',
  )
  assert.deepEqual(quick.items.map((item) => item.id), [2])

  releaseA()
  await pendingA
  await flushAsync()
  quick = render()
  assert.deepEqual(quick.items.map((item) => item.id), [2])
  assert.equal(quick.busyID, null)
  assert.deepEqual(errors, [])
})

test('Favorites new lifecycle mutation is not serialized behind stale pending mutation', async () => {
  const runtime = createHookRuntime()
  const useFavorites = loadFavoritesHook(runtime.react)

  let enabled = true
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
    enabled,
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
  assert.equal(typeof releaseA, 'function')
  assert.equal(favorites.busyID, 1)

  enabled = false
  render()
  await flushAsync()
  favorites = render()
  assert.equal(favorites.busyID, null)

  enabled = true
  render()
  await flushAsync()
  favorites = render()

  const pendingB = favorites.favorite(2)
  await flushAsync()

  assert.equal(
    favoriteBCalls,
    1,
    'new lifecycle Favorite mutation must start without waiting for stale A mutation',
  )

  await pendingB
  await flushAsync()
  favorites = render()
  assert.equal(favorites.busyID, null)
  assert.deepEqual(favorites.items.map((item) => item.id), [2])

  releaseA()
  await pendingA
  await flushAsync()
  favorites = render()
  assert.deepEqual(favorites.items.map((item) => item.id), [2])
  assert.equal(favorites.busyID, null)
  assert.deepEqual(errors, [])
})

test('Recent new lifecycle mutation is not serialized behind stale pending record', async () => {
  const runtime = createHookRuntime()
  const useRecent = loadRecentHook(runtime.react)

  let enabled = true
  let releaseA
  let clearCalls = 0

  const render = () => runtime.render(() => useRecent({
    enabled,
    loadItems: async () => [],
    touchItem: (nodeID) => {
      if (nodeID !== 1) throw new Error('unexpected recent id')
      return new Promise((resolve) => {
        releaseA = () => resolve(recentItem(1, 'A.txt'))
      })
    },
    clearItems: async () => {
      clearCalls += 1
    },
  }))

  render()
  await flushAsync()
  let recent = render()

  const pendingA = recent.record(1)
  await flushAsync()
  assert.equal(typeof releaseA, 'function')

  enabled = false
  render()
  await flushAsync()
  enabled = true
  render()
  await flushAsync()
  recent = render()

  const pendingClear = recent.clear()
  await flushAsync()

  assert.equal(
    clearCalls,
    1,
    'new lifecycle Recent clear must start without waiting for stale A record',
  )

  await pendingClear
  releaseA()
  await pendingA
  await flushAsync()
  recent = render()
  assert.deepEqual(recent.items, [])
})
