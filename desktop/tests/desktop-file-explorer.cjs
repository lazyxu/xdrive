const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const filesPage = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFilesPage.tsx'), 'utf8')
const localStoragePage = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopLocalStoragePage.tsx'), 'utf8')
const cloudStoragePage = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudStoragePage.tsx'), 'utf8')
const workspaceContent = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceContent.tsx'), 'utf8')
const workspaceRoute = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceRoute.ts'), 'utf8')
const explorer = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const projection = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts'), 'utf8')
const navigation = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts'), 'utf8')
const workspaceController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts'), 'utf8')
const styles = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'styles.css'), 'utf8')
const controller = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')
const operationController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerOperationController.ts'), 'utf8')
const deleteController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerDeleteController.ts'), 'utf8')
const uploadController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerUploadController.ts'), 'utf8')

test('Desktop files workspace consumes the shared FileExplorer', () => {
  assert.ok(filesPage.includes("import DesktopFileExplorer from './DesktopFileExplorer'"), 'Desktop Files page must import the Explorer adapter')
  assert.ok(filesPage.includes('<DesktopFileExplorer'), 'Desktop Files page did not render the Explorer adapter')
  assert.ok(explorer.includes('<XDriveFileExplorer'), 'Desktop adapter does not consume the shared FileExplorer')
  assert.equal(app.includes('className="cloud-search-row"'), false, 'legacy Desktop cloud search row remains')
  assert.equal(app.includes('className="cloud-list"'), false, 'legacy Desktop cloud list remains')
  assert.equal(app.includes('className="cloud-list-header"'), false, 'legacy Desktop cloud list header remains')
})

