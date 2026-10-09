import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveFileExplorer } from '__EXPLORER__'
import { useXDriveFileExplorerWorkspace } from '__WORKSPACE__'
import { useXDriveVirtualCollection } from '__VIRTUAL__'
import { useXDriveFileExplorerOperationController } from '__OPERATIONS__'
import { XDriveFileExplorerDestinationDialog } from '__DESTINATION__'
import { XDriveAppearanceThemeProvider } from '__THEME__'
import { xDriveFileExplorerLoadChildDirectoryPage } from '__MODEL__'

// Real controllers and renderer. Only range transport and queued-operation
// acceptance are fixtures; no pointer/drag business logic is supplied here.
const root = { id: 1, name: '我的文件' }
const home = { id: 2, name: '当前目录' }
const stamp = '2026-10-09T00:00:00Z'
const count = 1024
const fixtureName = new URL(location.href).searchParams.get('fixture') || 'baseline'
const stationaryTargetFixture = fixtureName === 'stationary-late-target'
const empty: any[] = []
const harness = ((window as any).touchDragHarness = {
  selectedIDs: [] as any[], events: [] as any[], requests: [] as any[], errors: [] as string[], mounts: 0,
  holdRanges: stationaryTargetFixture, heldRanges: [] as Array<{ offset: number; resolve: () => void }>, releaseHeldRanges: () => {},
})
const record = (type: string, value?: any) => harness.events.push({ type, value })
const error = (value: any) => harness.errors.push(String(value?.message ?? value))
const nodeAt = (index: number, parentID = 2) => ({
  id: index === 0 ? 201 : index === 1 ? 202 : index === 2 ? 30 : index === 240 ? 40 : 1000 + index,
  name: index === 0 ? '000-源一.txt' : index === 1 ? '001-源二.txt' : index === 2 ? '002-目标目录' : index === 240 ? '240-后续目标目录' : `${String(index).padStart(3, '0')}-普通文件.txt`,
  parent_id: parentID, type: index === 2 || index === 240 || (stationaryTargetFixture && index >= 200) ? 'dir' : 'file',
  revision: 501 + index, size: index === 2 || index === 240 ? 0 : 4096 + index,
  created_at: stamp, updated_at: stamp,
})
const rawHome = { ...home, parent_id: 1, type: 'dir', revision: 1, size: 0, created_at: stamp, updated_at: stamp }
const loadRoot = async () => root
const loadSearchRange = async () => { throw new Error('Search is outside this first-red fixture') }
const findChildDirectory = async () => null
const searchCrumbsForResult = (value: any) => value.crumbs
const selectionChanged = (ids: any[]) => { harness.selectedIDs = [...ids]; record('selection', ids) }
const submitOperation = async (plan: any) => {
  harness.requests.push({ type: 'operation-submit', plan: JSON.parse(JSON.stringify(plan)) })
  return { id: 'touch-drag-operation-1', type: plan.operation, status: 'queued', total_items: plan.count, processed_items: 0, total_bytes: 8193, processed_bytes: 0, percent: 0, retryable: false, created_at: stamp, updated_at: stamp }
}
const loadDirectoryPage = (parentID: number, cursor?: string) => xDriveFileExplorerLoadChildDirectoryPage({
  parentID, cursor,
  loadPage: async (id: number, options: any) => {
    if (options.limit !== 200 || options.sort !== 'name' || options.order !== 'asc' || options.cursor) throw new Error('Unexpected destination page request')
    harness.requests.push({ type: 'destination-page', id, options })
    return { items: id === 1 ? [rawHome] : id === 2 ? [nodeAt(2), nodeAt(240)] : [], has_more: false, next_cursor: '' }
  },
})

