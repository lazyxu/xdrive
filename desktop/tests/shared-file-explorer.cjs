const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const explorer = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')
const controller = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')
const propertiesDialog = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FilePropertiesDialog.tsx'), 'utf8')
const index = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'index.tsx'), 'utf8')

test('shared FileExplorer exports one reusable Web/Desktop shell', () => {
  assert.ok(index.includes("export * from './FileExplorer'"), 'shared MUI index does not export FileExplorer')
  assert.ok(index.includes("export * from './FilePropertiesDialog'"), 'shared MUI index does not export FilePropertiesDialog')
  assert.ok(explorer.includes('export function XDriveFileExplorer({'), 'shared explorer component is missing')
  assert.ok(explorer.includes("export type XDriveFileExplorerViewMode = 'details' | 'grid'"), 'view-mode contract is missing')
  assert.ok(explorer.includes('export type XDriveFileExplorerItem = {'), 'generic explorer item model is missing')
  assert.equal(explorer.includes('XDriveApi'), false, 'shared explorer must not depend on Web API implementation')
  assert.equal(explorer.includes('xdriveDesktop'), false, 'shared explorer must not depend on Desktop IPC implementation')
})

test('shared FileExplorer provides Explorer-style navigation chrome', () => {
  for (const label of ['后退', '前进', '上一级', '刷新', '文件路径', '搜索文件和文件夹']) {
    assert.ok(explorer.includes(label), `missing explorer navigation affordance: ${label}`)
  }
  assert.ok(explorer.includes('<Breadcrumbs'), 'Explorer address bar needs breadcrumb navigation')
  assert.ok(explorer.includes('onPathSubmit?.(next)'), 'Explorer address bar needs editable path submission')
  assert.ok(explorer.includes("event.key === 'Escape'"), 'editable path needs Escape cancellation')
  assert.ok(explorer.includes('onSearch?.(searchValue.trim())'), 'Explorer search box needs a submit contract')
})

test('shared FileExplorer provides command bar, details/grid views, and status bar', () => {
  for (const label of ['新建文件夹', '上传', '排序', '详细信息', '图标', '名称', '修改时间', '类型', '大小']) {
    assert.ok(explorer.includes(label), `missing explorer shell feature: ${label}`)
  }
  assert.ok(explorer.includes("viewMode === 'details'"), 'details view is missing')
  assert.ok(explorer.includes('role="list"'), 'grid/icon view is missing')
  assert.ok(explorer.includes('repeat(auto-fill, minmax(112px, 1fr))'), 'grid view should adapt to available width')
  assert.ok(explorer.includes('{items.length} 个项目'), 'Explorer status bar needs item count')
  assert.ok(explorer.includes('onDoubleClick={() => onOpenItem?.(item)}'), 'items need Explorer-style double-click opening')
  assert.ok(explorer.includes("event.key === 'Enter'"), 'items need keyboard open support')
})

test('shared FileExplorer uses compact system-style density without breaking virtualization math', () => {
  assert.ok(explorer.includes('const detailsRowHeight = 38'), 'details virtualization row height should match the compact visual row')
  assert.ok(explorer.includes('const detailsHeaderHeight = 32'), 'details virtualization header height should match the compact header')
  assert.ok(explorer.includes('minHeight: detailsHeaderHeight'), 'details header should consume the virtualization height token')
  assert.ok(explorer.includes('minHeight: detailsRowHeight'), 'details rows should consume the virtualization height token')
  assert.ok(explorer.includes('minHeight: 44'), 'navigation/address row should use compact system height')
  assert.ok(explorer.includes("'& .MuiIconButton-root': { width: 32, height: 32"), 'navigation buttons should use 32px system controls')
  assert.ok(explorer.includes("height: 36, borderRadius: '6px'"), 'address/search inputs should use compact 36px controls')
  assert.ok(explorer.includes('minHeight: 40'), 'command bar should use compact 40px height')
  assert.ok(explorer.includes("'& .MuiToggleButton-root': { width: 32, height: 30"), 'view toggles should stay compact')
  assert.ok(explorer.includes('minHeight: 28'), 'status bar should use compact system height')
  assert.equal(explorer.includes('const detailsRowHeight = 42'), false, 'legacy loose row density should be removed')
  assert.equal(explorer.includes('const detailsHeaderHeight = 34'), false, 'legacy loose header density should be removed')
})

