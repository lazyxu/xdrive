const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')

const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '..', '..'))
const modules = new Map()

// Run the real composed hooks, projection, clipboard and sparse collection.
// Only the platform data loaders below are fixtures.
function loadSource(relativePath) {
  const filename = path.resolve(repo, relativePath)
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request)
    const resolved = path.resolve(path.dirname(filename), request)
    const source = [resolved, `${resolved}.ts`, `${resolved}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (!source) throw new Error(`Missing source import ${request} from ${filename}`)
    return loadSource(source)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

const { useXDriveFileExplorerWorkspace } = loadSource('ui/shared/src/mui/FileExplorerWorkspaceController.ts')
const rootCrumb = { id: 1, name: '我的文件' }
const folderCrumb = { id: 2, name: '项目' }
const folder = { id: 2, parent_id: 1, name: '项目', type: 'dir', revision: 1, size: 0 }

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function searchResult(index, query = 'photo') {
  if (index === 0) return { node: folder, path: '/项目', crumbs: [rootCrumb, folderCrumb] }
  return {
    node: { id: 1000 + index, parent_id: 2, name: `${query}-${index}.jpg`, type: 'file', revision: 1, size: index },
    path: `/项目/${query}-${index}.jpg`,
    crumbs: [rootCrumb, folderCrumb],
  }
}

async function createWorkspace(options = {}) {
  let current, updateDirectory, renderer
  let lifecycleKey = 'account-a'
  let directoryGeneration = 0, renderCount = 0
  const errors = [], requests = [], navigationSnapshots = [], observations = []
  const driver = {
    loadDirectory: options.loadDirectory,
    loadSearch: options.loadSearch,
    totalCount: options.totalCount ?? 10000,
  }
  const onLoadDirectory = async (id, crumbs, sort, grouping) => {
    const generation = ++directoryGeneration
    requests.push({ type: 'directory', id, crumbs, sort, grouping })
    const accepted = driver.loadDirectory ? await driver.loadDirectory(id, crumbs, sort, grouping) : true
    if (accepted === false || generation !== directoryGeneration) return false
    updateDirectory({ crumbs, items: id === 1 ? [folder] : [] })
    return true
  }
  const loadSearchRange = async (query, filters, grouping, sort, offset, limit) => {
    const request = { type: 'search', query, filters, grouping, sort, offset, limit }
    requests.push(request)
    if (driver.loadSearch) return driver.loadSearch(request)
    return {
      items: Array.from({ length: Math.max(0, Math.min(limit, driver.totalCount - offset)) }, (_, index) => searchResult(offset + index, query)),
      offset, limit, totalCount: driver.totalCount, groups: [],
    }
  }
  const props = {
    viewModeStorageKey: 'test-view', onLoadDirectory, loadSearchRange,
    loadRoot: async () => rootCrumb,
    findChildDirectory: async (_parentID, name) => name === folder.name ? folder : null,
    searchCrumbsForResult: (result) => result.crumbs,
    onNavigationStateChange: (state) => navigationSnapshots.push(state),
    onError: (error) => errors.push(error),
  }
  function Harness() {
    renderCount += 1
    assert.ok(renderCount <= 500, 'an idle Workspace must settle without repeatedly resetting its collection')
    const [directory, setDirectory] = React.useState({ crumbs: [rootCrumb], items: [folder] })
    updateDirectory = setDirectory
    current = useXDriveFileExplorerWorkspace({ ...props, ...directory, navigationSessionStorageKey: lifecycleKey })
    const rendered = current
    // Establish the explicitly cleared entry through its public action before
    // exercising history. A separate idle-entry regression covers first mount.
    React.useLayoutEffect(() => { if (options.initialClear !== false) current.clearSearch() }, [])
    React.useLayoutEffect(() => {
      observations.push({
        query: rendered.searchState.query,
        ready: rendered.searchReady,
        loading: rendered.searchLoading,
        groups: rendered.searchState.groups,
        itemCount: rendered.searchVirtualCollection?.itemCount,
      })
    })
    return null
  }
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness)) })
  return {
    get current() { return current },
    get renderCount() { return renderCount },
    driver, errors, requests, navigationSnapshots, observations,
    async run(action) { await TestRenderer.act(async () => { await action(current) }) },
    async flush() { await TestRenderer.act(async () => { await Promise.resolve() }) },
    async replaceAccount(nextKey, crumbs = [rootCrumb]) {
      lifecycleKey = nextKey
      await TestRenderer.act(async () => { updateDirectory({ crumbs, items: [folder] }) })
    },
    async dispose() { await TestRenderer.act(async () => { renderer.unmount() }) },
  }
}

test('Back reactivates the source Search definition and ordering after opening a result folder', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.applySearch('photo', { kind: 'image' }))
    await h.run((workspace) => workspace.changeSort({ key: 'updated', direction: 'desc' }))
    await h.run((workspace) => workspace.changeGrouping({ groupBy: 'type', foldersFirst: false }))
    assert.equal(h.current.searchState.query, 'photo')
    await h.run((workspace) => workspace.openItem(workspace.explorerVirtualCollection.itemAt(0), async () => assert.fail('folder used file opener')))
    assert.equal(h.current.current.id, 2)
    assert.equal(h.current.searchResults, null, 'destination starts as a directory')
    await h.run((workspace) => workspace.changeSort({ key: 'size', direction: 'asc' }))
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.current.id, 1)
    assert.equal(h.current.searchState.query, 'photo', 'Back must restore the suspended Search instead of returning to an empty directory state')
    assert.deepEqual(h.current.searchFilters, { kind: 'image' })
    assert.deepEqual(h.current.sort, { key: 'updated', direction: 'desc' })
    assert.deepEqual(h.current.grouping, { groupBy: 'type', foldersFirst: false })
    assert.equal(h.errors.length, 0)
  } finally { await h.dispose() }
})

function returnSnapshot(workspace, firstVisibleIndex, selectedItems = []) {
  return {
    contentSignature: workspace.explorerViewState.contentSignature,
    firstVisibleIndex,
    firstVisibleID: searchResult(firstVisibleIndex).node.id,
    offsetWithinItem: 17,
    scrollLeft: 23,
    selectedIDs: selectedItems.map((item) => item.id),
    selectedItems,
    activeID: selectedItems[0]?.id ?? null,
    activeIndex: selectedItems.length ? firstVisibleIndex : null,
    selectionAnchorID: selectedItems[0]?.id ?? null,
    selectionAnchorIndex: selectedItems.length ? firstVisibleIndex : null,
    touchSelectionMode: selectedItems.length > 0,
  }
}

test('history return snapshots retain selected metadata while reloading only the saved sparse window', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.applySearch('photo', { kind: 'image' }))
    assert.equal(typeof h.current.explorerViewState, 'object', 'shared workspace supplies the optional view-state bridge')
    await h.run((workspace) => workspace.explorerVirtualCollection.onRangeChange(1300, 1320))
    const selected = h.current.explorerVirtualCollection.itemAt(1300)
    h.current.explorerViewState.writeSnapshot(returnSnapshot(h.current, 1300, [selected]))
    await h.run((workspace) => workspace.explorerVirtualCollection.onRangeChange(6000, 6040))
    const saved = returnSnapshot(h.current, 6000, [selected])
    const sourceKey = h.current.explorerViewState.stateKey
    h.current.explorerViewState.writeSnapshot(saved)
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    assert.notEqual(h.current.explorerViewState.stateKey, sourceKey)
    const requestStart = h.requests.length
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.explorerViewState.stateKey, sourceKey)
    assert.deepEqual(h.current.explorerViewState.readSnapshot(), saved)
    assert.equal(h.current.explorerViewState.ready, true)
    await h.run((workspace) => workspace.explorerVirtualCollection.onRangeChange(saved.firstVisibleIndex, saved.firstVisibleIndex + 40))
    const offsets = h.requests.slice(requestStart).filter((request) => request.type === 'search').map((request) => request.offset)
    assert.ok(offsets.includes(0) && offsets.includes(6000))
    assert.ok(offsets.length <= 4 && offsets.every((offset) => offset === 0 || (offset >= 5800 && offset <= 6200)), JSON.stringify(offsets))
    const opened = []
    await h.run((workspace) => workspace.openItem(selected, async (node) => opened.push(node.id)))
    assert.deepEqual(opened, [2300], 'already-resolved selected raw metadata survives page eviction and history return')
    assert.equal(h.current.searchByID.get(2300)?.crumbs.at(-1).id, 2)
    assert.equal(h.errors.length, 0)
  } finally { await h.dispose() }
})

test('show containing folder uses authoritative file and folder Search breadcrumb shapes', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.submitSearch('photo'))
    assert.equal(typeof h.current.showItemInContainingFolder, 'function')
    const fileItem = h.current.explorerVirtualCollection.itemAt(1)
    await h.run((workspace) => workspace.showItemInContainingFolder(fileItem))
    assert.equal(h.current.current.id, 2, 'file crumbs already end at the containing folder')
    await h.run((workspace) => workspace.goBack())
    const folderItem = h.current.explorerVirtualCollection.itemAt(0)
    await h.run((workspace) => workspace.showItemInContainingFolder(folderItem))
    assert.equal(h.current.current.id, 1, 'folder crumbs include the folder and must drop its final crumb')
    assert.equal(h.current.searchResults, null, 'same-folder reveal still creates a distinct directory context')
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.searchState.query, 'photo')
    const before = h.requests.length
    await h.run((workspace) => workspace.showItemInContainingFolder({ id: -99, name: 'invented/path.jpg', kind: 'file', path: '/guess/me' }))
    assert.equal(h.requests.length, before, 'missing authoritative metadata never falls back to a path string')
  } finally { await h.dispose() }
})

test('a fresh idle Search entry settles without repeatedly resetting its collection', async () => {
  const h = await createWorkspace({ initialClear: false })
  try {
    assert.equal(h.current.searchResults, null)
    assert.ok(h.renderCount < 10, `idle render count ${h.renderCount}`)
    assert.equal(h.requests.length, 0)
  } finally { await h.dispose() }
})

test('distinct Search history entries survive Back/Forward and discard a replaced forward branch', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.submitSearch('alpha'))
    const a = h.current.explorerViewState
    a.writeSnapshot(returnSnapshot(h.current, 10))
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    await h.run((workspace) => workspace.applySearch('beta', { kind: 'pdf' }))
    const b = h.current.explorerViewState
    b.writeSnapshot(returnSnapshot(h.current, 20))
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb, { id: 3, name: '子目录' }]))
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.searchState.query, 'beta')
    assert.equal(h.current.explorerViewState.readSnapshot().firstVisibleIndex, 20)
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.searchState.query, 'alpha')
    assert.equal(h.current.explorerViewState.readSnapshot().firstVisibleIndex, 10)
    await h.run((workspace) => workspace.goForward())
    assert.equal(h.current.searchState.query, 'beta')
    await h.run((workspace) => workspace.goBack())
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    assert.notEqual(h.current.explorerViewState.stateKey, b.stateKey, 'reusing a folder and history index must not reuse a discarded entry identity')
    assert.equal(h.current.searchResults, null)
    assert.equal(h.current.explorerViewState.readSnapshot(), undefined)
    assert.equal(b.readSnapshot(), undefined, 'discarded forward snapshots are pruned')
    b.writeSnapshot({ ...returnSnapshot(h.current, 99), contentSignature: b.contentSignature })
    assert.equal(b.readSnapshot(), undefined, 'late writes cannot recreate a pruned record')
    assert.equal(h.current.canGoForward, false)
  } finally { await h.dispose() }
})

test('tab reordering, close/restore and activation preserve Search identity while duplication starts idle', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.submitSearch('alpha'))
    const tabA = h.current.activeTabID
    const keyA = h.current.explorerViewState.stateKey
    await h.run((workspace) => workspace.openTab([rootCrumb, folderCrumb]))
    assert.equal(h.current.searchResults, null)
    await h.run((workspace) => workspace.submitSearch('beta'))
    const tabB = h.current.activeTabID
    const keyB = h.current.explorerViewState.stateKey
    h.current.explorerViewState.writeSnapshot(returnSnapshot(h.current, 40))
    const requestsBeforeReorder = h.requests.length
    await h.run((workspace) => workspace.reorderTab(tabB, tabA, 'before'))
    assert.equal(h.requests.length, requestsBeforeReorder, 'reordering does not reload either collection')
    assert.equal(h.current.explorerViewState.stateKey, keyB)
    await h.run((workspace) => workspace.closeTab())
    assert.equal(h.current.explorerViewState.stateKey, keyA)
    assert.equal(h.current.searchState.query, 'alpha')
    await h.run((workspace) => workspace.restoreClosedTab())
    assert.equal(h.current.explorerViewState.stateKey, keyB)
    assert.equal(h.current.searchState.query, 'beta')
    assert.equal(h.current.explorerViewState.readSnapshot().firstVisibleIndex, 40)
    await h.run((workspace) => workspace.duplicateTab())
    assert.equal(h.current.searchResults, null, 'duplicate retains folder history without copying transient Search definitions')
    assert.notEqual(h.current.explorerViewState.stateKey, keyB)
    await h.run((workspace) => workspace.activateTab(tabB))
    assert.equal(h.current.searchState.query, 'beta')
    assert.equal(h.current.explorerViewState.stateKey, keyB)
  } finally { await h.dispose() }
})

test('filter-only empty Search is ready and explicit Clear cannot resurrect on a later Back', async () => {
  const h = await createWorkspace({ totalCount: 0 })
  try {
    await h.run((workspace) => workspace.applySearch('', { kind: 'image' }))
    assert.deepEqual(h.current.searchResults, [])
    assert.equal(h.current.searchReady, true)
    assert.equal(h.current.searchError, null)
    assert.equal(h.current.searchVirtualCollection.itemCount, 0)
    h.current.explorerViewState.writeSnapshot(returnSnapshot(h.current, 0))
    await h.run((workspace) => workspace.clearSearch())
    assert.equal(h.current.searchResults, null)
    assert.equal(h.current.explorerViewState.readSnapshot(), undefined)
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.searchResults, null)
    assert.deepEqual(h.current.searchFilters, {})
  } finally { await h.dispose() }
})

test('failed navigation and failed Search return retain their snapshot until a successful retry', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.submitSearch('photo'))
    const source = h.current.explorerViewState
    const saved = returnSnapshot(h.current, 6000)
    source.writeSnapshot(saved)
    h.driver.loadDirectory = async () => false
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    assert.equal(h.current.explorerViewState.stateKey, source.stateKey)
    assert.equal(h.current.searchState.query, 'photo')
    assert.deepEqual(source.readSnapshot(), saved)
    h.driver.loadDirectory = undefined
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    const destinationKey = h.current.explorerViewState.stateKey
    h.driver.loadDirectory = async () => false
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.explorerViewState.stateKey, destinationKey, 'failed folder load does not commit a history transition')
    assert.deepEqual(source.readSnapshot(), saved)
    h.driver.loadDirectory = undefined
    h.driver.loadSearch = async () => { throw new Error('return range unavailable') }
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.searchState.query, 'photo')
    assert.equal(h.current.searchReady, false, 'failed initial range is not a successful empty Search')
    assert.equal(h.current.searchError, 'return range unavailable')
    assert.equal(h.current.explorerViewState.ready, false)
    assert.deepEqual(h.current.explorerViewState.readSnapshot(), saved)
    h.driver.loadSearch = undefined
    await h.run((workspace) => workspace.retrySearch())
    assert.equal(h.current.searchReady, true)
    assert.equal(h.current.searchError, null)
    assert.deepEqual(h.current.explorerViewState.readSnapshot(), saved)
    assert.equal(h.errors.length, 1)
  } finally { await h.dispose() }
})

test('automatic Search reactivation cannot reserve a new intent over a newer folder navigation', async () => {
  const h = await createWorkspace()
  const nextFolder = deferred()
  let newerNavigation
  try {
    await h.run((workspace) => workspace.submitSearch('photo'))
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    h.driver.loadDirectory = (id) => id === 3 ? nextFolder.promise : true
    await h.run(async (workspace) => {
      await workspace.goBack()
      newerNavigation = h.current.navigateTo([rootCrumb, { id: 3, name: '新目标' }])
    })
    await h.run(async () => { nextFolder.resolve(true); await newerNavigation })
    assert.equal(h.current.current.id, 3)
    assert.equal(h.current.tabs.find((tab) => tab.id === h.current.activeTabID).label, '新目标')
    assert.equal(h.current.searchResults, null)
  } finally { nextFolder.resolve(false); await h.dispose() }
})

test('newer query and stale clear cannot overwrite a pending restored Search', async () => {
  const h = await createWorkspace()
  const oldRange = deferred()
  try {
    await h.run((workspace) => workspace.submitSearch('alpha'))
    const staleClear = h.current.clearSearch
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    h.driver.loadSearch = (request) => request.query === 'alpha'
      ? oldRange.promise
      : { items: [searchResult(1, request.query)], totalCount: 1, offset: 0, limit: request.limit, groups: [] }
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.searchReady, false)
    await h.run((workspace) => workspace.submitSearch('beta'))
    assert.equal(staleClear(), false)
    await h.run(async () => {
      oldRange.resolve({ items: [searchResult(2, 'alpha')], totalCount: 1, offset: 0, limit: 200, groups: [] })
      await oldRange.promise
    })
    assert.equal(h.current.searchState.query, 'beta')
    assert.equal(h.current.searchResults[0].node.name, 'beta-1.jpg')
    assert.equal(h.current.searchReady, true)
  } finally { oldRange.resolve({ items: [], totalCount: 0, offset: 0, limit: 200 }); await h.dispose() }
})

test('transient return records are bounded to 64 history entries without truncating folder Back history', async () => {
  const h = await createWorkspace({ totalCount: 1 })
  try {
    await h.run((workspace) => workspace.submitSearch('old-search'))
    const old = h.current.explorerViewState
    old.writeSnapshot(returnSnapshot(h.current, 0))
    for (let index = 0; index < 70; index += 1) {
      await h.run((workspace) => workspace.navigateTo([rootCrumb, { id: index + 10, name: `目录${index}` }]))
      h.current.explorerViewState.writeSnapshot(returnSnapshot(h.current, index))
    }
    assert.equal(h.current.retainedHistoryEntries.filter((entry) => entry.tabID === h.current.activeTabID).length, 64)
    assert.equal(old.readSnapshot(), undefined)
    for (let index = 0; index < 70; index += 1) await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.current.id, 1)
    assert.equal(h.current.canGoBack, false)
    assert.equal(h.current.searchResults, null, 'expired transient Search remains a valid folder-only history entry')
  } finally { await h.dispose() }
})

test('account replacement reusing tab and node IDs exposes no prior Search, return snapshot or selected raw metadata', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.submitSearch('private-account-a'))
    await h.run((workspace) => workspace.explorerVirtualCollection.onRangeChange(1300, 1320))
    const selected = h.current.explorerVirtualCollection.itemAt(1300)
    const oldBridge = h.current.explorerViewState
    const oldSnapshot = returnSnapshot(h.current, 1300, [selected])
    oldBridge.writeSnapshot(oldSnapshot)
    const oldClear = h.current.clearSearch
    await h.replaceAccount('account-b', [{ id: 1, name: 'B Files' }])
    assert.equal(h.current.activeTabID, 'tab-1')
    assert.equal(h.current.searchResults, null)
    assert.equal(h.current.searchValue, '')
    assert.deepEqual(h.current.searchFilters, {})
    assert.equal(h.current.explorerViewState.readSnapshot(), undefined)
    assert.equal(h.current.nodeByID.has(selected.id), false)
    assert.equal(h.current.searchByID.has(selected.id), false)
    assert.equal(oldClear(), false)
    oldBridge.writeSnapshot(oldSnapshot)
    assert.equal(h.current.explorerViewState.readSnapshot(), undefined)
    await h.run((workspace) => workspace.submitSearch('public-account-b'))
    assert.equal(h.current.searchResults[1].node.name, 'public-account-b-1.jpg')
    await h.replaceAccount('account-a', [{ id: 1, name: '我的文件' }])
    assert.equal(h.current.searchValue, '', 'returning to a previous account starts a fresh runtime lifecycle')
    assert.equal(h.current.explorerViewState.readSnapshot(), undefined)
    const serialized = JSON.stringify(h.navigationSnapshots)
    assert.equal(serialized.includes('private-account-a'), false)
    assert.equal(serialized.includes('contentSignature'), false)
    assert.equal(serialized.includes('firstVisibleIndex'), false)
    for (const state of h.navigationSnapshots) {
      for (const tab of state.tabs) assert.deepEqual(Object.keys(tab).sort(), ['grouping', 'history', 'historyIndex', 'id', 'sort', 'viewMode'])
    }
  } finally { await h.dispose() }
})

test('Forward restores the destination directory ordering after Back restored a differently ordered Search', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.submitSearch('photo'))
    await h.run((workspace) => workspace.changeSort({ key: 'updated', direction: 'desc' }))
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    await h.run((workspace) => workspace.changeSort({ key: 'name', direction: 'asc' }))
    await h.run((workspace) => workspace.changeGrouping({ groupBy: 'size', foldersFirst: false }))
    await h.run((workspace) => workspace.goBack())
    assert.deepEqual(h.current.sort, { key: 'updated', direction: 'desc' })
    await h.run((workspace) => workspace.goForward())
    assert.equal(h.current.current.id, 2)
    assert.equal(h.current.searchResults, null)
    assert.deepEqual(h.current.sort, { key: 'name', direction: 'asc' }, 'Forward must use the destination entry ordering, not inherit Search ordering')
    assert.deepEqual(h.current.grouping, { groupBy: 'size', foldersFirst: false })
    assert.deepEqual(h.requests.filter((request) => request.type === 'directory').at(-1).sort, { key: 'name', direction: 'asc' })
  } finally { await h.dispose() }
})

test('one failed restore range remains failed when a different parallel range succeeds', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.submitSearch('photo'))
    const saved = returnSnapshot(h.current, 6000)
    h.current.explorerViewState.writeSnapshot(saved)
    h.driver.loadSearch = async (request) => {
      if (request.offset === 6000) throw new Error('saved window unavailable')
      return {
        items: Array.from({ length: request.limit }, (_, index) => searchResult(request.offset + index)),
        offset: request.offset, limit: request.limit, totalCount: 10000, groups: [],
      }
    }
    await h.run((workspace) => workspace.explorerVirtualCollection.onRangeChange(6000, 6040))
    assert.equal(h.current.searchReady, false, 'a successful neighboring range must not hide the failed saved window')
    assert.equal(h.current.searchError, 'saved window unavailable')
    assert.deepEqual(h.current.explorerViewState.readSnapshot(), saved)
    h.driver.loadSearch = undefined
    await h.run((workspace) => workspace.retrySearch())
    await h.run((workspace) => workspace.explorerVirtualCollection.onRangeChange(6000, 6040))
    assert.equal(h.current.searchReady, true)
    assert.equal(h.current.searchError, null)
    assert.equal(h.current.explorerVirtualCollection.itemAt(6000).id, 7000)
  } finally { await h.dispose() }
})

test('a file result in the current anchor folder still exits Search into a fresh history entry', async () => {
  const h = await createWorkspace()
  try {
    await h.run((workspace) => workspace.navigateTo([rootCrumb, folderCrumb]))
    await h.run((workspace) => workspace.submitSearch('photo'))
    const sourceKey = h.current.explorerViewState.stateKey
    const file = h.current.explorerVirtualCollection.itemAt(1)
    await h.run((workspace) => workspace.showItemInContainingFolder(file))
    assert.equal(h.current.current.id, 2)
    assert.equal(h.current.searchResults, null)
    assert.notEqual(h.current.explorerViewState.stateKey, sourceKey)
    await h.run((workspace) => workspace.goBack())
    assert.equal(h.current.explorerViewState.stateKey, sourceKey)
    assert.equal(h.current.searchState.query, 'photo')
  } finally { await h.dispose() }
})

test('Search readiness waits for the complete authoritative count and group commit', async () => {
  const groups = [{ key: 'folder', start_index: 0, item_count: 1 }, { key: 'ext:jpg', start_index: 1, item_count: 9999 }]
  const h = await createWorkspace({
    loadSearch: async (request) => ({
      items: Array.from({ length: request.limit }, (_, index) => searchResult(request.offset + index)),
      offset: request.offset, limit: request.limit, totalCount: 10000, groups,
    }),
  })
  try {
    await h.run((workspace) => workspace.changeGrouping({ groupBy: 'type', foldersFirst: false }))
    await h.run((workspace) => workspace.submitSearch('photo'))
    const ready = h.observations.filter((observation) => observation.query === 'photo' && observation.ready)
    assert.ok(ready.length > 0)
    assert.deepEqual(ready.filter((observation) => observation.loading || observation.groups.length !== groups.length), [], 'a ready render must include the complete counted load and its group index')
  } finally { await h.dispose() }
})

test('evicting an old closed tab also prunes its transient Search return snapshot', async () => {
  const h = await createWorkspace({ totalCount: 1 })
  let oldest
  try {
    for (let index = 0; index < 17; index += 1) {
      await h.run((workspace) => workspace.openTab([rootCrumb, { id: index + 20, name: `关闭的目录${index}` }]))
      await h.run((workspace) => workspace.submitSearch(`closed-${index}`))
      h.current.explorerViewState.writeSnapshot(returnSnapshot(h.current, 0))
      if (index === 0) oldest = h.current.explorerViewState
      await h.run((workspace) => workspace.closeTab())
    }
    assert.equal(oldest.readSnapshot(), undefined, 'the existing 16-tab closed stack bounds retained Search snapshots too')
    assert.equal(h.current.tabs.length, 1)
    assert.equal(h.current.retainedHistoryEntries.length, 17, 'one open entry plus sixteen retained closed entries')
    await h.run((workspace) => workspace.restoreClosedTab())
    assert.equal(h.current.searchState.query, 'closed-16')
  } finally { await h.dispose() }
})



function registerMutationSearchIntentCases() {
  const { useXDriveFileExplorerOperationController } = loadSource('ui/shared/src/mui/FileExplorerOperationController.ts')
  const shared = loadSource('ui/shared/src/file-explorer-controller.ts')

  function adapterFunction(platform, name, dependencies) {
    const file = path.join(repo, platform === 'Web' ? 'web/src/WebFileExplorer.tsx' : 'desktop/src/renderer/DesktopFileExplorer.tsx')
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let expression
    function visit(current) {
      if (ts.isVariableDeclaration(current) && current.name.getText(ast) === name && current.initializer) expression = current.initializer.getText(ast)
      ts.forEachChild(current, visit)
    }
    visit(ast)
    assert.ok(expression, `${platform} ${name} is available`)
    const output = ts.transpileModule(`const callback = ${expression};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
    }).outputText
    return new Function(...Object.keys(dependencies), output + '\nreturn callback;')(...Object.values(dependencies))
  }

  for (const reapplyOriginal of [false, true]) {
  const caseName = reapplyOriginal ? 'reapplied definition' : 'distinct definition'
  test(`M07: late Paste acceptance must preserve a newer Search within the same history entry (${caseName})`, async () => {
    const h = await createWorkspace()
    const submission = deferred()
    let operation, renderer, running
    try {
      await h.run(workspace => workspace.applySearch('old-query', { kind: 'image' }))
      await h.run(workspace => workspace.copyItems([workspace.explorerVirtualCollection.itemAt(1)]))
      const original = h.current
      const originalKey = original.explorerViewState.stateKey
      const queued = []
      function OperationHarness() {
        operation = useXDriveFileExplorerOperationController({
          lifecycleKey: 'account-a', currentID: original.current.id,
          nodeByID: original.nodeByID, maxItems: 200,
          planPaste: original.planPaste, completePaste: original.completePaste,
          canPaste: original.canPaste, clearSearch: original.clearSearch,
          submitOperation: () => submission.promise, onQueued: value => queued.push(value),
          onFeedback: () => {}, onError: error => { throw error },
        })
        return null
      }
      await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(OperationHarness)) })
      await TestRenderer.act(async () => { running = operation.pasteClipboard() })
      await h.run(workspace => workspace.applySearch('new-query', { kind: 'video' }))
      if (reapplyOriginal) await h.run(workspace => workspace.applySearch('old-query', { kind: 'image' }))
      const expectedQuery = reapplyOriginal ? 'old-query' : 'new-query'
      const expectedFilters = { kind: reapplyOriginal ? 'image' : 'video' }
      assert.equal(h.current.explorerViewState.stateKey, originalKey, 'the newer Search intentionally shares the same history entry')
      assert.equal(h.current.searchState.query, expectedQuery)
      await TestRenderer.act(async () => { submission.resolve({ id: 'accepted-copy', status: 'queued' }); await running })
      assert.equal(queued.length, 1, 'the durable operation itself remains accepted')
      assert.equal(h.current.searchState.query, expectedQuery, 'old Paste completion must not clear a later submitted Search')
      assert.deepEqual(h.current.searchFilters, expectedFilters)
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount())
      await h.dispose()
    }
  })

  for (const platform of ['Web', 'Desktop']) {
    test(`M07: ${platform} late Rename must preserve a newer Search within the same history entry (${caseName})`, async () => {
      const h = await createWorkspace()
      const submission = deferred()
      try {
        await h.run(workspace => workspace.applySearch('old-query', { kind: 'image' }))
        const original = h.current
        const originalKey = original.explorerViewState.stateKey
        const selected = original.explorerVirtualCollection.itemAt(1)
        const dependencies = {
          ...shared, useCallback: callback => callback,
          nodeByID: original.nodeByID, current: original.current,
          renameLifecycleKeyRef: { current: 'account-a' },
          clearSearch: original.clearSearch,
          // App-owned directory refresh is a separate platform callback. This
          // probe observes Search mutation; refreshing the raw directory does
          // not directly dispatch Workspace navigation or Search actions.
          refreshCurrentDirectory: async id => { assert.equal(id, original.current.id); return true },
          refreshCurrentDirectoryIfCurrent: async id => { assert.equal(id, original.current.id); return true },
          actionBusyRef: { current: null }, actionGenerationRef: { current: 1 },
          setActionBusy: () => {}, fileOperationBusy: false, uploadBusy: false,
          onFeedback: () => {}, onError: error => { throw error },
          api: { rename: () => submission.promise },
          window: { xdriveDesktop: { agent: { cloudRename: () => submission.promise } } },
        }
        if (platform === 'Desktop') {
          dependencies.beginActionBusy = adapterFunction(platform, 'beginActionBusy', dependencies)
          dependencies.isActionBusyCurrent = adapterFunction(platform, 'isActionBusyCurrent', dependencies)
          dependencies.finishActionBusy = adapterFunction(platform, 'finishActionBusy', dependencies)
        }
        const rename = adapterFunction(platform, 'renameItem', dependencies)
        let running
        await TestRenderer.act(async () => { running = rename(selected, 'renamed.jpg') })
        await h.run(workspace => workspace.applySearch('new-query', { kind: 'video' }))
        if (reapplyOriginal) await h.run(workspace => workspace.applySearch('old-query', { kind: 'image' }))
        const expectedQuery = reapplyOriginal ? 'old-query' : 'new-query'
        const expectedFilters = { kind: reapplyOriginal ? 'image' : 'video' }
        assert.equal(h.current.explorerViewState.stateKey, originalKey)
        assert.equal(h.current.searchState.query, expectedQuery)
        await TestRenderer.act(async () => { submission.resolve({ ok: true, data: {} }); await running })
        assert.equal(h.current.searchState.query, expectedQuery, `${platform} old Rename completion must not clear a later submitted Search`)
        assert.deepEqual(h.current.searchFilters, expectedFilters)
      } finally { await h.dispose() }
    })
  }
  }
}

registerMutationSearchIntentCases()

test('M07: re-submitting an identical Search is a newer intent than an older pending clear', async () => {
  const h = await createWorkspace()
  try {
    await h.run(workspace => workspace.applySearch('same-query', { kind: 'image' }))
    const clearOlderSearch = h.current.clearSearch
    await h.run(workspace => workspace.applySearch('same-query', { kind: 'image' }))
    let cleared
    await h.run(() => { cleared = clearOlderSearch() })
    assert.equal(cleared, false, 'an older completion must not erase the explicitly resubmitted Search')
    assert.equal(h.current.searchState.query, 'same-query')
  } finally { await h.dispose() }
})
