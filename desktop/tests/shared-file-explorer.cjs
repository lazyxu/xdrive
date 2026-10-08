const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const explorer = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'), 'utf8')
const searchFilters = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerSearchFilters.tsx'), 'utf8')
const controller = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')
const propertiesDialog = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FilePropertiesDialog.tsx'), 'utf8')
const index = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'index.tsx'), 'utf8')
const externalDrop = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerExternalDrop.ts'), 'utf8')

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
  assert.ok(explorer.includes('gridTemplateColumns: `repeat(auto-fill, minmax(${gridMetrics.minColumnWidth}px, 1fr))`'), 'grid view should adapt to available width through shared Grid metrics')
  assert.ok(explorer.includes('{items.length} 个项目'), 'Explorer status bar needs item count')
  assert.ok(explorer.includes("if (!renaming) onOpenItem?.(item)"), 'items need Explorer-style double-click opening outside inline rename')
  assert.ok(explorer.includes("event.key === 'Enter'"), 'items need keyboard open support')
})

test('shared FileExplorer uses configurable system-style density without breaking virtualization math', () => {
  assert.ok(explorer.includes('const detailsNormalRowHeight = 36'), 'normal details density token is missing')
  assert.ok(explorer.includes('const detailsCompactRowHeight = 28'), 'compact details density token is missing')
  assert.ok(explorer.includes("const detailsRowHeight = viewPreferences.detailsDensity === 'compact'"), 'details virtualization row height must follow the selected density')
  assert.ok(explorer.includes('const detailsHeaderHeight = 32'), 'details virtualization header height should remain compact')
  assert.ok(explorer.includes('minHeight: detailsHeaderHeight'), 'details header should consume the virtualization height token')
  assert.ok(explorer.includes('minHeight: detailsRowHeight'), 'details rows should consume the virtualization height token')
  assert.ok(explorer.includes('minHeight: 44'), 'navigation/address row should use compact system height')
  assert.ok(explorer.includes("'& .MuiIconButton-root': { width: 32, height: 32"), 'navigation buttons should use 32px system controls')
  assert.ok(explorer.includes("height: 36, borderRadius: '4px'"), 'address/search inputs should use compact 36px controls')
  assert.ok(explorer.includes('minHeight: 40'), 'command bar should use compact 40px height')
  assert.equal(explorer.includes('MuiToggleButton-root'), false, 'duplicate Details/Grid toggle chrome should be removed')
  assert.ok(explorer.includes('minHeight: 28'), 'status bar should use compact system height')
  assert.equal(explorer.includes('const detailsNormalRowHeight = 42'), false, 'legacy loose row density should be removed')
  assert.equal(explorer.includes('const detailsHeaderHeight = 34'), false, 'legacy loose header density should be removed')
})

test('shared FileExplorer uses Windows-style compact navigation and command chrome', () => {
  assert.ok(explorer.includes('data-xdrive-file-explorer-address-bar'), 'address bar marker is missing')
  assert.ok(explorer.includes("crumbs.at(-1)?.name ?? '当前位置'"), 'search must name the current folder')
  assert.ok(explorer.includes("width: { xs: 180, sm: 280, md: 320, lg: 360 }"), 'contextual search should have useful width')
  assert.ok(explorer.includes('排序与分组'), 'sort and group must share one command surface')
  assert.equal(explorer.includes('<ToggleButtonGroup'), false, 'View menu must be the single layout control')
  for (const token of [
    'thumbnailWidth: 48,\n    thumbnailHeight: 48',
    'thumbnailWidth: 72,\n    thumbnailHeight: 72',
    'thumbnailWidth: 108,\n    thumbnailHeight: 108',
    'iconSize: 40,\n    folderIconSize: 40',
    'iconSize: 52,\n    folderIconSize: 52',
    'iconSize: 76,\n    folderIconSize: 76',
  ]) {
    assert.ok(explorer.includes(token), 'Grid metrics must keep square, aligned visual boxes: ' + token)
  }
  assert.ok(searchFilters.includes('aria-label="筛选文件"'), 'structured filters need one compact trigger')
  assert.ok(searchFilters.includes('<Popover'), 'structured filters should expand on demand')
  assert.ok(searchFilters.includes('data-xdrive-file-explorer-search-filters'), 'filter popover surface is missing')
})