function Fixture() {
  const [session, setSession] = useState(fixtureName === 'baseline' ? 'touch-drag-session-1' : `touch-drag-session-${fixtureName}`)
  const [controlledIDs, setControlledIDs] = useState<any[] | undefined>()
  const [explorerVisible, setExplorerVisible] = useState(true)
  const [directory, setDirectory] = useState({ id: 2, crumbs: [root, home] })
  const loadRange = useCallback(async (range: any, signal: AbortSignal) => {
    if (!Number.isInteger(range.offset) || range.offset < 0 || !Number.isInteger(range.limit) || range.limit < 1 || range.limit > 200) throw new Error('Unbounded directory range')
    const request = { type: 'directory-range', parentID: directory.id, ...range, aborted: false }
    harness.requests.push(request)
    signal.addEventListener('abort', () => { request.aborted = true }, { once: true })
    await new Promise<void>((resolve) => setTimeout(resolve, 12))
    if (harness.holdRanges && range.offset >= 200) await new Promise<void>(resolve => harness.heldRanges.push({ offset: range.offset, resolve }))
    return { ...range, totalCount: count, items: Array.from({ length: Math.min(range.limit, count - range.offset) }, (_, index) => nodeAt(range.offset + index, directory.id)) }
  }, [directory.id, session])
  const collection = useXDriveVirtualCollection({ queryKey: `${session}:${directory.id}`, loadRange, onError: error })
  useEffect(() => { void collection.ensureViewport(0, 0) }, [collection.ensureViewport])
  const virtual = useMemo(() => ({ itemCount: collection.totalCount ?? 0, loadedItems: collection.loadedItems, itemAt: collection.itemAt, ensureViewport: collection.ensureViewport, collectRange: collection.collectRange, groups: empty }), [collection.totalCount, collection.loadedItems, collection.itemAt, collection.ensureViewport, collection.collectRange])
  const onLoadDirectory = useCallback(async (id: number, crumbs: any[]) => { record('navigate', { id, crumbs }); setDirectory((current) => current.id === id ? current : { id, crumbs }); return true }, [])
  const initial = useMemo(() => ({ activeTabID: 'tab-1', tabs: [{ id: 'tab-1', history: [[root, home]], historyIndex: 0, viewMode: 'details', sort: { key: 'name', direction: 'asc' }, grouping: { groupBy: 'none', foldersFirst: false } }] }), [])
  const workspace = useXDriveFileExplorerWorkspace({ items: empty, crumbs: directory.crumbs, directoryVirtualCollection: virtual, initialNavigationState: initial as any, viewModeStorageKey: `xdrive.m10.view.${fixtureName}`, navigationSessionStorageKey: session, onLoadDirectory, loadSearchRange, loadRoot, findChildDirectory, searchCrumbsForResult, onError: error })
  const operations = useXDriveFileExplorerOperationController({ lifecycleKey: session, nodeByID: workspace.nodeByID, currentID: directory.id, maxItems: 200, planPaste: workspace.planPaste, completePaste: workspace.completePaste, canPaste: workspace.canPaste, clearSearch: workspace.clearSearch, submitOperation, onQueued: (value: any) => record('queued', value), onFeedback: (tone: string, message: string) => record('feedback', { tone, message }), onError: error })
  const destination = operations.destinationRequest
  const reason = (action: string, items: readonly any[], selectedCount: number) => {
    if (!selectedCount) return '请先选择项目'
    if (items.length !== selectedCount || items.some((item) => !workspace.nodeByID.has(Number(item.id)))) return '部分所选项目不可用'
    if (['move-to', 'copy-to', 'copy', 'cut', 'delete'].includes(action) && selectedCount > 200) return '此操作最多支持200个项目'
    return null
  }
  useEffect(() => { harness.mounts += 1 }, [])
  harness.releaseHeldRanges = () => { harness.holdRanges = false; const pending = harness.heldRanges.splice(0); pending.forEach(entry => entry.resolve()) }
  harness.workspace = workspace
  harness.changeSession = () => setSession((value) => value + '-new')
  harness.setControlledIDs = (ids: any[] | undefined) => setControlledIDs(ids ? [...ids] : undefined)
  harness.hideExplorer = () => setExplorerVisible(false)
  harness.state = { session, directoryID: directory.id, count: virtual.itemCount, loadedIndexes: Array.from(virtual.loadedItems.keys()), destination, controlledIDs, mounts: harness.mounts }
  return <div style={{ width: '100%', height: '100dvh', display: 'flex', minHeight: 0, overflow: 'hidden' }}>
    {explorerVisible ? <XDriveFileExplorer {...({
      presentation: 'workspace', interactionLifecycleKey: session, keyboardProfile: 'windows',
      items: workspace.explorerItems, crumbs: workspace.explorerCrumbs, virtualCollection: workspace.explorerVirtualCollection, viewState: workspace.explorerViewState,
      loading: collection.totalCount === null, externallySorted: workspace.externallySorted,
      viewMode: workspace.viewMode, onViewModeChange: workspace.setViewMode, sort: workspace.sort, onSortChange: workspace.changeSort, grouping: workspace.grouping, onGroupingChange: workspace.changeGrouping,
      selectedIDs: controlledIDs, onSelectionChange: selectionChanged, onOpenItem: (item: any) => { record('open-item', item.id); workspace.openItem(item, (node: any) => record('file-open', node.id)) },
      onCrumbClick: (_crumb: any, index: number) => workspace.navigateToCrumb(index), onBack: workspace.goBack, onForward: workspace.goForward, onUp: workspace.goUp,
      canGoBack: workspace.canGoBack, canGoForward: workspace.canGoForward, canGoUp: workspace.canGoUp,
      onRefresh: workspace.refresh, onPathSubmit: workspace.submitPath,
      onCopyItems: workspace.copyItems, onCutItems: workspace.cutItems, onPaste: operations.pasteClipboard, canPaste: operations.canPaste,
      onMoveItemsTo: (items: any[]) => operations.openDestination('move', items, directory.crumbs), onCopyItemsTo: (items: any[]) => operations.openDestination('copy', items, directory.crumbs),
      getSelectionActionDisabledReason: reason,
      onDropItemsToFolder: (items: any[], target: any, operation: 'move' | 'copy') => { record('drop-folder', { items: items.map((item) => ({ id: item.id, revision: item.revision })), targetID: target.id, operation }); void operations.dropItemsToFolder(items, target, operation) },
      onDropItemsToCrumb: (items: any[], crumb: any, operation: 'move' | 'copy') => { record('drop-crumb', { items: items.map((item) => ({ id: item.id, revision: item.revision })), targetID: crumb.id, operation }); void operations.dropItemsToCrumb(items, crumb, operation) },
    } as any)} /> : null}
    <XDriveFileExplorerDestinationDialog open={Boolean(destination)} lifecycleKey={session} operation={destination?.operation ?? 'move'} sources={destination?.sources ?? []} initialCrumbs={destination?.initialCrumbs ?? []} loadDirectoryPage={loadDirectoryPage} onSubmit={operations.submitDestination} onClose={operations.closeDestination} />
  </div>
}
createRoot(document.getElementById('root')!).render(<XDriveAppearanceThemeProvider><Fixture /></XDriveAppearanceThemeProvider>)
