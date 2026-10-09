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


export function xDriveCaptureVideoPosterBlob(
  source: string,
  rotationDegrees = 0,
  sourceWidth = 0,
  sourceHeight = 0,
  maxEdge = 512,
  signal?: AbortSignal,
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    if (signal?.aborted || typeof document === 'undefined' || typeof window === 'undefined') {
      resolve(null)
      return
    }

    const video = document.createElement('video')
    let settled = false
    const abort = () => finish(null)
    const finish = (value: Blob | null) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), 15_000)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      finish(null)
      return
    }

    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('loadeddata', () => {
      try {
        if (video.videoWidth < 1 || video.videoHeight < 1) {
          finish(null)
          return
        }
        const geometry = xDriveMediaVideoPosterGeometry(
          video.videoWidth,
          video.videoHeight,
          sourceWidth,
          sourceHeight,
          rotationDegrees,
          maxEdge,
        )
        const canvas = document.createElement('canvas')
        canvas.width = geometry.canvasWidth
        canvas.height = geometry.canvasHeight
        const context = canvas.getContext('2d')
        if (!context) {
          finish(null)
          return
        }
        if (geometry.manualRotation === 90) {
          context.translate(canvas.width, 0)
          context.rotate(Math.PI / 2)
        } else if (geometry.manualRotation === 270) {
          context.translate(0, canvas.height)
          context.rotate(-Math.PI / 2)
        }
        context.drawImage(video, 0, 0, geometry.drawWidth, geometry.drawHeight)
        canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.82)
      } catch {
        finish(null)
      }
    }, { once: true })
    video.addEventListener('error', () => finish(null), { once: true })
    video.src = source
    video.load()
  })
}


/**
 * Use a persisted, revision-matched Server poster before accessing original
 * video bytes. The callback that captures a cold poster is viewport-owned;
 * a cancelled viewport must not publish or backfill its stale result.
 *
 * Returned Blob URLs belong to the caller and must be revoked on disposal.
 */
export async function xDriveResolveMediaVideoPoster({
  nodeID,
  revision,
  loadCached,
  capture,
  save,
  signal,
}: {
  nodeID: number
  revision: number
  loadCached: (nodeID: number, signal?: AbortSignal) => Promise<string | null>
  capture: (signal?: AbortSignal) => Promise<Blob | null>
  save?: (nodeID: number, revision: number, poster: Blob, signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
}): Promise<string | null> {
  if (signal?.aborted) return null
  try {
    const cached = await loadCached(nodeID, signal)
    if (cached) {
      if (signal?.aborted) {
        if (cached.startsWith('blob:')) URL.revokeObjectURL(cached)
        return null
      }
      return cached
    }
  } catch {
    if (signal?.aborted) return null
    // A missing poster or transient cache error can use the cold capture path.
  }

  if (signal?.aborted) return null
  let poster: Blob | null
  try {
    poster = await capture(signal)
  } catch {
    return null
  }
  if (!poster || signal?.aborted) return null

  if (save && Number.isSafeInteger(revision) && revision > 0) {
    try {
      if (signal?.aborted) return null
      await save(nodeID, revision, poster, signal)
    } catch {
      // The cold local poster is useful even when the shared cache rejects PUT.
    }
  }
  if (signal?.aborted) return null
  return URL.createObjectURL(poster)
}
