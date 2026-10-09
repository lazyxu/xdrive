import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from 'react'
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import { Box, CircularProgress, IconButton, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material'
import {
  xDriveClassifyFilePreview,
} from '../file-preview'
import type {
  XDriveByteProgressHandler,
  XDriveFilePreviewKind,
  XDriveFilePreviewMediaTransform,
  XDriveFilePreviewTarget,
  XDriveFileTextPreview,
  XDriveLivePhotoMotionSource,
} from '../file-preview'
import { XDriveLivePhotoSurface } from './LivePhotoSurface'
import { XDriveDecodedImagePreview } from './FilePreviewImage'
import {
  xDriveAnchoredImageOffset,
  xDriveClampImageOffset,
  xDriveClampImageScale,
  xDriveImagePanBounds,
} from './FilePreviewImageViewport'
import {
  XDriveTransformedVideoPreview,
} from './FilePreviewTransformedMedia'

export type XDriveFilePreviewTextLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
) => Promise<XDriveFileTextPreview | null | undefined>

export type XDriveFilePreviewImageLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
) => Promise<string | null | undefined>

export type XDriveFilePreviewMotionLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
  onProgress?: XDriveByteProgressHandler,
) => Promise<XDriveLivePhotoMotionSource | null | undefined>

export type XDriveFilePreviewURLLoader<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = (
  target: T,
  kind: Exclude<XDriveFilePreviewKind, 'none' | 'text'>,
) => Promise<string | null | undefined>

export type XDriveFilePreviewSurfaceProps<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = {
  target: T | null
  loadTextPreview?: XDriveFilePreviewTextLoader<T>
  loadImagePreview?: XDriveFilePreviewImageLoader<T>
  loadPreviewURL?: XDriveFilePreviewURLLoader<T>
  loadLivePhotoMotion?: XDriveFilePreviewMotionLoader<T>
  fallback?: ReactNode
  minHeight?: number
  maxHeight?: number | string
  imageFit?: 'contain' | 'cover'
  interactiveImage?: boolean
  onSwipePrevious?: () => void
  onSwipeNext?: () => void
  mediaTransform?: XDriveFilePreviewMediaTransform
}

function revokePreviewURL(value: string) {
  if (value.startsWith('blob:')) URL.revokeObjectURL(value)
}

