import type { MediaGalleryDataSource } from './MediaGallery'
import type { MediaGalleryQuery, MediaItem, MediaItemRange } from '../models'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import { xDriveSynologyLoadBoundedMediaPreview, xDriveSynologyPreviewMIME } from '../synology-media-preview'
import { xDriveSynologyLoadOwnerThumbnail } from '../synology-owner-thumbnail'
import {
  xDriveSynologyLoadNativeMediaStream, xDriveSynologyPlaybackMIME,
} from '../synology-media-stream'

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
  livePhoto: boolean
}
type OwnerGalleryReadPort = Pick<XDriveSynologyBackupLocalClient,
  'ownerGalleryItemsRange' | 'ownerGalleryAlbums' | 'ownerFileThumbnail' |
  'ownerFileMediaRange' | 'ownerFileMediaStreamURL' | 'ownerLivePhotoMotion'>

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
      // A repeated authorized page with the same Node/revision must retain
      // the identity object so it cannot invalidate an in-flight thumbnail.
      const previous = previews.get(n.id)
      const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
      const identity = previous && previous.revision === n.revision &&
        previous.size === n.size && previous.name === n.name &&
        previous.livePhoto === livePhoto
        ? previous
        : { id: n.id, revision: n.revision, size: n.size, name: n.name, livePhoto }
      previews.delete(n.id)
      previews.set(n.id, identity)
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
    loadThumbnail: async (nodeID, signal, revision, onProgress) => {
      if (signal?.aborted || !Number.isSafeInteger(nodeID) || nodeID <= 0) return null
      const known = previews.get(nodeID)
      const ownerRevision = Number.isSafeInteger(revision) && (revision ?? 0) > 0
        ? revision : known?.revision
      if (!known || !ownerRevision || ownerRevision !== known.revision) return null
      // Files and Gallery use exactly the same verified Server thumbnail,
      // optional alpha mask and real progress semantics.
      try {
        const url = await xDriveSynologyLoadOwnerThumbnail(client, {
          kind: 'file', id: known.id, revision: ownerRevision,
          name: known.name, size: known.size,
        } as Parameters<typeof xDriveSynologyLoadOwnerThumbnail>[1], signal, onProgress)
        // Owner/session and revision can change while the underlying Agent read
        // is in flight. Never publish or retain a stale Blob URL.
        if (signal?.aborted || previews.get(nodeID) !== known) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return null
        }
        return url
      } catch (error) {
        if (signal?.aborted || previews.get(nodeID) !== known) return null
        throw error
      }
    },
    loadLivePhotoMotion: async (nodeID, onProgress, signal) => {
      if (signal?.aborted || !Number.isSafeInteger(nodeID) || nodeID < 1) return null
      const identity = previews.get(nodeID)
      if (!identity?.livePhoto) return null
      // The Server's verified Live Photo endpoint, not the .livp archive or
      // an unrelated MOV Node, supplies exactly this Owner/revision's motion.
      // DSM only transports it; the SAME shared LivePhotoSurface owns hold,
      // release, seek, frame and abort lifecycle on every Host.
      const motion = await client.ownerLivePhotoMotion(nodeID, identity.revision, signal)
      if (signal?.aborted || previews.get(nodeID) !== identity ||
        motion.nodeID !== nodeID || motion.revision !== identity.revision ||
        motion.size !== motion.data.length || !globalThis.crypto?.subtle) return null
      const ownedBuffer = new ArrayBuffer(motion.data.length)
      const owned = new Uint8Array(ownedBuffer)
      owned.set(motion.data)
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', owned))
      const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
      if (signal?.aborted || previews.get(nodeID) !== identity ||
        actual !== motion.sha256) return null
      const url = URL.createObjectURL(new Blob([ownedBuffer], { type: motion.mimeType }))
      if (signal?.aborted || previews.get(nodeID) !== identity) {
        URL.revokeObjectURL(url)
        return null
      }
      onProgress?.(motion.size, motion.size, null)
      // Shared LivePhotoSurface disposes this Blob lease on Viewer close,
      // Owner switch and explicit hold release; there is no DSM player.
      return url
    },
    loadPreviewURL: async (nodeID, kind, signal, _fileName, revision, onProgress) => {
      if ((kind !== 'image' && kind !== 'video') || signal?.aborted) return null
      const identity = previews.get(nodeID)
      if (!identity || (revision && revision !== identity.revision)) return null
      // Gallery reuses the SAME Owner-scoped native Range player as DSM Files
      // Quick Look. The initial authenticated bytes are checked for media
      // magic, Node/revision/length/SHA and a fixed browser-playable MIME.
      // The media element subsequently requests only the existing same-origin
      // DSM CGI route, which authorizes Owner/Agent on every Range. No Blob,
      // remote URL, Owner JWT or separate privileged media API is created.
      if (kind === 'video') {
        const mime = xDriveSynologyPlaybackMIME(identity.name)
        if (!mime || !mime.startsWith('video/')) return null
        const url = await xDriveSynologyLoadNativeMediaStream(client, {
          id: identity.id, name: identity.name, size: identity.size,
          revision: identity.revision, kind: 'file',
        } as Parameters<typeof xDriveSynologyLoadNativeMediaStream>[1], signal)
        return signal?.aborted || previews.get(nodeID) !== identity ? null : url
      }
      // A claimed image cannot reinterpret a video or PDF as a still Blob.
      // Image originals remain SHA-verified and bounded to 32 MiB.
      const imageMIME = xDriveSynologyPreviewMIME(identity.name)
      if (!imageMIME || !imageMIME.startsWith('image/') ||
        identity.size <= 0 || identity.size > 32 * (1 << 20)) return null
      const url = await xDriveSynologyLoadBoundedMediaPreview(client, {
        id: identity.id, name: identity.name, size: identity.size,
        revision: identity.revision, kind: 'file',
      } as Parameters<typeof xDriveSynologyLoadBoundedMediaPreview>[1], signal, onProgress)
      if (signal?.aborted || previews.get(nodeID) !== identity) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        return null
      }
      return url
    },
  }
}
