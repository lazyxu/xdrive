import { xDriveDesktopViewportRequest } from './abortableViewportRequest'
import { xDriveLeaseDesktopPreviewURL, xDriveReleaseDiscardedDesktopPreviewURL } from './desktopPreviewURLLease'

/**
 * The only Desktop/Electron transport map for the FileExplorer controller.
 *
 * Explicit allowlist: no arbitrary Agent RPC, no credentials passed into JSX,
 * and no equivalent privileges implicitly exposed to a DSM Host.
 * Methods keep the exact preload signatures/cancellation semantics.
 */
export const XDRIVE_DESKTOP_FILES_AGENT_METHODS = [
  'cancelMediaItem',
  'cloudCancelFilePropertiesStats',
  'cloudChildPosition',
  'cloudChildrenPage',
  'cloudClearFileRecent',
  'cloudCreateDirectory',
  'cloudCreateFileOperation',
  'cloudCreateFileSavedSearch',
  'cloudCreateFileTag',
  'cloudDeleteFileSavedSearch',
  'cloudDeleteFileTag',
  'cloudDownload',
  'cloudDownloadArchive',
  'cloudDownloadFiles',
  'cloudDownloadFolder',
  'cloudFavoriteFile',
  'cloudFileFavorites',
  'cloudFileMediaDetails',
  'cloudFilePreviewURL',
  'cloudFilePropertiesStats',
  'cloudFileQuickAccess',
  'cloudFileRecent',
  'cloudFileSavedSearches',
  'cloudFileTags',
  'cloudPinFileQuickAccess',
  'cloudQueryFileNodeTags',
  'cloudRename',
  'cloudReorderFileQuickAccess',
  'cloudReorderFileSavedSearches',
  'cloudRoot',
  'cloudSearchRange',
  'cloudSetFileTagNodes',
  'cloudTextPreview',
  'cloudTouchFileRecent',
  'cloudUnfavoriteFile',
  'cloudUnpinFileQuickAccess',
  'cloudUpdateFileSavedSearch',
  'cloudUpdateFileTag',
  'cloudUploadDroppedFiles',
  'cloudUploadFile',
  'cloudUploadFiles',
  'cloudUploadPreflight',
  'cloudUploadPreflightBatch',
  'getFileAvailabilityBatch',
  'getMediaAnalysisPreview',
  'getMediaItem',
  'getMediaLivePhotoMotion',
  'getMediaLivePhotoStill',
  'getMediaThumbnail',
  'getNodeLocation',
  'getSources',
  'openPath',
  'openWith',
  'putMediaVideoPoster',
  'releaseCloudFilePreviewURL',
  'releaseMediaLivePhotoMotion',
  'setFileAvailability',
  'transferLifecycle',
] as const satisfies readonly (keyof Window['xdriveDesktop']['agent'])[]

export type DesktopFileExplorerAgentPort = Pick<
  Window['xdriveDesktop']['agent'],
  (typeof XDRIVE_DESKTOP_FILES_AGENT_METHODS)[number]
>

/** browse source capabilities: explicit calls, never dynamic method dispatch. */
export const XDRIVE_DESKTOP_FILES_BROWSE_METHODS = [
    'cloudChildPosition',
    'cloudChildrenPage',
    'cloudFileFavorites',
    'cloudFileQuickAccess',
    'cloudFileRecent',
    'cloudFileSavedSearches',
    'cloudFileTags',
    'cloudQueryFileNodeTags',
    'cloudRoot',
    'cloudSearchRange',
    'getFileAvailabilityBatch',
    'getNodeLocation',
    'getSources',
] as const satisfies readonly (typeof XDRIVE_DESKTOP_FILES_AGENT_METHODS)[number][]
export type DesktopFilesBrowsePort = Pick<
  DesktopFileExplorerAgentPort,
  (typeof XDRIVE_DESKTOP_FILES_BROWSE_METHODS)[number]
>

