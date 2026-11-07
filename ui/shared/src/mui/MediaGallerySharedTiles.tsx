import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { Box, Button, Checkbox, Chip, IconButton, Paper, Stack, Tooltip, useMediaQuery } from '@mui/material'
import { Image as ImageIcon, Movie as MovieIcon, Star as StarIcon, StarBorder as StarBorderIcon } from '@mui/icons-material'
import type { MediaItem } from '../models'
import { photoContentIdentity } from '../photo-content-identity'
import { XDriveLivePhotoGlyph } from './LivePhotoSurface'
import { XDriveMediaAsyncThumbnail, XDriveMediaAsyncVideoPoster, xDriveMediaFallback } from './MediaGalleryPreviewMedia'
import { xDriveMediaFormatDuration } from './MediaGalleryUtils'
import { xDriveMediaGalleryAnchorScrollDelta } from './MediaGalleryScrollAnchor'
import { XDRIVE_MEDIA_GALLERY_GRID_GAP, xDriveMediaGalleryGridMetrics, xDriveMediaGalleryGridWindow } from './MediaGalleryVirtualGrid'
import { XDriveMediaThumbnailScheduler } from './MediaGalleryThumbnailScheduler'
import type { XDriveMediaThumbnailPriority } from './MediaGalleryThumbnailScheduler'
import type { MediaThumbnailLoader, MediaPreviewURLLoader, MediaVideoPosterSaver } from './MediaGallery'

/** One canonical tile/virtual-grid implementation for Gallery, Places and their viewers.
 * Media identity, scoped readers, authorization and cancellation are owned by callers.
 */

function mediaAssetChipLabel(item: MediaItem) {
  if (item.metadata.mime_type?.toLowerCase() === 'image/gif') return 'GIF'
  if (item.metadata.exif?.is_panorama === true) return '全景'
  if (item.live_photo || item.asset_kind === 'live_photo') return '实况'
  switch (item.asset_kind) {
    case 'raw_pair':
      return 'RAW'
    case 'burst':
      return '连拍'
    case 'sidecar':
      return '组合'
    default:
      if (item.metadata.media_kind === 'video') {
        return item.metadata.duration_ms
          ? xDriveMediaFormatDuration(item.metadata.duration_ms)
          : '视频'
      }
      return null
  }
}


export type XDriveMediaGalleryVirtualCollection = {
  itemCount: number
  loadedItems: ReadonlyMap<number, MediaItem>
  itemAt: (index: number) => MediaItem | undefined
  onRangeChange: (startIndex: number, endIndex: number) => void | Promise<void>
}


export function scrollMediaGalleryHostToOffset(host: HTMLElement, offset: number, anchorViewportTop = 0) {
  const scrollParent = mediaGalleryScrollParent(host)
  const hostRect = host.getBoundingClientRect()
  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect()
    scrollParent.scrollTop += xDriveMediaGalleryAnchorScrollDelta({
      hostTop: hostRect.top,
      scrollViewportTop: parentRect.top,
      logicalRowTop: offset,
      anchorViewportTop,
    })
    return
  }
  window.scrollBy({
    top: xDriveMediaGalleryAnchorScrollDelta({
      hostTop: hostRect.top,
      scrollViewportTop: 0,
      logicalRowTop: offset,
      anchorViewportTop,
    }),
    behavior: 'auto',
  })
}


