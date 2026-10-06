const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
const explorer = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
const projection = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts'), 'utf8')
const navigation = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts'), 'utf8')
const workspaceController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts'), 'utf8')
const operationController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerOperationController.ts'), 'utf8')
const deleteController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerDeleteController.ts'), 'utf8')
const api = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'api.ts'), 'utf8')
const uploadConflicts = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'upload-conflicts.ts'), 'utf8')
const uploadController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerUploadController.ts'), 'utf8')
const controller = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')
const cloudFilesContract = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'cloud-files.ts'), 'utf8')
const cloudFilesController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudFilesController.ts'), 'utf8')

test('Web files workspace consumes the shared FileExplorer instead of a bespoke table', () => {
  assert.ok(app.includes('<WebFileExplorer'), 'Web files workspace did not migrate to its Explorer adapter')
  assert.ok(explorer.includes('<XDriveFileExplorer'), 'Web adapter does not consume the shared FileExplorer')
  assert.equal(app.includes('className="file-toolbar"'), false, 'legacy Web file toolbar remains')
  assert.equal(app.includes('<Table size="small" aria-label="文件列表">'), false, 'legacy Web file table remains')
})

test('Web FileExplorer navigation matches system explorer behavior', () => {
  for (const token of [
    'useXDriveFileExplorerWorkspace<Node, SearchResult>({',
    'canGoBack={canGoBack}',
    'canGoForward={canGoForward}',
    'canGoUp={canGoUp}',
    'onPathSubmit',
    'onCrumbClick',
  ]) {
    assert.ok(explorer.includes(token), `missing Web Explorer navigation contract: ${token}`)
  }
  assert.ok(controller.includes("replace(/\\\\/g, '/')"), 'shared path controller should accept Windows-style separators')
  assert.equal(explorer.includes('xDriveFileExplorerSubmitPath({'), false, 'Web Explorer should delegate typed-path submission to the shared workspace controller')
  assert.ok(explorer.includes('loadRoot: () => api.root()'), 'Web typed-path submission should keep REST root loading local')
  assert.ok(explorer.includes('findChildDirectory: async (parentID, name) =>'), 'Web typed-path traversal should use exact child lookup')
  assert.ok(explorer.includes('xDriveFileExplorerPathLookupPageOptions(name)'), 'Web typed-path traversal should request one indexed child')
  assert.equal(explorer.includes('xDriveResolveFileExplorerPath({'), false, 'Web must not orchestrate typed-path traversal locally')
  assert.ok(explorer.includes('viewModeStorageKey: FILE_VIEW_KEY'), 'Web Explorer should pass its view-mode storage key to the shared controller')
  assert.ok(explorer.includes('pathValue={pathValue}'), 'Web Explorer path display must come from shared navigation')
  assert.ok(explorer.includes('navigateToCrumb(index)'), 'Web breadcrumb clicks must use shared navigation')
  assert.ok(explorer.includes('onRefresh={refresh}'), 'Web Explorer refresh must use shared navigation')
  assert.ok(explorer.includes('onRefresh: refresh'), 'Web background refresh must use shared navigation')
  assert.ok(navigation.includes('window.localStorage.setItem(viewModeStorageKey, viewMode)'), 'shared Explorer controller should persist Details/Grid mode')
})

test('Web FileExplorer uses real file operations and server search', () => {
  assert.ok(api.includes("return this.request<SearchPage>(\`/api/v1/search?\${params.toString()}\`)"), 'Web API search is not wired to the server search endpoint')
  assert.ok(explorer.includes('loadSearchPage: (query, cursor) => api.search('), 'Web Explorer must execute search through the shared workspace controller adapter')
  for (const token of [
    'api.download(node)',
    'onShare(node)',
    'onHistory(node)',
    'api.rename(node.id, node.revision, name)',
    'onRenameItem={renameItem}',
    'onRemove(node)',
    'onUploadFiles(event.target.files)',
  ]) {
    assert.ok(explorer.includes(token), `missing real Web Explorer operation: ${token}`)
  }
  assert.ok(explorer.includes('getItemMenuItems={getItemMenuItems}'), 'Web Explorer item context menu is not wired')
  assert.ok(explorer.includes('backgroundMenuItems={backgroundMenuItems}'), 'Web Explorer background context menu is not wired')
})

