const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const drag = read('ui', 'shared', 'src', 'file-explorer-drag.ts')
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
    'loadDirectoryPageGenerationRef',
    'loadDirectoryPageRef.current !== loadDirectoryPage',
    'generation !== loadDirectoryPageGenerationRef.current',
    'pathChildByParent',
    'for (const node of ancestors) void loadChildren(node)',
    'const appendCurrentGeneration = append && current?.generation === generation',
    'appendCurrentGeneration ? current?.nextCursor : undefined',
    'generation,',
    'XDriveAutoLoadSentinel',
    'data-xdrive-file-explorer-tree-auto-load',
    'onLoad={() => loadChildren(node, true)}',
    '正在加载更多文件夹…',
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
  assert.equal(pane.includes('data-xdrive-file-explorer-tree-load-more'), false, 'tree must not expose a manual load-more row')
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


test('navigation tree is a complete internal and external drop target', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_DRAG_MIME',
    'xDriveFileExplorerEncodeDragItems',
    'xDriveFileExplorerDecodeDragIDs',
  ]) {
    assert.ok(drag.includes(token), 'shared drag payload contract missing: ' + token)
  }

  for (const token of [
    'dropDisabled = false',
    'onDropInternalItems,',
    'onExternalFilesDrop,',
    'onExternalFolderDrop,',
    'const [dropTargetID, setDropTargetID]',
    'const dragOverNode =',
    'const dropOnNode = async',
    "types.includes(XDRIVE_FILE_EXPLORER_DRAG_MIME)",
    "types.includes('Files')",
    'xDriveFileExplorerReadExternalDrop(dataTransfer)',
    'xDriveFileExplorerDecodeDragIDs(',
    "event.ctrlKey || event.metaKey ? 'copy' : 'move'",
    'onDragOver={(event) => dragOverNode(event, node)}',
    'onDrop={(event) => { void dropOnNode(event, node) }}',
    "outlineColor: dropTargetID === node.id ? 'primary.main' : undefined",
  ]) {
    assert.ok(pane.includes(token), 'navigation-tree DnD contract missing: ' + token)
  }

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    for (const token of [
      'onDropInternalItems={(itemIDs, target, operation) =>',
      'void dropItemsToCrumb(',
      'itemIDs.map((id) => ({ id }))',
      'onExternalFilesDrop={(files, target) =>',
      'void dropExternalFilesToCrumb(files, target)',
    ]) {
      assert.ok(source.includes(token), label + ' navigation-tree DnD adapter missing: ' + token)
    }
  }
  assert.ok(
    web.includes('void dropExternalFolderEntriesToCrumb(payload, target)'),
    'Web navigation tree must support dropped local folders',
  )
  assert.ok(
    desktop.includes('void dropExternalFolderEntriesToCrumb(payload, target)'),
    'Desktop navigation tree must support dropped local folders when folder upload is available',
  )
})
