import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'

type XDriveByteProgressCallback = (loadedBytes: number, totalBytes?: number) => void
let mediaLivePhotoMotionRequestSequence = 0

type MediaLivePhotoProgressEntry = {
  channel: string
  listener: Parameters<typeof ipcRenderer.on>[1]
  timer: ReturnType<typeof setTimeout>
}

const mediaLivePhotoProgressByURL = new Map<string, MediaLivePhotoProgressEntry>()

function cleanupMediaLivePhotoProgress(url: string) {
  const entry = mediaLivePhotoProgressByURL.get(url)
  if (!entry) return
  mediaLivePhotoProgressByURL.delete(url)
  clearTimeout(entry.timer)
  ipcRenderer.removeListener(entry.channel, entry.listener)
}

const agent = Object.freeze({
  getState: () => ipcRenderer.invoke('agent:get-state'),
  getTransfers: () => ipcRenderer.invoke('agent:get-transfers'),
  getStorageTree: () => ipcRenderer.invoke('agent:get-storage-tree'),
  getCache: () => ipcRenderer.invoke('agent:get-cache'),
  getLocalDiskSpace: () => ipcRenderer.invoke('agent:get-local-disk-space'),
  releaseCache: () => ipcRenderer.invoke('agent:release-cache'),
  getMediaItem: (nodeID: number, requestID: string) =>
    ipcRenderer.invoke('agent:get-media-item', nodeID, requestID),
  cancelMediaItem: (requestID: string) =>
    ipcRenderer.invoke('agent:cancel-media-item', requestID),
  getMediaItems: (
    kind = '',
    limit = 100,
    offset = 0,
    query: {
    search?: string
    fold_duplicates?: boolean
    fold_member_ids?: number[]
    asset_kind?: string
    category?: string
    folder_id?: number
    include_descendants?: boolean
    cameras?: string[]
    formats?: string[]
    captured_from?: string
    captured_to?: string
    has_location?: boolean
    favorite?: boolean
    tag?: string
    person?: string
    person_identity?: string
    place?: string
  } = {},
  ) => ipcRenderer.invoke('agent:get-media-items', kind, limit, offset, query),
  getMediaItemRange: (
    kind = '',
    limit = 200,
    offset = 0,
    query: {
    search?: string
    fold_duplicates?: boolean
    fold_member_ids?: number[]
    asset_kind?: string
    category?: string
    folder_id?: number
    include_descendants?: boolean
    cameras?: string[]
    formats?: string[]
    captured_from?: string
    captured_to?: string
    has_location?: boolean
    favorite?: boolean
    tag?: string
    person?: string
    person_identity?: string
    place?: string
  } = {},
    requestID?: string,
  ) => ipcRenderer.invoke('agent:get-media-item-range', kind, limit, offset, query, requestID),
  getMediaFacets: (
    query: {
      search?: string
      fold_duplicates?: boolean
      fold_member_ids?: number[]
      asset_kind?: string
      category?: string
      cameras?: string[]
      formats?: string[]
      folder_id?: number
    include_descendants?: boolean
      captured_from?: string
      captured_to?: string
      has_location?: boolean
      favorite?: boolean
      tag?: string
      person?: string
      person_identity?: string
      place?: string
    } = {},
    albumID = '',
  ) => ipcRenderer.invoke('agent:get-media-facets', query, albumID),
  getMediaIndexStatus: () => ipcRenderer.invoke('agent:get-media-index-status'),
  getNodeLocation: (nodeID: number, requestID?: string) =>
    ipcRenderer.invoke('agent:get-node-location', nodeID, requestID),
  getMediaDuplicateOrganizePlan: (keeperNodeID: number, nodeIDs: number[]) =>
    ipcRenderer.invoke('agent:get-media-duplicate-organize-plan', keeperNodeID, nodeIDs),
  applyMediaDuplicateOrganize: (input: {
    keeper_node_id: number
    node_ids: number[]
    expected_plan_revision: string
    confirm: true
  }) => ipcRenderer.invoke('agent:apply-media-duplicate-organize', input),
  getMediaSyncFolders: () => ipcRenderer.invoke('agent:get-media-sync-folders'),
  getMediaSyncFolder: (sourceID: number, folderID: number) =>
    ipcRenderer.invoke('agent:get-media-sync-folder', sourceID, folderID),
  getMediaTrash: (limit = 200, offset = 0) =>
    ipcRenderer.invoke('agent:get-media-trash', limit, offset),
  getMediaAlbums: () => ipcRenderer.invoke('agent:get-media-albums'),
  getMediaAlbumFolders: () => ipcRenderer.invoke('agent:get-media-album-folders'),
  createMediaAlbumFolder: (name: string, parentID: number) =>
    ipcRenderer.invoke('agent:create-media-album-folder', name, parentID),
  updateMediaAlbumFolder: (
    folderID: number, revision: number, change: { name?: string; parent_id?: number },
  ) => ipcRenderer.invoke('agent:update-media-album-folder', folderID, revision, change),
  deleteMediaAlbumFolder: (folderID: number, revision: number) =>
    ipcRenderer.invoke('agent:delete-media-album-folder', folderID, revision),
  moveMediaAlbumToFolder: (albumID: string, revision: number, folderID: number) =>
    ipcRenderer.invoke('agent:move-media-album-to-folder', albumID, revision, folderID),
  getMediaPlaces: (limit = 24) => ipcRenderer.invoke('agent:get-media-places', limit),
  getMediaMemories: (anchorDate = '', limit = 24, timeZone = 'UTC') =>
    ipcRenderer.invoke('agent:get-media-memories', anchorDate, limit, timeZone),
  getMediaMemoryItemRange: (memoryID: string, limit = 200, offset = 0, timeZone = 'UTC') =>
    ipcRenderer.invoke('agent:get-media-memory-item-range', memoryID, limit, offset, timeZone),
  getMediaDuplicateGroups: (limit = 24, offset = 0) =>
    ipcRenderer.invoke('agent:get-media-duplicate-groups', limit, offset),
  getMediaDuplicateItemRange: (duplicateID: string, limit = 200, offset = 0) =>
    ipcRenderer.invoke('agent:get-media-duplicate-item-range', duplicateID, limit, offset),
  getMediaBurstReviews: (limit = 24, offset = 0) =>
    ipcRenderer.invoke('agent:get-media-burst-reviews', limit, offset),
  getMediaBurstReviewItemRange: (burstID: string, limit = 200, offset = 0) =>
    ipcRenderer.invoke('agent:get-media-burst-item-range', burstID, limit, offset),
  getMediaPets: () => ipcRenderer.invoke('agent:get-media-pets'),
  getMediaPetItemRange: (petKind: string, limit = 200, offset = 0) =>
    ipcRenderer.invoke('agent:get-media-pet-item-range', petKind, limit, offset),
  getMediaSuggestedPeople: (limit = 24) =>
    ipcRenderer.invoke('agent:get-media-suggested-people', limit),
  getMediaSuggestedPeopleWithReview: (includeReviewed = false, limit = 24) =>
    ipcRenderer.invoke(
      'agent:get-media-suggested-people-reviewed',
      includeReviewed,
      limit,
    ),
  getMediaSuggestedPersonItems: (
    personID: string,
    limit = 100,
    offset = 0,
    query: {
      search?: string
      fold_duplicates?: boolean
      fold_member_ids?: number[]
      asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
      captured_from?: string
      captured_to?: string
      has_location?: boolean
      favorite?: boolean
      tag?: string
      person?: string
      person_identity?: string
      place?: string
    } = {},
  ) => ipcRenderer.invoke(
    'agent:get-media-suggested-person-items',
    personID,
    limit,
    offset,
    query,
  ),
  getMediaSuggestedPersonItemRange: (
    personID: string,
    limit = 200,
    offset = 0,
    query: {
    search?: string
    fold_duplicates?: boolean
    fold_member_ids?: number[]
    asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
    captured_from?: string
    captured_to?: string
    has_location?: boolean
    favorite?: boolean
    tag?: string
    person?: string
    person_identity?: string
    place?: string
  } = {},
  ) => ipcRenderer.invoke(
    'agent:get-media-suggested-person-item-range',
    personID,
    limit,
    offset,
    query,
  ),
  getMediaPeople: (includeHidden = false, limit = 100, offset = 0) =>
    ipcRenderer.invoke('agent:get-media-people', includeHidden, limit, offset),
  getMediaPersonItems: (
    personID: string,
    limit = 100,
    offset = 0,
    query: {
      search?: string
      fold_duplicates?: boolean
      fold_member_ids?: number[]
      asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
      captured_from?: string
      captured_to?: string
      has_location?: boolean
      favorite?: boolean
      tag?: string
      person?: string
      person_identity?: string
      place?: string
    } = {},
  ) => ipcRenderer.invoke('agent:get-media-person-items', personID, limit, offset, query),
  getMediaPersonItemRange: (
    personID: string,
    limit = 200,
    offset = 0,
    query: {
    search?: string
    fold_duplicates?: boolean
    fold_member_ids?: number[]
    asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
    captured_from?: string
    captured_to?: string
    has_location?: boolean
    favorite?: boolean
    tag?: string
    person?: string
    person_identity?: string
    place?: string
  } = {},
  ) => ipcRenderer.invoke('agent:get-media-person-item-range', personID, limit, offset, query),
  reviewMediaSuggestedPerson: (
    suggestionID: string,
    state: 'pending' | 'dismissed',
  ) => ipcRenderer.invoke(
    'agent:review-media-suggested-person',
    suggestionID,
    state,
  ),
  addMediaSuggestedPersonToPerson: (
    suggestionID: string,
    personID: string,
    revision: number,
  ) => ipcRenderer.invoke(
    'agent:add-media-suggested-person-to-person',
    suggestionID,
    personID,
    revision,
  ),
  adoptMediaSuggestedPerson: (suggestionID: string, name = '') =>
    ipcRenderer.invoke('agent:adopt-media-suggested-person', suggestionID, name),
  updateMediaPerson: (
    personID: string,
    revision: number,
    input: { name?: string; hidden?: boolean; cover_node_id?: number },
  ) => ipcRenderer.invoke('agent:update-media-person', personID, revision, input),
  mergeMediaPeople: (targetID: string, revision: number, sourceIDs: string[]) =>
    ipcRenderer.invoke('agent:merge-media-people', targetID, revision, sourceIDs),
  splitMediaPerson: (
    personID: string,
    revision: number,
    nodeIDs: number[],
    name = '',
  ) => ipcRenderer.invoke('agent:split-media-person', personID, revision, nodeIDs, name),
  createMediaAlbum: (name: string) => ipcRenderer.invoke('agent:create-media-album', name),
  renameMediaAlbum: (albumID: string, revision: number, name: string) => ipcRenderer.invoke('agent:rename-media-album', albumID, revision, name),
  setMediaAlbumCover: (albumID: string, revision: number, nodeID: number) =>
    ipcRenderer.invoke('agent:set-media-album-cover', albumID, revision, nodeID),
  deleteMediaAlbum: (albumID: string, revision: number) => ipcRenderer.invoke('agent:delete-media-album', albumID, revision),
  createSmartMediaAlbum: (
    name: string,
    query: {
      search?: string
      fold_duplicates?: boolean
      fold_member_ids?: number[]
      asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
      captured_from?: string
      captured_to?: string
      has_location?: boolean
      favorite?: boolean
      tag?: string
      person?: string
      person_identity?: string
      place?: string
    },
  ) => ipcRenderer.invoke('agent:create-smart-media-album', name, query),
  updateSmartMediaAlbum: (
    albumID: string,
    revision: number,
    input: {
      name?: string
      query?: {
        search?: string
      fold_duplicates?: boolean
      fold_member_ids?: number[]
        asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
        captured_from?: string
        captured_to?: string
        has_location?: boolean
        favorite?: boolean
        tag?: string
        person?: string
        person_identity?: string
        place?: string
      }
    },
  ) => ipcRenderer.invoke('agent:update-smart-media-album', albumID, revision, input),
  deleteSmartMediaAlbum: (albumID: string, revision: number) =>
    ipcRenderer.invoke('agent:delete-smart-media-album', albumID, revision),
  addMediaAlbumItems: (albumID: string, revision: number, nodeIDs: number[]) => ipcRenderer.invoke('agent:add-media-album-items', albumID, revision, nodeIDs),
  removeMediaAlbumItem: (albumID: string, revision: number, nodeID: number) => ipcRenderer.invoke('agent:remove-media-album-item', albumID, revision, nodeID),
  getMediaAlbumItems: (
    albumID: string,
    limit = 100,
    offset = 0,
    query: {
    search?: string
    fold_duplicates?: boolean
    fold_member_ids?: number[]
    asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
    captured_from?: string
    captured_to?: string
    has_location?: boolean
    favorite?: boolean
    tag?: string
    person?: string
    person_identity?: string
    place?: string
  } = {},
  ) => ipcRenderer.invoke('agent:get-media-album-items', albumID, limit, offset, query),
  getMediaAlbumItemRange: (
    albumID: string,
    limit = 200,
    offset = 0,
    query: {
    search?: string
    fold_duplicates?: boolean
    fold_member_ids?: number[]
    asset_kind?: string
    category?: string
    cameras?: string[]
    formats?: string[]
    captured_from?: string
    captured_to?: string
    has_location?: boolean
    favorite?: boolean
    tag?: string
    person?: string
    person_identity?: string
    place?: string
  } = {},
  ) => ipcRenderer.invoke('agent:get-media-album-item-range', albumID, limit, offset, query),
  setMediaFavorite: (nodeID: number, favorite: boolean) => ipcRenderer.invoke('agent:set-media-favorite', nodeID, favorite),
  setMediaFavoriteBatch: (nodeIDs: number[], favorite: boolean) => ipcRenderer.invoke('agent:set-media-favorite-batch', nodeIDs, favorite),
  addMediaTagsBatch: (nodeIDs: number[], tags: string[]) => ipcRenderer.invoke('agent:add-media-tags-batch', nodeIDs, tags),
  setMediaTags: (nodeID: number, tags: string[]) => ipcRenderer.invoke('agent:set-media-tags', nodeID, tags),
  setMediaPeople: (nodeID: number, people: string[]) => ipcRenderer.invoke('agent:set-media-people', nodeID, people),
  setMediaDescription: (nodeID: number, description: string) => ipcRenderer.invoke('agent:set-media-description', nodeID, description),
  getMediaEditRecipe: (nodeID: number) => ipcRenderer.invoke('agent:get-media-edit', nodeID),
  saveMediaEditRecipe: (nodeID: number, input: unknown) =>
    ipcRenderer.invoke('agent:save-media-edit', nodeID, input),
  resetMediaEditRecipe: (nodeID: number, revision: number) =>
    ipcRenderer.invoke('agent:reset-media-edit', nodeID, revision),
  createMediaCreativeGeneration: (nodeID: number, input: unknown) =>
    ipcRenderer.invoke('agent:create-media-creative', nodeID, input),
  getMediaCreativeGeneration: (generationID: string) =>
    ipcRenderer.invoke('agent:get-media-creative', generationID),
  cancelMediaCreativeGeneration: (generationID: string) =>
    ipcRenderer.invoke('agent:cancel-media-creative', generationID),
  getMediaThumbnail: (nodeID: number, requestID?: string, revision?: number) =>
    ipcRenderer.invoke('agent:get-media-thumbnail', nodeID, requestID, revision),
  getMediaAnalysisPreview: (nodeID: number, requestID?: string) => ipcRenderer.invoke('agent:get-media-analysis-preview', nodeID, requestID),
  cancelViewportRequest: (requestID: string) => ipcRenderer.invoke('agent:cancel-viewport-request', requestID),
  getMediaLivePhotoStill: (nodeID: number) => ipcRenderer.invoke('agent:get-media-live-photo-still', nodeID),
  putMediaVideoPoster: (nodeID: number, revision: number, data: ArrayBuffer) => ipcRenderer.invoke('agent:put-media-video-poster', nodeID, revision, data),
  getMediaLivePhotoMotion: (
    nodeID: number,
    onProgress?: XDriveByteProgressCallback,
  ) => {
    const requestID = `motion-${Date.now()}-${++mediaLivePhotoMotionRequestSequence}`
    const channel = 'agent:media-live-photo-motion-progress'
    let resolvedURL = ''
    const listener: Parameters<typeof ipcRenderer.on>[1] = (_event, payload: unknown) => {
      if (!onProgress || !payload || typeof payload !== 'object') return
      const value = payload as {
        request_id?: unknown
        loaded_bytes?: unknown
        total_bytes?: unknown
      }
      if (
        value.request_id !== requestID ||
        typeof value.loaded_bytes !== 'number' ||
        !Number.isFinite(value.loaded_bytes)
      ) return
      const totalBytes = typeof value.total_bytes === 'number' && Number.isFinite(value.total_bytes)
        ? value.total_bytes
        : undefined
      onProgress(value.loaded_bytes, totalBytes)
      if (resolvedURL && totalBytes && value.loaded_bytes >= totalBytes) {
        cleanupMediaLivePhotoProgress(resolvedURL)
      }
    }
    if (onProgress) ipcRenderer.on(channel, listener)
    return ipcRenderer.invoke('agent:get-media-live-photo-motion', nodeID, requestID)
      .then((result: unknown) => {
        const value = result as { ok?: unknown; data?: unknown }
        if (!onProgress || value?.ok !== true || typeof value.data !== 'string') {
          if (onProgress) ipcRenderer.removeListener(channel, listener)
          return result
        }
        resolvedURL = value.data
        const timer = setTimeout(
          () => cleanupMediaLivePhotoProgress(resolvedURL),
          15 * 60 * 1000,
        )
        mediaLivePhotoProgressByURL.set(resolvedURL, { channel, listener, timer })
        return result
      }, (error: unknown) => {
        if (onProgress) ipcRenderer.removeListener(channel, listener)
        throw error
      })
  },
  releaseMediaLivePhotoMotion: (url: string) => {
    cleanupMediaLivePhotoProgress(url)
    return ipcRenderer.invoke('agent:release-media-live-photo-motion', url)
  },
  getSources: () => ipcRenderer.invoke('agent:get-sources'),
  getSourceRuns: (sourceID: number, limit = 1, offset = 0) => ipcRenderer.invoke('agent:get-source-runs', sourceID, limit, offset),
  getSourceRunFailures: (sourceID: number, runID: string, limit = 20, offset = 0) => ipcRenderer.invoke('agent:get-source-run-failures', sourceID, runID, limit, offset),
  cancelSourceRun: (sourceID: number, runID: string) => ipcRenderer.invoke('agent:cancel-source-run', sourceID, runID),
  getSourceItems: (sourceID: number, state = 'error', limit = 1000, offset = 0) => ipcRenderer.invoke('agent:get-source-items', sourceID, state, limit, offset),
  getSourceCollections: (sourceID: number, state = '') => ipcRenderer.invoke('agent:get-source-collections', sourceID, state),
  getSourceCollectionItems: (sourceID: number, collectionID: number, limit = 100, offset = 0) => ipcRenderer.invoke('agent:get-source-collection-items', sourceID, collectionID, limit, offset),
  getSourceCredential: (sourceID: number) => ipcRenderer.invoke('agent:get-source-credential', sourceID),
  revealSourceCredential: (sourceID: number) => ipcRenderer.invoke('agent:reveal-source-credential', sourceID),
  testSourceCredential: (kind: string, credential: string | Record<string, string>) => ipcRenderer.invoke('agent:test-source-credential', kind, credential),
  testStoredSourceCredential: (sourceID: number) => ipcRenderer.invoke('agent:test-stored-source-credential', sourceID),
  setSourceCredential: (sourceID: number, credential: string | Record<string, string>) => ipcRenderer.invoke('agent:set-source-credential', sourceID, credential),
  deleteSourceCredential: (sourceID: number) => ipcRenderer.invoke('agent:delete-source-credential', sourceID),
  getSourceConnectorConfig: (sourceID: number) => ipcRenderer.invoke('agent:get-source-connector-config', sourceID),
  browseSourceDirectories: (sourceID: number, path = '', limit = 200, offset = 0) => ipcRenderer.invoke('agent:browse-source-directories', sourceID, path, limit, offset),
  setSourceConnectorConfig: (sourceID: number, revision: number, payload: Record<string, unknown>) => ipcRenderer.invoke('agent:set-source-connector-config', sourceID, revision, payload),
  createSource: (input: {
    name: string
    kind: string
    direction: 'push' | 'pull'
    sync_mode: 'backup'
    run_mode: 'scan' | 'sync'
    schedule_type?: 'interval' | 'cron' | 'manual'
    schedule_expression?: string
    schedule_timezone?: string
    target_node_id: number
    ignore_rules?: string
  }) => ipcRenderer.invoke('agent:create-source', input),
  updateSource: (sourceID: number, revision: number, input: {
    name?: string
    run_mode?: 'scan' | 'sync'
    status?: 'active' | 'paused'
    schedule_type?: 'interval' | 'cron' | 'manual'
    schedule_expression?: string
    schedule_timezone?: string
    target_node_id?: number
    ignore_rules?: string
  }) => ipcRenderer.invoke('agent:update-source', sourceID, revision, input),
  deleteSource: (sourceID: number, revision: number) => ipcRenderer.invoke('agent:delete-source', sourceID, revision),
  triggerSource: (sourceID: number) => ipcRenderer.invoke('agent:trigger-source', sourceID),
  cloudRoot: () => ipcRenderer.invoke('agent:cloud-root'),
  cloudChildren: (parentID: number) => ipcRenderer.invoke('agent:cloud-children', parentID),
  cloudChildrenPage: (
    parentID: number,
    options: { limit?: number; cursor?: string; sort?: 'name' | 'updated' | 'size' | 'type'; order?: 'asc' | 'desc'; name?: string; nameInsensitive?: string } = {},
  ) => ipcRenderer.invoke('agent:cloud-children-page', parentID, options),
  cloudChildrenRange: (
    parentID: number,
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    includeCount = true,
    grouping: Record<string, unknown> = {},
    requestID?: string,
  ) => ipcRenderer.invoke(
    'agent:cloud-children-range',
    parentID,
    offset,
    limit,
    sort,
    order,
    includeCount,
    grouping,
    requestID,
  ),
  cloudChanges: (after = 0, limit = 200) =>
    ipcRenderer.invoke('agent:cloud-changes', after, limit),
  cloudFileQuickAccess: () => ipcRenderer.invoke('agent:cloud-quick-access'),
  cloudPinFileQuickAccess: (nodeID: number) => ipcRenderer.invoke('agent:cloud-quick-access-pin', nodeID),
  cloudUnpinFileQuickAccess: (nodeID: number) => ipcRenderer.invoke('agent:cloud-quick-access-unpin', nodeID),
  cloudReorderFileQuickAccess: (nodeIDs: number[]) => ipcRenderer.invoke('agent:cloud-quick-access-reorder', nodeIDs),
  cloudFileTags: () => ipcRenderer.invoke('agent:cloud-tags'),
  cloudCreateFileTag: (name: string, color: string) => ipcRenderer.invoke('agent:cloud-tag-create', name, color),
  cloudUpdateFileTag: (id: number, input: { name?: string; color?: string }) => ipcRenderer.invoke('agent:cloud-tag-update', id, input),
  cloudDeleteFileTag: (id: number) => ipcRenderer.invoke('agent:cloud-tag-delete', id),
  cloudQueryFileNodeTags: (nodeIDs: number[]) => ipcRenderer.invoke('agent:cloud-tags-query', nodeIDs),
  cloudSetFileTagNodes: (tagID: number, nodeIDs: number[], assigned: boolean) => ipcRenderer.invoke('agent:cloud-tag-nodes', tagID, nodeIDs, assigned),
  cloudFileSavedSearches: () => ipcRenderer.invoke('agent:cloud-saved-searches'),
  cloudCreateFileSavedSearch: (input: Record<string, unknown>) => ipcRenderer.invoke('agent:cloud-saved-search-create', input),
  cloudUpdateFileSavedSearch: (id: number, input: Record<string, unknown>) => ipcRenderer.invoke('agent:cloud-saved-search-update', id, input),
  cloudDeleteFileSavedSearch: (id: number) => ipcRenderer.invoke('agent:cloud-saved-search-delete', id),
  cloudReorderFileSavedSearches: (ids: number[]) => ipcRenderer.invoke('agent:cloud-saved-search-reorder', ids),
  cloudFileFavorites: () => ipcRenderer.invoke('agent:cloud-favorites'),
  cloudFavoriteFile: (nodeID: number) => ipcRenderer.invoke('agent:cloud-favorite', nodeID),
  cloudUnfavoriteFile: (nodeID: number) => ipcRenderer.invoke('agent:cloud-unfavorite', nodeID),
  cloudFileRecent: (limit = 16) => ipcRenderer.invoke('agent:cloud-recent', limit),
  cloudTouchFileRecent: (nodeID: number) => ipcRenderer.invoke('agent:cloud-recent-touch', nodeID),
  cloudClearFileRecent: () => ipcRenderer.invoke('agent:cloud-recent-clear'),
  cloudCreateDirectory: (parentID: number, name: string) => ipcRenderer.invoke('agent:cloud-create-directory', parentID, name),
  cloudRename: (id: number, revision: number, name: string) => ipcRenderer.invoke('agent:cloud-rename', id, revision, name),
  cloudCopy: (id: number, parentID: number) => ipcRenderer.invoke('agent:cloud-copy', id, parentID),
  cloudMove: (id: number, revision: number, parentID: number) => ipcRenderer.invoke('agent:cloud-move', id, revision, parentID),
  cloudDelete: (id: number, revision: number) => ipcRenderer.invoke('agent:cloud-delete', id, revision),
  cloudBatchCopy: (items: Array<{ id: number; revision: number }>, parentID: number) => ipcRenderer.invoke('agent:cloud-batch-copy', items, parentID),
  cloudBatchMove: (items: Array<{ id: number; revision: number }>, parentID: number) => ipcRenderer.invoke('agent:cloud-batch-move', items, parentID),
  cloudBatchDelete: (items: Array<{ id: number; revision: number }>) => ipcRenderer.invoke('agent:cloud-batch-delete', items),
  cloudFilePropertiesStats: (
    items: Array<{ id: number; revision: number }>,
    requestID: string,
  ) => ipcRenderer.invoke('agent:cloud-file-properties-stats', items, requestID),
  cloudCancelFilePropertiesStats: (requestID: string) =>
    ipcRenderer.invoke('agent:cloud-file-properties-stats-cancel', requestID),
  cloudFileMediaDetails: (items: Array<{ id: number; revision: number }>) =>
    ipcRenderer.invoke('agent:cloud-file-media-details', items),
  cloudCreateFileOperation: (type: 'copy' | 'move' | 'delete', items: Array<{ id: number; revision: number }>, parentID?: number) => ipcRenderer.invoke('agent:cloud-file-operation-create', type, items, parentID),
  cloudBackgroundTaskActiveSummary: () =>
    ipcRenderer.invoke('agent:cloud-background-task-summary'),
  cloudBackgroundTaskPage: (global = false, limit = 50, cursor = '') =>
    ipcRenderer.invoke('agent:cloud-background-task-page', global, limit, cursor),
  cloudBackgroundTasks: (global = false, limit = 100) => ipcRenderer.invoke('agent:cloud-background-tasks', global, limit),
  cloudBackgroundTaskControl: (id: string, action: string, global = false) =>
    ipcRenderer.invoke('agent:cloud-background-task-control', id, action, global),
  cloudFileOperations: (limit = 100) => ipcRenderer.invoke('agent:cloud-file-operations', limit),
  cloudClearFileOperationHistory: () => ipcRenderer.invoke('agent:cloud-file-operations-clear'),
  cloudFileOperation: (id: string) => ipcRenderer.invoke('agent:cloud-file-operation', id),
  cloudCancelFileOperation: (id: string) => ipcRenderer.invoke('agent:cloud-file-operation-cancel', id),
  cloudRetryFileOperation: (id: string) => ipcRenderer.invoke('agent:cloud-file-operation-retry', id),
  cloudUndoFileOperation: (id: string) => ipcRenderer.invoke('agent:cloud-file-operation-undo', id),
  cloudRedoFileOperation: (id: string) => ipcRenderer.invoke('agent:cloud-file-operation-redo', id),
  cloudResolveFileOperationConflict: (id: string, policy: 'skip' | 'keep_both' | 'replace') =>
    ipcRenderer.invoke('agent:cloud-file-operation-resolve', id, policy),
  cloudUploadPreflight: (parentID: number, name: string) =>
    ipcRenderer.invoke('agent:cloud-upload-preflight', parentID, name),
  cloudUploadPreflightBatch: (items: Array<{ parent_id: number; name: string }>) =>
    ipcRenderer.invoke('agent:cloud-upload-preflight-batch', items),
  cloudUploadFile: (
    parentID: number,
    file: unknown,
    conflictPolicy: 'fail' | 'skip' | 'keep_both' | 'overwrite',
    transferID = '',
  ) => ipcRenderer.invoke(
    'agent:cloud-upload-file',
    parentID,
    webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
    (file as { name?: string }).name || '',
    conflictPolicy,
    transferID,
  ),
  cloudUploadFiles: (parentID: number) => ipcRenderer.invoke('agent:cloud-upload-files', parentID),
  cloudUploadDroppedFiles: (parentID: number, files: unknown[]) => ipcRenderer.invoke(
    'agent:cloud-upload-paths',
    parentID,
    files.map((file) => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])),
  ),
  cloudTextPreview: (id: number) => ipcRenderer.invoke('agent:cloud-text-preview', id),
  cloudFilePreviewURL: (id: number) => ipcRenderer.invoke('agent:cloud-file-preview-url', id),
  cloudDownload: (id: number, name: string) => ipcRenderer.invoke('agent:cloud-download', id, name),
  cloudDownloadFolder: (id: number, parentID: number) => ipcRenderer.invoke('agent:cloud-download-folder', id, parentID),
  cloudDownloadFiles: (files: Array<{ id: number; name: string }>) => ipcRenderer.invoke('agent:cloud-download-files', files),
  cloudDownloadArchive: (ids: number[]) => ipcRenderer.invoke('agent:cloud-download-archive', ids),
  openPath: (relativePath: string, reveal = false) => ipcRenderer.invoke('agent:open-path', relativePath, reveal),
  openWith: (relativePath: string) => ipcRenderer.invoke('agent:open-with', relativePath),
  cloudSearch: (
    query: string,
    cursor = '',
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    filters: Record<string, unknown> = {},
  ) => ipcRenderer.invoke('agent:cloud-search', query, cursor, sort, order, filters),
  cloudSearchRange: (
    query: string,
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    filters: Record<string, unknown> = {},
    grouping: Record<string, unknown> = {},
  ) => ipcRenderer.invoke(
    'agent:cloud-search-range',
    query,
    offset,
    limit,
    sort,
    order,
    filters,
    grouping,
  ),
  cloudQuota: () => ipcRenderer.invoke('agent:cloud-quota'),
  getServerUpdate: () => ipcRenderer.invoke('agent:get-server-update'),
  startServerUpdate: (source: 'github' | 'gitlab', channel: 'stable' | 'master', backupFileData: boolean) =>
    ipcRenderer.invoke('agent:start-server-update', source, channel, backupFileData),
  cloudStorageStats: () => ipcRenderer.invoke('agent:cloud-storage-stats'),
  cloudCleanupStorageCache: (kind: 'media_thumbnail' | 'analysis_preview' | 'upload_staging' | 'storage_temp' | 'all') =>
    ipcRenderer.invoke('agent:cloud-storage-cache-cleanup', kind),
  cloudTrash: () => ipcRenderer.invoke('agent:cloud-trash'),
  cloudTrashRange: (
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    includeCount = true,
  ) => ipcRenderer.invoke('agent:cloud-trash-range', offset, limit, sort, order, includeCount),
  cloudRestoreTrash: (id: number, revision: number) => ipcRenderer.invoke('agent:cloud-restore-trash', id, revision),
  cloudDeleteTrash: (id: number, revision: number) => ipcRenderer.invoke('agent:cloud-delete-trash', id, revision),
  cloudVersions: (nodeID: number) => ipcRenderer.invoke('agent:cloud-versions', nodeID),
  cloudRestoreVersion: (nodeID: number, revision: number, versionID: number) =>
    ipcRenderer.invoke('agent:cloud-restore-version', nodeID, revision, versionID),
  cloudShares: (nodeID: number) => ipcRenderer.invoke('agent:cloud-shares', nodeID),
  cloudCreateShare: (nodeID: number, input: { expires_at?: string; password?: string; max_downloads?: number }) =>
    ipcRenderer.invoke('agent:cloud-create-share', nodeID, input),
  cloudRevokeShare: (id: number) => ipcRenderer.invoke('agent:cloud-revoke-share', id),
  getDiagnostics: () => ipcRenderer.invoke('agent:get-diagnostics'),
  reconnect: () => ipcRenderer.invoke('agent:reconnect'),
  repairSyncRoot: () => ipcRenderer.invoke('agent:repair-sync-root'),
  openLogs: () => ipcRenderer.invoke('agent:open-logs'),
  exportDiagnostics: () => ipcRenderer.invoke('agent:export-diagnostics'),
  retry: () => ipcRenderer.invoke('agent:retry'),
  restart: () => ipcRenderer.invoke('agent:restart'),
  login: (input: {
    server: string
    username: string
    password: string
    mount_path?: string
    remember_password?: boolean
    auto_login?: boolean
    use_saved_password?: boolean
  }) => ipcRenderer.invoke('agent:login', input),
  logout: () => ipcRenderer.invoke('agent:logout'),
  changePassword: (input: { current_password: string; new_password: string }) => ipcRenderer.invoke('agent:change-password', input),
  setPaused: (paused: boolean) => ipcRenderer.invoke('agent:set-paused', paused),
  syncNow: () => ipcRenderer.invoke('agent:sync-now'),
  getSettings: () => ipcRenderer.invoke('agent:get-settings'),
  updateSettings: (input: { mount_path?: string; cache_limit_bytes?: number }) => ipcRenderer.invoke('agent:update-settings', input),
  getUpdate: () => ipcRenderer.invoke('agent:get-update'),
  setUpdateMode: (mode: 'manual' | 'check' | 'download' | 'install') => ipcRenderer.invoke('agent:set-update-mode', mode),
  setUpdateSource: (source: 'github' | 'gitlab') => ipcRenderer.invoke('agent:set-update-source', source),
  checkUpdate: () => ipcRenderer.invoke('agent:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('agent:download-update'),
  installUpdate: () => ipcRenderer.invoke('agent:install-update'),
  cancelUpdate: () => ipcRenderer.invoke('agent:cancel-update'),
  setSyncRule: (path: string, mode: 'exclude' | 'always-local' | 'default') => ipcRenderer.invoke('agent:set-sync-rule', path, mode),
  getFileAvailability: (path: string) => ipcRenderer.invoke('agent:get-file-availability', path),
  getFileAvailabilityBatch: (paths: string[]) => ipcRenderer.invoke('agent:get-file-availability-batch', paths),
  setFileAvailability: (path: string, action: 'keep' | 'release' | 'online' | 'sync') =>
    ipcRenderer.invoke('agent:set-file-availability', path, action),
  getConflicts: () => ipcRenderer.invoke('agent:get-conflicts'),
  openConflict: (id: string, both = false) => ipcRenderer.invoke('agent:open-conflict', id, both),
  resolveConflict: (id: string, choice: 'server' | 'local') => ipcRenderer.invoke('agent:resolve-conflict', id, choice),
  retryTransfer: (id: string) => ipcRenderer.invoke('agent:retry-transfer', id),
  transferLifecycle: (input: unknown) => ipcRenderer.invoke('agent:transfer-lifecycle', input),
  clearTransferHistory: (scope?: 'all' | 'network' | 'local') => ipcRenderer.invoke('agent:clear-transfer-history', scope),
  openFolder: () => ipcRenderer.invoke('agent:open-folder'),
  onState: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('agent:state', handler)
    return () => ipcRenderer.removeListener('agent:state', handler)
  },
  onTransfers: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('agent:transfers', handler)
    return () => ipcRenderer.removeListener('agent:transfers', handler)
  },
})

