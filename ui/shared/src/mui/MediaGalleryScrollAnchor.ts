/**
 * Preserve the screen-space position of a logical Gallery row after the
 * shared VirtualGrid/Timeline recalculates its columns. A missing pinch
 * anchor means the original top-aligned navigation behavior.
 */
export function xDriveMediaGalleryAnchorScrollDelta({
  hostTop,
  scrollViewportTop,
  logicalRowTop,
  anchorViewportTop = 0,
}: {
  hostTop: number
  scrollViewportTop: number
  logicalRowTop: number
  anchorViewportTop?: number
}): number {
  if (!Number.isFinite(hostTop) || !Number.isFinite(scrollViewportTop) ||
      !Number.isFinite(logicalRowTop) || !Number.isFinite(anchorViewportTop)) return 0
  return hostTop - scrollViewportTop + Math.max(0, logicalRowTop) - anchorViewportTop
}
