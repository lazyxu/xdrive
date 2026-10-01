const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const app = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
const explorer = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
const api = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'api.ts'), 'utf8')

test('Web files workspace consumes the shared FileExplorer instead of a bespoke table', () => {
  assert.ok(app.includes('<WebFileExplorer'), 'Web files workspace did not migrate to its Explorer adapter')
  assert.ok(explorer.includes('<XDriveFileExplorer'), 'Web adapter does not consume the shared FileExplorer')
  assert.equal(app.includes('className="file-toolbar"'), false, 'legacy Web file toolbar remains')
  assert.equal(app.includes('<Table size="small" aria-label="文件列表">'), false, 'legacy Web file table remains')
})

test('Web FileExplorer navigation matches system explorer behavior', () => {
  for (const token of [
    'canGoBack={historyIndex > 0}',
    'canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}',
    'canGoUp={crumbs.length > 1}',
    'onPathSubmit',
    'onCrumbClick',
  ]) {
    assert.ok(explorer.includes(token), `missing Web Explorer navigation contract: ${token}`)
  }
  assert.ok(explorer.includes("replace(/\\\\/g, '/')"), 'typed paths should accept Windows-style separators')
  assert.ok(explorer.includes('localStorage.setItem(FILE_VIEW_KEY, viewMode)'), 'Web Explorer should remember the selected view mode')
})