export function keyboardActivate(
  event: KeyboardEvent<HTMLElement>,
  action: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

export type MediaSelectionModifiers = {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

type MediaTileProps = {
  item: MediaItem
  logicalIndex: number
  /** The trusted Places drawer uses the exact Gallery tile, not a second photo-card renderer. */
  placesDrawer?: boolean
  selectionMode: boolean
  selectedForAction: boolean
  recommendedForCleanup?: boolean
  onSelect: (
    item: MediaItem,
    index: number,
    modifiers: MediaSelectionModifiers,
  ) => void
  loadThumbnail: MediaThumbnailLoader
  thumbnailScheduler?: XDriveMediaThumbnailScheduler
  thumbnailPriority?: XDriveMediaThumbnailPriority
  loadPreviewURL?: MediaPreviewURLLoader
  saveVideoPoster?: MediaVideoPosterSaver
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem) => void
  onToggleFavorite: (item: MediaItem) => void
}

export function MediaTile({
  item,
  logicalIndex,
  placesDrawer = false,
  selectionMode,
  selectedForAction,
  recommendedForCleanup = false,
  onSelect,
  loadThumbnail,
  thumbnailScheduler,
  thumbnailPriority = 1,
  loadPreviewURL,
  saveVideoPoster,
  onSetFavorite,
  onSetCover,
  onPreview,
  onToggleFavorite,
}: MediaTileProps) {
  const video = item.metadata.media_kind === 'video'
  const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
  const mediaBadgeLabel = mediaAssetChipLabel(item)
  // Only an actual loaded still earns a visible Live badge. Keep the media
  // identity on the focusable tile even if its thumbnail is unavailable.
  // Include revision so a recycled/updated tile never shows a stale glyph.
  const thumbnailIdentity = `${item.node.id}:${item.node.revision}`
  const [readyThumbnailIdentity, setReadyThumbnailIdentity] = useState('')
  const onThumbnailReadyChange = useCallback((ready: boolean) => {
    setReadyThumbnailIdentity((current) => ready
      ? thumbnailIdentity
      : current === thumbnailIdentity ? '' : current)
  }, [thumbnailIdentity])
  const showMediaBadge = Boolean(mediaBadgeLabel && (
    !livePhoto || readyThumbnailIdentity === thumbnailIdentity
  ))
  const compactTouch = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
  const openPreview = () => onPreview(item)

  const effectiveThumbnailLoader = useCallback(
    (nodeID: number, signal?: AbortSignal, _revision?: number, onProgress?: XDriveByteProgressHandler) => thumbnailScheduler
      ? thumbnailScheduler.load(nodeID, thumbnailPriority, item.node.revision, onProgress, signal)
      : loadThumbnail(nodeID, signal, item.node.revision, onProgress),
    [loadThumbnail, thumbnailPriority, thumbnailScheduler, item.node.revision],
  )
  const onThumbnailDecodeError = useCallback((failedURL: string) => {
    thumbnailScheduler?.invalidateDecodedURL(item.node.id, item.node.revision, failedURL)
  }, [thumbnailScheduler, item.node.id, item.node.revision])

  return (
    <Paper
      variant="outlined"
      {...(placesDrawer ? { component: 'button', type: 'button' as const } : {})}
      data-xdrive-media-tile
      data-xdrive-media-index={logicalIndex}
      data-xdrive-media-node-id={item.node.id}
      data-xdrive-places-photo-drawer-item={placesDrawer ? item.node.id : undefined}
      role="button"
      aria-label={`${item.node.name}，${livePhoto ? '实况照片' : video ? '视频' : '照片'}`}
      tabIndex={0}
      onClick={(event) => {
        if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey) {
          onSelect(item, logicalIndex, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
          return
        }
        // First click already opened Viewer; ignore a double-click's second click.
        if (event.detail > 1) return
        openPreview()
      }}
      onDoubleClick={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (placesDrawer && (event.key === 'Enter' || event.key === ' ')) {
          // A native button can also synthesize click on Enter/Space.
          // Prevent default so the signed Owner Viewer opens only once.
          event.preventDefault()
          onPreview(item)
          return
        }
        if (event.key === ' ' || (selectionMode && event.key === 'Enter')) {
          event.preventDefault()
          onSelect(item, logicalIndex, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          })
          return
        }
        keyboardActivate(event, () => onPreview(item))
      }}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        // Native Places buttons must not inherit browser padding/borders:
        // their thumbnail geometry matches Gallery's exact square tile.
        ...(placesDrawer ? {
          display: 'block', width: '100%', p: 0, appearance: 'none' as const,
          textAlign: 'left' as const, touchAction: 'manipulation',
        } : {}),
        aspectRatio: '1 / 1',
        cursor: 'pointer',
        bgcolor: 'action.hover',
        border: 0,
        borderRadius: 0,
        boxShadow: 'none',
        outline: selectedForAction ? '2px solid' : 'none',
        outlineColor: selectedForAction ? 'primary.main' : 'transparent',
        outlineOffset: selectedForAction ? -2 : 0,
        '&:hover .media-favorite, &:focus-within .media-favorite': {
          opacity: 1,
          pointerEvents: 'auto',
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 1,
        },
      }}
    >
      {video && !livePhoto && loadPreviewURL ? (
        <XDriveMediaAsyncVideoPoster
          nodeID={item.node.id}
          revision={item.node.revision}
          alt={item.node.name}
          loadPreviewURL={loadPreviewURL}
          loadThumbnail={loadThumbnail}
          saveVideoPoster={saveVideoPoster}
          rotationDegrees={item.metadata.rotation_degrees}
          sourceWidth={item.metadata.width}
          sourceHeight={item.metadata.height}
          fallback={xDriveMediaFallback(item.metadata.media_kind)}
        />
      ) : (
        <XDriveMediaAsyncThumbnail
          // Map's previous CoverThumbnail attempted the trusted preview
          // even while has_thumbnail metadata lagged the current revision.
          // Preserve that behavior only for authenticated Places tiles.
          nodeID={placesDrawer || item.metadata.has_thumbnail ? item.node.id : undefined}
          revision={item.node.revision}
          alt={item.node.name}
          loadThumbnail={effectiveThumbnailLoader}
          fallback={xDriveMediaFallback(item.metadata.media_kind)}
          revokeOnDispose={!thumbnailScheduler}
          onImageReadyChange={livePhoto ? onThumbnailReadyChange : undefined}
          onImageDecodeError={thumbnailScheduler ? onThumbnailDecodeError : undefined}
        />
      )}
      {(selectionMode || selectedForAction) ? (
        <Checkbox
          size="small"
          checked={selectedForAction}
          aria-label={selectedForAction ? '取消选择' : '选择'}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(item, logicalIndex, {
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
            })
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          sx={{
            position: 'absolute',
            top: 4,
            left: 4,
            zIndex: 3,
            p: compactTouch ? 0 : 0.5,
            width: compactTouch ? 44 : undefined,
            height: compactTouch ? 44 : undefined,
            bgcolor: 'rgba(0,0,0,.58)',
            color: '#fff',
            borderRadius: 1,
            '&.Mui-checked': { color: 'primary.light' },
            '&:hover': { bgcolor: 'rgba(0,0,0,.72)' },
          }}
        />
      ) : null}
      {!compactTouch && onSetFavorite ? (
        <Tooltip title={item.favorite ? '取消收藏' : '收藏'}>
          <IconButton
            className="media-favorite"
            size="small"
            aria-label={item.favorite ? '取消收藏' : '收藏'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite(item)
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            sx={{
              position: 'absolute',
              top: 8,
              left: selectionMode || selectedForAction ? (compactTouch ? 52 : 42) : 8,
              width: compactTouch ? 44 : undefined,
              height: compactTouch ? 44 : undefined,
              opacity: compactTouch || item.favorite ? 1 : 0,
              pointerEvents: compactTouch || item.favorite ? 'auto' : 'none',
              transition: 'opacity 120ms ease, background-color 120ms ease',
              bgcolor: 'rgba(0,0,0,.66)',
              color: item.favorite ? 'warning.main' : '#fff',
              '&:hover': { bgcolor: 'rgba(0,0,0,.78)' },
            }}
          >
            {item.favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
      {!selectionMode && (recommendedForCleanup || showMediaBadge || (item.fold_member_ids?.length ?? 0) > 1 || (item.edit_recipe?.source_current && item.edit_recipe.revision > 0)) ? (
        <Stack
          spacing={0.5}
          alignItems="flex-end"
          data-xdrive-media-tile-badges
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            maxWidth: 'calc(100% - 8px)',
            zIndex: 4,
            pointerEvents: 'none',
          }}
        >
          {(item.fold_member_ids?.length ?? 0) > 1 ? (
            <Chip
              // The Places tile is itself a native button: never nest an
              // interactive button or initiate Gallery's fold action inside it.
              clickable={!compactTouch && !placesDrawer}
              component={compactTouch || placesDrawer ? 'span' : 'button'}
              size="small"
              label={`${item.fold_member_ids!.length} 份`}
              aria-label={`展开 ${item.fold_member_ids!.length} 份完整资源一致的副本`}
              data-xdrive-media-fold-expand={item.node.id}
              onClick={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
              sx={{
                pointerEvents: compactTouch || placesDrawer ? 'none' : 'auto', bgcolor: 'rgba(0,0,0,.75)',
                color: '#fff', fontWeight: 700, maxWidth: '100%',
              }}
            />
          ) : null}
          {recommendedForCleanup ? (
            <Chip
              size="small"
              label="建议保留"
              data-xdrive-media-cleanup-recommended
              sx={{
                maxWidth: '100%',
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 1,
                fontWeight: 700,
              }}
            />
          ) : null}
          {showMediaBadge ? (
            livePhoto ? (
              // At six-column Year density a full "实况" MUI Chip can be wider
              // than its square tile. The compact SF glyph keeps the real
              // media identity without obscuring or overflowing the photo.
              <Box
                component="span"
                aria-hidden="true"
                data-xdrive-media-live-indicator
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  bgcolor: 'rgba(0,0,0,.5)',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <XDriveLivePhotoGlyph size={13} />
              </Box>
            ) : (
              <Chip
                icon={video ? <MovieIcon /> : <ImageIcon />}
                label={mediaBadgeLabel}
                size="small"
                sx={{
                  maxWidth: '100%',
                  bgcolor: 'rgba(0,0,0,.66)',
                  color: '#fff',
                  '& .MuiChip-icon': { color: '#fff' },
                }}
              />
            )
          ) : null}
          {item.edit_recipe?.source_current && item.edit_recipe.revision > 0 ? (
            <Chip
              label="已编辑"
              size="small"
              data-xdrive-media-edited
              sx={{
                maxWidth: '100%',
                bgcolor: 'rgba(0,0,0,.66)',
                color: '#fff',
              }}
            />
          ) : null}
        </Stack>
      ) : null}
      {onSetCover ? (
        <Button
          size="small"
          variant="contained"
          onClick={(event) => {
            event.stopPropagation()
            onSetCover(item)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          sx={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            minWidth: 0,
            px: 1,
            py: 0.25,
            fontSize: 12,
            zIndex: 2,
            bgcolor: 'rgba(0,0,0,.68)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.82)' },
          }}
        >
          设封面
        </Button>
      ) : null}

    </Paper>
  )
}

export function MediaTileGrid({
  items,
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
  recommendedNodeID,
  indexOffset = 0,
}: {
  items: MediaItem[]
  minTileWidth: number
  minColumns?: number
  referenceColumnWidth?: number
  baselineColumns?: number
  selectionMode: boolean
  selectedContentKeys: ReadonlySet<string>
  onSelect: (item: MediaItem, index: number, modifiers: MediaSelectionModifiers) => void
  indexOffset?: number
  loadThumbnail: MediaThumbnailLoader
  thumbnailScheduler: XDriveMediaThumbnailScheduler
  loadPreviewURL?: MediaPreviewURLLoader
  saveVideoPoster?: MediaVideoPosterSaver
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetCover?: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onPreview: (item: MediaItem) => void
  onToggleFavorite: (item: MediaItem) => void
  recommendedNodeID?: number
}) {
  const denseGridRef = useRef<HTMLDivElement | null>(null)
  const [measuredColumns, setMeasuredColumns] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (minColumns === undefined) return
    const host = denseGridRef.current
    if (!host) return

    const update = () => {
      // Use the exact same KFS column-first metrics as the sparse virtual Grid
      // and Timeline. Do not read viewport/window.outerWidth or deduct the
      // scrollbar again: this host's clientWidth is the available width.
      const next = xDriveMediaGalleryGridMetrics({
        width: host.clientWidth,
        itemCount: items.length,
        minColumnWidth: minTileWidth,
        minColumns,
        referenceColumnWidth,
        baselineColumns,
      }).columns
      setMeasuredColumns((current) => current === next ? current : next)
    }
    update()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update)
      observer.observe(host)
      return () => observer.disconnect()
    }
    if (typeof window === 'undefined') return
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [items.length, minTileWidth, minColumns, referenceColumnWidth, baselineColumns])

  return (
    <Box
      ref={denseGridRef}
      data-xdrive-media-gallery-dense-grid
      sx={{
        display: 'grid',
        gridTemplateColumns: minColumns === undefined
          ? `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`
          : `repeat(${measuredColumns ?? minColumns}, minmax(0, 1fr))`,
        gap: `${XDRIVE_MEDIA_GALLERY_GRID_GAP}px`,
      }}
    >
      {items.map((item, index) => (
        <MediaTile
          key={photoContentIdentity(item)}
          item={item}
          logicalIndex={indexOffset + index}
          selectionMode={selectionMode}
          selectedForAction={selectedContentKeys.has(photoContentIdentity(item))}
          recommendedForCleanup={item.node.id === recommendedNodeID}
          onSelect={onSelect}
          loadThumbnail={loadThumbnail}
          thumbnailScheduler={thumbnailScheduler}
          loadPreviewURL={loadPreviewURL}
          saveVideoPoster={saveVideoPoster}
          onSetFavorite={onSetFavorite}
          onSetCover={onSetCover}
          onOpen={onOpen}
          onPreview={onPreview}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </Box>
  )
}

export function mediaGalleryScrollParent(element: HTMLElement) {
  let parent = element.parentElement
  while (parent) {
    const style = window.getComputedStyle(parent)
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return parent
    parent = parent.parentElement
  }
  return null
}

export type MediaGalleryReturnViewport = {
  scrollTop: number
  visibleTop: number
  viewportHeight: number
  width: number
  windowWidth: number
  scope: string
  collectionKey: string
  timeScale: 'year' | 'month' | 'day' | 'all'
}

// This is a bounded pixel/window snapshot of ONE visible virtual collection,
// not a retained photo array. It is consumed only across Mobile Collections.
export function MediaVirtualTileGrid({
  collection,
  minTileWidth,
  placesDrawer = false,
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
  recommendedNodeID,
  restoreAnchorIndex,
  restoreAnchorRevision = 0,
  restoreAnchorViewportOffset,
  returnViewport,
  onVisibleAnchorChange,
}: {
  collection: XDriveMediaGalleryVirtualCollection
  minTileWidth: number
  placesDrawer?: boolean
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
  recommendedNodeID?: number
  restoreAnchorIndex?: number
  restoreAnchorRevision?: number
  restoreAnchorViewportOffset?: number
  returnViewport?: MediaGalleryReturnViewport
  onVisibleAnchorChange?: (index: number) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [layout, setLayout] = useState(() => {
    // The old zero-width/empty-window initializer exposed a blank Gallery
    // frame while requestAnimationFrame measured the remounted grid.
    // The previously committed viewport already provides bounded geometry:
    // create its real virtual rows BEFORE the first browser paint.
    const metrics = xDriveMediaGalleryGridMetrics({
      width: returnViewport?.width ?? 0,
      itemCount: collection.itemCount,
      minColumnWidth: minTileWidth,
      minColumns,
      referenceColumnWidth,
      baselineColumns,
    })
    const visibleTop = returnViewport?.visibleTop ?? 0
    const visibleBottom = visibleTop + (returnViewport?.viewportHeight ?? 0)
    const empty = { start: 0, end: 0, startRow: 0, endRow: 0 }
    const visibleWindow = returnViewport
      ? xDriveMediaGalleryGridWindow({
          itemCount: collection.itemCount, columns: metrics.columns, rowStep: metrics.rowStep,
          visibleTop, visibleBottom, overscanRows: 0,
        }) : empty
    const window = returnViewport
      ? xDriveMediaGalleryGridWindow({
          itemCount: collection.itemCount, columns: metrics.columns, rowStep: metrics.rowStep,
          visibleTop, visibleBottom,
        }) : empty
    return { metrics, window, visibleWindow }
  })

  useLayoutEffect(() => {
    // With the full-height virtual host already mounted, restoring the exact
    // scroll position is synchronous and cannot flash the short overview.
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

    // Measure the first available viewport inside a layout effect, before
    // paint. The former rAF-only initializer displayed an empty 0-row grid
    // on every fresh Drawer mount, even when the first signed page was ready.
    const measure = () => {
      if (disposed || !hostRef.current) return
        const currentHost = hostRef.current
        const metrics = xDriveMediaGalleryGridMetrics({
          width: currentHost.clientWidth,
          itemCount: collection.itemCount,
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
          metrics.totalHeight,
          Math.max(visibleTop, viewportBottom - hostRect.top),
        )
        const visibleWindow = xDriveMediaGalleryGridWindow({
          itemCount: collection.itemCount,
          columns: metrics.columns,
          rowStep: metrics.rowStep,
          visibleTop,
          visibleBottom,
          overscanRows: 0,
        })
        const nextWindow = xDriveMediaGalleryGridWindow({
          itemCount: collection.itemCount,
          columns: metrics.columns,
          rowStep: metrics.rowStep,
          visibleTop,
          visibleBottom,
        })
        if (visibleWindow.end > visibleWindow.start) {
          onVisibleAnchorChange?.(visibleWindow.start)
        }
        setLayout((current) => (
          current.metrics.columns === metrics.columns &&
          Math.abs(current.metrics.totalHeight - metrics.totalHeight) < 0.5 &&
          current.window.start === nextWindow.start &&
          current.window.end === nextWindow.end &&
          current.visibleWindow.start === visibleWindow.start &&
          current.visibleWindow.end === visibleWindow.end
            ? current
            : { metrics, window: nextWindow, visibleWindow }
        ))
        if (nextWindow.end > nextWindow.start) {
          void collection.onRangeChange(nextWindow.start, nextWindow.end - 1)
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
  }, [collection.itemCount, collection.onRangeChange, minTileWidth, minColumns, referenceColumnWidth, baselineColumns, onVisibleAnchorChange])

  // A restore revision is a one-shot navigation/gesture intent. Re-rendering
  // the existing sparse wall for pending metadata, loading badges or a newly
  // observed visible row must not replay an old scroll-to-anchor command.
  const restoredAnchorRevisionRef = useRef(0)
  useLayoutEffect(() => {
    if (returnViewport || restoreAnchorRevision <= 0 ||
        restoreAnchorIndex === undefined ||
        restoredAnchorRevisionRef.current === restoreAnchorRevision) return
    const host = hostRef.current
    if (!host || collection.itemCount <= 0) return
    const metrics = xDriveMediaGalleryGridMetrics({
      width: host.clientWidth,
      itemCount: collection.itemCount,
      minColumnWidth: minTileWidth,
        minColumns,
        referenceColumnWidth,
        baselineColumns,
    })
    const index = Math.max(
      0,
      Math.min(collection.itemCount - 1, Math.trunc(restoreAnchorIndex)),
    )
    const offset = Math.floor(index / Math.max(1, metrics.columns)) * metrics.rowStep
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
    collection.itemCount,
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
    for (let index = layout.window.start; index < layout.window.end; index += 1) {
      const item = collection.itemAt(index)
      if (item?.metadata.has_thumbnail) retainedNodeIDs.push(item.node.id)
    }
    thumbnailScheduler.setRetention(retainedNodeIDs)
  }, [
    collection.itemAt,
    collection.loadedItems,
    layout.window.end,
    layout.window.start,
    thumbnailScheduler,
  ])

  useEffect(() => () => {
    thumbnailScheduler.setRetention([])
  }, [thumbnailScheduler])

  const slots = []
  for (let index = layout.window.start; index < layout.window.end; index += 1) {
    const item = collection.itemAt(index)
    const thumbnailPriority: XDriveMediaThumbnailPriority = (
      index >= layout.visibleWindow.start &&
      index < layout.visibleWindow.end
    ) ? 0 : 1
    slots.push(
      item ? (
        <MediaTile
          key={photoContentIdentity(item)}
          item={item}
          logicalIndex={index}
          placesDrawer={placesDrawer}
          selectionMode={selectionMode}
          selectedForAction={selectedContentKeys.has(photoContentIdentity(item))}
          recommendedForCleanup={item.node.id === recommendedNodeID}
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
          key={`media-placeholder-${index}`}
          variant="outlined"
          aria-hidden
          data-xdrive-media-gallery-placeholder
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
      ref={hostRef}
      data-xdrive-media-gallery-virtual-grid
      sx={{
        position: 'relative',
        height: layout.metrics.totalHeight,
        minHeight: collection.itemCount > 0 ? 150 : 0,
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: layout.window.startRow * layout.metrics.rowStep,
          insetInline: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${layout.metrics.columns}, minmax(0, 1fr))`,
          gap: `${XDRIVE_MEDIA_GALLERY_GRID_GAP}px`,
        }}
      >
        {slots}
      </Box>
    </Box>
  )
}



