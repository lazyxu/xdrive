const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const workspace = read('ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts')
const cloud = read('ui', 'shared', 'src', 'mui', 'CloudFilesController.ts')
const search = read('ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts')
const virtual = read('ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts')
const design = read('docs', 'file-explorer.md')

test('VirtualCollection exposes one awaitable logical-range interaction contract', () => {
  for (const token of [
    'const collectRange = useCallback(async (',
    'const chunkSize = Math.max(pageSize, pageSize * 4)',
    'generation !== generationRef.current',
    'activeQueryKey !== queryKeyRef.current',
    'collectRange,',
  ]) {
    assert.ok(virtual.includes(token), 'VirtualCollection range contract missing: ' + token)
  }

  assert.ok(cloud.includes('collectRange: virtualCollection.collectRange'), 'directory VirtualCollection must expose collectRange')
  assert.ok(search.includes('collectRange: virtualCollection.collectRange'), 'search VirtualCollection must expose collectRange')
  assert.ok(workspace.includes('collectRange: async (startIndex, endIndex) =>'), 'workspace must project logical ranges')
})

test('VirtualCollection Ctrl+A and Shift selection resolve unloaded logical items', () => {
  assert.ok(
    explorer.includes('collectRange?: (\n    startIndex: number,\n    endIndex: number,'),
    'FileExplorer virtual contract must expose collectRange',
  )
  assert.ok(
    explorer.includes('void resolveLogicalRange(0, logicalItemCount - 1).then((resolved) =>'),
    'Ctrl/Cmd+A must resolve the complete logical collection',
  )
  assert.ok(
    explorer.includes('const anchorIndex = selectionAnchorIndex ?? logicalIndexOf(selectionAnchorID) ?? -1'),
    'Shift-click must retain a logical anchor index after the anchor page is evicted',
  )
  assert.ok(
    explorer.includes('const range = await resolveLogicalRange(start, end)'),
    'Shift keyboard selection must await unloaded ranges before committing',
  )
  assert.ok(
    explorer.includes('const intent = beginSelectionIntent()'),
    'async selection must be fenced by a selection intent',
  )
})

test('VirtualCollection type-to-select and Quick Look traverse logical order on demand', () => {
  assert.equal(
    explorer.includes('if (virtualCollectionEnabled) return false'),
    false,
    'type-to-select must not be disabled for VirtualCollection',
  )
  assert.ok(
    explorer.includes('const intent = ++typeSelectIntentRef.current'),
    'virtual type-to-select must fence stale scans',
  )
  assert.ok(
    explorer.includes('const chunkSize = 128'),
    'virtual type-to-select must scan bounded logical chunks',
  )
  assert.ok(
    explorer.includes('const intent = ++quickLookIntentRef.current'),
    'virtual Quick Look navigation must fence stale scans',
  )
  assert.ok(
    explorer.includes('if (target.kind !== \'file\') continue'),
    'virtual Quick Look navigation must skip folders',
  )
  assert.ok(
    explorer.includes('quickLookLogicalIndex'),
    'Quick Look must retain logical position beyond currently loaded pages',
  )
})

test('virtual selections retain operation metadata after render-page eviction', () => {
  for (const token of [
    'const interactionNodeCacheRef = useRef(new Map<number, TNode>())',
    'const interactionSearchCacheRef = useRef(new Map<number, TSearch>())',
    'interactionNodeCacheRef.current.set(node.id, node)',
    'interactionSearchCacheRef.current.set(result.node.id, result)',
    'projection.nodeByID.set(id, node)',
    'projection.searchByID.set(id, result)',
  ]) {
    assert.ok(workspace.includes(token), 'workspace interaction metadata cache missing: ' + token)
  }

  assert.ok(
    explorer.includes('selectionItemCacheRef.current.get(explorerIDKey(id))'),
    'selected FileExplorer items must survive render-page eviction',
  )
  assert.ok(
    explorer.includes('virtualCollection?.retainInteractionIDs?.(ids)'),
    'selection changes must prune raw interaction metadata to the retained selection',
  )
  assert.ok(
    workspace.includes('retainInteractionIDs: (ids) =>'),
    'workspace must release raw metadata that is no longer selected',
  )
})

test('VirtualCollection interaction scope invalidates stale selection intents', () => {
  assert.ok(
    explorer.includes('interactionKey?: string'),
    'VirtualCollection must expose an interaction scope key',
  )
  assert.ok(
    workspace.includes('interactionKey: interactionCacheKey'),
    'workspace must bind the interaction key to tab/directory/search/sort state',
  )
  for (const token of [
    'typeSelectIntentRef.current += 1',
    'selectionIntentRef.current += 1',
    'quickLookIntentRef.current += 1',
    'selectionItemCacheRef.current.clear()',
    'setSelectionAnchorIndex(null)',
    'setActiveLogicalIndex(null)',
  ]) {
    assert.ok(explorer.includes(token), 'interaction-scope invalidation missing: ' + token)
  }
})

