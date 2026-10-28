import type { MediaGalleryDataSource } from './MediaGallery'
import type { MediaGalleryQuery, MediaItem, MediaItemRange } from '../models'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import { xDriveSynologyLoadBoundedMediaPreview } from '../synology-media-preview'

/**
 * Host-neutral page source for the existing MediaGallery JSX. DSM only supplies
 * the original Server Owner's specifically allowlisted, redacted read ports;
 * it cannot borrow Desktop's full media API or claim unsupported filters.
 *
 * The source is per owning Client; never share its ephemeral Node/revision
 * thumbnail identities between DSM sessions or roots.
 */
const OWNER_GALLERY_PAGE_LIMIT = 100
const OWNER_GALLERY_MAX_UI_BATCH = 500
const OWNER_GALLERY_PREVIEW_CACHE = 512

type OwnerGalleryPreviewIdentity = {
  id: number
  revision: number
  name: string
  size: number
}
type OwnerGalleryReadPort = Pick<XDriveSynologyBackupLocalClient,
  'ownerGalleryItemsRange' | 'ownerGalleryAlbums' | 'ownerFileThumbnail' | 'ownerFileMediaRange'>

/**
 * Current Owner CGI supports captured-descending original Gallery/Album Range.
 * Never silently apply an unsupported search, GPS, favorite or other filter
 * client-side against a single paginated window: counts and membership would
 * be false, especially with 100k assets.
 */
export function xDriveSynologyOwnerGalleryQuerySupported(query?: MediaGalleryQuery): boolean {
  if (!query) return true
  const supported = new Set([
    'time_zone', 'sort_by', 'sort_dir', 'fold_duplicates', 'unknown_first',
    'initial_position',
  ])
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (!supported.has(key)) return false
    if (key === 'time_zone' && (typeof value !== 'string' ||
      value.length > 80 || value.length === 0)) return false
    if (key === 'sort_by' && value !== 'captured') return false
    if (key === 'sort_dir' && value !== 'desc') return false
    if (key === 'fold_duplicates' && value !== false) return false
    if (key === 'unknown_first' && value !== false) return false
    if (key === 'initial_position' && value !== 'latest') return false
  }
  return true
}

export function createXDriveSynologyOwnerGallerySource(
  client: OwnerGalleryReadPort,
): MediaGalleryDataSource {
  const previews = new Map<number, OwnerGalleryPreviewIdentity>()

  const remember = (items: readonly MediaItem[]): void => {
    for (const item of items) {
      const n = item.node
      if (!Number.isSafeInteger(n.id) || n.id <= 0 ||
        !Number.isSafeInteger(n.revision) || n.revision <= 0 ||
        !Number.isSafeInteger(n.size) || n.size < 0 ||
        !n.name) continue
      // A revised or renamed Node invalidates its previously borrowed preview.
      previews.delete(n.id)
      previews.set(n.id, {
        id: n.id, revision: n.revision, size: n.size, name: n.name,
      })
      while (previews.size > OWNER_GALLERY_PREVIEW_CACHE) {
        const oldest = previews.keys().next().value
        if (typeof oldest !== 'number') break
        previews.delete(oldest)
      }
    }
  }

  const loadRange = async (
    limit: number, offset: number, query?: MediaGalleryQuery,
    signal?: AbortSignal, albumID = '',
  ): Promise<MediaItemRange> => {
    if (!xDriveSynologyOwnerGalleryQuerySupported(query) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > OWNER_GALLERY_MAX_UI_BATCH ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000 ||
      (query?.initial_position === 'latest' && offset !== 0)) {
      throw new Error('DSM Owner 图库尚未支持此筛选、排序或分页；不会显示未经核实的结果。')
    }
    let total: number | null = null
    const items: MediaItem[] = []
    const seen = new Set<number>()
    while (items.length < limit) {
      if (signal?.aborted) throw new Error('Owner Gallery read cancelled')
      if (total !== null && offset + items.length >= total) break
      const chunk = Math.min(OWNER_GALLERY_PAGE_LIMIT, limit - items.length)
      const page = await client.ownerGalleryItemsRange(
        'all', chunk, offset + items.length, albumID, signal)
      if (signal?.aborted) throw new Error('Owner Gallery read cancelled')
      if (!Number.isSafeInteger(page.total_count) || page.total_count < 0 ||
        (total !== null && page.total_count !== total) ||
        page.offset !== offset + items.length || page.limit !== chunk ||
        !Array.isArray(page.items) || page.items.length > chunk) {
        throw new Error('Owner Gallery pagination changed; refusing mixed snapshot')
      }
      total = page.total_count
      if (page.items.length === 0) {
        if (offset + items.length < total) {
          throw new Error('Owner Gallery returned a non-advancing page')
        }
        break
      }
      for (const item of page.items) {
        if (seen.has(item.node.id)) {
          throw new Error('Owner Gallery returned duplicate identities')
        }
        seen.add(item.node.id)
        items.push(item)
      }
    }
    remember(items)
    return {
      items, total_count: total ?? 0, offset, limit,
    }
  }

  return {
    listItems: async (limit, offset, query) =>
      (await loadRange(limit, offset, query)).items,
    listItemRange: (limit, offset, query, signal) =>
      loadRange(limit, offset, query, signal),
    listAlbums: () => client.ownerGalleryAlbums(),
    listAlbumItems: async (albumID, limit, offset, query) =>
      (await loadRange(limit, offset, query, undefined, albumID)).items,
    listAlbumItemRange: (albumID, limit, offset, query, signal) =>
      loadRange(limit, offset, query, signal, albumID),
    loadThumbnail: async (nodeID, signal, revision) => {
      if (signal?.aborted || !Number.isSafeInteger(nodeID) || nodeID <= 0) return null
      const known = previews.get(nodeID)
      const ownerRevision = Number.isSafeInteger(revision) && (revision ?? 0) > 0
        ? revision : known?.revision
      // Never request a thumbnail using a guessed revision or a new Owner ID.
      if (!known || !ownerRevision || ownerRevision !== known.revision) return null
      const thumbnail = await client.ownerFileThumbnail(nodeID, ownerRevision, signal)
      if (signal?.aborted) return null
      const bytes = new Uint8Array(thumbnail.data.length)
      bytes.set(thumbnail.data)
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: thumbnail.contentType }))
      if (signal?.aborted) {
        URL.revokeObjectURL(url)
        return null
      }
      // Existing MediaGalleryThumbnailScheduler owns LRU/Viewer-lease revocation.
      return url
    },
    loadPreviewURL: async (nodeID, kind, signal, _fileName, revision, onProgress) => {
      if (kind !== 'image' || signal?.aborted) return null
      const identity = previews.get(nodeID)
      if (!identity || (revision && revision !== identity.revision)) return null
      // The existing Owner original-Range verifier has a 32 MiB SHA-256 cap.
      // Video/Live Photo and larger originals require a separate verified
      // stream capability; never synthesize a giant Blob or fake URL.
      if (identity.size <= 0 || identity.size > 32 << 20) return null
      return xDriveSynologyLoadBoundedMediaPreview(client, {
        id: identity.id, name: identity.name, size: identity.size,
        revision: identity.revision, kind: 'file',
      } as Parameters<typeof xDriveSynologyLoadBoundedMediaPreview>[1], signal, onProgress)
    },
  }
}
