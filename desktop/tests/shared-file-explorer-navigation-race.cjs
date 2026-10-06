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
      if (!slots[index]) {
        slots[index] = { kind: 'ref', value: { current: initialValue } }
      }
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
    return require(request)
  }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerNavigation
}

function loadTypeScriptModule(relativePath, react, extraModules = {}) {
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
    if (request === 'react' && react) return react
    if (Object.prototype.hasOwnProperty.call(extraModules, request)) {
      return extraModules[request]
    }
    return require(request)
  }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, localRequire)
  return mod.exports
}

function loadFileExplorerController() {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'file-explorer-controller.ts'],
    null,
  )
}

function loadQuickAccessHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerQuickAccessController.ts'],
    react,
  ).useXDriveFileExplorerQuickAccess
}

function loadRecentHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerRecentController.ts'],
    react,
  ).useXDriveFileExplorerRecent
}

function loadSearchHook(react) {
  const controller = loadFileExplorerController()
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts'],
    react,
    { '../file-explorer-controller': controller },
  ).useXDriveFileExplorerSearch
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

function cloneCrumbs(crumbs) {
  return crumbs.map((crumb) => ({ ...crumb }))
}

function createDirectoryDriver(initialCrumbs) {
  let visibleCrumbs = cloneCrumbs(initialCrumbs)
  let visibleDirectoryID = visibleCrumbs.at(-1)?.id
  let requestGeneration = 0
  let controlled = false
  const pending = []

  const onLoadDirectory = (id, crumbs) => {
    const generation = ++requestGeneration
    const requestedCrumbs = cloneCrumbs(crumbs)
    const commit = () => {
      if (generation !== requestGeneration) return
      visibleDirectoryID = id
      visibleCrumbs = requestedCrumbs
    }

    if (!controlled) {
      commit()
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      pending.push({
        id,
        generation,
        resolve() {
          commit()
          resolve()
        },
      })
    })
  }

  return {
    onLoadDirectory,
    get crumbs() {
      return cloneCrumbs(visibleCrumbs)
    },
    get visibleDirectoryID() {
      return visibleDirectoryID
    },
    controlRequests() {
      controlled = true
    },
    resolveDirectory(id) {
      const request = pending.find((entry) => entry.id === id && !entry.resolved)
      assert.ok(request, `missing pending directory request for ${id}`)
      request.resolved = true
      request.resolve()
    },
  }
}

function createNavigationHarness(driver) {
  const runtime = createHookRuntime()
  const useNavigation = loadNavigationHook(runtime.react)
  const navigated = []

  return {
    render() {
      return runtime.render(() => useNavigation({
        crumbs: driver.crumbs,
        viewModeStorageKey: 'xdrive.test.fileexplorer.navigation-race',
        onLoadDirectory: driver.onLoadDirectory,
        onAfterNavigate: (crumbs) => {
          navigated.push(cloneCrumbs(crumbs))
        },
      }))
    },
    navigated,
  }
}

test('rapid same-tab folder navigation keeps tab title aligned with the newest visible directory', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }
  const folderC = { id: 3, name: 'C' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  const navigation = harness.render()
  driver.controlRequests()

  const toB = navigation.navigateTo([root, folderB])
  const toC = navigation.navigateTo([root, folderC])

  driver.resolveDirectory(folderC.id)
  await toC

  driver.resolveDirectory(folderB.id)
  await toB

  const finalNavigation = harness.render()
  const activeTab = finalNavigation.tabs.find(
    (tab) => tab.id === finalNavigation.activeTabID,
  )

  assert.equal(driver.visibleDirectoryID, folderC.id)
  assert.equal(finalNavigation.current.id, folderC.id)
  assert.equal(finalNavigation.pathValue, '我的文件/C')
  assert.equal(
    activeTab.label,
    folderC.name,
    'tab title must not be overwritten by a stale earlier navigation completion',
  )
})

