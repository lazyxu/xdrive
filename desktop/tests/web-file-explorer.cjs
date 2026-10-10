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
    'useXDriveFileExplorerWorkspace<Node, WebSearchResult>({',
    'canGoBack={!trashActive && canGoBack}',
    'canGoForward={!trashActive && canGoForward}',
    'canGoUp={!trashActive && canGoUp}',
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
  assert.ok(explorer.includes("pathValue={trashActive ? '回收站' : pathValue}"), 'Web Explorer path display must come from shared navigation')
  assert.ok(explorer.includes('navigateToCrumb(index)'), 'Web breadcrumb clicks must use shared navigation')
  assert.ok(explorer.includes("onRefresh={trashActive ? () => { void trash.refresh() } : refresh}"), 'Web Explorer refresh must use shared navigation')
  assert.ok(explorer.includes('onRefresh: refresh'), 'Web background refresh must use shared navigation')
  assert.ok(navigation.includes('window.localStorage.setItem(viewModeStorageKey, viewMode)'), 'shared Explorer controller should persist Details/Grid mode')
})

test('Web FileExplorer uses real file operations and server search', () => {
  assert.ok(api.includes("return this.request<SearchPage>(\`/api/v1/search?\${params.toString()}\`)"), 'Web API search is not wired to the server search endpoint')
  assert.ok(explorer.includes('loadSearchRange: async (query, filters, searchGrouping, searchSort, offset, limit) =>'), 'Web Explorer must execute Search ranges through the shared workspace controller adapter')
  for (const token of [
    'browseContextForItem(item)',
    'await api.download(plan.file)',
    'await api.downloadArchive(plan.ids, plan.filename)',
    'onShare(node)',
    'onHistory(node)',
    'api.rename(node.id, node.revision, name)',
    'onRenameItem={trashActive ? undefined : renameItem}',
    'onRemove(node)',
    'onUploadFiles(parentID, event.target.files)',
  ]) {
    assert.ok(explorer.includes(token), `missing real Web Explorer operation: ${token}`)
  }
  assert.ok(explorer.includes('getItemMenuItems={trashActive ? trash.getItemMenuItems : getItemMenuItems}'), 'Web Explorer item context menu is not wired')
  assert.ok(explorer.includes('backgroundMenuItems={trashActive ? [] : backgroundMenuItems}'), 'Web Explorer background context menu is not wired')
  assert.ok(explorer.includes('uploadPickerParentIDRef.current = current.id'), 'Web file picker must capture its opening parent')
  assert.ok(explorer.includes('onUpload={trashActive ? undefined : openUploadPicker}'), 'Web FileExplorer must open uploads through the parent-owning picker helper')
  const openStart = explorer.indexOf('const openWebNode = (node: Node, item?: XDriveFileExplorerItem) =>')
  const downloadStart = explorer.indexOf('const downloadSelected = async')
  assert.ok(openStart >= 0 && downloadStart > openStart, 'Web Open/Download adapters are missing')
  assert.equal(explorer.slice(openStart, downloadStart).includes('api.download('), false, 'Web Open must not implicitly download')
})

