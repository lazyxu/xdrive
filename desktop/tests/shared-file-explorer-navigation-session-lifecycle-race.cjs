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

function loadNavigationHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerNavigation.ts',
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
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../file-explorer-controller') {
      return {
        XDRIVE_FILE_EXPLORER_DEFAULT_SORT: {
          key: 'name',
          direction: 'asc',
        },
      }
    }
    if (request === '../file-explorer-grouping') {
      return {
        XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING: {
          groupBy: 'none',
          foldersFirst: true,
        },
      }
    }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerNavigation
}

function session(tabID, crumbs, viewMode = 'details') {
  return JSON.stringify({
    version: 1,
    state: {
      tabs: [{
        id: tabID,
        history: [crumbs],
        historyIndex: 0,
        sort: { key: 'name', direction: 'asc' },
        grouping: { groupBy: 'none', foldersFirst: true },
        viewMode,
      }],
      activeTabID: tabID,
    },
  })
}

function installStorage(entries) {
  const previousWindow = global.window
  const values = new Map(Object.entries(entries))
  global.window = {
    ...(previousWindow ?? {}),
    localStorage: {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  }
  return {
    values,
    restore() {
      if (previousWindow === undefined) delete global.window
      else global.window = previousWindow
    },
  }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('FileExplorer navigation session key change restores the new account tab workspace', async () => {
  const keyA = 'xdrive.files.navigation_session.v1:user-a'
  const keyB = 'xdrive.files.navigation_session.v1:user-b'
  const rootA = { id: 1, name: 'A Files' }
  const folderA = { id: 2, name: 'A Private' }
  const rootB = { id: 101, name: 'B Files' }
  const folderB = { id: 102, name: 'B Private' }
  const storage = installStorage({
    [keyA]: session('tab-a', [rootA, folderA]),
    [keyB]: session('tab-b', [rootB, folderB], 'grid'),
  })

  try {
    const runtime = createHookRuntime()
    const useNavigation = loadNavigationHook(runtime.react)
    let lifecycleKey = keyA
    let crumbs = [rootA, folderA]
    const render = () => runtime.render(() => useNavigation({
      crumbs,
      viewModeStorageKey: 'xdrive.test.navigation.lifecycle.view',
      navigationSessionStorageKey: lifecycleKey,
      onLoadDirectory: async () => true,
    }))

    render()
    await flushAsync()
    let navigation = render()
    assert.equal(navigation.activeTabID, 'tab-a')
    assert.equal(navigation.pathValue, 'A Files/A Private')

    lifecycleKey = keyB
    crumbs = [rootB, folderB]
    render()
    await flushAsync()
    navigation = render()

    assert.equal(
      navigation.activeTabID,
      'tab-b',
      'switching navigation lifecycle key must restore account B instead of retaining account A tabs',
    )
    assert.deepEqual(
      navigation.tabs.map((tab) => tab.id),
      ['tab-b'],
      'account B must not inherit account A tab identities',
    )
    assert.equal(navigation.viewMode, 'grid')
  } finally {
    storage.restore()
  }
})

test('FileExplorer navigation session key change cannot write account A tabs into account B storage', async () => {
  const keyA = 'xdrive.files.navigation_session.v1:user-a'
  const keyB = 'xdrive.files.navigation_session.v1:user-b'
  const rootA = { id: 1, name: 'A Files' }
  const folderA = { id: 2, name: 'A Private' }
  const rootB = { id: 101, name: 'B Files' }
  const folderB = { id: 102, name: 'B Private' }
  const storage = installStorage({
    [keyA]: session('tab-a', [rootA, folderA]),
    [keyB]: session('tab-b', [rootB, folderB]),
  })

  try {
    const runtime = createHookRuntime()
    const useNavigation = loadNavigationHook(runtime.react)
    let lifecycleKey = keyA
    let crumbs = [rootA, folderA]
    const render = () => runtime.render(() => useNavigation({
      crumbs,
      viewModeStorageKey: 'xdrive.test.navigation.lifecycle.view',
      navigationSessionStorageKey: lifecycleKey,
      onLoadDirectory: async () => true,
    }))

    render()
    await flushAsync()
    let navigation = render()
    assert.equal(navigation.activeTabID, 'tab-a')

    lifecycleKey = keyB
    crumbs = [rootB, folderB]
    render()
    await flushAsync()
    navigation = render()

    navigation.setViewMode('columns')
    await flushAsync()

    const persistedB = JSON.parse(storage.values.get(keyB))
    assert.equal(
      persistedB.state.activeTabID,
      'tab-b',
      'a B-side UI commit must never persist account A active-tab identity into account B storage',
    )
    assert.deepEqual(
      persistedB.state.tabs.map((tab) => tab.id),
      ['tab-b'],
      'account B persistence must remain scoped to B tabs after lifecycle switch',
    )
  } finally {
    storage.restore()
  }
})


test('FileExplorer new-account default session never inherits pending old-account breadcrumbs', async () => {
  const keyA = 'xdrive.files.navigation_session.v1:stale-crumb-a'
  const keyB = 'xdrive.files.navigation_session.v1:stale-crumb-new-b'
  const rootA = { id: 11, name: 'A Files' }
  const folderA = { id: 12, name: 'A Private' }
  const storage = installStorage({
    [keyA]: session('tab-a', [rootA, folderA]),
    // Account B has no saved navigation session yet.
  })

  try {
    const runtime = createHookRuntime()
    const useNavigation = loadNavigationHook(runtime.react)
    let lifecycleKey = keyA
    // Parent's asynchronous directory handoff has not yet replaced A's crumbs.
    const crumbs = [rootA, folderA]
    const load = async () => true
    const render = () => runtime.render(() => useNavigation({
      crumbs,
      viewModeStorageKey: 'xdrive.test.navigation.stale-crumb.view',
      navigationSessionStorageKey: lifecycleKey,
      onLoadDirectory: load,
    }))

    render()
    await flushAsync()
    assert.equal(render().activeTabID, 'tab-a')

    lifecycleKey = keyB
    render()
    await flushAsync()
    const navigation = render()
    assert.equal(navigation.activeTabID, 'tab-1')
    const saved = storage.values.get(keyB)
    const persisted = saved ? JSON.parse(saved) : null
    const captured = persisted?.state?.tabs.flatMap((tab) => tab.history.flat()) ?? []
    assert.equal(
      captured.some((crumb) => crumb.id === rootA.id || crumb.id === folderA.id),
      false,
      'a still-pending account-A directory must never become account-B session history',
    )
  } finally {
    storage.restore()
  }
})

test('FileExplorer failed B session restore cannot write stale A fallback into B storage', async () => {
  const keyA = 'xdrive.files.navigation_session.v1:restore-crumb-a'
  const keyB = 'xdrive.files.navigation_session.v1:restore-crumb-b'
  const rootA = { id: 21, name: 'A Files' }
  const folderA = { id: 22, name: 'A Private' }
  const rootB = { id: 121, name: 'B Files' }
  const folderB = { id: 122, name: 'B Private' }
  const storage = installStorage({
    [keyA]: session('tab-a', [rootA, folderA]),
    [keyB]: session('tab-b', [rootB, folderB]),
  })
  let finishB
  const pendingB = new Promise((resolve) => { finishB = resolve })
  const load = (id) => id === folderB.id ? pendingB : Promise.resolve(true)

  try {
    const runtime = createHookRuntime()
    const useNavigation = loadNavigationHook(runtime.react)
    let lifecycleKey = keyA
    // B identity changes first; A's parent directory data remains until the handoff.
    const crumbs = [rootA, folderA]
    const render = () => runtime.render(() => useNavigation({
      crumbs,
      viewModeStorageKey: 'xdrive.test.navigation.failed-restore.view',
      navigationSessionStorageKey: lifecycleKey,
      onLoadDirectory: load,
    }))

    render()
    await flushAsync()
    assert.equal(render().activeTabID, 'tab-a')

    lifecycleKey = keyB
    render()
    await flushAsync()
    assert.equal(render().activeTabID, 'tab-b')
    finishB(false)
    await flushAsync()
    render()

    const saved = JSON.parse(storage.values.get(keyB))
    const captured = saved.state.tabs.flatMap((tab) => tab.history.flat())
    assert.equal(
      captured.some((crumb) => crumb.id === rootA.id || crumb.id === folderA.id),
      false,
      'failed B restore must never persist old A breadcrumbs as the fallback',
    )
  } finally {
    finishB?.(false)
    storage.restore()
  }
})


test('FileExplorer new account seeds its default tab only after its own root becomes available', async () => {
  const keyA = 'xdrive.files.navigation_session.v1:delayed-a'
  const keyB = 'xdrive.files.navigation_session.v1:delayed-b'
  const rootA = { id: 31, name: 'A Files' }
  const folderA = { id: 32, name: 'A Private' }
  const rootB = { id: 131, name: 'B Files' }
  const storage = installStorage({ [keyA]: session('tab-a', [rootA, folderA]) })
  try {
    const runtime = createHookRuntime()
    const useNavigation = loadNavigationHook(runtime.react)
    let key = keyA
    let crumbs = [rootA, folderA]
    const load = async () => true
    const render = () => runtime.render(() => useNavigation({
      crumbs,
      viewModeStorageKey: 'xdrive.test.navigation.delayed-root.view',
      navigationSessionStorageKey: key,
      onLoadDirectory: load,
    }))
    render()
    await flushAsync()
    assert.equal(render().activeTabID, 'tab-a')

    key = keyB
    render()
    await flushAsync()
    assert.equal(render().activeTabID, 'tab-1')
    // Current parent has not yet published B's root.
    const beforeRaw = storage.values.get(keyB)
    if (beforeRaw) {
      const before = JSON.parse(beforeRaw)
      assert.deepEqual(before.state.tabs.filter((tab) => tab.history.length > 0), [])
    }

    crumbs = [rootB]
    render()
    await flushAsync()
    render()
    const after = JSON.parse(storage.values.get(keyB))
    assert.deepEqual(after.state.tabs[0].history, [[rootB]])
    assert.equal(after.state.activeTabID, 'tab-1')
  } finally {
    storage.restore()
  }
})


test('FileExplorer accepts the new-account root when the old account never loaded its own root', async () => {
  const keyA = 'xdrive.files.navigation_session.v1:empty-before-switch-a'
  const keyB = 'xdrive.files.navigation_session.v1:empty-before-switch-b'
  const rootB = { id: 232, name: 'B Files' }
  const storage = installStorage({})
  try {
    const runtime = createHookRuntime()
    const useNavigation = loadNavigationHook(runtime.react)
    let lifecycleKey = keyA
    let crumbs = []
    const load = async () => true
    const render = () => runtime.render(() => useNavigation({
      crumbs,
      viewModeStorageKey: 'xdrive.test.navigation.empty-switch.view',
      navigationSessionStorageKey: lifecycleKey,
      onLoadDirectory: load,
    }))
    render()
    await flushAsync()
    assert.equal(render().activeTabID, 'tab-1')

    // The parent publishes B's first root in the same render as the new key.
    lifecycleKey = keyB
    crumbs = [rootB]
    render()
    await flushAsync()
    render()

    const stored = JSON.parse(storage.values.get(keyB))
    assert.deepEqual(
      stored.state.tabs[0].history,
      [[rootB]],
      'a fresh B root must be eligible even when A never had a committed root',
    )
  } finally {
    storage.restore()
  }
})
