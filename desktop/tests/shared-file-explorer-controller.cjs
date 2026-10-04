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
const workspaceController = read('ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts')
const clipboardController = read('ui', 'shared', 'src', 'mui', 'FileExplorerClipboard.ts')
const operationController = read('ui', 'shared', 'src', 'mui', 'FileExplorerOperationController.ts')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const webApp = read('web', 'src', 'App.tsx')
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
    assert.equal(source.includes('xDriveFileExplorerSubmitPath({'), false, `${label} must not orchestrate typed-path submission outside the shared workspace controller`)
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
  assert.ok(workspaceController.includes('useXDriveFileExplorerSearch<TSearch>'), 'shared workspace must compose search lifecycle')
  assert.ok(workspaceController.includes('useXDriveFileExplorerProjection<'), 'shared workspace must compose projection')
  assert.ok(workspaceController.includes('useXDriveFileExplorerClipboard<TNode>'), 'shared workspace must compose clipboard state')
  assert.ok(workspaceController.includes('useXDriveFileExplorerNavigation({'), 'shared workspace must compose navigation')
  assert.ok(workspaceController.includes('xDriveFileExplorerSubmitPath({'), 'shared workspace must own typed-path submission')
  assert.ok(workspaceController.includes('xDriveFileExplorerDispatchOpenItem({'), 'shared workspace must own open-item dispatch')
  assert.ok(workspaceController.includes('xDriveFileExplorerPaginationController({'), 'shared workspace must own pagination dispatch')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerWorkspace<'), `${label} must consume the shared workspace controller`)
    assert.equal(source.includes('xDriveFileExplorerSearchDecision(query)'), false, `${label} must not duplicate search-decision handling`)
    assert.equal(source.includes('const normalized = query.trim()'), false, `${label} must not normalize search locally`)
    assert.equal(source.includes('搜索关键字至少需要 2 个字符。'), false, `${label} must not duplicate the minimum-search message`)
  }
  assert.ok(web.includes('loadSearchPage: (query, cursor) => api.search('), 'Web must keep REST search execution local')
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
    assert.ok(source.includes('useXDriveFileExplorerWorkspace<'), `${label} must use the shared workspace controller`)
    assert.ok(source.includes('onSearchValueChange={changeSearchValue}'), `${label} must use the shared search draft controller`)
    assert.equal(source.includes('const [searchValue, setSearchValue] = useState'), false, `${label} must not own search draft state`)
    assert.equal(source.includes("setSearchValue('')"), false, `${label} must not clear the search draft separately`)
    assert.equal(source.includes('xDriveFileExplorerPaginationController({'), false, `${label} must not compose pagination outside the shared workspace controller`)
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
    assert.equal((source.match(/xDriveFileExplorerSubmitPath\(/g) || []).length, 0, `${label} must delegate typed-path submission to the shared workspace controller`)
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

test('shared FileExplorer controller owns copy/move planning and queued execution', () => {
  for (const token of [
    'xDriveFileExplorerNodesForItems',
    'XDriveFileExplorerClipboard',
    'xDriveFileExplorerClipboardFromItems',
    'xDriveFileExplorerCanPaste',
    'xDriveFileExplorerClipboardOperationPlan',
    "mode === 'cut' ? 'move' : 'copy'",
    'xDriveFileExplorerDropOperationPlan',
    'xDriveFileExplorerDropItemsPlan',
    'xDriveFileExplorerDropItemsToParentPlan',
    'xDriveFileExplorerRunQueuedOperation',
    'xDriveFileExplorerOperationQueuedMessage',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer operation planning missing: ${token}`)
  }
  for (const token of [
    'useState<XDriveFileExplorerClipboard<TNode> | null>(null)',
    'xDriveFileExplorerClipboardFromItems(mode, selected, nodeByID)',
    "setFromItems('copy', selected)",
    "setFromItems('cut', selected)",
    'xDriveFileExplorerClipboardOperationPlan(',
    'if (plan.clearClipboard) setClipboard(null)',
  ]) {
    assert.ok(clipboardController.includes(token), `shared React clipboard controller missing: ${token}`)
  }
  for (const token of [
    'useXDriveFileExplorerOperationController',
    "useState<XDriveFileExplorerQueuedOperationAction>('')",
    'xDriveFileExplorerRunQueuedOperation({',
    'submit: () => submitOperation(plan)',
    "await runPlan('paste', plan",
    'completePaste(plan)',
    'xDriveFileExplorerDropItemsPlan(',
    "await runPlan('drop-items', plan, clearSearch)",
    'xDriveFileExplorerDropItemsToParentPlan(',
    'canPaste: canPaste(disabled || busy)',
  ]) {
    assert.ok(operationController.includes(token), `shared operation controller missing: ${token}`)
  }
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerOperationController'"), 'shared operation controller must be exported')

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerOperationController<'), `${label} must consume the shared queued-operation controller`)
    assert.ok(source.includes('onCopyItems={copyItems}'), `${label} must retain shared copy wiring`)
    assert.ok(source.includes('onCutItems={cutItems}'), `${label} must retain shared cut wiring`)
    assert.ok(source.includes('onPaste={() => { void pasteClipboard() }}'), `${label} must wire shared paste execution`)
    assert.equal(source.includes('xDriveFileExplorerRunQueuedOperation({'), false, `${label} must not execute queued operations locally`)
    assert.equal(source.includes('xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)'), false, `${label} must not plan internal folder drops locally`)
    assert.equal(source.includes('xDriveFileExplorerDropItemsToParentPlan('), false, `${label} must not plan breadcrumb drops locally`)
    assert.equal(source.includes("setActionBusy('paste')"), false, `${label} must not own paste busy state locally`)
    assert.equal(source.includes("setActionBusy('drop-items')"), false, `${label} must not own internal-drop busy state locally`)
  }
  assert.ok(web.includes('submitOperation: (plan) => api.createFileOperation('), 'Web must keep REST operation transport local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop must keep Agent operation transport local')
})

test('shared FileExplorer controller owns archive-aware planning across Web and capable Desktop', () => {
  for (const token of [
    'xDriveFileExplorerDownloadPlan',
    "node.type === 'file'",
    'skippedFolders: nodes.length - files.length',
    'XDriveFileExplorerArchiveDownloadPlan',
    'xDriveFileExplorerArchiveDownloadPlan',
    "kind: 'file'",
    "kind: 'archive'",
    "'xDrive-download.zip'",
    'return xDriveFileExplorerArchiveDownloadPlan(nodes)',
    'xDriveFileExplorerDesktopArchiveDownloadFeedback',
    'xDriveFileExplorerWebDownloadFeedback',
    'xDriveFileExplorerDesktopDownloadFeedback',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer download planning missing: ${token}`)
  }
  assert.ok(web.includes('xDriveFileExplorerWebDownloadPlan(nodes)'), 'Web must retain its compatibility wrapper over shared archive planning')
  assert.ok(web.includes('api.downloadArchive(plan.ids, plan.filename)'), 'Web must keep archive transport local')
  assert.ok(desktop.includes('xDriveFileExplorerArchiveDownloadPlan(nodes)'), 'capable Desktop must use the shared archive-aware plan')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudDownloadArchive(archivePlan.ids)'), 'Desktop must keep native archive transport local')
  assert.ok(desktop.includes('xDriveFileExplorerDownloadPlan(nodes)'), 'Desktop must retain file-only fallback for older Agents')
  assert.ok(desktop.includes('cloudDownloadFiles(plan.items)'), 'Desktop fallback must keep legacy native batch download execution')
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
    assert.equal(source.includes('xDriveFileExplorerDispatchOpenItem({'), false, `${label} must not orchestrate open-item dispatch outside the shared workspace controller`)
    assert.ok(source.includes('searchCrumbsForResult:'), `${label} must adapt platform search crumbs into the shared workspace controller`)
    assert.equal(source.includes('xDriveFileExplorerOpenItemPlan('), false, `${label} must not branch open-item planning locally`)
    assert.ok(source.includes('openItem'), `${label} must consume the workspace open-item adapter`)
  }
  assert.ok(web.includes('const openWebNode = async (node: Node) => {'), 'Web must keep authenticated file open/download execution local')
  assert.ok(web.includes('await api.download(node)'), 'Web shared open callback must keep authenticated download local')
  assert.ok(desktop.includes('openWorkspaceItem(item, openLocalNode)'), 'Desktop must keep native open execution local while shared workspace owns dispatch')

  assert.equal(web.includes('normalizedSearchCrumbs'), false, 'Web must not normalize search crumbs locally')
  assert.equal(desktop.includes('normalizeSearchCrumbs'), false, 'Desktop must not normalize search crumbs locally')
})


