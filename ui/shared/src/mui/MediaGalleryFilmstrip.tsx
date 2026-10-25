import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { MediaItem } from '../models'
import type { MediaThumbnailLoader } from './MediaGallery'
import { XDriveMediaThumbnailScheduler } from './MediaGalleryThumbnailScheduler'
import { xDriveMediaFormatDuration } from './MediaGalleryUtils'
import { XDriveLivePhotoGlyph } from './LivePhotoSurface'
import {
  XDriveMediaAsyncThumbnail,
  xDriveMediaFallback,
} from './MediaGalleryPreviewMedia'

export type XDriveMediaGalleryFilmstripEntry = {
  index: number
  item: MediaItem
}


/**
 * Keep the SF Live glyph attached to a decoded thumbnail, not merely remote
 * Live metadata. A new thumbnail loader, Node or revision mints a distinct
 * owner token; late onLoad from A cannot light up B (or a subsequent A).
 * Both Gallery Viewer shells use this one bounded Filmstrip.
 */
function XDriveMediaGalleryFilmstripMedia({
  item,
  videoDuration,
  loadFilmstripThumbnail,
  thumbnailScheduler,
}: {
  item: MediaItem
  videoDuration: string
  loadFilmstripThumbnail: MediaThumbnailLoader
  thumbnailScheduler: XDriveMediaThumbnailScheduler
}) {
  const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
  // Media relation enrichment can flip Live on/off without a Node revision.
  // Its stale decoded callback must never light the new Live indicator.
  const owner = useMemo(() => ({}), [item.node.id, item.node.revision, loadFilmstripThumbnail, livePhoto])
  const activeOwnerRef = useRef(owner)
  activeOwnerRef.current = owner
  const [readyOwner, setReadyOwner] = useState<object | null>(null)
  const onImageReadyChange = useCallback((ready: boolean) => {
    if (activeOwnerRef.current !== owner) return
    setReadyOwner(ready ? owner : null)
  }, [owner])

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <XDriveMediaAsyncThumbnail
        nodeID={item.metadata.has_thumbnail || item.metadata.media_kind === 'video' ? item.node.id : undefined}
        revision={item.node.revision}
        alt={item.node.name}
        loadThumbnail={loadFilmstripThumbnail}
        revokeOnDispose={false}
        onImageReadyChange={livePhoto ? onImageReadyChange : undefined}
        onImageDecodeError={(failedURL) => {
          thumbnailScheduler.invalidateDecodedURL(item.node.id, item.node.revision, failedURL)
        }}
        fallback={xDriveMediaFallback(item.metadata.media_kind)}
      />
      {livePhoto && readyOwner === owner ? (
        <Box component="span" data-xdrive-gallery-filmstrip-live-indicator aria-hidden="true"
          sx={{
            position: 'absolute',
            top: 2,
            right: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            borderRadius: '50%',
            bgcolor: 'rgba(0,0,0,.5)',
            color: '#fff',
            pointerEvents: 'none',
          }}>
          <XDriveLivePhotoGlyph size={13} />
        </Box>
      ) : null}
      {!livePhoto && item.metadata.media_kind === 'video' ? (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            right: 3,
            bottom: 2,
            px: 0.35,
            borderRadius: 0.75,
            bgcolor: 'rgba(0,0,0,.62)',
            color: '#fff',
            fontSize: 9,
            lineHeight: 1.4,
          }}
        >
          {videoDuration || '视频'}
        </Typography>
      ) : null}
    </Box>
  )
}

