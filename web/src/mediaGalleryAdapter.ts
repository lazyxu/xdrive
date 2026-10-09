import {
  createXDriveMediaGalleryDataSource,
  xDriveMediaGalleryTrashRoots,
} from '@xdrive/ui/mui'
import { xDriveCompleteLivePhotoOriginalNodeIDs, xDriveFileUsesRawCompatibilityPreview } from '../../ui/shared/src'
import type { XDriveApi } from './api'

export function createWebMediaGalleryDataSource(api: XDriveApi) {
  return createXDriveMediaGalleryDataSource({
    loadMusicRoot: () => api.root(),
    listMusicChildren: (parentID) => api.list(parentID),
    listItems: (limit, offset, query) => api.mediaItems('', limit, offset, query),
    listItemRange: (limit, offset, query, signal) => api.mediaItemRange('', limit, offset, query, signal),
    listFacets: (query, albumID) => api.mediaFacets(query, albumID),
    getIndexStatus: () => api.mediaIndexStatus(),
    createSelectionSnapshot: (query, albumID, day) =>
      api.createMediaSelectionSnapshot(query, albumID, day),
    getSelectionSnapshot: (token, offset, limit) =>
      api.getMediaSelectionSnapshot(token, offset, limit),
    setSelectionExcluded: (token, nodeID, excluded, version) =>
      api.setMediaSelectionExcluded(token, nodeID, excluded, version),
    deleteSelectionSnapshot: (token) => api.deleteMediaSelectionSnapshot(token),
    submitSelectionFavoriteJob: (token, version, favorite) =>
      api.submitMediaSelectionFavoriteJob(token, version, favorite),
    getSelectionJob: (id) => api.getMediaSelectionJob(id),
    listSelectionJobs: () => api.listMediaSelectionJobs(),
    cancelSelectionJob: (id) => api.cancelMediaSelectionJob(id),
    retrySelectionJob: (id) => api.retryMediaSelectionJob(id),
    getSelectionJobFailures: (id, offset, limit) =>
      api.mediaSelectionJobFailures(id, offset, limit),
    getNodeLocation: (nodeID, signal) => api.nodeLocation(nodeID, signal),
    getDuplicateOrganizePlan: (keeperNodeID, nodeIDs) => api.mediaDuplicateOrganizePlan(keeperNodeID, nodeIDs),
    applyDuplicateOrganize: (input) => api.mediaDuplicateOrganizeApply(input),
    listSyncFolders: () => api.mediaSyncFolders(),
    getSyncFolder: (sourceID, folderID) => api.mediaSyncFolder(sourceID, folderID),
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
    listAlbumFolders: () => api.mediaAlbumFolders(),
    createAlbumFolder: (name, parentID) => api.createMediaAlbumFolder(name, parentID),
    updateAlbumFolder: (folderID, revision, change) =>
      api.updateMediaAlbumFolder(folderID, revision, change),
    deleteAlbumFolder: (folderID, revision) =>
      api.deleteMediaAlbumFolder(folderID, revision),
    moveAlbumToFolder: (albumID, revision, folderID) =>
      api.moveMediaAlbumToFolder(albumID, revision, folderID),
    listPlaces: (limit = 24) => api.mediaPlaces(limit),
    getBaiduMapProvider: () => api.mediaBaiduMapProvider(),
    loadBaiduStaticMap: (input, signal) => api.mediaBaiduStaticMap(input, signal),
    listMemories: (anchorDate = '', limit = 24, timeZone = 'UTC') =>
      api.mediaMemories(anchorDate, limit, timeZone),
    listMemoryItemRange: (memoryID, limit, offset, timeZone = 'UTC') =>
      api.mediaMemoryItemRange(memoryID, limit, offset, timeZone),
    listDuplicateGroups: (limit = 24, offset = 0) => api.mediaDuplicateGroups(limit, offset),
    listDuplicateItemRange: (duplicateID, limit, offset) =>
      api.mediaDuplicateItemRange(duplicateID, limit, offset),
    listBurstReviews: (limit = 24, offset = 0) => api.mediaBurstReviews(limit, offset),
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
    loadThumbnail: (nodeID, signal, revision, onProgress) => api.mediaThumbnail(nodeID, signal, revision, onProgress),
    saveVideoPoster: (nodeID, revision, poster, signal) => api.mediaVideoPoster(nodeID, revision, poster, signal),
    loadLivePhotoMotion: (nodeID, _onProgress) => api.mediaLivePhotoMotionURL(nodeID),
    loadPreviewURL: (nodeID, kind, signal, fileName, revision, onProgress) => kind === 'live_photo'
      ? api.mediaLivePhotoStillURL(nodeID)
      : kind === 'image' && xDriveFileUsesRawCompatibilityPreview(fileName ?? '')
        ? api.mediaAnalysisPreviewURL(nodeID, signal, revision, onProgress)
        : api.filePreviewURL(nodeID, signal),
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
    exportLivePhoto: (item) => {
      const ids = xDriveCompleteLivePhotoOriginalNodeIDs(item)
      return ids.length === 1
        ? api.download(item.node)
        : api.downloadArchive(ids, 'xdrive-live-photo.zip')
    },
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
    setAlbumCover: (albumID, revision, nodeID) =>
      api.setMediaAlbumCover(albumID, revision, nodeID),
    addToAlbum: (albumID, revision, nodeIDs) =>
      api.addMediaAlbumItems(albumID, revision, nodeIDs),
    removeFromAlbum: (albumID, revision, nodeID) =>
      api.removeMediaAlbumItem(albumID, revision, nodeID),
  })
}
