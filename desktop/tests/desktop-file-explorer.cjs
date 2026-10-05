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
    'cloudCreateDirectory(current.id, name)',
    'cloudUploadFiles(current.id)',
    'cloudRename(node.id, node.revision, name)',
    'onRenameItem={renameItem}',
    'cloudDownload(node.id, node.name)',
    'getItemMenuItems={getItemMenuItems}',
    'backgroundMenuItems={backgroundMenuItems}',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop Explorer operation: ${token}`)
  }
  assert.ok(app.includes('xDriveFileExplorerDeleteOperationPlan([node])'), 'Desktop single delete must use the shared delete plan')
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop delete action must enqueue a persistent operation')
})

test('Desktop FileExplorer provides system-style navigation, search, and persistent view mode', () => {
  for (const token of [
    'useXDriveFileExplorerWorkspace<AgentCloudNode, AgentCloudSearchResult>({',
    'canGoBack={canGoBack}',
    'canGoForward={canGoForward}',
    'canGoUp={canGoUp}',
    'onPathSubmit',
    'onCrumbClick',
    'loadSearchPage: async (query, cursor) =>',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop Explorer navigation/search contract: ${token}`)
  }
  assert.ok(controller.includes("replace(/\\\\/g, '/')"), 'shared path controller should accept Windows separators')
  assert.equal(explorer.includes('xDriveFileExplorerSubmitPath({'), false, 'Desktop Explorer should delegate typed-path submission to the shared workspace controller')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudRoot()'), 'Desktop typed-path submission should keep Agent root loading local')
  assert.equal(explorer.includes('xDriveResolveFileExplorerPath({'), false, 'Desktop must not orchestrate typed-path traversal locally')
  assert.equal(explorer.includes('xDriveFileExplorerDispatchOpenItem({'), false, 'Desktop open-item dispatch should stay inside the shared workspace controller')
  assert.ok(explorer.includes('searchCrumbsForResult: (result) => result.crumbs'), 'Desktop shared workspace should preserve search crumbs')
  assert.ok(explorer.includes('openWorkspaceItem(item, openLocalNode)'), 'Desktop shared workspace should keep native open local')
  assert.ok(workspaceController.includes('navigate: navigation.navigateTo'), 'shared workspace should dispatch search-directory navigation through shared navigation')
  assert.ok(explorer.includes('viewModeStorageKey: DESKTOP_FILE_VIEW_KEY'), 'Desktop Explorer should pass its view-mode storage key to the shared controller')
  assert.ok(explorer.includes('pathValue={pathValue}'), 'Desktop Explorer path display must come from shared navigation')
  assert.ok(explorer.includes('navigateToCrumb(index)'), 'Desktop breadcrumb clicks must use shared navigation')
  assert.ok(explorer.includes('onRefresh={refresh}'), 'Desktop Explorer refresh must use shared navigation')
  assert.ok(explorer.includes('onRefresh: refresh'), 'Desktop background refresh must use shared navigation')
  assert.ok(navigation.includes('window.localStorage.setItem(viewModeStorageKey, viewMode)'), 'shared Explorer controller should persist Details/Grid mode')
})

test('Desktop FileExplorer paginates server search results through Agent cursors', () => {
  assert.ok(explorer.includes('useXDriveFileExplorerWorkspace<AgentCloudNode, AgentCloudSearchResult>'), 'Desktop search lifecycle must come from the shared workspace controller')
  assert.ok(explorer.includes('onSearchValueChange={changeSearchValue}'), 'Desktop search draft must come from the shared React controller')
  assert.equal(explorer.includes('const [searchValue, setSearchValue] = useState'), false, 'Desktop must not own search draft state')
  assert.equal(explorer.includes("setSearchValue('')"), false, 'Desktop navigation must not clear search draft separately')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudSearch(query, cursor)'), 'Desktop search controller must keep Agent cursor execution local')
  assert.ok(explorer.includes('hasMore={explorerPagination.hasMore}'), 'Desktop Explorer hasMore must use shared pagination presentation')
  assert.ok(explorer.includes('loadingMore={explorerPagination.loadingMore}'), 'Desktop Explorer loadingMore must use shared pagination presentation')
  assert.ok(workspaceController.includes('xDriveFileExplorerPaginationController({'), 'shared workspace must own search/directory pagination dispatch')
  assert.ok(explorer.includes('onLoadMore={explorerPagination.onLoadMore}'), 'Desktop Explorer load-more must use shared pagination dispatch')
  assert.equal(explorer.includes("explorerPagination.mode === 'search'"), false, 'Desktop must not branch search/directory pagination locally')
  assert.equal(explorer.includes('searchRequestRef'), false, 'Desktop must not own search request sequencing')
  assert.equal(explorer.includes('setSearchState('), false, 'Desktop must not own search lifecycle transitions')
  assert.equal(explorer.includes('最多显示 200 个结果'), false, 'Desktop search must not truncate the UI to one page')
})

