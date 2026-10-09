import {
  AutoAwesome as SuggestionIcon,
  PhotoLibrary as BurstIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { formatBytes } from '../format'
import type {
  MediaBurstReview,
  MediaBurstReviewList,
} from '../models'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'

type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>

function CleanupThumbnail({
  nodeID,
  label,
  loadThumbnail,
}: {
  nodeID?: number
  label: string
  loadThumbnail: MediaThumbnailLoader
}) {
  return (
    <Box sx={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
      <XDriveMediaAsyncThumbnail
        nodeID={nodeID}
        alt={label}
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
            <SuggestionIcon sx={{ fontSize: 42 }} />
          </Box>
        )}
      />
    </Box>
  )
}

function BurstCard({
  group,
  loadThumbnail,
  onOpen,
}: {
  group: MediaBurstReview
  loadThumbnail: MediaThumbnailLoader
  onOpen?: (group: MediaBurstReview) => void
}) {
  return (
    <Paper
      variant="outlined"
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      data-xdrive-media-cleanup-burst
      onClick={() => onOpen?.(group)}
      onKeyDown={(event) => {
        if (!onOpen || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onOpen(group)
      }}
      sx={{
        overflow: 'hidden',
        cursor: onOpen ? 'pointer' : 'default',
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        '&:hover': onOpen ? { transform: 'translateY(-1px)', boxShadow: 2 } : undefined,
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <CleanupThumbnail
        nodeID={group.cover_node_id}
        label="连拍精选"
        loadThumbnail={loadThumbnail}
      />
      <Stack spacing={0.75} sx={{ px: 1.5, py: 1.25 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <BurstIcon fontSize="small" color="action" />
          <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>
            {group.item_count.toLocaleString('zh-CN')} 张连拍
          </Typography>
          <Chip size="small" label="建议保留" />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {group.recommendation_reason}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          非推荐帧 {formatBytes(group.potential_cleanup_bytes)}
          {' · '}永久删除后预计可释放 {formatBytes(group.physical_reclaimable_bytes)}
        </Typography>
      </Stack>
    </Paper>
  )
}

export function XDriveMediaGalleryCleanup({
  bursts,
  loading,
  loadThumbnail,
  onOpenBurst,
  onLoadMoreBurst,
  onRefresh,
  loadingMore,
}: {
  bursts: MediaBurstReviewList | null
  loading?: boolean
  loadThumbnail: MediaThumbnailLoader
  onOpenBurst?: (group: MediaBurstReview) => void
  onLoadMoreBurst?: () => void
  onRefresh?: () => void
  loadingMore?: 'burst' | null
}) {
  if (loading && !bursts) {
    return (
      <Paper
        variant="outlined"
        sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
      >
        <CircularProgress size={28} />
      </Paper>
    )
  }

  const burstGroups = bursts?.groups ?? []
  if (burstGroups.length === 0) {
    return (
      <Paper
        variant="outlined"
        sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
      >
        <Stack spacing={0.75} alignItems="center">
          <SuggestionIcon color="disabled" sx={{ fontSize: 42 }} />
          <Typography color="text.secondary">当前已索引素材暂时没有连拍清理建议</Typography>
          <Typography variant="caption" color="text.secondary" align="center">
            结果仅覆盖已就绪的媒体索引。
          </Typography>
          {onRefresh ? <Button onClick={onRefresh} sx={{ minHeight: 44 }}>重新检查</Button> : null}
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={3} data-xdrive-media-gallery-cleanup>
      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1.25 }}>
          <Typography variant="subtitle1" fontWeight={700}>连拍精选</Typography>
          <Typography variant="caption" color="text.secondary">
            已显示 {burstGroups.length.toLocaleString('zh-CN')} / {(bursts?.total_groups ?? 0).toLocaleString('zh-CN')} 组
            {' · '}非推荐帧 {formatBytes(bursts?.potential_cleanup_bytes ?? 0)}
            {' · '}永久删除后预计可释放 {formatBytes(bursts?.physical_reclaimable_bytes ?? 0)}
          </Typography>
        </Stack>
        {burstGroups.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 1.5,
            }}
          >
            {burstGroups.map((group) => (
              <BurstCard
                key={group.id}
                group={group}
                loadThumbnail={loadThumbnail}
                onOpen={onOpenBurst}
              />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">没有需要审查的连拍组</Typography>
        )}
        {(bursts?.total_groups ?? 0) > burstGroups.length && onLoadMoreBurst ? (
          <Stack alignItems="center" sx={{ mt: 1.5 }}>
            <Button
              variant="outlined"
              onClick={onLoadMoreBurst}
              disabled={Boolean(loadingMore)}
              startIcon={loadingMore === 'burst' ? <CircularProgress size={16} /> : undefined}
              sx={{ minHeight: 44 }}
            >
              {loadingMore === 'burst' ? '正在加载' : '加载更多连拍组'}
            </Button>
          </Stack>
        ) : null}
      </Box>
    </Stack>
  )
}