test('rapid multi-tab activation keeps active tab, address, directory and tree target on the same workspace', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }
  const folderC = { id: 3, name: 'C' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  let navigation = harness.render()

  await navigation.newTab()
  navigation = harness.render()
  const tabB = navigation.activeTabID
  await navigation.navigateTo([root, folderB])
  navigation = harness.render()

  await navigation.newTab()
  navigation = harness.render()
  const tabC = navigation.activeTabID
  await navigation.navigateTo([root, folderC])
  navigation = harness.render()

  await navigation.activateTab('tab-1')
  navigation = harness.render()
  assert.equal(navigation.activeTabID, 'tab-1')
  assert.equal(driver.visibleDirectoryID, root.id)

  driver.controlRequests()

  const activateB = navigation.activateTab(tabB)
  const activateC = navigation.activateTab(tabC)

  driver.resolveDirectory(folderC.id)
  await activateC

  driver.resolveDirectory(folderB.id)
  await activateB

  const finalNavigation = harness.render()
  const activeTab = finalNavigation.tabs.find(
    (tab) => tab.id === finalNavigation.activeTabID,
  )

  assert.equal(driver.visibleDirectoryID, folderC.id)
  assert.equal(finalNavigation.current.id, folderC.id)
  assert.equal(finalNavigation.pathValue, '我的文件/C')
  assert.equal(
    finalNavigation.activeTabID,
    tabC,
    'stale tab activation must not become active after the newer tab already won',
  )
  assert.equal(
    activeTab.label,
    folderC.name,
    'active tab title must match the address, visible directory and navigation-tree target',
  )
})

test('closing a tab while its activation is pending cannot resurrect the closed workspace', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  let navigation = harness.render()

  await navigation.newTab()
  navigation = harness.render()
  const tabB = navigation.activeTabID
  await navigation.navigateTo([root, folderB])
  navigation = harness.render()

  await navigation.activateTab('tab-1')
  navigation = harness.render()
  assert.equal(navigation.activeTabID, 'tab-1')
  assert.equal(driver.visibleDirectoryID, root.id)

  driver.controlRequests()

  const activateB = navigation.activateTab(tabB)
  await navigation.closeTab(tabB)

  navigation = harness.render()
  assert.equal(
    navigation.tabs.some((tab) => tab.id === tabB),
    false,
    'closed tab must disappear immediately even while its old activation request is pending',
  )

  driver.resolveDirectory(folderB.id)
  await activateB

  const finalNavigation = harness.render()
  assert.equal(
    finalNavigation.activeTabID,
    'tab-1',
    'a stale activation completion must not reactivate a tab that has already been closed',
  )
  assert.equal(driver.visibleDirectoryID, root.id)
  assert.equal(finalNavigation.current.id, root.id)
  assert.equal(finalNavigation.pathValue, '我的文件')
})


test('rapid back navigation cannot overwrite a newer direct folder navigation', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }
  const folderC = { id: 3, name: 'C' }
  const folderD = { id: 4, name: 'D' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  let navigation = harness.render()
  await navigation.navigateTo([root, folderB])
  navigation = harness.render()
  await navigation.navigateTo([root, folderC])
  navigation = harness.render()

  driver.controlRequests()
  const backToB = navigation.goBack()
  const directToD = navigation.navigateTo([root, folderD])

  driver.resolveDirectory(folderD.id)
  await directToD
  driver.resolveDirectory(folderB.id)
  await backToB

  const finalNavigation = harness.render()
  const activeTab = finalNavigation.tabs.find(
    (tab) => tab.id === finalNavigation.activeTabID,
  )
  assert.equal(driver.visibleDirectoryID, folderD.id)
  assert.equal(finalNavigation.pathValue, '我的文件/D')
  assert.equal(activeTab.label, folderD.name)
})

test('sort refresh supersedes an older pending folder navigation without corrupting history', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderB = { id: 2, name: 'B' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)

  harness.render()
  const navigation = harness.render()
  driver.controlRequests()

  const toB = navigation.navigateTo([root, folderB])
  navigation.changeSort({ key: 'updated', direction: 'desc' })

  driver.resolveDirectory(root.id)
  await flushAsync()
  driver.resolveDirectory(folderB.id)
  await toB

  const finalNavigation = harness.render()
  const activeTab = finalNavigation.tabs.find(
    (tab) => tab.id === finalNavigation.activeTabID,
  )
  assert.equal(driver.visibleDirectoryID, root.id)
  assert.equal(finalNavigation.pathValue, '我的文件')
  assert.equal(activeTab.label, root.name)
  assert.deepEqual(finalNavigation.sort, { key: 'updated', direction: 'desc' })
})