test('shared FileExplorer details view avoids admin-table chrome', () => {
  assert.ok(
    explorer.includes("minHeight: detailsHeaderHeight,\n                alignItems: 'center',\n                px: 1.5,\n                bgcolor: 'background.default'"),
    'details header should use the quiet workspace surface',
  )
  assert.ok(explorer.includes("borderRadius: '4px'"), 'details rows should retain Explorer-style rounded surfaces')
  assert.ok(explorer.includes("selected ? 'action.selected' : 'transparent'"), 'details rows should retain selected state styling')
  assert.ok(explorer.includes("dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)"), 'details rows should expose drag-target styling')
  assert.equal(
    explorer.includes("textAlign: 'left',\n                  borderBottom: 1,\n                  borderColor: 'divider'"),
    false,
    'details rows should not be separated by admin-table grid lines',
  )
  assert.ok(explorer.includes('borderRadius: 1,\n                  p: 1,'), 'grid tiles should use restrained system-style corners')
})

test('shared FileExplorer keeps folders first and owns common client-side sorting', () => {
  assert.ok(controller.includes("XDRIVE_FILE_EXPLORER_DEFAULT_SORT = {\n  key: 'name',\n  direction: 'asc',"), 'framework-neutral controller must own the default sort')
  assert.ok(explorer.includes('useState<XDriveFileExplorerSort>(XDRIVE_FILE_EXPLORER_DEFAULT_SORT)'), 'uncontrolled FileExplorer sort must use the shared default')
  assert.ok(explorer.includes("if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1"), 'folders should remain grouped ahead of files')
  for (const key of ["'name'", "'updated'", "'type'", "'size'"]) {
    assert.ok(explorer.includes(key), `missing explorer sort key: ${key}`)
  }
  assert.ok(explorer.includes("sort.direction === 'asc' ? 1 : -1"), 'sort direction handling is missing')
})


test('shared FileExplorer supports Explorer-style selection semantics', () => {
  assert.ok(explorer.includes('selectedIDs: controlledSelectedIDs'), 'controlled selection contract is missing')
  assert.ok(explorer.includes('defaultSelectedIDs = []'), 'uncontrolled selection contract is missing')
  assert.ok(explorer.includes('event.ctrlKey || event.metaKey'), 'Ctrl/Cmd additive selection is missing')
  assert.ok(explorer.includes('event.shiftKey && selectionAnchorID !== null'), 'Shift range selection is missing')
  assert.ok(explorer.includes("event.key.toLowerCase() === 'a'"), 'Ctrl/Cmd+A select-all is missing')
  assert.ok(explorer.includes("event.key === 'Escape'"), 'Escape selection clearing is missing')
  assert.ok(explorer.includes("event.key === ' '"), 'keyboard Space selection is missing')
  assert.ok(explorer.includes('aria-selected={selected}'), 'selected rows/items need accessible selected state')
  assert.ok(explorer.includes("'action.selected'"), 'selected items need a visible selected state')
})

test('shared FileExplorer provides item and background context-menu contracts', () => {
  assert.ok(explorer.includes('export type XDriveFileExplorerMenuItem = {'), 'context-menu item contract is missing')
  assert.ok(explorer.includes('getItemMenuItems?:'), 'item context-menu adapter hook is missing')
  assert.ok(explorer.includes('backgroundMenuItems?:'), 'background context-menu adapter hook is missing')
  assert.ok(explorer.includes('onContextMenu={(event) => openItemContextMenu(event, item)}'), 'item right-click handling is missing')
  assert.ok(explorer.includes('onContextMenu={openBackgroundContextMenu}'), 'background right-click handling is missing')
  assert.ok(explorer.includes('anchorReference="anchorPosition"'), 'context menu should open at the pointer position')
  assert.ok(explorer.includes("sx={menuItem.danger ? { color: 'error.main' } : undefined}"), 'destructive context-menu actions need a danger treatment')
})

test('shared FileExplorer status bar summarizes selection', () => {
  assert.ok(explorer.includes('已选择 ${selectedIDs.length} 个'), 'selected item count is missing from the status bar')
  assert.ok(explorer.includes('selectedSize'), 'selected file size summary is missing')
})

test('shared FileExplorer supports clipboard keyboard, command-bar and context-menu contracts', () => {
  for (const token of [
    'onCopyItems?: (items: XDriveFileExplorerItem[]) => void',
    'onCutItems?: (items: XDriveFileExplorerItem[]) => void',
    'onPaste?: () => void',
    "modifier && key === 'c'",
    "modifier && key === 'x'",
    "modifier && key === 'v'",
    "label: '复制'",
    "label: '剪切'",
    "label: '粘贴'",
    '<ContentCopyRoundedIcon',
    '<ContentCutRoundedIcon',
    '<ContentPasteRoundedIcon',
  ]) {
    assert.ok(explorer.includes(token), `missing FileExplorer clipboard contract: ${token}`)
  }
})

