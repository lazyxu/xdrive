const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const pane = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer tree loader returns one bounded folder page', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE = 200',
    'xDriveFileExplorerLoadChildDirectoryPage',
    "sort: 'name'",
    "order: 'asc'",
    "if (item.type !== 'dir')",
    'reachedFile = true',
    'page.next_cursor?.trim()',
    "throw new Error('文件夹树分页缺少下一页游标。')",
    "throw new Error('文件夹树分页游标重复。')",
    'const hasMore = !reachedFile && page.has_more && Boolean(nextCursor)',
  ]) {
    assert.ok(controller.includes(token), 'shared tree-page contract missing: ' + token)
  }
  const loaderStart = controller.indexOf('export async function xDriveFileExplorerLoadChildDirectoryPage')
  const loaderEnd = controller.indexOf('export type XDriveFileExplorerFolderUploadEntry', loaderStart)
  assert.equal(controller.slice(loaderStart, loaderEnd).includes('while (true)'), false, 'tree expansion must not drain every page')
})

test('shared navigation pane owns lazy tree state and current-path projection', () => {
  assert.ok(index.includes("export * from './FileExplorerNavigationPane'"), 'shared MUI index must export navigation pane')
  for (const token of [
    'export function XDriveFileExplorerNavigationPane',
    'const [pageByParent, setPageByParent]',
    'const [expandedIDs, setExpandedIDs]',
    'const [loadingIDs, setLoadingIDs]',
    'pageByParentRef',
    'loadingIDsRef',
    'pathChildByParent',
    'for (const node of ancestors) void loadChildren(node)',
    'loadDirectoryPage(node.id, append ? current?.nextCursor : undefined)',
    'data-xdrive-file-explorer-tree-load-more',
    "loading ? '正在加载…' : '加载更多'",
    'currentID === node.id',
    'aria-current={selected',
    'role="tree"',
    'role="treeitem"',
    'role="group"',
    'void onNavigate(node.crumbs)',
    "color: '#ffcb3d'",
  ]) {
    assert.ok(pane.includes(token), 'shared navigation tree behavior missing: ' + token)
  }
})

test('shared FileExplorer shell accepts one reusable left navigation pane', () => {
  for (const token of [
    'navigationPane,',
    'navigationPane?: ReactNode',
    'data-xdrive-file-explorer-navigation-pane',
    '{navigationPane}',
    '<Divider orientation="vertical" flexItem />',
  ]) {
    assert.ok(explorer.includes(token), 'FileExplorer navigation-pane shell missing: ' + token)
  }
})

test('Web and Desktop use the same navigation pane and paged directory loader', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('XDriveFileExplorerNavigationPane'), label + ' must consume the shared navigation pane')
    assert.ok(source.includes('xDriveFileExplorerLoadChildDirectoryPage'), label + ' must consume the shared one-page folder helper')
    assert.ok(source.includes('navigateTo,'), label + ' must navigate through the shared workspace history controller')
    assert.ok(source.includes('navigationPane={('), label + ' must inject the shared pane into FileExplorer')
    assert.equal(source.includes('childrenByParent'), false, label + ' must not own a duplicate tree state machine')
  }

  assert.ok(web.includes('loadDirectoryPage={loadTreeDirectoryPage}'), 'Web tree must pass the shared paged loader into the pane')
  assert.ok(web.includes('loadPage: (id, options) => api.listPage(id, options)'), 'Web tree must use the existing paged children REST adapter')
  assert.ok(desktop.includes('loadDirectoryPage={loadTreeDirectoryPage}'), 'Desktop tree must pass the shared paged loader into the pane')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudChildrenPage(id, options)'), 'Desktop tree must use the existing paged Agent adapter')
})