/** media source capabilities: explicit calls, never dynamic method dispatch. */
export const XDRIVE_DESKTOP_FILES_MEDIA_METHODS = [
    'cancelMediaItem',
    'cloudCancelFilePropertiesStats',
    'cloudFileMediaDetails',
    'cloudFilePreviewURL',
    'cloudFilePropertiesStats',
    'cloudTextPreview',
    'getMediaAnalysisPreview',
    'getMediaItem',
    'getMediaLivePhotoMotion',
    'getMediaLivePhotoStill',
    'getMediaThumbnail',
    'putMediaVideoPoster',
    'releaseCloudFilePreviewURL',
    'releaseMediaLivePhotoMotion',
] as const satisfies readonly (typeof XDRIVE_DESKTOP_FILES_AGENT_METHODS)[number][]
export type DesktopFilesMediaPort = Pick<
  DesktopFileExplorerAgentPort,
  (typeof XDRIVE_DESKTOP_FILES_MEDIA_METHODS)[number]
>

/** write source capabilities: explicit calls, never dynamic method dispatch. */
export const XDRIVE_DESKTOP_FILES_WRITE_METHODS = [
    'cloudClearFileRecent',
    'cloudCreateDirectory',
    'cloudCreateFileOperation',
    'cloudCreateFileSavedSearch',
    'cloudCreateFileTag',
    'cloudDeleteFileSavedSearch',
    'cloudDeleteFileTag',
    'cloudDownload',
    'cloudDownloadArchive',
    'cloudDownloadFiles',
    'cloudDownloadFolder',
    'cloudFavoriteFile',
    'cloudPinFileQuickAccess',
    'cloudRename',
    'cloudReorderFileQuickAccess',
    'cloudReorderFileSavedSearches',
    'cloudSetFileTagNodes',
    'cloudTouchFileRecent',
    'cloudUnfavoriteFile',
    'cloudUnpinFileQuickAccess',
    'cloudUpdateFileSavedSearch',
    'cloudUpdateFileTag',
    'cloudUploadDroppedFiles',
    'cloudUploadFile',
    'cloudUploadFiles',
    'cloudUploadPreflight',
    'cloudUploadPreflightBatch',
    'openPath',
    'openWith',
    'setFileAvailability',
    'transferLifecycle',
] as const satisfies readonly (typeof XDRIVE_DESKTOP_FILES_AGENT_METHODS)[number][]
export type DesktopFilesWritePort = Pick<
  DesktopFileExplorerAgentPort,
  (typeof XDRIVE_DESKTOP_FILES_WRITE_METHODS)[number]
>

export type DesktopFileExplorerHostPort = {
  readonly browse: DesktopFilesBrowsePort
  readonly media: DesktopFilesMediaPort
  readonly write: DesktopFilesWritePort
  readonly requestViewport: typeof xDriveDesktopViewportRequest
  readonly leasePreviewURL: typeof xDriveLeaseDesktopPreviewURL
  readonly releaseDiscardedPreviewURL: typeof xDriveReleaseDiscardedDesktopPreviewURL
  readonly native: Pick<Window['xdriveDesktop'], 'copyText' | 'startNativeDragOut'>
}

/**
 * Create once per owning Desktop App. IPC methods from Electron preload
 * are arrow closures; they never depend on the receiving object as `this`.
 * DSM must implement its own authorized domain ports, not this bridge.
 */
