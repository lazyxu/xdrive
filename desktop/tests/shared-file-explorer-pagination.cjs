const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')

test('shared FileExplorer controller owns pagination eligibility and page merging', () => {
  for (const token of [
    'XDriveFileExplorerPageState',
    'xDriveFileExplorerCanLoadMore',
    'pageState.parentID === parentID',
    'pageState.hasMore',
    'pageState.cursor',
    'pageState.sort.key === sort.key',
    'pageState.sort.direction === sort.direction',
    '!loadingMore',
    'xDriveFileExplorerMergePageItems',
    'new Map(currentItems.map((item) => [item.id, item] as const))',
    'for (const item of pageItems) merged.set(item.id, item)',
    'return [...merged.values()]',
  ]) {
    assert.ok(controller.includes(token), `shared FileExplorer pagination controller missing: ${token}`)
  }
})

test('Web and Desktop delegate pagination rules while keeping transport/loading local', () => {
  assert.ok(web.includes('useState<XDriveFileExplorerPageState<XDriveFileExplorerSort> | null>'), 'Web must use the shared page-state contract')
  assert.ok(desktop.includes('useState<XDriveFileExplorerPageState<XDriveFileExplorerSort> | null>'), 'Desktop must use the shared page-state contract')

  assert.ok(web.includes('xDriveFileExplorerCanLoadMore(pageState, id, sort, loadingMore)'), 'Web must use shared pagination eligibility')
  assert.ok(desktop.includes('xDriveFileExplorerCanLoadMore(pageState, id, sort, cloudLoadingMore)'), 'Desktop must use shared pagination eligibility')
  assert.ok(web.includes('xDriveFileExplorerMergePageItems(currentItems, page.items)'), 'Web must use shared page merge')
  assert.ok(desktop.includes('xDriveFileExplorerMergePageItems(currentItems, result.data.items)'), 'Desktop must use shared page merge')

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal(source.includes('const merged = new Map(currentItems.map((item) => [item.id, item]))'), false, `${label} must not duplicate page merging`)
  }

  assert.ok(web.includes('api.listPage(id, {'), 'Web must keep REST pagination execution local')
  assert.ok(web.includes('setLoadingMore(true)'), 'Web must keep loading state local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudChildrenPage(id, {'), 'Desktop must keep Agent pagination execution local')
  assert.ok(desktop.includes("setCloudLoadingMore(true)"), 'Desktop must keep loading state local')
})
