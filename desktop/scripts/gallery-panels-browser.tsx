import { createRoot } from 'react-dom/client'
import { XDriveMediaGalleryPage } from '@probe/gallery'
import { XDriveWorkspaceContent } from '@probe/content'
import { XDriveAppearanceThemeProvider } from '@probe/theme'

const stamp = '2026-10-09T12:00:00Z'
const items = Array.from({ length: 8 }, (_, index) => ({
  node: { id: index + 101, name: `Gallery-${index + 1}.jpg`, type: 'file' as const, parent_id: 1,
    size: 4096, revision: 7, created_at: stamp, updated_at: stamp },
  metadata: { media_kind: 'image' as const, mime_type: 'image/jpeg', index_state: 'ready',
    captured_at: stamp, has_thumbnail: false, width: 100, height: 100 },
  tags: [], people: [], description: '', favorite: false,
}))
const probe = ((window as any).galleryPanelsProbe = { calls: [] as any[], errors: [] as string[], routes: [] as string[], viewers: [] as number[] })
const range = async (limit: number, offset: number, query: unknown = {}) => {
  probe.calls.push({ kind: 'range', limit, offset, query: structuredClone(query) })
  return { items: items.slice(offset, offset + limit), offset, limit, total_count: items.length, has_more: offset + limit < items.length }
}
const source = {
  listItems: async () => items,
  listItemRange: range,
  listAlbums: async () => [],
  listAlbumItemRange: async () => ({ items: [], offset: 0, limit: 100, total_count: 0, has_more: false }),
  listTrashItemRange: async (limit: number, offset: number) => { probe.calls.push({ kind: 'trash', limit, offset }); return { items: [], offset, limit, total_count: 0, has_more: false } },
  listFacets: async (query: unknown = {}, albumID?: string) => {
    probe.calls.push({ kind: 'facets', query: structuredClone(query), albumID })
    return {
      cameras: [{ value: 'camera-a', label: '长设备名称阅读检查相机原始完整标签', item_count: 8 }],
      formats: [{ value: 'jpeg', label: 'JPEG', item_count: 8 }, { value: 'heic', label: 'HEIC', item_count: 0 }],
    }
  },
  createSmartAlbum: async (name: string, query: unknown) => {
    probe.calls.push({ kind: 'create-smart', name, query: structuredClone(query) })
    return { id: 'qa-smart', kind: 'smart' as const, name, item_count: 8, revision: 1, query, created_at: stamp, updated_at: stamp }
  },
  loadThumbnail: async () => null,
}
createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light">
    <div style={{ height: '100dvh', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <XDriveWorkspaceContent responsive>
        <XDriveMediaGalleryPage source={source} initialSection="library" preferenceScope={`m11-${location.search}`}
          onSectionRouteChange={section => { probe.routes.push(section) }}
          onOpenViewer={item => { probe.viewers.push(item.node.id) }}
          onError={error => { probe.errors.push(String(error)) }} />
      </XDriveWorkspaceContent>
    </div>
  </XDriveAppearanceThemeProvider>,
)
