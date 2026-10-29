// A focused Gallery tile is the only keyboard-return target. Never restore
// focus to a different virtualized row or to a previous account's workspace.
export type XDriveGalleryViewerFocusOrigin = {
  nodeID: number
  index: number
  tile: HTMLElement
}

function matchesTile(tile: HTMLElement | null, host: HTMLElement, nodeID: number, index: number) {
  try {
    return Boolean(tile?.isConnected && host.isConnected && host.contains(tile) &&
      tile.dataset.xdriveMediaNodeId === String(nodeID) &&
      tile.dataset.xdriveMediaIndex === String(index))
  } catch {
    // A denied/recycled virtual tile is never the original Owner focus target.
    return false
  }
}

export function xDriveCaptureGalleryViewerFocus(
  host: HTMLElement,
  nodeID: number,
  index: number,
  activeElement: Element | null,
): XDriveGalleryViewerFocusOrigin | null {
  if (!Number.isSafeInteger(nodeID) || nodeID <= 0 ||
      !Number.isSafeInteger(index) || index < 0) return null
  try {
    const tile = activeElement?.closest<HTMLElement>('[data-xdrive-media-tile]') ?? null
    return matchesTile(tile, host, nodeID, index) ? { nodeID, index, tile: tile! } : null
  } catch { return null }
}

export function xDriveRestoreGalleryViewerFocus(
  host: HTMLElement,
  origin: XDriveGalleryViewerFocusOrigin | null,
  activeElement: Element | null,
): boolean {
  try {
    if (!origin || !host.isConnected) return false
    const valid = (tile: HTMLElement | null) =>
      matchesTile(tile, host, origin.nodeID, origin.index)
    // 100k virtualization may recycle old tiles. Both ID and index must match.
    const tile = valid(origin.tile) ? origin.tile : host.querySelector<HTMLElement>(
      `[data-xdrive-media-tile][data-xdrive-media-index="${origin.index}"][data-xdrive-media-node-id="${origin.nodeID}"]`,
    )
    if (!valid(tile)) return false
    // Never steal focus from an active local/portaled control.
    if (activeElement === tile) return true
    if (activeElement?.isConnected &&
        activeElement.tagName !== 'BODY' && activeElement.tagName !== 'HTML') return false
    // Do not retry without preventScroll: that would move the 100k Gallery anchor.
    tile!.focus({ preventScroll: true })
    return true
  } catch {
    // Focus restoration is advisory; Back/navigation must still complete.
    return false
  }
}
