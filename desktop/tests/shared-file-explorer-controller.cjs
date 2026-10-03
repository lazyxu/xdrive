const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')
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
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer controller missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './file-explorer-controller'"), 'shared FileExplorer controller must be exported')
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
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal((source.match(/xDriveFileExplorerSearchDecision\(query\)/g) || []).length, 1, `${label} must use shared search decisions`)
    assert.equal(source.includes('const normalized = query.trim()'), false, `${label} must not normalize search locally`)
    assert.equal(source.includes('搜索关键字至少需要 2 个字符。'), false, `${label} must not duplicate the minimum-search message`)
  }
  assert.ok(web.includes('api.search(decision.query, XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE)'), 'Web must keep REST search execution local')
  assert.ok(desktop.includes('cloudSearch(decision.query)'), 'Desktop must keep Agent search execution local')
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
    "mode: 'search' as const",
    "mode: 'directory' as const",
  ]) {
    assert.ok(shared.includes(token), `shared search pagination helper missing: ${token}`)
  }
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('XDriveFileExplorerSearchState<'), `${label} must use shared search lifecycle state`)
    assert.ok(source.includes('xDriveFileExplorerIdleSearchState<'), `${label} must use shared search reset state`)
    assert.ok(source.includes('xDriveFileExplorerStartSearchState<'), `${label} must use shared initial-search state`)
    assert.ok(source.includes('xDriveFileExplorerStartSearchLoadMoreState('), `${label} must use shared incremental-search start state`)
    assert.ok(source.includes('xDriveFileExplorerApplySearchPageState('), `${label} must apply search pages through shared lifecycle logic`)
    assert.ok(source.includes('xDriveFileExplorerSettleSearchState('), `${label} must settle search loading through shared lifecycle logic`)
    assert.ok(source.includes('xDriveFileExplorerCanLoadMoreSearch('), `${label} must use shared search load-more eligibility`)
    assert.ok(source.includes('xDriveFileExplorerPaginationPresentation({'), `${label} must derive Explorer pagination presentation through shared logic`)
    assert.ok(source.includes("explorerPagination.mode === 'search'"), `${label} search pagination must be wired to Explorer loadMore`)
    assert.equal(source.includes('setSearchResults('), false, `${label} must not maintain search results independently`)
    assert.equal(source.includes('setSearchCursor('), false, `${label} must not maintain search cursor independently`)
    assert.equal(source.includes('setSearchLoading('), false, `${label} must not maintain search loading independently`)
    assert.equal(source.includes('setSearchLoadingMore('), false, `${label} must not maintain incremental search loading independently`)
    assert.equal(source.includes('hasMore={searchResults ? Boolean(searchCursor) : hasMore}'), false, `${label} must not duplicate search/directory hasMore selection`)
    assert.equal(source.includes('loadingMore={searchResults ? searchLoadingMore : loadingMore}'), false, `${label} must not duplicate search/directory loadingMore selection`)
  }
})

test('Web and Desktop delegate typed-path resolution while keeping transport adapters local', () => {
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal((source.match(/xDriveResolveFileExplorerPath\(/g) || []).length, 1, `${label} must use shared typed-path resolution`)
    assert.equal(source.includes(".split('/')"), false, `${label} must not duplicate typed-path splitting`)
    assert.equal(source.includes("parts[0] === rootName"), false, `${label} must not duplicate root-prefix handling`)
    assert.equal(source.includes('找不到文件夹：'), false, `${label} must not duplicate missing-folder semantics`)
  }
  assert.ok(web.includes('listChildren: (parentID) => api.list(parentID)'), 'Web must keep REST directory loading local')
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
    '加入复制任务',
    '加入移动任务',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer operation planning missing: ${token}`)
  }
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerClipboardFromItems('), `${label} must use shared clipboard construction`)
    assert.ok(source.includes('xDriveFileExplorerCanPaste('), `${label} must use shared paste availability`)
    assert.ok(source.includes('xDriveFileExplorerClipboardOperationPlan('), `${label} must use shared clipboard operation planning`)
    assert.ok(source.includes('xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)'), `${label} must use shared drop item planning`)
    assert.equal(source.includes('const targetNode = nodeByID.get(Number(target.id))'), false, `${label} must not duplicate internal-drop target resolution`)
    assert.ok(source.includes('xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count)'), `${label} must use shared queued feedback`)
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
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer open-item controller missing: ${token}`)
  }

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerNodeForItem(item, nodeByID)'), `${label} must use shared item lookup`)
    assert.ok(source.includes('xDriveFileExplorerOpenItemPlan('), `${label} must use shared open-item planning`)
    assert.ok(source.includes("if (plan.kind === 'file')"), `${label} must branch on the shared open-item plan`)
    assert.ok(source.includes('await navigateTo(plan.crumbs)'), `${label} must use shared directory crumbs`)
    assert.equal(source.includes('const node = nodeByID.get(Number(item.id))'), false, `${label} must not duplicate item lookup in open/menu handlers`)
  }

  assert.equal(web.includes('normalizedSearchCrumbs'), false, 'Web must not normalize search crumbs locally')
  assert.equal(desktop.includes('normalizeSearchCrumbs'), false, 'Desktop must not normalize search crumbs locally')
})


test('Web and Desktop keep search pagination bound to the submitted active query', () => {
  assert.ok(shared.includes('(query: string): XDriveFileExplorerSearchState<TResult>'), 'shared search start state must capture the submitted query')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('const query = searchState.query'), `${label} load-more must read the active submitted query`)
    assert.equal(source.includes('xDriveFileExplorerSearchDecision(searchValue)'), false, `${label} load-more must not reinterpret the editable search draft`)
    assert.ok(source.includes('搜索“${searchState.query}”'), `${label} status must describe the active result set rather than the editable draft`)
  }
  assert.ok(web.includes('xDriveFileExplorerStartSearchState<SearchResult>(decision.query)'), 'Web must store the normalized submitted query')
  assert.ok(web.includes('query,\n        XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,\n        searchCursor,'), 'Web pagination must request the active query with its cursor')
  assert.ok(desktop.includes('xDriveFileExplorerStartSearchState<AgentCloudSearchResult>(decision.query)'), 'Desktop must store the normalized submitted query')
  assert.ok(desktop.includes('cloudSearch(query, searchCursor)'), 'Desktop pagination must request the active query with its cursor')
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
