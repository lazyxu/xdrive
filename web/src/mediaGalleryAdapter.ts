import { createXDriveMediaGalleryDataSource } from '@xdrive/ui/mui'
import type { XDriveApi } from './api'

export function createWebMediaGalleryDataSource(api: XDriveApi) {
  return createXDriveMediaGalleryDataSource({
    listItems: (limit, offset, query) => api.mediaItems('', limit, offset, query),
    listAlbums: () => api.mediaAlbums(),
    listPlaces: (limit = 24) => api.mediaPlaces(limit),
    listAlbumItems: (albumID, limit, offset, query) =>
      api.mediaAlbumItems(albumID, limit, offset, query),
    loadThumbnail: (nodeID) => api.mediaThumbnail(nodeID),
    loadLivePhotoMotion: (nodeID) => api.mediaLivePhotoMotion(nodeID),
    loadVideo: (nodeID) => api.mediaVideoURL(nodeID),
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
