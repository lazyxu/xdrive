export type XDrivePreviewPoint = { x: number; y: number }
export type XDrivePreviewViewport = { scale: number; offset: XDrivePreviewPoint }
export type XDrivePreviewImageDimensions = { width: number; height: number; noUpscale?: boolean }
export type XDrivePreviewViewportSize = { width: number; height: number }

/** The visible pixels, rather than the object-fit element's letterboxed rectangle, limit pan. */
export function xDriveClampPreviewViewport(
  viewport: XDrivePreviewViewport,
  size: XDrivePreviewViewportSize,
  image: XDrivePreviewImageDimensions | null,
  fit: 'contain' | 'cover',
): XDrivePreviewViewport {
  if (viewport.scale === 1 || !image || size.width <= 0 || size.height <= 0) {
    return { scale: viewport.scale, offset: { x: 0, y: 0 } }
  }
  const ratios = [size.width / image.width, size.height / image.height]
  const fittedScale = fit === 'cover' ? Math.max(...ratios) : Math.min(...ratios)
  const contentScale = image.noUpscale ? Math.min(1, fittedScale) : fittedScale
  const maxX = Math.max(0, (image.width * contentScale * viewport.scale - size.width) / 2)
  const maxY = Math.max(0, (image.height * contentScale * viewport.scale - size.height) / 2)
  return {
    scale: viewport.scale,
    offset: {
      x: Math.min(maxX, Math.max(-maxX, viewport.offset.x)),
      y: Math.min(maxY, Math.max(-maxY, viewport.offset.y)),
    },
  }
}

/** Keep the image point below the old anchor below the new anchor as scale changes. */
export function xDriveAnchorPreviewZoom(
  viewport: XDrivePreviewViewport,
  scale: number,
  from: XDrivePreviewPoint,
  to: XDrivePreviewPoint = from,
): XDrivePreviewViewport {
  const ratio = scale / viewport.scale
  return {
    scale,
    offset: {
      x: to.x - (from.x - viewport.offset.x) * ratio,
      y: to.y - (from.y - viewport.offset.y) * ratio,
    },
  }
}