test('Desktop cloud capacity and CAS intelligence live in the shared Cloud Storage workspace', () => {
  assert.equal(filesPage.includes('CAS 存储情报'), false, 'CAS intelligence must not occupy the Files workspace')
  assert.equal(localStoragePage.includes('CAS 存储情报'), false, 'CAS intelligence must not occupy local storage')
  assert.ok(cloudStoragePage.includes('title="云端存储"'), 'shared Cloud Storage workspace is missing its title')
  assert.ok(cloudStoragePage.includes('云端容量'), 'shared Cloud Storage workspace is missing cloud capacity metrics')
  assert.ok(cloudStoragePage.includes('CAS 存储情报'), 'shared Cloud Storage workspace is missing CAS intelligence')
  assert.ok(app.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Desktop must render the shared Cloud Storage workspace')
})

test('Desktop Cloud Storage adapter owns cloud quota and storage intelligence refresh', () => {
  assert.ok(app.includes('const cloudStorageSource = useMemo<XDriveCloudStorageDataSource>'), 'Desktop is missing the shared Cloud Storage adapter')
  assert.ok(app.includes("window.xdriveDesktop.agent.cloudQuota()"), 'Cloud Storage adapter should retrieve cloud quota')
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudStorageStats()'), 'Cloud Storage adapter should retrieve CAS storage intelligence when supported')
})

test('Desktop Files home load does not fetch CAS storage intelligence', () => {
  const start = app.indexOf('const loadCloudHome = async () => {')
  const end = app.indexOf('const openCloudTrash = () =>', start)
  assert.ok(start >= 0 && end > start, 'loadCloudHome boundaries are missing')
  const body = app.slice(start, end)
  assert.ok(body.includes('cloudRoot()'), 'Files home should still load the cloud root')
  assert.ok(body.includes('cloudQuota()'), 'Files home should still load quota for sidebar/over-quota status')
  assert.equal(body.includes('cloudStorageStats()'), false, 'Files home must not fetch storage intelligence')
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
  assert.ok(explorer.includes('canPaste={fileOperationCanPaste}'), 'Desktop paste availability must come from the shared operation controller')
  assert.ok(explorer.includes('onCopyItems={copyItems}'), 'Desktop shared copy adapter is missing')
  assert.ok(explorer.includes('onCutItems={cutItems}'), 'Desktop shared cut adapter is missing')
  assert.ok(explorer.includes('onPaste={() => { void pasteClipboard() }}'), 'Desktop shared paste adapter is missing')
  assert.ok(operationController.includes("await runPlan('paste', plan"), 'shared controller must execute paste plans')
  assert.equal(explorer.includes('const plan = planPaste(current.id)'), false, 'Desktop must not execute paste planning locally')
})

test('Desktop FileExplorer supports bulk download and delete', () => {
  assert.ok(explorer.includes('async function downloadSelected(selected: XDriveFileExplorerItem[]) {'), 'Desktop bulk download helper is missing')
  assert.ok(explorer.includes('xDriveFileExplorerDownloadPlan(nodes)'), 'Desktop bulk download must use shared download planning')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudDownloadFiles(plan.items)'), 'Desktop bulk download bridge is missing')
  assert.ok(explorer.includes('onDownloadItems={(selected) => { void downloadSelected(selected) }}'), 'Desktop shared bulk download adapter is missing')
  assert.ok(explorer.includes('onDeleteMany(nodes)'), 'Desktop shared bulk delete adapter is missing')
  assert.ok(app.includes('const removeCloudNodes = (nodes: AgentCloudNode[]) => {'), 'Desktop bulk delete confirmation flow is missing')
  assert.ok(app.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'Desktop bulk delete must use the shared delete plan')
  assert.ok(app.includes('plan.operation,\n            plan.items,'), 'Desktop bulk delete must enqueue one persistent file operation')
  assert.ok(app.includes('rememberCloudFileOperation(result.data)'), 'Desktop bulk delete must seed task state immediately')
})


test('Desktop single-item delete queues the same persistent delete operation as bulk delete', () => {
  const start = app.indexOf('const removeCloudNode = (node: AgentCloudNode) => {')
  const end = app.indexOf('\n  const removeCloudNodes =', start)
  assert.ok(start >= 0 && end > start, 'Desktop single-delete handler boundaries are missing')
  const body = app.slice(start, end)
  assert.ok(body.includes('xDriveFileExplorerDeleteOperationPlan([node])'), 'Desktop single delete must use the shared delete plan')
  assert.ok(body.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop single delete must enqueue a persistent operation')
  assert.ok(body.includes('rememberCloudFileOperation(result.data)'), 'Desktop single delete must seed Task Center state immediately')
  assert.ok(body.includes('setNotice(plan.message)'), 'Desktop single delete must use queued-operation feedback')
  assert.equal(body.includes('cloudDelete('), false, 'Desktop single delete must not bypass Task Center through the legacy synchronous IPC')
  assert.equal(body.includes('refreshCloudQuota()'), false, 'Desktop single delete must rely on terminal operation quota refresh')
  assert.equal(body.includes('loadCloudDirectory('), false, 'Desktop single delete must rely on terminal operation directory refresh')
})

test('Desktop FileExplorer supports shared internal drag operations and local external uploads', () => {
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop internal drag/drop must use the shared operation controller')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsPlan('), 'shared operation controller must own folder-drop planning')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsToParentPlan('), 'shared operation controller must own breadcrumb-drop planning')
  assert.equal(explorer.includes('xDriveFileExplorerDropItemsPlan('), false, 'Desktop must not plan internal drag/drop locally')
  assert.equal(explorer.includes('const targetNode = nodeByID.get(Number(target.id))'), false, 'Desktop internal drag must not resolve drop targets locally')
  assert.ok(explorer.includes('xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)'), 'Desktop external drop should resolve the target through shared controller logic')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)'), 'Desktop external drop upload bridge is missing')
  assert.ok(explorer.includes('onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}'), 'Desktop external drop is not wired to shared FileExplorer')
})