test('Web FileExplorer uses real file operations and server search', () => {
  assert.ok(api.includes("return this.request<SearchPage>(\`/api/v1/search?\${params.toString()}\`)"), 'Web API search is not wired to the server search endpoint')
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

test('Web FileExplorer search results preserve paths and directory breadcrumbs', () => {
  assert.ok(explorer.includes('secondaryLabel: result?.path || undefined'), 'search results should show their path')
  assert.ok(explorer.includes('normalizedSearchCrumbs(result)'), 'opening a search directory should restore its breadcrumb path')
  assert.ok(explorer.includes("仅显示前 200 个结果"), 'search pagination truncation must be disclosed')
})

test('Web FileExplorer wires copy/cut/paste to server copy and move primitives', () => {
  assert.ok(api.includes('copy(nodeID: number, parentID: number, name?: string)'), 'Web copy API is missing')
  assert.ok(api.includes('move(nodeID: number, revision: number, parentID: number)'), 'Web move API is missing')
  assert.ok(explorer.includes("type WebExplorerClipboard = { mode: 'copy' | 'cut'; nodes: Node[] }"), 'Web clipboard state is missing')
  assert.ok(explorer.includes('await api.batchCopy(refs, current.id)'), 'copy paste must call the atomic batch copy endpoint')
  assert.ok(explorer.includes('await api.batchMove(refs, current.id)'), 'cut paste must call atomic revision-safe batch move')
  assert.ok(explorer.includes('onCopyItems={(selected) => {'), 'Web shared copy adapter is missing')
  assert.ok(explorer.includes('onCutItems={(selected) => {'), 'Web shared cut adapter is missing')
  assert.ok(explorer.includes('onPaste={() => { void pasteClipboard() }}'), 'Web shared paste adapter is missing')
})

test('Web FileExplorer supports bulk download and delete', () => {
  assert.ok(explorer.includes('const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {'), 'Web bulk download helper is missing')
  assert.ok(explorer.includes('for (const node of files) await api.download(node)'), 'Web bulk download must use authenticated downloads')
  assert.ok(explorer.includes('onDownloadItems={(selected) => { void downloadSelected(selected) }}'), 'Web shared bulk download adapter is missing')
  assert.ok(explorer.includes('onRemoveMany(nodes)'), 'Web shared bulk delete adapter is missing')
  assert.ok(app.includes('const removeMany = (nodes: Node[]) => {'), 'Web bulk delete confirmation flow is missing')
  assert.ok(app.includes('await api.batchDelete(nodes.map((node) => ({ id: node.id, revision: node.revision })))'), 'Web bulk delete must use one atomic revision-safe batch request')
})

test('Web FileExplorer supports internal and external drag and drop', () => {
  assert.ok(explorer.includes('const dropItemsToFolder = async ('), 'Web internal drag/drop helper is missing')
  assert.ok(explorer.includes("if (operation === 'copy') await api.batchCopy(refs, targetNode.id)"), 'Ctrl/Cmd drag should use batch copy on Web')
  assert.ok(explorer.includes('else await api.batchMove(refs, targetNode.id)'), 'normal internal drag should use batch move on Web')
  assert.ok(explorer.includes('const dropExternalFiles = async (files: File[], target?: XDriveFileExplorerItem) => {'), 'Web external drop helper is missing')
  assert.ok(explorer.includes('onUploadDroppedFiles(parentID, files)'), 'Web external drop should use the target-aware upload adapter')
  assert.ok(app.includes('const uploadFilesTo = async (parentID: number, files: File[]) => {'), 'Web target-aware upload helper is missing')
  assert.ok(app.includes('onUploadDroppedFiles={uploadFilesTo}'), 'Web dropped-file upload adapter is not wired')
})

test('Web uses a dedicated persistent FileExplorer details-column layout', () => {
  assert.ok(explorer.includes("const FILE_DETAILS_LAYOUT_KEY = 'xdrive.files.details_layout'"), 'Web details layout storage key is missing')
  assert.ok(explorer.includes('detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}'), 'Web details layout key is not passed to shared FileExplorer')
})

test('Web FileExplorer supplies preview/properties metadata without a new plaintext preview channel', () => {
  assert.ok(explorer.includes("path: result?.path || [...crumbs.map((crumb) => crumb.name), node.name].join('/')"), 'Web inspector path metadata is missing')
  assert.ok(explorer.includes('revision: node.revision'), 'Web inspector revision metadata is missing')
  assert.ok(explorer.includes('loadThumbnail={loadThumbnail}'), 'Web inspector should reuse the protected thumbnail loader')
  assert.equal(api.includes('previewPlaintext'), false, 'Web must not add a plaintext preview API')
})

test('Web FileExplorer uses cursor-paged server sorting for directory browsing', () => {
  assert.ok(api.includes('export interface ChildrenPage {'), 'Web children page contract is missing')
  assert.ok(api.includes('listPage(parentID: number, options: ChildrenOptions = {})'), 'Web paged children API is missing')
  assert.ok(app.includes('const FILE_PAGE_SIZE = 200'), 'Web directory page size is missing')
  assert.ok(app.includes('const loadMoreDirectory = async (id: number, sort: XDriveFileExplorerSort) => {'), 'Web incremental directory loader is missing')
  assert.ok(app.includes('cursor: page.next_cursor ??'), 'Web directory cursor state is missing')
  assert.ok(explorer.includes('externallySorted={!searchResults}'), 'Web directory pages should preserve server ordering')
  assert.ok(explorer.includes('onSortChange={changeSort}'), 'Web sort changes should reload server-sorted pages')
  assert.ok(explorer.includes('onLoadMore(current.id, sort)'), 'Web Explorer must request the next page near the scroll boundary')
})

test('Web multi-select mutations use atomic server batch APIs', () => {
  for (const token of [
    "batchCopy(items: BatchNodeRef[], parentID: number)",
    "batchMove(items: BatchNodeRef[], parentID: number)",
    "batchDelete(items: BatchNodeRef[])",
    "'/api/v1/nodes/batch/copy'",
    "'/api/v1/nodes/batch/move'",
    "'/api/v1/nodes/batch/delete'",
  ]) {
    assert.ok(api.includes(token), `missing Web batch API contract: ${token}`)
  }
  assert.ok(app.includes('await api.batchDelete(nodes.map((node) => ({ id: node.id, revision: node.revision })))'), 'Web bulk delete must use one atomic batch request')
  assert.ok(explorer.includes('await api.batchMove(refs, current.id)'), 'Web cut/paste must use batch move')
  assert.ok(explorer.includes('await api.batchCopy(refs, current.id)'), 'Web copy/paste must use batch copy')
  assert.ok(explorer.includes("if (operation === 'copy') await api.batchCopy(refs, targetNode.id)"), 'Web multi-item drag-copy must use batch copy')
  assert.ok(explorer.includes('else await api.batchMove(refs, targetNode.id)'), 'Web multi-item drag-move must use batch move')
  assert.equal(app.includes('for (const node of nodes) await api.remove(node.id, node.revision)'), false, 'Web bulk delete must not regress to N requests')
})
