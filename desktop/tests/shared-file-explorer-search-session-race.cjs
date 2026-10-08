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
      const value = factory()
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
      return value
    },
  }
}

function loadTypeScript(relativePath, react, modules = {}) {
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
    if (Object.prototype.hasOwnProperty.call(modules, request)) return modules[request]
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

function createVirtualCollectionHook(react) {
  return function useVirtualCollection() {
    const stateRef = react.useRef(null)
    if (!stateRef.current) {
      const loadedItems = new Map()
      stateRef.current = {
        loadedItems,
        totalCount: 0,
        groups: [],
        itemAt: (index) => loadedItems.get(index),
        ensureViewport: async () => {},
        collectRange: async (startIndex, endIndex) => {
          const items = []
          for (let index = startIndex; index <= endIndex; index += 1) {
            const item = loadedItems.get(index)
            if (!item) return null
            items.push(item)
          }
          return items
        },
        reset: () => {
          loadedItems.clear()
          stateRef.current.totalCount = 0
        },
        primePage: (page) => {
          loadedItems.clear()
          for (let index = 0; index < page.items.length; index += 1) {
            loadedItems.set(page.offset + index, page.items[index])
          }
          stateRef.current.totalCount = page.totalCount
          stateRef.current.groups = page.groups || []
        },
      }
    }
    return stateRef.current
  }
}

function loadSearchHook(react) {
  return loadTypeScript(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts'],
    react,
    {
      '../file-explorer-controller': {
        XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE: 100,
        xDriveFileExplorerSearchDecision: (raw) => {
          const query = String(raw).trim()
          if (!query) return { kind: 'clear' }
          if (query.length < 2) return { kind: 'invalid', message: 'too short' }
          return { kind: 'search', query }
        },
      },
      '../file-explorer-search': {
        xDriveFileExplorerSearchFiltersActive: (filters) => Object.keys(filters || {}).length > 0,
        xDriveFileExplorerSearchFiltersSignature: (filters) => JSON.stringify(filters || {}),
      },
      '../file-explorer-grouping': {
        xDriveFileExplorerGroupingSignature: (grouping) =>
          String(grouping?.groupBy || 'none') + ':' + String(Boolean(grouping?.foldersFirst)),
      },
      './VirtualCollectionController': {
        useXDriveVirtualCollection: createVirtualCollectionHook(react),
      },
    },
  ).useXDriveFileExplorerSearch
}

function loadWorkspaceHook(react) {
  const useSearch = loadSearchHook(react)
  const navigation = {
    sort: { key: 'name', direction: 'asc' },
    grouping: { groupBy: 'none', foldersFirst: true },
    viewMode: 'details',
    activeTabID: 'tab-1',
    tabs: [{ id: 'tab-1', label: '我的文件' }],
    beginNavigationIntent: () => 1,
    isNavigationIntentCurrent: () => true,
    navigateTo: async () => {},
    openTab: async () => true,
  }

  return loadTypeScript(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts'],
    react,
    {
      '../file-explorer-search': {
        xDriveFileExplorerSearchFilterCount: () => 0,
        xDriveFileExplorerSearchFiltersSignature: (filters) => JSON.stringify(filters || {}),
      },
      '../file-explorer-grouping': {
        xDriveFileExplorerGroupingSignature: (grouping) =>
          String(grouping?.groupBy || 'none') + ':' + String(Boolean(grouping?.foldersFirst)),
      },
      '../file-explorer-controller': {
        xDriveFileExplorerDirectoryCrumbs: () => [],
        xDriveFileExplorerDispatchOpenItem: async () => {},
        xDriveFileExplorerSubmitPath: async () => {},
      },
      './FileExplorerClipboard': {
        useXDriveFileExplorerClipboard: () => ({
          copyItems: () => {},
          cutItems: () => {},
          planPaste: () => null,
          completePaste: () => {},
          clearClipboard: () => {},
          canPaste: () => false,
        }),
      },
      './FileExplorerNavigation': {
        useXDriveFileExplorerNavigation: () => navigation,
      },
      './FileExplorerProjection': {
        xDriveProjectFileExplorerNode: (node, pathPrefix = '', explicitPath) => ({
          id: node.id,
          name: node.name,
          kind: node.type === 'dir' ? 'dir' : 'file',
          revision: node.revision,
          path: explicitPath || (pathPrefix ? pathPrefix + node.name : node.name),
        }),
        useXDriveFileExplorerProjection: ({ items, searchResults, virtualSearchItems }) => {
          const nodeByID = new Map(items.map((node) => [node.id, node]))
          const searchByID = new Map()
          for (const result of searchResults || []) {
            nodeByID.set(result.node.id, result.node)
            searchByID.set(result.node.id, result)
          }
          const virtualExplorerItems = new Map()
          for (const [index, result] of virtualSearchItems || []) {
            nodeByID.set(result.node.id, result.node)
            searchByID.set(result.node.id, result)
            virtualExplorerItems.set(index, {
              id: result.node.id,
              name: result.node.name,
              kind: result.node.type === 'dir' ? 'dir' : 'file',
              revision: result.node.revision,
              path: result.path,
            })
          }
          return {
            nodeByID,
            searchByID,
            explorerItems: items.map((node) => ({
              id: node.id,
              name: node.name,
              kind: node.type === 'dir' ? 'dir' : 'file',
              revision: node.revision,
            })),
            explorerCrumbs: [],
            virtualExplorerItems,
          }
        },
      },
      './FileExplorerSearch': {
        useXDriveFileExplorerSearch: useSearch,
      },
    },
  ).useXDriveFileExplorerWorkspace
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('FileExplorer Search state cannot cross account lifecycle when tab id is reused', async () => {
  const runtime = createHookRuntime()
  const useWorkspace = loadWorkspaceHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  const loadSearchRange = async (query, _filters, _grouping, _sort, offset, limit) => ({
    items: [{
      node: {
        id: 7,
        revision: lifecycleKey.includes('user-a') ? 1 : 9,
        parent_id: 1,
        type: 'file',
        name: lifecycleKey.includes('user-a') ? 'A-secret.txt' : 'B-current.txt',
      },
      path: lifecycleKey.includes('user-a') ? '/A-secret.txt' : '/B-current.txt',
    }],
    totalCount: 1,
    offset,
    limit,
    groups: [],
  })

  const render = () => runtime.render(() => useWorkspace({
    items: [],
    crumbs: [{ id: 1, name: '我的文件' }],
    directoryVirtualCollection: null,
    viewModeStorageKey: 'view',
    navigationSessionStorageKey: lifecycleKey,
    onLoadDirectory: async () => true,
    loadSearchRange,
    loadRoot: async () => ({ id: 1 }),
    findChildDirectory: async () => null,
    onError: (error) => { throw error },
  }))

  let workspace = render()
  await workspace.applySearch('secret', {})
  await flushAsync()
  workspace = render()

  assert.equal(workspace.searchState.query, 'secret')

  lifecycleKey = 'server-b:user-b'
  workspace = render()
  await flushAsync()
  workspace = render()

  assert.equal(
    workspace.searchState.query,
    '',
    'account B must not inherit account-A Search query when navigation resets to the same tab-1 id',
  )
  assert.equal(
    workspace.searchResults,
    null,
    'account B must start with an idle Search surface instead of account-A results',
  )
})
