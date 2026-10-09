import { createRoot } from 'react-dom/client'
import { XDriveMediaGalleryPage } from '@probe/gallery'
import { XDriveWorkspaceContent } from '@probe/content'
import { XDriveAppearanceThemeProvider } from '@probe/theme'

const scenario = new URLSearchParams(location.search).get('scenario') || 'interactive'
const places = [
  { id: 'place:0:0', name: '零点', latitude: 0.005, longitude: 0.005, item_count: 1 },
  { id: 'place:100:10300', name: '东侧甲', latitude: 1.005, longitude: 103.005, item_count: 6 },
  { id: 'place:110:10310', name: '东侧乙', latitude: 1.105, longitude: 103.105, item_count: 2 },
]
const stamp = '2026-10-08T12:00:00Z'
const item = {
  node: { id: 101, revision: 7, parent_id: 1, name: 'Place-photo.jpg', type: 'file' as const,
    size: 4096, created_at: stamp, updated_at: stamp },
  metadata: { media_kind: 'image' as const, mime_type: 'image/jpeg', index_state: 'ready',
    captured_at: stamp, latitude: 0, longitude: 0, has_thumbnail: false, width: 100, height: 100 },
  favorite: false, tags: [], people: [], description: '',
}
const probe = ((window as any).placesProbe = {
  calls: [] as any[], errors: [] as string[], events: [] as any[],
  resolvePlaces: undefined as undefined | (() => void),
})
for (const type of ['pointerdown', 'gotpointercapture', 'pointerup', 'lostpointercapture', 'click']) {
  document.addEventListener(type, event => {
    const target = event.target as Element
    if (!target.closest?.('[data-xdrive-gallery-places-map]')) return
    const pointer = event as PointerEvent
    probe.events.push({ type, target: target.tagName, role: target.getAttribute('role'),
      label: target.getAttribute('aria-label'), trusted: event.isTrusted,
      x: pointer.clientX, y: pointer.clientY, pointerType: pointer.pointerType,
      pointerId: pointer.pointerId })
  }, true)
}
let expandedReads = 0
const source = {
  listItems: async () => { probe.calls.push({ kind: 'dense' }); return [] },
  listItemRange: async (limit: number, offset: number, query: any = {}) => {
    probe.calls.push({ kind: 'range', limit, offset, query: structuredClone(query) })
    return { items: offset === 0 ? [structuredClone(item)] : [],
      offset, limit, total_count: 1, has_more: false }
  },
  listAlbums: async () => [],
  listAlbumItemRange: async () => ({ items: [], offset: 0, limit: 100, total_count: 0, has_more: false }),
  listPlaces: async (limit = 24) => {
    probe.calls.push({ kind: 'places', limit })
    if (limit === 24) return scenario === 'interactive' ? structuredClone(places) : []
    expandedReads += 1
    if (scenario === 'delayed' && expandedReads === 1) {
      await new Promise<void>(resolve => { probe.resolvePlaces = resolve })
    }
    if (scenario === 'error' && expandedReads === 1) throw new Error('地点读取失败：fixture 503')
    return scenario === 'empty' ? [] : structuredClone(places)
  },
  loadThumbnail: async () => null,
}
createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light">
    <div style={{ height: '100dvh', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <XDriveWorkspaceContent responsive>
        <XDriveMediaGalleryPage source={source} initialSection="library"
          preferenceScope={`m16-${location.search}`}
          onError={error => { probe.errors.push(String(error)) }} />
      </XDriveWorkspaceContent>
    </div>
  </XDriveAppearanceThemeProvider>,
)
