import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Button, Stack } from '@mui/material'
import {
  XDriveFileExplorer,
  type XDriveFileExplorerCrumb,
  type XDriveFileExplorerID,
  type XDriveFileExplorerItem,
  type XDriveFileExplorerViewMode,
} from '__FILE_EXPLORER__'
import { XDriveAppearanceThemeProvider } from '__THEME__'

// This fixture supplies only the platform-owned data and callbacks. Selection,
// pointer handling, responsive projection, menus and layout run in the real
// shared React/MUI FileExplorer, with native browser input and media queries.
const storageKey = 'xdrive.mobile-browser.view-mode'
const rootCrumb: XDriveFileExplorerCrumb = { id: 0, name: '我的文件' }
const folder: XDriveFileExplorerItem = { id: 3, name: '文件夹', kind: 'dir' }
const rootItems: XDriveFileExplorerItem[] = [
  { id: 1, name: 'alpha.txt', kind: 'file', size: 11, fileKind: 'text' },
  { id: 2, name: 'beta.txt', kind: 'file', size: 22, fileKind: 'text' },
  folder,
  ...Array.from({ length: 70 }, (_, index) => ({
    id: index + 4,
    name: `文件-${String(index + 1).padStart(3, '0')}.txt`,
    kind: 'file' as const,
    size: index + 100,
    fileKind: 'text' as const,
  })),
]
const folderItems: XDriveFileExplorerItem[] = [
  { id: 100, name: 'inside.txt', kind: 'file', size: 33, fileKind: 'text' },
]
type FixtureEvent = { type: string; ids?: XDriveFileExplorerID[]; value?: string }
const harness = ((window as any).fileExplorerHarness = {
  events: [] as FixtureEvent[],
}) as any
const record = (event: FixtureEvent) => harness.events.push(event)
const requestedMode = new URLSearchParams(window.location.search).get('mode')
const initialMode: XDriveFileExplorerViewMode = requestedMode === 'columns' || requestedMode === 'grid'
  ? requestedMode
  : 'details'

async function loadColumnPage(parentID: XDriveFileExplorerID) {
  return { items: String(parentID) === '3' ? folderItems : rootItems }
}

function Fixture() {
  const [viewMode, setViewMode] = useState<XDriveFileExplorerViewMode>(initialMode)
  const [selectedIDs, setSelectedIDs] = useState<XDriveFileExplorerID[]>([])
  const [crumbs, setCrumbs] = useState<XDriveFileExplorerCrumb[]>([rootCrumb])
  const [generation, setGeneration] = useState(0)
  const [searchValue, setSearchValue] = useState('')
  const items = crumbs.length > 1 ? folderItems : rootItems

  useEffect(() => { localStorage.setItem(storageKey, viewMode) }, [viewMode])
  const onSelectionChange = useCallback((ids: XDriveFileExplorerID[]) => {
    setSelectedIDs(ids)
    record({ type: 'selection', ids: [...ids] })
  }, [])
  const onOpenItem = useCallback((item: XDriveFileExplorerItem) => {
    record({ type: 'open', ids: [item.id] })
    if (item.kind === 'dir') setCrumbs([rootCrumb, { id: item.id, name: item.name }])
  }, [])
  const onViewModeChange = useCallback((mode: XDriveFileExplorerViewMode) => {
    record({ type: 'view-mode', value: mode })
    setViewMode(mode)
  }, [])
  const onColumnNavigate = useCallback((next: XDriveFileExplorerCrumb[]) => {
    record({ type: 'navigate', ids: next.map((crumb) => crumb.id) })
    setCrumbs(next)
  }, [])

  harness.state = { viewMode, selectedIDs: [...selectedIDs], crumbs: crumbs.map((crumb) => crumb.id) }
  harness.clearEvents = () => { harness.events = [] }
  harness.reset = (mode: XDriveFileExplorerViewMode = 'details') => flushSync(() => {
    harness.events = []
    setViewMode(mode)
    setSelectedIDs([])
    setCrumbs([rootCrumb])
    setSearchValue('')
    setGeneration((value) => value + 1)
  })

  return (
    <div style={{ width: '100%', height: '100dvh', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <XDriveFileExplorer
        presentation="workspace"
        items={items}
        crumbs={crumbs}
        interactionLifecycleKey={`mobile-browser:${generation}`}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        selectedIDs={selectedIDs}
        onSelectionChange={onSelectionChange}
        onOpenItem={onOpenItem}
        loadColumnPage={loadColumnPage}
        onColumnNavigate={onColumnNavigate}
        onColumnOpenItem={onOpenItem}
        onCrumbClick={(_, index) => setCrumbs((value) => value.slice(0, index + 1))}
        onCopyItems={(selection) => record({ type: 'copy', ids: selection.map((item) => item.id) })}
        onDownloadItems={(selection) => record({ type: 'download', ids: selection.map((item) => item.id) })}
        onDeleteItems={(selection) => record({ type: 'delete', ids: selection.map((item) => item.id) })}
        onDropItemsToFolder={(selection, target, operation) => record({ type: 'drop', ids: [...selection.map((item) => item.id), target.id], value: operation })}
        onDropItemsToCrumb={(selection, target, operation) => record({ type: 'crumb-drop', ids: [...selection.map((item) => item.id), target.id], value: operation })}
        onMoveItemsTo={(selection) => record({ type: 'move-to', ids: selection.map((item) => item.id) })}
        onUpload={() => record({ type: 'upload' })}
        onRefresh={() => record({ type: 'refresh' })}
        searchValue={searchValue}
        onSearchValueChange={setSearchValue}
        onSearch={(value) => record({ type: 'search', value })}
        detailsPreferencesKey="xdrive.mobile-browser.details"
        viewPreferencesKey="xdrive.mobile-browser.preferences"
        navigationPane={(
          <Stack sx={{ width: '100%', p: 1 }}>
            <Button onClick={() => setCrumbs([rootCrumb, { id: folder.id, name: folder.name }])}>
              测试位置
            </Button>
          </Stack>
        )}
        getItemMenuItems={(item) => [{ id: 'fixture-open', label: '打开', onSelect: () => onOpenItem(item) }]}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light"><Fixture /></XDriveAppearanceThemeProvider>,
)
