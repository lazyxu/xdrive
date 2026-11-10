import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { MediaItem, MediaTimelineGroupIndex } from '../models'
import { photoContentIdentity } from '../photo-content-identity'
import { XDRIVE_MEDIA_GALLERY_GRID_GAP } from './MediaGalleryVirtualGrid'
import {
  XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP,
  xDriveMediaGalleryTimelineIndexVisible,
  xDriveMediaGalleryTimelineLayout,
  xDriveMediaGalleryTimelineWindow,
} from './MediaGalleryVirtualTimeline'
import type { MediaThumbnailLoader, MediaPreviewURLLoader, MediaVideoPosterSaver } from './MediaGallery'
import type { XDriveMediaThumbnailScheduler, XDriveMediaThumbnailPriority } from './MediaGalleryThumbnailScheduler'
import {
  MediaTile, mediaGalleryScrollParent, scrollMediaGalleryHostToOffset,
} from './MediaGallerySharedTiles'
import type {
  MediaSelectionModifiers, MediaGalleryReturnViewport, XDriveMediaGalleryVirtualCollection,
} from './MediaGallerySharedTiles'

// Shared with the full Gallery and Owner-signed Places Drawer. The dated
// grouping index is produced by the exact scoped Server Gallery Range, not by
// sorting a sparse 48-item window or trusting any third-party SDK.
function mediaGalleryTimelineOffsetForIndex(
  layout: ReturnType<typeof xDriveMediaGalleryTimelineLayout>,
  logicalIndex: number,
) {
  const index = Math.max(0, Math.trunc(logicalIndex))
  const group = layout.groups.find((candidate) => (
    index >= candidate.startIndex &&
    index < candidate.startIndex + candidate.itemCount
  ))
  if (!group) return null
  const row = Math.floor((index - group.startIndex) / Math.max(1, layout.columns))
  return group.itemsTop + row * layout.rowStep
}

function sameMediaTimelineWindow(
  left: ReturnType<typeof xDriveMediaGalleryTimelineWindow>,
  right: ReturnType<typeof xDriveMediaGalleryTimelineWindow>,
) {
  if (
    left.startIndex !== right.startIndex ||
    left.endIndex !== right.endIndex ||
    left.segments.length !== right.segments.length
  ) return false
  return left.segments.every((segment, index) => {
    const other = right.segments[index]
    return Boolean(other) &&
      segment.groupIndex === other.groupIndex &&
      segment.startRow === other.startRow &&
      segment.endRow === other.endRow &&
      segment.startIndex === other.startIndex &&
      segment.endIndex === other.endIndex
  })
}