test('Desktop uses a dedicated persistent FileExplorer details-column layout', () => {
  assert.ok(explorer.includes("const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'"), 'Desktop details layout storage key is missing')
  assert.ok(explorer.includes('detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}'), 'Desktop details layout key is not passed to shared FileExplorer')
})

test('Desktop FileExplorer supplies preview/properties metadata through existing protected thumbnail APIs', () => {
  assert.ok(projection.includes("path: result?.path || [...crumbs.map((crumb) => crumb.name), node.name].join('/')"), 'shared Explorer projection path metadata is missing')
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

test('Desktop FileExplorer uses cursor-paged server sorting for cloud directories', () => {
  assert.equal(app.includes('DEFAULT_DESKTOP_FILE_SORT'), false, 'Desktop must not own a local default file sort')
  assert.ok(app.includes('XDRIVE_FILE_EXPLORER_DEFAULT_SORT'), 'Desktop initial directory loads must use the shared default sort')
  assert.ok(controller.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200'), 'Desktop page-size contract must remain in the shared controller')
  assert.equal((app.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 3, 'Desktop must use shared request-option construction for all directory page requests')
  assert.ok(app.includes('const loadMoreCloudDirectory = async (id: number, sort: XDriveFileExplorerSort) => {'), 'Desktop incremental directory loader is missing')
  assert.ok(app.includes('xDriveFileExplorerCanLoadMore(pageState, id, sort, cloudLoadingMore)'), 'Desktop pagination eligibility must use the shared controller')
  assert.ok(controller.includes('xDriveFileExplorerDirectoryPageTransition'), 'shared controller must own directory page transitions')
  assert.ok(app.includes('xDriveFileExplorerDirectoryPageTransition(id, result.data, sort, false)'), 'Desktop first directory page must use the shared transition')
  assert.ok(app.includes('xDriveFileExplorerDirectoryPageTransition(id, result.data, sort, true)'), 'Desktop incremental directory page must use the shared transition')
  assert.ok(app.includes('window.xdriveDesktop.agent.cloudChildrenPage(\n        id,\n        xDriveFileExplorerPageRequestOptions(sort),'), 'Desktop directory browsing should use the paged Agent API with shared request options')
  assert.equal(app.includes('xDriveFileExplorerMergePageItems(currentItems, result.data.items)'), false, 'Desktop must not duplicate page merge semantics')
  assert.equal(app.includes('xDriveFileExplorerPageStateFromResult('), false, 'Desktop must not duplicate directory page-state derivation')
  assert.ok(explorer.includes('externallySorted={externallySorted}'), 'Desktop directory pages should consume shared workspace sorting state')
  assert.ok(explorer.includes('onSortChange={changeSort}'), 'Desktop sort changes should reload server-sorted pages')
  assert.ok(workspaceController.includes('xDriveFileExplorerPaginationController({'), 'shared workspace must own Desktop Explorer pagination dispatch')
  assert.ok(explorer.includes('onLoadMoreDirectory: onLoadMore'), 'Desktop Explorer must inject directory load-more into the shared workspace controller')
  assert.ok(explorer.includes('onLoadMore={explorerPagination.onLoadMore}'), 'Desktop Explorer must wire shared pagination dispatch near the scroll boundary')
})

test('Desktop multi-select mutations use persistent operations instead of renderer-side batch execution', () => {
  assert.ok(app.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'Desktop bulk delete must queue one shared delete plan')
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<AgentCloudNode, AgentCloudFileOperation>'), 'Desktop paste/drop must use one shared queued-operation controller')
  assert.ok(explorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop must keep queued-operation transport local')
  assert.ok(operationController.includes('planPaste(currentID)'), 'shared controller must preserve clipboard operation type for paste')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsPlan('), 'shared controller must preserve copy/move operation type for drag/drop')
  assert.equal(app.includes('for (const node of nodes) {\n            const result = await window.xdriveDesktop.agent.cloudDelete'), false, 'Desktop bulk delete must not regress to N requests')
})


test('Desktop upload conflicts use the shared upload controller with capability-gated transports', () => {
  for (const token of [
    'useXDriveFileExplorerUploadController<File>({',
    'continueOnUploadError: true',
    'window.xdriveDesktop.agent.cloudUploadPreflight(parentID, file.name)',
    'window.xdriveDesktop.agent.cloudUploadFile(',
    'const result = await runUploadTargets(targets, busyState)',
    '<XDriveUploadConflictDialog {...uploadConflictDialogProps}',
    'uploadConflictSupported',
    'cloudUploadFiles(current.id)',
    'cloudUploadDroppedFiles(parentID, files)',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop shared upload-controller wiring: ${token}`)
  }
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
    "setActionBusy('download-archive')",
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
    'window.xdriveDesktop.agent.cloudChildren(id)',
    "'upload-folder'",
    'onUploadFolder={uploadConflictSupported',
    '正在上传文件夹…',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop folder-upload support: ${token}`)
  }
})


test('Desktop FileExplorer recursively uploads dropped folders through shared payloads', () => {
  for (const token of [
    'XDriveFileExplorerExternalDropPayload',
    'dropExternalFolderEntriesToParent',
    'payload.files',
    'payload.directories',
    'onExternalFolderDrop={uploadConflictSupported',
    'onExternalFolderDropToCrumb={uploadConflictSupported',
  ]) {
    assert.ok(explorer.includes(token), `missing Desktop dropped-folder support: ${token}`)
  }
})
