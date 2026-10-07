const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const contract = read('ui', 'shared', 'src', 'cloud-files.ts')
const controller = read('ui', 'shared', 'src', 'mui', 'CloudFilesController.ts')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const webApi = read('web', 'src', 'api.ts')
const webApp = read('web', 'src', 'App.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const desktopTypes = read('desktop', 'src', 'renderer', 'global.d.ts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const desktopPreload = read('desktop', 'src', 'preload', 'index.cts')

test('shared cloud files port owns the transport-neutral read contract', () => {
  for (const token of [
    'XDriveCloudFilesPageOptions',
    'XDriveCloudFilesPage<TNode',
    'XDriveCloudFilesCrumb',
    'XDriveCloudFilesSearchResult<TNode',
    'XDriveCloudFilesSearchPage<TNode',
    'XDriveCloudFilesPort<',
    'getRoot: () => Promise<TNode>',
    'getPage: (',
    'XDriveFileExplorerPageRequestOptions<TSort>',
    'getQuota: () => Promise<TQuota>',
  ]) {
    assert.ok(contract.includes(token), `shared cloud files contract missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './cloud-files'"), 'framework-neutral cloud files contract must be exported')
})

test('shared cloud files controller owns sparse range loading, quota and initial loading', () => {
  for (const token of [
    'useXDriveCloudFilesController',
    'useXDriveVirtualCollection<TNode>',
    'const [quota, setQuota]',
    'const [items, setItems]',
    'const [crumbs, setCrumbs]',
    'port.getRoot()',
    'port.getRange(',
    'XDRIVE_FILE_EXPLORER_PAGE_SIZE',
    'virtualCollection.primePage({',
    'virtualDirectory',
    'loadedItems: virtualCollection.loadedItems',
    'ensureViewport: virtualCollection.ensureViewport',
    'quotaRefreshIntervalMs = 60_000',
    'applyQuota',
    'refreshQuota',
    'loadDirectory',
    'if (!enabled) {',
    "virtualCollection.reset('cloud-files:virtual:disabled')",
    'setQuota(null)',
    'setItems([])',
    'setCrumbs([])',
  ]) {
    assert.ok(controller.includes(token), `shared cloud files controller missing: ${token}`)
  }
  assert.ok(controller.includes('sort: virtualTarget?.sort ?? defaultSort'), 'controller must expose the active range sort without cursor page state')
  assert.equal(controller.includes('pageState'), false, 'directory browsing must not retain cursor page state')
  assert.equal(controller.includes('loadingMore'), false, 'directory browsing must not retain loading-more state')
  assert.equal(controller.includes('loadMoreDirectory'), false, 'directory browsing must not retain a no-op load-more callback')
  assert.ok(sharedMuiIndex.includes("export * from './CloudFilesController'"), 'shared cloud files controller must be exported')
})

test('Web API consumes the shared cloud files page contract', () => {
  assert.ok(webApi.includes('XDriveCloudFilesPage,'))
  assert.ok(webApi.includes('XDriveCloudFilesPageOptions,'))
  assert.ok(contract.includes('name?: string'), 'shared Cloud Files page options must expose exact-name lookup')
  assert.ok(webApi.includes('listPage(parentID: number, options: XDriveCloudFilesPageOptions = {})'))
  assert.ok(webApi.includes("if (options.nameInsensitive) query.set('name_ci', options.nameInsensitive)"), 'Web paged children transport must forward case-insensitive name lookups')
  assert.ok(webApi.includes('this.request<XDriveCloudFilesPage<Node>>'))
  assert.equal(webApi.includes('export interface ChildrenPage'), false, 'Web must not redefine cloud page results')
  assert.equal(webApi.includes('export interface ChildrenOptions'), false, 'Web must not redefine cloud page options')
})

test('Web delegates cloud read state and lifecycle to the shared controller', () => {
  for (const token of [
    'useXDriveCloudFilesController<Node, QuotaUsage, XDriveFileExplorerSort>',
    'XDriveCloudFilesPort<Node, QuotaUsage, XDriveFileExplorerSort>',
    'getRoot: () => api.root()',
    'getPage: (parentID, options) => api.listPage(parentID, options)',
    'getQuota: () => api.quota()',
    'sort: directorySort',
    'enabled: Boolean(profile && !profile.must_change_password)',
    'applyQuota',
  ]) {
    assert.ok(webApp.includes(token), `Web cloud controller wiring missing: ${token}`)
  }

  for (const token of [
    'useState<QuotaUsage | null>',
    'useState<Node[]>([])',
    'useState<XDriveFileExplorerPageState',
    'xDriveFileExplorerCanLoadMore',
    'xDriveFileExplorerDirectoryPageTransition',
    'xDriveFileExplorerPageRequestOptions',
    'const current = crumbs.at(-1)',
  ]) {
    assert.equal(webApp.includes(token), false, `Web must not own shared cloud controller logic: ${token}`)
  }
})


test('Desktop delegates cloud read state and lifecycle to the shared controller', () => {
  for (const token of [
    'useXDriveCloudFilesController<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>',
    'XDriveCloudFilesPort<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>',
    'getRoot: async () =>',
    'cloudChildrenPage(parentID, options)',
    'getQuota: async () =>',
    'quota: cloudQuota',
    'items: cloudItems',
    'crumbs: cloudCrumbs',
    'sort: cloudSort',
    'loading: cloudLoading',
    'applyQuota: applyCloudQuota',
    'refreshQuota: refreshCloudQuota',
    'loadDirectory: loadCloudDirectory',
    'enabled: agent.connected && configured',
    'onError: handleCloudFilesError',
  ]) {
    assert.ok(desktopApp.includes(token), `Desktop cloud controller wiring missing: ${token}`)
  }

  for (const token of [
    'useState<AgentCloudNode[]>([])',
    'const [cloudCrumbs, setCloudCrumbs] = useState<AgentCloudCrumb[]>([])',
    'useState<XDriveFileExplorerPageState',
    'const loadCloudHome = async',
    'const refreshCloudQuota = async',
    'const loadCloudDirectory = async',
    'const loadMoreCloudDirectory = async',
    'xDriveFileExplorerCanLoadMore',
    'xDriveFileExplorerDirectoryPageTransition',
    'xDriveFileExplorerPageRequestOptions',
  ]) {
    assert.equal(desktopApp.includes(token), false, `Desktop must not own shared cloud controller logic: ${token}`)
  }
})

test('Desktop renderer aliases cloud page and search contracts to shared types', () => {
  for (const token of [
    'type AgentCloudChildrenPage = XDriveCloudFilesPage<AgentCloudNode>',
    'type AgentCloudCrumb = XDriveCloudFilesCrumb',
    'type AgentCloudSearchResult = XDriveCloudFilesSearchResult<AgentCloudNode>',
    'type AgentCloudSearchPage = XDriveCloudFilesSearchPage<AgentCloudNode>',
    'options?: XDriveCloudFilesPageOptions',
  ]) {
    assert.ok(desktopTypes.includes(token), `Desktop shared cloud type alias missing: ${token}`)
  }
})


test('Desktop page lookup filters survive the Electron IPC bridge', () => {
  assert.ok(desktopPreload.includes('name?: string; nameInsensitive?: string'), 'preload page options must retain name filters')
  assert.ok(desktopMain.includes("const name = typeof input.name === 'string' ? input.name : ''"), 'Electron main must read exact-name filters')
  assert.ok(desktopMain.includes("const nameInsensitive = typeof input.nameInsensitive === 'string' ? input.nameInsensitive : ''"), 'Electron main must read folded-name filters')
  assert.ok(desktopMain.includes('...(name ? { name } : {})'), 'Electron main must forward exact-name filters')
  assert.ok(desktopMain.includes('...(nameInsensitive ? { nameInsensitive } : {})'), 'Electron main must forward folded-name filters')
})

test('Cloud Files exposes dedicated range transport for VirtualCollection', () => {
  for (const token of [
    'export type XDriveCloudFilesRange',
    'total_count: number',
    'total_count_included?: boolean',
    'offset: number',
    'limit: number',
    'includeCount: boolean',
    'XDriveFileExplorerGrouping',
    'groups?: XDriveFileExplorerGroupIndex[]',
    'getRange: (',
  ]) {
    assert.ok(contract.includes(token), `shared Cloud Files range contract missing: ${token}`)
  }
  assert.ok(webApi.includes('listRange('), 'Web API must expose children range transport')
  assert.ok(webApp.includes('getRange: (parentID, offset, limit, sort, includeCount, grouping) => api.listRange('), 'Web shared port must wire count reuse and grouping')
  assert.ok(desktopApp.includes('getRange: async (parentID, offset, limit, sort, includeCount, grouping) =>'), 'Desktop shared port must wire count reuse and grouping')
  assert.ok(desktopApp.includes('cloudChildrenRange('), 'Desktop renderer must use the dedicated Agent range action')
  assert.ok(webApi.includes("query.set('include_count', 'false')"), 'Web transport must serialize count-free ranges')
  assert.ok(desktopPreload.includes('includeCount = true'), 'Desktop preload must default legacy callers to counted ranges')
  assert.ok(desktopMain.includes('normalizedIncludeCount'), 'Desktop main IPC must validate and forward includeCount')
  assert.ok(desktopMain.includes('normalizeFileExplorerGrouping'), 'Desktop main IPC must validate grouping')
  assert.ok(controller.includes('xDriveFileExplorerGroupingSignature'), 'directory sparse generation must include grouping identity')
  assert.ok(controller.includes('groups: virtualTarget.groups'), 'directory VirtualCollection must expose authoritative group indexes')
  assert.ok(desktopTypes.includes('type AgentCloudChildrenRange = XDriveCloudFilesRange<AgentCloudNode>'), 'Desktop renderer must alias the shared range contract')
})


test('Web and Desktop pass sparse virtual directory state into FileExplorer', () => {
  for (const token of [
    'virtualDirectory,',
    'virtualDirectory={virtualDirectory}',
  ]) {
    assert.ok(webApp.includes(token), `Web sparse directory wiring missing: ${token}`)
  }
  for (const token of [
    'virtualDirectory: cloudVirtualDirectory',
    'virtualDirectory: cloudVirtualDirectory,',
  ]) {
    assert.ok(desktopApp.includes(token), `Desktop sparse directory wiring missing: ${token}`)
  }
})


test('Search range transport is explicit across Web and Desktop adapters', () => {
  assert.ok(contract.includes('XDriveCloudFilesSearchRange<TNode'), 'shared Search range DTO is missing')
  assert.ok(webApi.includes('searchRange('), 'Web API must expose Search range transport')
  assert.ok(webApi.includes('Promise<XDriveCloudFilesSearchRange<Node>>'), 'Web Search range must expose the shared DTO')
  assert.ok(webApi.includes('crumbs: item.breadcrumbs'), 'Web Search range must normalize server breadcrumbs into shared crumbs')
  assert.ok(desktopTypes.includes('type AgentCloudSearchRange = XDriveCloudFilesSearchRange<AgentCloudNode>'), 'Desktop renderer must alias the shared Search range DTO')
  assert.ok(desktopTypes.includes('cloudSearchRange: ('), 'Desktop renderer bridge must expose Search range')
  assert.ok(desktopPreload.includes("'agent:cloud-search-range'"), 'preload must expose dedicated Search range IPC')
  assert.ok(desktopMain.includes("ipcMain.handle('agent:cloud-search-range'"), 'Electron main must validate dedicated Search range IPC')
})
