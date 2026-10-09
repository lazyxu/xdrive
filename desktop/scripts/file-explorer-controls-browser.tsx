import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveFileExplorer, type XDriveFileExplorerCrumb, type XDriveFileExplorerItem } from '__FILE_EXPLORER__'
import { XDriveFileExplorerNavigationPane } from '__NAVIGATION_PANE__'
import { XDriveFileExplorerSearchFilters } from '__SEARCH_FILTERS__'
import { XDriveFileExplorerTabs } from '__TABS__'
import { XDriveAppearanceThemeProvider } from '__THEME__'

// Only platform data and callbacks are fixtures. All controls, overlays, input
// handling and responsive geometry execute the real shared React/MUI components.
const root = { id: 1, name: '我的文件' }
const folder = { id: 2, name: '一级文件夹', kind: 'dir' as const }
const files: XDriveFileExplorerItem[] = [folder, ...Array.from({ length: 80 }, (_, i) => ({
  id: 1000 + i, name: `报告-${String(i + 1).padStart(3, '0')}.txt`, kind: 'file' as const, size: 100 + i,
}))]
const stamp = '2026-10-09T00:00:00Z'
const saved = [
  { id: 21, name: '工作图片', query: '', filters: { kind: 'image' as const }, position: 0, created_at: stamp, updated_at: stamp },
  { id: 22, name: '项目文档', query: '项目', filters: {}, position: 1, created_at: stamp, updated_at: stamp },
]
const tags = [{ id: 31, name: '工作', color: '#128477', item_count: 2, created_at: stamp, updated_at: stamp }]
const longSource = '跨团队联合项目同步文件夹及历史研究资料与长期归档目录名称'.repeat(3)
const longTag = '需要在多个设备之间持续复核的长期项目资料分类标签'.repeat(3)
const harness = ((window as any).fileExplorerControlsHarness = { events: [] as any[], selectedIDs: [] as (string | number)[], labels: { longSource, longTag } })
const record = (type: string, value?: any) => harness.events.push({ type, value })
const recordSelection = (ids: (string | number)[]) => { harness.selectedIDs = [...ids]; record('selection', ids) }
const loadDirectoryPage = async (parentID: number) => {
  record('tree-load', parentID)
  return {
    items: parentID === 1 ? [folder, { id: 90, name: '另一个文件夹', type: 'dir' }].map((item) => ({ ...item, type: 'dir' }))
      : parentID >= 2 && parentID < 9 ? [{ id: parentID + 1, name: `${parentID}级深层文件夹名称`, type: 'dir' }] : [],
    nextCursor: '', hasMore: false,
  }
}