test('shared FileExplorer details view avoids admin-table chrome', () => {
  assert.ok(
    explorer.includes("minHeight: detailsHeaderHeight,\n                alignItems: 'center',\n                px: 1.5,\n                bgcolor: 'background.default'"),
    'details header should use the quiet workspace surface',
  )
  assert.ok(explorer.includes("borderRadius: '4px'"), 'details rows should retain Explorer-style rounded surfaces')
  assert.ok(
    explorer.includes("gridTemplateColumns: detailsGridTemplate") && explorer.includes("justifyContent: 'start'"),
    'details row grid tracks must stay left-aligned with the header instead of inheriting ButtonBase centering',
  )
  assert.ok(explorer.includes("selected ? 'action.selected' : 'transparent'"), 'details rows should retain selected state styling')
  assert.ok(explorer.includes("dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)"), 'details rows should expose drag-target styling')
  assert.equal(
    explorer.includes("textAlign: 'left',\n                  borderBottom: 1,\n                  borderColor: 'divider'"),
    false,
    'details rows should not be separated by admin-table grid lines',
  )
  assert.ok(
    explorer.includes('borderRadius: 1,') && explorer.includes('p: gridMetrics.itemPadding,'),
    'grid tiles should keep restrained corners while using shared density metrics',
  )
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
  assert.ok(explorer.includes("command === 'select-all'"), 'shared select-all command is missing')
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
    'onPaste?: (operationOverride?: XDriveFileExplorerCopyMoveOperation) => void',
    "command === 'copy'",
    "command === 'cut'",
    "command === 'paste'",
    "command === 'paste-move'",
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
    'folderDownloadSupported?: boolean',
    'onDeleteItems?: (items: XDriveFileExplorerItem[]) => void',
    "label: folderDownloadSupported ? '下载所选项目' : '下载所选文件'",
    "candidate.kind === 'file' || folderDownloadSupported",
    "label: '删除所选项目'",
    "command === 'delete'",
    '<DownloadRoundedIcon',
    '<DeleteOutlineRoundedIcon',
  ]) {
    assert.ok(explorer.includes(token), `missing FileExplorer bulk-action contract: ${token}`)
  }
})

test('shared FileExplorer provides internal and external drag and drop contracts', () => {
  for (const token of [
    "onDropItemsToFolder?: (items: XDriveFileExplorerItem[], target: XDriveFileExplorerItem, operation: 'move' | 'copy') => void",
    "onDropItemsToCrumb?: (items: XDriveFileExplorerItem[], target: XDriveFileExplorerCrumb, operation: 'move' | 'copy') => void",
    'onExternalFilesDrop?: (files: File[], target?: XDriveFileExplorerItem) => void',
    'onExternalFilesDropToCrumb?: (files: File[], target: XDriveFileExplorerCrumb) => void',
    "event.dataTransfer.effectAllowed = 'copyMove'",
    'XDRIVE_FILE_EXPLORER_DRAG_MIME',
    'xDriveFileExplorerEncodeDragItems(selection)',
    'setFileExplorerDragImage(event, selection)',
    'event.dataTransfer.setDragImage(ghost, 18, 18)',
    "const operation = event.ctrlKey || event.metaKey ? 'copy' : 'move'",
    "event.dataTransfer.types.includes('Files')",
    'draggable={Boolean(onDropItemsToFolder) && !renaming}',
    'updateDragAutoScroll(event.clientY)',
    'onDrop={(event) => dropOnCrumb(event, crumb)}',
    'dropTargetCrumbID',
    'onDrop={dropExternalFilesOnBackground}',
  ]) {
    assert.ok(explorer.includes(token), `missing FileExplorer drag/drop contract: ${token}`)
  }
})

test('shared FileExplorer details columns are sortable, resizable, configurable and persisted', () => {
  for (const token of [
    "export type XDriveFileExplorerDetailsColumnKey =",
    "| 'created'",
    "| 'status'",
    "| 'availability'",
    'export type XDriveFileExplorerDetailsLayout = {',
    'xDriveNormalizeFileExplorerDetailsLayout',
    'window.localStorage.setItem(detailsPreferencesKey, JSON.stringify(detailsLayout))',
    '<ViewColumnRoundedIcon',
    '重置列',
    'gridTemplateColumns: detailsGridTemplate',
    'setPointerCapture(event.pointerId)',
    "cursor: 'col-resize'",
    'onPointerMove={(event) => moveDetailsColumnResize(event, key)}',
    'sortKey?: XDriveFileExplorerSortKey',
    "created: { label: '创建时间'",
    "status: { label: '状态'",
    "availability: { label: '可用性'",
    'detailsColumnMeta[key].sortKey',
    'const sortKey = detailsColumnMeta[key].sortKey!',
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
    "command === 'properties'",
    '<XDriveFilePropertiesDialog',
    '选择一个项目以查看预览和属性。',
    '已选择 {selectedItems.length} 个项目',
    'loadThumbnail={loadThumbnail}',
    "label: 'SHA-256'",
    "label: 'Revision'",
    "label: 'ID'",
    "label: '来源'",
  ]) {
    assert.ok(explorer.includes(token), `missing preview/properties feature: ${token}`)
  }
  assert.ok(explorer.includes('width: viewPreferences.inspectorWidth'), 'inspector should use the persisted resizable pane width')
  assert.ok(explorer.includes('data-xdrive-file-explorer-inspector-splitter'), 'inspector should expose a resize splitter')
  for (const token of [
    'export function XDriveFilePropertiesDialog({',
    'aria-label="文件属性"',
    'data-xdrive-file-properties-preview',
    '<XDriveDescriptionGrid columns={2}>',
    '常规',
    '内容',
    '技术详情',
    '<XDriveDialogActions>',
  ]) {
    assert.ok(propertiesDialog.includes(token), `missing shared Properties dialog feature: ${token}`)
  }
})