test('shared FileExplorer supports selection bulk actions', () => {
  for (const token of [
    'onDownloadItems?: (items: XDriveFileExplorerItem[]) => void',
    'onDeleteItems?: (items: XDriveFileExplorerItem[]) => void',
    "label: '下载所选文件'",
    "label: '删除所选项目'",
    "event.key === 'Delete'",
    '<DownloadRoundedIcon',
    '<DeleteOutlineRoundedIcon',
  ]) {
    assert.ok(explorer.includes(token), `missing FileExplorer bulk-action contract: ${token}`)
  }
})

test('shared FileExplorer provides internal and external drag and drop contracts', () => {
  for (const token of [
    "onDropItemsToFolder?: (items: XDriveFileExplorerItem[], target: XDriveFileExplorerItem, operation: 'move' | 'copy') => void",
    'onExternalFilesDrop?: (files: File[], target?: XDriveFileExplorerItem) => void',
    "event.dataTransfer.effectAllowed = 'copyMove'",
    "event.dataTransfer.setData('application/x-xdrive-fileexplorer', '1')",
    "const operation = event.ctrlKey || event.metaKey ? 'copy' : 'move'",
    "event.dataTransfer.types.includes('Files')",
    'draggable={Boolean(onDropItemsToFolder)}',
    'onDrop={dropExternalFilesOnBackground}',
  ]) {
    assert.ok(explorer.includes(token), `missing FileExplorer drag/drop contract: ${token}`)
  }
})

test('shared FileExplorer details columns are sortable, resizable, configurable and persisted', () => {
  for (const token of [
    "export type XDriveFileExplorerDetailsColumnKey = XDriveFileExplorerSortKey",
    'export type XDriveFileExplorerDetailsLayout = {',
    'xDriveNormalizeFileExplorerDetailsLayout',
    'window.localStorage.setItem(detailsPreferencesKey, JSON.stringify(detailsLayout))',
    '<ViewColumnRoundedIcon',
    '重置列',
    'gridTemplateColumns: detailsGridTemplate',
    'setPointerCapture(event.pointerId)',
    "cursor: 'col-resize'",
    'onPointerMove={(event) => moveDetailsColumnResize(event, key)}',
    'onClick={() => setSort({',
    'aria-label={`按${detailsColumnMeta[key].label}排序`}',
  ]) {
    assert.ok(explorer.includes(token), `missing details-column feature: ${token}`)
  }
  assert.equal(explorer.includes("gridTemplateColumns: 'minmax(260px, 1fr) 190px 150px 120px'"), false, 'details columns must not remain hard-coded')
})

test('shared FileExplorer keeps the details inspector and opens Properties as a dialog', () => {
  for (const token of [
    'export type XDriveFileExplorerProperty = XDriveFilePropertiesDialogProperty',
    'path?: string',
    'revision?: string | number',
    'properties?: XDriveFileExplorerProperty[]',
    'const [inspectorOpen, setInspectorOpen] = useState(false)',
    'const [propertiesItems, setPropertiesItems] = useState<XDriveFileExplorerItem[]>([])',
    'aria-pressed={inspectorOpen}',
    'data-xdrive-file-explorer-inspector',
    'data-xdrive-file-explorer-preview',
    "label: '属性'",
    'onSelect: () => setPropertiesItems(selection)',
    "event.altKey && event.key === 'Enter'",
    '<XDriveFilePropertiesDialog',
    '选择一个项目以查看预览和属性。',
    '已选择 {selectedItems.length} 个项目',
    'loadThumbnail={loadThumbnail}',
    "label: 'Revision'",
    "label: 'ID'",
  ]) {
    assert.ok(explorer.includes(token), `missing preview/properties feature: ${token}`)
  }
  assert.ok(explorer.includes("width: 'clamp(248px, 27vw, 328px)'"), 'inspector should use a bounded system-style side pane')
  for (const token of [
    'export function XDriveFilePropertiesDialog({',
    'aria-label="文件属性"',
    'data-xdrive-file-properties-preview',
    '<XDriveDescriptionGrid columns={2}>',
    '技术信息',
    '<XDriveDialogActions>',
  ]) {
    assert.ok(propertiesDialog.includes(token), `missing shared Properties dialog feature: ${token}`)
  }
})

test('shared FileExplorer supports server-paged incremental loading without re-sorting partial pages', () => {
  for (const token of [
    'hasMore?: boolean',
    'loadingMore?: boolean',
    'onLoadMore?: () => void',
    'externallySorted?: boolean',
    'if (externallySorted) return result',
    'host.scrollHeight - host.scrollTop - host.clientHeight <= 500',
    "loadingMore\n            ? '正在加载更多…'",
  ]) {
    assert.ok(explorer.includes(token), `missing server-paging contract: ${token}`)
  }
})