test('Web FileExplorer search results preserve paths, breadcrumbs, and cursor pagination', () => {
  assert.ok(projection.includes('secondaryLabel: resultPath'), 'shared Explorer projection should show search-result paths')
  assert.ok(workspaceController.includes('xDriveFileExplorerDispatchOpenItem({'), 'opening a search result should use shared workspace open-item dispatch')
  assert.ok(explorer.includes('searchCrumbsForResult: (result) => result.breadcrumbs'), 'Web shared workspace should preserve search breadcrumbs')
  assert.ok(workspaceController.includes('navigate: navigation.navigateTo'), 'shared workspace should inject shared navigation for search directories')
  assert.ok(explorer.includes('const openWebNode = async (node: Node) => {'), 'opening a file should keep Web download execution local')
  assert.ok(explorer.includes('useXDriveFileExplorerWorkspace<Node, SearchResult>'), 'Web search lifecycle must come from the shared workspace controller')
  assert.ok(explorer.includes('onSearchValueChange={changeSearchValue}'), 'Web search draft must come from the shared React controller')
  assert.equal(explorer.includes('const [searchValue, setSearchValue] = useState'), false, 'Web must not own search draft state')
  assert.ok(explorer.includes('loadSearchPage: (query, cursor) => api.search('), 'Web workspace controller must keep REST search execution local')
  assert.ok(explorer.includes('XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE'), 'Web search controller must preserve the shared page size')
  assert.ok(explorer.includes('hasMore={explorerPagination.hasMore}'), 'Web Explorer hasMore must use shared pagination presentation')
  assert.ok(workspaceController.includes('xDriveFileExplorerPaginationController({'), 'shared workspace must own Web search/directory pagination dispatch')
  assert.ok(explorer.includes('onLoadMore={explorerPagination.onLoadMore}'), 'Web Explorer load-more must use shared pagination dispatch')
  assert.equal(explorer.includes("explorerPagination.mode === 'search'"), false, 'Web must not branch search/directory pagination locally')
  assert.equal(explorer.includes('searchRequestRef'), false, 'Web must not own search request sequencing')
  assert.equal(explorer.includes('setSearchState('), false, 'Web must not own search lifecycle transitions')
  assert.equal(explorer.includes('仅显示前 200 个结果'), false, 'Web search must not truncate the UI to the first page')
})

test('Web FileExplorer queues copy/cut/paste through the shared operation controller', () => {
  assert.ok(api.includes('copy(nodeID: number, parentID: number, name?: string)'), 'legacy Web copy API is missing')
  assert.ok(api.includes('move(nodeID: number, revision: number, parentID: number)'), 'legacy Web move API is missing')
  assert.ok(explorer.includes('useXDriveFileExplorerWorkspace<Node, SearchResult>'), 'Web must consume clipboard state through the shared workspace controller')
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<Node, XDriveFileOperation>'), 'Web must consume the shared queued-operation controller')
  assert.ok(explorer.includes('submitOperation: (plan) => api.createFileOperation('), 'Web must keep persistent-operation transport local')
  assert.ok(explorer.includes('onQueued: onOperationQueued'), 'Web must surface queued operations immediately')
  assert.ok(explorer.includes('canPaste={fileOperationCanPaste}'), 'Web paste availability must come from shared operation state')
  assert.ok(explorer.includes('onCopyItems={copyItems}'), 'Web shared copy adapter is missing')
  assert.ok(explorer.includes('onCutItems={cutItems}'), 'Web shared cut adapter is missing')
  assert.ok(explorer.includes('onPaste={() => { void pasteClipboard() }}'), 'Web shared paste adapter is missing')
  assert.ok(operationController.includes("await runPlan('paste', plan"), 'shared controller must execute Web paste plans')
  assert.equal(explorer.includes('const plan = planPaste(current.id)'), false, 'Web must not execute paste planning locally')
})

