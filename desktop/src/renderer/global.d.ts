import type {
  CreateExternalSourceInput,
  CreatedFileShare,
  ExternalSource,
  ExternalSourceCredentialStatus,
  ExternalSourceCredentialReveal,
  ExternalSourceCredentialTestResult,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceConnectorConfig,
  ExternalSourceBrowsePage,
  ExternalSourceItem,
  ExternalSourceRun,
  ExternalSourceRunFailure,
  FileShare,
  FileVersion,
  MediaAlbum,
  MediaGalleryQuery,
  MediaItem,
  MediaItemRange,
  MediaMemory,
  MediaDuplicateGroupList,
  MediaBurstReviewList,
  MediaEditRecipe,
  MediaEditRecipeInput,
  MediaPetFacet,
  MediaPersonSuggestionReview,
  MediaPersonIdentity,
  MediaPersonSplit,
  MediaPlaceFacet,
  MediaSuggestedPerson,
  UpdateMediaPersonIdentityInput,
  Node,
  QuotaUsage,
  StorageStats,
  StorageCacheCleanup,
  StorageCacheCleanupKind,
  BuildInfo,
  UpdateExternalSourceInput,
  XDriveCloudFilesCrumb,
  XDriveCloudFilesChangePage,
  XDriveCloudFilesPage,
  XDriveCloudFilesPageOptions,
  XDriveCloudFilesRange,
  XDriveCloudFilesSearchPage,
  XDriveCloudFilesSearchRange,
  XDriveCloudFilesSearchResult,
  XDriveBackgroundTask,
  XDriveBackgroundTaskPage,
  XDriveByteProgressHandler,
  XDriveBackgroundTaskActiveSummary,
  XDriveBackgroundTaskControlResult,
  XDriveFileOperation,
  XDriveFileExplorerPropertiesStats,
  XDriveFileExplorerMediaDetails,
  XDriveFileExplorerSearchFilters,
  XDriveFileExplorerGrouping,
  XDriveFileQuickAccessItem,
  XDriveFileFavoriteItem,
  XDriveFileRecentItem,
  XDriveFileTextPreview,
  XDriveTransferTask,
  XDriveUploadConflictPreflight,
} from '@xdrive/shared'

export {}