contextBridge.exposeInMainWorld('xdriveDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  getStartup: () => ipcRenderer.invoke('desktop:get-startup'),
  getPreferences: () => ipcRenderer.invoke('desktop:get-preferences'),
  getLoginHistory: () => ipcRenderer.invoke('desktop:get-login-history'),
  getBrowserCache: () => ipcRenderer.invoke('desktop:get-browser-cache'),
  clearBrowserCache: () => ipcRenderer.invoke('desktop:clear-browser-cache'),
  onLoginHistory: (callback: (history: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, history: unknown) => callback(history)
    ipcRenderer.on('desktop:login-history', handler)
    return () => ipcRenderer.removeListener('desktop:login-history', handler)
  },
  probeServer: (server: string) => ipcRenderer.invoke('desktop:probe-server', server),
  clearSavedPassword: (server: string, username: string) => ipcRenderer.invoke('desktop:clear-saved-password', server, username),
  getWindowState: () => ipcRenderer.invoke('desktop:get-window-state'),
  minimizeWindow: () => ipcRenderer.send('desktop:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('desktop:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.send('desktop:window-close'),
  onWindowState: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('desktop:window-state', handler)
    return () => ipcRenderer.removeListener('desktop:window-state', handler)
  },
  setStartup: (enabled: boolean) => ipcRenderer.invoke('desktop:set-startup', enabled),
  setCloseToTray: (enabled: boolean) => ipcRenderer.invoke('desktop:set-close-to-tray', enabled),
  setAppearance: (appearance: 'system' | 'light' | 'dark') => ipcRenderer.invoke('desktop:set-appearance', appearance),
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('desktop:select-directory', defaultPath),
  openExternal: (url: string) => ipcRenderer.invoke('desktop:open-external', url),
  startNativeDragOut: (relativePath: string) =>
    ipcRenderer.send('desktop:start-native-drag-out', relativePath),
  copyText: (text: string) => clipboard.writeText(text),
  hide: () => ipcRenderer.send('desktop:hide'),
  quit: () => ipcRenderer.send('desktop:quit'),
  onNavigate: (callback: (view: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, view: string) => callback(view)
    ipcRenderer.on('desktop:navigate', handler)
    return () => ipcRenderer.removeListener('desktop:navigate', handler)
  },
  agent,
}))
