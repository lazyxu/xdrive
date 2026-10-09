import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent, SyntheticEvent } from 'react'
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
  XDriveFilePreviewPresentationState,
  XDriveFilePreviewTarget,
  XDriveFileTextPreview,
  XDriveLivePhotoMotionSource,
} from '../file-preview'
import { xDriveAnchorPreviewZoom, xDriveClampPreviewViewport } from '../file-preview-viewport'
import type { XDrivePreviewImageDimensions, XDrivePreviewPoint, XDrivePreviewViewport } from '../file-preview-viewport'
import { XDriveLivePhotoSurface } from './LivePhotoSurface'
import { XDriveMediaLoadingProgress } from './MediaLoadProgress'
import { XDriveDecodedImagePreview } from './FilePreviewImage'
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
  signal?: AbortSignal,
  onProgress?: XDriveByteProgressHandler,
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
  onPresentationStateChange?: (state: XDriveFilePreviewPresentationState) => void
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
  onPresentationStateChange,
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
  const [bufferProgress, setBufferProgress] = useState<{ bufferedSeconds: number; durationSeconds?: number }>({ bufferedSeconds: 0 })
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
  const presentationCallbackRef = useRef(onPresentationStateChange)
  presentationCallbackRef.current = onPresentationStateChange
  const sourceIdentity = JSON.stringify([target?.id, target?.revision, previewKind])
  const currentSourceIdentityRef = useRef(sourceIdentity)
  currentSourceIdentityRef.current = sourceIdentity
  const acquiredIdentityRef = useRef('')
  const coarsePointer = useMediaQuery('(pointer: coarse)')
  const imageViewportElementRef = useRef<HTMLElement | null>(null)
  const imageDimensionsRef = useRef<XDrivePreviewImageDimensions | null>(null)
  const imageViewportSizeRef = useRef({ width: 0, height: 0 })
  const imageViewportRef = useRef<XDrivePreviewViewport>({ scale: 1, offset: { x: 0, y: 0 } })
  const imageDragRef = useRef<{
    pointerID: number; startX: number; startY: number; originX: number; originY: number
  } | null>(null)
  const imagePointersRef = useRef(new Map<number, { x: number; y: number }>())
  const imagePinchRef = useRef<{
    distance: number; scale: number; midpoint: XDrivePreviewPoint; offset: XDrivePreviewPoint
  } | null>(null)
  const imageSwipeRef = useRef<{
    pointerID: number; startX: number; startY: number; startedAt: number
  } | null>(null)
  const imageTapRef = useRef<{
    pointerID: number; startX: number; startY: number; startedAt: number; moved: boolean
  } | null>(null)
  const lastTouchTapRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const touchDoubleTapAtRef = useRef(0)
  const [imageScale, setImageScale] = useState(1)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })

  const applyImageViewport = useCallback((value: XDrivePreviewViewport) => {
    const next = xDriveClampPreviewViewport(value, imageViewportSizeRef.current, imageDimensionsRef.current, imageFit)
    imageViewportRef.current = next
    setImageScale(next.scale)
    setImageOffset((current) => current.x === next.offset.x && current.y === next.offset.y ? current : next.offset)
  }, [imageFit])

  const measureImageViewport = useCallback((element = imageViewportElementRef.current) => {
    if (!element) return
    const bounds = element.getBoundingClientRect()
    imageViewportSizeRef.current = { width: bounds.width, height: bounds.height }
  }, [])
  const imageAnchor = useCallback((element: HTMLElement, clientX: number, clientY: number) => {
    measureImageViewport(element)
    const bounds = element.getBoundingClientRect()
    return { x: clientX - bounds.left - bounds.width / 2, y: clientY - bounds.top - bounds.height / 2 }
  }, [measureImageViewport])

  const resetImageViewport = useCallback(() => {
    imageDragRef.current = null
    imagePointersRef.current.clear()
    imagePinchRef.current = null
    imageSwipeRef.current = null
    imageTapRef.current = null
    lastTouchTapRef.current = null
    imageViewportRef.current = { scale: 1, offset: { x: 0, y: 0 } }
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
  }, [])

  const setImageZoom = useCallback((value: number, anchor: XDrivePreviewPoint = { x: 0, y: 0 }) => {
    const next = Math.min(6, Math.max(1, Math.round(value * 100) / 100))
    applyImageViewport(xDriveAnchorPreviewZoom(imageViewportRef.current, next, anchor))
  }, [applyImageViewport])

  useEffect(() => {
    imageDimensionsRef.current = null
    resetImageViewport()
  }, [previewKind, resetImageViewport, target?.id, target?.revision])

  useLayoutEffect(() => {
    const element = imageViewportElementRef.current
    if (!element || !interactiveImage || previewKind !== 'image') return
    const remeasure = () => {
      measureImageViewport(element)
      applyImageViewport(imageViewportRef.current)
    }
    remeasure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure)
    observer?.observe(element)
    if (typeof window !== 'undefined') window.addEventListener('resize', remeasure)
    return () => {
      observer?.disconnect()
      if (typeof window !== 'undefined') window.removeEventListener('resize', remeasure)
    }
  }, [applyImageViewport, interactiveImage, measureImageViewport, previewKind, target?.id, target?.revision])

  const handleImageDimensionsChange = useCallback((dimensions: XDrivePreviewImageDimensions | null) => {
    if (currentSourceIdentityRef.current !== sourceIdentity) return
    imageDimensionsRef.current = dimensions
    measureImageViewport()
    applyImageViewport(imageViewportRef.current)
  }, [applyImageViewport, measureImageViewport, sourceIdentity])
  const handleImagePresentationStateChange = useCallback((state: XDriveFilePreviewPresentationState) => {
    if (currentSourceIdentityRef.current === sourceIdentity) presentationCallbackRef.current?.(state)
  }, [sourceIdentity])

  const captureImagePointer = (event: ReactPointerEvent<HTMLElement>) => {
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Best-effort across browsers and Electron. */ }
  }
  const releaseImagePointer = (event: ReactPointerEvent<HTMLElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    } catch { /* The renderer may already have released pointer capture. */ }
  }

  const handleImagePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!interactiveImage || event.button !== 0) return
    measureImageViewport(event.currentTarget)
    const viewport = imageViewportRef.current
    if (event.pointerType === 'touch') {
      event.preventDefault()
      imagePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      captureImagePointer(event)
      const points = [...imagePointersRef.current.values()]
      if (points.length >= 2) {
        const [first, second] = points
        imagePinchRef.current = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          scale: viewport.scale,
          offset: viewport.offset,
          midpoint: imageAnchor(event.currentTarget, (first.x + second.x) / 2, (first.y + second.y) / 2),
        }
        imageDragRef.current = null
        imageSwipeRef.current = null
        imageTapRef.current = null
        lastTouchTapRef.current = null
        return
      }
      imageTapRef.current = { pointerID: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt: Date.now(), moved: false }
      if (viewport.scale <= 1.01) imageSwipeRef.current = { ...imageTapRef.current }
    }
    if (viewport.scale <= 1) return
    event.preventDefault()
    captureImagePointer(event)
    imageDragRef.current = {
      pointerID: event.pointerId, startX: event.clientX, startY: event.clientY,
      originX: viewport.offset.x, originY: viewport.offset.y,
    }
  }, [imageAnchor, interactiveImage, measureImageViewport])

  const handleImagePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const tap = imageTapRef.current
    if (tap?.pointerID === event.pointerId && Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) >= 12) {
      tap.moved = true
    }
    if (event.pointerType === 'touch' && imagePointersRef.current.has(event.pointerId)) {
      imagePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pinch = imagePinchRef.current
      const points = [...imagePointersRef.current.values()]
      if (pinch && points.length >= 2) {
        event.preventDefault()
        const [first, second] = points
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        const scale = Math.min(6, Math.max(1, Math.round(pinch.scale * distance / pinch.distance * 100) / 100))
        const midpoint = imageAnchor(event.currentTarget, (first.x + second.x) / 2, (first.y + second.y) / 2)
        applyImageViewport(xDriveAnchorPreviewZoom({ scale: pinch.scale, offset: pinch.offset }, scale, pinch.midpoint, midpoint))
        return
      }
    }
    const drag = imageDragRef.current
    if (!drag || drag.pointerID !== event.pointerId) return
    event.preventDefault()
    applyImageViewport({ scale: imageViewportRef.current.scale, offset: {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    } })
  }, [applyImageViewport, imageAnchor])

  const handleImagePointerRelease = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const touch = event.pointerType === 'touch'
    const wasPinching = touch && imagePinchRef.current !== null
    if (touch && imagePointersRef.current.has(event.pointerId)) {
      imagePointersRef.current.delete(event.pointerId)
      if (imagePointersRef.current.size < 2) imagePinchRef.current = null
      const swipe = imageSwipeRef.current
      const tap = imageTapRef.current
      const imageScale = imageViewportRef.current.scale
      if (!wasPinching && swipe?.pointerID === event.pointerId) {
        const dx = event.clientX - swipe.startX
        const dy = event.clientY - swipe.startY
        const absX = Math.abs(dx), absY = Math.abs(dy)
        const elapsed = Date.now() - swipe.startedAt
        const horizontalSwipe = imageScale <= 1.01 && elapsed <= 700 && absX >= 56 && absX > absY * 1.25
        if (horizontalSwipe) {
          lastTouchTapRef.current = null
          if (dx < 0) onSwipeNext?.()
          else onSwipePrevious?.()
        }
      }
      if (!wasPinching && tap?.pointerID === event.pointerId) {
        const moved = tap.moved || Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) >= 12
        const now = Date.now()
        if (!moved && now - tap.startedAt <= 450) {
          const previous = lastTouchTapRef.current
          if (previous && now - previous.at <= 320 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32) {
            lastTouchTapRef.current = null
            touchDoubleTapAtRef.current = now
            setImageZoom(imageScale > 1 ? 1 : 2, imageAnchor(event.currentTarget, event.clientX, event.clientY))
          } else lastTouchTapRef.current = { at: now, x: event.clientX, y: event.clientY }
        } else lastTouchTapRef.current = null
      }
      imageSwipeRef.current = null
      imageTapRef.current = null
      if (wasPinching && imagePointersRef.current.size === 1) {
        const [pointerID, point] = [...imagePointersRef.current.entries()][0]
        const viewport = imageViewportRef.current
        imageDragRef.current = { pointerID, startX: point.x, startY: point.y, originX: viewport.offset.x, originY: viewport.offset.y }
      }
    }
    if (imageDragRef.current?.pointerID === event.pointerId) imageDragRef.current = null
    releaseImagePointer(event)
  }, [imageAnchor, onSwipeNext, onSwipePrevious, setImageZoom])

  const handleImagePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    imagePointersRef.current.delete(event.pointerId)
    if (imagePointersRef.current.size < 2) imagePinchRef.current = null
    if (imageDragRef.current?.pointerID === event.pointerId) imageDragRef.current = null
    imageSwipeRef.current = null
    imageTapRef.current = null
    lastTouchTapRef.current = null
    releaseImagePointer(event)
  }, [])
  const handleImagePointerLostCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // A normal pointerup also loses capture; keep its completed tap for double-tap detection.
    if (imagePointersRef.current.has(event.pointerId) || imageDragRef.current?.pointerID === event.pointerId) {
      handleImagePointerCancel(event)
    }
  }, [handleImagePointerCancel])

  const handleImageWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (!interactiveImage) return
    event.preventDefault()
    const anchor = imageAnchor(event.currentTarget, event.clientX, event.clientY)
    setImageZoom(imageViewportRef.current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), anchor)
  }, [imageAnchor, interactiveImage, setImageZoom])

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
    acquiredIdentityRef.current = currentSourceIdentityRef.current
    const currentTarget = previewTargetRef.current
    const loaders = previewLoadersRef.current
    setTextPreview(null)
    assignPreviewURL('')
    setLoading(false)
    setFailed(false)
    setMediaReady(false)
    setMediaBuffering(false)
    setBufferProgress({ bufferedSeconds: 0 })

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

  const mediaGeneration = previewGenerationRef.current
  const isCurrentMedia = useCallback(() => (
    acquiredIdentityRef.current === sourceIdentity &&
    currentSourceIdentityRef.current === sourceIdentity &&
    previewGenerationRef.current === mediaGeneration
  ), [mediaGeneration, sourceIdentity])
  const markMediaReady = useCallback(() => {
    if (!isCurrentMedia()) return
    setMediaReady(true)
    setMediaBuffering(false)
  }, [isCurrentMedia])
  const markMediaWaiting = useCallback(() => {
    if (isCurrentMedia()) setMediaBuffering(true)
  }, [isCurrentMedia])
  const markMediaFailed = useCallback(() => {
    if (!isCurrentMedia()) return
    setMediaReady(false)
    setMediaBuffering(false)
    setFailed(true)
  }, [isCurrentMedia])
  const updateBuffered = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!isCurrentMedia()) return
    const video = event.currentTarget
    let bufferedSeconds = 0
    for (let i = 0; i < video.buffered.length; i += 1) {
      const start = video.buffered.start(i)
      const end = video.buffered.end(i)
      if (video.currentTime >= start && video.currentTime <= end) {
        bufferedSeconds = Math.max(bufferedSeconds, end)
      }
    }
    setBufferProgress({
      bufferedSeconds,
      durationSeconds: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined,
    })
  }, [isCurrentMedia])
  const mediaPending = Boolean(
    previewURL &&
    (previewKind === 'video' || previewKind === 'audio' || previewKind === 'pdf') &&
    (!mediaReady || mediaBuffering) &&
    !failed
  )
  const presentationState: XDriveFilePreviewPresentationState = acquiredIdentityRef.current !== sourceIdentity
    ? 'loading'
    : failed || previewKind === 'none' ? 'failed'
      : loading || mediaPending ? 'loading'
        : (previewKind === 'text' ? Boolean(textPreview) : Boolean(previewURL && mediaReady)) ? 'ready' : 'failed'
  useEffect(() => {
    if (previewKind === 'image' || previewKind === 'live_photo') return
    presentationCallbackRef.current?.(presentationState)
  }, [presentationState, previewKind, sourceIdentity])

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
      {previewKind === 'video' ? (
        <XDriveMediaLoadingProgress stage="buffering" {...bufferProgress} />
      ) : <CircularProgress size={26} aria-label="正在加载媒体" />}
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
          onPresentationStateChange={handleImagePresentationStateChange}
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
          ref={interactiveImage ? imageViewportElementRef : undefined}
          data-xdrive-preview-zoom={interactiveImage || undefined}
          data-xdrive-preview-pinch={interactiveImage || undefined}
          data-xdrive-preview-swipe={interactiveImage && Boolean(onSwipePrevious || onSwipeNext) || undefined}
          onWheel={handleImageWheel}
          onDoubleClick={(event) => {
            if (!interactiveImage || Date.now() - touchDoubleTapAtRef.current < 500) return
            setImageZoom(imageScale > 1 ? 1 : 2, imageAnchor(event.currentTarget, event.clientX, event.clientY))
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
            onPresentationStateChange={handleImagePresentationStateChange}
            viewportTransform={`translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale})`}
            onImageDimensionsChange={handleImageDimensionsChange}
            viewportTransition={imageDragRef.current || imagePinchRef.current ? 'none' : 'transform 100ms ease-out'}
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
                    onClick={() => setImageZoom(imageScale / 1.25)}
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
                    onClick={() => setImageZoom(imageScale * 1.25)}
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
              onProgress={updateBuffered}
              onLoadedMetadata={updateBuffered}
              onTimeUpdate={updateBuffered}
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
