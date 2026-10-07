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

test('FileExplorer main directory removes legacy cursor-append state after range activation', () => {
  assert.ok(controller.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200'), 'shared range page size must remain')
  assert.ok(controller.includes('XDriveFileExplorerPageRequestOptions'), 'cursor page options must remain for auxiliary tree/path reads')
  for (const legacy of [
    'XDriveFileExplorerPageState',
    'xDriveFileExplorerCanLoadMore',
    'xDriveFileExplorerMergePageItems',
    'XDriveFileExplorerPageResult',
    'xDriveFileExplorerPageStateFromResult',
    'XDriveFileExplorerDirectoryPage',
    'xDriveFileExplorerDirectoryPageTransition',
    'xDriveFileExplorerPaginationController',
    "mode: 'directory' as const",
  ]) {
    assert.equal(controller.includes(legacy), false, `dead main-directory pagination state remains: ${legacy}`)
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
  assert.equal(cloudController.includes('pageState'), false, 'range-driven directory browsing must not fabricate cursor page state')
  assert.equal(cloudController.includes('loadingMore'), false, 'range-driven directory browsing must not expose loading-more state')
  assert.equal(cloudController.includes('loadMoreDirectory'), false, 'range-driven directory browsing must not expose a no-op load-more callback')
  assert.equal(cloudController.includes('directoryItemIDsRef'), false, 'directory browsing must not retain a whole-directory ID cache')

  assert.ok(web.includes('getRange: (parentID, offset, limit, sort, includeCount, grouping) => api.listRange('), 'Web must keep REST range transport local behind the shared port')
  assert.ok(desktop.includes('cloudChildrenRange('), 'Desktop must keep Agent range transport local behind the shared port')
  assert.equal(web.includes('loadMoreDirectory'), false, 'Web App must not retain directory load-more compatibility')
  assert.equal(desktop.includes('loadMoreCloudDirectory'), false, 'Desktop App must not retain directory load-more compatibility')
})

test('folder tree keeps cursor paging only as an internal bounded transport', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE = 200',
    'xDriveFileExplorerLoadChildDirectoryPage',
    'nextCursor',
    'hasMore',
  ]) {
    assert.ok(controller.includes(token), `tree cursor contract missing: ${token}`)
  }
})
