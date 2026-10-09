import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveFileExplorer } from '__FILE_EXPLORER__'
import { useXDriveFileExplorerWorkspace } from '__WORKSPACE__'
import { useXDriveVirtualCollection } from '__VIRTUAL_COLLECTION__'
import { XDriveFileExplorerSearchFilters } from '__SEARCH_FILTERS__'
import { xDriveFileExplorerStandardItemMenuItems } from '__ACTIONS__'
import { xDriveFileExplorerSearchFilterLabels } from '__SEARCH_MODEL__'
import { XDriveAppearanceThemeProvider } from '__THEME__'

declare const __HAS_ACTION_FEEDBACK__: boolean
const ActionFeedback = __HAS_ACTION_FEEDBACK__ ? lazy(() => import('__ACTION_FEEDBACK__').then((module) => ({ default: module.XDriveFileExplorerActionFeedback }))) : null

// Platform range loaders and operation callbacks are the only fixtures. Selection,
// retained metadata, paging, Search, history and rendering use production code.
const params = new URLSearchParams(location.search)
const total = Number(params.get('count') ?? 1024)
const initialSearch = params.get('scope') === 'search'
const initialMode = params.get('mode') === 'grid' ? 'grid' : 'details'
const root = { id: 1, name: '我的文件' }
const folder = { id: 2, name: '项目目录' }
const stamp = '2026-10-09T00:00:00Z'
const emptyItems: any[] = []
const emptyGroups: any[] = []
const tags = [{ id: 9, name: '研究' }]
const harness = ((window as any).selectionHarness = {
  selectedIDs: [] as any[], requests: [] as any[], events: [] as any[], errors: [] as string[],
  pending: [] as any[], holdOffset: null as number | null, activeRequests: 0, peakRequests: 0,
})
const record = (type: string, value?: unknown) => harness.events.push({ type, value })
const onError = (error: unknown) => harness.errors.push(String((error as Error)?.message || error))
const onSelectionChange = (ids: any[]) => { harness.selectedIDs = [...ids]; record('selection', [...ids]) }
const nodeAt = (index: number, parentID: number, search = false, query = '项目') => ({
  id: (search ? query === '新搜索' ? 200000 : 100000 : parentID * 10000) + index,
  parent_id: parentID,
  name: `${search ? '结果' : '目录'}-${String(index).padStart(4, '0')}${index % 13 === 0 ? '-文件夹' : '.txt'}`,
  type: index % 13 === 0 ? 'dir' : 'file',
  size: index % 13 === 0 ? 0 : 4096 + index,
  revision: index + 1, created_at: stamp, updated_at: stamp,
})
async function rangeBoundary(type: string, offset: number, limit: number, details: any, signal?: AbortSignal) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error(`Unexpected fixture range ${type} ${offset}:${limit}`)
  }
  const request = { type, offset, limit, ...details, aborted: false, completed: false }
  harness.requests.push(request)
  signal?.addEventListener('abort', () => { request.aborted = true }, { once: true })
  harness.activeRequests += 1
  harness.peakRequests = Math.max(harness.peakRequests, harness.activeRequests)
  try {
    if (harness.holdOffset !== null && offset >= harness.holdOffset) {
      // A released transport may complete after cancellation. Production must
      // reject that obsolete selection, including transports without AbortSignal.
      await new Promise<void>((resolve) => harness.pending.push({ type, offset, resolve }))
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 12))
    request.completed = true
  } finally { harness.activeRequests -= 1 }
}
async function loadSearchRange(query: string, filters: any, grouping: any, sort: any, offset: number, limit: number) {
  await rangeBoundary('search', offset, limit, { query, filters: { ...filters }, sort: { ...sort }, grouping: { ...grouping } })
  const count = query === '空结果' ? 0 : total
  return {
    offset, limit, totalCount: count, groups: emptyGroups,
    items: Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, i) => {
      const index = offset + i
      const parent = { id: 500 + Math.floor(index / 100), name: `结果目录-${Math.floor(index / 100)}` }
      const node = nodeAt(index, parent.id, true, query)
      return { node, path: `/${parent.name}/${node.name}`, crumbs: node.type === 'dir' ? [root, parent, { id: node.id, name: node.name }] : [root, parent] }
    }),
  }
}
const loadRoot = async () => root
const findChildDirectory = async () => null
const searchCrumbsForResult = (result: any) => result.crumbs