export function XDriveMediaGalleryFilmstrip({
  entries,
  activeIndex,
  loadThumbnail,
  onSelect,
}: {
  entries: readonly XDriveMediaGalleryFilmstripEntry[]
  activeIndex: number
  loadThumbnail: MediaThumbnailLoader
  onSelect: (index: number) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  // Keep keyboard focus on the selected thumbnail when a bounded window
  // changes its React buttons after navigation.
  const pendingKeyboardFocusRef = useRef<{
    index: number
    nodeID: MediaItem['node']['id']
    revision: MediaItem['node']['revision']
    loader: MediaThumbnailLoader
  } | null>(null)
  // A Viewer filmstrip owns its small bounded queue. Sharing the wall's
  // Scheduler instance would let Grid/Timeline viewport retention cancel
  // these independently visible Viewer thumbnails while the Viewer is open.
  // Reuse the same recovery/caching implementation, never a second API.
  const thumbnailScheduler = useMemo(
    () => new XDriveMediaThumbnailScheduler(loadThumbnail, {
      concurrency: 3,
      maxCacheEntries: 32,
    }),
    [loadThumbnail],
  )
  const loadFilmstripThumbnail = useCallback<MediaThumbnailLoader>(
    (nodeID, signal, revision, onProgress) =>
      thumbnailScheduler.load(nodeID, 0, revision, onProgress, signal),
    [thumbnailScheduler],
  )
  useEffect(() => {
    thumbnailScheduler.setRetention(entries.map(({ item }) => item.node.id))
  }, [entries, thumbnailScheduler])
  useEffect(() => () => {
    thumbnailScheduler.dispose()
  }, [thumbnailScheduler])

  const entryIDs = entries.map(({ index, item }) => `${index}:${item.node.id}:${item.node.revision ?? ''}`).join(',')
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const centerActive = () => {
      const active = strip.querySelector<HTMLElement>('[aria-current="true"]')
      if (!active) return
      const pending = pendingKeyboardFocusRef.current
      if (pending) {
        // The same Node/revision might be visible through a different
        // authenticated Owner. Never transfer keyboard intent across loaders.
        const sameOwner = pending.loader === loadThumbnail
        const targetStillVisible = sameOwner && entries.some(({ index, item }) =>
          index === pending.index && item.node.id === pending.nodeID &&
          item.node.revision === pending.revision)
        if (!targetStillVisible) {
          pendingKeyboardFocusRef.current = null
        } else if (activeIndex === pending.index) {
          active.focus()
          pendingKeyboardFocusRef.current = null
        }
      }
      const bounds = strip.getBoundingClientRect()
      const itemBounds = active.getBoundingClientRect()
      strip.scrollLeft += itemBounds.left - bounds.left - (strip.clientWidth - itemBounds.width) / 2
    }
    centerActive()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(centerActive)
    observer?.observe(strip)
    return () => observer?.disconnect()
  }, [activeIndex, entryIDs, loadThumbnail])

  if (entries.length === 0) return null
  const activeEntryVisible = entries.some(({ index }) => index === activeIndex)

  return (
    <Stack
      ref={stripRef}
      direction="row"
      spacing={0.75}
      alignItems="center"
      justifyContent="flex-start"
      data-xdrive-gallery-filmstrip
      role="group"
      aria-label="照片缩略图导航"
      sx={{
        width: 'max-content',
        maxWidth: '100%',
        mx: 'auto',
        overflowX: 'auto',
        px: 0.5,
        py: 0.25,
        scrollbarWidth: 'thin',
      }}
    >
      {entries.map(({ index, item }) => {
        const active = index === activeIndex
        const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
        const isVideo = !livePhoto && item.metadata.media_kind === 'video'
        const videoDuration = isVideo && Number.isFinite(item.metadata.duration_ms) &&
          (item.metadata.duration_ms ?? 0) > 0
            ? xDriveMediaFormatDuration(item.metadata.duration_ms)
            : ''
        return (
          <ButtonBase
            key={item.node.id}
            aria-label={`预览 ${item.node.name}${livePhoto ? '，实况照片' : isVideo ? `，视频${videoDuration ? `，时长 ${videoDuration}` : ''}` : ''}`}
            aria-current={active ? 'true' : undefined}
            tabIndex={active || (!activeEntryVisible && index === entries[0].index) ? 0 : -1}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              const ordinal = entries.findIndex(({ index: entryIndex, item: entryItem }) =>
                entryIndex === index && entryItem.node.id === item.node.id)
              if (ordinal < 0) return
              let nextOrdinal = ordinal
              if (event.key === 'ArrowLeft') nextOrdinal = Math.max(0, ordinal - 1)
              else if (event.key === 'ArrowRight') nextOrdinal = Math.min(entries.length - 1, ordinal + 1)
              else if (event.key === 'Home') nextOrdinal = 0
              else if (event.key === 'End') nextOrdinal = entries.length - 1
              else return
              // Do not also scroll the page or run the outer Viewer shortcut.
              event.preventDefault()
              event.stopPropagation()
              if (nextOrdinal === ordinal) return
              const next = entries[nextOrdinal]
              pendingKeyboardFocusRef.current = {
                index: next.index,
                nodeID: next.item.node.id,
                revision: next.item.node.revision,
                loader: loadThumbnail,
              }
              onSelect(next.index)
            }}
            sx={{
              flex: '0 0 auto',
              width: 58,
              height: 58,
              border: 2,
              borderColor: active ? 'primary.main' : 'transparent',
              borderRadius: 1.25,
              overflow: 'hidden',
              bgcolor: 'action.hover',
              opacity: active ? 1 : 0.72,
              transition: 'opacity 120ms ease, border-color 120ms ease, transform 120ms ease',
              '&:hover': { opacity: 1, transform: 'translateY(-1px)' },
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'none',
                '&:hover': { transform: 'none' },
              },
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <XDriveMediaGalleryFilmstripMedia
              item={item}
              videoDuration={videoDuration}
              loadFilmstripThumbnail={loadFilmstripThumbnail}
              thumbnailScheduler={thumbnailScheduler}
            />
          </ButtonBase>
        )
      })}
    </Stack>
  )
}
