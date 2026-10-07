export type XDriveMediaVideoPosterRotation = 0 | 90 | 270

export type XDriveMediaVideoPosterGeometry = {
  canvasWidth: number
  canvasHeight: number
  drawWidth: number
  drawHeight: number
  manualRotation: XDriveMediaVideoPosterRotation
}

function normalizedPosterRotation(rotationDegrees?: number): XDriveMediaVideoPosterRotation {
  const value = Number(rotationDegrees)
  if (!Number.isFinite(value)) return 0
  const quarterTurn = Math.round(value / 90) * 90
  const normalized = ((quarterTurn % 360) + 360) % 360
  if (normalized === 90 || normalized === 270) return normalized
  return 0
}

function aspectDistance(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (width <= 0 || height <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return Number.POSITIVE_INFINITY
  }
  const ratio = width / height
  const targetRatio = targetWidth / targetHeight
  return Math.abs(Math.log(ratio / targetRatio))
}

// Browsers normally expose a video's display-matrix rotation through the video
// paint source. Some engines/containers instead expose the raw coded geometry to
// canvas. For quarter-turn metadata we can distinguish the two cases by comparing
// the decoded intrinsic aspect ratio with the Server's unrotated track dimensions.
// 180-degree rotation cannot be inferred from geometry, so it is intentionally left
// to the browser instead of risking a double rotation.
export function xDriveMediaVideoPosterGeometry(
  decodedWidth: number,
  decodedHeight: number,
  sourceWidth = 0,
  sourceHeight = 0,
  rotationDegrees = 0,
  maxEdge = 512,
): XDriveMediaVideoPosterGeometry {
  const decodedW = Math.max(1, Math.round(decodedWidth))
  const decodedH = Math.max(1, Math.round(decodedHeight))
  const sourceW = Math.max(0, Math.round(sourceWidth))
  const sourceH = Math.max(0, Math.round(sourceHeight))
  const rotation = normalizedPosterRotation(rotationDegrees)

  let manualRotation: XDriveMediaVideoPosterRotation = 0
  if (
    rotation !== 0 &&
    sourceW > 0 &&
    sourceH > 0 &&
    sourceW !== sourceH
  ) {
    const unrotatedDistance = aspectDistance(
      decodedW,
      decodedH,
      sourceW,
      sourceH,
    )
    const rotatedDistance = aspectDistance(
      decodedW,
      decodedH,
      sourceH,
      sourceW,
    )
    if (unrotatedDistance + 0.02 < rotatedDistance) {
      manualRotation = rotation
    }
  }

  const displayWidth = manualRotation === 0 ? decodedW : decodedH
  const displayHeight = manualRotation === 0 ? decodedH : decodedW
  const boundedEdge = Math.max(1, Math.round(maxEdge))
  const scale = Math.min(
    1,
    boundedEdge / Math.max(displayWidth, displayHeight),
  )
  const canvasWidth = Math.max(1, Math.round(displayWidth * scale))
  const canvasHeight = Math.max(1, Math.round(displayHeight * scale))

  return {
    canvasWidth,
    canvasHeight,
    drawWidth: manualRotation === 0 ? canvasWidth : canvasHeight,
    drawHeight: manualRotation === 0 ? canvasHeight : canvasWidth,
    manualRotation,
  }
}