test('Web FileExplorer supports file, folder, and mixed-selection download', () => {
  assert.ok(explorer.includes('const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {'), 'Web download helper is missing')
  assert.ok(explorer.includes('xDriveFileExplorerWebDownloadPlan(nodes)'), 'Web download must use shared Web download planning')
  assert.ok(explorer.includes("if (plan.kind === 'file')"), 'single Web file download must remain direct')
  assert.ok(explorer.includes('await api.download(plan.file)'), 'single Web file must use authenticated direct download')
  assert.ok(explorer.includes('await api.downloadArchive(plan.ids, plan.filename)'), 'folder/mixed Web download must use the archive endpoint')
  assert.ok(explorer.includes('onDownload: () => { void downloadSelected([item]) }'), 'folder context-menu download must use the shared download flow')
  assert.ok(explorer.includes('onDownloadItems={(selected) => { void downloadSelected(selected) }}'), 'Web shared bulk download adapter is missing')
  assert.ok(api.includes('downloadArchive(ids: number[], filename: string)'), 'Web archive API is missing')
  assert.ok(api.includes("'/api/v1/download/archive'"), 'Web archive API must use the protected archive endpoint')
  assert.ok(explorer.includes('onRemoveMany(nodes)'), 'Web shared bulk delete adapter is missing')
  assert.ok(app.includes('useXDriveFileExplorerDeleteController<Node, XDriveFileOperation>'), 'Web delete flow must use the shared delete-to-trash controller')
  assert.ok(app.includes('submitOperation: (operation, items) => api.createFileOperation(operation, items)'), 'Web delete controller must keep REST submission local')
  assert.ok(app.includes('onQueued: rememberFileOperation'), 'Web delete controller must seed task state immediately')
  assert.ok(deleteController.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'shared delete controller must own delete planning')
})


test('Web single-item and bulk delete share one delete-to-trash controller', () => {
  assert.ok(deleteController.includes('const remove = useCallback((node: TNode) => {'), 'shared delete controller must expose single-item delete')
  assert.ok(deleteController.includes('requestDelete([node])'), 'single-item delete must reuse the same confirmation and queue path')
  assert.ok(deleteController.includes('removeMany: requestDelete'), 'bulk delete must reuse the same confirmation and queue path')
  assert.equal(app.includes('xDriveFileExplorerDeleteOperationPlan('), false, 'Web App must not plan delete operations locally')
  assert.equal(app.includes('const remove = (node: Node) => {'), false, 'Web App must not keep a local single-delete orchestrator')
  assert.equal(app.includes('const removeMany = (nodes: Node[]) => {'), false, 'Web App must not keep a local bulk-delete orchestrator')
})

test('Web FileExplorer uses shared internal drag operations and local external uploads', () => {
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<Node, XDriveFileOperation>'), 'Web internal drag/drop must use the shared operation controller')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsPlan('), 'shared operation controller must own Web folder-drop planning')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsToParentPlan('), 'shared operation controller must own Web breadcrumb-drop planning')
  assert.equal(explorer.includes('xDriveFileExplorerDropItemsPlan('), false, 'Web must not plan internal drag/drop locally')
  assert.equal(explorer.includes('const targetNode = nodeByID.get(Number(target.id))'), false, 'Web internal drag must not resolve drop targets locally')
  assert.ok(explorer.includes('useXDriveFileExplorerExternalDropController<Node, Crumb, XDriveFileExplorerSort>'), 'Web external drop must use the shared controller')
  assert.ok(explorer.includes('uploadFilesToParent: onUploadDroppedFiles'), 'Web external drop should keep the target-aware upload adapter local')
  assert.ok(explorer.includes('uploadFilesToParent: onUploadDroppedFiles'), 'Web external drop should use the target-aware upload adapter')
  assert.ok(app.includes('const uploadFilesTo = async ('), 'Web target-aware upload helper is missing')
  assert.ok(app.includes("action: 'upload' | 'drop-upload' = 'upload'"), 'Web target-aware upload helper must distinguish dropped uploads')
  assert.ok(app.includes("onUploadDroppedFiles={(parentID, files) => uploadFilesTo(parentID, files, 'drop-upload')}"), 'Web dropped-file upload adapter is not wired')
})

