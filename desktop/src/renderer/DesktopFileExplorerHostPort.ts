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

export type DesktopFileExplorerHostPort = {
  readonly requestViewport: typeof xDriveDesktopViewportRequest
  readonly leasePreviewURL: typeof xDriveLeaseDesktopPreviewURL
  readonly releaseDiscardedPreviewURL: typeof xDriveReleaseDiscardedDesktopPreviewURL
  readonly agent: DesktopFileExplorerAgentPort
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
    requestViewport: xDriveDesktopViewportRequest,
    leasePreviewURL: xDriveLeaseDesktopPreviewURL,
    releaseDiscardedPreviewURL: xDriveReleaseDiscardedDesktopPreviewURL,
    agent: files,
    native: Object.freeze({
      copyText: desktop.copyText,
      startNativeDragOut: desktop.startNativeDragOut,
    }),
  })
}
