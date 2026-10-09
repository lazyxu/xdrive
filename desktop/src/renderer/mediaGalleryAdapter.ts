import { xDriveDesktopViewportRequest } from './abortableViewportRequest'
import {
  createXDriveMediaGalleryDataSource,
  xDriveMediaGalleryTrashRoots,
} from '@xdrive/ui/mui'

export function createDesktopMediaGalleryDataSource(
  agent: Window['xdriveDesktop']['agent'],
) {
  return createXDriveMediaGalleryDataSource({
    loadMusicRoot: () => agent.cloudRoot(),
    listMusicChildren: (parentID) => agent.cloudChildren(parentID),
    listItems: (limit, offset, query) => agent.getMediaItems('', limit, offset, query),
    listItemRange: (limit, offset, query) => agent.getMediaItemRange('', limit, offset, query),
    listFacets: (query, albumID) => agent.getMediaFacets(query, albumID),
    listSyncFolders: () => agent.getMediaSyncFolders(),
    getSyncFolder: (sourceID, folderID) => agent.getMediaSyncFolder(sourceID, folderID),
    listTrashItemRange: (limit, offset) => agent.getMediaTrash(limit, offset),
    restoreTrashItems: async (items) => {
      for (const root of xDriveMediaGalleryTrashRoots(items)) {
        await agent.cloudRestoreTrash(root.id, root.revision)
      }
    },
    permanentlyDeleteTrashItems: async (items) => {
      for (const root of xDriveMediaGalleryTrashRoots(items)) {
        await agent.cloudDeleteTrash(root.id, root.revision)
      }
    },
    listAlbums: () => agent.getMediaAlbums(),
    listPlaces: (limit = 24) => agent.getMediaPlaces(limit),
    listMemories: (anchorDate = '', limit = 24, timeZone = 'UTC') =>
      agent.getMediaMemories(anchorDate, limit, timeZone),
    listMemoryItemRange: (memoryID, limit, offset, timeZone = 'UTC') =>
      agent.getMediaMemoryItemRange(memoryID, limit, offset, timeZone),
    listDuplicateGroups: (limit = 24) => agent.getMediaDuplicateGroups(limit),
    listDuplicateItemRange: (duplicateID, limit, offset) =>
      agent.getMediaDuplicateItemRange(duplicateID, limit, offset),
    listBurstReviews: (limit = 24) => agent.getMediaBurstReviews(limit),
    listBurstReviewItemRange: (burstID, limit, offset) =>
      agent.getMediaBurstReviewItemRange(burstID, limit, offset),
    listPets: () => agent.getMediaPets(),
    listPetItemRange: (petKind, limit, offset) =>
      agent.getMediaPetItemRange(petKind, limit, offset),
    listSuggestedPeople: (includeReviewed = false, limit = 24) =>
      agent.getMediaSuggestedPeopleWithReview(includeReviewed, limit),
    listSuggestedPersonItems: (personID, limit, offset, query) =>
      agent.getMediaSuggestedPersonItems(personID, limit, offset, query),
    listSuggestedPersonItemRange: (personID, limit, offset, query) =>
      agent.getMediaSuggestedPersonItemRange(personID, limit, offset, query),
    listPeople: (includeHidden = false, limit = 100, offset = 0) =>
      agent.getMediaPeople(includeHidden, limit, offset),
    listPersonItems: (personID, limit, offset, query) =>
      agent.getMediaPersonItems(personID, limit, offset, query),
    listPersonItemRange: (personID, limit, offset, query) =>
      agent.getMediaPersonItemRange(personID, limit, offset, query),
    reviewSuggestedPerson: (suggestionID, state) =>
      agent.reviewMediaSuggestedPerson(suggestionID, state),
    addSuggestedPersonToPerson: (suggestionID, personID, revision) =>
      agent.addMediaSuggestedPersonToPerson(
        suggestionID,
        personID,
        revision,
      ),
    adoptSuggestedPerson: (suggestionID, name) =>
      agent.adoptMediaSuggestedPerson(suggestionID, name),
    updatePerson: (personID, revision, input) =>
      agent.updateMediaPerson(personID, revision, input),
    mergePeople: (targetID, revision, sourceIDs) =>
      agent.mergeMediaPeople(targetID, revision, sourceIDs),
    splitPerson: (personID, revision, nodeIDs, name) =>
      agent.splitMediaPerson(personID, revision, nodeIDs, name),
    listAlbumItems: (albumID, limit, offset, query) =>
      agent.getMediaAlbumItems(albumID, limit, offset, query),
    listAlbumItemRange: (albumID, limit, offset, query) =>
      agent.getMediaAlbumItemRange(albumID, limit, offset, query),
    loadThumbnail: (nodeID, signal) => xDriveDesktopViewportRequest(signal, (requestID) => agent.getMediaThumbnail(nodeID, requestID)),
    saveVideoPoster: async (nodeID, revision, poster, signal) => {
      signal?.throwIfAborted()
      const bytes = await poster.arrayBuffer()
      signal?.throwIfAborted()
      return agent.putMediaVideoPoster(nodeID, revision, bytes)
    },
    loadLivePhotoMotion: async (nodeID, onProgress) => {
      const result = await agent.getMediaLivePhotoMotion(nodeID, onProgress)
      if (!result.ok) return result
      return {
        ok: true as const,
        data: {
          url: result.data,
          dispose: () => {
            void agent.releaseMediaLivePhotoMotion(result.data)
          },
        },
      }
    },
    loadPreviewURL: (nodeID, kind) => kind === 'live_photo'
      ? agent.getMediaLivePhotoStill(nodeID)
      : agent.cloudFilePreviewURL(nodeID),
    setFavorite: (nodeID, favorite) => agent.setMediaFavorite(nodeID, favorite),
    setFavoriteBatch: (nodeIDs, favorite) => agent.setMediaFavoriteBatch(nodeIDs, favorite),
    addTagsBatch: (nodeIDs, tags) => agent.addMediaTagsBatch(nodeIDs, tags),
    deleteItems: (items) => agent.cloudCreateFileOperation(
      'delete',
      items.map((item) => ({ id: item.node.id, revision: item.node.revision })),
    ),
    downloadItems: (items) => items.length === 1
      ? agent.cloudDownload(items[0].node.id, items[0].node.name)
      : agent.cloudDownloadArchive(items.map((item) => item.node.id)),
    setTags: (nodeID, tags) => agent.setMediaTags(nodeID, tags),
    setPeople: (nodeID, people) => agent.setMediaPeople(nodeID, people),
    setDescription: (nodeID, description) => agent.setMediaDescription(nodeID, description),
    saveEditRecipe: (nodeID, input) => agent.saveMediaEditRecipe(nodeID, input),
    resetEditRecipe: (nodeID, revision) => agent.resetMediaEditRecipe(nodeID, revision),
    createCreativeGeneration: (nodeID, input) =>
      agent.createMediaCreativeGeneration(nodeID, input),
    getCreativeGeneration: (generationID) =>
      agent.getMediaCreativeGeneration(generationID),
    cancelCreativeGeneration: (generationID) =>
      agent.cancelMediaCreativeGeneration(generationID),
    createAlbum: (name) => agent.createMediaAlbum(name),
    createSmartAlbum: (name, query) => agent.createSmartMediaAlbum(name, query),
    updateSmartAlbum: (albumID, revision, input) =>
      agent.updateSmartMediaAlbum(albumID, revision, input),
    deleteSmartAlbum: (albumID, revision) =>
      agent.deleteSmartMediaAlbum(albumID, revision),
    renameAlbum: (albumID, revision, name) =>
      agent.renameMediaAlbum(albumID, revision, name),
    deleteAlbum: (albumID, revision) => agent.deleteMediaAlbum(albumID, revision),
    addToAlbum: (albumID, revision, nodeIDs) =>
      agent.addMediaAlbumItems(albumID, revision, nodeIDs),
    removeFromAlbum: (albumID, revision, nodeID) =>
      agent.removeMediaAlbumItem(albumID, revision, nodeID),
  })
}
