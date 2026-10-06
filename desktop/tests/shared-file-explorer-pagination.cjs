const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const cloudController = read('ui', 'shared', 'src', 'mui', 'CloudFilesController.ts')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')

test('shared FileExplorer controller owns pagination eligibility and page merging', () => {
  for (const token of [
    'XDriveFileExplorerPageState',
    'XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200',
    'XDriveFileExplorerPageRequestOptions',
    'xDriveFileExplorerPageRequestOptions',
    'limit: XDRIVE_FILE_EXPLORER_PAGE_SIZE',
    '...(cursor ? { cursor } : {})',
    'sort: sort.key',
    'order: sort.direction',
    'XDriveFileExplorerPageResult',
    'xDriveFileExplorerPageStateFromResult',
    "cursor: page.next_cursor ?? ''",
    'hasMore: page.has_more',
    'xDriveFileExplorerCanLoadMore',
    'pageState.parentID === parentID',
    'pageState.hasMore',
    'pageState.cursor',
    'pageState.sort.key === sort.key',
    'pageState.sort.direction === sort.direction',
    '!loadingMore',
    'xDriveFileExplorerMergePageItems',
    'knownIDs?: Set<number>',
    'const pageIDs = new Set<number>()',
    'if (knownIDs.has(item.id) || pageIDs.has(item.id))',
    'return [...currentItems, ...pageItems]',
    'XDriveFileExplorerDirectoryPage',
    'xDriveFileExplorerDirectoryPageTransition',
    'pageState: xDriveFileExplorerPageStateFromResult(parentID, page, sort)',
    'applyItems: (currentItems: readonly TItem[])',
    'knownIDs.clear()',
    'for (const item of page.items) knownIDs.add(item.id)',
    'new Map(currentItems.map((item) => [item.id, item] as const))',
    'for (const item of pageItems) merged.set(item.id, item)',
    'return [...merged.values()]',
  ]) {
    assert.ok(controller.includes(token), `shared FileExplorer pagination controller missing: ${token}`)
  }
})

test('Web and Desktop delegate directory range rules while keeping transport adapters local', () => {
  assert.ok(web.includes('useXDriveCloudFilesController<Node, QuotaUsage, XDriveFileExplorerSort>'), 'Web must delegate cloud directory state to the shared Cloud Files controller')
  assert.ok(desktop.includes('useXDriveCloudFilesController<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>'), 'Desktop must delegate cloud directory state to the shared Cloud Files controller')

  assert.equal((web.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 0, 'Web App must not compose directory requests')
  assert.equal((desktop.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 0, 'Desktop App must not compose directory requests')
  assert.equal((cloudController.match(/port\.getRange\(/g) || []).length, 3, 'shared Cloud Files controller must own initial, navigation, and viewport range reads')

  assert.equal(web.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE'), false, 'Web must not own directory range size composition')
  assert.equal(desktop.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE'), false, 'Desktop must not own directory range size composition')
  assert.ok(cloudController.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE'), 'shared Cloud Files controller must own the directory range size')
  assert.ok(cloudController.includes('useXDriveVirtualCollection<TNode>'), 'shared Cloud Files controller must own sparse range orchestration')
  assert.ok(cloudController.includes('virtualCollection.primePage({'), 'first range must seed the sparse cache')
  assert.ok(cloudController.includes('loadedItems: virtualCollection.loadedItems'), 'shared controller must expose bounded loaded metadata')
  assert.ok(cloudController.includes('ensureViewport: virtualCollection.ensureViewport'), 'shared controller must expose viewport range loading')
  assert.equal(cloudController.includes('xDriveFileExplorerCanLoadMore('), false, 'directory browsing must not retain cursor load-more eligibility')
  assert.equal(cloudController.includes('directoryItemIDsRef'), false, 'directory browsing must not retain a whole-directory ID cache')

  assert.ok(web.includes('getRange: (parentID, offset, limit, sort) => api.listRange('), 'Web must keep REST range transport local behind the shared port')
  assert.ok(desktop.includes('cloudChildrenRange('), 'Desktop must keep Agent range transport local behind the shared port')
  assert.equal(web.includes('setLoadingMore(true)'), false, 'Web App must not own directory loading-more state')
  assert.equal(desktop.includes('setCloudLoadingMore(true)'), false, 'Desktop App must not own directory loading-more state')
})
