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

test('shared FileExplorer tree loader pages only through the folder prefix', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE = 500',
    'xDriveFileExplorerLoadChildDirectories',
    "sort: 'name'",
    "order: 'asc'",
    "if (item.type !== 'dir') return directories",
    'page.next_cursor?.trim()',
    'seenCursors.has(nextCursor)',
  ]) {
    assert.ok(controller.includes(token), 'shared tree-page contract missing: ' + token)
  }
})

test('shared navigation pane owns lazy tree state and current-path projection', () => {
  assert.ok(index.includes("export * from './FileExplorerNavigationPane'"), 'shared MUI index must export navigation pane')
  for (const token of [
    'export function XDriveFileExplorerNavigationPane',
    'const [childrenByParent, setChildrenByParent]',
    'const [expandedIDs, setExpandedIDs]',
    'const [loadingIDs, setLoadingIDs]',
    'loadedIDsRef',
    'loadingIDsRef',
    'pathChildByParent',
    'for (const node of ancestors) void loadChildren(node)',
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
    assert.ok(source.includes('xDriveFileExplorerLoadChildDirectories'), label + ' must consume the shared folder-page helper')
    assert.ok(source.includes('navigateTo,'), label + ' must navigate through the shared workspace history controller')
    assert.ok(source.includes('navigationPane={('), label + ' must inject the shared pane into FileExplorer')
    assert.equal(source.includes('childrenByParent'), false, label + ' must not own a duplicate tree state machine')
  }

  assert.ok(web.includes('loadPage: (id, options) => api.listPage(id, options)'), 'Web tree must use the existing paged children REST adapter')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudChildrenPage(id, options)'), 'Desktop tree must use the existing paged Agent adapter')
})
