import { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import type { XDriveFilePreviewMediaTransform } from '../file-preview'

const maxEditedPreviewEdge = 4096

function safeCrop(transform: XDriveFilePreviewMediaTransform) {
  const x = Math.min(0.95, Math.max(0, transform.cropX ?? 0))
  const y = Math.min(0.95, Math.max(0, transform.cropY ?? 0))
  const width = Math.min(1 - x, Math.max(0.05, transform.cropWidth ?? 1))
  const height = Math.min(1 - y, Math.max(0.05, transform.cropHeight ?? 1))
  return { x, y, width, height }
}

function transformScale(transform: XDriveFilePreviewMediaTransform) {
  return {
    x: transform.flipHorizontal ? -1 : 1,
    y: transform.flipVertical ? -1 : 1,
  }
}

export function XDriveTransformedImagePreview({
  src,
  alt,
  transform,
  viewportTransform = '',
  onError,
}: {
  src: string
  alt: string
  transform: XDriveFilePreviewMediaTransform
  viewportTransform?: string
  onError?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let active = true
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (!active || !canvasRef.current) return
      const sourceWidth = image.naturalWidth
      const sourceHeight = image.naturalHeight
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        onError?.()
        return
      }

      const crop = safeCrop(transform)
      const sourceX = Math.round(sourceWidth * crop.x)
      const sourceY = Math.round(sourceHeight * crop.y)
      const sourceCropWidth = Math.max(
        1,
        Math.min(sourceWidth - sourceX, Math.round(sourceWidth * crop.width)),
      )
      const sourceCropHeight = Math.max(
        1,
        Math.min(sourceHeight - sourceY, Math.round(sourceHeight * crop.height)),
      )
      const scale = Math.min(
        1,
        maxEditedPreviewEdge / Math.max(sourceCropWidth, sourceCropHeight),
      )
      const drawWidth = Math.max(1, Math.round(sourceCropWidth * scale))
      const drawHeight = Math.max(1, Math.round(sourceCropHeight * scale))
      const rotation = ((transform.rotationDegrees || 0) % 360 + 360) % 360
      const swapAxes = rotation === 90 || rotation === 270
      const canvas = canvasRef.current
      canvas.width = swapAxes ? drawHeight : drawWidth
      canvas.height = swapAxes ? drawWidth : drawHeight
      canvas.setAttribute('aria-label', alt)

      const context = canvas.getContext('2d')
      if (!context) {
        onError?.()
        return
      }
      context.save()
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate(rotation * Math.PI / 180)
      const flip = transformScale(transform)
      context.scale(flip.x, flip.y)

      const brightness = Math.pow(2, transform.exposureEV || 0)
      const contrast = Math.max(0, 1 + (transform.contrast || 0))
      const saturation = Math.max(0, 1 + (transform.saturation || 0))
      context.filter =
        `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceCropWidth,
        sourceCropHeight,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight,
      )
      context.restore()
    }
    image.onerror = () => {
      if (active) onError?.()
    }
    image.src = src
    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [alt, onError, src, transform])

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        transform: viewportTransform || undefined,
        transformOrigin: 'center',
      }}
    >
      <Box
        component="canvas"
        ref={canvasRef}
        role="img"
        aria-label={alt}
        sx={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          userSelect: 'none',
        }}
      />
    </Box>
  )
}

export function XDriveTransformedVideoPreview({
  src,
  transform,
  onError,
}: {
  src: string
  transform: XDriveFilePreviewMediaTransform
  onError?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trimStart = Math.max(0, (transform.trimStartMS || 0) / 1000)
  const trimEnd = Math.max(0, (transform.trimEndMS || 0) / 1000)
  const rotation = ((transform.rotationDegrees || 0) % 360 + 360) % 360
  const flip = transformScale(transform)

  const clampToWindow = () => {
    const video = videoRef.current
    if (!video) return
    if (video.currentTime < trimStart - 0.05) video.currentTime = trimStart
    if (trimEnd > trimStart && video.currentTime > trimEnd) {
      video.currentTime = trimEnd
      video.pause()
    }
  }

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'black',
      }}
    >
      <Box
        component="video"
        ref={videoRef}
        src={src}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={() => {
          if (trimStart > 0 && videoRef.current) videoRef.current.currentTime = trimStart
        }}
        onPlay={() => {
          const video = videoRef.current
          if (!video) return
          if (
            video.currentTime < trimStart ||
            (trimEnd > trimStart && video.currentTime >= trimEnd)
          ) {
            video.currentTime = trimStart
          }
        }}
        onSeeking={clampToWindow}
        onTimeUpdate={() => {
          const video = videoRef.current
          if (!video || trimEnd <= trimStart) return
          if (video.currentTime >= trimEnd) {
            video.pause()
            video.currentTime = trimEnd
          }
        }}
        onError={onError}
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          transform: `rotate(${rotation}deg) scale(${flip.x}, ${flip.y})`,
          transformOrigin: 'center',
        }}
      />
    </Box>
  )
}
