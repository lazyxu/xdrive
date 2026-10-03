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
  ]) {
    assert.ok(shared.includes(token), `shared search pagination helper missing: ${token}`)
  }
  for (const [label, source] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(source.includes("const [searchCursor, setSearchCursor] = useState('')"), `${label} search cursor state is missing`)
    assert.ok(source.includes('const [searchLoadingMore, setSearchLoadingMore] = useState(false)'), `${label} incremental search loading state is missing`)
    assert.ok(source.includes('xDriveFileExplorerMergeSearchResults('), `${label} must merge paged search results through shared logic`)
    assert.ok(source.includes('hasMore={searchResults ? Boolean(searchCursor) : hasMore}'), `${label} search results must expose hasMore to the shared Explorer`)
    assert.ok(source.includes('loadingMore={searchResults ? searchLoadingMore : loadingMore}'), `${label} search loadingMore state is not wired`)
    assert.ok(source.includes('void loadMoreSearch()'), `${label} search pagination must be wired to Explorer loadMore`)
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
    assert.ok(source.includes('xDriveFileExplorerDropOperationPlan(operation, nodes, targetNode.id)'), `${label} must use shared drop operation planning`)
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

test('shared FileExplorer controller owns directory crumb normalization and open-path planning', () => {
  for (const token of [
    'xDriveFileExplorerNormalizeCrumbs',
    "index === 0 && !crumb.name ? rootName : crumb.name",
    'xDriveFileExplorerDirectoryCrumbs',
    'searchCrumbs && searchCrumbs.length > 0',
    'xDriveFileExplorerNormalizeCrumbs(searchCrumbs)',
    'return [...currentCrumbs, { id: node.id, name: node.name }]',
  ]) {
    assert.ok(shared.includes(token), `shared FileExplorer directory crumb controller missing: ${token}`)
  }

  assert.ok(web.includes('xDriveFileExplorerDirectoryCrumbs(node, crumbs, result?.breadcrumbs)'), 'Web must use shared directory crumb planning')
  assert.ok(desktop.includes('xDriveFileExplorerDirectoryCrumbs(node, crumbs, searchResult?.crumbs)'), 'Desktop must use shared directory crumb planning')
  assert.equal(web.includes('normalizedSearchCrumbs'), false, 'Web must not normalize search crumbs locally')
  assert.equal(desktop.includes('normalizeSearchCrumbs'), false, 'Desktop must not normalize search crumbs locally')
})
