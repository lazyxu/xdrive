// A focused Gallery tile is the only keyboard-return target. Never restore
// focus to a different virtualized row or to a previous account's workspace.
export type XDriveGalleryViewerFocusOrigin = {
  nodeID: number
  index: number
  tile: HTMLElement
}

function matchesTile(tile: HTMLElement | null, host: HTMLElement, nodeID: number, index: number) {
  return Boolean(tile?.isConnected && host.isConnected && host.contains(tile) &&
    tile.dataset.xdriveMediaNodeId === String(nodeID) &&
    tile.dataset.xdriveMediaIndex === String(index))
}

export function xDriveCaptureGalleryViewerFocus(
  host: HTMLElement,
  nodeID: number,
  index: number,
  activeElement: Element | null,
): XDriveGalleryViewerFocusOrigin | null {
  if (!Number.isSafeInteger(nodeID) || nodeID <= 0 ||
      !Number.isSafeInteger(index) || index < 0) return null
  const tile = activeElement?.closest<HTMLElement>('[data-xdrive-media-tile]') ?? null
  return matchesTile(tile, host, nodeID, index) ? { nodeID, index, tile: tile! } : null
}

export function xDriveRestoreGalleryViewerFocus(
  host: HTMLElement,
  origin: XDriveGalleryViewerFocusOrigin | null,
  activeElement: Element | null,
): boolean {
  if (!origin || !host.isConnected) return false
  const valid = (tile: HTMLElement | null) =>
    matchesTile(tile, host, origin.nodeID, origin.index)
  // 100k virtualization can unmount the old element. Only the same exact
  // logical index AND Node ID may replace it; never focus a recycled row.
  const tile = valid(origin.tile) ? origin.tile : host.querySelector<HTMLElement>(
    `[data-xdrive-media-tile][data-xdrive-media-index="${origin.index}"][data-xdrive-media-node-id="${origin.nodeID}"]`,
  )
  if (!valid(tile)) return false
  // If focus has moved to another still-live control after Back, never steal it.
  if (activeElement === tile) return true
  if (activeElement?.isConnected &&
      activeElement.tagName !== 'BODY' && activeElement.tagName !== 'HTML') return false
  tile!.focus({ preventScroll: true })
  return true
}
