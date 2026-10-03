const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
const explorer = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
const projection = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerProjection.ts'), 'utf8')
const navigation = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts'), 'utf8')
const api = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'api.ts'), 'utf8')
const controller = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'file-explorer-controller.ts'), 'utf8')

test('Web files workspace consumes the shared FileExplorer instead of a bespoke table', () => {
  assert.ok(app.includes('<WebFileExplorer'), 'Web files workspace did not migrate to its Explorer adapter')
  assert.ok(explorer.includes('<XDriveFileExplorer'), 'Web adapter does not consume the shared FileExplorer')
  assert.equal(app.includes('className="file-toolbar"'), false, 'legacy Web file toolbar remains')
  assert.equal(app.includes('<Table size="small" aria-label="文件列表">'), false, 'legacy Web file table remains')
})

test('Web FileExplorer navigation matches system explorer behavior', () => {
  for (const token of [
    'useXDriveFileExplorerNavigation({',
    'canGoBack={canGoBack}',
    'canGoForward={canGoForward}',
    'canGoUp={canGoUp}',
    'onPathSubmit',
    'onCrumbClick',
  ]) {
    assert.ok(explorer.includes(token), `missing Web Explorer navigation contract: ${token}`)
  }
  assert.ok(controller.includes("replace(/\\\\/g, '/')"), 'shared path controller should accept Windows-style separators')
  assert.ok(explorer.includes('xDriveFileExplorerSubmitPath({'), 'Web Explorer should delegate typed-path submission to the shared controller')
  assert.ok(explorer.includes('loadRoot: () => api.root()'), 'Web typed-path submission should keep REST root loading local')
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
  assert.ok(explorer.includes('loadPage: (query, cursor) => api.search('), 'Web Explorer must execute search through the shared React controller adapter')
  for (const token of [
    'api.download(node)',
    'onShare(node)',
    'onHistory(node)',
    'onRename(node)',
    'onRemove(node)',
    'onUploadFiles(event.target.files)',
  ]) {
    assert.ok(explorer.includes(token), `missing real Web Explorer operation: ${token}`)
  }
  assert.ok(explorer.includes('getItemMenuItems={getItemMenuItems}'), 'Web Explorer item context menu is not wired')
  assert.ok(explorer.includes('backgroundMenuItems={backgroundMenuItems}'), 'Web Explorer background context menu is not wired')
})

test('Web FileExplorer search results preserve paths, breadcrumbs, and cursor pagination', () => {
  assert.ok(projection.includes('secondaryLabel: result?.path || undefined'), 'shared Explorer projection should show search-result paths')
  assert.ok(explorer.includes('xDriveFileExplorerOpenItemPlan('), 'opening a search result should use shared open-item planning')
  assert.ok(explorer.includes('searchByID.get(node.id)?.breadcrumbs'), 'Web open-item planning should preserve search breadcrumbs')
  assert.ok(explorer.includes('await navigateTo(plan.crumbs)'), 'opening a search directory should navigate with shared planned crumbs')
  assert.ok(explorer.includes('useXDriveFileExplorerSearch<SearchResult>'), 'Web search lifecycle must come from the shared React controller')
  assert.ok(explorer.includes('onSearchValueChange={changeSearchValue}'), 'Web search draft must come from the shared React controller')
  assert.equal(explorer.includes('const [searchValue, setSearchValue] = useState'), false, 'Web must not own search draft state')
  assert.ok(explorer.includes('loadPage: (query, cursor) => api.search('), 'Web search controller must keep REST execution local')
  assert.ok(explorer.includes('XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE'), 'Web search controller must preserve the shared page size')
  assert.ok(explorer.includes('hasMore={explorerPagination.hasMore}'), 'Web Explorer hasMore must use shared pagination presentation')
  assert.ok(explorer.includes("explorerPagination.mode === 'search'"), 'Web search load-more must remain wired through shared pagination presentation')
  assert.equal(explorer.includes('searchRequestRef'), false, 'Web must not own search request sequencing')
  assert.equal(explorer.includes('setSearchState('), false, 'Web must not own search lifecycle transitions')
  assert.equal(explorer.includes('仅显示前 200 个结果'), false, 'Web search must not truncate the UI to the first page')
})

