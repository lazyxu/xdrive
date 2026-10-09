import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveFileExplorer } from '__FILE_EXPLORER__'
import { useXDriveFileExplorerWorkspace } from '__WORKSPACE__'
import { XDriveFileExplorerSearchFilters } from '__SEARCH_FILTERS__'
import { xDriveFileExplorerStandardItemMenuItems } from '__ACTIONS__'
import { XDriveAppearanceThemeProvider } from '__THEME__'
import * as searchModel from '__SEARCH_MODEL__'

// Only the platform directory/Server range boundary is a fixture. Workspace,
// Navigation, Search, sparse VirtualCollection and the React/MUI renderer are real.
const root = { id: 1, name: '我的文件' }
const stamp = '2026-10-09T00:00:00Z'
const total = 4096
const params = new URLSearchParams(location.search)
const initialMode = params.get('mode') === 'grid' ? 'grid' : params.get('mode') === 'columns' ? 'columns' : 'details'
const sources = [{ id: 7, name: '项目同步' }]
const tags = [{ id: 9, name: '研究' }]
const initialFilters = { sourceID: 7, tagID: 9 }
const harness = ((window as any).searchReturnHarness = {
  requests: [] as any[], events: [] as any[], errors: [] as string[], selectedIDs: [] as any[],
  pending: [] as any[], failNextDirectory: false, failNextSearch: false, holdSearchOffset: null as number | null,
  namespaceOffset: 0, failReturnWindow: false,
})
const record = (type: string, value?: unknown) => harness.events.push({ type, value })
const onError = (error: unknown) => harness.errors.push(String((error as Error)?.message || error))
const onSelectionChange = (ids: any[]) => { harness.selectedIDs = [...ids]; record('selection', ids) }
const node = (id: number, name: string, type: 'dir' | 'file', parentID = 1) => ({
  id, name, type, parent_id: parentID, size: type === 'dir' ? 0 : id * 3,
  revision: 1, created_at: stamp, updated_at: stamp,
})
const initialItems = [node(2, '起始文件夹', 'dir'), ...Array.from({ length: 32 }, (_, i) => node(100 + i, `目录文件-${i}.txt`, 'file'))]
const resultAt = (index: number, query: string, sort: any) => {
  const ordinal = sort.direction === 'desc' ? total - index - 1 : index
  const id = (query === '新搜索' ? 100000 : 10000) + ordinal + harness.namespaceOffset
  const parent = { id: 500 + Math.floor(ordinal / 100), name: `项目目录-${Math.floor(ordinal / 100)}` }
  const kind = ordinal % 7 === 0 ? 'dir' : 'file'
  const name = `结果-${String(ordinal).padStart(6, '0')}${kind === 'dir' ? '-文件夹' : '.txt'}`
  const item = node(id, name, kind, parent.id)
  const crumbs = kind === 'dir' ? [root, parent, { id, name }] : [root, parent]
  return { node: item, path: `/${parent.name}/${name}`, crumbs }
}
const groupsFor = (grouping: any, count: number) => grouping.groupBy === 'none' || count === 0 ? []
  : Array.from({ length: 4 }, (_, i) => ({
    key: grouping.groupBy === 'modified' ? `month:2026-${String(10 - i).padStart(2, '0')}`
      : grouping.groupBy === 'type' ? `ext:${['txt', 'pdf', 'jpg', 'md'][i]}` : ['tiny', 'small', 'medium', 'large'][i],
    start_index: i * (count / 4), item_count: count / 4,
  }))
async function loadSearchRange(query: string, filters: any, grouping: any, sort: any, offset: number, limit: number) {
  harness.requests.push({ type: 'search', query, filters: { ...filters }, grouping: { ...grouping }, sort: { ...sort }, offset, limit })
  if (harness.holdSearchOffset !== null && offset >= harness.holdSearchOffset) {
    await new Promise<void>((resolve) => harness.pending.push({ offset, resolve }))
  }
  if (harness.failNextSearch) { harness.failNextSearch = false; throw new Error('测试：搜索范围暂时不可用') }
  if (harness.failReturnWindow && offset >= 2000) throw new Error('测试：搜索返回窗口暂时不可用')
  const count = query === '空结果' ? 0 : total
  return {
    items: Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, i) => resultAt(offset + i, query, sort)),
    offset, limit, totalCount: count, groups: groupsFor(grouping, count),
  }
}
const loadRoot = async () => root
const findChildDirectory = async () => null
const searchCrumbsForResult = (result: any) => result.crumbs
const persist = (state: any) => { harness.persisted = JSON.parse(JSON.stringify(state)) }