declare global {
  type DesktopInfo = BuildInfo & { platform: string; arch: string }
  type DesktopStartup = { start_at_login: boolean }
  type DesktopPreferences = { appearance: 'system' | 'light' | 'dark'; start_at_login: boolean; close_to_tray: boolean }
  type DesktopLoginProfile = {
    server: string
    username: string
    mount_path?: string
    last_used_at: string
    remember_password: boolean
    auto_login: boolean
    password_available: boolean
  }
  type DesktopLoginHistory = { profiles: DesktopLoginProfile[]; secure_password_storage: boolean; auto_login_error?: string }
  type DesktopWindowState = { maximized: boolean; minimized: boolean; fullscreen: boolean }
  type DesktopViewTarget = 'overview' | 'cloud' | 'sources' | 'transfers' | 'files' | 'conflicts' | 'diagnostics' | 'settings' | 'settings-update'

  type AgentHello = {
    discovery_version: number
    protocol_min: number
    protocol_max: number
    agent_version: string
    pid: number
    platform: string
    arch: string
    capabilities: string[]
  }

  type AgentStatus = {
    revision: number
    configured: boolean
    username?: string
    role?: 'user' | 'admin' | string
    server?: string
    mount_path?: string
    auth_status: string
    sync_status: string
    paused: boolean
    must_change_password: boolean
    last_error?: string
    has_conflict: boolean
    conflict_count: number
    version: string
    server_build?: BuildInfo
  }

  type AgentConnectionState = {
    connected: boolean
    hello?: AgentHello
    status?: AgentStatus
    error?: string
  }

  type AgentSettings = {
    mount_path: string
    cache_limit_bytes: number
    sync_rules: Array<{ path: string; mode: string }>
  }

  type AgentUpdateMode = 'manual' | 'check' | 'download' | 'install'
  type AgentUpdateSource = 'github' | 'gitlab'

  type AgentServerUpdateState = {
    supported: boolean
    state: 'unavailable' | 'idle' | 'queued' | 'running' | 'success' | 'failed'
    source: 'github' | 'gitlab'
    channel: 'stable' | 'master'
    request_id?: string
    stage?: string
    stage_current?: number
    stage_total?: number
    bytes_done?: number
    bytes_total?: number
    message?: string
    error?: string
    started_at?: string
    updated_at?: string
    finished_at?: string
    runner_heartbeat_at?: string
  }

  type AgentUpdateState = {
    mode: AgentUpdateMode
    source: AgentUpdateSource
    status: 'idle' | 'checking' | 'available' | 'up_to_date' | 'downloading' | 'downloaded' | 'installing' | 'error' | string
    current_version: string
    latest_version?: string
    release_name?: string
    published_at?: string
    release_notes?: string
    release_url?: string
    channel?: string
    update_available: boolean
    downloaded: boolean
    install_supported: boolean
    last_checked_at?: string
    message?: string
    last_error?: string
    bytes_done?: number
    bytes_total?: number
    bytes_per_second?: number
  }

  type AgentFileAvailability = {
    Path: string
    Mode: string
    Placeholder: boolean
    Pinned: boolean
    OnlineOnly: boolean
    Mixed: boolean
    AvailableOffline: boolean
    InSync: boolean
    Syncing: boolean
  }

  type AgentFileAvailabilityBatchItem = {
    path: string
    availability?: AgentFileAvailability
    error?: string
  }

  type AgentFileAvailabilityBatch = {
    items: AgentFileAvailabilityBatchItem[]
  }

  type AgentTransfer = XDriveTransferTask

  type AgentTransfers = {
    revision: number
    transfers: AgentTransfer[]
  }

  type AgentTransferLifecycleInput = {
    action: 'start_group' | 'start_child' | 'begin' | 'progress' | 'update_group' | 'finish'
    id?: string
    parent_id?: string
    file_name?: string
    path?: string
    relative_path?: string
    kind?: string
    direction?: string
    bytes_done?: number
    bytes_total?: number
    items_total?: number
    items_completed?: number
    items_failed?: number
    items_running?: number
    items_queued?: number
    scan_complete?: boolean
    state?: 'completed' | 'partial' | 'failed' | 'cancelled'
    error?: string
    skipped?: boolean
  }

  type AgentStorageTreeNode = {
    path: string
    name: string
    mode: 'default' | 'exclude' | 'always-local'
    effective_mode: 'default' | 'exclude' | 'always-local'
    file_count: number
    total_bytes: number
    children?: AgentStorageTreeNode[]
  }

  type AgentCacheStats = {
    supported: boolean
    reason?: string
    used_bytes: number
    limit_bytes: number
    reclaimable_bytes: number
    pinned_bytes: number
    cached_files: number
    reclaimable_files: number
    pinned_files: number
  }

  type AgentCacheReleaseResult = {
    stats: AgentCacheStats
    released_bytes: number
    released_files: number
    failed_files: number
  }

  type AgentLocalDiskSpace = {
    supported: boolean
    reason?: string
    free_bytes: number
    total_bytes: number
    status: 'PASS' | 'WARN' | 'FAIL' | string
  }

  type AgentSource = ExternalSource
  type AgentCreateSourceInput = CreateExternalSourceInput
  type AgentUpdateSourceInput = UpdateExternalSourceInput
  type AgentSourceRun = ExternalSourceRun
  type AgentSourceRunFailure = ExternalSourceRunFailure
  type AgentSourceItem = ExternalSourceItem
  type AgentSourceCollection = ExternalSourceCollection
  type AgentSourceCollectionItem = ExternalSourceCollectionItem
  type AgentSourceCredentialStatus = ExternalSourceCredentialStatus
  type AgentSourceCredentialReveal = ExternalSourceCredentialReveal
  type AgentSourceCredentialTestResult = ExternalSourceCredentialTestResult
  type AgentSourceConnectorConfig = ExternalSourceConnectorConfig

  type AgentMediaItem = MediaItem
  type AgentMediaItemRange = MediaItemRange
  type AgentMediaAlbum = MediaAlbum
  type AgentMediaMemory = MediaMemory
  type AgentMediaDuplicateGroupList = MediaDuplicateGroupList
  type AgentMediaBurstReviewList = MediaBurstReviewList
  type AgentMediaPeople = { people: string[] }
  type AgentMediaDescription = { description: string }
  type AgentMediaThumbnail = { content_type: string; data: ArrayBuffer }

  type AgentCloudBatchNodeRef = { id: number; revision: number }
  type AgentCloudBatchResult = {
    operation_id: string
    items?: AgentCloudNode[]
    deleted_ids?: number[]
  }
  type AgentBackgroundTask = XDriveBackgroundTask
  type AgentBackgroundTaskPage = XDriveBackgroundTaskPage
  type AgentBackgroundTaskActiveSummary = XDriveBackgroundTaskActiveSummary
  type AgentBackgroundTaskControlResult = XDriveBackgroundTaskControlResult
  type AgentCloudFileOperation = XDriveFileOperation
  type AgentCloudFileTextPreview = XDriveFileTextPreview
  type AgentCloudNode = Node
  type AgentCloudChildrenPage = XDriveCloudFilesPage<AgentCloudNode>
  type AgentCloudChildrenRange = XDriveCloudFilesRange<AgentCloudNode>
  type AgentCloudTrashRange = XDriveCloudFilesRange<AgentCloudNode>
  type AgentCloudNodeChangePage = XDriveCloudFilesChangePage<AgentCloudNode>
  type AgentCloudQuickAccessItem = XDriveFileQuickAccessItem<AgentCloudNode>
  type AgentCloudFavoriteItem = XDriveFileFavoriteItem<AgentCloudNode>
  type AgentCloudRecentItem = XDriveFileRecentItem<AgentCloudNode>
  type AgentCloudQuota = QuotaUsage
  type AgentCloudStorageStats = StorageStats
  type AgentStorageCacheCleanup = StorageCacheCleanup
  type AgentStorageCacheCleanupKind = StorageCacheCleanupKind
  type AgentCloudVersion = FileVersion
  type AgentCloudShare = FileShare
  type AgentCreatedCloudShare = {
    share: CreatedFileShare
    url: string
  }
  type AgentCloudCrumb = XDriveCloudFilesCrumb
  type AgentCloudSearchResult = XDriveCloudFilesSearchResult<AgentCloudNode>
  type AgentCloudSearchPage = XDriveCloudFilesSearchPage<AgentCloudNode>
  type AgentCloudSearchRange = XDriveCloudFilesSearchRange<AgentCloudNode>
  type AgentCloudUploadResult = {
    node: AgentCloudNode
    skipped: boolean
    transferred_bytes: number
  }
  type AgentCloudUploadBatchResult = {
    canceled: boolean
    uploaded: AgentCloudNode[]
    failures: Array<{ name: string; message: string }>
  }
  type AgentCloudDownloadBatchResult = {
    canceled: boolean
    downloaded: string[]
    failures: Array<{ name: string; message: string }>
  }
  type AgentCloudArchiveDownloadResult = {
    canceled: boolean
    downloaded: string[]
  }
  type AgentCloudFolderDownloadResult = {
    canceled: boolean
    root: string
    downloaded: number
    failed: number
  }

  type AgentDiagnosticCheck = {
    name: string
    status: 'PASS' | 'WARN' | 'FAIL'
    detail: string
  }

  type AgentDiagnosticReport = {
    generated_at: string
    platform: string
    arch: string
    checks: AgentDiagnosticCheck[]
    summary: { pass: number; warn: number; fail: number }
  }

  type AgentConflict = {
    id: string
    server?: string
    username?: string
    original_path: string
    conflict_path: string
    original_node_id?: number
    conflict_node_id?: number
    created_at: string
  }

  type DesktopError = {
    code: string
    message: string
    status?: number
    detail?: string
  }

  type DesktopResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: DesktopError }

  interface Window {
    xdriveDesktop: {
      getInfo: () => Promise<DesktopInfo>
      getStartup: () => Promise<DesktopStartup>
      getPreferences: () => Promise<DesktopPreferences>
      getLoginHistory: () => Promise<DesktopLoginHistory>
      onLoginHistory: (callback: (history: DesktopLoginHistory) => void) => () => void
      probeServer: (server: string) => Promise<DesktopResult<{ version?: string }>>
      clearSavedPassword: (server: string, username: string) => Promise<DesktopResult<DesktopLoginHistory>>
      getWindowState: () => Promise<DesktopWindowState>
      minimizeWindow: () => void
      toggleMaximizeWindow: () => void
      closeWindow: () => void
      onWindowState: (callback: (state: DesktopWindowState) => void) => () => void
      setStartup: (enabled: boolean) => Promise<DesktopResult<DesktopStartup>>
      setCloseToTray: (enabled: boolean) => Promise<DesktopResult<DesktopPreferences>>
      setAppearance: (appearance: 'system' | 'light' | 'dark') => Promise<DesktopResult<DesktopPreferences>>
      selectDirectory: (defaultPath?: string) => Promise<string | null>
      openExternal: (url: string) => Promise<DesktopResult<{ opened: boolean }>>
      startNativeDragOut: (relativePath: string) => void
      copyText: (text: string) => void
      hide: () => void
      quit: () => void
      onNavigate: (callback: (view: DesktopViewTarget) => void) => () => void
      agent: {
        getState: () => Promise<AgentConnectionState>
        getTransfers: () => Promise<AgentTransfers>
        getStorageTree: () => Promise<DesktopResult<AgentStorageTreeNode>>
        getCache: () => Promise<DesktopResult<AgentCacheStats>>
        getLocalDiskSpace: () => Promise<DesktopResult<AgentLocalDiskSpace>>
        releaseCache: () => Promise<DesktopResult<AgentCacheReleaseResult>>
        getMediaItems: (
          kind?: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItem[]>>
        getMediaItemRange: (
          kind?: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        getMediaTrash: (
          limit?: number,
          offset?: number,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        getMediaAlbums: () => Promise<DesktopResult<AgentMediaAlbum[]>>
        getMediaPlaces: (limit?: number) => Promise<DesktopResult<MediaPlaceFacet[]>>
        getMediaMemories: (
          anchorDate?: string,
          limit?: number,
        ) => Promise<DesktopResult<MediaMemory[]>>
        getMediaMemoryItemRange: (
          memoryID: string,
          limit?: number,
          offset?: number,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        getMediaDuplicateGroups: (
          limit?: number,
        ) => Promise<DesktopResult<MediaDuplicateGroupList>>
        getMediaDuplicateItemRange: (
          duplicateID: string,
          limit?: number,
          offset?: number,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        getMediaBurstReviews: (
          limit?: number,
        ) => Promise<DesktopResult<MediaBurstReviewList>>
        getMediaBurstReviewItemRange: (
          burstID: string,
          limit?: number,
          offset?: number,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        getMediaPets: () => Promise<DesktopResult<MediaPetFacet[]>>
        getMediaPetItemRange: (
          petKind: string,
          limit?: number,
          offset?: number,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        getMediaSuggestedPeople: (limit?: number) => Promise<DesktopResult<MediaSuggestedPerson[]>>
        getMediaSuggestedPeopleWithReview: (
          includeReviewed?: boolean,
          limit?: number,
        ) => Promise<DesktopResult<MediaSuggestedPerson[]>>
        getMediaSuggestedPersonItems: (
          personID: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItem[]>>
        getMediaSuggestedPersonItemRange: (
          personID: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        getMediaPeople: (
          includeHidden?: boolean,
          limit?: number,
          offset?: number,
        ) => Promise<DesktopResult<MediaPersonIdentity[]>>
        getMediaPersonItems: (
          personID: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItem[]>>
        getMediaPersonItemRange: (
          personID: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        reviewMediaSuggestedPerson: (
          suggestionID: string,
          state: 'pending' | 'dismissed',
        ) => Promise<DesktopResult<MediaPersonSuggestionReview>>
        addMediaSuggestedPersonToPerson: (
          suggestionID: string,
          personID: string,
          revision: number,
        ) => Promise<DesktopResult<MediaPersonIdentity>>
        adoptMediaSuggestedPerson: (
          suggestionID: string,
          name?: string,
        ) => Promise<DesktopResult<MediaPersonIdentity>>
        updateMediaPerson: (
          personID: string,
          revision: number,
          input: UpdateMediaPersonIdentityInput,
        ) => Promise<DesktopResult<MediaPersonIdentity>>
        mergeMediaPeople: (
          targetID: string,
          revision: number,
          sourceIDs: string[],
        ) => Promise<DesktopResult<MediaPersonIdentity>>
        splitMediaPerson: (
          personID: string,
          revision: number,
          nodeIDs: number[],
          name?: string,
        ) => Promise<DesktopResult<MediaPersonSplit>>
        createMediaAlbum: (name: string) => Promise<DesktopResult<AgentMediaAlbum>>
        renameMediaAlbum: (albumID: string, revision: number, name: string) => Promise<DesktopResult<AgentMediaAlbum>>
        deleteMediaAlbum: (albumID: string, revision: number) => Promise<DesktopResult<{ ok: boolean }>>
        createSmartMediaAlbum: (name: string, query: MediaGalleryQuery) => Promise<DesktopResult<AgentMediaAlbum>>
        updateSmartMediaAlbum: (
          albumID: string,
          revision: number,
          input: { name?: string; query?: MediaGalleryQuery },
        ) => Promise<DesktopResult<AgentMediaAlbum>>
        deleteSmartMediaAlbum: (albumID: string, revision: number) => Promise<DesktopResult<{ ok: boolean }>>
        addMediaAlbumItems: (albumID: string, revision: number, nodeIDs: number[]) => Promise<DesktopResult<AgentMediaAlbum>>
        removeMediaAlbumItem: (albumID: string, revision: number, nodeID: number) => Promise<DesktopResult<AgentMediaAlbum>>
        getMediaAlbumItems: (
          albumID: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItem[]>>
        getMediaAlbumItemRange: (
          albumID: string,
          limit?: number,
          offset?: number,
          query?: MediaGalleryQuery,
        ) => Promise<DesktopResult<AgentMediaItemRange>>
        setMediaFavorite: (nodeID: number, favorite: boolean) => Promise<DesktopResult<{ favorite: boolean }>>
        setMediaFavoriteBatch: (nodeIDs: number[], favorite: boolean) => Promise<DesktopResult<{ updated: number; favorite: boolean }>>
        addMediaTagsBatch: (nodeIDs: number[], tags: string[]) => Promise<DesktopResult<{ updated: number; tags: string[] }>>
        setMediaTags: (nodeID: number, tags: string[]) => Promise<DesktopResult<{ tags: string[] }>>
        setMediaPeople: (nodeID: number, people: string[]) => Promise<DesktopResult<AgentMediaPeople>>
        setMediaDescription: (nodeID: number, description: string) => Promise<DesktopResult<AgentMediaDescription>>
        getMediaEditRecipe: (nodeID: number) => Promise<DesktopResult<MediaEditRecipe>>
        saveMediaEditRecipe: (
          nodeID: number,
          input: MediaEditRecipeInput,
        ) => Promise<DesktopResult<MediaEditRecipe>>
        resetMediaEditRecipe: (
          nodeID: number,
          revision: number,
        ) => Promise<DesktopResult<MediaEditRecipe>>
        getMediaThumbnail: (nodeID: number) => Promise<DesktopResult<AgentMediaThumbnail>>
        putMediaVideoPoster: (nodeID: number, revision: number, data: ArrayBuffer) => Promise<DesktopResult<{ ok: boolean }>>
        getMediaLivePhotoMotion: (
          nodeID: number,
          onProgress?: XDriveByteProgressHandler,
        ) => Promise<DesktopResult<string>>
        releaseMediaLivePhotoMotion: (
          url: string,
        ) => Promise<DesktopResult<{ released: boolean }>>
        getSources: () => Promise<DesktopResult<AgentSource[]>>
        getSourceRuns: (sourceID: number, limit?: number, offset?: number) => Promise<DesktopResult<AgentSourceRun[]>>
        getSourceRunFailures: (sourceID: number, runID: string, limit?: number, offset?: number) => Promise<DesktopResult<AgentSourceRunFailure[]>>
        cancelSourceRun: (sourceID: number, runID: string) => Promise<DesktopResult<AgentSourceRun>>
        getSourceItems: (sourceID: number, state?: string, limit?: number, offset?: number) => Promise<DesktopResult<AgentSourceItem[]>>
        getSourceCollections: (sourceID: number, state?: string) => Promise<DesktopResult<AgentSourceCollection[]>>
        getSourceCollectionItems: (sourceID: number, collectionID: number, limit?: number, offset?: number) => Promise<DesktopResult<AgentSourceCollectionItem[]>>
        getSourceCredential: (sourceID: number) => Promise<DesktopResult<AgentSourceCredentialStatus>>
        revealSourceCredential: (sourceID: number) => Promise<DesktopResult<AgentSourceCredentialReveal>>
        testSourceCredential: (kind: string, credential: string | Record<string, string>) => Promise<DesktopResult<AgentSourceCredentialTestResult>>
        testStoredSourceCredential: (sourceID: number) => Promise<DesktopResult<AgentSourceCredentialTestResult>>
        setSourceCredential: (sourceID: number, credential: string | Record<string, string>) => Promise<DesktopResult<AgentSourceCredentialStatus>>
        deleteSourceCredential: (sourceID: number) => Promise<DesktopResult<{ ok: boolean }>>
        getSourceConnectorConfig: (sourceID: number) => Promise<DesktopResult<AgentSourceConnectorConfig>>
        browseSourceDirectories: (sourceID: number, path?: string, limit?: number, offset?: number) => Promise<DesktopResult<ExternalSourceBrowsePage>>
        setSourceConnectorConfig: (sourceID: number, revision: number, payload: Record<string, unknown>) => Promise<DesktopResult<AgentSourceConnectorConfig>>
        createSource: (input: AgentCreateSourceInput) => Promise<DesktopResult<AgentSource>>
        updateSource: (sourceID: number, revision: number, input: AgentUpdateSourceInput) => Promise<DesktopResult<AgentSource>>
        deleteSource: (sourceID: number, revision: number) => Promise<DesktopResult<{ ok: boolean }>>
        triggerSource: (sourceID: number) => Promise<DesktopResult<AgentSource>>
        cloudRoot: () => Promise<DesktopResult<AgentCloudNode>>
        cloudChildren: (parentID: number) => Promise<DesktopResult<AgentCloudNode[]>>
        cloudChildrenPage: (
          parentID: number,
          options?: XDriveCloudFilesPageOptions,
        ) => Promise<DesktopResult<AgentCloudChildrenPage>>
        cloudChildrenRange: (
          parentID: number,
          offset: number,
          limit?: number,
          sort?: 'name' | 'updated' | 'size' | 'type',
          order?: 'asc' | 'desc',
          includeCount?: boolean,
          grouping?: XDriveFileExplorerGrouping,
        ) => Promise<DesktopResult<AgentCloudChildrenRange>>
        cloudChanges: (
          after?: number,
          limit?: number,
        ) => Promise<DesktopResult<AgentCloudNodeChangePage>>
        cloudFileQuickAccess: () => Promise<DesktopResult<AgentCloudQuickAccessItem[]>>
        cloudPinFileQuickAccess: (nodeID: number) => Promise<DesktopResult<AgentCloudQuickAccessItem>>
        cloudUnpinFileQuickAccess: (nodeID: number) => Promise<DesktopResult<{ ok: boolean }>>
        cloudFileFavorites: () => Promise<DesktopResult<AgentCloudFavoriteItem[]>>
        cloudFavoriteFile: (nodeID: number) => Promise<DesktopResult<AgentCloudFavoriteItem>>
        cloudUnfavoriteFile: (nodeID: number) => Promise<DesktopResult<{ ok: boolean }>>
        cloudFileRecent: (limit?: number) => Promise<DesktopResult<AgentCloudRecentItem[]>>
        cloudTouchFileRecent: (nodeID: number) => Promise<DesktopResult<AgentCloudRecentItem>>
        cloudClearFileRecent: () => Promise<DesktopResult<{ ok: boolean }>>
        cloudCreateDirectory: (parentID: number, name: string) => Promise<DesktopResult<AgentCloudNode>>
        cloudRename: (id: number, revision: number, name: string) => Promise<DesktopResult<AgentCloudNode>>
        cloudCopy: (id: number, parentID: number) => Promise<DesktopResult<AgentCloudNode>>
        cloudMove: (id: number, revision: number, parentID: number) => Promise<DesktopResult<AgentCloudNode>>
        cloudDelete: (id: number, revision: number) => Promise<DesktopResult<{ ok: boolean }>>
        cloudBatchCopy: (items: AgentCloudBatchNodeRef[], parentID: number) => Promise<DesktopResult<AgentCloudBatchResult>>
        cloudBatchMove: (items: AgentCloudBatchNodeRef[], parentID: number) => Promise<DesktopResult<AgentCloudBatchResult>>
        cloudBatchDelete: (items: AgentCloudBatchNodeRef[]) => Promise<DesktopResult<AgentCloudBatchResult>>
        cloudFilePropertiesStats: (
          items: AgentCloudBatchNodeRef[],
          requestID: string,
        ) => Promise<DesktopResult<XDriveFileExplorerPropertiesStats>>
        cloudCancelFilePropertiesStats: (
          requestID: string,
        ) => Promise<DesktopResult<{ cancelled: boolean }>>
        cloudFileMediaDetails: (
          items: AgentCloudBatchNodeRef[],
        ) => Promise<DesktopResult<XDriveFileExplorerMediaDetails[]>>
        cloudCreateFileOperation: (type: 'copy' | 'move' | 'delete', items: AgentCloudBatchNodeRef[], parentID?: number) => Promise<DesktopResult<AgentCloudFileOperation>>
        cloudBackgroundTaskActiveSummary: () => Promise<DesktopResult<AgentBackgroundTaskActiveSummary>>
        cloudBackgroundTaskPage: (
          global?: boolean,
          limit?: number,
          cursor?: string,
        ) => Promise<DesktopResult<AgentBackgroundTaskPage>>
        cloudBackgroundTasks: (global?: boolean, limit?: number) => Promise<DesktopResult<AgentBackgroundTask[]>>
        cloudBackgroundTaskControl: (
          id: string,
          action: string,
          global?: boolean,
        ) => Promise<DesktopResult<AgentBackgroundTaskControlResult>>
        cloudFileOperations: (limit?: number) => Promise<DesktopResult<AgentCloudFileOperation[]>>
        cloudClearFileOperationHistory: () => Promise<DesktopResult<{ ok: boolean }>>
        cloudFileOperation: (id: string) => Promise<DesktopResult<AgentCloudFileOperation>>
        cloudCancelFileOperation: (id: string) => Promise<DesktopResult<AgentCloudFileOperation>>
        cloudRetryFileOperation: (id: string) => Promise<DesktopResult<AgentCloudFileOperation>>
        cloudUndoFileOperation: (id: string) => Promise<DesktopResult<AgentCloudFileOperation>>
        cloudRedoFileOperation: (id: string) => Promise<DesktopResult<AgentCloudFileOperation>>
        cloudResolveFileOperationConflict: (id: string, policy: 'skip' | 'keep_both' | 'replace') => Promise<DesktopResult<AgentCloudFileOperation>>
        cloudUploadPreflight: (parentID: number, name: string) => Promise<DesktopResult<XDriveUploadConflictPreflight>>
        cloudUploadPreflightBatch: (items: Array<{ parent_id: number; name: string }>) => Promise<DesktopResult<XDriveUploadConflictPreflight[]>>
        cloudUploadFile: (
          parentID: number,
          file: File,
          conflictPolicy: 'fail' | 'skip' | 'keep_both' | 'overwrite',
          transferID?: string,
        ) => Promise<DesktopResult<AgentCloudUploadResult>>
        cloudUploadFiles: (parentID: number) => Promise<DesktopResult<AgentCloudUploadBatchResult>>
        cloudUploadDroppedFiles: (parentID: number, files: File[]) => Promise<DesktopResult<AgentCloudUploadBatchResult>>
        cloudTextPreview: (id: number) => Promise<DesktopResult<AgentCloudFileTextPreview>>
        cloudFilePreviewURL: (id: number) => Promise<DesktopResult<string>>
        cloudDownload: (id: number, name: string) => Promise<DesktopResult<{ saved: boolean }>>
        cloudDownloadFolder: (id: number, parentID: number) => Promise<DesktopResult<AgentCloudFolderDownloadResult>>
        cloudDownloadFiles: (files: Array<{ id: number; name: string }>) => Promise<DesktopResult<AgentCloudDownloadBatchResult>>
        cloudDownloadArchive: (ids: number[]) => Promise<DesktopResult<AgentCloudArchiveDownloadResult>>
        openPath: (relativePath: string, reveal?: boolean) => Promise<DesktopResult<{ ok: boolean }>>
        openWith: (relativePath: string) => Promise<DesktopResult<{ ok: boolean }>>
        cloudSearch: (
          query: string,
          cursor?: string,
          sort?: 'name' | 'updated' | 'size' | 'type',
          order?: 'asc' | 'desc',
          filters?: XDriveFileExplorerSearchFilters,
        ) => Promise<DesktopResult<AgentCloudSearchPage>>
        cloudSearchRange: (
          query: string,
          offset: number,
          limit?: number,
          sort?: 'name' | 'updated' | 'size' | 'type',
          order?: 'asc' | 'desc',
          filters?: XDriveFileExplorerSearchFilters,
          grouping?: XDriveFileExplorerGrouping,
        ) => Promise<DesktopResult<AgentCloudSearchRange>>
        cloudQuota: () => Promise<DesktopResult<AgentCloudQuota>>
        getServerUpdate: () => Promise<DesktopResult<AgentServerUpdateState>>
        startServerUpdate: (source: 'github' | 'gitlab', channel: 'stable' | 'master', backupFileData: boolean) => Promise<DesktopResult<AgentServerUpdateState>>
        cloudStorageStats: () => Promise<DesktopResult<AgentCloudStorageStats>>
        cloudCleanupStorageCache: (kind: AgentStorageCacheCleanupKind) => Promise<DesktopResult<AgentStorageCacheCleanup>>
        cloudTrash: () => Promise<DesktopResult<AgentCloudNode[]>>
        cloudTrashRange: (
          offset: number,
          limit?: number,
          sort?: 'name' | 'updated' | 'size' | 'type',
          order?: 'asc' | 'desc',
          includeCount?: boolean,
        ) => Promise<DesktopResult<AgentCloudTrashRange>>
        cloudRestoreTrash: (id: number, revision: number) => Promise<DesktopResult<AgentCloudNode>>
        cloudDeleteTrash: (id: number, revision: number) => Promise<DesktopResult<{ ok: boolean }>>
        cloudVersions: (nodeID: number) => Promise<DesktopResult<AgentCloudVersion[]>>
        cloudRestoreVersion: (nodeID: number, revision: number, versionID: number) => Promise<DesktopResult<AgentCloudNode>>
        cloudShares: (nodeID: number) => Promise<DesktopResult<AgentCloudShare[]>>
        cloudCreateShare: (nodeID: number, input: { expires_at?: string; password?: string; max_downloads?: number }) => Promise<DesktopResult<AgentCreatedCloudShare>>
        cloudRevokeShare: (id: number) => Promise<DesktopResult<{ ok: boolean }>>
        getDiagnostics: () => Promise<DesktopResult<AgentDiagnosticReport>>
        reconnect: () => Promise<DesktopResult<AgentStatus>>
        repairSyncRoot: () => Promise<DesktopResult<AgentStatus>>
        openLogs: () => Promise<DesktopResult<{ ok: boolean }>>
        exportDiagnostics: () => Promise<DesktopResult<{ saved: boolean }>>
        retry: () => Promise<AgentConnectionState>
        restart: () => Promise<DesktopResult<AgentConnectionState>>
        login: (input: {
          server: string
          username: string
          password: string
          mount_path?: string
          remember_password?: boolean
          auto_login?: boolean
          use_saved_password?: boolean
        }) => Promise<DesktopResult<AgentStatus>>
        logout: () => Promise<DesktopResult<AgentStatus>>
        changePassword: (input: { current_password: string; new_password: string }) => Promise<DesktopResult<AgentStatus>>
        setPaused: (paused: boolean) => Promise<DesktopResult<AgentStatus>>
        syncNow: () => Promise<DesktopResult<AgentStatus>>
        getSettings: () => Promise<DesktopResult<AgentSettings>>
        updateSettings: (input: { mount_path?: string; cache_limit_bytes?: number }) => Promise<DesktopResult<AgentSettings>>
        getUpdate: () => Promise<DesktopResult<AgentUpdateState>>
        setUpdateMode: (mode: AgentUpdateMode) => Promise<DesktopResult<AgentUpdateState>>
        setUpdateSource: (source: AgentUpdateSource) => Promise<DesktopResult<AgentUpdateState>>
        checkUpdate: () => Promise<DesktopResult<AgentUpdateState>>
        downloadUpdate: () => Promise<DesktopResult<AgentUpdateState>>
        installUpdate: () => Promise<DesktopResult<AgentUpdateState>>
        cancelUpdate: () => Promise<DesktopResult<AgentUpdateState>>
        setSyncRule: (path: string, mode: 'exclude' | 'always-local' | 'default') => Promise<DesktopResult<AgentSettings>>
        getFileAvailability: (path: string) => Promise<DesktopResult<AgentFileAvailability>>
        getFileAvailabilityBatch: (paths: string[]) => Promise<DesktopResult<AgentFileAvailabilityBatch>>
        setFileAvailability: (path: string, action: 'keep' | 'release' | 'online' | 'sync') => Promise<DesktopResult<AgentFileAvailability | { ok: boolean }>>
        getConflicts: () => Promise<DesktopResult<AgentConflict[]>>
        openConflict: (id: string, both?: boolean) => Promise<DesktopResult<{ ok: boolean }>>
        resolveConflict: (id: string, choice: 'server' | 'local') => Promise<DesktopResult<{ ok: boolean }>>
        retryTransfer: (id: string) => Promise<DesktopResult<AgentTransfers>>
        transferLifecycle: (input: AgentTransferLifecycleInput) => Promise<DesktopResult<{ id?: string; ok?: boolean }>>
        clearTransferHistory: () => Promise<DesktopResult<AgentTransfers>>
        openFolder: () => Promise<DesktopResult<{ ok: boolean }>>
        onState: (callback: (state: AgentConnectionState) => void) => () => void
        onTransfers: (callback: (state: AgentTransfers) => void) => () => void
      }
    }
  }
}
