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

test('shared cloud files controller owns directory paging, quota and initial loading', () => {
  for (const token of [
    'useXDriveCloudFilesController',
    'const [quota, setQuota]',
    'const [items, setItems]',
    'const [crumbs, setCrumbs]',
    'const [pageState, setPageState]',
    'xDriveFileExplorerCanLoadMore(',
    'xDriveFileExplorerDirectoryPageTransition(',
    'xDriveFileExplorerPageRequestOptions(',
    'port.getRoot()',
    'port.getPage(',
    'port.getQuota()',
    'quotaRefreshIntervalMs = 60_000',
    'reset',
    'applyQuota',
    'refreshQuota',
    'loadDirectory',
    'loadMoreDirectory',
  ]) {
    assert.ok(controller.includes(token), `shared cloud files controller missing: ${token}`)
  }
  assert.ok(sharedMuiIndex.includes("export * from './CloudFilesController'"), 'shared cloud files controller must be exported')
})

test('Web API consumes the shared cloud files page contract', () => {
  assert.ok(webApi.includes('XDriveCloudFilesPage,'))
  assert.ok(webApi.includes('XDriveCloudFilesPageOptions,'))
  assert.ok(webApi.includes('listPage(parentID: number, options: XDriveCloudFilesPageOptions = {})'))
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
    'pageState: directoryPage',
    'enabled: Boolean(profile && !profile.must_change_password)',
    'applyQuota(quotaValue)',
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
    'window.xdriveDesktop.agent.cloudRoot()',
    'window.xdriveDesktop.agent.cloudChildrenPage(parentID, options)',
    'window.xdriveDesktop.agent.cloudQuota()',
    'quota: cloudQuota',
    'items: cloudItems',
    'crumbs: cloudCrumbs',
    'pageState: cloudPage',
    'loading: cloudLoading',
    'loadingMore: cloudLoadingMore',
    'applyQuota: applyCloudQuota',
    'refreshQuota: refreshCloudQuota',
    'loadDirectory: loadCloudDirectory',
    'loadMoreDirectory: loadMoreCloudDirectory',
    'onError: handleCloudFilesError',
  ]) {
    assert.ok(desktopApp.includes(token), `Desktop cloud controller wiring missing: ${token}`)
  }

  for (const token of [
    'useState<AgentCloudNode[]>([])',
    'useState<AgentCloudCrumb[]>([])',
    'useState<XDriveFileExplorerPageState',
    'const refreshCloudQuota = async () => {',
    'const loadCloudDirectory = async (',
    'const loadMoreCloudDirectory = async (',
    'const loadCloudHome = async () => {',
    'xDriveFileExplorerCanLoadMore',
    'xDriveFileExplorerDirectoryPageTransition',
    'xDriveFileExplorerPageRequestOptions',
    'setCloudItems(',
    'setCloudCrumbs(',
    'setCloudPage(',
    'setCloudLoadingMore(',
    'setCloudQuota(',
  ]) {
    assert.equal(desktopApp.includes(token), false, `Desktop must not own shared cloud controller logic: ${token}`)
  }
})

test('Desktop renderer aliases shared cloud page and search contracts', () => {
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
