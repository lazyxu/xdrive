/**
 * Browser-independent capability admission for the full Files Controller.
 *
 * A successful Host handshake is the only source of these feature flags.
 * All missing/unknown capabilities fail closed; displaying a button or a
 * Desktop/DSM role does not grant Owner, Root, Agent or filesystem authority.
 *
 * Keep this pure: Host adapters own the actual Electron IPC / DSM CGI and
 * every request still requires server-side authorization.
 */
export type XDriveFileExplorerHostCapabilitySnapshot = Readonly<{
  uploadConflictSupported: boolean
  archiveDownloadSupported: boolean
  folderTreeDownloadSupported: boolean
  textPreviewSupported: boolean
  previewStreamSupported: boolean
  mediaPropertiesSupported: boolean
  nodeLocationSupported: boolean
  childPositionSupported: boolean
  transferLifecycleSupported: boolean
  transferLifecycleBatchSupported: boolean
  transferGroupUploadCancelSupported: boolean
  localDiskSpaceSupported: boolean
}>

export function xDriveFileExplorerHostCapabilities(
  advertised: readonly string[] | undefined | null,
): XDriveFileExplorerHostCapabilitySnapshot {
  const accepted = new Set(advertised ?? [])
  const has = (...names: string[]) => names.every(name => accepted.has(name))
  return {
    // An unsafe partial handshake must NOT expose an upload operation.
    uploadConflictSupported: has('upload-conflict-preflight', 'upload-conflict-policy'),
    archiveDownloadSupported: has('archive-download'),
    folderTreeDownloadSupported: has('folder-download-tree'),
    textPreviewSupported: has('file-text-preview'),
    previewStreamSupported: has('file-preview-stream'),
    mediaPropertiesSupported: has('media-item-properties'),
    nodeLocationSupported: has('node-location'),
    childPositionSupported: has('cloud-child-position'),
    transferLifecycleSupported: has('transfer-lifecycle'),
    transferLifecycleBatchSupported: has('transfer-lifecycle-child-batch'),
    transferGroupUploadCancelSupported: has('transfer-upload-group-cancel'),
    localDiskSpaceSupported: has('local-disk-space'),
  }
}