test('Web and Desktop keep search pagination bound to the submitted active query', () => {
  assert.ok(shared.includes('(query: string): XDriveFileExplorerSearchState<TResult>'), 'shared search start state must capture the submitted query')
  assert.ok(searchController.includes('loadPage(searchState.query, searchState.cursor)'), 'shared React search controller must paginate the submitted active query')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal(source.includes('xDriveFileExplorerSearchDecision(searchValue)'), false, `${label} load-more must not reinterpret the editable search draft`)
    assert.ok(source.includes('searchStatusText'), `${label} status must consume the shared workspace search status`)
    assert.ok(source.includes('useXDriveFileExplorerWorkspace<'), `${label} must get active-query lifecycle from the shared workspace controller`)
  }
  assert.ok(web.includes('loadSearchPage: (query, cursor) => api.search('), 'Web must inject REST search loading into the shared workspace controller')
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


test('shared FileExplorer owns parent-target drop planning and edge autoscroll decisions', () => {
  for (const token of [
    'xDriveFileExplorerDropItemsToParentPlan',
    "operation !== 'move' || node.parent_id !== targetParentID",
    'xDriveFileExplorerDragAutoScrollDelta',
    'Math.min(edgeSize, height / 2)',
    'return -Math.max(1, Math.ceil(speed * (1 - topDistance / edge)))',
    'return Math.max(1, Math.ceil(speed * (1 - bottomDistance / edge)))',
  ]) {
    assert.ok(shared.includes(token), `shared drag polish helper missing: ${token}`)
  }

  assert.ok(
    operationController.includes('xDriveFileExplorerDropItemsToParentPlan('),
    'shared operation controller must own breadcrumb drop planning',
  )
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal(
      source.includes('xDriveFileExplorerDropItemsToParentPlan('),
      false,
      `${label} must not plan breadcrumb drops locally`,
    )
    assert.ok(
      source.includes('onDropItemsToCrumb={(selected, crumb, operation) =>'),
      `${label} must wire internal breadcrumb drops`,
    )
    assert.ok(
      source.includes('onExternalFilesDropToCrumb={(files, crumb) =>'),
      `${label} must wire external breadcrumb drops`,
    )
  }
})


