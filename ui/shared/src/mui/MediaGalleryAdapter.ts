import type {
  MediaAlbum,
  MediaGalleryQuery,
  MediaItem,
  MediaPlaceFacet,
} from '../models'
import type { MediaGalleryDataSource } from './MediaGallery'

export type XDriveMediaGalleryTransportError = {
  message: string
}

export type XDriveMediaGalleryTransportResult<T> =
  | T
  | { ok: true; data: T }
  | { ok: false; error: XDriveMediaGalleryTransportError }

export type XDriveMediaGalleryBinaryResource =
  | string
  | Blob
  | {
      content_type?: string
      data_base64: string
    }

export interface XDriveMediaGalleryPort {
  listItems: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItem[]>>
  listAlbums: () => Promise<XDriveMediaGalleryTransportResult<MediaAlbum[]>>
  listPlaces?: (
    limit?: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaPlaceFacet[]>>
  listAlbumItems: (
    albumID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItem[]>>
  loadThumbnail: (
    nodeID: number,
  ) => Promise<XDriveMediaGalleryTransportResult<XDriveMediaGalleryBinaryResource>>
  loadLivePhotoMotion?: (
    nodeID: number,
  ) => Promise<XDriveMediaGalleryTransportResult<XDriveMediaGalleryBinaryResource>>
  loadPreviewURL?: (
    nodeID: number,
    kind: 'image' | 'video',
  ) => Promise<XDriveMediaGalleryTransportResult<string>>
  setFavorite?: (
    nodeID: number,
    favorite: boolean,
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  setTags?: (
    nodeID: number,
    tags: string[],
  ) => Promise<XDriveMediaGalleryTransportResult<string[] | { tags: string[] }>>
  setPeople?: (
    nodeID: number,
    people: string[],
  ) => Promise<XDriveMediaGalleryTransportResult<string[] | { people: string[] }>>
  setDescription?: (
    nodeID: number,
    description: string,
  ) => Promise<XDriveMediaGalleryTransportResult<string | { description: string }>>
  createAlbum?: (
    name: string,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaAlbum>>
  createSmartAlbum?: (
    name: string,
    query: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaAlbum>>
  updateSmartAlbum?: (
    albumID: string,
    revision: number,
    input: { name?: string; query?: MediaGalleryQuery },
  ) => Promise<XDriveMediaGalleryTransportResult<MediaAlbum>>
  deleteSmartAlbum?: (
    albumID: string,
    revision: number,
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  renameAlbum?: (
    albumID: string,
    revision: number,
    name: string,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaAlbum>>
  deleteAlbum?: (
    albumID: string,
    revision: number,
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  addToAlbum?: (
    albumID: string,
    revision: number,
    nodeIDs: number[],
  ) => Promise<XDriveMediaGalleryTransportResult<MediaAlbum>>
  removeFromAlbum?: (
    albumID: string,
    revision: number,
    nodeID: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaAlbum>>
}

function isWrappedTransportResult<T>(
  value: XDriveMediaGalleryTransportResult<T>,
): value is { ok: true; data: T } | { ok: false; error: XDriveMediaGalleryTransportError } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'ok' in value &&
    ('data' in value || 'error' in value),
  )
}

async function resolveTransport<T>(
  value: Promise<XDriveMediaGalleryTransportResult<T>>,
): Promise<T> {
  const result = await value
  if (!isWrappedTransportResult(result)) return result
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function mediaResourceURL(
  resource: XDriveMediaGalleryBinaryResource,
  fallbackContentType: string,
) {
  if (typeof resource === 'string') return resource
  if ('data_base64' in resource) {
    return `data:${resource.content_type || fallbackContentType};base64,${resource.data_base64}`
  }
  return URL.createObjectURL(resource)
}

export function createXDriveMediaGalleryDataSource(
  port: XDriveMediaGalleryPort,
): MediaGalleryDataSource {
  return {
    listItems: (limit, offset, query) => resolveTransport(
      port.listItems(limit, offset, query),
    ),
    listAlbums: () => resolveTransport(port.listAlbums()),
    listPlaces: port.listPlaces
      ? (limit) => resolveTransport(port.listPlaces!(limit))
      : undefined,
    listAlbumItems: (albumID, limit, offset, query) => resolveTransport(
      port.listAlbumItems(albumID, limit, offset, query),
    ),
    loadThumbnail: async (nodeID) => mediaResourceURL(
      await resolveTransport(port.loadThumbnail(nodeID)),
      'image/jpeg',
    ),
    loadLivePhotoMotion: port.loadLivePhotoMotion
      ? async (nodeID) => mediaResourceURL(
          await resolveTransport(port.loadLivePhotoMotion!(nodeID)),
          'video/quicktime',
        )
      : undefined,
    loadPreviewURL: port.loadPreviewURL
      ? (nodeID, kind) => resolveTransport(port.loadPreviewURL!(nodeID, kind))
      : undefined,
    setFavorite: port.setFavorite
      ? async (nodeID, favorite) => {
          await resolveTransport(port.setFavorite!(nodeID, favorite))
        }
      : undefined,
    setTags: port.setTags
      ? async (nodeID, tags) => {
          const result = await resolveTransport(port.setTags!(nodeID, tags))
          return Array.isArray(result) ? result : result.tags
        }
      : undefined,
    setPeople: port.setPeople
      ? async (nodeID, people) => {
          const result = await resolveTransport(port.setPeople!(nodeID, people))
          return Array.isArray(result) ? result : result.people
        }
      : undefined,
    setDescription: port.setDescription
      ? async (nodeID, description) => {
          const result = await resolveTransport(port.setDescription!(nodeID, description))
          return typeof result === 'string' ? result : result.description
        }
      : undefined,
    createAlbum: port.createAlbum
      ? (name) => resolveTransport(port.createAlbum!(name))
      : undefined,
    createSmartAlbum: port.createSmartAlbum
      ? (name, query) => resolveTransport(port.createSmartAlbum!(name, query))
      : undefined,
    updateSmartAlbum: port.updateSmartAlbum
      ? (albumID, revision, input) => resolveTransport(
          port.updateSmartAlbum!(albumID, revision, input),
        )
      : undefined,
    deleteSmartAlbum: port.deleteSmartAlbum
      ? async (albumID, revision) => {
          await resolveTransport(port.deleteSmartAlbum!(albumID, revision))
        }
      : undefined,
    renameAlbum: port.renameAlbum
      ? (albumID, revision, name) => resolveTransport(
          port.renameAlbum!(albumID, revision, name),
        )
      : undefined,
    deleteAlbum: port.deleteAlbum
      ? async (albumID, revision) => {
          await resolveTransport(port.deleteAlbum!(albumID, revision))
        }
      : undefined,
    addToAlbum: port.addToAlbum
      ? (albumID, revision, nodeIDs) => resolveTransport(
          port.addToAlbum!(albumID, revision, nodeIDs),
        )
      : undefined,
    removeFromAlbum: port.removeFromAlbum
      ? (albumID, revision, nodeID) => resolveTransport(
          port.removeFromAlbum!(albumID, revision, nodeID),
        )
      : undefined,
  }
}