test('FileExplorer design makes VirtualCollection interaction parity normative', () => {
  for (const phrase of [
    'Ctrl/Cmd+A',
    'Shift-click',
    'Type-to-select',
    'Quick Look',
    'File operations from a virtual selection',
    'Directory/search/tab/sort/grouping generation changes',
  ]) {
    assert.ok(design.includes(phrase), 'FileExplorer design missing VirtualCollection rule: ' + phrase)
  }
})


test('interaction-scope change cancels queued marquee selection work', () => {
  const scopeStart = explorer.indexOf('const interactionScopeKey =')
  const scopeEnd = explorer.indexOf(
    'useEffect(() => {\n    if (!editingPath) setPathDraft(derivedPath)',
    scopeStart,
  )
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart, 'FileExplorer interaction-scope effect is missing')
  const scopeBlock = explorer.slice(scopeStart, scopeEnd)

  for (const token of [
    'window.cancelAnimationFrame(marqueeFrameRef.current)',
    'marqueeFrameRef.current = null',
    'marqueePointerRef.current = null',
    'marqueeSessionRef.current = null',
    'setMarqueeRect(null)',
  ]) {
    assert.ok(
      scopeBlock.includes(token),
      'interaction-scope change must cancel stale marquee work before old RAF can rewrite the new selection: ' + token,
    )
  }

  assert.ok(
    scopeBlock.indexOf('window.cancelAnimationFrame(marqueeFrameRef.current)') <
      scopeBlock.indexOf('onSelectionChange?.([])'),
    'queued marquee RAF must be cancelled before the new interaction scope publishes its cleared selection',
  )
})


test('interaction-scope change closes stale item-bound menu and rename sessions', () => {
  const scopeStart = explorer.indexOf('const interactionScopeKey =')
  const scopeEnd = explorer.indexOf(
    'useEffect(() => {\n    if (!editingPath) setPathDraft(derivedPath)',
    scopeStart,
  )
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart, 'FileExplorer interaction-scope effect is missing')
  const scopeBlock = explorer.slice(scopeStart, scopeEnd)

  for (const token of [
    'setContextMenu(null)',
    'renameCancelledRef.current = true',
    'setRenamingID(null)',
    "setRenameDraft('')",
    "setRenameError('')",
  ]) {
    assert.ok(
      scopeBlock.includes(token),
      'interaction-scope change must dispose stale item-bound UI before old directory actions can leak into the new workspace: ' + token,
    )
  }

  assert.ok(
    scopeBlock.indexOf('setContextMenu(null)') <
      scopeBlock.indexOf('onSelectionChange?.([])'),
    'stale item menu must close as part of the same scope invalidation before the new selection state is published',
  )
})


test('interaction-scope change abandons stale address-bar edit state', () => {
  const scopeStart = explorer.indexOf('const interactionScopeKey =')
  const scopeEnd = explorer.indexOf(
    'useEffect(() => {\n    if (!editingPath) setPathDraft(derivedPath)',
    scopeStart,
  )
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart, 'FileExplorer interaction-scope effect is missing')
  const scopeBlock = explorer.slice(scopeStart, scopeEnd)

  for (const token of [
    'setEditingPath(false)',
    'setPathDraft(derivedPath)',
  ]) {
    assert.ok(
      scopeBlock.includes(token),
      'a tab/directory/search/sort/grouping scope change must abandon the old address-bar draft before it can be submitted in the new workspace: ' + token,
    )
  }

  assert.ok(
    scopeBlock.indexOf('setEditingPath(false)') <
      scopeBlock.indexOf('onSelectionChange?.([])'),
    'stale address editing must end as part of scope invalidation before the new workspace publishes interaction state',
  )
})


test('interaction-scope change invalidates an in-flight inline rename submission', () => {
  const scopeStart = explorer.indexOf('const interactionScopeKey =')
  const scopeEnd = explorer.indexOf(
    'useEffect(() => {\n    if (!editingPath) setPathDraft(derivedPath)',
    scopeStart,
  )
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart, 'FileExplorer interaction-scope effect is missing')
  const scopeBlock = explorer.slice(scopeStart, scopeEnd)

  for (const token of [
    'renameIntentRef.current += 1',
    'renameSubmittingRef.current = false',
    'setRenameSubmitting(false)',
  ]) {
    assert.ok(
      scopeBlock.includes(token),
      'scope change must release and invalidate the old inline-rename submit lifecycle: ' + token,
    )
  }

  const submitStart = explorer.indexOf('const submitRename = async')
  const submitEnd = explorer.indexOf('useEffect(() => {', submitStart)
  assert.ok(submitStart >= 0 && submitEnd > submitStart, 'inline rename submit function is missing')
  const submitBlock = explorer.slice(submitStart, submitEnd)

  assert.ok(
    submitBlock.includes('const renameIntent = ++renameIntentRef.current'),
    'each inline rename submit must own a monotonic intent token',
  )
  assert.ok(
    submitBlock.includes('if (renameIntentRef.current !== renameIntent) return'),
    'a rename completion from the old workspace must stop before publishing success/error UI into the new workspace',
  )
  assert.ok(
    submitBlock.includes('if (renameIntentRef.current === renameIntent)'),
    'stale rename finally work must not clear submitting state owned by a newer rename session',
  )
})
