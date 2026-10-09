import { createRoot } from 'react-dom/client'
import { XDriveMediaGallery, XDriveMediaGalleryPage } from '@probe/gallery'
import { XDriveAppearanceThemeProvider } from '@probe/theme'
import goldens from './media-properties-fixtures.cjs'

const makeItem = (id: number) => ({
  node: { id, name: `Item-${id}.jpg`, type: 'file' as const, parent_id: 1, size: 4096, revision: 7,
    created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z' },
  metadata: { media_kind: 'image' as const, mime_type: 'image/jpeg', index_state: 'ready',
    captured_at: '2026-10-09T12:00:00Z', has_thumbnail: false, width: 100, height: 100 },
  tags: [id === 101 ? 'A-tag' : 'B-tag'], people: [id === 101 ? 'A-person' : 'B-person'],
  description: id === 101 ? 'A-description' : 'B-description', favorite: false,
})

// Only transport completion is controlled. Target selection and every editor
// state belong to the real Gallery -> Inspector -> Details component chain.
const transport = {
  requests: [] as Array<{ field: string; id: number; revision: number; value: unknown }>,
  pending: null as null | { field: string; resolve: (value: any) => void; reject: (error: Error) => void },
  previewRevision: 7,
  rangeRequests: [] as Array<{ revision: number; offset: number }>,
  previewRequests: [] as Array<{ nodeID: number; kind: string; fileName?: string; revision?: number; currentRevision: number }>,
  advancePreviewRevision() { this.previewRevision = 8 },
  settle(mode: 'success' | 'error') {
    const request = this.pending
    if (!request) throw new Error('No held mutation')
    this.pending = null
    if (mode === 'error') request.reject(new Error('A-save-failed'))
    else request.resolve(request.field === 'description' ? 'A-normalized' : ['A-normalized'])
  },
}
;(window as any).galleryPropertiesProbe = transport
function save(field: string, target: ReturnType<typeof makeItem>, value: unknown): Promise<any> {
  transport.requests.push({ field, id: target.node.id, revision: target.node.revision, value })
  return new Promise((resolve, reject) => { transport.pending = { field, resolve, reject } })
}
const goldenName = new URLSearchParams(location.search).get('golden') || ''
const golden = goldens.items[goldenName]
const items = golden ? [structuredClone(golden)] : [makeItem(101), makeItem(202)]
const rawRevisionCase = new URLSearchParams(location.search).has('raw-revision')
const rawItem = () => {
  const original = makeItem(101)
  return {
    ...original,
    node: { ...original.node, name: 'Revision-source.dng', revision: transport.previewRevision },
    metadata: { ...original.metadata, mime_type: 'image/x-adobe-dng', width: transport.previewRevision === 7 ? 100 : 200 },
  }
}
const rawRevisionSource = {
  listItems: async () => [rawItem()],
  listItemRange: async (limit: number, offset: number) => {
    transport.rangeRequests.push({ revision: transport.previewRevision, offset })
    return { items: offset === 0 ? [rawItem()] : [], offset, limit, total_count: 1, has_more: false }
  },
  listAlbums: async () => [],
  listAlbumItemRange: async () => ({ items: [], offset: 0, limit: 100, total_count: 0, has_more: false }),
  loadThumbnail: async () => null,
  loadPreviewURL: async (nodeID: number, kind: string, _signal?: AbortSignal, fileName?: string, revision?: number) => {
    transport.previewRequests.push({ nodeID, kind, fileName, revision, currentRevision: transport.previewRevision })
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="red"/%3E%3C/svg%3E'
  },
  setDescription: async (_nodeID: number, description: string) => description,
}
createRoot(document.getElementById('root')!).render(
  <XDriveAppearanceThemeProvider appearance="light">
    {rawRevisionCase ? (
      <XDriveMediaGalleryPage source={rawRevisionSource} preferenceScope="m09-raw-properties-revision" initialSection="library" />
    ) : <XDriveMediaGallery items={items} collectionKey="m09-gallery-entry" searchActive timeZone="UTC"
      loadThumbnail={async () => null}
      onSetTags={(target, values) => save('tags', target as ReturnType<typeof makeItem>, values)}
      onSetPeople={(target, values) => save('people', target as ReturnType<typeof makeItem>, values)}
      onSetDescription={(target, value) => save('description', target as ReturnType<typeof makeItem>, value)}
    />}
  </XDriveAppearanceThemeProvider>,
)
