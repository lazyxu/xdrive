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
  const react = {
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
  }
  return {
    react,
    render(factory) {
      cursor = 0
      return factory()
    },
  }
}

function projectNode(node, pathPrefix = '', explicitPath) {
  return {
    id: node.id,
    name: node.name,
    kind: node.type === 'dir' ? 'dir' : 'file',
    revision: node.revision,
    path: explicitPath || (pathPrefix ? pathPrefix + node.name : node.name),
  }
}

function loadWorkspaceHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerWorkspaceController.ts',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const navigation = {
    sort: { key: 'name', direction: 'asc' },
    grouping: { groupBy: 'none', foldersFirst: true },
    viewMode: 'details',
    activeTabID: 'tab-1',
    activeHistoryEntryKey: 'entry-1',
    retainedHistoryEntries: [{ tabID: 'tab-1', key: 'entry-1' }],
    tabs: [{ id: 'tab-1', label: '我的文件' }],
    beginNavigationIntent: () => 1,
    isNavigationIntentCurrent: () => true,
    navigateTo: async () => {},
    openTab: async () => true,
  }

  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../file-explorer-search') {
      return {
        xDriveFileExplorerSearchFilterCount: () => 0,
        xDriveFileExplorerSearchFiltersSignature: () => '',
      }
    }
    if (request === '../file-explorer-grouping') {
      return { xDriveFileExplorerGroupingSignature: () => 'none:1' }
    }
    if (request === '../file-explorer-controller') {
      return {
        xDriveFileExplorerDirectoryCrumbs: () => [],
        xDriveFileExplorerDispatchOpenItem: async () => {},
        xDriveFileExplorerSubmitPath: async () => {},
      }
    }
    if (request === './FileExplorerClipboard') {
      return {
        useXDriveFileExplorerClipboard: () => ({
          copyItems: () => {},
          cutItems: () => {},
          planPaste: () => null,
          completePaste: () => {},
          clearClipboard: () => {},
          canPaste: () => false,
        }),
      }
    }
    if (request === './FileExplorerNavigation') {
      return { useXDriveFileExplorerNavigation: () => navigation }
    }
    if (request === './FileExplorerSearch') {
      return {
        useXDriveFileExplorerSearch: () => ({
          searchValue: '',
          searchFilters: {},
          searchState: { query: '', filters: {}, groups: [], results: null, loading: false },
          searchResults: null,
          searchVirtualItems: new Map(),
          searchVirtualCollection: null,
          searchLoading: false,
          clearSearch: () => {},
          changeSearchValue: () => {},
          changeSearchFilters: () => {},
          submitSearch: async () => {},
          applySearch: async () => {},
          searchSortMatches: true,
        }),
      }
    }
    if (request === './FileExplorerProjection') {
      return {
        xDriveProjectFileExplorerNode: projectNode,
        useXDriveFileExplorerProjection: ({ items, virtualItems }) => {
          const nodeByID = new Map(items.map((node) => [node.id, node]))
          const virtualExplorerItems = new Map()
          for (const [index, node] of virtualItems || []) {
            nodeByID.set(node.id, node)
            virtualExplorerItems.set(index, projectNode(node))
          }
          return {
            nodeByID,
            searchByID: new Map(),
            explorerItems: items.map((node) => projectNode(node)),
            explorerCrumbs: [],
            virtualExplorerItems,
          }
        },
      }
    }
    throw new Error('unexpected module: ' + request)
  }

  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    localRequire,
  )
  return mod.exports.useXDriveFileExplorerWorkspace
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

test('stale virtual collectRange cannot repopulate the next FileExplorer interaction cache', async () => {
  const runtime = createHookRuntime()
  const useWorkspace = loadWorkspaceHook(runtime.react)
  const pendingA = deferred()

  const nodeA = { id: 7, revision: 1, parent_id: 1, type: 'file', name: 'A-secret.txt' }
  const nodeB = { id: 7, revision: 9, parent_id: 1, type: 'file', name: 'B-current.txt' }

  let lifecycleKey = 'server-a:user-a'
  let items = []
  let crumbs = [{ id: 1, name: '我的文件' }]
  let directoryVirtualCollection = {
    itemCount: 1,
    loadedItems: new Map(),
    itemAt: () => undefined,
    ensureViewport: async () => {},
    collectRange: async () => pendingA.promise,
    groups: [],
  }

  const render = () => runtime.render(() => useWorkspace({
    items,
    crumbs,
    directoryVirtualCollection,
    viewModeStorageKey: 'view',
    navigationSessionStorageKey: lifecycleKey,
    onLoadDirectory: async () => true,
    loadSearchRange: async () => ({ items: [], totalCount: 0, offset: 0, limit: 100 }),
    loadRoot: async () => ({ id: 1 }),
    findChildDirectory: async () => null,
    onError: (error) => { throw error },
  }))

  let workspace = render()
  const oldCollect = workspace.explorerVirtualCollection.collectRange(0, 0)
  await Promise.resolve()

  lifecycleKey = 'server-b:user-b'
  items = [nodeB]
  directoryVirtualCollection = {
    itemCount: 1,
    loadedItems: new Map([[0, nodeB]]),
    itemAt: () => nodeB,
    ensureViewport: async () => {},
    collectRange: async () => [nodeB],
    groups: [],
  }

  workspace = render()
  assert.equal(workspace.nodeByID.get(7)?.name, 'B-current.txt')

  pendingA.resolve([nodeA])
  await oldCollect

  workspace = render()
  assert.equal(
    workspace.nodeByID.get(7)?.name,
    'B-current.txt',
    'a collectRange completion captured under account A must not repopulate the shared interaction cache after account B becomes current',
  )
})