test('Desktop FileExplorer wires real cloud mutations and native transfers', () => {
  for (const token of [
    'const expectedCurrentID = current.id',
    'cloudCreateDirectory(expectedCurrentID, name)',
    'cloudUploadFiles(expectedCurrentID)',
    'cloudRename(node.id, node.revision, name)',
    'refreshCurrentDirectoryIfCurrent(expectedCurrentID)',
    'onRenameItem={trashActive ? undefined : renameItem}',
    'cloudDownload(node.id, node.name)',
    'getItemMenuItems={trashActive ? trash.getItemMenuItems : getItemMenuItems}',
    'backgroundMenuItems={trashActive ? [] : backgroundMenuItems}',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop Explorer operation: ${token}`)
  }
  assert.ok(app.includes('useXDriveFileExplorerDeleteController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop delete flow must use the shared delete-to-trash controller')
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudCreateFileOperation(operation, items)'), 'Desktop delete controller must keep Agent submission local')
  assert.ok(deleteController.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'shared delete controller must own delete planning')
})

test('Desktop FileExplorer provides system-style navigation, search, and persistent view mode', () => {
  for (const token of [
    'useXDriveFileExplorerWorkspace<AgentCloudNode, AgentCloudSearchResult>({',
    'canGoBack={!trashActive && canGoBack}',
    'canGoForward={!trashActive && canGoForward}',
    'canGoUp={!trashActive && canGoUp}',
    'onPathSubmit',
    'onCrumbClick',
    'loadSearchRange: async (query, filters, searchGrouping, searchSort, offset, limit) =>',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop Explorer navigation/search contract: ${token}`)
  }
  assert.ok(controller.includes("replace(/\\\\/g, '/')"), 'shared path controller should accept Windows separators')
  assert.equal(explorer.includes('xDriveFileExplorerSubmitPath({'), false, 'Desktop Explorer should delegate typed-path submission to the shared workspace controller')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudRoot()'), 'Desktop typed-path submission should keep Agent root loading local')
  assert.ok(explorer.includes('findChildDirectory: async (parentID, name) =>'), 'Desktop typed-path traversal should use exact child lookup')
  assert.ok(explorer.includes('xDriveFileExplorerPathLookupPageOptions(name)'), 'Desktop typed-path traversal should request one indexed child')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudChildrenPage('), 'Desktop typed-path lookup must stay on the paged Agent bridge')
  assert.equal(explorer.includes('window.xdriveDesktop.agent.cloudChildren(parentID)'), false, 'Desktop typed-path traversal must not load all children')
  assert.equal(explorer.includes('xDriveResolveFileExplorerPath({'), false, 'Desktop must not orchestrate typed-path traversal locally')
  assert.equal(explorer.includes('xDriveFileExplorerDispatchOpenItem({'), false, 'Desktop open-item dispatch should stay inside the shared workspace controller')
  assert.ok(explorer.includes('searchCrumbsForResult: (result) => result.crumbs'), 'Desktop shared workspace should preserve search crumbs')
  assert.ok(explorer.includes('openWorkspaceItem(item, openPreviewNode)'), 'Desktop shared workspace should use the shared preview for primary Open')
  assert.ok(explorer.includes("onSystemOpen: node.type === 'file'"), 'Desktop must preserve explicit native system Open')
  assert.ok(explorer.includes('void openLocalNode(node)'), 'Desktop system Open must keep native execution local')
  assert.ok(workspaceController.includes('navigate: navigation.navigateTo'), 'shared workspace should dispatch search-directory navigation through shared navigation')
  assert.ok(explorer.includes('viewModeStorageKey: DESKTOP_FILE_VIEW_KEY'), 'Desktop Explorer should pass its view-mode storage key to the shared controller')
  assert.ok(explorer.includes("pathValue={trashActive ? '回收站' : pathValue}"), 'Desktop Explorer path display must come from shared navigation')
  assert.ok(explorer.includes('navigateToCrumb(index)'), 'Desktop breadcrumb clicks must use shared navigation')
  assert.ok(explorer.includes('onRefresh={trashActive ? () => { void trash.refresh() } : refresh}'), 'Desktop Explorer refresh must use shared navigation')
  assert.ok(explorer.includes('onRefresh: refresh'), 'Desktop background refresh must use shared navigation')
  assert.ok(navigation.includes('window.localStorage.setItem(viewModeStorageKey, viewMode)'), 'shared Explorer controller should persist Details/Grid mode')
})

test('Desktop FileExplorer virtualizes server Search ranges through Agent transport', () => {
  assert.ok(explorer.includes('useXDriveFileExplorerWorkspace<AgentCloudNode, AgentCloudSearchResult>'), 'Desktop search lifecycle must come from the shared workspace controller')
  assert.ok(explorer.includes('onSearchValueChange={changeSearchValue}'), 'Desktop search draft must come from the shared controller')
  assert.equal(explorer.includes('const [searchValue, setSearchValue] = useState'), false, 'Desktop must not own search draft state')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudSearchRange('), 'Desktop Search must use Agent range transport')
  assert.ok(explorer.includes('filters,'), 'Desktop Search range must forward structured filters')
  assert.ok(explorer.includes('<XDriveFileExplorerSearchFilters'), 'Desktop must render shared structured filter chips')
  assert.ok(explorer.includes('searchSort.key'), 'Desktop Search range must forward sort key')
  assert.ok(explorer.includes('searchSort.direction'), 'Desktop Search range must forward sort direction')
  assert.ok(explorer.includes('searchGrouping,'), 'Desktop Search must forward grouping through Agent IPC')
  assert.ok(explorer.includes('grouping={trashActive ? undefined : grouping}'), 'Desktop grouping must come from shared tab state')
  assert.ok(explorer.includes('onGroupingChange={trashActive ? undefined : changeGrouping}'), 'Desktop grouping changes must reload Server ranges')
  assert.ok(explorer.includes('virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}'), 'Desktop Search must reuse the shared sparse surface')
  assert.equal(explorer.includes('window.xdriveDesktop.agent.cloudSearch('), false, 'Desktop Explorer must not use cursor Search after migration')
  assert.equal(explorer.includes('searchRequestRef'), false, 'Desktop must not own Search request sequencing')
  assert.equal(explorer.includes('最多显示 200 个结果'), false, 'Desktop Search must not truncate the logical result set')
})

test('Desktop Cloud Storage stays current-account scoped and excludes global CAS inventory', () => {
  assert.equal(filesPage.includes('CAS 全局物理对象'), false, 'global CAS intelligence must not occupy the Files workspace')
  assert.equal(localStoragePage.includes('CAS 全局物理对象'), false, 'global CAS intelligence must not occupy local storage')
  assert.ok(cloudStoragePage.includes('title="云端存储"'), 'shared Cloud Storage workspace is missing its title')
  assert.ok(cloudStoragePage.includes('title="账号容量"'), 'shared Cloud Storage workspace is missing account capacity metrics')
  assert.ok(cloudStoragePage.includes('title="文件大小分布"'), 'shared Cloud Storage workspace is missing current-file distribution')
  assert.equal(cloudStoragePage.includes('CAS 全局物理对象'), false, 'shared Cloud Storage must not expose global CAS intelligence')
  assert.equal(cloudStoragePage.includes('宿主机绝对路径'), false, 'shared Cloud Storage must not expose global host paths')
  assert.equal(cloudStoragePage.includes('cleanupCache'), false, 'shared Cloud Storage must not expose global cache cleanup')
  assert.ok(app.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Desktop must render the shared Cloud Storage workspace')
})

test('Desktop Cloud Storage adapter owns cloud quota and account file-distribution refresh', () => {
  assert.ok(app.includes('createXDriveCloudStorageDataSource({'), 'Desktop is missing the shared Cloud Storage data-source factory')
  assert.ok(app.includes("getQuota: () => window.xdriveDesktop.agent.cloudQuota()"), 'Cloud Storage port should retrieve cloud quota')
  assert.ok(app.includes('getStats: storageStatsSupported'), 'Cloud Storage port should capability-gate account file distribution')
  assert.ok(app.includes('onQuota: applyCloudQuota'), 'Cloud Storage factory should update shared Cloud Files quota state')
})

test('Desktop Files cloud lifecycle uses the shared controller without storage intelligence coupling', () => {
  const start = app.indexOf('const cloudFilesPort = useMemo')
  const end = app.indexOf('const loadCloudFileOperations', start)
  assert.ok(start >= 0 && end > start, 'Desktop cloud-files controller boundaries are missing')
  const body = app.slice(start, end)
  assert.ok(body.includes('cloudRoot()'), 'Desktop Cloud Files port should load the cloud root')
  assert.ok(body.includes('cloudQuota()'), 'Desktop Cloud Files port should load quota for sidebar/over-quota status')
  assert.ok(body.includes('useXDriveCloudFilesController'), 'Desktop Files must delegate lifecycle to the shared controller')
  assert.equal(body.includes('cloudStorageStats()'), false, 'Cloud Files lifecycle must not fetch storage intelligence')
})


test('Desktop Files uses shared workspace content for full-bleed Explorer layout', () => {
  assert.ok(app.includes('<XDriveWorkspaceContent'), 'Desktop App must use shared workspace content')
  assert.ok(app.includes('presentation={xDriveWorkspacePresentation(view)}'), 'Desktop Files should select the shared full-bleed presentation through the route model')
  assert.ok(workspaceRoute.includes("return view === 'files' ? 'files' : 'page'"), 'shared route model must own full-bleed Files presentation')
  assert.equal(app.includes('<XDrivePageHeader'), false, 'Desktop App should not own duplicate generic page chrome')
  assert.ok(app.includes('<DesktopFilesPage'), 'Desktop Files should render through the extracted full-bleed page')
  assert.ok(workspaceContent.includes("export type XDriveWorkspaceContentPresentation = 'page' | 'files'"), 'shared content presentation contract is missing')
  assert.ok(workspaceContent.includes("const files = presentation === 'files'"), 'shared content must derive Files presentation centrally')
  assert.ok(workspaceContent.includes("p: 0"), 'shared Files presentation must remove page padding')
  assert.ok(workspaceContent.includes("overflow: 'hidden'"), 'shared Desktop Files presentation must own clipping')
  assert.equal(styles.includes('.content-files-workspace {'), false, 'Desktop must not retain local Files workspace layout CSS')
  assert.equal(styles.includes('.content {'), false, 'Desktop must not retain local page-content layout CSS')

  for (const token of [
    "import { Box } from '@mui/material'",
    '<Box',
    'component="section"',
    'flex: 1,',
    'minHeight: 0,',
    "flexDirection: 'column'",
    "overflow: 'hidden'",
    "bgcolor: 'background.paper'",
    "'& > [data-xdrive-file-explorer]'",
  ]) {
    assert.ok(filesPage.includes(token), `missing MUI Explorer host rule: ${token}`)
  }
  assert.equal(styles.includes('.cloud-explorer-panel {'), false, 'Desktop Files host must not retain local CSS')
  assert.equal(filesPage.includes('calc(100vh - 170px)'), false, 'Desktop Files should not use hard-coded viewport subtraction')
  assert.ok(filesPage.includes('<XDriveStatusAlert tone="bad" sx={{ m: 1.5 }}>'), 'over-quota warning should remain an inset workspace strip')
})

test('Desktop FileExplorer queues copy/cut/paste through the shared operation controller', () => {
  assert.ok(explorer.includes('useXDriveFileExplorerWorkspace<AgentCloudNode, AgentCloudSearchResult>'), 'Desktop must consume clipboard state through the shared workspace controller')
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop must consume the shared queued-operation controller')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop must keep persistent-operation transport local')
  assert.ok(explorer.includes('onQueued: onOperationQueued'), 'Desktop must surface queued operations immediately')
  assert.ok(explorer.includes('canPaste={!trashActive && fileOperationCanPaste}'), 'Desktop paste availability must come from the shared operation controller')
  assert.ok(explorer.includes('onCopyItems={trashActive ? undefined : copyItems}'), 'Desktop shared copy adapter is missing')
  assert.ok(explorer.includes('onCutItems={trashActive ? undefined : cutItems}'), 'Desktop shared cut adapter is missing')
  assert.ok(explorer.includes('onPaste={trashActive ? undefined : (operationOverride) => { void pasteClipboard(operationOverride) }}'), 'Desktop shared paste adapter is missing')
  assert.ok(operationController.includes("await runPlan('paste', plan"), 'shared controller must execute paste plans')
  assert.equal(explorer.includes('const plan = planPaste(current.id)'), false, 'Desktop must not execute paste planning locally')
})

test('Desktop FileExplorer supports bulk download and shared delete-to-trash orchestration', () => {
  assert.ok(explorer.includes('async function downloadSelected(selected: XDriveFileExplorerItem[]) {'), 'Desktop bulk download helper is missing')
  assert.ok(explorer.includes('xDriveFileExplorerDownloadPlan(nodes)'), 'Desktop bulk download must use shared download planning')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudDownloadFiles(plan.items)'), 'Desktop bulk download bridge is missing')
  assert.ok(explorer.includes('onDownloadItems={trashActive ? undefined : (selected) => { void downloadSelected(selected) }}'), 'Desktop shared bulk download adapter is missing')
  assert.ok(explorer.includes('onDeleteMany(nodes)'), 'Desktop shared bulk delete adapter is missing')
  assert.ok(app.includes('useXDriveFileExplorerDeleteController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop delete confirmation and queue flow must be shared')
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudCreateFileOperation(operation, items)'), 'Desktop delete transport must stay local to Agent IPC')
  assert.ok(app.includes('onQueued: rememberCloudFileOperation'), 'Desktop delete must seed task state immediately')
  assert.ok(app.includes("confirmationIntent: 'warning'"), 'Desktop delete confirmation must preserve its warning intent')
  assert.ok(deleteController.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'shared delete controller must own delete planning')
})

test('Desktop single-item delete reuses the shared bulk delete path', () => {
  assert.ok(deleteController.includes('const remove = useCallback((node: TNode) => {'), 'shared delete controller must expose single-item delete')
  assert.ok(deleteController.includes('requestDelete([node])'), 'Desktop single delete must reuse shared delete confirmation and queue orchestration')
  assert.ok(deleteController.includes('removeMany: requestDelete'), 'Desktop bulk delete must reuse the same shared path')
  assert.equal(app.includes('const removeCloudNode = (node: AgentCloudNode) => {'), false, 'Desktop App must not keep a local single-delete orchestrator')
  assert.equal(app.includes('const removeCloudNodes = (nodes: AgentCloudNode[]) => {'), false, 'Desktop App must not keep a local bulk-delete orchestrator')
  assert.equal(app.includes('xDriveFileExplorerDeleteOperationPlan('), false, 'Desktop App must not plan delete operations locally')
})

test('Desktop FileExplorer supports shared internal drag operations and local external uploads', () => {
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop internal drag/drop must use the shared operation controller')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsPlan('), 'shared operation controller must own folder-drop planning')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsToParentPlan('), 'shared operation controller must own breadcrumb-drop planning')
  assert.equal(explorer.includes('xDriveFileExplorerDropItemsPlan('), false, 'Desktop must not plan internal drag/drop locally')
  assert.equal(explorer.includes('const targetNode = nodeByID.get(Number(target.id))'), false, 'Desktop internal drag must not resolve drop targets locally')
  assert.ok(explorer.includes('useXDriveFileExplorerExternalDropController<'), 'Desktop external drop should delegate target and refresh orchestration to the shared controller')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)'), 'Desktop external drop upload bridge is missing')
  assert.ok(explorer.includes('onExternalFilesDrop={trashActive ? undefined : (files, target) => { void dropExternalFiles(files, target) }}'), 'Desktop external drop is not wired to shared FileExplorer')
})

test('Desktop uses a dedicated persistent FileExplorer details-column layout', () => {
  assert.ok(explorer.includes("const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'"), 'Desktop details layout storage key is missing')
  assert.ok(explorer.includes('detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}'), 'Desktop details layout key is not passed to shared FileExplorer')
})

test('Desktop FileExplorer supplies preview/properties metadata through existing protected thumbnail APIs', () => {
  assert.ok(projection.includes('path: resultPath || `${pathPrefix}${node.name}`'), 'shared Explorer projection path metadata is missing')
  assert.ok(projection.includes('revision: node.revision'), 'shared Explorer projection revision metadata is missing')
  assert.ok(explorer.includes('loadThumbnail={loadThumbnail}'), 'Desktop inspector should reuse the protected media thumbnail bridge')
  assert.equal(explorer.includes('localPath:'), false, 'Desktop preview/properties must not expose managed local paths')
})

test('Desktop Files no longer inherits the legacy dashboard panel or dead pre-shared Explorer CSS', () => {
  assert.ok(filesPage.includes('<Box'), 'Desktop Files should use a MUI workspace host')
  assert.ok(filesPage.includes('component="section"'), 'Desktop Files should preserve section semantics')
  assert.equal(filesPage.includes('cloud-explorer-panel'), false, 'Desktop Files must not retain the legacy Explorer host class')

  for (const selector of [
    '.cloud-panel {',
    '.cloud-note {',
    '.cloud-heading-actions {',
    '.cloud-search-row {',
    '.cloud-search-input {',
    '.cloud-breadcrumbs {',
    '.cloud-list {',
    '.cloud-list-header',
    '.cloud-row {',
    '.cloud-name {',
    '.cloud-row-actions {',
    '.cloud-compact-row {',
  ]) {
    assert.equal(styles.includes(selector), false, `dead legacy Desktop Explorer CSS remains: ${selector}`)
  }
})

test('Desktop FileExplorer uses shared range-backed directory sorting', () => {
  assert.equal(app.includes('DEFAULT_DESKTOP_FILE_SORT'), false, 'Desktop must not own a local default file sort')
  assert.ok(app.includes('XDRIVE_FILE_EXPLORER_DEFAULT_SORT'), 'Desktop cloud controller must use the shared default sort')
  assert.ok(controller.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200'), 'Desktop page-size contract must remain in the shared controller')
  assert.ok(app.includes('useXDriveCloudFilesController<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>'), 'Desktop directory lifecycle must use the shared Cloud Files controller')
  assert.ok(app.includes('cloudChildrenRange('), 'Desktop Cloud Files port must expose the range transport')
  assert.ok(app.includes('virtualDirectory: cloudVirtualDirectory'), 'Desktop must pass sparse directory state into the Explorer adapter')
  assert.equal(app.includes('xDriveFileExplorerPageRequestOptions('), false, 'Desktop App must not construct directory page requests locally')
  assert.equal(app.includes('xDriveFileExplorerCanLoadMore('), false, 'Desktop App must not own directory pagination eligibility')
  assert.equal(app.includes('xDriveFileExplorerDirectoryPageTransition('), false, 'Desktop App must not own directory page transitions')
  assert.ok(explorer.includes('directoryVirtualCollection: virtualDirectory'), 'Desktop Explorer must delegate sparse directory state to the shared workspace')
  assert.ok(explorer.includes('virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}'), 'Desktop Explorer must activate the shared sparse surface')
  assert.ok(explorer.includes('externallySorted={trashActive ? Boolean(trash.virtualCollection) : externallySorted}'), 'Desktop directory ranges should consume shared workspace sorting state')
  assert.ok(explorer.includes('onSortChange={trashActive ? setTrashSort : changeSort}'), 'Desktop sort changes should reload server-sorted ranges')
})

test('Desktop multi-select mutations use persistent operations instead of renderer-side batch execution', () => {
  assert.ok(app.includes('useXDriveFileExplorerDeleteController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop bulk delete must use one shared delete controller')
  assert.ok(deleteController.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'shared delete controller must queue one delete plan')
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudCreateFileOperation(operation, items)'), 'Desktop delete must keep queued-operation transport local')
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop paste/drop must use one shared queued-operation controller')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop must keep queued-operation transport local')
  assert.ok(operationController.includes('planPaste(currentID, operationOverride)'), 'shared controller must preserve clipboard operation type for paste')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsPlan('), 'shared controller must preserve copy/move operation type for drag/drop')
  assert.equal(app.includes('for (const node of nodes) {\n            const result = await window.xdriveDesktop.agent.cloudDelete'), false, 'Desktop bulk delete must not regress to N requests')
})


test('Desktop upload conflicts use the shared upload controller with capability-gated transports', () => {
  for (const token of [
    'useXDriveFileExplorerUploadController<File>({',
    'continueOnUploadError: true',
    'window.xdriveDesktop.agent.cloudUploadPreflight(parentID, file.name)',
    'window.xdriveDesktop.agent.cloudUploadPreflightBatch(',
    'window.xdriveDesktop.agent.cloudUploadFile(',
    'runTargets: runUploadTargets,',
    'runGroup: runUploadGroup,',
    '<XDriveUploadConflictDialog {...uploadConflictDialogProps}',
    'uploadConflictSupported',
    'cloudUploadFiles(expectedCurrentID)',
    'refreshCurrentDirectoryIfCurrent(expectedCurrentID)',
    'cloudUploadDroppedFiles(parentID, files)',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop shared upload-controller wiring: ${token}`)
  }
  assert.ok(uploadController.includes('loadBatchPreflights'), 'shared upload controller must batch preflight work')
  assert.ok(uploadController.includes("if (conflictPolicy === 'skip')"), 'shared upload controller must own skip handling')
  assert.ok(uploadController.includes('continueOnUploadError'), 'shared upload controller must support Desktop continue-on-error behavior')
  assert.ok(uploadController.includes('xDriveUploadBatchSummary(result)'), 'shared upload controller must own upload summaries')
  assert.equal(explorer.includes('useXDriveUploadConflictResolver()'), false, 'Desktop must not own conflict-resolver lifecycle')
  assert.equal(explorer.includes("let conflictPolicy: XDriveUploadConflictPolicy = 'fail'"), false, 'Desktop must not own per-file conflict state')
  assert.ok(app.includes("capabilities.includes('upload-conflict-policy')"), 'Desktop must gate policy-aware uploads by Agent capability')
  assert.ok(app.includes("capabilities.includes('upload-conflict-preflight')"), 'Desktop must gate conflict preflight by Agent capability')
})


test('Desktop folder and mixed-selection downloads use Agent archive capability with legacy fallback', () => {
  for (const token of [
    'archiveDownloadSupported = false',
    'xDriveFileExplorerArchiveDownloadPlan(nodes)',
    'window.xdriveDesktop.agent.cloudDownloadArchive(archivePlan.ids)',
    "beginActionBusy('download-archive')",
    "actionBusy === 'download-archive'",
    "downloadLabel: node.type === 'file' ? '另存为…' : '下载到…'",
    'xDriveFileExplorerDownloadPlan(nodes)',
    'cloudDownloadFiles(plan.items)',
  ]) {
    assert.ok(explorer.includes(token), `Desktop archive download wiring missing: ${token}`)
  }
})


test('Desktop FileExplorer uploads selected folders through the shared hierarchy planner', () => {
  for (const token of [
    'folderUploadInputRef',
    "element.setAttribute('webkitdirectory', '')",
    "element.setAttribute('directory', '')",
    'xDriveFileExplorerResolveFolderUploadTargets({',
    'xDriveFileExplorerEnsureUploadDirectory({',
    'relativePath: file.webkitRelativePath || file.name',
    'window.xdriveDesktop.agent.cloudCreateDirectory(id, directoryName)',
    'xDriveFileExplorerCaseInsensitiveNameLookupPageOptions(directoryName)',
    'window.xdriveDesktop.agent.cloudChildrenPage(',
    "'upload-folder'",
    'runUploadGroup({',
    'relativePath,',
    'transferLifecycleSupported',
    'onUploadFolder={!trashActive && uploadConflictSupported',
    '正在上传文件夹…',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop folder-upload support: ${token}`)
  }
})


test('Desktop FileExplorer recursively uploads dropped folders through shared payloads', () => {
  for (const token of [
    'XDriveFileExplorerExternalDropPayload',
    'useXDriveFileExplorerExternalDropController<',
    'payload.files',
    'payload.directories',
    'onExternalFolderDrop={uploadConflictSupported',
    'onExternalFolderDropToCrumb={!trashActive && uploadConflictSupported',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop dropped-folder support: ${token}`)
  }
})


test('Desktop FileExplorer persists tab sessions per server account while reconnect state stays authoritative', () => {
  assert.ok(
    explorer.includes('navigationSessionStorageKey?: string'),
    'Desktop Explorer adapter must accept the shared session-storage key',
  )
  assert.ok(
    explorer.includes('navigationSessionStorageKey,') &&
      explorer.includes('initialNavigationState: navigationState'),
    'Desktop must pass both persistent session and transient reconnect state to shared navigation',
  )
  assert.ok(
    app.includes('xdrive.desktop.files.navigation_session.v1:') &&
      app.includes('encodeURIComponent(status.server)') &&
      app.includes('encodeURIComponent(status.username)'),
    'Desktop session persistence must be scoped by server and username',
  )
  assert.ok(
    app.includes('navigationState: cloudFileExplorerNavigationState'),
    'Desktop reconnect snapshot must remain available as the explicit initial state',
  )
})


test('Desktop FileExplorer remounts shared navigation when session identity key changes', () => {
  const start = filesPage.indexOf('<DesktopFileExplorer')
  const end = filesPage.indexOf('/>', start)
  assert.ok(start >= 0 && end > start, 'Desktop Files page Explorer element is missing')
  const block = filesPage.slice(start, end)

  assert.ok(
    block.includes('key={explorer.navigationSessionStorageKey}'),
    'Desktop FileExplorer must remount when the Server+username navigation session key changes so old-account tabs cannot survive into or be persisted under the new account',
  )
})


test('Desktop media Details columns use capability-gated Agent IPC and the shared FileExplorer loader', () => {
  assert.ok(explorer.includes('mediaDetailsSupported = false'), 'Desktop media-details capability gate is missing')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudFileMediaDetails([...refs])'), 'Desktop media-details Agent bridge is missing')
  assert.ok(explorer.includes('loadMediaDetails={mediaDetailsSupported ? loadMediaDetails : undefined}'), 'Desktop media-details loader is not wired')
})
