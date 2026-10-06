import { createXDriveMediaGalleryDataSource } from '@xdrive/ui/mui'

export function createDesktopMediaGalleryDataSource(
  agent: Window['xdriveDesktop']['agent'],
) {
  return createXDriveMediaGalleryDataSource({
    listItems: (limit, offset, query) => agent.getMediaItems('', limit, offset, query),
    listItemRange: (limit, offset, query) => agent.getMediaItemRange('', limit, offset, query),
    listAlbums: () => agent.getMediaAlbums(),
    listPlaces: (limit = 24) => agent.getMediaPlaces(limit),
    listSuggestedPeople: (limit = 24) => agent.getMediaSuggestedPeople(limit),
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
    loadThumbnail: (nodeID) => agent.getMediaThumbnail(nodeID),
    loadLivePhotoMotion: (nodeID) => agent.getMediaLivePhotoMotion(nodeID),
    loadPreviewURL: (nodeID, _kind) => agent.cloudFilePreviewURL(nodeID),
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
