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
    'XDriveFileExplorerDirectoryPage',
    'xDriveFileExplorerDirectoryPageTransition',
    'pageState: xDriveFileExplorerPageStateFromResult(parentID, page, sort)',
    'applyItems: (currentItems: readonly TItem[])',
    'new Map(currentItems.map((item) => [item.id, item] as const))',
    'for (const item of pageItems) merged.set(item.id, item)',
    'return [...merged.values()]',
  ]) {
    assert.ok(controller.includes(token), `shared FileExplorer pagination controller missing: ${token}`)
  }
})

test('Web and Desktop delegate pagination rules while keeping transport adapters local', () => {
  assert.ok(web.includes('useXDriveCloudFilesController<Node, QuotaUsage, XDriveFileExplorerSort>'), 'Web must delegate cloud page state to the shared Cloud Files controller')
  assert.ok(desktop.includes('useXDriveCloudFilesController<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>'), 'Desktop must delegate cloud page state to the shared Cloud Files controller')

  assert.equal((web.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 0, 'Web App must not duplicate directory request-option construction')
  assert.equal((desktop.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 0, 'Desktop App must not duplicate directory request-option construction')
  assert.equal((cloudController.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 3, 'shared Cloud Files controller must own directory, load-more and initial request options')

  assert.equal(web.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE'), false, 'Web must not own directory page-size composition')
  assert.equal(desktop.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE'), false, 'Desktop must not own a local page-size constant')
  assert.equal(web.includes('const FILE_PAGE_SIZE = 200'), false, 'Web must not own a local page-size constant')
  assert.equal(desktop.includes('const DESKTOP_FILE_PAGE_SIZE = 200'), false, 'Desktop must not own a local page-size constant')

  assert.equal((web.match(/xDriveFileExplorerDirectoryPageTransition\(/g) || []).length, 0, 'Web App must not own directory transitions')
  assert.equal((desktop.match(/xDriveFileExplorerDirectoryPageTransition\(/g) || []).length, 0, 'Desktop App must not own directory transitions')
  assert.equal((cloudController.match(/xDriveFileExplorerDirectoryPageTransition\(/g) || []).length, 3, 'shared Cloud Files controller must own directory, load-more and initial transitions')

  assert.ok(cloudController.includes('xDriveFileExplorerCanLoadMore(currentPage, id, sort, loadingMore)'), 'shared Cloud Files controller must own pagination eligibility')
  assert.equal(desktop.includes('xDriveFileExplorerCanLoadMore('), false, 'Desktop App must not own pagination eligibility')
  assert.equal(web.includes('xDriveFileExplorerPageStateFromResult('), false, 'Web must not duplicate page-state derivation')
  assert.equal(desktop.includes('xDriveFileExplorerPageStateFromResult('), false, 'Desktop must not duplicate page-state derivation')
  assert.equal(web.includes('xDriveFileExplorerMergePageItems(currentItems, page.items)'), false, 'Web must not duplicate incremental page merging')
  assert.equal(desktop.includes('xDriveFileExplorerMergePageItems(currentItems, result.data.items)'), false, 'Desktop must not duplicate incremental page merging')

  assert.ok(web.includes('getPage: (parentID, options) => api.listPage(parentID, options)'), 'Web must keep REST transport execution local behind the shared port')
  assert.ok(desktop.includes('cloudChildrenPage(parentID, options)'), 'Desktop must keep Agent pagination execution local behind the shared port')
  assert.equal(web.includes('setLoadingMore(true)'), false, 'Web App loading-more state must stay in the shared controller')
  assert.equal(desktop.includes('setCloudLoadingMore(true)'), false, 'Desktop App loading-more state must stay in the shared controller')
  assert.ok(cloudController.includes('setLoadingMore(true)'), 'shared Cloud Files controller must own loading-more state for both clients')
})
