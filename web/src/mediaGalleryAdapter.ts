import {
  createXDriveMediaGalleryDataSource,
  xDriveMediaGalleryTrashRoots,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'

export function createWebMediaGalleryDataSource(api: XDriveApi) {
  return createXDriveMediaGalleryDataSource({
    listItems: (limit, offset, query) => api.mediaItems('', limit, offset, query),
    listItemRange: (limit, offset, query) => api.mediaItemRange('', limit, offset, query),
    listTrashItemRange: (limit, offset) => api.mediaTrashRange(limit, offset),
    restoreTrashItems: async (items) => {
      for (const root of xDriveMediaGalleryTrashRoots(items)) {
        await api.restoreTrash(root.id, root.revision)
      }
    },
    permanentlyDeleteTrashItems: async (items) => {
      for (const root of xDriveMediaGalleryTrashRoots(items)) {
        await api.permanentlyDeleteTrash(root.id, root.revision)
      }
    },
    listAlbums: () => api.mediaAlbums(),
    listPlaces: (limit = 24) => api.mediaPlaces(limit),
    listMemories: (anchorDate = '', limit = 24) =>
      api.mediaMemories(anchorDate, limit),
    listMemoryItemRange: (memoryID, limit, offset) =>
      api.mediaMemoryItemRange(memoryID, limit, offset),
    listDuplicateGroups: (limit = 24) => api.mediaDuplicateGroups(limit),
    listDuplicateItemRange: (duplicateID, limit, offset) =>
      api.mediaDuplicateItemRange(duplicateID, limit, offset),
    listBurstReviews: (limit = 24) => api.mediaBurstReviews(limit),
    listBurstReviewItemRange: (burstID, limit, offset) =>
      api.mediaBurstReviewItemRange(burstID, limit, offset),
    listPets: () => api.mediaPets(),
    listPetItemRange: (petKind, limit, offset) =>
      api.mediaPetItemRange(petKind, limit, offset),
    listSuggestedPeople: (includeReviewed = false, limit = 24) =>
      api.mediaSuggestedPeopleWithReview(includeReviewed, limit),
    listSuggestedPersonItems: (personID, limit, offset, query) =>
      api.mediaSuggestedPersonItems(personID, limit, offset, query),
    listSuggestedPersonItemRange: (personID, limit, offset, query) =>
      api.mediaSuggestedPersonItemRange(personID, limit, offset, query),
    listPeople: (includeHidden = false, limit = 100, offset = 0) =>
      api.mediaPeople(includeHidden, limit, offset),
    listPersonItems: (personID, limit, offset, query) =>
      api.mediaPersonItems(personID, limit, offset, query),
    listPersonItemRange: (personID, limit, offset, query) =>
      api.mediaPersonItemRange(personID, limit, offset, query),
    reviewSuggestedPerson: (suggestionID, state) =>
      api.reviewMediaSuggestedPerson(suggestionID, state),
    addSuggestedPersonToPerson: (suggestionID, personID, revision) =>
      api.addMediaSuggestedPersonToPerson(
        suggestionID,
        personID,
        revision,
      ),
    adoptSuggestedPerson: (suggestionID, name) =>
      api.adoptMediaSuggestedPerson(suggestionID, name),
    updatePerson: (personID, revision, input) =>
      api.updateMediaPerson(personID, revision, input),
    mergePeople: (targetID, revision, sourceIDs) =>
      api.mergeMediaPeople(targetID, revision, sourceIDs),
    splitPerson: (personID, revision, nodeIDs, name) =>
      api.splitMediaPerson(personID, revision, nodeIDs, name),
    listAlbumItems: (albumID, limit, offset, query) =>
      api.mediaAlbumItems(albumID, limit, offset, query),
    listAlbumItemRange: (albumID, limit, offset, query) =>
      api.mediaAlbumItemRange(albumID, limit, offset, query),
    loadThumbnail: (nodeID) => api.mediaThumbnail(nodeID),
    loadLivePhotoMotion: (nodeID, _onProgress) => api.mediaLivePhotoMotionURL(nodeID),
    loadPreviewURL: (nodeID, kind) => kind === 'live_photo'
      ? api.mediaLivePhotoStillURL(nodeID)
      : api.filePreviewURL(nodeID),
    setFavorite: (nodeID, favorite) => api.setMediaFavorite(nodeID, favorite),
    setFavoriteBatch: (nodeIDs, favorite) => api.setMediaFavoriteBatch(nodeIDs, favorite),
    addTagsBatch: (nodeIDs, tags) => api.addMediaTagsBatch(nodeIDs, tags),
    deleteItems: (items) => api.createFileOperation(
      'delete',
      items.map((item) => ({ id: item.node.id, revision: item.node.revision })),
    ),
    downloadItems: (items) => items.length === 1
      ? api.download(items[0].node)
      : api.downloadArchive(items.map((item) => item.node.id), 'xdrive-photos.zip'),
    setTags: (nodeID, tags) => api.setMediaTags(nodeID, tags),
    setPeople: (nodeID, people) => api.setMediaPeople(nodeID, people),
    setDescription: (nodeID, description) => api.setMediaDescription(nodeID, description),
    saveEditRecipe: (nodeID, input) => api.saveMediaEditRecipe(nodeID, input),
    resetEditRecipe: (nodeID, revision) => api.resetMediaEditRecipe(nodeID, revision),
    createCreativeGeneration: (nodeID, input) =>
      api.createMediaCreativeGeneration(nodeID, input),
    getCreativeGeneration: (generationID) =>
      api.mediaCreativeGeneration(generationID),
    cancelCreativeGeneration: (generationID) =>
      api.cancelMediaCreativeGeneration(generationID),
    createAlbum: (name) => api.createMediaAlbum(name),
    createSmartAlbum: (name, query) => api.createSmartMediaAlbum(name, query),
    updateSmartAlbum: (albumID, revision, input) =>
      api.updateSmartMediaAlbum(albumID, revision, input),
    deleteSmartAlbum: (albumID, revision) =>
      api.deleteSmartMediaAlbum(albumID, revision),
    renameAlbum: (albumID, revision, name) =>
      api.renameMediaAlbum(albumID, revision, name),
    deleteAlbum: (albumID, revision) => api.deleteMediaAlbum(albumID, revision),
    addToAlbum: (albumID, revision, nodeIDs) =>
      api.addMediaAlbumItems(albumID, revision, nodeIDs),
    removeFromAlbum: (albumID, revision, nodeID) =>
      api.removeMediaAlbumItem(albumID, revision, nodeID),
  })
}