test('Web FileExplorer Search preserves paths and breadcrumbs across sparse ranges', () => {
  assert.ok(projection.includes('secondaryLabel: resultPath'), 'shared Explorer projection should show search-result paths')
  assert.ok(projection.includes('virtualSearchItems?: ReadonlyMap<number, TSearch>'), 'projection must accept sparse Search result metadata')
  assert.ok(workspaceController.includes('xDriveFileExplorerDispatchOpenItem({'), 'opening a Search result should use shared workspace dispatch')
  assert.ok(explorer.includes('const openWebNode = (node: Node, item?: XDriveFileExplorerItem) => {'), 'opening a Search-result file should keep Web launch execution local')
  assert.ok(explorer.includes('onOpenFile(') && explorer.includes('browseContextForItem(item)'), 'opening a Search-result file should preserve Search context for the Web App Resolver')
  assert.ok(explorer.includes('searchCrumbsForResult: (result) => result.crumbs'), 'Web shared workspace should preserve Search breadcrumbs')
  assert.ok(explorer.includes('useXDriveFileExplorerWorkspace<Node, WebSearchResult>'), 'Web Search lifecycle must come from the shared workspace controller')
  assert.ok(explorer.includes('loadSearchRange: async (query, filters, searchGrouping, searchSort, offset, limit) =>'), 'Web must inject REST Search range execution')
  assert.ok(explorer.includes('api.searchRange('), 'Web Search must use REST range transport')
  assert.ok(explorer.includes('filters,'), 'Web Search range must forward structured filters')
  assert.ok(explorer.includes('<XDriveFileExplorerSearchFilters'), 'Web must render shared structured filter chips')
  assert.ok(explorer.includes('searchSort.key'), 'Web Search range must forward sort key')
  assert.ok(explorer.includes('searchSort.direction'), 'Web Search range must forward sort direction')
  assert.ok(explorer.includes('virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}'), 'Web Search must reuse the shared sparse surface')
  assert.equal(explorer.includes('api.search('), false, 'Web Explorer must not use cursor Search after migration')
  assert.equal(explorer.includes('仅显示前 200 个结果'), false, 'Web Search must not truncate the logical result set')
})

test('Web FileExplorer queues copy/cut/paste through the shared operation controller', () => {
  assert.ok(api.includes('copy(nodeID: number, parentID: number, name?: string)'), 'legacy Web copy API is missing')
  assert.ok(api.includes('move(nodeID: number, revision: number, parentID: number)'), 'legacy Web move API is missing')
  assert.ok(explorer.includes('useXDriveFileExplorerWorkspace<Node, WebSearchResult>'), 'Web must consume clipboard state through the shared workspace controller')
  assert.ok(explorer.includes('useXDriveFileExplorerOperationController<Node, XDriveFileOperation>'), 'Web must consume the shared queued-operation controller')
  assert.ok(explorer.includes('submitOperation: (plan) => api.createFileOperation('), 'Web must keep persistent-operation transport local')
  assert.ok(explorer.includes('onQueued: onOperationQueued'), 'Web must surface queued operations immediately')
  assert.ok(explorer.includes('canPaste={!trashActive && fileOperationCanPaste}'), 'Web paste availability must come from shared operation state')
  assert.ok(explorer.includes('onCopyItems={trashActive ? undefined : copyItems}'), 'Web shared copy adapter is missing')
  assert.ok(explorer.includes('onCutItems={trashActive ? undefined : cutItems}'), 'Web shared cut adapter is missing')
  assert.ok(explorer.includes('onPaste={trashActive ? undefined : (operationOverride) => { void pasteClipboard(operationOverride) }}'), 'Web shared paste adapter is missing')
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
  assert.ok(explorer.includes('onDownloadItems={trashActive ? undefined : (selected) => { void downloadSelected(selected) }}'), 'Web shared bulk download adapter is missing')
  assert.ok(api.includes('downloadArchive(ids: number[], filename: string)'), 'Web archive API is missing')
  assert.ok(api.includes("'/api/v1/download/archive'"), 'Web archive API must use the protected archive endpoint')
  assert.ok(explorer.includes('onRemoveMany(nodes)'), 'Web shared bulk delete adapter is missing')
  assert.ok(app.includes('useXDriveFileExplorerDeleteController<Node, XDriveFileOperation>'), 'Web delete flow must use the shared delete-to-trash controller')
  assert.ok(app.includes('submitOperation: (operation, items) => api.createFileOperation(operation, items)'), 'Web delete controller must keep REST submission local')
  assert.ok(app.includes('onQueued: rememberFilesOperation'), 'Web delete controller must retain the Files trace to its accepted task')
  assert.ok(app.includes('rememberFileOperation(operation)'), 'Web Files trace must still delegate to the existing task lifecycle owner')
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
  assert.ok(projection.includes('path: resultPath || `${pathPrefix}${node.name}`'), 'shared Explorer projection path metadata is missing')
  assert.ok(projection.includes('revision: node.revision'), 'shared Explorer projection revision metadata is missing')
  assert.ok(explorer.includes('loadThumbnail={loadThumbnail}'), 'Web inspector should reuse the protected thumbnail loader')
  assert.equal(api.includes('previewPlaintext'), false, 'Web must not add a plaintext preview API')
})

