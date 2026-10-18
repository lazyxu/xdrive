import {
  AutoAwesome as MemoryIcon,
  FlightTakeoff as TripIcon,
  History as OnThisDayIcon,
  Today as RecentIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import type { MediaMemory } from '../models'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'

type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>

function memoryKindLabel(kind: MediaMemory['kind']) {
  switch (kind) {
    case 'recent_day': return '近期'
    case 'on_this_day': return '往年今日'
    case 'trip': return '行程'
    default: return '回忆'
  }
}

function memoryKindIcon(kind: MediaMemory['kind']) {
  switch (kind) {
    case 'recent_day': return <RecentIcon fontSize="small" />
    case 'on_this_day': return <OnThisDayIcon fontSize="small" />
    case 'trip': return <TripIcon fontSize="small" />
    default: return <MemoryIcon fontSize="small" />
  }
}

function memorySectionTitle(kind: MediaMemory['kind']) {
  switch (kind) {
    case 'on_this_day': return '往年今日'
    case 'recent_day': return '近期回忆'
    case 'trip': return '行程'
    default: return '更多回忆'
  }
}

const memoryKinds = ['on_this_day', 'recent_day', 'trip'] as const

export function XDriveMediaGalleryMemories({
  memories,
  loading,
  readState = loading ? 'unverified' : 'ready',
  onRetry,
  loadThumbnail,
  onOpenMemory,
}: {
  memories: MediaMemory[]
  loading?: boolean
  /** Never infer a successful zero from an unrequested or failed Owner index. */
  readState?: 'unverified' | 'ready' | 'error'
  onRetry?: () => void
  loadThumbnail: MediaThumbnailLoader
  onOpenMemory?: (memory: MediaMemory) => void
}) {
  // Owner-scoped verification, not a transient Boolean, decides whether a
  // zero-item Memory index is real. Keep the same 180px slot during cold reads.
  if (memories.length === 0 && readState !== 'ready') {
    return (
      <Paper
        data-xdrive-gallery-memories-first-read
        aria-busy={readState === 'unverified' || undefined}
        variant="outlined"
        sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
      >
        {readState === 'error' ? (
          <Stack role="alert" spacing={1} alignItems="center">
            <Typography variant="body2" color="error.main">回忆索引读取失败，请重试。</Typography>
            {onRetry ? <Button onClick={onRetry} sx={{ minWidth: 44, minHeight: 44 }}>重试</Button> : null}
          </Stack>
        ) : null}
      </Paper>
    )
  }

  if (memories.length === 0 && readState === 'ready') {
    return (
      <Paper
        variant="outlined"
        sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
      >
        <Stack spacing={0.75} alignItems="center">
          <MemoryIcon color="disabled" sx={{ fontSize: 42 }} />
          <Typography color="text.secondary">还没有可生成的回忆</Typography>
          <Typography variant="caption" color="text.secondary" align="center">
            回忆根据本地拍摄时间与 GPS 自动生成，不会复制照片
          </Typography>
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={3} data-xdrive-media-gallery-memories>
      {memoryKinds.map((kind) => {
        const items = memories.filter((memory) => memory.kind === kind)
        if (items.length === 0) return null
        return (
          <Box key={kind}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.25 }}>
              {memorySectionTitle(kind)}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 1.5,
              }}
            >
              {items.map((memory) => (
                <Paper
                  key={memory.id}
                  variant="outlined"
                  role={onOpenMemory ? 'button' : undefined}
                  tabIndex={onOpenMemory ? 0 : undefined}
                  data-xdrive-media-gallery-memory={memory.kind}
                  onClick={() => onOpenMemory?.(memory)}
                  onKeyDown={(event) => {
                    if (!onOpenMemory) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onOpenMemory(memory)
                  }}
                  sx={{
                    overflow: 'hidden',
                    cursor: onOpenMemory ? 'pointer' : 'default',
                    transition: 'transform 120ms ease, box-shadow 120ms ease',
                    '&:hover': onOpenMemory
                      ? { transform: 'translateY(-1px)', boxShadow: 2 }
                      : undefined,
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Box sx={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
                    <XDriveMediaGalleryCoverThumbnail
                      nodeID={memory.cover_node_id}
                      alt={memory.title}
                      loadThumbnail={loadThumbnail}
                      fallback={(
                        <Box
                          sx={{
                            width: '100%',
                            height: '100%',
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'action.hover',
                            color: 'text.secondary',
                          }}
                        >
                          {memoryKindIcon(memory.kind)}
                        </Box>
                      )}
                    />
                  </Box>
                  <Stack spacing={0.75} sx={{ px: 1.5, py: 1.25 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography variant="body1" fontWeight={700} noWrap sx={{ flex: 1 }}>
                        {memory.title}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={memoryKindIcon(memory.kind)}
                        label={memoryKindLabel(memory.kind)}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {memory.subtitle || `${memory.item_count.toLocaleString('zh-CN')} 个项目`}
                    </Typography>
                  </Stack>
                </Paper>
              ))}
            </Box>
          </Box>
        )
      })}
    </Stack>
  )
}
