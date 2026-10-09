import { Component, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveFileExplorer } from '__FILE_EXPLORER__'
import { useXDriveFileExplorerWorkspace } from '__WORKSPACE__'
import { useXDriveFileExplorerOrganization } from '__ORGANIZATION__'
import { XDriveFileExplorerNavigationPane } from '__NAVIGATION__'
import { XDriveFileExplorerSearchFilters } from '__FILTERS__'
import { XDriveFileTagDialog } from '__TAG_DIALOG__'
import { XDriveFileNameDialog } from '__NAME_DIALOG__'
import { XDriveAppearanceThemeProvider } from '__THEME__'
import * as organizationModel from '__ORGANIZATION_MODEL__'
import { xDriveFileExplorerSearchFilterLabels, xDriveFileExplorerSearchFiltersActive } from '__SEARCH_MODEL__'

// The real shared hooks own all collections, mutations,
// Search, and history. Only Server/IPC transports and modal-owner state live here.
const { xDriveFileExplorerPersistedSearchFilters } = organizationModel
// Optional lookup lets the same fixture bundle against the archived pre-M08 API.
// No replacement matching controller is supplied when the real helper is absent.
const deriveOrganizationState = Reflect.get(organizationModel, 'xDriveFileExplorerOrganizationSearchState')
const savedRuleLabels = Reflect.get(organizationModel, 'xDriveFileExplorerSavedSearchRuleLabels')
const params = new URLSearchParams(location.search)
const scene = params.get('scene') || 'files'
const stamp = '2026-10-09T00:00:00Z'
const root = { id: 1, name: '我的文件' }, home = { id: 2, name: '项目目录' }
const sourceOptions = [{ id: 7, name: '项目同步' }]
const availabilityOptions = [{ value: 'local', label: '本机可用' }, { value: 'cloud', label: '仅云端' }]
const makeNode = (id: number, name: string, type: string, parent_id = 2) => ({ id, name, type, parent_id, revision: id + 10, size: type === 'file' ? 4096 : 0, created_at: stamp, updated_at: stamp })
const directoryRows = [makeNode(20, '归档目录', 'dir'), makeNode(21, '报告.txt', 'file'), makeNode(22, '照片.jpg', 'file')]
const makeTag = (id: number, name: string, item_count: number) => ({ id, name, item_count, color: '#5566aa', created_at: stamp, updated_at: stamp })
const harness = ((window as any).organizationHarness = {
  requests: [] as any[], events: [] as any[], pending: [] as any[], rendererErrors: [] as string[], selectedIDs: [] as number[],
  nodeTagIDs: { 21: [9], 22: [] } as Record<number, number[]>,
  holdCatalog: params.get('catalog') === 'hold', failCatalog: params.get('catalog') === 'error',
  failQuery: scene === 'assign-error', failMutation: false, mutationError: '测试：保存标签失败，请重试',
  tags: params.get('catalog') === 'empty' ? [] : [makeTag(9, '研究', 128), makeTag(10, '研究资料'.repeat(5), 0)],
  savedSearches: params.get('catalog') === 'empty' ? [] : [{ id: 41, name: '项目文档', query: params.get('long-rule') === '1' ? '项目研究记录'.repeat(12) : '项目', filters: { kind: 'file', sourceID: 7, tagID: params.get('long-rule') === '1' ? 10 : 9 }, position: 0, created_at: stamp, updated_at: stamp }],
})
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const record = (type: string, value?: any) => harness.events.push({ type, value })
const onError = (error: unknown) => record('handled-error', error instanceof Error ? error.message : String(error))
async function catalog(kind: 'tags' | 'savedSearches') {
  harness.requests.push({ type: 'list-' + kind })
  if (harness.holdCatalog) await new Promise<void>((resolve) => harness.pending.push({ type: 'catalog', resolve }))
  if (harness.failCatalog) throw new Error('测试：组织列表暂时不可用')
  return clone(harness[kind])
}
function mutation(type: string, value: any) {
  harness.requests.push({ type, ...clone(value) })
  if (harness.failMutation) throw new Error(harness.mutationError)
}
const adapter = {
  listTags: () => catalog('tags'), listSavedSearches: () => catalog('savedSearches'),
  createTag: async (name: string, color: string) => {
    mutation('create-tag', { name, color })
    const tag = { ...makeTag(100 + harness.tags.length, name, 0), color }
    harness.tags.push(tag); return clone(tag)
  },
  updateTag: async (id: number, input: any) => {
    mutation('update-tag', { id, input }); harness.tags = harness.tags.map((tag: any) => tag.id === id ? { ...tag, ...input } : tag)
    return clone(harness.tags.find((tag: any) => tag.id === id))
  },
  deleteTag: async (id: number) => { mutation('delete-tag', { id }); harness.tags = harness.tags.filter((tag: any) => tag.id !== id) },
  queryNodeTags: async (nodeIDs: number[]) => {
    harness.requests.push({ type: 'query-node-tags', nodeIDs: [...nodeIDs] })
    if (harness.failQuery) throw new Error('测试：当前选择的标签读取失败')
    // Real JSON from the Go API has null for an untagged node's nil slice.
    return nodeIDs.map((node_id) => {
      const tags = (harness.nodeTagIDs[node_id] ?? []).map((id) => harness.tags.find((tag: any) => tag.id === id)).filter(Boolean).map(clone)
      return { node_id, tags: tags.length ? tags : null }
    }) as any
  },
  addTagNodes: async (tagID: number, nodeIDs: number[]) => {
    mutation('add-tag-nodes', { tagID, nodeIDs })
    if (!nodeIDs.length) throw new Error('测试：Server 不接受空标签分配批次')
    const tag = harness.tags.find((entry: any) => entry.id === tagID)
    for (const id of nodeIDs) {
      const ids = harness.nodeTagIDs[id] ?? []
      if (!ids.includes(tagID)) { harness.nodeTagIDs[id] = [...ids, tagID]; if (tag) tag.item_count += 1 }
    }
  },
  removeTagNodes: async (tagID: number, nodeIDs: number[]) => {
    mutation('remove-tag-nodes', { tagID, nodeIDs })
    if (!nodeIDs.length) throw new Error('测试：Server 不接受空标签分配批次')
    const tag = harness.tags.find((entry: any) => entry.id === tagID)
    for (const id of nodeIDs) {
      const ids = harness.nodeTagIDs[id] ?? []
      if (ids.includes(tagID)) { harness.nodeTagIDs[id] = ids.filter((value) => value !== tagID); if (tag) tag.item_count -= 1 }
    }
  },
  createSavedSearch: async (input: any) => {
    mutation('create-saved-search', { input })
    const saved = { ...clone(input), id: 50 + harness.savedSearches.length, position: harness.savedSearches.length, created_at: stamp, updated_at: stamp }
    harness.savedSearches.push(saved); return clone(saved)
  },
  updateSavedSearch: async (id: number, input: any) => {
    mutation('update-saved-search', { id, input })
    harness.savedSearches = harness.savedSearches.map((saved: any) => saved.id === id ? { ...saved, ...clone(input) } : saved)
    return clone(harness.savedSearches.find((saved: any) => saved.id === id))
  },
  deleteSavedSearch: async (id: number) => { mutation('delete-saved-search', { id }); harness.savedSearches = harness.savedSearches.filter((saved: any) => saved.id !== id) },
  reorderSavedSearches: async (ids: number[]) => { mutation('reorder-saved-searches', { ids }) },
}
harness.releaseCatalog = () => { harness.holdCatalog = false; for (const entry of harness.pending) entry.resolve(); harness.pending = [] }
const loadRoot = async () => root
const loadDirectoryPage = async (parentID: number) => ({ items: parentID === 1 ? [{ id: 2, name: home.name, type: 'dir' }] : [], nextCursor: '', hasMore: false })
const findChildDirectory = async () => null
const searchCrumbsForResult = (value: any) => value.crumbs
async function loadSearchRange(query: string, filters: any, grouping: any, sort: any, offset: number, limit: number) {
  harness.requests.push({ type: 'search', query, filters: clone(filters), grouping, sort, offset, limit })
  return { offset, limit, totalCount: 256, groups: [], items: Array.from({ length: Math.max(0, Math.min(limit, 256 - offset)) }, (_, i) => {
    const node = makeNode(1000 + offset + i, '搜索结果-' + (offset + i) + '.txt', 'file')
    return { node, crumbs: [root, home], path: '/项目目录/' + node.name }
  }) }
}
class ErrorBoundary extends Component<{ children: any }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { harness.rendererErrors.push(error.message) }
  render() { return this.state.failed ? <div role="alert">渲染失败，请查看保存的错误证据。</div> : this.props.children }
}
function Fixture() {
  const [session] = useState('organization-session-1')
  const [directory, setDirectory] = useState({ id: 2, crumbs: [root, home] })
  const [tagDialog, setTagDialog] = useState<any>(scene === 'manage' ? { mode: 'manage', nodeIDs: [] } : scene.startsWith('assign') ? { mode: 'assign', nodeIDs: [21, 22] } : null)
  const [saveNameOpen, setSaveNameOpen] = useState(false)
  const onLoadDirectory = useCallback(async (id: number, crumbs: any[]) => { setDirectory({ id, crumbs }); return true }, [])
  const initialNavigationState = useMemo(() => ({ activeTabID: 'tab-1', tabs: [{ id: 'tab-1', history: [[root, home]], historyIndex: 0, viewMode: 'details', sort: { key: 'name', direction: 'asc' }, grouping: { groupBy: 'none', foldersFirst: true } }] }), [])
  const workspace = useXDriveFileExplorerWorkspace({
    items: directory.id === 2 ? directoryRows : [], crumbs: directory.crumbs, viewModeStorageKey: 'organization-fixture-view',
    navigationSessionStorageKey: session, initialNavigationState: initialNavigationState as any,
    onLoadDirectory, loadRoot, findChildDirectory, searchCrumbsForResult, loadSearchRange, onError,
  })
  const organization = useXDriveFileExplorerOrganization({ lifecycleKey: session, adapter, onError })
  const persistedFilters = xDriveFileExplorerPersistedSearchFilters(workspace.searchFilters)
  const organizationSearchState = typeof deriveOrganizationState === 'function'
    ? deriveOrganizationState({ active: workspace.searchState.results !== null, query: workspace.searchState.query, filters: workspace.searchFilters, savedSearches: organization.savedSearches })
    : { canSaveCurrentSearch: Boolean(workspace.searchState.query || xDriveFileExplorerSearchFiltersActive(persistedFilters)) }
  const canSave = organizationSearchState.canSaveCurrentSearch
  const ruleLabels = (saved: any) => typeof savedRuleLabels === 'function'
    ? savedRuleLabels(saved, { sourceOptions, tagOptions: organization.tagOptions })
    : [saved.query ? '搜索：' + saved.query : '搜索：全部文件', ...xDriveFileExplorerSearchFilterLabels(saved.filters, { sourceOptions, tagOptions: organization.tagOptions })]
  harness.workspace = workspace
  harness.organization = organization
  harness.openManage = () => setTagDialog({ mode: 'manage', nodeIDs: [] })
  harness.state = { query: workspace.searchState.query, filters: workspace.searchFilters, searchReady: workspace.searchReady, searchActive: workspace.searchResults !== null, historyKey: workspace.activeHistoryEntryKey, crumbs: directory.crumbs, tags: organization.tags, savedSearches: organization.savedSearches, loading: organization.loading, organizationError: (organization as any).error, tagDialog, canSave, organizationSearchState, matchingHelperAvailable: typeof deriveOrganizationState === 'function' }
  const navigation = <XDriveFileExplorerNavigationPane {...({
    lifecycleKey: session, currentCrumbs: workspace.explorerCrumbs, loadDirectoryPage, onNavigate: (crumbs: any[]) => workspace.navigateTo(crumbs),
    quickAccessEnabled: true, quickAccessItems: [], favoritesEnabled: true, favoriteItems: [],
    savedSearchesEnabled: true, savedSearches: organization.savedSearches, tagsEnabled: true, tags: organization.tags,
    organizationLoading: organization.loading, organizationError: (organization as any).error, onRetryOrganization: organization.refresh,
    onManageTags: () => setTagDialog({ mode: 'manage', nodeIDs: [] }), onSaveCurrentSearch: () => setSaveNameOpen(true), canSaveCurrentSearch: canSave,
    savedSearchRuleLabels: ruleLabels, ...organizationSearchState,
    onActivateSavedSearch: (saved: any) => workspace.applySearch(saved.query, saved.filters),
    onActivateTag: (tag: any) => workspace.applySearch('', { tagID: tag.id }),
    onReplaceSavedSearch: (saved: any) => organization.updateSavedSearch(saved.id, { name: saved.name, query: workspace.searchState.query, filters: persistedFilters }),
    onDeleteSavedSearch: organization.deleteSavedSearch, canReplaceSavedSearch: canSave, onError,
  } as any)} />
  return <div style={{ height: '100dvh', display: 'flex', overflow: 'hidden', minHeight: 0 }}>
    <XDriveFileExplorer {...({
      presentation: 'workspace', interactionLifecycleKey: session, keyboardProfile: 'windows',
      items: workspace.explorerItems, crumbs: workspace.explorerCrumbs, virtualCollection: workspace.explorerVirtualCollection, viewState: workspace.explorerViewState,
      viewMode: workspace.viewMode, onViewModeChange: workspace.setViewMode, sort: workspace.sort, onSortChange: workspace.changeSort, grouping: workspace.grouping, onGroupingChange: workspace.changeGrouping,
      externallySorted: workspace.externallySorted, onOpenItem: (item: any) => workspace.openItem(item, (node: any) => record('file-open', node.id)),
      onSelectionChange: (ids: number[]) => { harness.selectedIDs = [...ids] }, onManageTags: (items: any[]) => setTagDialog({ mode: 'assign', nodeIDs: items.map((item) => Number(item.id)) }),
      onBack: workspace.goBack, canGoBack: workspace.canGoBack, onForward: workspace.goForward, canGoForward: workspace.canGoForward,
      onCrumbClick: (_: any, index: number) => workspace.navigateToCrumb(index), onUp: workspace.goUp, canGoUp: workspace.canGoUp,
      searchValue: workspace.searchValue, onSearchValueChange: workspace.changeSearchValue, onSearch: workspace.submitSearch,
      searchSummary: workspace.searchResults !== null ? { query: workspace.searchState.query, conditions: xDriveFileExplorerSearchFilterLabels(workspace.searchFilters, { sourceOptions, tagOptions: organization.tagOptions }), resultCount: workspace.searchReady ? 256 : null, onClear: workspace.clearSearch } : undefined,
      navigationPane: navigation, commandBarEnd: <XDriveFileExplorerSearchFilters filters={workspace.searchFilters} sourceOptions={sourceOptions} tagOptions={organization.tagOptions} availabilityOptions={availabilityOptions as any} onChange={workspace.changeSearchFilters} canSaveSearch={canSave} onSaveSearch={() => setSaveNameOpen(true)} />,
    } as any)} />
    <XDriveFileTagDialog {...({ open: Boolean(tagDialog), mode: tagDialog?.mode ?? 'assign', nodeIDs: tagDialog?.nodeIDs ?? [], tags: organization.tags, busy: Boolean(organization.busyKey), tagsLoading: organization.loading, tagsError: (organization as any).error, onRetryTags: organization.refresh,
      queryNodeTags: organization.queryNodeTags, onSetTag: organization.setTagNodes, onCreateTag: organization.createTag, onUpdateTag: organization.updateTag, onDeleteTag: organization.deleteTag, onClose: () => setTagDialog(null),
    } as any)} />
    <XDriveFileNameDialog open={saveNameOpen} mode="saved-search" onClose={() => setSaveNameOpen(false)} onSubmit={async (name) => { await organization.createSavedSearch({ name, query: workspace.searchState.query, filters: persistedFilters }) }} onError={onError} />
  </div>
}
createRoot(document.getElementById('root')!).render(<XDriveAppearanceThemeProvider appearance="light"><ErrorBoundary><Fixture /></ErrorBoundary></XDriveAppearanceThemeProvider>)