export function XDriveFilePreviewSurface<T extends XDriveFilePreviewTarget>({
  target,
  loadTextPreview,
  loadImagePreview,
  loadPreviewURL,
  loadLivePhotoMotion,
  fallback = null,
  minHeight = 176,
  maxHeight = 420,
  imageFit = 'contain',
  interactiveImage = false,
  onSwipePrevious,
  onSwipeNext,
  mediaTransform,
}: XDriveFilePreviewSurfaceProps<T>) {
  const previewKind = useMemo(
    () => target ? xDriveClassifyFilePreview(target) : 'none',
    [target?.kind, target?.mimeType, target?.name],
  )
  const livePhotoMotionLoader = useMemo(() => {
    if (!target || !loadLivePhotoMotion) return undefined
    return (onProgress?: XDriveByteProgressHandler) =>
      loadLivePhotoMotion(target, onProgress)
  }, [
    loadLivePhotoMotion,
    target?.id,
    target?.kind,
    target?.mimeType,
    target?.name,
    target?.revision,
    target?.size,
  ])
  const [textPreview, setTextPreview] = useState<XDriveFileTextPreview | null>(null)
  const [previewURL, setPreviewURL] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  const [mediaBuffering, setMediaBuffering] = useState(false)
  const previewURLRef = useRef('')
  const previewGenerationRef = useRef(0)
  const previewTargetRef = useRef(target)
  const previewLoadersRef = useRef({
    text: loadTextPreview,
    url: loadPreviewURL,
  })
  previewTargetRef.current = target
  previewLoadersRef.current = {
    text: loadTextPreview,
    url: loadPreviewURL,
  }
  const previewTargetID = target?.id
  const previewTargetRevision = target?.revision
  const coarsePointer = useMediaQuery('(pointer: coarse)')
  const imageViewportRef = useRef<HTMLDivElement | null>(null)
  const imageDragRef = useRef<{
    pointerID: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const imagePointersRef = useRef(new Map<number, { x: number; y: number }>())
  const imagePinchRef = useRef<{
    distance: number
    scale: number
    centerX: number
    centerY: number
    originX: number
    originY: number
  } | null>(null)
  const imageSwipeRef = useRef<{
    pointerID: number
    startX: number
    startY: number
    startedAt: number
  } | null>(null)
  const lastTouchTapRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const touchDoubleTapAtRef = useRef(0)
  const [imageScale, setImageScale] = useState(1)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })

  const resetImageViewport = useCallback(() => {
    imageDragRef.current = null
    imagePointersRef.current.clear()
    imagePinchRef.current = null
    imageSwipeRef.current = null
    lastTouchTapRef.current = null
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
  }, [])

  const imageBounds = useCallback((scale: number) => {
    const viewport = imageViewportRef.current
    if (!viewport) return { x: 0, y: 0 }
    const rect = viewport.getBoundingClientRect()
    return xDriveImagePanBounds({
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      imageWidth: imageNaturalSize.width,
      imageHeight: imageNaturalSize.height,
      imageFit,
      scale,
      mediaTransform,
    })
  }, [
    imageFit,
    imageNaturalSize.height,
    imageNaturalSize.width,
    mediaTransform,
  ])

  const clampImageOffset = useCallback((offset: { x: number; y: number }, scale: number) =>
    xDriveClampImageOffset(offset, imageBounds(scale)), [imageBounds])

  const setImageZoomAt = useCallback((
    value: number,
    anchor?: { x: number; y: number },
  ) => {
    const next = xDriveClampImageScale(value)
    if (next === 1) {
      setImageScale(1)
      setImageOffset({ x: 0, y: 0 })
      return
    }
    const viewport = imageViewportRef.current
    setImageOffset((current) => {
      if (!viewport) return clampImageOffset(current, next)
      const rect = viewport.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const anchorX = (anchor?.x ?? centerX) - centerX
      const anchorY = (anchor?.y ?? centerY) - centerY
      return clampImageOffset(xDriveAnchoredImageOffset({
        offset: current,
        oldScale: imageScale,
        newScale: next,
        anchorX,
        anchorY,
      }), next)
    })
    setImageScale(next)
  }, [clampImageOffset, imageScale])

  const handleImageReadySize = useCallback((width: number, height: number) => {
    setImageNaturalSize((current) => (
      current.width === width && current.height === height
        ? current
        : { width, height }
    ))
  }, [])

  useEffect(() => {
    setImageNaturalSize({ width: 0, height: 0 })
    resetImageViewport()
  }, [resetImageViewport, target?.id, target?.revision])

  useEffect(() => {
    setImageOffset((current) => clampImageOffset(current, imageScale))
    const viewport = imageViewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setImageOffset((current) => clampImageOffset(current, imageScale))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [clampImageOffset, imageScale])

  const captureImagePointer = (event: ReactPointerEvent<HTMLElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort across browsers and Electron.
    }
  }

  const releaseImagePointer = (event: ReactPointerEvent<HTMLElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Ignore renderers that already released pointer capture.
    }
  }

  const handleImagePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!interactiveImage || event.button !== 0) return

    if (event.pointerType === 'touch') {
      event.preventDefault()
      imagePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      captureImagePointer(event)

      const points = [...imagePointersRef.current.values()]
      if (points.length >= 2) {
        const [first, second] = points
        imagePinchRef.current = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          scale: imageScale,
          centerX: (first.x + second.x) / 2,
          centerY: (first.y + second.y) / 2,
          originX: imageOffset.x,
          originY: imageOffset.y,
        }
        imageDragRef.current = null
        imageSwipeRef.current = null
        lastTouchTapRef.current = null
        return
      }

      if (imageScale > 1) {
        imageDragRef.current = {
          pointerID: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: imageOffset.x,
          originY: imageOffset.y,
        }
      } else {
        imageSwipeRef.current = {
          pointerID: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startedAt: Date.now(),
        }
      }
      return
    }

    if (imageScale <= 1) return
    event.preventDefault()
    captureImagePointer(event)
    imageDragRef.current = {
      pointerID: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: imageOffset.x,
      originY: imageOffset.y,
    }
  }, [imageOffset.x, imageOffset.y, imageScale, interactiveImage])

  const handleImagePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' && imagePointersRef.current.has(event.pointerId)) {
      imagePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pinch = imagePinchRef.current
      const points = [...imagePointersRef.current.values()]
      if (pinch && points.length >= 2) {
        event.preventDefault()
        const [first, second] = points
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        const nextScale = xDriveClampImageScale(pinch.scale * distance / pinch.distance)
        const currentCenterX = (first.x + second.x) / 2
        const currentCenterY = (first.y + second.y) / 2
        const viewport = imageViewportRef.current
        let nextOffset = { x: pinch.originX, y: pinch.originY }
        if (viewport) {
          const rect = viewport.getBoundingClientRect()
          const viewportCenterX = rect.left + rect.width / 2
          const viewportCenterY = rect.top + rect.height / 2
          nextOffset = xDriveAnchoredImageOffset({
            offset: { x: pinch.originX, y: pinch.originY },
            oldScale: pinch.scale,
            newScale: nextScale,
            anchorX: pinch.centerX - viewportCenterX,
            anchorY: pinch.centerY - viewportCenterY,
          })
          nextOffset.x += currentCenterX - pinch.centerX
          nextOffset.y += currentCenterY - pinch.centerY
        }
        setImageScale(nextScale)
        setImageOffset(clampImageOffset(nextOffset, nextScale))
        return
      }
    }

    const drag = imageDragRef.current
    if (!drag || drag.pointerID !== event.pointerId) return
    event.preventDefault()
    setImageOffset(clampImageOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }, imageScale))
  }, [clampImageOffset, imageScale])

  const handleImagePointerRelease = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const touch = event.pointerType === 'touch'
    const wasPinching = touch && imagePinchRef.current !== null

    if (touch) {
      imagePointersRef.current.delete(event.pointerId)
      if (imagePointersRef.current.size < 2) imagePinchRef.current = null

      const swipe = imageSwipeRef.current
      if (!wasPinching && swipe?.pointerID === event.pointerId) {
        const dx = event.clientX - swipe.startX
        const dy = event.clientY - swipe.startY
        const absX = Math.abs(dx)
        const absY = Math.abs(dy)
        const elapsed = Date.now() - swipe.startedAt
        const horizontalSwipe = imageScale <= 1.01 && elapsed <= 700 && absX >= 56 && absX > absY * 1.25

        if (horizontalSwipe) {
          lastTouchTapRef.current = null
          if (dx < 0) onSwipeNext?.()
          else onSwipePrevious?.()
        } else if (absX < 12 && absY < 12 && elapsed <= 450) {
          const now = Date.now()
          const previous = lastTouchTapRef.current
          if (
            previous &&
            now - previous.at <= 320 &&
            Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32
          ) {
            lastTouchTapRef.current = null
            touchDoubleTapAtRef.current = now
            setImageZoomAt(imageScale > 1 ? 1 : 2, { x: event.clientX, y: event.clientY })
          } else {
            lastTouchTapRef.current = { at: now, x: event.clientX, y: event.clientY }
          }
        }
      }
      imageSwipeRef.current = null
    }

    const drag = imageDragRef.current
    if (drag?.pointerID === event.pointerId) imageDragRef.current = null
    releaseImagePointer(event)
  }, [imageScale, onSwipeNext, onSwipePrevious, setImageZoomAt])

  const handleImagePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    imagePointersRef.current.delete(event.pointerId)
    if (imagePointersRef.current.size < 2) imagePinchRef.current = null
    if (imageDragRef.current?.pointerID === event.pointerId) imageDragRef.current = null
    if (imageSwipeRef.current?.pointerID === event.pointerId) imageSwipeRef.current = null
    lastTouchTapRef.current = null
    releaseImagePointer(event)
  }, [])

  const handleImagePointerLostCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    imagePointersRef.current.delete(event.pointerId)
    if (imagePointersRef.current.size < 2) imagePinchRef.current = null
    if (imageDragRef.current?.pointerID === event.pointerId) imageDragRef.current = null
    if (imageSwipeRef.current?.pointerID === event.pointerId) imageSwipeRef.current = null
  }, [])

  const handleImageWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (!interactiveImage) return
    event.preventDefault()
    setImageZoomAt(
      imageScale * (event.deltaY < 0 ? 1.15 : 1 / 1.15),
      { x: event.clientX, y: event.clientY },
    )
  }, [imageScale, interactiveImage, setImageZoomAt])

  const assignPreviewURL = useCallback((value: string) => {
    const previous = previewURLRef.current
    if (previous && previous !== value) revokePreviewURL(previous)
    previewURLRef.current = value
    setPreviewURL(value)
  }, [])

  useEffect(() => () => {
    const current = previewURLRef.current
    previewURLRef.current = ''
    if (current) revokePreviewURL(current)
  }, [])

  useEffect(() => {
    let active = true
    const generation = previewGenerationRef.current + 1
    previewGenerationRef.current = generation
    const currentTarget = previewTargetRef.current
    const loaders = previewLoadersRef.current
    setTextPreview(null)
    assignPreviewURL('')
    setLoading(false)
    setFailed(false)
    setMediaReady(false)
    setMediaBuffering(false)

    // Images own their two decode-gated layers, including pending-source display.
    if (!currentTarget || previewKind === 'none' || previewKind === 'image' || previewKind === 'live_photo') {
      return () => undefined
    }

    if (previewKind === 'text') {
      if (!loaders.text) return () => undefined
      setLoading(true)
      void loaders.text(currentTarget)
        .then((value) => {
          if (!active) return
          if (value) setTextPreview(value)
          else setFailed(true)
        })
        .catch(() => {
          if (active) setFailed(true)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
      return () => {
        active = false
      }
    }

    if (!loaders.url) return () => undefined

    setLoading(true)
    void loaders.url(currentTarget, previewKind)
      .then((value) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        if (!active || previewGenerationRef.current !== generation) {
          revokePreviewURL(value)
          return
        }
        assignPreviewURL(value)
      })
      .catch(() => {
        if (active && previewGenerationRef.current === generation) setFailed(true)
      })
      .finally(() => {
        if (active && previewGenerationRef.current === generation) setLoading(false)
      })

    return () => {
      active = false
      if (previewGenerationRef.current === generation) previewGenerationRef.current += 1
    }
  }, [
    assignPreviewURL,
    previewKind,
    previewTargetID,
    previewTargetRevision,
  ])

  const markMediaReady = useCallback(() => {
    setMediaReady(true)
    setMediaBuffering(false)
  }, [])
  const markMediaWaiting = useCallback(() => setMediaBuffering(true), [])
  const markMediaFailed = useCallback(() => {
    setMediaReady(false)
    setMediaBuffering(false)
    setFailed(true)
  }, [])
  const mediaPending = Boolean(
    previewURL &&
    (previewKind === 'video' || previewKind === 'audio' || previewKind === 'pdf') &&
    (!mediaReady || mediaBuffering) &&
    !failed
  )
  const mediaLoadingOverlay = mediaPending ? (
    <Box
      data-xdrive-preview-media-loading
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        bgcolor: previewKind === 'audio' ? 'transparent' : 'rgba(0,0,0,.12)',
      }}
    >
      <CircularProgress size={26} aria-label="正在加载媒体" />
    </Box>
  ) : null

  const body = (() => {
    if (target && previewKind === 'live_photo') {
      return (
        <XDriveDecodedImagePreview
          key={JSON.stringify([target.id, target.revision, previewKind])}
          target={target}
          kind="live_photo"
          loadPreviewURL={loadPreviewURL}
          loadImagePreview={loadImagePreview}
          fallback={fallback}
          imageFit={imageFit}
          minHeight={minHeight}
          mediaTransform={mediaTransform}
        >
          {(still, ready) => (
            <XDriveLivePhotoSurface
              still={still}
              stillReady={ready}
              loadMotion={livePhotoMotionLoader}
              sourceKey={`${target.id}:${target.revision ?? ''}`}
              label={target.name ? `${target.name} 实况照片` : '实况照片'}
            />
          )}
        </XDriveDecodedImagePreview>
      )
    }
    if (target && previewKind === 'image') {
      return (
        <Box
          ref={imageViewportRef}
          data-xdrive-preview-zoom={interactiveImage || undefined}
          data-xdrive-preview-scale={interactiveImage ? imageScale : undefined}
          data-xdrive-preview-offset-x={interactiveImage ? imageOffset.x : undefined}
          data-xdrive-preview-offset-y={interactiveImage ? imageOffset.y : undefined}
          data-xdrive-preview-pinch={interactiveImage || undefined}
          data-xdrive-preview-swipe={interactiveImage && Boolean(onSwipePrevious || onSwipeNext) || undefined}
          onWheel={handleImageWheel}
          onDoubleClick={(event) => {
            if (!interactiveImage || Date.now() - touchDoubleTapAtRef.current < 500) return
            setImageZoomAt(
              imageScale > 1 ? 1 : 2,
              { x: event.clientX, y: event.clientY },
            )
          }}
          onPointerDown={handleImagePointerDown}
          onPointerMove={handleImagePointerMove}
          onPointerUp={handleImagePointerRelease}
          onPointerCancel={handleImagePointerCancel}
          onLostPointerCapture={handleImagePointerLostCapture}
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            touchAction: interactiveImage ? 'none' : 'auto',
            cursor: interactiveImage
              ? imageScale > 1 ? 'grab' : 'zoom-in'
              : 'default',
          }}
        >
          <XDriveDecodedImagePreview
            key={JSON.stringify([target.id, target.revision, previewKind])}
            target={target}
            kind="image"
            loadPreviewURL={loadPreviewURL}
            loadImagePreview={loadImagePreview}
            fallback={fallback}
            imageFit={imageFit}
            minHeight={minHeight}
            mediaTransform={mediaTransform}
            onReadySize={handleImageReadySize}
            viewportTransform={`translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale})`}
            viewportTransition={imageDragRef.current ? 'none' : 'transform 100ms ease-out'}
          />
          {interactiveImage && !coarsePointer ? (
            <Stack
              direction="row"
              spacing={0.25}
              alignItems="center"
              data-xdrive-preview-zoom-controls
              onPointerDown={(event) => event.stopPropagation()}
              sx={{
                position: 'absolute',
                right: 12,
                bottom: 12,
                px: 0.5,
                py: 0.25,
                borderRadius: 2,
                bgcolor: 'rgba(0,0,0,.68)',
                color: '#fff',
              }}
            >
              <Tooltip title="缩小">
                <span>
                  <IconButton
                    size="small"
                    aria-label="缩小预览"
                    disabled={imageScale <= 1}
                    onClick={() => setImageZoomAt(imageScale / 1.25)}
                    sx={{ color: 'inherit' }}
                  >
                    <ZoomOutRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'center' }}>
                {Math.round(imageScale * 100)}%
              </Typography>
              <Tooltip title="放大">
                <span>
                  <IconButton
                    size="small"
                    aria-label="放大预览"
                    disabled={imageScale >= 6}
                    onClick={() => setImageZoomAt(imageScale * 1.25)}
                    sx={{ color: 'inherit' }}
                  >
                    <ZoomInRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="适合窗口">
                <IconButton
                  size="small"
                  aria-label="适合窗口"
                  onClick={resetImageViewport}
                  sx={{ color: 'inherit' }}
                >
                  <CenterFocusStrongRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : null}
        </Box>
      )
    }
    if (loading) {
      return (
        <Box sx={{ minHeight: 96, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={26} />
        </Box>
      )
    }
    if (failed) return fallback
    if (previewKind === 'text' && textPreview) {
      return (
        <Stack spacing={0.5} sx={{ width: '100%', minWidth: 0, minHeight: 0, p: 1, alignSelf: 'stretch' }}>
          <Box
            component="pre"
            sx={{
              m: 0,
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
              fontSize: 11,
              lineHeight: 1.45,
              color: 'text.primary',
              userSelect: 'text',
            }}
          >
            {textPreview.text || '（空文件）'}
          </Box>
          {textPreview.truncated ? (
            <Typography variant="caption" color="text.secondary">仅显示前 1 MiB</Typography>
          ) : null}
        </Stack>
      )
    }
    if (!previewURL) return fallback
    if (previewKind === 'video') {
      return (
        <Box data-xdrive-preview-media-state="video" sx={{ position: 'relative', width: '100%', height: '100%', minHeight }}>
          {mediaTransform ? (
            <XDriveTransformedVideoPreview
              key={`${target?.id}:${target?.revision ?? ''}:${previewURL}`}
              src={previewURL}
              transform={mediaTransform}
              onReady={markMediaReady}
              onWaiting={markMediaWaiting}
              onError={markMediaFailed}
            />
          ) : (
            <Box
              key={`${target?.id}:${target?.revision ?? ''}:${previewURL}`}
              component="video"
              src={previewURL}
              controls
              playsInline
              preload="metadata"
              onLoadedData={markMediaReady}
              onCanPlay={markMediaReady}
              onPlaying={markMediaReady}
              onWaiting={markMediaWaiting}
              onError={markMediaFailed}
              sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', bgcolor: 'black' }}
            />
          )}
          {mediaLoadingOverlay}
        </Box>
      )
    }
    if (previewKind === 'audio') {
      return (
        <Box data-xdrive-preview-media-state="audio" sx={{ position: 'relative', width: '100%', px: 1.5, display: 'flex', alignItems: 'center' }}>
          <Box
            key={`${target?.id}:${target?.revision ?? ''}:${previewURL}`}
            component="audio"
            src={previewURL}
            controls
            preload="metadata"
            onLoadedMetadata={markMediaReady}
            onCanPlay={markMediaReady}
            onPlaying={markMediaReady}
            onWaiting={markMediaWaiting}
            onError={markMediaFailed}
            sx={{ width: '100%' }}
          />
          {mediaLoadingOverlay}
        </Box>
      )
    }
    if (previewKind === 'pdf') {
      return (
        <Box data-xdrive-preview-media-state="pdf" sx={{ position: 'relative', width: '100%', height: '100%', minHeight }}>
          <Box
            key={`${target?.id}:${target?.revision ?? ''}:${previewURL}`}
            component="iframe"
            src={previewURL}
            title={target?.name || 'PDF 预览'}
            onLoad={markMediaReady}
            onError={markMediaFailed}
            sx={{ width: '100%', height: '100%', border: 0, bgcolor: 'background.paper' }}
          />
          {mediaLoadingOverlay}
        </Box>
      )
    }
    return fallback
  })()

  return (
    <Box
      data-xdrive-file-preview-kind={previewKind}
      aria-busy={loading || mediaPending || undefined}
      sx={{
        width: '100%',
        minWidth: 0,
        minHeight,
        maxHeight,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {body}
    </Box>
  )
}