test('stale typed-path resolution cannot override a newer direct folder click', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderA = { id: 2, name: 'A', type: 'dir' }
  const folderB = { id: 3, name: 'B' }

  const driver = createDirectoryDriver([root])
  const harness = createNavigationHarness(driver)
  const { xDriveFileExplorerSubmitPath } = loadFileExplorerController()

  harness.render()
  let navigation = harness.render()

  let releaseChildLookup
  let markChildLookupRequested
  const childLookupRequested = new Promise((resolve) => {
    markChildLookupRequested = resolve
  })
  const findChildDirectory = () => new Promise((resolve) => {
    releaseChildLookup = resolve
    markChildLookupRequested()
  })

  const navigationIntentID = navigation.beginNavigationIntent()
  const typedPath = xDriveFileExplorerSubmitPath({
    rawPath: '我的文件/A',
    currentCrumbs: [root],
    loadRoot: async () => root,
    findChildDirectory,
    navigate: (nextCrumbs) => (
      navigation.navigateTo(nextCrumbs, true, navigationIntentID)
    ),
  })

  await childLookupRequested
  await navigation.navigateTo([root, folderB])
  navigation = harness.render()
  assert.equal(driver.visibleDirectoryID, folderB.id)

  releaseChildLookup(folderA)
  await typedPath

  const finalNavigation = harness.render()
  assert.equal(
    driver.visibleDirectoryID,
    folderB.id,
    'an older typed-path intent must not steal navigation after a newer folder click',
  )
  assert.equal(finalNavigation.pathValue, '我的文件/B')
})

test('stale Quick Access lookup cannot override a newer direct folder click', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderA = { id: 2, name: 'A' }
  const folderB = { id: 3, name: 'B' }
  const quickItem = {
    node: { id: folderA.id, name: folderA.name },
    path: '/A',
    crumbs: [root, folderA],
    pinned_at: '2026-10-06T00:00:00Z',
  }

  const driver = createDirectoryDriver([root])
  const navigationHarness = createNavigationHarness(driver)
  const quickRuntime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(quickRuntime.react)
  let controlled = false
  let releaseLookup
  const loadItems = () => {
    if (!controlled) return Promise.resolve([quickItem])
    return new Promise((resolve) => {
      releaseLookup = () => resolve([quickItem])
    })
  }
  const renderQuick = () => quickRuntime.render(() => useQuickAccess({
    loadItems,
    pinItem: async () => quickItem,
    unpinItem: async () => undefined,
    onError: (error) => { throw error },
  }))

  navigationHarness.render()
  let navigation = navigationHarness.render()
  renderQuick()
  await flushAsync()
  const quick = renderQuick()

  controlled = true
  const navigationIntentID = navigation.beginNavigationIntent()
  const staleQuick = quick.navigate(
    folderA.id,
    (nextCrumbs) => navigation.navigateTo(nextCrumbs, true, navigationIntentID),
  )
  await flushAsync()

  await navigation.navigateTo([root, folderB])
  navigation = navigationHarness.render()
  assert.equal(driver.visibleDirectoryID, folderB.id)

  releaseLookup()
  await staleQuick

  const finalNavigation = navigationHarness.render()
  assert.equal(
    driver.visibleDirectoryID,
    folderB.id,
    'an older Quick Access lookup must not steal navigation after a newer folder click',
  )
  assert.equal(finalNavigation.pathValue, '我的文件/B')
})

