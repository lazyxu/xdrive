import { useLayoutEffect, useRef } from 'react'
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { MediaItem } from '../models'
import type { MediaThumbnailLoader } from './MediaGallery'
import {
  XDriveMediaAsyncThumbnail,
  xDriveMediaFallback,
} from './MediaGalleryPreviewMedia'

export type XDriveMediaGalleryFilmstripEntry = {
  index: number
  item: MediaItem
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
  const entryIDs = entries.map(({ item }) => item.node.id).join(',')
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const centerActive = () => {
      const active = strip.querySelector<HTMLElement>('[aria-current="true"]')
      if (!active) return
      const bounds = strip.getBoundingClientRect()
      const itemBounds = active.getBoundingClientRect()
      strip.scrollLeft += itemBounds.left - bounds.left - (strip.clientWidth - itemBounds.width) / 2
    }
    centerActive()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(centerActive)
    observer?.observe(strip)
    return () => observer?.disconnect()
  }, [activeIndex, entryIDs])

  if (entries.length === 0) return null

  return (
    <Stack
      ref={stripRef}
      direction="row"
      spacing={0.75}
      alignItems="center"
      justifyContent="flex-start"
      data-xdrive-gallery-filmstrip
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
        return (
          <ButtonBase
            key={item.node.id}
            aria-label={`预览 ${item.node.name}`}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(index)}
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
              '&:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
              <XDriveMediaAsyncThumbnail
                nodeID={item.metadata.has_thumbnail ? item.node.id : undefined}
                alt={item.node.name}
                loadThumbnail={loadThumbnail}
                fallback={xDriveMediaFallback(item.metadata.media_kind)}
              />
              {item.metadata.media_kind === 'video' ? (
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
                  视频
                </Typography>
              ) : null}
            </Box>
          </ButtonBase>
        )
      })}
    </Stack>
  )
}
