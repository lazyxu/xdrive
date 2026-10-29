import {
  xDriveFileNeedsBrowserCompatibleImagePreview,
  type XDriveFilePreviewKind,
} from './file-preview'
import {
  xDriveFileExplorerReadNodeID,
  type XDriveFileExplorerReadonlyItem,
} from './file-explorer-read-identity'

export type XDriveFileExplorerPreviewRequestItem = XDriveFileExplorerReadonlyItem & Readonly<{
  name: string
}>

export type XDriveFileExplorerPreviewRequest =
  | Readonly<{ mode: 'live-still'; nodeID: number }>
  | Readonly<{ mode: 'analysis-image'; nodeID: number }>
  | Readonly<{ mode: 'file-stream'; nodeID: number }>

/**
 * Decide ONE signed Owner read family for the canonical Files preview across
 * Web/PWA and Desktop. This is only a presentation/read request plan; the
 * current authenticated Host authorizes the actual operation and owns
 * AbortSignal, URL leases, late-ticket disposal and source cancellation.
 *
 * Never interpret a .livp ZIP as a video source. HEIC/HEIF/RAW requires the
 * existing browser-compatible Owner derivative rather than the raw original.
 */
export function xDriveFileExplorerPreviewRequest(
  item: XDriveFileExplorerPreviewRequestItem,
  kind: XDriveFilePreviewKind,
  allowed = true,
): XDriveFileExplorerPreviewRequest | null {
  const nodeID = xDriveFileExplorerReadNodeID(item, allowed)
  if (nodeID === null) return null
  if (kind === 'live_photo') return { mode: 'live-still', nodeID }
  if (kind === 'image' && xDriveFileNeedsBrowserCompatibleImagePreview(item.name)) {
    return { mode: 'analysis-image', nodeID }
  }
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
    return { mode: 'file-stream', nodeID }
  }
  return null
}
