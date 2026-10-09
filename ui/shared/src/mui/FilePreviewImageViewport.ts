import type { XDriveFilePreviewMediaTransform } from '../file-preview'

export type XDriveImageViewportOffset = { x: number; y: number }

export function xDriveClampImageScale(value: number) {
  return Math.min(6, Math.max(1, Math.round(value * 100) / 100))
}

function transformedImageSize(
  width: number,
  height: number,
  transform?: XDriveFilePreviewMediaTransform,
) {
  if (!transform || width <= 0 || height <= 0) return { width, height }
  const cropX = Math.min(0.95, Math.max(0, transform.cropX ?? 0))
  const cropY = Math.min(0.95, Math.max(0, transform.cropY ?? 0))
  const cropWidth = Math.min(1 - cropX, Math.max(0.05, transform.cropWidth ?? 1))
  const cropHeight = Math.min(1 - cropY, Math.max(0.05, transform.cropHeight ?? 1))
  let nextWidth = width * cropWidth
  let nextHeight = height * cropHeight
  const rotation = ((transform.rotationDegrees || 0) % 360 + 360) % 360
  if (rotation === 90 || rotation === 270) {
    ;[nextWidth, nextHeight] = [nextHeight, nextWidth]
  }
  return { width: nextWidth, height: nextHeight }
}

export function xDriveImagePanBounds({
  viewportWidth,
  viewportHeight,
  imageWidth,
  imageHeight,
  imageFit,
  scale,
  mediaTransform,
}: {
  viewportWidth: number
  viewportHeight: number
  imageWidth: number
  imageHeight: number
  imageFit: 'contain' | 'cover'
  scale: number
  mediaTransform?: XDriveFilePreviewMediaTransform
}) {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    scale <= 1
  ) return { x: 0, y: 0 }

  const transformed = transformedImageSize(imageWidth, imageHeight, mediaTransform)
  const fitScale = imageFit === 'cover'
    ? Math.max(viewportWidth / transformed.width, viewportHeight / transformed.height)
    : Math.min(viewportWidth / transformed.width, viewportHeight / transformed.height)
  const renderedWidth = transformed.width * fitScale * scale
  const renderedHeight = transformed.height * fitScale * scale
  return {
    x: Math.max(0, (renderedWidth - viewportWidth) / 2),
    y: Math.max(0, (renderedHeight - viewportHeight) / 2),
  }
}

export function xDriveClampImageOffset(
  offset: XDriveImageViewportOffset,
  bounds: XDriveImageViewportOffset,
): XDriveImageViewportOffset {
  const clampAxis = (value: number, bound: number) => (
    bound <= 0 ? 0 : Math.max(-bound, Math.min(bound, value))
  )
  return {
    x: clampAxis(offset.x, bounds.x),
    y: clampAxis(offset.y, bounds.y),
  }
}

export function xDriveAnchoredImageOffset({
  offset,
  oldScale,
  newScale,
  anchorX,
  anchorY,
}: {
  offset: XDriveImageViewportOffset
  oldScale: number
  newScale: number
  anchorX: number
  anchorY: number
}): XDriveImageViewportOffset {
  if (newScale <= 1 || oldScale <= 0) return { x: 0, y: 0 }
  const ratio = newScale / oldScale
  return {
    x: anchorX - (anchorX - offset.x) * ratio,
    y: anchorY - (anchorY - offset.y) * ratio,
  }
}
