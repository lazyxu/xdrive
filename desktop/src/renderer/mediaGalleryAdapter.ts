import { createXDriveMediaGalleryDataSource } from '@xdrive/ui/mui'

export function createDesktopMediaGalleryDataSource(
  agent: Window['xdriveDesktop']['agent'],
) {
  return createXDriveMediaGalleryDataSource({
    listItems: (limit, offset, query) => agent.getMediaItems('', limit, offset, query),
    listAlbums: () => agent.getMediaAlbums(),
    listPlaces: (limit = 24) => agent.getMediaPlaces(limit),
    listAlbumItems: (albumID, limit, offset, query) =>
      agent.getMediaAlbumItems(albumID, limit, offset, query),
    loadThumbnail: (nodeID) => agent.getMediaThumbnail(nodeID),
    loadLivePhotoMotion: (nodeID) => agent.getMediaLivePhotoMotion(nodeID),
    loadVideo: (nodeID) => agent.getMediaVideoURL(nodeID),
    setFavorite: (nodeID, favorite) => agent.setMediaFavorite(nodeID, favorite),
    setTags: (nodeID, tags) => agent.setMediaTags(nodeID, tags),
    setPeople: (nodeID, people) => agent.setMediaPeople(nodeID, people),
    setDescription: (nodeID, description) => agent.setMediaDescription(nodeID, description),
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
