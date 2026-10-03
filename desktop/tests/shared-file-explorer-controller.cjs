const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const searchController = read('ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts')
const clipboardController = read('ui', 'shared', 'src', 'mui', 'FileExplorerClipboard.ts')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared FileExplorer controller owns typed-path parsing and traversal rules', () => {
  for (const token of [
    'xDriveFileExplorerPathParts',
    'xDriveResolveFileExplorerPath',
    "replace(/\\\\/g, '/')",
    ".split('/')",
    '.map((part) => part.trim())',
    '.filter(Boolean)',
    "parts[0] === rootName || parts[0] === '我的文件'",
    "node.type === 'dir' && node.name === part",
    '找不到文件夹：',
    'xDriveFileExplorerSubmitPath',
    'const root = await loadRoot()',
    "currentCrumbs[0]?.name || '我的文件'",
    'await navigate(nextCrumbs)',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer controller missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './file-explorer-controller'"), 'shared FileExplorer controller must be exported')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerSubmitPath({'), `${label} must delegate typed-path submission to the shared controller`)
    assert.equal(source.includes('xDriveResolveFileExplorerPath({'), false, `${label} must not orchestrate typed-path traversal locally`)
    assert.equal(source.includes("const rootName = crumbs[0]?.name || '我的文件'"), false, `${label} must not duplicate root-name fallback`)
  }
  assert.ok(web.includes('loadRoot: () => api.root()'), 'Web must keep REST root loading local')
  assert.ok(web.includes('listChildren: (parentID) => api.list(parentID)'), 'Web must keep REST child loading local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudRoot()'), 'Desktop must keep Agent root loading local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudChildren(parentID)'), 'Desktop must keep Agent child loading local')
})

