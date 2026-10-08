import type {
  MediaAlbum,
  MediaGalleryQuery,
  MediaItem,
  MediaItemRange,
  MediaMemory,
  Node,
  MediaPersonIdentity,
  MediaPersonSplit,
  MediaPlaceFacet,
  MediaSuggestedPerson,
  UpdateMediaPersonIdentityInput,
} from '../models'
import type { XDriveByteProgressHandler } from '../file-preview'
import { resolveXDriveTransport } from '../transport-result'
import type {
  XDriveTransportError,
  XDriveTransportResult,
} from '../transport-result'
import type { MediaGalleryDataSource } from './MediaGallery'

export type XDriveMediaGalleryTransportError = XDriveTransportError

export type XDriveMediaGalleryTransportResult<T> =
  XDriveTransportResult<T, XDriveMediaGalleryTransportError>

export type XDriveMediaGalleryBinaryResource =
  | string
  | Blob
  | {
      content_type?: string
      data: ArrayBuffer
    }

export interface XDriveMediaGalleryPort {
  listItems: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItem[]>>
  listItemRange: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItemRange>>
  listTrashItemRange?: (
    limit: number,
    offset: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItemRange>>
  restoreTrashItems?: (
    items: MediaItem[],
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  permanentlyDeleteTrashItems?: (
    items: MediaItem[],
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  listAlbums: () => Promise<XDriveMediaGalleryTransportResult<MediaAlbum[]>>
  listPlaces?: (
    limit?: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaPlaceFacet[]>>
  listMemories?: (
    anchorDate?: string,
    limit?: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaMemory[]>>
  listMemoryItemRange?: (
    memoryID: string,
    limit: number,
    offset: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItemRange>>
  listSuggestedPeople?: (
    limit?: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaSuggestedPerson[]>>
  listSuggestedPersonItems?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItem[]>>
  listSuggestedPersonItemRange?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItemRange>>
  listPeople?: (
    includeHidden?: boolean,
    limit?: number,
    offset?: number,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaPersonIdentity[]>>
  listPersonItems?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItem[]>>
  listPersonItemRange?: (
    personID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItemRange>>
  adoptSuggestedPerson?: (
    suggestionID: string,
    name: string,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaPersonIdentity>>
  updatePerson?: (
    personID: string,
    revision: number,
    input: UpdateMediaPersonIdentityInput,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaPersonIdentity>>
  mergePeople?: (
    targetID: string,
    revision: number,
    sourceIDs: string[],
  ) => Promise<XDriveMediaGalleryTransportResult<MediaPersonIdentity>>
  splitPerson?: (
    personID: string,
    revision: number,
    nodeIDs: number[],
    name: string,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaPersonSplit>>
  listAlbumItems: (
    albumID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItem[]>>
  listAlbumItemRange: (
    albumID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<XDriveMediaGalleryTransportResult<MediaItemRange>>
  loadThumbnail: (
    nodeID: number,
  ) => Promise<XDriveMediaGalleryTransportResult<XDriveMediaGalleryBinaryResource>>
  loadLivePhotoMotion?: (
    nodeID: number,
    onProgress?: XDriveByteProgressHandler,
  ) => Promise<XDriveMediaGalleryTransportResult<XDriveMediaGalleryBinaryResource>>
  loadPreviewURL?: (
    nodeID: number,
    kind: 'image' | 'video',
  ) => Promise<XDriveMediaGalleryTransportResult<string>>
  setFavorite?: (
    nodeID: number,
    favorite: boolean,
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  setFavoriteBatch?: (
    nodeIDs: number[],
    favorite: boolean,
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  addTagsBatch?: (
    nodeIDs: number[],
    tags: string[],
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  deleteItems?: (
    items: MediaItem[],
  ) => Promise<XDriveMediaGalleryTransportResult<unknown>>
  downloadItems?: (
    items: MediaItem[],
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

export function xDriveMediaGalleryTrashRoots(
  items: readonly MediaItem[],
): Node[] {
  const roots = new Map<number, Node>()
  for (const item of items) {
    const root = item.trash_root ?? item.node
    if (!root?.id) continue
    roots.set(root.id, root)
  }
  return Array.from(roots.values())
}

function mediaResourceURL(
  resource: XDriveMediaGalleryBinaryResource,
  fallbackContentType: string,
) {
  if (typeof resource === 'string') return resource
  if ('data' in resource) {
    return URL.createObjectURL(new Blob(
      [resource.data],
      { type: resource.content_type || fallbackContentType },
    ))
  }
  return URL.createObjectURL(resource)
}

export function createXDriveMediaGalleryDataSource(
  port: XDriveMediaGalleryPort,
): MediaGalleryDataSource {
  return {
    listItems: (limit, offset, query) => resolveXDriveTransport(
      port.listItems(limit, offset, query),
    ),
    listItemRange: (limit, offset, query) => resolveXDriveTransport(
      port.listItemRange(limit, offset, query),
    ),
    listTrashItemRange: port.listTrashItemRange
      ? (limit, offset) => resolveXDriveTransport(
          port.listTrashItemRange!(limit, offset),
        )
      : undefined,
    restoreTrashItems: port.restoreTrashItems
      ? async (items) => {
          await resolveXDriveTransport(port.restoreTrashItems!(items))
        }
      : undefined,
    permanentlyDeleteTrashItems: port.permanentlyDeleteTrashItems
      ? async (items) => {
          await resolveXDriveTransport(port.permanentlyDeleteTrashItems!(items))
        }
      : undefined,
    listAlbums: () => resolveXDriveTransport(port.listAlbums()),
    listPlaces: port.listPlaces
      ? (limit) => resolveXDriveTransport(port.listPlaces!(limit))
      : undefined,
    listMemories: port.listMemories
      ? (anchorDate, limit) => resolveXDriveTransport(
          port.listMemories!(anchorDate, limit),
        )
      : undefined,
    listMemoryItemRange: port.listMemoryItemRange
      ? (memoryID, limit, offset) => resolveXDriveTransport(
          port.listMemoryItemRange!(memoryID, limit, offset),
        )
      : undefined,
    listSuggestedPeople: port.listSuggestedPeople
      ? (limit) => resolveXDriveTransport(port.listSuggestedPeople!(limit))
      : undefined,
    listSuggestedPersonItems: port.listSuggestedPersonItems
      ? (personID, limit, offset, query) => resolveXDriveTransport(
          port.listSuggestedPersonItems!(personID, limit, offset, query),
        )
      : undefined,
    listSuggestedPersonItemRange: port.listSuggestedPersonItemRange
      ? (personID, limit, offset, query) => resolveXDriveTransport(
          port.listSuggestedPersonItemRange!(personID, limit, offset, query),
        )
      : undefined,
    listPeople: port.listPeople
      ? (includeHidden, limit, offset) => resolveXDriveTransport(
          port.listPeople!(includeHidden, limit, offset),
        )
      : undefined,
    listPersonItems: port.listPersonItems
      ? (personID, limit, offset, query) => resolveXDriveTransport(
          port.listPersonItems!(personID, limit, offset, query),
        )
      : undefined,
    listPersonItemRange: port.listPersonItemRange
      ? (personID, limit, offset, query) => resolveXDriveTransport(
          port.listPersonItemRange!(personID, limit, offset, query),
        )
      : undefined,
    adoptSuggestedPerson: port.adoptSuggestedPerson
      ? (suggestionID, name) => resolveXDriveTransport(
          port.adoptSuggestedPerson!(suggestionID, name),
        )
      : undefined,
    updatePerson: port.updatePerson
      ? (personID, revision, input) => resolveXDriveTransport(
          port.updatePerson!(personID, revision, input),
        )
      : undefined,
    mergePeople: port.mergePeople
      ? (targetID, revision, sourceIDs) => resolveXDriveTransport(
          port.mergePeople!(targetID, revision, sourceIDs),
        )
      : undefined,
    splitPerson: port.splitPerson
      ? (personID, revision, nodeIDs, name) => resolveXDriveTransport(
          port.splitPerson!(personID, revision, nodeIDs, name),
        )
      : undefined,
    listAlbumItems: (albumID, limit, offset, query) => resolveXDriveTransport(
      port.listAlbumItems(albumID, limit, offset, query),
    ),
    listAlbumItemRange: (albumID, limit, offset, query) => resolveXDriveTransport(
      port.listAlbumItemRange(albumID, limit, offset, query),
    ),
    loadThumbnail: async (nodeID) => mediaResourceURL(
      await resolveXDriveTransport(port.loadThumbnail(nodeID)),
      'image/jpeg',
    ),
    loadLivePhotoMotion: port.loadLivePhotoMotion
      ? async (nodeID, onProgress) => mediaResourceURL(
          await resolveXDriveTransport(port.loadLivePhotoMotion!(nodeID, onProgress)),
          'video/quicktime',
        )
      : undefined,
    loadPreviewURL: port.loadPreviewURL
      ? (nodeID, kind) => resolveXDriveTransport(port.loadPreviewURL!(nodeID, kind))
      : undefined,
    setFavorite: port.setFavorite
      ? async (nodeID, favorite) => {
          await resolveXDriveTransport(port.setFavorite!(nodeID, favorite))
        }
      : undefined,
    setFavoriteBatch: port.setFavoriteBatch
      ? async (nodeIDs, favorite) => {
          await resolveXDriveTransport(port.setFavoriteBatch!(nodeIDs, favorite))
        }
      : undefined,
    addTagsBatch: port.addTagsBatch
      ? async (nodeIDs, tags) => {
          await resolveXDriveTransport(port.addTagsBatch!(nodeIDs, tags))
        }
      : undefined,
    deleteItems: port.deleteItems
      ? async (items) => {
          await resolveXDriveTransport(port.deleteItems!(items))
        }
      : undefined,
    downloadItems: port.downloadItems
      ? async (items) => {
          await resolveXDriveTransport(port.downloadItems!(items))
        }
      : undefined,
    setTags: port.setTags
      ? async (nodeID, tags) => {
          const result = await resolveXDriveTransport(port.setTags!(nodeID, tags))
          return Array.isArray(result) ? result : result.tags
        }
      : undefined,
    setPeople: port.setPeople
      ? async (nodeID, people) => {
          const result = await resolveXDriveTransport(port.setPeople!(nodeID, people))
          return Array.isArray(result) ? result : result.people
        }
      : undefined,
    setDescription: port.setDescription
      ? async (nodeID, description) => {
          const result = await resolveXDriveTransport(port.setDescription!(nodeID, description))
          return typeof result === 'string' ? result : result.description
        }
      : undefined,
    createAlbum: port.createAlbum
      ? (name) => resolveXDriveTransport(port.createAlbum!(name))
      : undefined,
    createSmartAlbum: port.createSmartAlbum
      ? (name, query) => resolveXDriveTransport(port.createSmartAlbum!(name, query))
      : undefined,
    updateSmartAlbum: port.updateSmartAlbum
      ? (albumID, revision, input) => resolveXDriveTransport(
          port.updateSmartAlbum!(albumID, revision, input),
        )
      : undefined,
    deleteSmartAlbum: port.deleteSmartAlbum
      ? async (albumID, revision) => {
          await resolveXDriveTransport(port.deleteSmartAlbum!(albumID, revision))
        }
      : undefined,
    renameAlbum: port.renameAlbum
      ? (albumID, revision, name) => resolveXDriveTransport(
          port.renameAlbum!(albumID, revision, name),
        )
      : undefined,
    deleteAlbum: port.deleteAlbum
      ? async (albumID, revision) => {
          await resolveXDriveTransport(port.deleteAlbum!(albumID, revision))
        }
      : undefined,
    addToAlbum: port.addToAlbum
      ? (albumID, revision, nodeIDs) => resolveXDriveTransport(
          port.addToAlbum!(albumID, revision, nodeIDs),
        )
      : undefined,
    removeFromAlbum: port.removeFromAlbum
      ? (albumID, revision, nodeID) => resolveXDriveTransport(
          port.removeFromAlbum!(albumID, revision, nodeID),
        )
      : undefined,
  }
}
