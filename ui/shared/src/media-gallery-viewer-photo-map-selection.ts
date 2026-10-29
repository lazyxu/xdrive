import type { MediaItem } from './models'

/**
 * One current Viewer photo identity, not a map permission, SDK token or
 * coordinate grant. The Parent must still authenticate its exact Owner Node
 * and derived BD09 focus, then reauthorize a signed /cells Range.
 *
 * Do not put raw WGS84/GPS, photo EXIF, URL, album/Owner or media bytes here.
 */
export type XDriveViewerPhotoMapSelection = Readonly<{
  nodeID: number
  revision: number
}>

/** Fail closed on missing/stale/unsafe Node identities. The precise photo
 * may be unavailable to the map until its Server-derived BD09 index is ready.
 * No per-photo consent is required or requested here. */
export function xDriveViewerPhotoMapSelection(
  item: MediaItem | null | undefined,
): XDriveViewerPhotoMapSelection | null {
  const nodeID = item?.node?.id
  const revision = item?.node?.revision
  return typeof nodeID === 'number' && Number.isSafeInteger(nodeID) && nodeID > 0 &&
    typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
    ? { nodeID, revision }
    : null
}