test('shared FileExplorer controller owns search normalization and validation decisions', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_SEARCH_MIN_CHARS = 2',
    'xDriveFileExplorerSearchDecision',
    'const query = rawQuery.trim()',
    "kind: 'clear'",
    '[...query].length < minChars',
    "kind: 'invalid'",
    '搜索关键字至少需要',
    "kind: 'search'",
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer search decision missing: ${token}`)
  }
  assert.ok(searchController.includes('xDriveFileExplorerSearchDecision(rawQuery)'), 'shared React search controller must consume the framework-neutral search decision')
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerSearch'"), 'shared React search controller must be exported')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerSearch<'), `${label} must consume the shared search controller`)
    assert.equal(source.includes('xDriveFileExplorerSearchDecision(query)'), false, `${label} must not duplicate search-decision handling`)
    assert.equal(source.includes('const normalized = query.trim()'), false, `${label} must not normalize search locally`)
    assert.equal(source.includes('搜索关键字至少需要 2 个字符。'), false, `${label} must not duplicate the minimum-search message`)
  }
  assert.ok(web.includes('loadPage: (query, cursor) => api.search('), 'Web must keep REST search execution local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudSearch(query, cursor)'), 'Desktop must keep Agent search execution local')
})
test('shared FileExplorer controller owns search pagination state', () => {
  for (const token of [
    'XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE = 200',
    'xDriveFileExplorerMergeSearchResults',
    'current.map((item) => [item.node.id, item] as const)',
    'for (const item of page) merged.set(item.node.id, item)',
    'xDriveFileExplorerSearchPageState',
    'append',
    'cursor = page.next_cursor ??',
    'XDriveFileExplorerSearchState',
    'query: string',
    "query: ''",
    'xDriveFileExplorerIdleSearchState',
    'xDriveFileExplorerStartSearchState',
    'xDriveFileExplorerStartSearchLoadMoreState',
    'xDriveFileExplorerApplySearchPageState',
    '...current',
    'xDriveFileExplorerSettleSearchState',
    'xDriveFileExplorerCanLoadMoreSearch',
    'results !== null && Boolean(cursor) && !loadingMore',
    'xDriveFileExplorerPaginationPresentation',
    'xDriveFileExplorerPaginationController',
    'const presentation = xDriveFileExplorerPaginationPresentation({',
    "if (presentation.mode === 'search')",
    'void loadMoreSearch()',
    'void loadMoreDirectory(currentID, sort)',
    "mode: 'search' as const",
    "mode: 'directory' as const",
  ]) {
    assert.ok(shared.includes(token), `shared search pagination helper missing: ${token}`)
  }
  for (const token of [
    'useRef(0)',
    "const [searchValue, setSearchValueState] = useState('')",
    'useState<XDriveFileExplorerSearchState<TResult>>',
    'xDriveFileExplorerIdleSearchState<TResult>()',
    "setSearchValueState('')",
    'const changeSearchValue = (value: string) =>',
    'if (!value.trim()) {',
    'const requestID = ++requestRef.current',
    'requestID !== requestRef.current',
    'xDriveFileExplorerStartSearchState<TResult>(decision.query)',
    'xDriveFileExplorerStartSearchLoadMoreState(current)',
    'xDriveFileExplorerApplySearchPageState(current, page, false)',
    'xDriveFileExplorerApplySearchPageState(current, page, true)',
    'xDriveFileExplorerSettleSearchState(current, false)',
    'xDriveFileExplorerSettleSearchState(current, true)',
    'xDriveFileExplorerCanLoadMoreSearch(',
    'loadPage(searchState.query, searchState.cursor)',
  ]) {
    assert.ok(searchController.includes(token), `shared React search controller missing: ${token}`)
  }
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerSearch<'), `${label} must use the shared React search lifecycle controller`)
    assert.ok(source.includes('onSearchValueChange={changeSearchValue}'), `${label} must use the shared search draft controller`)
    assert.equal(source.includes('const [searchValue, setSearchValue] = useState'), false, `${label} must not own search draft state`)
    assert.equal(source.includes("setSearchValue('')"), false, `${label} must not clear the search draft separately`)
    assert.ok(source.includes('xDriveFileExplorerPaginationController({'), `${label} must use the shared pagination dispatcher`)
    assert.ok(source.includes('onLoadMore={explorerPagination.onLoadMore}'), `${label} must wire shared pagination dispatch to Explorer loadMore`)
    assert.equal(source.includes("explorerPagination.mode === 'search'"), false, `${label} must not branch search/directory pagination locally`)
    assert.equal(source.includes('searchRequestRef'), false, `${label} must not own search request sequencing`)
    assert.equal(source.includes('setSearchState('), false, `${label} must not own search lifecycle state transitions`)
    assert.equal(source.includes('xDriveFileExplorerStartSearchState<'), false, `${label} must not duplicate initial-search transitions`)
    assert.equal(source.includes('xDriveFileExplorerStartSearchLoadMoreState('), false, `${label} must not duplicate incremental-search transitions`)
    assert.equal(source.includes('xDriveFileExplorerApplySearchPageState('), false, `${label} must not apply search pages locally`)
    assert.equal(source.includes('xDriveFileExplorerSettleSearchState('), false, `${label} must not settle search loading locally`)
    assert.equal(source.includes('hasMore={searchResults ? Boolean(searchCursor) : hasMore}'), false, `${label} must not duplicate search/directory hasMore selection`)
    assert.equal(source.includes('loadingMore={searchResults ? searchLoadingMore : loadingMore}'), false, `${label} must not duplicate search/directory loadingMore selection`)
  }
})
test('Web and Desktop delegate typed-path submission while keeping transport adapters local', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal((source.match(/xDriveFileExplorerSubmitPath\(/g) || []).length, 1, `${label} must use shared typed-path submission`)
    assert.equal(source.includes('xDriveResolveFileExplorerPath({'), false, `${label} must not orchestrate typed-path resolution locally`)
    assert.equal(source.includes(".split('/')"), false, `${label} must not duplicate typed-path splitting`)
    assert.equal(source.includes("parts[0] === rootName"), false, `${label} must not duplicate root-prefix handling`)
    assert.equal(source.includes('找不到文件夹：'), false, `${label} must not duplicate missing-folder semantics`)
  }
  assert.ok(web.includes('loadRoot: () => api.root()'), 'Web must keep REST root loading local')
  assert.ok(web.includes('listChildren: (parentID) => api.list(parentID)'), 'Web must keep REST directory loading local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudRoot()'), 'Desktop must keep Agent root loading local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudChildren(parentID)'), 'Desktop must keep Agent directory loading local')
})

test('shared FileExplorer controller owns copy/move operation planning', () => {
  for (const token of [
    'xDriveFileExplorerNodesForItems',
    'XDriveFileExplorerClipboard',
    'xDriveFileExplorerClipboardFromItems',
    'return nodes.length > 0 ? { mode, nodes } : null',
    'xDriveFileExplorerCanPaste',
    'Boolean(clipboard?.nodes.length) && !busy',
    'xDriveFileExplorerClipboardOperationPlan',
    "mode === 'cut' ? 'move' : 'copy'",
    'node.parent_id !== targetParentID',
    "clearClipboard: mode === 'cut'",
    'xDriveFileExplorerDropOperationPlan',
    'node.id !== targetParentID',
    'xDriveFileExplorerDropItemsPlan',
    'const targetNode = xDriveFileExplorerNodeForItem(target, nodeByID)',
    "targetNode.type !== 'dir'",
    'const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)',
    'return plan.count > 0 ? plan : null',
    'id: node.id, revision: node.revision',
    'xDriveFileExplorerOperationQueuedMessage',
    'XDriveFileExplorerQueuedOperationPlan',
    'xDriveFileExplorerRunQueuedOperation',
    'if (plan.count > 0)',
    'const queued = await submit()',
    'onQueued(queued)',
    "onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))",
    'onComplete()',
    'onError(error)',
    '加入复制任务',
    '加入移动任务',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer operation planning missing: ${token}`)
  }
  for (const token of [
    'useState<XDriveFileExplorerClipboard<TNode> | null>(null)',
    'xDriveFileExplorerClipboardFromItems(mode, selected, nodeByID)',
    "setFromItems('copy', selected)",
    "setFromItems('cut', selected)",
    'const planPaste = (targetParentID: number) => {',
    'xDriveFileExplorerClipboardOperationPlan(',
    'const completePaste = (plan: { clearClipboard: boolean }) => {',
    'if (plan.clearClipboard) setClipboard(null)',
    'canPaste: (busy: boolean) => xDriveFileExplorerCanPaste(clipboard, busy)',
  ]) {
    assert.ok(clipboardController.includes(token), `shared React clipboard controller missing: ${token}`)
  }
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerClipboard'"), 'shared React clipboard controller must be exported')

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerClipboard<'), `${label} must use the shared clipboard controller`)
    assert.ok(source.includes('const plan = planPaste(current.id)'), `${label} paste must use the shared clipboard plan`)
    assert.ok(source.includes('completePaste(plan)'), `${label} must let the shared clipboard controller clear completed cuts`)
    assert.ok(source.includes('onCopyItems={copyItems}'), `${label} must delegate copy selection to the shared clipboard controller`)
    assert.ok(source.includes('onCutItems={cutItems}'), `${label} must delegate cut selection to the shared clipboard controller`)
    assert.ok(source.includes('canPaste={canPaste('), `${label} must delegate paste availability to the shared clipboard controller`)
    assert.equal(source.includes('xDriveFileExplorerClipboardFromItems('), false, `${label} must not construct clipboard state locally`)
    assert.equal(source.includes('xDriveFileExplorerCanPaste('), false, `${label} must not derive paste availability locally`)
    assert.equal(source.includes('xDriveFileExplorerClipboardOperationPlan('), false, `${label} must not plan clipboard operations locally`)
    assert.ok(source.includes('xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)'), `${label} must use shared drop item planning`)
    assert.equal(source.includes('const targetNode = nodeByID.get(Number(target.id))'), false, `${label} must not duplicate internal-drop target resolution`)
    assert.ok(source.includes('xDriveFileExplorerRunQueuedOperation({'), `${label} must use shared queued-operation completion`)
    assert.equal(source.includes("onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))"), false, `${label} must not duplicate queued-operation feedback`)
    assert.equal(source.includes("clipboard.mode === 'cut' ? 'move' : 'copy'"), false, `${label} must not duplicate cut-to-move mapping`)
    assert.equal(source.includes('nodes.map((node) => ({ id: node.id, revision: node.revision }))'), false, `${label} must not duplicate operation refs`)
  }
  assert.ok(web.includes('api.createFileOperation(plan.operation, plan.items, plan.parentID)'), 'Web must keep REST operation execution local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop must keep Agent operation execution local')
})