test('Web uses a dedicated persistent FileExplorer details-column layout', () => {
  assert.ok(explorer.includes("const FILE_DETAILS_LAYOUT_KEY = 'xdrive.files.details_layout'"), 'Web details layout storage key is missing')
  assert.ok(explorer.includes('detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}'), 'Web details layout key is not passed to shared FileExplorer')
})

test('Web FileExplorer supplies preview/properties metadata without a new plaintext preview channel', () => {
  assert.ok(projection.includes('path: resultPath || `${crumbProjection.pathPrefix}${node.name}`'), 'shared Explorer projection path metadata is missing')
  assert.ok(projection.includes('revision: node.revision'), 'shared Explorer projection revision metadata is missing')
  assert.ok(explorer.includes('loadThumbnail={loadThumbnail}'), 'Web inspector should reuse the protected thumbnail loader')
  assert.equal(api.includes('previewPlaintext'), false, 'Web must not add a plaintext preview API')
})

test('Web FileExplorer uses the shared Cloud Files controller for cursor-paged server sorting', () => {
  assert.equal(app.includes('DEFAULT_FILE_SORT'), false, 'Web must not own a local default file sort')
  assert.ok(app.includes('XDRIVE_FILE_EXPLORER_DEFAULT_SORT'), 'Web controller wiring must use the shared default sort')
  assert.ok(cloudFilesContract.includes('export type XDriveCloudFilesPage<TNode'), 'shared Cloud Files page contract is missing')
  assert.ok(cloudFilesContract.includes('export type XDriveCloudFilesPageOptions'), 'shared Cloud Files page options are missing')
  assert.ok(api.includes('listPage(parentID: number, options: XDriveCloudFilesPageOptions = {})'), 'Web paged children API must consume the shared contract')
  assert.ok(api.includes('this.request<XDriveCloudFilesPage<Node>>'), 'Web paged children result must consume the shared contract')
  assert.ok(controller.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200'), 'directory page size must remain framework-neutral')
  assert.ok(app.includes('useXDriveCloudFilesController<Node, QuotaUsage, XDriveFileExplorerSort>'), 'Web must delegate cloud directory state to the shared controller')
  assert.equal((app.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 0, 'Web App must not compose directory requests locally')
  assert.equal((cloudFilesController.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 3, 'shared Cloud Files controller must own all directory page requests')
  assert.ok(cloudFilesController.includes('xDriveFileExplorerCanLoadMore(currentPage, id, sort, loadingMore)'), 'shared Cloud Files controller must own pagination eligibility')
  assert.ok(cloudFilesController.includes('xDriveFileExplorerDirectoryPageTransition('), 'shared Cloud Files controller must own directory page transitions')
  assert.equal(app.includes('xDriveFileExplorerMergePageItems(currentItems, page.items)'), false, 'Web must not duplicate page merge semantics')
  assert.equal(app.includes('xDriveFileExplorerPageStateFromResult('), false, 'Web must not duplicate directory page-state derivation')
  assert.ok(explorer.includes('externallySorted={externallySorted}'), 'Web directory pages should consume shared workspace sorting state')
  assert.ok(explorer.includes('onSortChange={changeSort}'), 'Web sort changes should reload server-sorted pages')
  assert.ok(workspaceController.includes('xDriveFileExplorerPaginationController({'), 'shared workspace must own Web Explorer pagination dispatch')
  assert.ok(explorer.includes('onLoadMoreDirectory: onLoadMore'), 'Web Explorer must inject directory load-more into the shared workspace controller')
  assert.ok(explorer.includes('onLoadMore={explorerPagination.onLoadMore}'), 'Web Explorer must wire shared pagination dispatch near the scroll boundary')
})

test('Web multi-select mutations use persistent operations while retaining legacy atomic batch APIs', () => {
  for (const token of [
    "batchCopy(items: BatchNodeRef[], parentID: number)",
    "batchMove(items: BatchNodeRef[], parentID: number)",
    "batchDelete(items: BatchNodeRef[])",
    "'/api/v1/nodes/batch/copy'",
    "'/api/v1/nodes/batch/move'",
    "'/api/v1/nodes/batch/delete'",
  ]) {
    assert.ok(api.includes(token), `legacy Web batch API contract was removed: ${token}`)
  }
  for (const token of [
    'createFileOperation(',
    "conflictPolicy?: XDriveFileOperation['conflict_policy']",
    "'/api/v1/file-operations'",
    'resolveFileOperationConflict(id: string',
    'fileOperations(limit = 100)',
    'cancelFileOperation(id: string)',
    'retryFileOperation(id: string)',
  ]) {
    assert.ok(api.includes(token), `missing Web persistent-operation contract: ${token}`)
  }
  assert.ok(app.includes('useXDriveFileExplorerDeleteController<Node, XDriveFileOperation>'), 'Web bulk delete must use one shared delete controller')
  assert.ok(app.includes('submitOperation: (operation, items) => api.createFileOperation(operation, items)'), 'Web delete must keep queued-operation REST transport local')
  assert.ok(deleteController.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'shared delete controller must queue one delete plan')
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<Node, XDriveFileOperation>'), 'Web paste/drop must use one shared queued-operation controller')
  assert.ok(operationController.includes('planPaste(currentID)'), 'shared controller must own Web paste planning')
  assert.ok(operationController.includes('xDriveFileExplorerDropItemsPlan('), 'shared controller must own Web internal-drop planning')
  assert.equal(app.includes('for (const node of nodes) await api.remove(node.id, node.revision)'), false, 'Web bulk delete must not regress to N requests')
})


test('Web upload API exposes conflict-aware skip/keep-both without changing legacy upload return type', () => {
  for (const token of [
    'XDriveUploadConflictPolicy,',
    'XDriveUploadConflictPreflight,',
    'export interface XDriveUploadResult',
    "status: 'active' | 'finalized' | 'skipped'",
    'uploadWithConflictPolicy(',
    'conflict_policy: conflictPolicy',
    "session.status === 'skipped'",
    'if (!managedExternally) webTransferStore.completeSkipped(activeTransferID, file.size)',
    "skipped: finalized.status === 'skipped'",
    'transferred_bytes: transferredBytes',
  ]) {
    assert.ok(api.includes(token), `missing Web upload conflict contract: ${token}`)
  }
  assert.ok(
    api.includes("async upload(parentID: number, file: File, onProgress?: (percent: number) => void): Promise<Node>"),
    'legacy Web upload API must keep returning Node',
  )
  assert.ok(api.includes("this.uploadWithConflictPolicy(parentID, file, 'fail', onProgress)"), 'legacy upload must delegate to fail policy')
  assert.ok(
    uploadConflicts.includes("XDriveUploadConflictPolicy = 'fail' | 'skip' | 'keep_both'"),
    'upload conflict policy must live in shared',
  )
  assert.ok(
    uploadConflicts.includes('XDriveUploadConflictPreflight'),
    'upload conflict preflight contract must live in shared',
  )
  assert.equal(
    api.includes("export type XDriveUploadConflictPolicy = 'fail' | 'skip' | 'keep_both'"),
    false,
    'Web must not duplicate the shared upload conflict policy',
  )
})


test('Web skipped uploads finish without pretending bytes were transferred', () => {
  const transfers = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'transfers.ts'), 'utf8')
  const sharedTransfers = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'transfers.ts'), 'utf8')
  assert.ok(transfers.includes('completeSkipped(id: string, bytesTotal?: number)'), 'Web transfer store missing skipped completion')
  assert.ok(transfers.includes('bytes_done: 0'), 'skipped upload must preserve zero transferred bytes')
  assert.ok(sharedTransfers.includes("if (task.state === 'completed') return 100"), 'completed skipped transfer should render terminal progress')
})


