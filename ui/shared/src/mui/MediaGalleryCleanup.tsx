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
  MediaGalleryIndexStatus,
} from '../models'
import { XDriveMediaGalleryCleanupIndexStatus } from './MediaGalleryCleanupIndexStatus'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import { useXDriveDeferredPendingLoading } from './useDeferredLoading'

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
      <XDriveMediaGalleryCoverThumbnail
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
  readState = bursts !== null ? 'ready' : loading ? 'unverified' : 'error',
  loadThumbnail,
  onOpenBurst,
  onLoadMoreBurst,
  onRefresh,
  loadingMore,
  indexStatus,
  indexStatusLoading,
  indexStatusError,
  onRequestIndexStatus,
}: {
  bursts: MediaBurstReviewList | null
  loading?: boolean
  /** Current-Owner receipt; null list is never a verified empty result. */
  readState?: 'unverified' | 'ready' | 'error'
  loadThumbnail: MediaThumbnailLoader
  onOpenBurst?: (group: MediaBurstReview) => void
  onLoadMoreBurst?: () => void
  onRefresh?: () => void
  loadingMore?: 'burst' | null
  indexStatus?: MediaGalleryIndexStatus | null
  indexStatusLoading?: boolean
  indexStatusError?: string
  onRequestIndexStatus?: () => void
}) {
  const firstReadPending = bursts === null && readState === 'unverified'
  const showMoreLoading = useXDriveDeferredPendingLoading(loadingMore === 'burst')
  // An absent canonical Server response is never authoritative zero. Failed
  // first reads retain their real parent error instead of claiming no advice.
  if (bursts === null) {
    return (
      <Paper
        data-xdrive-gallery-cleanup-first-read
        aria-busy={firstReadPending || undefined}
        variant="outlined"
        sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
      >
        {!firstReadPending ? (
          <Stack spacing={0.75} alignItems="center">
            <Typography color="text.secondary">连拍清理结果尚未确认，请重新检查。</Typography>
            {onRefresh ? <Button onClick={onRefresh} sx={{ minHeight: 44 }}>重新检查</Button> : null}
          </Stack>
        ) : null}
      </Paper>
    )
  }

  const burstGroups = bursts.groups
  const indexCoverage = (
    <XDriveMediaGalleryCleanupIndexStatus
      status={indexStatus}
      loading={indexStatusLoading}
      error={indexStatusError}
      onRequest={onRequestIndexStatus}
    />
  )
  if (burstGroups.length === 0) {
    return (
      <Stack spacing={2} data-xdrive-media-gallery-cleanup>
        {indexCoverage}
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
      </Stack>
    )
  }

  return (
    <Stack spacing={3} data-xdrive-media-gallery-cleanup>
      {indexCoverage}
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
              startIcon={(
                <Box component="span" sx={{
                  width: 16, height: 16, display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {showMoreLoading ? <CircularProgress size={16} /> : null}
                </Box>
              )}
              sx={{ minHeight: 44 }}
            >
              加载更多连拍组
            </Button>
          </Stack>
        ) : null}
      </Box>
    </Stack>
  )
}
