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
const externalDropController = read('ui', 'shared', 'src', 'mui', 'FileExplorerExternalDrop.ts')
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
    'xDriveFileExplorerPathLookupPageOptions',
    'limit: 1',
    "sort: 'name' as const",
    "order: 'asc' as const",
    'findChildDirectory(parentID, part)',
    "next.type !== 'dir' || next.name !== part",
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
  assert.ok(web.includes('findChildDirectory: async (parentID, name) =>'), 'Web must keep indexed REST child lookup local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudRoot()'), 'Desktop must keep Agent root loading local')
  assert.ok(desktop.includes('findChildDirectory: async (parentID, name) =>'), 'Desktop must keep indexed Agent child lookup local')
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
  assert.ok(searchController.includes('xDriveFileExplorerSearchFiltersSignature'), 'shared Search generation must include structured filters')
  assert.ok(searchController.includes('changeSearchFilters'), 'shared Search controller must own structured filter state')
  assert.ok(sharedIndex.includes("export * from './file-explorer-search'"), 'framework-neutral Search filter model must be exported')
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerSearch'"), 'shared React search controller must be exported')
  assert.ok(sharedMuiIndex.includes("export * from './FileExplorerSearchFilters'"), 'shared Search filter chips must be exported')
  assert.ok(workspaceController.includes('useXDriveFileExplorerSearch<TSearch>'), 'shared workspace must compose search lifecycle')
  assert.ok(workspaceController.includes('useXDriveFileExplorerProjection<'), 'shared workspace must compose projection')
  assert.ok(workspaceController.includes('useXDriveFileExplorerClipboard<TNode>'), 'shared workspace must compose clipboard state')
  assert.ok(workspaceController.includes('useXDriveFileExplorerNavigation({'), 'shared workspace must compose navigation')
  assert.ok(workspaceController.includes('xDriveFileExplorerSubmitPath({'), 'shared workspace must own typed-path submission')
  assert.ok(workspaceController.includes('xDriveFileExplorerDispatchOpenItem({'), 'shared workspace must own open-item dispatch')
  assert.ok(workspaceController.includes('explorerVirtualCollection'), 'shared workspace must own sparse collection selection')
  assert.equal(workspaceController.includes('xDriveFileExplorerPaginationController'), false, 'shared workspace must not retain main-directory append dispatch')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerWorkspace<'), `${label} must consume the shared workspace controller`)
    assert.equal(source.includes('xDriveFileExplorerSearchDecision(query)'), false, `${label} must not duplicate search-decision handling`)
    assert.equal(source.includes('const normalized = query.trim()'), false, `${label} must not normalize search locally`)
    assert.equal(source.includes('搜索关键字至少需要 2 个字符。'), false, `${label} must not duplicate the minimum-search message`)
  }
  assert.ok(web.includes('loadSearchRange: async (query, filters, searchSort, offset, limit) =>'), 'Web must keep REST Search range execution local')
  assert.ok(web.includes('api.searchRange('), 'Web Search adapter must use range transport')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudSearchRange('), 'Desktop must keep Agent Search range execution local')
})
test('shared FileExplorer controller owns sparse Search range state', () => {
  assert.ok(shared.includes('XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE = 200'), 'shared Search range size must remain framework-neutral')
  for (const token of [
    'useXDriveVirtualCollection<TResult>',
    'const requestRef = useRef<Record<string, number>>({})',
    'const targetRef = useRef<XDriveFileExplorerSearchTarget | null>(null)',
    "workspaceKey = 'default'",
    'const [entries, setEntries]',
    'const entry = entries[workspaceKey]',
    'const requestID = nextRequestID(key)',
    'targetRef.current = nextTarget',
    'virtualCollection.reset(searchQueryKey(nextTarget))',
    'virtualCollection.primePage(page)',
    'targetIsCurrent(nextTarget)',
    'searchVirtualItems = activeTarget',
    'searchVirtualCollection',
    'searchSortMatches:',
  ]) {
    assert.ok(searchController.includes(token), `shared Search VirtualCollection contract missing: ${token}`)
  }
  for (const legacy of [
    'searchCursor',
    'searchLoadingMore',
    'loadMoreSearch',
    'loadMoreRequestRef',
    'resultIDsRef',
  ]) {
    assert.equal(searchController.includes(legacy), false, `Search controller must not retain legacy load-more state: ${legacy}`)
  }
  for (const legacy of [
    'xDriveFileExplorerMergeSearchResults',
    'XDriveFileExplorerSearchPage',
    'XDriveFileExplorerSearchState',
    'xDriveFileExplorerStartSearchLoadMoreState',
    'xDriveFileExplorerCanLoadMoreSearch',
  ]) {
    assert.equal(shared.includes(legacy), false, `shared FileExplorer core must not retain legacy Search pagination helper: ${legacy}`)
  }
  assert.equal(workspaceController.includes('searchCursor'), false, 'workspace must not consume a Search cursor')
  assert.equal(workspaceController.includes('searchLoadingMore'), false, 'workspace must not expose Search loading-more state')
  assert.equal(workspaceController.includes('loadMoreSearch'), false, 'workspace must not dispatch Search load-more')
  assert.equal(workspaceController.includes('directoryHasMore'), false, 'workspace must not retain directory append state')
  assert.equal(workspaceController.includes('directoryLoadingMore'), false, 'workspace must not retain directory loading-more state')
  assert.equal(workspaceController.includes('onLoadMoreDirectory'), false, 'workspace must not retain directory append callbacks')

  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerWorkspace<'), `${label} must use the shared workspace controller`)
    assert.ok(source.includes('onSearchValueChange={changeSearchValue}'), `${label} must use shared search draft state`)
    assert.equal(source.includes('const [searchValue, setSearchValue] = useState'), false, `${label} must not own search draft state`)
    assert.equal(source.includes('searchRequestRef'), false, `${label} must not own search request sequencing`)
    assert.equal(source.includes('setSearchState('), false, `${label} must not own search lifecycle state`)
  }
  assert.ok(
    workspaceController.includes('virtualSearchItems: search.searchResults !== null'),
    'workspace projection must receive sparse Search metadata only while Search is active',
  )
  assert.ok(workspaceController.includes('? search.searchVirtualCollection'), 'workspace must switch the surface to Search VirtualCollection')
  assert.ok(workspaceController.includes('search.searchResults !== null'), 'workspace must preserve Search active-state semantics')
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
  assert.ok(web.includes('xDriveFileExplorerPathLookupPageOptions(name)'), 'Web typed-path traversal must use one exact-name page lookup')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudRoot()'), 'Desktop must keep Agent root loading local')
  assert.ok(desktop.includes('xDriveFileExplorerPathLookupPageOptions(name)'), 'Desktop typed-path traversal must use one exact-name page lookup')
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

test('shared FileExplorer external-drop controller owns target, breadcrumb, and refresh orchestration', () => {
  for (const token of [
    'xDriveFileExplorerExternalDropParentID',
    'target ? nodeByID.get(Number(target.id)) : undefined',
    "targetNode?.type === 'dir' ? targetNode.id : currentParentID",
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer external-drop targeting missing: ${token}`)
  }
  for (const token of [
    'useXDriveFileExplorerExternalDropController',
    'xDriveFileExplorerExternalDropParentID(currentID, target, nodeByID)',
    'uploadFilesToParent(parentID, files)',
    'uploadFolderEntriesToParent(parentID, payload)',
    'currentContextRef.current',
    'latest.currentID !== expectedCurrentID',
    'await refreshCurrentDirectory(expectedCurrentID)',
    'Number(crumb.id)',
    'folderDropEnabled',
  ]) {
    assert.ok(externalDropController.includes(token), `shared external-drop controller missing: ${token}`)
  }
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes('useXDriveFileExplorerExternalDropController<'), `${label} must consume the shared external-drop controller`)
    assert.equal(source.includes('xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)'), false, `${label} must not resolve external-drop targets locally`)
    assert.equal(source.includes('const dropExternalFilesToParent'), false, `${label} must not own external file target/refresh orchestration`)
    assert.equal(source.includes('const dropExternalFolderEntriesToParent'), false, `${label} must not own external folder target/refresh orchestration`)
  }
  assert.ok(web.includes('uploadFilesToParent: onUploadDroppedFiles'), 'Web must keep dropped-file REST upload execution local')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)'), 'Desktop must keep dropped-file Agent execution local')
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
  assert.ok(web.includes('const openWebNode = (node: Node) => {'), 'Web must keep platform open execution local')
  assert.ok(web.includes('setOpenPreviewItem({'), 'Web open must target the shared preview dialog instead of downloading')
  assert.ok(web.includes('await api.download(plan.file)'), 'Web explicit Download must keep authenticated file download local')
  assert.equal(
    web.slice(
      web.indexOf('const openWebNode = (node: Node) => {'),
      web.indexOf('const downloadSelected = async'),
    ).includes('api.download('),
    false,
    'Web Open must not implicitly download',
  )
  assert.ok(desktop.includes('openWorkspaceItem(item, openPreviewNode)'), 'Desktop primary Open must target shared preview while shared workspace owns dispatch')
  assert.ok(desktop.includes("onSystemOpen: node.type === 'file'"), 'Desktop must preserve explicit system-shell Open')
  assert.ok(desktop.includes('void openLocalNode(node)'), 'Desktop explicit system-shell Open must keep native execution local')

  assert.equal(web.includes('normalizedSearchCrumbs'), false, 'Web must not normalize search crumbs locally')
  assert.equal(desktop.includes('normalizeSearchCrumbs'), false, 'Desktop must not normalize search crumbs locally')
})


test('Web and Desktop keep Search ranges bound to the submitted active query', () => {
  assert.ok(searchController.includes('query: entry.query'), 'Search state must expose the submitted active query')
  assert.ok(searchController.includes('active.query === entry.query'), 'viewport ranges must stay bound to the active submitted query')
  assert.ok(searchController.includes('targetIsCurrent(nextTarget)'), 'late Search ranges must not overwrite a newer query')
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.equal(source.includes('xDriveFileExplorerSearchDecision(searchValue)'), false, `${label} viewport loading must not reinterpret the editable search draft`)
    assert.ok(source.includes('searchStatusText'), `${label} status must consume the shared workspace search status`)
    assert.ok(source.includes('useXDriveFileExplorerWorkspace<'), `${label} must get active-query lifecycle from the shared workspace controller`)
  }
  assert.ok(web.includes('loadSearchRange: async (query, filters, searchSort, offset, limit) =>'), 'Web must inject REST Search range loading')
  assert.ok(web.includes('api.searchRange('), 'Web must use the Search range REST adapter')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudSearchRange('), 'Desktop must use the Agent Search range adapter')
  assert.ok(workspaceController.includes('sort: navigation.sort'), 'shared workspace must bind Search requests to active-tab sort')
  assert.ok(workspaceController.includes('search.searchResults === null || search.searchSortMatches'), 'Search projection must remain externally sorted after server range sort is current')
})

test('shared FileExplorer controller keeps cursor paging only for bounded tree reads', () => {
  for (const legacy of [
    'XDriveFileExplorerDirectoryPage',
    'xDriveFileExplorerDirectoryPageTransition',
    'xDriveFileExplorerPageStateFromResult',
    'xDriveFileExplorerMergePageItems',
    'xDriveFileExplorerCanLoadMore',
  ]) {
    assert.equal(shared.includes(legacy), false, `dead main-directory append helper remains: ${legacy}`)
  }
  for (const token of [
    'XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE = 200',
    'xDriveFileExplorerLoadChildDirectoryPage',
    'page.next_cursor?.trim()',
    'const hasMore = !reachedFile && page.has_more && Boolean(nextCursor)',
  ]) {
    assert.ok(shared.includes(token), `bounded tree cursor helper missing: ${token}`)
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
    'xDriveFileExplorerCaseInsensitiveNameLookupPageOptions',
    'findExistingDirectory',
    "existing?.type === 'dir'",
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
    assert.ok(source.includes('xDriveFileExplorerCaseInsensitiveNameLookupPageOptions('), `${label} must use indexed conflict lookup`)
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