test('Web FileExplorer uses the shared Cloud Files controller for range-backed server sorting', () => {
  assert.equal(app.includes('DEFAULT_FILE_SORT'), false, 'Web must not own a local default file sort')
  assert.ok(app.includes('XDRIVE_FILE_EXPLORER_DEFAULT_SORT'), 'Web controller wiring must use the shared default sort')
  assert.ok(cloudFilesContract.includes('export type XDriveCloudFilesRange<TNode'), 'shared Cloud Files range contract is missing')
  assert.ok(api.includes('listRange('), 'Web children API must expose range transport')
  assert.ok(api.includes('this.request<XDriveCloudFilesRange<Node>>'), 'Web range result must consume the shared contract')
  assert.ok(controller.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200'), 'directory page size must remain framework-neutral')
  assert.ok(app.includes('useXDriveCloudFilesController<Node, QuotaUsage, XDriveFileExplorerSort>'), 'Web must delegate cloud directory state to the shared controller')
  assert.equal((app.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 0, 'Web App must not compose directory requests locally')
  assert.equal((cloudFilesController.match(/port\.getRange\(/g) || []).length, 3, 'shared Cloud Files controller must own initial, navigation, and viewport range reads')
  assert.equal(cloudFilesController.includes('xDriveFileExplorerCanLoadMore('), false, 'directory browsing must no longer use cursor load-more eligibility')
  assert.equal(cloudFilesController.includes('xDriveFileExplorerDirectoryPageTransition('), false, 'directory browsing must no longer append cursor pages')
  assert.ok(explorer.includes('directoryVirtualCollection: virtualDirectory'), 'Web Explorer must delegate sparse directory state to the shared workspace')
  assert.ok(explorer.includes('virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}'), 'Web Explorer must activate the shared sparse surface')
  assert.ok(explorer.includes('externallySorted={trashActive ? Boolean(trash.virtualCollection) : externallySorted}'), 'Web directory ranges should consume shared workspace sorting state')
  assert.ok(explorer.includes('onSortChange={trashActive ? setTrashSort : changeSort}'), 'Web sort changes should reload server-sorted ranges')
  assert.ok(explorer.includes('grouping={trashActive ? undefined : grouping}'), 'Web grouping must come from shared tab state')
  assert.ok(explorer.includes('onGroupingChange={trashActive ? undefined : changeGrouping}'), 'Web grouping changes must reload Server ranges')
  assert.ok(explorer.includes('searchGrouping,'), 'Web Search must forward grouping to the Server range contract')
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
  assert.ok(operationController.includes('planPaste(currentID, operationOverride)'), 'shared controller must own Web paste planning')
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
    'preflight: (parentID, file, signal) => api.uploadConflictPreflight(parentID, file.name, signal)',
    'preflightBatch: (targets, signal) => api.uploadConflictPreflightBatch(',
    'api.uploadWithConflictPolicy(parentID, file, conflictPolicy, onProgress, transferID, groupID)',
    'fileUploads.runTargets(targets, action)',
    '<XDriveUploadConflictDialog {...fileUploads.dialogProps}',
    'uploadProgress={fileUploads.progress}',
  ]) {
    assert.ok(app.includes(token), `missing Web shared upload-controller wiring: ${token}`)
  }
  assert.ok(api.includes("'/api/v1/uploads/preflight/batch'"), 'Web API must expose batched upload preflight')
  assert.ok(uploadController.includes('loadBatchPreflights'), 'shared upload controller must batch preflight work')
  assert.ok(uploadController.includes('.toLowerCase()'), 'batch duplicate keys must use locale-independent case folding')
  assert.equal(uploadController.includes('.toLocaleLowerCase()'), false, 'batch duplicate keys must not depend on client locale')
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
    'onUploadFolder={trashActive ? undefined : openFolderUploadPicker}',
  ]) {
    assert.ok(explorer.includes(token), `missing Web folder-upload picker: ${token}`)
  }
  for (const token of [
    'xDriveFileExplorerResolveFolderUploadTargets({',
    'xDriveFileExplorerEnsureUploadDirectory({',
    'relativePath: file.webkitRelativePath || file.name',
    'createDirectory: (id, directoryName) => api.createDirectory(id, directoryName)',
    'xDriveFileExplorerCaseInsensitiveNameLookupPageOptions(directoryName)',
    'findExistingDirectory: async (id, directoryName) =>',
    'api.listPage(',
    'fileUploads.runGroup({',
    'itemsTotal: entries.length',
    'bytesTotal: entries.reduce',
    'relativePath,',
    'onUploadFolderFiles={uploadFolderFiles}',
  ]) {
    assert.ok(app.includes(token), `missing Web folder-upload orchestration: ${token}`)
  }
  assert.ok(explorer.includes('folderUploadPickerParentIDRef.current = current.id'), 'Web folder picker must capture its opening parent')
  assert.equal(app.includes('listChildren: (id) => api.list(id)'), false, 'Web folder-upload conflict reuse must not list the whole parent directory')
})