test('shared FileExplorer surface is range-driven and has no append/load-more contract', () => {
  assert.ok(explorer.includes('externallySorted?: boolean'), 'server-sorted range presentation must remain')
  assert.ok(explorer.includes('if (externallySorted) return items'), 'server-sorted ranges must not be re-sorted client-side')
  for (const legacy of [
    'hasMore?: boolean',
    'loadingMore?: boolean',
    'onLoadMore?: () => void',
    'xDriveFileExplorerLoadMorePrefetchDistance',
    '正在加载更多…',
  ]) {
    assert.equal(explorer.includes(legacy), false, `legacy append pagination remains in FileExplorer: ${legacy}`)
  }
})


test('shared FileExplorer supports Windows-style marquee selection in Details and Grid views', () => {
  for (const token of [
    'type XDriveFileExplorerMarqueeSession = {',
    'const marqueeSessionRef = useRef<XDriveFileExplorerMarqueeSession | null>(null)',
    "event.pointerType !== 'mouse'",
    'host.setPointerCapture(event.pointerId)',
    'const additive = event.ctrlKey || event.metaKey',
    "if (viewMode === 'details')",
    'detailsHeaderHeight',
    'detailsRowHeight',
    'const itemLeft = gridPaddingPx + column * (cellWidth + gridGapPx)',
    'const itemTop = gridPaddingPx + row * gridRowStep',
    'commitSelection(marqueeSelectionIDs(',
    'suppressBackgroundClickRef.current = true',
    'onPointerDown={startMarqueeSelection}',
    'onPointerMove={updateMarqueeSelection}',
    'onPointerUp={(event) => finishMarqueeSelection(event)}',
    'onPointerCancel={(event) => finishMarqueeSelection(event, true)}',
    'data-xdrive-file-explorer-marquee',
  ]) {
    assert.ok(explorer.includes(token), `missing FileExplorer marquee contract: ${token}`)
  }
})


test('shared FileExplorer exposes file and folder upload commands', () => {
  assert.ok(explorer.includes('onUploadFolder?: () => void'), 'folder upload command contract is missing')
  assert.ok(explorer.includes('DriveFolderUploadRoundedIcon'), 'folder upload command icon is missing')
  assert.ok(explorer.includes('上传文件夹'), 'folder upload command label is missing')
})


test('shared FileExplorer recursively reads dropped folders before platform upload', () => {
  for (const token of [
    'xDriveFileExplorerReadExternalDrop',
    'webkitGetAsEntry',
    'createReader',
    'readEntries',
    'directories.add(relativePath)',
    'files.push({ file, relativePath })',
    "items.length === 0",
  ]) {
    assert.ok(externalDrop.includes(token), `missing shared dropped-folder reader: ${token}`)
  }
  assert.ok(index.includes("export * from './FileExplorerExternalDrop'"), 'external-drop reader must be exported')
  for (const token of [
    'onExternalFolderDrop?:',
    'onExternalFolderDropToCrumb?:',
    'await xDriveFileExplorerReadExternalDrop(dataTransfer)',
    'payload.directories.length > 0',
  ]) {
    assert.ok(explorer.includes(token), `missing shared folder-drop dispatch: ${token}`)
  }
})


test('folder downloads stay capability-aware across Web and Desktop', () => {
  const webExplorer = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
  const desktopExplorer = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
  assert.ok(webExplorer.includes('folderDownloadSupported'), 'Web must enable archive downloads for selected folders')
  assert.ok(
    desktopExplorer.includes('folderDownloadSupported={!trashActive && (folderTreeDownloadSupported || archiveDownloadSupported)}'),
    'Desktop must enable selected-folder downloads for hierarchical download or archive fallback',
  )
  assert.ok(
    desktopExplorer.includes('folderTreeDownloadSupported &&') &&
      desktopExplorer.includes('cloudDownloadFolder('),
    'Desktop must prefer true hierarchical folder download when the Agent capability is available',
  )
})


test('standard Details rows stay single-line at native file-manager density', () => {
  assert.ok(explorer.includes('const detailsNormalRowHeight = 36'))
  assert.ok(explorer.includes('const detailsCompactRowHeight = 28'))
  assert.equal(
    explorer.includes("viewPreferences.detailsDensity === 'normal' && item.secondaryLabel"),
    false,
    'standard Details rows must not render a second secondary-label line',
  )
})
