import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { XDriveFileExplorerNavigationPane } from '@probe/navigation'
import { useXDriveFileExplorerQuickAccess } from '@probe/quick-access'
import { useXDriveFileExplorerOrganization } from '@probe/organization'
import { XDriveAppearanceThemeProvider } from '@probe/theme'

const stamp = '2026-10-09T00:00:00Z'
const rootCrumb = { id: 1, name: '我的文件' }
const parameters = new URLSearchParams(location.search)
const quickCount = Number(parameters.get('quickCount') || 3)
const savedCount = Number(parameters.get('savedCount') || 3)
const longName = '长名称阅读检查'.repeat(2) + '首中末完整可读'
const quickNames = [
  { id: 11, name: 'Zulu 项目' }, { id: 12, name: 'Alpha 资料' }, { id: 13, name: 'Mike 照片' },
  ...Array.from({ length: Math.max(0, quickCount - 3) }, (_, index) => ({ id: index + 14, name: `Folder ${String(index + 4).padStart(2, '0')}` })),
]
const savedNames = [
  { id: 201, name: 'Alpha 规则', query: '项目' },
  { id: 202, name: 'Bravo 规则', query: '资料' },
  { id: 203, name: 'Charlie 规则', query: '照片' },
  ...Array.from({ length: Math.max(0, savedCount - 3) }, (_, index) => ({ id: index + 204, name: `规则 ${String(index + 4).padStart(2, '0')}`, query: `目录${index + 4}` })),
]
if (parameters.has('long')) { quickNames[1].name = longName; savedNames[1].name = longName }
let quickItems = quickNames.map((node, position) => ({
  node: { ...node, type: 'dir', parent_id: 1, revision: 7, size: 0, created_at: stamp, updated_at: stamp },
  path: `/我的文件/${node.name}`, crumbs: [rootCrumb, node], position, pinned_at: stamp,
}))
let savedItems = savedNames.map((item, position) => ({ ...item, filters: {}, position, created_at: stamp, updated_at: stamp }))
const probe = ((window as any).sidebarReorderProbe = {
  calls: [] as any[], errors: [] as string[], events: [] as any[], activations: [] as any[], state: null as any,
  names: { quick: quickNames, saved: savedNames }, failNextOrder: '' as string,
  changeScope: null as any, changePath: null as any, setMounted: null as any, refreshOrderFromServer: null as any,
})
const onError = (error: unknown) => probe.errors.push(error instanceof Error ? error.message : String(error))
const unexpected = async () => { throw new Error('Unexpected transport outside the sidebar-order scope') }
const quickPort = {
  loadItems: async () => { probe.calls.push({ kind: 'read-quick' }); return structuredClone(quickItems) },
  pinItem: unexpected,
  unpinItem: async (id: number) => { probe.calls.push({ kind: 'unpin', id }); quickItems = quickItems.filter(item => item.node.id !== id) },
  reorderItems: async (ids: number[]) => {
    probe.calls.push({ kind: 'reorder-quick', ids: [...ids] })
    const prior = new Map(quickItems.map(item => [item.node.id, item]))
    if (ids.length !== prior.size || new Set(ids).size !== ids.length || ids.some(id => !prior.has(id))) throw new Error('Incomplete Quick Access transport payload')
    if (probe.failNextOrder === 'quick') { probe.failNextOrder = ''; throw new Error('Quick Access order persistence failed') }
    // Transport applies exactly the emitted full order; no fixture computes the UI order.
    quickItems = ids.map((id, position) => ({ ...prior.get(id)!, position }))
  },
}
const organizationPort = {
  listTags: async () => [], createTag: unexpected, updateTag: unexpected, deleteTag: unexpected,
  queryNodeTags: unexpected, addTagNodes: unexpected, removeTagNodes: unexpected,
  listSavedSearches: async () => { probe.calls.push({ kind: 'read-saved' }); return structuredClone(savedItems) },
  createSavedSearch: unexpected, updateSavedSearch: unexpected, deleteSavedSearch: unexpected,
  reorderSavedSearches: async (ids: number[]) => {
    probe.calls.push({ kind: 'reorder-saved', ids: [...ids] })
    const prior = new Map(savedItems.map(item => [item.id, item]))
    if (ids.length !== prior.size || new Set(ids).size !== ids.length || ids.some(id => !prior.has(id))) throw new Error('Incomplete saved-search transport payload')
    if (probe.failNextOrder === 'saved') { probe.failNextOrder = ''; throw new Error('Saved-search order persistence failed') }
    savedItems = ids.map((id, position) => ({ ...prior.get(id)!, position }))
  },
}
const loadDirectoryPage = async () => ({ items: [], nextCursor: '', hasMore: false })
for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'dragstart', 'dragover', 'drop', 'dragend', 'click']) {
  document.addEventListener(name, (event: any) => {
    if (probe.events.length >= 1500) return
    const owner = event.target instanceof Element ? event.target.closest('[role="button"],button,[role="menuitem"]') : null
    probe.events.push({ type: event.type, trusted: event.isTrusted, pointerType: event.pointerType || '', pointerID: event.pointerId,
      label: owner?.getAttribute('aria-label') || owner?.textContent?.trim() || '', x: event.clientX, y: event.clientY })
  }, true)
}
function Fixture() {
  const [lifecycleKey, setLifecycleKey] = useState('m10-owner')
  const [pathID, setPathID] = useState(2)
  const [mounted, setMounted] = useState(true)
  const quick = useXDriveFileExplorerQuickAccess({ lifecycleKey, ...quickPort, onError })
  const organization = useXDriveFileExplorerOrganization({ lifecycleKey, adapter: organizationPort, onError })
  probe.changeScope = () => setLifecycleKey(current => `${current}-next`)
  probe.changePath = () => setPathID(current => current + 1)
  probe.setMounted = setMounted
  // Server-side list changes travel through the real hooks' refresh functions.
  probe.refreshOrderFromServer = async (kind: 'quick' | 'saved') => {
    if (kind === 'quick') {
      quickItems = [...quickItems].reverse().map((item, position) => ({ ...item, position }))
      await quick.refresh()
    } else {
      savedItems = [...savedItems].reverse().map((item, position) => ({ ...item, position }))
      await organization.refresh()
    }
  }
  probe.state = { quick: quick.items.map(item => item.id), saved: organization.savedSearches.map(item => item.id),
    quickLoading: quick.loading, savedLoading: organization.loading, lifecycleKey, pathID, mounted }
  return <div style={{ width: 'min(360px, 100vw)', height: '100dvh' }}>
    {mounted ? <XDriveFileExplorerNavigationPane
      lifecycleKey={lifecycleKey} currentCrumbs={[rootCrumb, { id: pathID, name: '当前文件夹' }]}
      sectionPreferencesKey={`m10-sidebar-reorder-probe-${parameters.get('case') || 'baseline'}`} loadDirectoryPage={loadDirectoryPage}
      onNavigate={crumbs => { probe.activations.push({ kind: 'tree', crumbs }) }}
      quickAccessEnabled quickAccessItems={quick.items} quickAccessLoading={quick.loading} quickAccessBusyID={quick.busyID}
      onNavigateQuickAccess={id => { void quick.navigate(id, crumbs => { probe.activations.push({ kind: 'quick', crumbs }) }) }}
      onUnpinQuickAccess={id => { void quick.unpin(id) }} onReorderQuickAccess={ids => { void quick.reorder(ids) }}
      savedSearchesEnabled savedSearches={organization.savedSearches} organizationLoading={organization.loading} organizationError={organization.error}
      onActivateSavedSearch={search => { probe.activations.push({ kind: 'saved', id: search.id }) }}
      onRenameSavedSearch={search => { probe.activations.push({ kind: 'rename', id: search.id }) }}
      onReplaceSavedSearch={search => { probe.activations.push({ kind: 'replace', id: search.id }) }} canReplaceSavedSearch
      onDeleteSavedSearch={id => { probe.activations.push({ kind: 'delete', id }) }}
      onReorderSavedSearches={organization.reorderSavedSearches} onError={onError}
    /> : null}
  </div>
}
createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light"><Fixture /></XDriveAppearanceThemeProvider>,
)