test('shared FileExplorer controller owns bulk-download selection and feedback rules', () => {
  for (const token of [
    'xDriveFileExplorerDownloadPlan',
    "node.type === 'file'",
    'skippedFolders: nodes.length - files.length',
    'id: node.id, name: node.name',
    'xDriveFileExplorerWebDownloadFeedback',
    '已开始下载',
    'xDriveFileExplorerDesktopDownloadFeedback',
    '个失败',
    '跳过',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer download planning missing: ${token}`)
  }
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerDownloadPlan(nodes)'), `${label} must use shared download planning`)
    assert.equal(source.includes("const files = nodes.filter((node) => node.type === 'file')"), false, `${label} must not filter download files locally`)
  }
  assert.ok(web.includes('for (const node of plan.files) await api.download(node)'), 'Web must keep browser download execution local')
  assert.ok(web.includes('xDriveFileExplorerWebDownloadFeedback(plan.files.length, plan.skippedFolders)'), 'Web must use shared download feedback')
  assert.ok(desktop.includes('cloudDownloadFiles(plan.items)'), 'Desktop must keep native batch download execution local')
  assert.ok(desktop.includes('xDriveFileExplorerDesktopDownloadFeedback({'), 'Desktop must use shared download result feedback')
})

test('shared FileExplorer controller owns external-drop target resolution', () => {
  for (const token of [
    'xDriveFileExplorerExternalDropParentID',
    'target ? nodeByID.get(Number(target.id)) : undefined',
    "targetNode?.type === 'dir' ? targetNode.id : currentParentID",
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer external-drop targeting missing: ${token}`)
  }
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)'), `${label} must use shared external-drop targeting`)
    assert.equal(source.includes("targetNode?.type === 'dir' ? targetNode.id : current.id"), false, `${label} must not duplicate external-drop target rules`)
  }
  assert.ok(web.includes('onUploadDroppedFiles(parentID, files)'), 'Web must keep dropped-file upload execution local')
  assert.ok(desktop.includes('cloudUploadDroppedFiles(parentID, files)'), 'Desktop must keep dropped-file upload execution local')
})