export function createDesktopFileExplorerHostPort(): DesktopFileExplorerHostPort {
  const desktop = window.xdriveDesktop
  const agent = desktop.agent
  const files = Object.freeze({
    cancelMediaItem: agent.cancelMediaItem,
    cloudCancelFilePropertiesStats: agent.cloudCancelFilePropertiesStats,
    cloudChildPosition: agent.cloudChildPosition,
    cloudChildrenPage: agent.cloudChildrenPage,
    cloudClearFileRecent: agent.cloudClearFileRecent,
    cloudCreateDirectory: agent.cloudCreateDirectory,
    cloudCreateFileOperation: agent.cloudCreateFileOperation,
    cloudCreateFileSavedSearch: agent.cloudCreateFileSavedSearch,
    cloudCreateFileTag: agent.cloudCreateFileTag,
    cloudDeleteFileSavedSearch: agent.cloudDeleteFileSavedSearch,
    cloudDeleteFileTag: agent.cloudDeleteFileTag,
    cloudDownload: agent.cloudDownload,
    cloudDownloadArchive: agent.cloudDownloadArchive,
    cloudDownloadFiles: agent.cloudDownloadFiles,
    cloudDownloadFolder: agent.cloudDownloadFolder,
    cloudFavoriteFile: agent.cloudFavoriteFile,
    cloudFileFavorites: agent.cloudFileFavorites,
    cloudFileMediaDetails: agent.cloudFileMediaDetails,
    cloudFilePreviewURL: agent.cloudFilePreviewURL,
    cloudFilePropertiesStats: agent.cloudFilePropertiesStats,
    cloudFileQuickAccess: agent.cloudFileQuickAccess,
    cloudFileRecent: agent.cloudFileRecent,
    cloudFileSavedSearches: agent.cloudFileSavedSearches,
    cloudFileTags: agent.cloudFileTags,
    cloudPinFileQuickAccess: agent.cloudPinFileQuickAccess,
    cloudQueryFileNodeTags: agent.cloudQueryFileNodeTags,
    cloudRename: agent.cloudRename,
    cloudReorderFileQuickAccess: agent.cloudReorderFileQuickAccess,
    cloudReorderFileSavedSearches: agent.cloudReorderFileSavedSearches,
    cloudRoot: agent.cloudRoot,
    cloudSearchRange: agent.cloudSearchRange,
    cloudSetFileTagNodes: agent.cloudSetFileTagNodes,
    cloudTextPreview: agent.cloudTextPreview,
    cloudTouchFileRecent: agent.cloudTouchFileRecent,
    cloudUnfavoriteFile: agent.cloudUnfavoriteFile,
    cloudUnpinFileQuickAccess: agent.cloudUnpinFileQuickAccess,
    cloudUpdateFileSavedSearch: agent.cloudUpdateFileSavedSearch,
    cloudUpdateFileTag: agent.cloudUpdateFileTag,
    cloudUploadDroppedFiles: agent.cloudUploadDroppedFiles,
    cloudUploadFile: agent.cloudUploadFile,
    cloudUploadFiles: agent.cloudUploadFiles,
    cloudUploadPreflight: agent.cloudUploadPreflight,
    cloudUploadPreflightBatch: agent.cloudUploadPreflightBatch,
    getFileAvailabilityBatch: agent.getFileAvailabilityBatch,
    getMediaAnalysisPreview: agent.getMediaAnalysisPreview,
    getMediaItem: agent.getMediaItem,
    getMediaLivePhotoMotion: agent.getMediaLivePhotoMotion,
    getMediaLivePhotoStill: agent.getMediaLivePhotoStill,
    getMediaThumbnail: agent.getMediaThumbnail,
    getNodeLocation: agent.getNodeLocation,
    getSources: agent.getSources,
    openPath: agent.openPath,
    openWith: agent.openWith,
    putMediaVideoPoster: agent.putMediaVideoPoster,
    releaseCloudFilePreviewURL: agent.releaseCloudFilePreviewURL,
    releaseMediaLivePhotoMotion: agent.releaseMediaLivePhotoMotion,
    setFileAvailability: agent.setFileAvailability,
    transferLifecycle: agent.transferLifecycle,
  } satisfies DesktopFileExplorerAgentPort)

  return Object.freeze({
    browse: Object.freeze({
      cloudChildPosition: files.cloudChildPosition,
      cloudChildrenPage: files.cloudChildrenPage,
      cloudFileFavorites: files.cloudFileFavorites,
      cloudFileQuickAccess: files.cloudFileQuickAccess,
      cloudFileRecent: files.cloudFileRecent,
      cloudFileSavedSearches: files.cloudFileSavedSearches,
      cloudFileTags: files.cloudFileTags,
      cloudQueryFileNodeTags: files.cloudQueryFileNodeTags,
      cloudRoot: files.cloudRoot,
      cloudSearchRange: files.cloudSearchRange,
      getFileAvailabilityBatch: files.getFileAvailabilityBatch,
      getNodeLocation: files.getNodeLocation,
      getSources: files.getSources,
    }),
    media: Object.freeze({
      cancelMediaItem: files.cancelMediaItem,
      cloudCancelFilePropertiesStats: files.cloudCancelFilePropertiesStats,
      cloudFileMediaDetails: files.cloudFileMediaDetails,
      cloudFilePreviewURL: files.cloudFilePreviewURL,
      cloudFilePropertiesStats: files.cloudFilePropertiesStats,
      cloudTextPreview: files.cloudTextPreview,
      getMediaAnalysisPreview: files.getMediaAnalysisPreview,
      getMediaItem: files.getMediaItem,
      getMediaLivePhotoMotion: files.getMediaLivePhotoMotion,
      getMediaLivePhotoStill: files.getMediaLivePhotoStill,
      getMediaThumbnail: files.getMediaThumbnail,
      putMediaVideoPoster: files.putMediaVideoPoster,
      releaseCloudFilePreviewURL: files.releaseCloudFilePreviewURL,
      releaseMediaLivePhotoMotion: files.releaseMediaLivePhotoMotion,
    }),
    write: Object.freeze({
      cloudClearFileRecent: files.cloudClearFileRecent,
      cloudCreateDirectory: files.cloudCreateDirectory,
      cloudCreateFileOperation: files.cloudCreateFileOperation,
      cloudCreateFileSavedSearch: files.cloudCreateFileSavedSearch,
      cloudCreateFileTag: files.cloudCreateFileTag,
      cloudDeleteFileSavedSearch: files.cloudDeleteFileSavedSearch,
      cloudDeleteFileTag: files.cloudDeleteFileTag,
      cloudDownload: files.cloudDownload,
      cloudDownloadArchive: files.cloudDownloadArchive,
      cloudDownloadFiles: files.cloudDownloadFiles,
      cloudDownloadFolder: files.cloudDownloadFolder,
      cloudFavoriteFile: files.cloudFavoriteFile,
      cloudPinFileQuickAccess: files.cloudPinFileQuickAccess,
      cloudRename: files.cloudRename,
      cloudReorderFileQuickAccess: files.cloudReorderFileQuickAccess,
      cloudReorderFileSavedSearches: files.cloudReorderFileSavedSearches,
      cloudSetFileTagNodes: files.cloudSetFileTagNodes,
      cloudTouchFileRecent: files.cloudTouchFileRecent,
      cloudUnfavoriteFile: files.cloudUnfavoriteFile,
      cloudUnpinFileQuickAccess: files.cloudUnpinFileQuickAccess,
      cloudUpdateFileSavedSearch: files.cloudUpdateFileSavedSearch,
      cloudUpdateFileTag: files.cloudUpdateFileTag,
      cloudUploadDroppedFiles: files.cloudUploadDroppedFiles,
      cloudUploadFile: files.cloudUploadFile,
      cloudUploadFiles: files.cloudUploadFiles,
      cloudUploadPreflight: files.cloudUploadPreflight,
      cloudUploadPreflightBatch: files.cloudUploadPreflightBatch,
      openPath: files.openPath,
      openWith: files.openWith,
      setFileAvailability: files.setFileAvailability,
      transferLifecycle: files.transferLifecycle,
    }),
    requestViewport: xDriveDesktopViewportRequest,
    leasePreviewURL: xDriveLeaseDesktopPreviewURL,
    releaseDiscardedPreviewURL: xDriveReleaseDiscardedDesktopPreviewURL,
    native: Object.freeze({
      copyText: desktop.copyText,
      startNativeDragOut: desktop.startNativeDragOut,
    }),
  })
}