test('shared FileExplorer controller owns folder-upload path planning and directory reuse', () => {
  for (const token of [
    'XDriveFileExplorerFolderUploadEntry',
    'xDriveFileExplorerFolderUploadPlan',
    "relativePath.replace(/\\\\/g, '/')",
    "part === '.' || part === '..'",
    'directories: [...directories.values()].sort',
    'xDriveFileExplorerEnsureUploadDirectory',
    "node.type === 'dir'",
    "sensitivity: 'accent'",
    'xDriveFileExplorerResolveFolderUploadTargets',
    "new Map<string, number>([['', rootParentID]])",
    'await ensureDirectory(parentID, directory.name)',
    'return { ...file, parentID }',
  ]) {
    assert.ok(shared.includes(token), `missing shared folder-upload controller: ${token}`)
  }
  for (const [label, source] of [['Web', webApp], ['Desktop', desktop]]) {
    assert.ok(source.includes('xDriveFileExplorerResolveFolderUploadTargets({'), `${label} must use shared folder tree resolution`)
    assert.ok(source.includes('xDriveFileExplorerEnsureUploadDirectory({'), `${label} must use shared idempotent directory reuse`)
    assert.equal(source.includes(".split('/').slice(0, -1)"), false, `${label} must not duplicate relative-path tree planning`)
  }
})


test('shared folder-upload planner preserves explicit dropped directories including empty folders', () => {
  for (const token of [
    'explicitDirectoryPaths: readonly string[] = []',
    'const registerDirectoryPath = (relativePath: string) =>',
    'for (const path of explicitDirectoryPaths) registerDirectoryPath(path)',
    'directoryPaths = []',
    'xDriveFileExplorerFolderUploadPlan(entries, directoryPaths)',
  ]) {
    assert.ok(shared.includes(token), `missing explicit folder-drop directory support: ${token}`)
  }
})