test('Web upload batches use the shared upload controller before transferring bytes', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
  for (const token of [
    'useXDriveFileExplorerUploadController<File>({',
    'trackProgress: true',
    'preflight: (parentID, file) => api.uploadConflictPreflight(parentID, file.name)',
    'api.uploadWithConflictPolicy(parentID, file, conflictPolicy, onProgress, transferID)',
    'fileUploads.runTargets(targets, action)',
    '<XDriveUploadConflictDialog {...fileUploads.dialogProps}',
    'uploadProgress={fileUploads.progress}',
  ]) {
    assert.ok(app.includes(token), `missing Web shared upload-controller wiring: ${token}`)
  }
  assert.ok(uploadController.includes("if (conflictPolicy === 'skip')"), 'shared upload controller must own skip handling')
  assert.ok(uploadController.includes("if (decision === 'cancel')"), 'shared upload controller must own batch cancellation')
  assert.ok(uploadController.includes('xDriveUploadBatchSummary(result)'), 'shared upload controller must own batch summaries')
  assert.equal(app.includes('useXDriveUploadConflictResolver()'), false, 'Web must not own conflict-resolver lifecycle')
  assert.equal(app.includes("let conflictPolicy: XDriveUploadConflictPolicy = 'fail'"), false, 'Web must not own per-file conflict state')
})


