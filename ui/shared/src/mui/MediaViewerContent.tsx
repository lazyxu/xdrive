import { useCallback, useMemo } from 'react'
import type { MediaItem } from '../models'
import { xDriveClassifyFilePreview } from '../file-preview'
import type { XDriveFilePreviewPresentationState } from '../file-preview'
import { xDriveMediaEditPreviewTransform } from '../media-edit'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type {
  XDriveFilePreviewImageLoader,
  XDriveFilePreviewURLLoader,
} from './FilePreviewSurface'
import { XDriveLivePhotoSurface } from './LivePhotoSurface'
import { useXDrivePreviewPresentation } from './usePreviewSlideshow'
import { xDriveMediaFallback } from './MediaGalleryPreviewMedia'
import type {
  MediaMotionLoader,
  MediaPreviewURLLoader,
  MediaThumbnailLoader,
} from './MediaGallery'

export function XDriveMediaViewerContent({
  item,
  loadThumbnail,
  loadBorrowedThumbnail,
  loadLivePhotoMotion,
  loadPreviewURL,
  onPresentationStateChange,
  videoControlsSafeArea,
  interactiveImage = true,
  onSwipePrevious,
  onSwipeNext,
  minHeight = 320,
  maxHeight = 760,
}: {
  item: MediaItem
  loadThumbnail: MediaThumbnailLoader
  /** Gallery may borrow a currently cached Blob; routed Web uses transport. */
  loadBorrowedThumbnail?: XDriveFilePreviewImageLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
  onPresentationStateChange?: (state: XDriveFilePreviewPresentationState) => void
  videoControlsSafeArea?: 'actions' | 'actions-filmstrip'
  interactiveImage?: boolean
  onSwipePrevious?: () => void
  onSwipeNext?: () => void
  minHeight?: number
  maxHeight?: number | string
}) {
  const target = useMemo(() => ({
    id: item.node.id,
    name: item.node.name,
    kind: 'file' as const,
    mimeType: item.metadata.mime_type,
    size: item.node.size,
    revision: item.node.revision,
  }), [
    item.node.id,
    item.node.name,
    item.node.revision,
    item.node.size,
    item.metadata.mime_type,
  ])
  const presentation = useXDrivePreviewPresentation(target)
  const reportPresentation = useCallback((state: XDriveFilePreviewPresentationState) => {
    // Shared Live Photo still readiness also controls hold-to-play admission.
    presentation.onPresentationStateChange(state)
    onPresentationStateChange?.(state)
  }, [onPresentationStateChange, presentation.onPresentationStateChange])

  const loadOpenPreview = useCallback<XDriveFilePreviewURLLoader>(async (_target, kind, signal, onProgress) => {
    if (
      !loadPreviewURL ||
      (kind !== 'image' && kind !== 'video' && kind !== 'live_photo')
    ) return null
    return loadPreviewURL(item.node.id, kind, signal, item.node.name, item.node.revision, onProgress)
  }, [item.node.id, item.node.name, item.node.revision, loadPreviewURL])

  const loadOpenThumbnail = useCallback<XDriveFilePreviewImageLoader>(async (_target, signal, onProgress) => {
    if (!item.metadata.has_thumbnail) return null
    if (loadBorrowedThumbnail) return loadBorrowedThumbnail(_target, signal, onProgress)
    return loadThumbnail(item.node.id, signal, item.node.revision, onProgress)
  }, [item.metadata.has_thumbnail, item.node.id, item.node.revision, loadThumbnail, loadBorrowedThumbnail])

  const loadOpenLivePhotoMotion = useCallback((
    onProgress?: Parameters<MediaMotionLoader>[1],
    signal?: AbortSignal,
  ) => {
    if (!loadLivePhotoMotion || signal?.aborted) return Promise.resolve(null)
    return loadLivePhotoMotion(item.node.id, onProgress, signal)
  }, [item.node.id, loadLivePhotoMotion])

  const previewKind = xDriveClassifyFilePreview(target)
  const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
  const mediaTransform = xDriveMediaEditPreviewTransform(item.edit_recipe)
  const fallback = xDriveMediaFallback(item.metadata.media_kind)
  const loadSurfaceLivePhotoMotion = useCallback((
    _target: typeof target,
    onProgress?: Parameters<MediaMotionLoader>[1],
    signal?: AbortSignal,
  ) => loadOpenLivePhotoMotion(onProgress, signal), [loadOpenLivePhotoMotion])

  // A .livp container already has native Live Photo semantics in Preview Engine.
  // Only image+motion semantic pairs need the outer shared Live Photo composition.
  if (previewKind === 'live_photo') {
    return (
      <XDriveFilePreviewSurface
        target={target}
        loadPreviewURL={loadOpenPreview}
        loadImagePreview={loadOpenThumbnail}
        loadLivePhotoMotion={loadSurfaceLivePhotoMotion}
        fallback={fallback}
        minHeight={minHeight}
        maxHeight={maxHeight}
        mediaTransform={mediaTransform}
        onPresentationStateChange={reportPresentation}
        interactiveImage={interactiveImage}
        onSwipePrevious={onSwipePrevious}
        onSwipeNext={onSwipeNext}
      />
    )
  }

  if (livePhoto && loadLivePhotoMotion) {
    return (
      <XDriveLivePhotoSurface
        key={item.node.id}
        label={item.node.name}
        stillReady={presentation.presentationState === 'ready'}
        loadMotion={loadOpenLivePhotoMotion}
        sourceKey={`${item.node.id}:${item.node.revision}`}
        onSwipePrevious={interactiveImage ? onSwipePrevious : undefined}
        onSwipeNext={interactiveImage ? onSwipeNext : undefined}
        deferTouchHold={interactiveImage}
        interactiveImage={interactiveImage}
        still={(
          <XDriveFilePreviewSurface
            target={target}
            loadPreviewURL={loadOpenPreview}
            loadImagePreview={loadOpenThumbnail}
            fallback={fallback}
            minHeight={minHeight}
            maxHeight={maxHeight}
            mediaTransform={mediaTransform}
            onPresentationStateChange={reportPresentation}
          />
        )}
      />
    )
  }

  return (
    <XDriveFilePreviewSurface
      target={target}
      loadPreviewURL={loadOpenPreview}
      loadImagePreview={loadOpenThumbnail}
      fallback={fallback}
      minHeight={minHeight}
      maxHeight={maxHeight}
      interactiveImage={interactiveImage}
      onSwipePrevious={onSwipePrevious}
      onSwipeNext={onSwipeNext}
      mediaTransform={mediaTransform}
      videoControlsSafeArea={videoControlsSafeArea}
      onPresentationStateChange={reportPresentation}
    />
  )
}