test('shared FileExplorer controller owns item lookup and open-item planning', () => {
  for (const token of [
    'xDriveFileExplorerNormalizeCrumbs',
    "index === 0 && !crumb.name ? rootName : crumb.name",
    'xDriveFileExplorerDirectoryCrumbs',
    'searchCrumbs && searchCrumbs.length > 0',
    'xDriveFileExplorerNormalizeCrumbs(searchCrumbs)',
    'return [...currentCrumbs, { id: node.id, name: node.name }]',
    'xDriveFileExplorerNodeForItem',
    'return nodeByID.get(Number(item.id))',
    'XDriveFileExplorerOpenItemPlan',
    "if (node.type === 'file') return { kind: 'file', node }",
    "kind: 'directory'",
    'crumbs: xDriveFileExplorerDirectoryCrumbs(node, currentCrumbs, searchCrumbs)',
    'xDriveFileExplorerDispatchOpenItem',
    'const node = xDriveFileExplorerNodeForItem(item, nodeByID)',
    'searchCrumbsForNode?.(node)',
    "if (plan.kind === 'file')",
    'await openFile(plan.node)',
    'await navigate(plan.crumbs)',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer open-item controller missing: ${token}`)
  }

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerNodeForItem(item, nodeByID)'), `${label} menu adapter must keep shared item lookup`)
    assert.ok(source.includes('xDriveFileExplorerDispatchOpenItem({'), `${label} must delegate open-item dispatch to shared controller`)
    assert.ok(source.includes('searchCrumbsForNode: (node) => searchByID.get(node.id)?'), `${label} must inject platform search crumbs into shared dispatch`)
    assert.equal(source.includes('xDriveFileExplorerOpenItemPlan('), false, `${label} must not branch open-item planning locally`)
    assert.equal(source.includes("if (plan.kind === 'file')"), false, `${label} must not branch file/directory open locally`)
    assert.equal(source.includes('await navigateTo(plan.crumbs)'), false, `${label} must not dispatch directory navigation locally`)
    assert.equal(source.includes('const node = nodeByID.get(Number(item.id))'), false, `${label} must not duplicate item lookup in open/menu handlers`)
  }
  assert.ok(web.includes('openFile: async (node) => {'), 'Web must keep download execution as the shared dispatch callback')
  assert.ok(web.includes('await api.download(node)'), 'Web shared open callback must keep authenticated download local')
  assert.ok(desktop.includes('openFile: openLocalNode'), 'Desktop must keep native open execution as the shared dispatch callback')

  assert.equal(web.includes('normalizedSearchCrumbs'), false, 'Web must not normalize search crumbs locally')
  assert.equal(desktop.includes('normalizeSearchCrumbs'), false, 'Desktop must not normalize search crumbs locally')
})


test('Web and Desktop keep search pagination bound to the submitted active query', () => {
  assert.ok(shared.includes('(query: string): XDriveFileExplorerSearchState<TResult>'), 'shared search start state must capture the submitted query')
  assert.ok(searchController.includes('loadPage(searchState.query, searchState.cursor)'), 'shared React search controller must paginate the submitted active query')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal(source.includes('xDriveFileExplorerSearchDecision(searchValue)'), false, `${label} load-more must not reinterpret the editable search draft`)
    assert.ok(source.includes('搜索“${searchState.query}”'), `${label} status must describe the active result set rather than the editable draft`)
    assert.ok(source.includes('useXDriveFileExplorerSearch<'), `${label} must get active-query lifecycle from the shared search controller`)
  }
  assert.ok(web.includes('loadPage: (query, cursor) => api.search('), 'Web must inject REST search loading into the shared controller')
  assert.ok(web.includes('XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE'), 'Web search loader must preserve the shared page size')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudSearch(query, cursor)'), 'Desktop must inject Agent cursor search into the shared controller')
})
test('shared FileExplorer controller owns directory page replace/append transitions', () => {
  for (const token of [
    'XDriveFileExplorerDirectoryPage',
    'xDriveFileExplorerDirectoryPageTransition',
    'pageState: xDriveFileExplorerPageStateFromResult(parentID, page, sort)',
    'applyItems: (currentItems: readonly TItem[])',
    'xDriveFileExplorerMergePageItems(currentItems, page.items)',
    ': [...page.items]',
  ]) {
    assert.ok(shared.includes(token), `shared directory page transition missing: ${token}`)
  }
})