export function XDriveMediaGalleryVirtualTimeline({
  groups,
  collection,
  placesDrawer = false,
  minTileWidth,
  minColumns,
  referenceColumnWidth,
  baselineColumns,
  loadThumbnail,
  thumbnailScheduler,
  loadPreviewURL,
  saveVideoPoster,
  onSetFavorite,
  onSetCover,
  selectionMode,
  selectedContentKeys,
  onSelect,
  onOpen,
  onPreview,
  onToggleFavorite,
  restoreAnchorIndex,
  restoreAnchorRevision = 0,
  restoreAnchorViewportOffset,
  returnViewport,
  onVisibleAnchorChange,
}: {
  groups: MediaTimelineGroupIndex[]
  collection: XDriveMediaGalleryVirtualCollection
  placesDrawer?: boolean
  minTileWidth: number
  minColumns?: number
  referenceColumnWidth?: number
  baselineColumns?: number
  selectionMode: boolean
  selectedContentKeys: ReadonlySet<string>
  onSelect: (item: MediaItem, index: number, modifiers: MediaSelectionModifiers) => void
  loadThumbnail: MediaThumbnailLoader
  thumbnailScheduler: XDriveMediaThumbnailScheduler
  loadPreviewURL?: MediaPreviewURLLoader
  saveVideoPoster?: MediaVideoPosterSaver
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem, index: number) => void
  onToggleFavorite: (item: MediaItem) => void
  restoreAnchorIndex?: number
  restoreAnchorRevision?: number
  restoreAnchorViewportOffset?: number
  returnViewport?: MediaGalleryReturnViewport
  onVisibleAnchorChange?: (index: number) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [state, setState] = useState(() => {
    // Use the same pre-paint scroll snapshot for Year/Month/Day as for All.
    const layout = xDriveMediaGalleryTimelineLayout({
      width: returnViewport?.width ?? 0,
      groups,
      minColumnWidth: minTileWidth,
      minColumns,
      referenceColumnWidth,
      baselineColumns,
    })
    const visibleTop = returnViewport?.visibleTop ?? 0
    const visibleBottom = visibleTop + (returnViewport?.viewportHeight ?? 0)
    const window = xDriveMediaGalleryTimelineWindow({ layout, visibleTop, visibleBottom })
    const visibleWindow = returnViewport
      ? xDriveMediaGalleryTimelineWindow({ layout, visibleTop, visibleBottom, overscanRows: 0 })
      : window
    return { layout, window, visibleWindow }
  })

  useLayoutEffect(() => {
    if (!returnViewport || !hostRef.current) return
    const owner = mediaGalleryScrollParent(hostRef.current)
    if (owner) owner.scrollTop = returnViewport.scrollTop
  }, [returnViewport])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scrollParent = mediaGalleryScrollParent(host)
    const scrollTarget: HTMLElement | Window = scrollParent ?? window
    let disposed = false

    // First geometry is measured synchronously before paint, just like
    // MediaVirtualTileGrid. Later scroll/resize work remains rAF-coalesced.
    const measure = () => {
        if (disposed || !hostRef.current) return
        const currentHost = hostRef.current
        const layout = xDriveMediaGalleryTimelineLayout({
          width: currentHost.clientWidth,
          groups,
          minColumnWidth: minTileWidth,
        minColumns,
        referenceColumnWidth,
        baselineColumns,
        })
        const hostRect = currentHost.getBoundingClientRect()
        const viewportTop = scrollParent
          ? scrollParent.getBoundingClientRect().top
          : 0
        const viewportBottom = scrollParent
          ? scrollParent.getBoundingClientRect().bottom
          : window.innerHeight
        const visibleTop = Math.max(0, viewportTop - hostRect.top)
        const visibleBottom = Math.min(
          layout.totalHeight,
          Math.max(visibleTop, viewportBottom - hostRect.top),
        )
        const visibleWindow = xDriveMediaGalleryTimelineWindow({
          layout,
          visibleTop,
          visibleBottom,
          overscanRows: 0,
        })
        const nextWindow = xDriveMediaGalleryTimelineWindow({
          layout,
          visibleTop,
          visibleBottom,
        })
        if (visibleWindow.endIndex > visibleWindow.startIndex) {
          onVisibleAnchorChange?.(visibleWindow.startIndex)
        } else if (nextWindow.endIndex > nextWindow.startIndex) {
          onVisibleAnchorChange?.(nextWindow.startIndex)
        }
        setState((current) => (
          current.layout.columns === layout.columns &&
          Math.abs(current.layout.totalHeight - layout.totalHeight) < 0.5 &&
          sameMediaTimelineWindow(current.window, nextWindow) &&
          sameMediaTimelineWindow(current.visibleWindow, visibleWindow)
            ? current
            : { layout, window: nextWindow, visibleWindow }
        ))
        if (nextWindow.endIndex > nextWindow.startIndex) {
          void collection.onRangeChange(
            nextWindow.startIndex,
            nextWindow.endIndex - 1,
          )
        }
    }
    const update = () => {
      if (disposed) return
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        measure()
      })
    }

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(host)
    scrollTarget.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    measure()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      scrollTarget.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [collection.onRangeChange, groups, minTileWidth, minColumns, referenceColumnWidth, baselineColumns, onVisibleAnchorChange])

  // A restore revision is a one-shot navigation/gesture intent. Re-rendering
  // the existing sparse wall for pending metadata, loading badges or a newly
  // observed visible row must not replay an old scroll-to-anchor command.
  const restoredAnchorRevisionRef = useRef(0)
  useLayoutEffect(() => {
    if (returnViewport || restoreAnchorRevision <= 0 ||
        restoreAnchorIndex === undefined ||
        restoredAnchorRevisionRef.current === restoreAnchorRevision) return
    const host = hostRef.current
    if (!host) return
    const layout = xDriveMediaGalleryTimelineLayout({
      width: host.clientWidth,
      groups,
      minColumnWidth: minTileWidth,
        minColumns,
        referenceColumnWidth,
        baselineColumns,
    })
    const offset = mediaGalleryTimelineOffsetForIndex(layout, restoreAnchorIndex)
    if (offset === null) return
    // Wait for the new row/total-height layout before restoring the position
    // of a pinched tile. A later unrelated render may change the visible
    // index (or layout metrics), but must not replay this revision's restore.
    restoredAnchorRevisionRef.current = restoreAnchorRevision
    let restored = false
    let afterLayout: number | null = null
    const applyRestore = () => {
      if (!hostRef.current) return
      scrollMediaGalleryHostToOffset(
        hostRef.current, offset, restoreAnchorViewportOffset ?? 0,
      )
      restored = true
    }
    const frame = window.requestAnimationFrame(() => {
      if (restoreAnchorViewportOffset === undefined) applyRestore()
      else afterLayout = window.requestAnimationFrame(applyRestore)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (afterLayout !== null) window.cancelAnimationFrame(afterLayout)
      // StrictMode may clean up the initial scheduled frame before it paints.
      // Only a genuinely completed restore consumes the revision.
      if (!restored && restoredAnchorRevisionRef.current === restoreAnchorRevision) {
        restoredAnchorRevisionRef.current = 0
      }
    }
  }, [
    groups,
    minTileWidth,
    minColumns,
    referenceColumnWidth,
    baselineColumns,
    restoreAnchorIndex,
    restoreAnchorRevision,
    restoreAnchorViewportOffset,
    returnViewport,
  ])

  useEffect(() => {
    const retainedNodeIDs: number[] = []
    for (const segment of state.window.segments) {
      for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
        const item = collection.itemAt(index)
        if (item?.metadata.has_thumbnail) retainedNodeIDs.push(item.node.id)
      }
    }
    thumbnailScheduler.setRetention(retainedNodeIDs)
  }, [
    collection.itemAt,
    collection.loadedItems,
    state.window,
    thumbnailScheduler,
  ])

  useEffect(() => () => {
    thumbnailScheduler.setRetention([])
  }, [thumbnailScheduler])

  return (
    <Box
      ref={hostRef}
      data-xdrive-media-gallery-virtual-timeline
      sx={{
        position: 'relative',
        height: state.layout.totalHeight,
        minHeight: collection.itemCount > 0 ? 150 : 0,
      }}
    >
      {state.window.segments.map((segment) => {
        const group = state.layout.groups[segment.groupIndex]
        if (!group) return null
        const slots = []
        for (let index = segment.startIndex; index < segment.endIndex; index += 1) {
          const item = collection.itemAt(index)
          const thumbnailPriority: XDriveMediaThumbnailPriority =
            xDriveMediaGalleryTimelineIndexVisible(index, state.visibleWindow)
              ? 0
              : 1
          slots.push(
            item ? (
              <MediaTile
                placesDrawer={placesDrawer}
                key={photoContentIdentity(item)}
                item={item}
                logicalIndex={index}
                selectionMode={selectionMode}
                selectedForAction={selectedContentKeys.has(photoContentIdentity(item))}
                onSelect={onSelect}
                loadThumbnail={loadThumbnail}
                thumbnailScheduler={thumbnailScheduler}
                thumbnailPriority={thumbnailPriority}
                loadPreviewURL={loadPreviewURL}
                saveVideoPoster={saveVideoPoster}
                onSetFavorite={onSetFavorite}
                onSetCover={onSetCover}
                onOpen={onOpen}
                onPreview={(value) => onPreview(value, index)}
                onToggleFavorite={onToggleFavorite}
              />
            ) : (
              <Paper
                key={`media-timeline-placeholder-${index}`}
                variant="outlined"
                aria-hidden
                data-xdrive-media-gallery-timeline-placeholder
                sx={{
                  aspectRatio: '1 / 1',
                  bgcolor: 'action.hover',
                  border: 0,
                  borderRadius: 0,
                  opacity: 0.55,
                }}
              />
            ),
          )
        }

        return (
          <Box
            key={group.key}
            sx={{
              position: 'absolute',
              top: group.top,
              insetInline: 0,
              height: group.height,
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="baseline"
              data-xdrive-gallery-sticky-date
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                height: group.headerHeight,
                mb: `${XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP}px`,
                bgcolor: 'background.paper',
              }}
            >
              <Typography variant="subtitle1" fontWeight={700}>
                {group.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {group.itemCount.toLocaleString('zh-CN')} 项
              </Typography>
            </Stack>
            {segment.endIndex > segment.startIndex ? (
              <Box
                sx={{
                  position: 'absolute',
                  top:
                    group.headerHeight +
                    XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP +
                    segment.startRow * state.layout.rowStep,
                  insetInline: 0,
                  display: 'grid',
                  gridTemplateColumns:
                    `repeat(${state.layout.columns}, minmax(0, 1fr))`,
                  gap: `${XDRIVE_MEDIA_GALLERY_GRID_GAP}px`,
                }}
              >
                {slots}
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

