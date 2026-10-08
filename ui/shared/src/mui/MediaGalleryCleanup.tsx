import {
  AutoAwesome as SuggestionIcon,
  ContentCopy as DuplicateIcon,
  PhotoLibrary as BurstIcon,
} from '@mui/icons-material'
import {
  Box,
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
  MediaDuplicateGroup,
  MediaDuplicateGroupList,
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

function DuplicateCard({
  group,
  loadThumbnail,
  onOpen,
}: {
  group: MediaDuplicateGroup
  loadThumbnail: MediaThumbnailLoader
  onOpen?: (group: MediaDuplicateGroup) => void
}) {
  return (
    <Paper
      variant="outlined"
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      data-xdrive-media-cleanup-duplicate
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
        label="完全重复项"
        loadThumbnail={loadThumbnail}
      />
      <Stack spacing={0.75} sx={{ px: 1.5, py: 1.25 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <DuplicateIcon fontSize="small" color="action" />
          <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>
            {group.item_count.toLocaleString('zh-CN')} 个完全相同副本
          </Typography>
          <Chip size="small" variant="outlined" label="CAS 已去重" />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {group.recommendation_reason}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          逻辑重复 {formatBytes(group.logical_duplicate_bytes)}
          {' · '}物理可释放 {formatBytes(group.physical_reclaimable_bytes)}
        </Typography>
      </Stack>
    </Paper>
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
  duplicates,
  bursts,
  loading,
  loadThumbnail,
  onOpenDuplicate,
  onOpenBurst,
}: {
  duplicates: MediaDuplicateGroupList | null
  bursts: MediaBurstReviewList | null
  loading?: boolean
  loadThumbnail: MediaThumbnailLoader
  onOpenDuplicate?: (group: MediaDuplicateGroup) => void
  onOpenBurst?: (group: MediaBurstReview) => void
}) {
  if (loading && !duplicates && !bursts) {
    return (
      <Paper
        variant="outlined"
        sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
      >
        <CircularProgress size={28} />
      </Paper>
    )
  }

  const duplicateGroups = duplicates?.groups ?? []
  const burstGroups = bursts?.groups ?? []
  if (duplicateGroups.length === 0 && burstGroups.length === 0) {
    return (
      <Paper
        variant="outlined"
        sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
      >
        <Stack spacing={0.75} alignItems="center">
          <SuggestionIcon color="disabled" sx={{ fontSize: 42 }} />
          <Typography color="text.secondary">暂时没有清理建议</Typography>
          <Typography variant="caption" color="text.secondary" align="center">
            完全重复项按 SHA256 识别；连拍精选仅使用本地确定性 Burst 关系
          </Typography>
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={3} data-xdrive-media-gallery-cleanup>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={0.5}>
          <Typography variant="subtitle2" fontWeight={700}>空间说明</Typography>
          <Typography variant="caption" color="text.secondary">
            完全重复文件已经由 xDrive CAS 按内容去重，因此删除重复引用通常不会释放共享 blob；
            这里会分别显示逻辑重复体积与真实物理可释放空间。删除操作仍然先进入回收站。
          </Typography>
        </Stack>
      </Paper>

      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1.25 }}>
          <Typography variant="subtitle1" fontWeight={700}>完全重复项</Typography>
          <Typography variant="caption" color="text.secondary">
            {(duplicates?.total_groups ?? 0).toLocaleString('zh-CN')} 组
            {' · '}逻辑重复 {formatBytes(duplicates?.logical_duplicate_bytes ?? 0)}
            {' · '}物理可释放 {formatBytes(duplicates?.physical_reclaimable_bytes ?? 0)}
          </Typography>
        </Stack>
        {duplicateGroups.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 1.5,
            }}
          >
            {duplicateGroups.map((group) => (
              <DuplicateCard
                key={group.id}
                group={group}
                loadThumbnail={loadThumbnail}
                onOpen={onOpenDuplicate}
              />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">没有完全重复项</Typography>
        )}
      </Box>

      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1.25 }}>
          <Typography variant="subtitle1" fontWeight={700}>连拍精选</Typography>
          <Typography variant="caption" color="text.secondary">
            {(bursts?.total_groups ?? 0).toLocaleString('zh-CN')} 组
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
      </Box>
    </Stack>
  )
}
