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

test('shared navigation pane owns a manual lazy tree without following the active folder', () => {
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
    'const rootNode = useMemo(() =>',
    'const appendCurrentGeneration = append && current?.generation === generation',
    'appendCurrentGeneration ? current?.nextCursor : undefined',
    'generation,',
    'XDriveAutoLoadSentinel',
    'data-xdrive-file-explorer-tree-auto-load',
    'onLoad={() => loadChildren(node, true)}',
    '正在加载更多文件夹…',
    'role="tree"',
    'role="treeitem"',
    'role="group"',
    'void onNavigate(node.crumbs)',
    'XDriveFileExplorerItemIcon',
  ]) {
    assert.ok(pane.includes(token), 'shared navigation tree behavior missing: ' + token)
  }
  for (const legacy of [
    'for (const node of ancestors) void loadChildren(node)',
    'pathChildByParent',
    'currentID === node.id',
    'aria-current={selected',
    'selected={selected}',
  ]) {
    assert.equal(pane.includes(legacy), false, 'tree must not auto-follow/highlight the active folder: ' + legacy)
  }
  assert.equal(
    (pane.match(/pl: 3\.75, pr: 0\.75/g) || []).length,
    4,
    'Trash, Quick Access, Favorites and Recent should align their item icons with the root disclosure column',
  )
  assert.equal(pane.includes('data-xdrive-file-explorer-tree-load-more'), false, 'tree must not expose a manual load-more row')
})

test('shared FileExplorer shell accepts one reusable left navigation pane', () => {
  for (const token of [
    'navigationPane,',
    'navigationPane?: ReactNode',
    'data-xdrive-file-explorer-navigation-pane',
    '{navigationPane}',
    'data-xdrive-file-explorer-navigation-splitter',
    'viewPreferences.navigationPaneWidth',
    'viewPreferences.navigationPaneVisible',
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


test('navigation sections collapse independently and persist locally', () => {
  for (const token of [
    "type XDriveFileExplorerNavigationSection = 'quickAccess' | 'favorites' | 'recent' | 'tree'",
    "defaultNavigationSectionPreferencesKey = 'xdrive.files.navigation_sections'",
    'loadNavigationSectionState',
    'window.localStorage.setItem(sectionPreferencesKey, JSON.stringify(expandedSections))',
    "toggleSection('quickAccess')",
    "toggleSection('favorites')",
    "toggleSection('recent')",
    "toggleSection('tree')",
    'expandedSections.quickAccess',
    'expandedSections.favorites',
    'expandedSections.recent',
    'expandedSections.tree',
  ]) {
    assert.ok(pane.includes(token), 'navigation section persistence missing: ' + token)
  }
  assert.ok(pane.includes("width: '100%'"), 'navigation pane must inherit the resizable shell width')
  assert.equal(pane.includes('width: 232'), false, 'navigation pane must not keep a fixed width')
})
