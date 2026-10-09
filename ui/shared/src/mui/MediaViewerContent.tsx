import { useCallback, useMemo } from 'react'
import type { MediaItem } from '../models'
import { xDriveClassifyFilePreview } from '../file-preview'
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
  loadLivePhotoMotion,
  loadPreviewURL,
  interactiveImage = true,
  onSwipePrevious,
  onSwipeNext,
  minHeight = 320,
  maxHeight = 760,
}: {
  item: MediaItem
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadPreviewURL?: MediaPreviewURLLoader
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

  const loadOpenPreview = useCallback<XDriveFilePreviewURLLoader>(async (_target, kind) => {
    if (
      !loadPreviewURL ||
      (kind !== 'image' && kind !== 'video' && kind !== 'live_photo')
    ) return null
    return loadPreviewURL(item.node.id, kind)
  }, [item.node.id, loadPreviewURL])

  const loadOpenThumbnail = useCallback<XDriveFilePreviewImageLoader>(async () => {
    if (!item.metadata.has_thumbnail) return null
    return loadThumbnail(item.node.id)
  }, [item.metadata.has_thumbnail, item.node.id, loadThumbnail])

  const loadOpenLivePhotoMotion = useCallback((
    onProgress?: Parameters<MediaMotionLoader>[1],
  ) => {
    if (!loadLivePhotoMotion) return Promise.resolve(null)
    return loadLivePhotoMotion(item.node.id, onProgress)
  }, [item.node.id, loadLivePhotoMotion])

  const previewKind = xDriveClassifyFilePreview(target)
  const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
  const mediaTransform = xDriveMediaEditPreviewTransform(item.edit_recipe)
  const fallback = xDriveMediaFallback(item.metadata.media_kind)
  const loadSurfaceLivePhotoMotion = useCallback((
    _target: typeof target,
    onProgress?: Parameters<MediaMotionLoader>[1],
  ) => loadOpenLivePhotoMotion(onProgress), [loadOpenLivePhotoMotion])

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
        still={(
          <XDriveFilePreviewSurface
            target={target}
            loadPreviewURL={loadOpenPreview}
            loadImagePreview={loadOpenThumbnail}
            fallback={fallback}
            minHeight={minHeight}
            maxHeight={maxHeight}
            mediaTransform={mediaTransform}
            onPresentationStateChange={presentation.onPresentationStateChange}
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
    />
  )
}