function Fixture() {
  const [session, setSession] = useState('selection-session-1')
  const [directory, setDirectory] = useState({ id: folder.id, crumbs: [root, folder], sort: { key: 'name', direction: 'asc' }, grouping: { groupBy: 'none', foldersFirst: false } })
  const [missingIDs, setMissingIDs] = useState<number[]>([])
  const [controlledIDs, setControlledIDs] = useState<any[] | undefined>(undefined)
  const [feedback, setFeedback] = useState<any>(null)
  const loadDirectoryRange = useCallback(async (range: any, signal: AbortSignal) => {
    await rangeBoundary('directory', range.offset, range.limit, { id: directory.id, session }, signal)
    return {
      ...range, totalCount: total,
      items: Array.from({ length: Math.max(0, Math.min(range.limit, total - range.offset)) }, (_, i) => nodeAt(range.offset + i, directory.id)),
    }
  }, [directory.id, session])
  const collection = useXDriveVirtualCollection({
    queryKey: `${session}:directory:${directory.id}:${directory.sort.key}:${directory.sort.direction}`,
    loadRange: loadDirectoryRange, onError,
  })
  useEffect(() => { void collection.ensureViewport(0, 0) }, [collection.ensureViewport])
  const directoryVirtualCollection = useMemo(() => ({
    itemCount: collection.totalCount ?? 0, loadedItems: collection.loadedItems,
    itemAt: collection.itemAt, ensureViewport: collection.ensureViewport,
    collectRange: collection.collectRange, groups: emptyGroups,
  }), [collection.totalCount, collection.loadedItems, collection.itemAt, collection.ensureViewport, collection.collectRange])
  const onLoadDirectory = useCallback(async (id: number, crumbs: any[], sort: any, grouping: any) => {
    setDirectory((previous) => previous.id === id && JSON.stringify(previous.sort) === JSON.stringify(sort) && JSON.stringify(previous.grouping) === JSON.stringify(grouping)
      ? previous : { id, crumbs: crumbs.map((crumb) => ({ ...crumb })), sort: { ...sort }, grouping: { ...grouping } })
    return true
  }, [])
  const initialNavigationState = useMemo(() => ({
    activeTabID: 'tab-1', tabs: [{ id: 'tab-1', history: [[root, folder]], historyIndex: 0,
      viewMode: initialMode, sort: { key: 'name', direction: 'asc' }, grouping: { groupBy: 'none', foldersFirst: false } }],
  }), [])
  const workspace = useXDriveFileExplorerWorkspace({
    items: emptyItems, crumbs: directory.crumbs, directoryVirtualCollection,
    viewModeStorageKey: 'xdrive.selection-fixture.view', navigationSessionStorageKey: session,
    initialNavigationState: initialNavigationState as any,
    onLoadDirectory, loadSearchRange, loadRoot, findChildDirectory, searchCrumbsForResult, onError,
  })
  const searchActive = workspace.searchResults !== null
  const count = workspace.explorerVirtualCollection?.itemCount ?? 0
  const missing = new Set(missingIDs)
  const actionReason = (action: string, items: readonly any[], selectionCount: number) => {
    if (selectionCount === 0) return '请先选择项目'
    if (items.length !== selectionCount || items.some((item) => missing.has(Number(item.id)) || !workspace.nodeByID.has(Number(item.id)))) return '部分所选项目已不可用，请重新选择'
    if (['copy', 'cut', 'delete', 'move-to', 'copy-to'].includes(action) && selectionCount > 200) return '此操作最多支持 200 个项目，请减少选择'
    // This fixture enables archive download, whose real Server/IPC root cap is
    // 1,000. Selection capacity is independent of every operation limit.
    if (action === 'download' && selectionCount > 1000) return '一次下载最多 1000 个项目，请减少选择'
    return null
  }
  const submit = (action: string, items: any[]) => {
    const nodes = items.map((item) => missing.has(Number(item.id)) ? undefined : workspace.nodeByID.get(Number(item.id)))
    const selectedCount = new Set((controlledIDs ?? harness.selectedIDs).map(String)).size
    record(action, { ids: items.map((item) => item.id), rawIDs: nodes.map((node) => node?.id ?? null), revisions: nodes.map((node) => node?.revision ?? null), kinds: items.map((item) => item.kind), selectedCount })
  }
  const openItem = (item: any) => workspace.openItem(item, (node: any) => record('open', node.id))
  harness.state = {
    count, directoryID: directory.id, crumbs: directory.crumbs.map((crumb) => ({ ...crumb })),
    query: workspace.searchState.query, searchValue: workspace.searchValue, filters: workspace.searchFilters,
    searchActive, searchReady: workspace.searchReady, searchLoading: workspace.searchLoading,
    loadedIndexes: [...(workspace.explorerVirtualCollection?.loadedItems?.keys() ?? [])],
    sort: workspace.sort, grouping: workspace.grouping, session, missingIDs,
  }
  harness.current = workspace
  harness.releaseRanges = () => { harness.holdOffset = null; for (const pending of harness.pending.splice(0)) pending.resolve() }
  harness.setMissingIDs = setMissingIDs
  harness.setControlledIDs = setControlledIDs
  harness.setFeedback = setFeedback
  harness.changeSession = () => setSession((value) => `${value}-new`)
  harness.resetEvents = () => { harness.events = []; harness.requests = []; harness.errors = []; harness.peakRequests = harness.activeRequests }
  useEffect(() => { if (initialSearch) void workspace.applySearch('项目', { tagID: 9 }) }, [])

  return (
    <div style={{ width: '100%', height: '100dvh', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <XDriveFileExplorer {...({
        presentation: 'workspace', interactionLifecycleKey: session, keyboardProfile: 'windows',
        items: workspace.explorerItems, crumbs: workspace.explorerCrumbs,
        virtualCollection: workspace.explorerVirtualCollection, viewState: workspace.explorerViewState,
        loading: collection.totalCount === null || workspace.searchLoading, externallySorted: workspace.externallySorted,
        viewMode: workspace.viewMode, onViewModeChange: workspace.setViewMode,
        sort: workspace.sort, onSortChange: workspace.changeSort,
        grouping: workspace.grouping, onGroupingChange: workspace.changeGrouping,
        selectedIDs: controlledIDs, onSelectionChange, onOpenItem: openItem,
        onCrumbClick: (_crumb: any, index: number) => workspace.navigateToCrumb(index),
        canGoBack: workspace.canGoBack, canGoForward: workspace.canGoForward, canGoUp: workspace.canGoUp,
        onBack: workspace.goBack, onForward: workspace.goForward, onUp: workspace.goUp,
        onRefresh: workspace.refresh, onPathSubmit: workspace.submitPath,
        searchValue: workspace.searchValue, onSearchValueChange: workspace.changeSearchValue, onSearch: workspace.submitSearch,
        searchSummary: searchActive ? {
          query: workspace.searchState.query,
          conditions: xDriveFileExplorerSearchFilterLabels(workspace.searchFilters, { tagOptions: tags }),
          resultCount: workspace.searchReady ? count : null,
          loading: workspace.searchLoading, error: workspace.searchError, onClear: workspace.clearSearch, onRetry: workspace.retrySearch,
        } : undefined,
        onUpload: () => record('upload'), onCreateFolder: () => record('create-folder'),
        onCopyItems: (items: any[]) => submit('copy', items), onCutItems: (items: any[]) => submit('cut', items),
        onDownloadItems: (items: any[]) => submit('download', items), folderDownloadSupported: true,
        onDeleteItems: (items: any[]) => submit('delete', items),
        onPaste: () => record('paste'), canPaste: true, getSelectionActionDisabledReason: actionReason,
        actionFeedback: feedback && ActionFeedback ? <Suspense fallback={null}><ActionFeedback value={feedback}
          onViewTask={(id: string) => record('view-task', id)}
          onDismiss={() => { record('dismiss-feedback'); setFeedback(null) }} /></Suspense> : undefined,
        getItemMenuItems: (item: any) => xDriveFileExplorerStandardItemMenuItems({
          kind: item.kind, onOpen: () => { void openItem(item) },
          onCopy: () => submit('copy', [item]), onCut: () => submit('cut', [item]),
          onDownload: () => submit('download', [item]), onDelete: () => submit('delete', [item]),
        } as any),
        commandBarEnd: <XDriveFileExplorerSearchFilters filters={workspace.searchFilters} tagOptions={tags}
          onChange={workspace.changeSearchFilters} canSaveSearch={searchActive} onSaveSearch={() => record('save-search')} />,
      } as any)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light"><Fixture /></XDriveAppearanceThemeProvider>,
)
