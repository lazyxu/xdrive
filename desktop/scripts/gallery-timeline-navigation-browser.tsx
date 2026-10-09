import { createRoot } from 'react-dom/client'
import { XDriveMediaGalleryPage } from '@probe/gallery'
import { XDriveWorkspaceContent } from '@probe/content'
import { XDriveAppearanceThemeProvider } from '@probe/theme'

const dates = ['2026-10-09T12:00:00Z', '2026-09-08T12:00:00Z', '2025-12-07T12:00:00Z']
const groups = {
  year: [{ key: '2026', start_index: 0, item_count: 240 }, { key: '2025', start_index: 240, item_count: 120 }],
  month: [{ key: '2026-10', start_index: 0, item_count: 120 }, { key: '2026-09', start_index: 120, item_count: 120 }, { key: '2025-12', start_index: 240, item_count: 120 }],
  day: [{ key: '2026-10-09', start_index: 0, item_count: 120 }, { key: '2026-09-08', start_index: 120, item_count: 120 }, { key: '2025-12-07', start_index: 240, item_count: 120 }],
}
const itemAt = (index: number) => ({
  node: { id: 1360 - index, name: `Timeline-${index + 1}.jpg`, type: 'file' as const, parent_id: 1,
    size: 4096, revision: 1, created_at: dates[Math.floor(index / 120)], updated_at: dates[Math.floor(index / 120)] },
  metadata: { media_kind: 'image' as const, mime_type: 'image/jpeg', index_state: 'ready',
    captured_at: dates[Math.floor(index / 120)], has_thumbnail: false, width: 100, height: 100 },
  tags: [], people: [], description: '', favorite: false,
})
const probe = ((window as any).timelineProbe = { calls: [] as any[], errors: [] as string[], viewers: [] as number[] })
const range = async (limit: number, offset: number, query: unknown = {}) => {
  probe.calls.push({ kind: 'range', limit, offset, query: structuredClone(query) })
  return { items: Array.from({ length: Math.max(0, Math.min(limit, 360 - offset)) }, (_, slot) => itemAt(offset + slot)),
    offset, limit, total_count: 360, has_more: offset + limit < 360, timeline_group_sets: groups }
}
const source = {
  listItems: async () => { probe.calls.push({ kind: 'dense' }); return [] },
  listItemRange: range,
  listAlbums: async () => [],
  listAlbumItemRange: async () => ({ items: [], offset: 0, limit: 100, total_count: 0, has_more: false }),
  loadThumbnail: async () => null,
}
createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light">
    <div style={{ height: '100dvh', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <XDriveWorkspaceContent responsive>
        <XDriveMediaGalleryPage source={source} initialSection="library" preferenceScope={`m13-${location.search}`}
          onOpenViewer={item => { probe.viewers.push(item.node.id) }}
          onError={error => { probe.errors.push(String(error)) }} />
      </XDriveWorkspaceContent>
    </div>
  </XDriveAppearanceThemeProvider>,
)