test('Web FileExplorer queues copy/cut/paste as persistent file operations', () => {
  assert.ok(api.includes('copy(nodeID: number, parentID: number, name?: string)'), 'legacy Web copy API is missing')
  assert.ok(api.includes('move(nodeID: number, revision: number, parentID: number)'), 'legacy Web move API is missing')
  assert.ok(explorer.includes('useXDriveFileExplorerClipboard<Node>({'), 'Web must use the shared React clipboard controller')
  assert.ok(explorer.includes('const plan = planPaste(current.id)'), 'Web paste must use the shared clipboard plan')
  assert.ok(explorer.includes('completePaste(plan)'), 'Web must clear completed cut state through the shared clipboard controller')
  assert.ok(explorer.includes('canPaste={canPaste(clipboardBusy)}'), 'Web paste availability must use the shared clipboard controller')
  assert.ok(explorer.includes('api.createFileOperation(plan.operation, plan.items, plan.parentID)'), 'copy/cut paste must execute the shared persistent-operation plan')
  assert.ok(explorer.includes('onOperationQueued(queued)'), 'Web Explorer must surface the newly queued operation immediately')
  assert.ok(explorer.includes('onCopyItems={copyItems}'), 'Web shared copy adapter is missing')
  assert.ok(explorer.includes('onCutItems={cutItems}'), 'Web shared cut adapter is missing')
  assert.ok(explorer.includes('onPaste={() => { void pasteClipboard() }}'), 'Web shared paste adapter is missing')
})

test('Web FileExplorer supports bulk download and delete', () => {
  assert.ok(explorer.includes('const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {'), 'Web bulk download helper is missing')
  assert.ok(explorer.includes('xDriveFileExplorerDownloadPlan(nodes)'), 'Web bulk download must use shared download planning')
  assert.ok(explorer.includes('for (const node of plan.files) await api.download(node)'), 'Web bulk download must use authenticated downloads')
  assert.ok(explorer.includes('onDownloadItems={(selected) => { void downloadSelected(selected) }}'), 'Web shared bulk download adapter is missing')
  assert.ok(explorer.includes('onRemoveMany(nodes)'), 'Web shared bulk delete adapter is missing')
  assert.ok(app.includes('const removeMany = (nodes: Node[]) => {'), 'Web bulk delete confirmation flow is missing')
  assert.ok(app.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'Web bulk delete must use the shared delete plan')
  assert.ok(app.includes('api.createFileOperation(plan.operation, plan.items)'), 'Web bulk delete must enqueue a persistent operation')
  assert.ok(app.includes('rememberFileOperation(operation)'), 'Web bulk delete must seed task state immediately')
})


test('Web single-item delete queues the same persistent delete operation as bulk delete', () => {
  const start = app.indexOf('const remove = (node: Node) => {')
  const end = app.indexOf('\n  const rememberFileOperation =', start)
  assert.ok(start >= 0 && end > start, 'Web single-delete handler boundaries are missing')
  const body = app.slice(start, end)
  assert.ok(body.includes('xDriveFileExplorerDeleteOperationPlan([node])'), 'Web single delete must use the shared delete plan')
  assert.ok(body.includes('api.createFileOperation(plan.operation, plan.items)'), 'Web single delete must enqueue a persistent operation')
  assert.ok(body.includes('rememberFileOperation(operation)'), 'Web single delete must seed Task Center state immediately')
  assert.ok(body.includes("setFeedback({ tone: 'good', message: plan.message })"), 'Web single delete must use queued-operation feedback')
  assert.equal(body.includes('api.remove('), false, 'Web single delete must not bypass Task Center through the legacy synchronous API')
  assert.equal(body.includes('loadDirectory('), false, 'Web single delete must rely on terminal operation refresh instead of refreshing early')
  assert.equal(body.includes('refreshQuota()'), false, 'Web single delete must rely on terminal operation quota refresh')
})

test('Web FileExplorer supports internal and external drag and drop', () => {
  assert.ok(explorer.includes('const dropItemsToFolder = async ('), 'Web internal drag/drop helper is missing')
  assert.ok(explorer.includes('xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)'), 'internal drag should use the shared drop-item plan')
  assert.equal(explorer.includes('const targetNode = nodeByID.get(Number(target.id))'), false, 'Web internal drag must not resolve drop targets locally')
  assert.ok(explorer.includes('const dropExternalFiles = async (files: File[], target?: XDriveFileExplorerItem) => {'), 'Web external drop helper is missing')
  assert.ok(explorer.includes('xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)'), 'Web external drop should resolve the target through shared controller logic')
  assert.ok(explorer.includes('onUploadDroppedFiles(parentID, files)'), 'Web external drop should use the target-aware upload adapter')
  assert.ok(app.includes('const uploadFilesTo = async (parentID: number, files: File[]) => {'), 'Web target-aware upload helper is missing')
  assert.ok(app.includes('onUploadDroppedFiles={uploadFilesTo}'), 'Web dropped-file upload adapter is not wired')
})