test('stale Recent lookup cannot override a newer direct folder click', async () => {
  const root = { id: 1, name: '我的文件' }
  const folderA = { id: 2, name: 'A' }
  const folderB = { id: 3, name: 'B' }
  const recentItem = {
    node: { id: folderA.id, name: folderA.name, type: 'dir' },
    path: '/A',
    crumbs: [root, folderA],
    accessed_at: '2026-10-06T00:00:00Z',
  }

  const driver = createDirectoryDriver([root])
  const navigationHarness = createNavigationHarness(driver)
  const recentRuntime = createHookRuntime()
  const useRecent = loadRecentHook(recentRuntime.react)
  let controlled = false
  let releaseLookup
  const loadItems = () => {
    if (!controlled) return Promise.resolve([recentItem])
    return new Promise((resolve) => {
      releaseLookup = () => resolve([recentItem])
    })
  }
  const renderRecent = () => recentRuntime.render(() => useRecent({
    loadItems,
    touchItem: async () => recentItem,
    clearItems: async () => undefined,
  }))

  navigationHarness.render()
  let navigation = navigationHarness.render()
  renderRecent()
  await flushAsync()
  const recent = renderRecent()

  controlled = true
  const navigationIntentID = navigation.beginNavigationIntent()
  const staleRecent = recent.activate(folderA.id, {
    onDirectory: (nextCrumbs) => (
      navigation.navigateTo(nextCrumbs, true, navigationIntentID)
    ),
    onFile: async () => undefined,
  })
  await flushAsync()

  await navigation.navigateTo([root, folderB])
  navigation = navigationHarness.render()
  assert.equal(driver.visibleDirectoryID, folderB.id)

  releaseLookup()
  await staleRecent

  const finalNavigation = navigationHarness.render()
  assert.equal(
    driver.visibleDirectoryID,
    folderB.id,
    'an older Recent lookup must not steal navigation after a newer folder click',
  )
  assert.equal(finalNavigation.pathValue, '我的文件/B')
})

test('newer search submission wins when search responses complete out of order', async () => {
  const runtime = createHookRuntime()
  const useSearch = loadSearchHook(runtime.react)
  const pending = new Map()
  const loadPage = (query) => new Promise((resolve) => {
    pending.set(query, resolve)
  })
  const errors = []
  const renderSearch = () => runtime.render(() => useSearch({
    loadPage,
    onError: (error) => errors.push(error),
  }))

  let search = renderSearch()
  const oldSearch = search.submitSearch('old')
  search = renderSearch()
  const newSearch = search.submitSearch('new')

  pending.get('new')({
    items: [{ node: { id: 20 }, path: '/new' }],
    next_cursor: '',
  })
  await newSearch

  pending.get('old')({
    items: [{ node: { id: 10 }, path: '/old' }],
    next_cursor: '',
  })
  await oldSearch

  search = renderSearch()
  assert.equal(errors.length, 0)
  assert.equal(search.searchState.query, 'new')
  assert.deepEqual(search.searchResults.map((item) => item.node.id), [20])
})

test('newer Quick Access refresh wins when refresh responses complete out of order', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)
  const root = { id: 1, name: '我的文件' }
  const oldItem = {
    node: { id: 2, name: 'Old' },
    path: '/Old',
    crumbs: [root, { id: 2, name: 'Old' }],
    pinned_at: '2026-10-06T00:00:00Z',
  }
  const newItem = {
    node: { id: 3, name: 'New' },
    path: '/New',
    crumbs: [root, { id: 3, name: 'New' }],
    pinned_at: '2026-10-06T00:01:00Z',
  }

  let controlled = false
  const pending = []
  const loadItems = () => {
    if (!controlled) return Promise.resolve([oldItem])
    return new Promise((resolve) => {
      pending.push(resolve)
    })
  }
  const renderQuick = () => runtime.render(() => useQuickAccess({
    loadItems,
    pinItem: async () => newItem,
    unpinItem: async () => undefined,
    onError: (error) => { throw error },
  }))

  renderQuick()
  await flushAsync()
  let quick = renderQuick()
  assert.deepEqual(quick.items.map((item) => item.id), [oldItem.node.id])

  controlled = true
  const oldRefresh = quick.refresh()
  const newRefresh = quick.refresh()
  assert.equal(pending.length, 2)

  pending[1]([newItem])
  await newRefresh

  pending[0]([oldItem])
  await oldRefresh

  quick = renderQuick()
  assert.deepEqual(
    quick.items.map((item) => item.id),
    [newItem.node.id],
    'an older Quick Access refresh must not overwrite the newer refresh result',
  )
})