test('Web FileExplorer uploads selected folders with preserved relative paths', () => {
  for (const token of [
    'onUploadFolderFiles',
    'folderUploadInputRef',
    "element.setAttribute('webkitdirectory', '')",
    "element.setAttribute('directory', '')",
    'onUploadFolder={() => folderUploadInputRef.current?.click()}',
  ]) {
    assert.ok(explorer.includes(token), `missing Web folder-upload picker: ${token}`)
  }
  for (const token of [
    'xDriveFileExplorerResolveFolderUploadTargets({',
    'xDriveFileExplorerEnsureUploadDirectory({',
    'relativePath: file.webkitRelativePath || file.name',
    'createDirectory: (id, directoryName) => api.createDirectory(id, directoryName)',
    'listChildren: (id) => api.list(id)',
    'fileUploads.runGroup({',
    'itemsTotal: entries.length',
    'bytesTotal: entries.reduce',
    'relativePath,',
    'onUploadFolderFiles={uploadFolderFiles}',
  ]) {
    assert.ok(app.includes(token), `missing Web folder-upload orchestration: ${token}`)
  }
})


test('Web FileExplorer recursively uploads dropped folders and empty directories', () => {
  for (const token of [
    'XDriveFileExplorerExternalDropPayload',
    'useXDriveFileExplorerExternalDropController<Node, Crumb, XDriveFileExplorerSort>',
    'uploadFolderEntriesToParent: onUploadDroppedFolderEntries',
    'onExternalFolderDrop={(payload, target) =>',
    'onExternalFolderDropToCrumb={(payload, crumb) =>',
  ]) {
    assert.ok(explorer.includes(token), `missing Web dropped-folder wiring: ${token}`)
  }
  for (const token of [
    'uploadDroppedFolderEntries',
    "XDriveFileExplorerExternalDropPayload['files']",
    'payload.files',
    'payload.directories',
    'onUploadDroppedFolderEntries={uploadDroppedFolderEntries}',
  ]) {
    assert.ok(app.includes(token), `missing Web dropped-folder orchestration: ${token}`)
  }
})
