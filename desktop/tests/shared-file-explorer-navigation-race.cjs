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

function loadOperationHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerOperationController.ts'],
    react,
    { '../file-explorer-controller': loadFileExplorerController() },
  ).useXDriveFileExplorerOperationController
}

function loadExternalDropHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerExternalDrop.ts'],
    react,
    {
      '../file-explorer-controller': {
        xDriveFileExplorerExternalDropParentID: (currentID, target) => (
          target?.kind === 'dir' ? Number(target.id) : currentID
        ),
      },
    },
  ).useXDriveFileExplorerExternalDropController
}

function loadSearchHook(react) {
  const controller = loadFileExplorerController()
  const virtualCore = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'virtual-collection.ts'],
    null,
  )
  const virtualController = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts'],
    react,
    { '../virtual-collection': virtualCore },
  )
  const searchFilters = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'file-explorer-search.ts'],
    null,
  )
  const grouping = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'file-explorer-grouping.ts'],
    null,
  )
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts'],
    react,
    {
      '../file-explorer-controller': controller,
      '../file-explorer-search': searchFilters,
      '../file-explorer-grouping': grouping,
      './VirtualCollectionController': virtualController,
    },
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

test('newer search submission wins when range responses complete out of order', async () => {
  const runtime = createHookRuntime()
  const useSearch = loadSearchHook(runtime.react)
  const pending = new Map()
  const loadRange = (query, _filters, _grouping, _sort, offset, limit) => new Promise((resolve) => {
    pending.set(query, { resolve, offset, limit })
  })
  const errors = []
  const renderSearch = () => runtime.render(() => useSearch({
    loadRange,
    sort: { key: 'name', direction: 'asc' },
    grouping: { groupBy: 'none', foldersFirst: true },
    onError: (error) => errors.push(error),
  }))

  let search = renderSearch()
  const oldSearch = search.submitSearch('old')
  search = renderSearch()
  const newSearch = search.submitSearch('new')

  pending.get('new').resolve({
    items: [{ node: { id: 20 }, path: '/new' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
  })
  await newSearch

  pending.get('old').resolve({
    items: [{ node: { id: 10 }, path: '/old' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
  })
  await oldSearch

  search = renderSearch()
  assert.equal(errors.length, 0)
  assert.equal(search.searchState.query, 'new')
  assert.deepEqual(search.searchResults.map((item) => item.node.id), [20])
  assert.equal(search.searchVirtualCollection.itemCount, 1)
})


test('newer structured Search filters win when range responses complete out of order', async () => {
  const runtime = createHookRuntime()
  const useSearch = loadSearchHook(runtime.react)
  const pending = new Map()
  const loadRange = (query, filters, _grouping, _sort, offset, limit) => new Promise((resolve) => {
    pending.set(`${query}:${filters.kind ?? 'all'}:${offset}`, { resolve, limit })
  })
  const errors = []
  const renderSearch = () => runtime.render(() => useSearch({
    loadRange,
    sort: { key: 'name', direction: 'asc' },
    grouping: { groupBy: 'none', foldersFirst: true },
    onError: (error) => errors.push(error),
  }))

  let search = renderSearch()
  search.changeSearchFilters({ kind: 'pdf' })
  search = renderSearch()
  assert.ok(pending.has(':pdf:0'))

  search.changeSearchFilters({ kind: 'image' })
  search = renderSearch()
  assert.ok(pending.has(':image:0'))

  pending.get(':image:0').resolve({
    items: [{ node: { id: 20 }, path: '/new-image.jpg' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
  })
  await flushAsync()

  pending.get(':pdf:0').resolve({
    items: [{ node: { id: 10 }, path: '/old.pdf' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
  })
  await flushAsync()

  search = renderSearch()
  assert.equal(errors.length, 0)
  assert.equal(search.searchState.filters.kind, 'image')
  assert.deepEqual(search.searchResults.map((item) => item.node.id), [20])
})


test('newer Search grouping wins when range responses complete out of order', async () => {
  const runtime = createHookRuntime()
  const useSearch = loadSearchHook(runtime.react)
  const pending = new Map()
  let activeGrouping = { groupBy: 'type', foldersFirst: true }
  const loadRange = (query, filters, grouping, _sort, offset, limit) => new Promise((resolve) => {
    pending.set(`${query}:${filters.kind ?? 'all'}:${grouping.groupBy}:${grouping.foldersFirst}:${offset}`, {
      resolve,
      limit,
    })
  })
  const errors = []
  const renderSearch = () => runtime.render(() => useSearch({
    loadRange,
    sort: { key: 'name', direction: 'asc' },
    grouping: activeGrouping,
    onError: (error) => errors.push(error),
  }))

  let search = renderSearch()
  const first = search.submitSearch('report')
  assert.ok(pending.has('report:all:type:true:0'))

  activeGrouping = { groupBy: 'size', foldersFirst: false }
  search = renderSearch()
  await flushAsync()
  assert.ok(pending.has('report:all:size:false:0'))

  pending.get('report:all:size:false:0').resolve({
    items: [{ node: { id: 20 }, path: '/new-size' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
    groups: [{ key: 'tiny', item_count: 1, start_index: 0 }],
  })
  await flushAsync()

  pending.get('report:all:type:true:0').resolve({
    items: [{ node: { id: 10 }, path: '/old-type' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
    groups: [{ key: 'ext:pdf', item_count: 1, start_index: 0 }],
  })
  await first

  search = renderSearch()
  assert.equal(errors.length, 0)
  assert.deepEqual(search.searchState.groups, [
    { key: 'tiny', item_count: 1, start_index: 0 },
  ])
  assert.deepEqual(search.searchResults.map((item) => item.node.id), [20])
})

test('stale Search viewport ranges cannot overwrite a newer query', async () => {
  const runtime = createHookRuntime()
  const useSearch = loadSearchHook(runtime.react)
  const pending = new Map()
  const loadRange = (query, _filters, _grouping, _sort, offset, limit) => new Promise((resolve) => {
    pending.set(`${query}:${offset}`, { resolve, limit })
  })
  const errors = []
  const renderSearch = () => runtime.render(() => useSearch({
    loadRange,
    sort: { key: 'name', direction: 'asc' },
    grouping: { groupBy: 'none', foldersFirst: true },
    onError: (error) => errors.push(error),
  }))

  let search = renderSearch()
  const initialOld = search.submitSearch('old')
  pending.get('old:0').resolve({
    items: [{ node: { id: 10 }, path: '/old-0' }],
    totalCount: 1000,
    offset: 0,
    limit: 200,
  })
  await initialOld

  search = renderSearch()
  const staleViewport = search.searchVirtualCollection.ensureViewport(400, 420)
  assert.ok(pending.has('old:200'))
  assert.ok(pending.has('old:400'))
  assert.ok(pending.has('old:600'))

  const newer = search.submitSearch('new')
  pending.get('new:0').resolve({
    items: [{ node: { id: 99 }, path: '/new' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
  })
  await newer

  for (const offset of [200, 400, 600]) {
    pending.get(`old:${offset}`).resolve({
      items: [{ node: { id: 1000 + offset }, path: `/old-${offset}` }],
      totalCount: 1000,
      offset,
      limit: 200,
    })
  }
  await staleViewport

  search = renderSearch()
  assert.equal(errors.length, 0)
  assert.equal(search.searchState.query, 'new')
  assert.equal(search.searchVirtualCollection.itemCount, 1)
  assert.deepEqual(search.searchResults.map((item) => item.node.id), [99])
})

test('Search tab switch invalidates old ranges and restores the tab query on return', async () => {
  const runtime = createHookRuntime()
  const useSearch = loadSearchHook(runtime.react)
  const pending = new Map()
  const loadRange = (query, _filters, _grouping, _sort, offset, limit) => new Promise((resolve) => {
    const key = `${query}:${offset}`
    const queue = pending.get(key) ?? []
    queue.push({ resolve, limit })
    pending.set(key, queue)
  })
  const take = (query, offset) => {
    const key = `${query}:${offset}`
    const queue = pending.get(key) ?? []
    assert.ok(queue.length > 0, `missing pending Search range ${key}`)
    return queue.shift()
  }
  const errors = []
  let workspaceKey = 'tab-a'
  const renderSearch = () => runtime.render(() => useSearch({
    loadRange,
    sort: { key: 'name', direction: 'asc' },
    grouping: { groupBy: 'none', foldersFirst: true },
    workspaceKey,
    onError: (error) => errors.push(error),
  }))

  let search = renderSearch()
  const aInitial = search.submitSearch('alpha')
  take('alpha', 0).resolve({
    items: [{ node: { id: 1 }, path: '/alpha' }],
    totalCount: 600,
    offset: 0,
    limit: 200,
  })
  await aInitial

  search = renderSearch()
  const staleAViewport = search.searchVirtualCollection.ensureViewport(200, 220)
  assert.ok((pending.get('alpha:200') ?? []).length > 0)

  workspaceKey = 'tab-b'
  search = renderSearch()
  const bInitial = search.submitSearch('beta')
  take('beta', 0).resolve({
    items: [{ node: { id: 2 }, path: '/beta' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
  })
  await bInitial

  for (const offset of [200, 400]) {
    const queue = pending.get(`alpha:${offset}`) ?? []
    while (queue.length > 0) {
      queue.shift().resolve({
        items: [{ node: { id: 100 + offset }, path: `/alpha-${offset}` }],
        totalCount: 600,
        offset,
        limit: 200,
      })
    }
  }
  await staleAViewport

  search = renderSearch()
  assert.equal(search.searchState.query, 'beta')
  assert.deepEqual(search.searchResults.map((item) => item.node.id), [2])

  workspaceKey = 'tab-a'
  search = renderSearch()
  assert.equal(search.searchState.query, 'alpha')
  const restored = take('alpha', 0)
  restored.resolve({
    items: [{ node: { id: 3 }, path: '/alpha-restored' }],
    totalCount: 1,
    offset: 0,
    limit: 200,
  })
  await flushAsync()

  search = renderSearch()
  assert.equal(errors.length, 0)
  assert.equal(search.searchState.query, 'alpha')
  assert.deepEqual(search.searchResults.map((item) => item.node.id), [3])
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

test('stale Recent refresh cannot overwrite a newer recorded access', async () => {
  const runtime = createHookRuntime()
  const useRecent = loadRecentHook(runtime.react)
  const root = { id: 1, name: '我的文件' }
  const oldItem = {
    node: { id: 2, name: 'Old', type: 'file' },
    path: '/Old',
    crumbs: [root],
    accessed_at: '2026-10-06T00:00:00Z',
  }
  const recordedItem = {
    node: { id: 3, name: 'New', type: 'file' },
    path: '/New',
    crumbs: [root],
    accessed_at: '2026-10-06T00:01:00Z',
  }

  let controlled = false
  let releaseRefresh
  const loadItems = () => {
    if (!controlled) return Promise.resolve([oldItem])
    return new Promise((resolve) => {
      releaseRefresh = () => resolve([oldItem])
    })
  }
  const renderRecent = () => runtime.render(() => useRecent({
    loadItems,
    touchItem: async (nodeID) => {
      assert.equal(nodeID, recordedItem.node.id)
      return recordedItem
    },
    clearItems: async () => undefined,
  }))

  renderRecent()
  await flushAsync()
  let recent = renderRecent()
  assert.deepEqual(recent.items.map((item) => item.id), [oldItem.node.id])

  controlled = true
  const staleRefresh = recent.refresh()
  await flushAsync()

  await recent.record(recordedItem.node.id)
  recent = renderRecent()
  assert.deepEqual(
    recent.items.map((item) => item.id),
    [recordedItem.node.id, oldItem.node.id],
  )

  releaseRefresh()
  await staleRefresh

  recent = renderRecent()
  assert.deepEqual(
    recent.items.map((item) => item.id),
    [recordedItem.node.id, oldItem.node.id],
    'a stale Recent refresh must not erase a newer recorded access',
  )
})


test('Recent mutations preserve user order when clear follows a pending record', async () => {
  const runtime = createHookRuntime()
  const useRecent = loadRecentHook(runtime.react)
  const root = { id: 1, name: '我的文件' }
  const recordedItem = {
    node: { id: 7, name: 'late.txt', type: 'file' },
    path: '/late.txt',
    crumbs: [root],
    accessed_at: '2026-10-07T00:00:00Z',
  }

  let releaseTouch
  let releaseClear
  let clearCalls = 0
  const renderRecent = () => runtime.render(() => useRecent({
    loadItems: async () => [],
    touchItem: (nodeID) => {
      assert.equal(nodeID, recordedItem.node.id)
      return new Promise((resolve) => {
        releaseTouch = () => resolve(recordedItem)
      })
    },
    clearItems: () => {
      clearCalls += 1
      return new Promise((resolve) => {
        releaseClear = resolve
      })
    },
  }))

  renderRecent()
  await flushAsync()
  let recent = renderRecent()

  const olderRecord = recent.record(recordedItem.node.id)
  const newerClear = recent.clear()
  await flushAsync()

  assert.equal(
    clearCalls,
    0,
    'clear must wait for an earlier Recent record instead of racing the Server mutation',
  )

  releaseTouch()
  assert.equal(await olderRecord, true)
  await flushAsync()
  assert.equal(clearCalls, 1)

  releaseClear()
  assert.equal(await newerClear, true)

  recent = renderRecent()
  assert.deepEqual(
    recent.items,
    [],
    'a newer clear must remain the final Recent state after an older record settles',
  )
})


test('Quick Access mutations preserve user order when pin follows a pending unpin', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)
  const root = { id: 1, name: '我的文件' }
  const pinnedItem = {
    node: { id: 2, name: 'Pinned' },
    path: '/Pinned',
    crumbs: [root, { id: 2, name: 'Pinned' }],
    pinned_at: '2026-10-07T00:00:00Z',
  }

  let releaseUnpin
  let pinCalls = 0
  const renderQuick = () => runtime.render(() => useQuickAccess({
    loadItems: async () => [pinnedItem],
    pinItem: async () => {
      pinCalls += 1
      return pinnedItem
    },
    unpinItem: () => new Promise((resolve) => {
      releaseUnpin = resolve
    }),
    onError: (error) => { throw error },
  }))

  renderQuick()
  await flushAsync()
  let quick = renderQuick()
  assert.deepEqual(quick.items.map((item) => item.id), [pinnedItem.node.id])

  const olderUnpin = quick.unpin(pinnedItem.node.id)
  const newerPin = quick.pin(pinnedItem.node.id)
  await flushAsync()

  assert.equal(
    pinCalls,
    0,
    'the newer pin must wait for the older unpin instead of racing it on the Server',
  )

  releaseUnpin()
  assert.equal(await olderUnpin, true)
  assert.equal(await newerPin, true)
  assert.equal(pinCalls, 1)

  quick = renderQuick()
  assert.deepEqual(
    quick.items.map((item) => item.id),
    [pinnedItem.node.id],
    'the later Quick Access mutation must be the final visible state',
  )
})


test('disabling Quick Access invalidates a pending pin completion', async () => {
  const runtime = createHookRuntime()
  const useQuickAccess = loadQuickAccessHook(runtime.react)
  const root = { id: 1, name: '我的文件' }
  const pinnedItem = {
    node: { id: 9, name: 'Late' },
    path: '/Late',
    crumbs: [root, { id: 9, name: 'Late' }],
    pinned_at: '2026-10-07T00:00:00Z',
  }

  let enabled = true
  let releasePin
  const renderQuick = () => runtime.render(() => useQuickAccess({
    enabled,
    loadItems: async () => [],
    pinItem: () => new Promise((resolve) => {
      releasePin = () => resolve(pinnedItem)
    }),
    unpinItem: async () => undefined,
    onError: (error) => { throw error },
  }))

  renderQuick()
  await flushAsync()
  let quick = renderQuick()
  assert.deepEqual(quick.items, [])

  const pendingPin = quick.pin(pinnedItem.node.id)
  await flushAsync()
  assert.equal(typeof releasePin, 'function')

  enabled = false
  renderQuick()
  await flushAsync()
  quick = renderQuick()
  assert.deepEqual(quick.items, [])

  releasePin()
  assert.equal(await pendingPin, true)

  quick = renderQuick()
  assert.deepEqual(
    quick.items,
    [],
    'a Quick Access mutation started before disable must not repopulate disabled state',
  )
})


test('FileExplorer operation controller blocks same-tick duplicate paste submissions', async () => {
  const runtime = createHookRuntime()
  const useOperation = loadOperationHook(runtime.react)
  const plan = {
    operation: 'copy',
    parentID: 1,
    items: [{ id: 2, revision: 1 }],
    count: 1,
    clearClipboard: false,
  }

  let submitCalls = 0
  let releaseFirst
  const renderOperation = () => runtime.render(() => useOperation({
    nodeByID: new Map(),
    currentID: 1,
    planPaste: () => plan,
    completePaste: () => {},
    canPaste: () => true,
    clearSearch: () => {},
    submitOperation: () => {
      submitCalls += 1
      if (submitCalls === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ id: 'first' })
        })
      }
      return Promise.resolve({ id: 'later' })
    },
    onQueued: () => {},
    onFeedback: () => {},
    onError: (error) => { throw error },
  }))

  let operation = renderOperation()
  const first = operation.pasteClipboard()
  const duplicate = operation.pasteClipboard()
  await flushAsync()

  assert.equal(
    submitCalls,
    1,
    'busy state must synchronously fence a same-tick second durable file operation',
  )

  releaseFirst()
  await first
  await duplicate

  operation = renderOperation()
  assert.equal(operation.busy, false)

  await operation.pasteClipboard()
  assert.equal(
    submitCalls,
    2,
    'the synchronous operation fence must release after the first operation settles',
  )
})


test('stale external-drop completion cannot refresh a directory after navigation moved away', async () => {
  const runtime = createHookRuntime()
  const useExternalDrop = loadExternalDropHook(runtime.react)
  let currentID = 1
  let currentCrumbs = [{ id: 1, name: 'A' }]
  let sort = { key: 'name', direction: 'asc' }
  let grouping = { groupBy: 'none', foldersFirst: true }
  let releaseUpload
  const refreshCalls = []

  const renderDrop = () => runtime.render(() => useExternalDrop({
    currentID,
    currentCrumbs,
    sort,
    currentGrouping: grouping,
    nodeByID: new Map(),
    uploadFilesToParent: () => new Promise((resolve) => {
      releaseUpload = () => resolve(true)
    }),
    uploadFolderEntriesToParent: async () => true,
    refreshCurrentDirectoryIfIdle: async (expectedCurrentID) => {
      if (currentID !== expectedCurrentID) return false
      refreshCalls.push(expectedCurrentID)
      return true
    },
  }))

  const externalDrop = renderDrop()
  const pending = externalDrop.dropFiles([{}], undefined)
  await flushAsync()
  assert.equal(typeof releaseUpload, 'function')

  currentID = 2
  currentCrumbs = [{ id: 2, name: 'B' }]
  sort = { key: 'updated', direction: 'desc' }
  grouping = { groupBy: 'size', foldersFirst: false }
  renderDrop()

  releaseUpload()
  await pending

  assert.deepEqual(
    refreshCalls,
    [],
    'an upload started in A must not refresh A after the workspace has navigated to B',
  )
})

test('external-drop completion delegates its captured directory to the guarded refresh adapter', async () => {
  const runtime = createHookRuntime()
  const useExternalDrop = loadExternalDropHook(runtime.react)
  let currentID = 1
  let currentCrumbs = [{ id: 1, name: 'A' }]
  let sort = { key: 'name', direction: 'asc' }
  let grouping = { groupBy: 'none', foldersFirst: true }
  let releaseUpload
  const refreshCalls = []

  const renderDrop = () => runtime.render(() => useExternalDrop({
    currentID,
    currentCrumbs,
    sort,
    currentGrouping: grouping,
    nodeByID: new Map(),
    uploadFilesToParent: () => new Promise((resolve) => {
      releaseUpload = () => resolve(true)
    }),
    uploadFolderEntriesToParent: async () => true,
    refreshCurrentDirectoryIfIdle: async (expectedCurrentID) => {
      refreshCalls.push(expectedCurrentID)
      return true
    },
  }))

  const externalDrop = renderDrop()
  const pending = externalDrop.dropFiles([{}], undefined)
  await flushAsync()

  currentCrumbs = [{ id: 1, name: 'A renamed' }]
  sort = { key: 'updated', direction: 'desc' }
  grouping = { groupBy: 'size', foldersFirst: false }
  renderDrop()

  releaseUpload()
  await pending

  assert.deepEqual(
    refreshCalls,
    [1],
    'ExternalDrop should pass only the directory captured when the upload started; CloudFiles owns latest crumbs/sort/grouping validation',
  )
})


function loadClipboardHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerClipboard.ts'],
    react,
    { '../file-explorer-controller': loadFileExplorerController() },
  ).useXDriveFileExplorerClipboard
}

test('pending cut paste completion cannot clear a newer clipboard selection', async () => {
  const runtime = createHookRuntime()
  const useClipboard = loadClipboardHook(runtime.react)
  const useOperation = loadOperationHook(runtime.react)
  const nodeByID = new Map([
    [2, { id: 2, revision: 1, parent_id: 1, type: 'file', name: 'A.txt' }],
    [3, { id: 3, revision: 1, parent_id: 1, type: 'file', name: 'B.txt' }],
  ])

  let releaseSubmit
  const render = () => runtime.render(() => {
    const clipboard = useClipboard({ nodeByID })
    const operation = useOperation({
      nodeByID,
      currentID: 9,
      planPaste: clipboard.planPaste,
      completePaste: clipboard.completePaste,
      canPaste: clipboard.canPaste,
      clearSearch: () => {},
      submitOperation: () => new Promise((resolve) => {
        releaseSubmit = () => resolve({ id: 'move-a' })
      }),
      onQueued: () => {},
      onFeedback: () => {},
      onError: (error) => { throw error },
    })
    return { clipboard, operation }
  })

  let controller = render()
  controller.clipboard.cutItems([{ id: 2 }])
  controller = render()

  const cutPlan = controller.clipboard.planPaste(9)
  assert.equal(cutPlan.operation, 'move')
  assert.deepEqual(cutPlan.items.map((item) => item.id), [2])

  const pendingPaste = controller.operation.pasteClipboard()
  await flushAsync()
  assert.equal(typeof releaseSubmit, 'function')

  controller.clipboard.copyItems([{ id: 3 }])
  controller = render()
  const newerPlan = controller.clipboard.planPaste(9)
  assert.equal(newerPlan.operation, 'copy')
  assert.deepEqual(newerPlan.items.map((item) => item.id), [3])

  releaseSubmit()
  await pendingPaste

  controller = render()
  const finalPlan = controller.clipboard.planPaste(9)
  assert.ok(
    finalPlan,
    'an older cut paste completion must not clear clipboard content copied while it was pending',
  )
  assert.equal(finalPlan.operation, 'copy')
  assert.deepEqual(finalPlan.items.map((item) => item.id), [3])
})


test('completed cut paste clears the unchanged clipboard generation', async () => {
  const runtime = createHookRuntime()
  const useClipboard = loadClipboardHook(runtime.react)
  const useOperation = loadOperationHook(runtime.react)
  const nodeByID = new Map([
    [2, { id: 2, revision: 1, parent_id: 1, type: 'file', name: 'A.txt' }],
  ])

  let releaseSubmit
  const render = () => runtime.render(() => {
    const clipboard = useClipboard({ nodeByID })
    const operation = useOperation({
      nodeByID,
      currentID: 9,
      planPaste: clipboard.planPaste,
      completePaste: clipboard.completePaste,
      canPaste: clipboard.canPaste,
      clearSearch: () => {},
      submitOperation: () => new Promise((resolve) => {
        releaseSubmit = () => resolve({ id: 'move-a' })
      }),
      onQueued: () => {},
      onFeedback: () => {},
      onError: (error) => { throw error },
    })
    return { clipboard, operation }
  })

  let controller = render()
  controller.clipboard.cutItems([{ id: 2 }])
  controller = render()

  const pendingPaste = controller.operation.pasteClipboard()
  await flushAsync()
  releaseSubmit()
  await pendingPaste

  controller = render()
  assert.equal(
    controller.clipboard.planPaste(9),
    null,
    'the exact cut clipboard submitted by Paste must still clear after successful queueing',
  )
})