function Fixture() {
  const [crumbs, setCrumbs] = useState<XDriveFileExplorerCrumb[]>([root])
  const [activeTabID, setActiveTabID] = useState('one')
  const [searchValue, setSearchValue] = useState('')
  const [filters, setFilters] = useState<any>({})
  const navigate = (next: any[]) => { record('navigate', next.map((item) => item.id)); setCrumbs(next) }
  const activateTab = (id: string) => { record('tab-activate', id); setActiveTabID(id) }
  const tabAction = (type: string) => () => record(type)
  harness.state = { crumbs: crumbs.map((item) => item.id), activeTabID, filters, searchValue }
  harness.clearEvents = () => { harness.events = [] }
  return (
    <div style={{ width: '100%', height: '100dvh', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <XDriveFileExplorer
        presentation="workspace"
        items={files}
        crumbs={crumbs}
        interactionLifecycleKey="controls-fixture"
        keyboardProfile="windows"
        onSelectionChange={recordSelection}
        onCrumbClick={(_, index) => navigate(crumbs.slice(0, index + 1))}
        onOpenItem={(item) => { record('open', item.id); if (item.kind === 'dir') navigate([root, { id: item.id, name: item.name }]) }}
        onOpenItemInNewTab={(item) => record('tab-middle', item.id)}
        onOpenQuickLook={(request) => record('quick-look', request.item.id)}
        onNewTab={tabAction('tab-new')}
        onCloseTab={tabAction('tab-close')}
        onRestoreClosedTab={tabAction('tab-restore')}
        onNextTab={tabAction('tab-next')}
        onPreviousTab={tabAction('tab-previous')}
        onActivateTabAtIndex={(index) => record('tab-index', index)}
        tabBar={<XDriveFileExplorerTabs
          tabs={[{ id: 'one', label: '当前目录' }, { id: 'two', label: '第二目录' }]}
          activeTabID={activeTabID}
          canRestoreClosedTab
          onActivate={activateTab}
          onNewTab={tabAction('tab-new')}
          onCloseTab={tabAction('tab-close')}
          onRestoreClosedTab={tabAction('tab-restore')}
        />}
        onUpload={tabAction('upload')}
        onCreateFolder={tabAction('new-folder')}
        onUploadFolder={tabAction('upload-folder')}
        onRefresh={tabAction('refresh')}
        onCopyItems={(items) => record('copy', items.map((item) => item.id))}
        onCutItems={(items) => record('cut', items.map((item) => item.id))}
        onPaste={tabAction('paste')}
        canPaste
        onDeleteItems={(items) => record('delete', items.map((item) => item.id))}
        onDownloadItems={(items) => record('download', items.map((item) => item.id))}
        searchValue={searchValue}
        onSearchValueChange={setSearchValue}
        onSearch={(value) => record('search', value)}
        commandBarEnd={<XDriveFileExplorerSearchFilters
          filters={filters}
          sourceOptions={[{ id: 41, name: '项目同步' }, { id: 42, name: longSource }]}
          tagOptions={[...tags, { id: 32, name: longTag }]}
          canSaveSearch={Object.keys(filters).some((key) => filters[key] !== undefined) || searchValue.length >= 2}
          onSaveSearch={() => record('save-search', filters)}
          onChange={(next) => { record('filters', next); setFilters(next) }}
        />}
        navigationPane={<XDriveFileExplorerNavigationPane
          lifecycleKey="controls-fixture"
          currentCrumbs={crumbs.map((item) => ({ id: Number(item.id), name: item.name }))}
          loadDirectoryPage={loadDirectoryPage}
          onNavigate={navigate}
          onNavigateTrash={tabAction('trash')}
          quickAccessEnabled
          quickAccessItems={[{ id: 2, name: '固定工作目录', path: '/我的文件/一级文件夹', crumbs: [root, folder], position: 0, pinnedAt: stamp }]}
          onNavigateQuickAccess={() => navigate([root, { id: 2, name: folder.name }])}
          onToggleCurrentQuickAccess={tabAction('pin-current')}
          onUnpinQuickAccess={(id) => record('unpin', id)}
          onReorderQuickAccess={(ids) => record('reorder-pins', ids)}
          savedSearchesEnabled
          savedSearches={saved}
          onActivateSavedSearch={(search) => { record('saved-search', search.id); setFilters(search.filters) }}
          onRenameSavedSearch={(search) => record('rename-search', search.id)}
          onReplaceSavedSearch={(search) => record('replace-search', search.id)}
          canReplaceSavedSearch
          onDeleteSavedSearch={(id) => record('delete-search', id)}
          onReorderSavedSearches={(ids) => record('reorder-search', ids)}
          tagsEnabled tags={tags} onActivateTag={(tag) => { record('tag', tag.id); setFilters({ tagID: tag.id }) }}
          favoritesEnabled
          favoriteItems={[{ id: 1000, name: '收藏报告.txt', path: '/我的文件/收藏报告.txt', favoritedAt: stamp }]}
          onActivateFavorite={(id) => record('favorite', id)} onUnfavorite={(id) => record('unfavorite', id)}
          recentEnabled
          recentItems={[{ id: 1001, name: '最近报告.txt', path: '/我的文件/最近报告.txt', kind: 'file', crumbs: [root], accessedAt: stamp }]}
          onActivateRecent={(id) => record('recent', id)} onClearRecent={tabAction('clear-recent')}
          sectionPreferencesKey="xdrive.controls-fixture.navigation"
        />}
        getItemMenuItems={(item) => [
          { id: 'open', label: '打开', onSelect: () => record('open', item.id) },
          { id: 'open-new-tab', label: '在新标签页中打开', onSelect: () => record('tab-context', item.id) },
          { id: 'open-browser-tab', label: '在新浏览器标签页打开', onSelect: () => record('browser-tab', item.id) },
        ]}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light"><Fixture /></XDriveAppearanceThemeProvider>,
)