test('Web FileExplorer recursively uploads dropped folders and empty directories', () => {
  for (const token of [
    'XDriveFileExplorerExternalDropPayload',
    'useXDriveFileExplorerExternalDropController<Node, Crumb, XDriveFileExplorerSort>',
    'uploadFolderEntriesToParent: onUploadDroppedFolderEntries',
    'onExternalFolderDrop={trashActive ? undefined : (payload, target) =>',
    'onExternalFolderDropToCrumb={trashActive ? undefined : (payload, crumb) =>',
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


test('Web Search range normalizes server breadcrumbs into the shared crumbs contract', () => {
  assert.ok(api.includes('async searchRange('), 'Web Search range adapter must normalize the raw server response')
  assert.ok(api.includes('crumbs: item.breadcrumbs'), 'Web Search range must normalize breadcrumbs to shared crumbs')
  assert.ok(explorer.includes('type WebSearchResult = XDriveCloudFilesSearchResult<Node>'), 'Web Explorer must consume the shared Search result contract')
  assert.ok(explorer.includes('searchCrumbsForResult: (result) => result.crumbs'), 'Web Explorer must consume normalized shared crumbs')
})


test('Web FileExplorer persists tab sessions in an account-scoped shared navigation key', () => {
  assert.ok(
    explorer.includes('navigationSessionStorageKey?: string') &&
      explorer.includes('navigationSessionStorageKey,'),
    'Web Explorer adapter must pass the optional shared session-storage key',
  )
  assert.ok(
    app.includes('xdrive.files.navigation_session.v1:') &&
      app.includes('encodeURIComponent(username)'),
    'Web session persistence must be scoped by username inside the current Server origin',
  )
  assert.ok(
    workspaceController.includes('navigationSessionStorageKey,'),
    'Web and Desktop must share the same session-restore implementation',
  )
})


test('Web media Details columns use the bounded batch endpoint only through the shared loader', () => {
  assert.ok(api.includes("'/api/v1/nodes/media-details'"), 'Web media-details endpoint is missing')
  assert.ok(api.includes('signal,'), 'Web media-details request must accept AbortSignal')
  assert.ok(explorer.includes('loadMediaDetails={loadMediaDetails}'), 'Web media-details loader is not wired to shared FileExplorer')
  assert.ok(explorer.includes('api.fileMediaDetails(refs, signal)'), 'Web media-details transport must stay adapter-local')
})
