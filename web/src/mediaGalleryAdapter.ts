import { createXDriveMediaGalleryDataSource } from '@xdrive/ui/mui'
import type { XDriveApi } from './api'

export function createWebMediaGalleryDataSource(api: XDriveApi) {
  return createXDriveMediaGalleryDataSource({
    listItems: (limit, offset, query) => api.mediaItems('', limit, offset, query),
    listAlbums: () => api.mediaAlbums(),
    listPlaces: (limit = 24) => api.mediaPlaces(limit),
    listSuggestedPeople: (limit = 24) => api.mediaSuggestedPeople(limit),
    listSuggestedPersonItems: (personID, limit, offset, query) =>
      api.mediaSuggestedPersonItems(personID, limit, offset, query),
    listPeople: (includeHidden = false, limit = 100, offset = 0) =>
      api.mediaPeople(includeHidden, limit, offset),
    listPersonItems: (personID, limit, offset, query) =>
      api.mediaPersonItems(personID, limit, offset, query),
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
    loadThumbnail: (nodeID) => api.mediaThumbnail(nodeID),
    loadLivePhotoMotion: (nodeID) => api.mediaLivePhotoMotion(nodeID),
    loadPreviewURL: (nodeID, _kind) => api.filePreviewURL(nodeID),
    setFavorite: (nodeID, favorite) => api.setMediaFavorite(nodeID, favorite),
    setTags: (nodeID, tags) => api.setMediaTags(nodeID, tags),
    setPeople: (nodeID, people) => api.setMediaPeople(nodeID, people),
    setDescription: (nodeID, description) => api.setMediaDescription(nodeID, description),
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
