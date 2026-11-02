// A captured mouse pointer keeps reporting positions after it leaves the
// FileExplorer scroll viewport. Unbounded absolute marquee geometry would
// enlarge the scrollable overflow, adding scrollbars and resizing grid tracks.
export type XDriveFileExplorerMarqueeViewport = {
  left: number
  top: number
  width: number
  height: number
  scrollLeft: number
  scrollTop: number
}

export type XDriveFileExplorerMarqueeContentPoint = {
  x: number
  y: number
}

function clampViewportOffset(offset: number, extent: number): number {
  if (!Number.isFinite(offset)) return 0
  return Math.min(Math.max(0, offset), Math.max(0, extent))
}

export function xDriveFileExplorerMarqueeContentPoint(
  viewport: XDriveFileExplorerMarqueeViewport,
  clientX: number,
  clientY: number,
): XDriveFileExplorerMarqueeContentPoint {
  return {
    x: viewport.scrollLeft + clampViewportOffset(clientX - viewport.left, viewport.width),
    y: viewport.scrollTop + clampViewportOffset(clientY - viewport.top, viewport.height),
  }
}