test('Web uses a dedicated persistent FileExplorer details-column layout', () => {
  assert.ok(explorer.includes("const FILE_DETAILS_LAYOUT_KEY = 'xdrive.files.details_layout'"), 'Web details layout storage key is missing')
  assert.ok(explorer.includes('detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}'), 'Web details layout key is not passed to shared FileExplorer')
})

test('Web FileExplorer supplies preview/properties metadata without a new plaintext preview channel', () => {
  assert.ok(projection.includes("path: result?.path || [...crumbs.map((crumb) => crumb.name), node.name].join('/')"), 'shared Explorer projection path metadata is missing')
  assert.ok(projection.includes('revision: node.revision'), 'shared Explorer projection revision metadata is missing')
  assert.ok(explorer.includes('loadThumbnail={loadThumbnail}'), 'Web inspector should reuse the protected thumbnail loader')
  assert.equal(api.includes('previewPlaintext'), false, 'Web must not add a plaintext preview API')
})

test('Web FileExplorer uses cursor-paged server sorting for directory browsing', () => {
  assert.equal(app.includes('DEFAULT_FILE_SORT'), false, 'Web must not own a local default file sort')
  assert.ok(app.includes('XDRIVE_FILE_EXPLORER_DEFAULT_SORT'), 'Web initial directory loads must use the shared default sort')
  assert.ok(api.includes('export interface ChildrenPage {'), 'Web children page contract is missing')
  assert.ok(api.includes('listPage(parentID: number, options: ChildrenOptions = {})'), 'Web paged children API is missing')
  assert.ok(controller.includes('XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200'), 'Web directory page size must remain in the shared controller')
  assert.equal((app.match(/xDriveFileExplorerPageRequestOptions\(/g) || []).length, 3, 'Web must use shared request-option construction for all directory page requests')
  assert.ok(app.includes('const loadMoreDirectory = async (id: number, sort: XDriveFileExplorerSort) => {'), 'Web incremental directory loader is missing')
  assert.ok(app.includes('xDriveFileExplorerCanLoadMore(pageState, id, sort, loadingMore)'), 'Web pagination eligibility must use the shared controller')
  assert.ok(controller.includes('xDriveFileExplorerDirectoryPageTransition'), 'shared controller must own directory page transitions')
  assert.ok(app.includes('xDriveFileExplorerDirectoryPageTransition(id, page, sort, false)'), 'Web first directory page must use the shared transition')
  assert.ok(app.includes('xDriveFileExplorerDirectoryPageTransition(id, page, sort, true)'), 'Web incremental directory page must use the shared transition')
  assert.equal(app.includes('xDriveFileExplorerMergePageItems(currentItems, page.items)'), false, 'Web must not duplicate page merge semantics')
  assert.equal(app.includes('xDriveFileExplorerPageStateFromResult('), false, 'Web must not duplicate directory page-state derivation')
  assert.ok(explorer.includes('externallySorted={!searchResults}'), 'Web directory pages should preserve server ordering')
  assert.ok(explorer.includes('onSortChange={changeSort}'), 'Web sort changes should reload server-sorted pages')
  assert.ok(explorer.includes('onLoadMore(current.id, sort)'), 'Web Explorer must request the next page near the scroll boundary')
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
    'createFileOperation(type: XDriveFileOperationType, items: BatchNodeRef[], parentID?: number)',
    "'/api/v1/file-operations'",
    'fileOperations(limit = 100)',
    'cancelFileOperation(id: string)',
    'retryFileOperation(id: string)',
  ]) {
    assert.ok(api.includes(token), `missing Web persistent-operation contract: ${token}`)
  }
  assert.ok(app.includes('api.createFileOperation(plan.operation, plan.items)'), 'Web bulk delete must queue one operation')
  assert.ok(explorer.includes('const plan = planPaste(current.id)'), 'Web paste must use the shared clipboard controller')
  assert.ok(explorer.includes('xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)'), 'Web drag/drop must use one shared drop-item plan')
  assert.equal(app.includes('for (const node of nodes) await api.remove(node.id, node.revision)'), false, 'Web bulk delete must not regress to N requests')
})