function Fixture() {
  const [items, setItems] = useState(initialItems)
  const [crumbs, setCrumbs] = useState([root])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const initialNavigationState = useMemo(() => ({
    activeTabID: 'tab-1', tabs: [{ id: 'tab-1', history: [[root]], historyIndex: 0,
      viewMode: initialMode, sort: { key: 'updated', direction: 'desc' },
      grouping: { groupBy: 'modified', foldersFirst: false } }],
  }), [])
  const onLoadDirectory = useCallback(async (id: number, nextCrumbs: any[], sort: any, grouping: any) => {
    harness.requests.push({ type: 'directory', id, crumbs: nextCrumbs.map((c) => c.id), sort: { ...sort }, grouping: { ...grouping } })
    if (harness.failNextDirectory) { harness.failNextDirectory = false; return false }
    setDirectoryLoading(true)
    setCrumbs(nextCrumbs.map((c) => ({ ...c })))
    setItems(id === 1 ? initialItems : [node(id * 100 + 1, '目标目录内文件.txt', 'file', id), node(id * 100 + 2, '目标目录内文件夹', 'dir', id)])
    setDirectoryLoading(false)
    return true
  }, [])
  const workspace = useXDriveFileExplorerWorkspace({
    items, crumbs, viewModeStorageKey: 'xdrive.search-return-fixture.view',
    navigationSessionStorageKey: 'xdrive.search-return-fixture.session',
    initialNavigationState: initialNavigationState as any,
    onLoadDirectory, loadSearchRange, loadRoot, findChildDirectory, searchCrumbsForResult,
    onNavigationStateChange: persist, onError,
  })
  const state = workspace as any
  const searchActive = workspace.searchResults !== null
  const labelFunction = (searchModel as any)[['xDriveFileExplorerSearch', 'FilterLabels'].join('')]
  const conditions = labelFunction
    ? labelFunction(workspace.searchFilters, { sourceOptions: sources, tagOptions: tags })
    : [workspace.searchFilters.sourceID ? '同步文件夹：项目同步' : '', workspace.searchFilters.tagID ? '标签：研究' : ''].filter(Boolean)
  const openItem = (item: any) => workspace.openItem(item, (value: any) => record('file-open', value.id))
  const loadColumnPage = useCallback(async (parentID: any) => ({
    items: (Number(parentID) === 1 ? initialItems : [node(Number(parentID) * 100 + 1, '目标目录内文件.txt', 'file', Number(parentID))])
      .map((item) => ({ id: item.id, name: item.name, kind: item.type, size: item.size })),
  }), [])

  harness.state = {
    query: workspace.searchState.query, value: workspace.searchValue, filters: workspace.searchFilters,
    sort: workspace.sort, grouping: workspace.grouping, preferredView: workspace.viewMode,
    searchActive, searchLoading: workspace.searchLoading, searchReady: state.searchReady,
    searchError: state.searchError, count: workspace.searchVirtualCollection?.itemCount ?? null,
    loadedIndexes: [...workspace.searchVirtualItems.keys()], crumbs: crumbs.map((c) => c.id),
    activeTabID: workspace.activeTabID, historyKey: state.activeHistoryEntryKey,
    canGoBack: workspace.canGoBack, canGoForward: workspace.canGoForward,
  }
  harness.current = workspace
  harness.returnSnapshot = () => state.explorerViewState?.readSnapshot()
  harness.resetEvents = () => { harness.requests = []; harness.events = []; harness.errors = [] }
  harness.releaseSearch = () => { harness.holdSearchOffset = null; for (const pending of harness.pending.splice(0)) pending.resolve() }
  // The fixture starts with a normal user Search request so every case exercises
  // real search state and sparse pages without a fabricated results prop.
  useEffect(() => { void workspace.applySearch('项目', initialFilters) }, [])

  return (
    <div style={{ width: '100%', height: '100dvh', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <XDriveFileExplorer {...({
        presentation: 'workspace', interactionLifecycleKey: 'search-return-fixture', keyboardProfile: 'windows',
        items: workspace.explorerItems, crumbs: workspace.explorerCrumbs,
        virtualCollection: workspace.explorerVirtualCollection, viewState: state.explorerViewState,
        loading: directoryLoading || workspace.searchLoading, externallySorted: workspace.externallySorted,
        viewMode: workspace.viewMode, onViewModeChange: (mode: any) => { record('view-choice', mode); workspace.setViewMode(mode) },
        sort: workspace.sort, onSortChange: workspace.changeSort,
        grouping: workspace.grouping, onGroupingChange: workspace.changeGrouping,
        onSelectionChange, onOpenItem: openItem,
        onCrumbClick: (_crumb: any, index: number) => workspace.navigateToCrumb(index),
        canGoBack: workspace.canGoBack, canGoForward: workspace.canGoForward, canGoUp: workspace.canGoUp,
        onBack: workspace.goBack, onForward: workspace.goForward, onUp: workspace.goUp,
        onRefresh: workspace.refresh, onPathSubmit: workspace.submitPath,
        searchValue: workspace.searchValue, onSearchValueChange: workspace.changeSearchValue,
        onSearch: workspace.submitSearch,
        searchSummary: searchActive ? {
          query: workspace.searchState.query, conditions,
          resultCount: state.searchReady === false ? null : workspace.searchVirtualCollection?.itemCount ?? null,
          loading: workspace.searchLoading, error: state.searchError, onClear: workspace.clearSearch, onRetry: state.retrySearch,
        } : undefined,
        loadColumnPage: searchActive ? undefined : loadColumnPage,
        onColumnNavigate: searchActive ? undefined : workspace.navigateTo,
        onColumnOpenItem: openItem,
        onUpload: () => record('upload'), onCreateFolder: () => record('create-folder'),
        onCopyItems: (selection: any[]) => record('copy', selection.map((i) => i.id)),
        onCutItems: (selection: any[]) => record('cut', selection.map((i) => i.id)),
        onPaste: () => record('paste'), canPaste: true,
        onDownloadItems: (selection: any[]) => record('download', selection.map((i) => i.id)),
        onDeleteItems: (selection: any[]) => record('delete', selection.map((i) => i.id)),
        getItemMenuItems: (item: any) => xDriveFileExplorerStandardItemMenuItems({
          kind: item.kind, onOpen: () => { void openItem(item) },
          onShowContainingFolder: searchActive ? () => { void state.showItemInContainingFolder?.(item) } : undefined,
          onDelete: () => record('delete', item.id),
        } as any),
        commandBarEnd: <XDriveFileExplorerSearchFilters
          filters={workspace.searchFilters} sourceOptions={sources} tagOptions={tags}
          onChange={workspace.changeSearchFilters} canSaveSearch={searchActive}
          onSaveSearch={() => record('save-search', { query: workspace.searchState.query, filters: workspace.searchFilters })}
        />,
      } as any)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light"><Fixture /></XDriveAppearanceThemeProvider>,
)
