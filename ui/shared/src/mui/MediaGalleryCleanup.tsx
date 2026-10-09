import {
  AutoAwesome as SuggestionIcon,
  ContentCopy as DuplicateIcon,
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
  const comparisonLabel = group.asset_comparison === 'identical'
    ? '完整资源已核对'
    : group.asset_comparison === 'different'
      ? '资源或编辑有差异'
      : '完整资产待核对'
  const comparisonDescription = group.asset_comparison_reason
    ?? '仅确认主原文件 SHA-256 相同；不能据此自动合并实况、RAW 或编辑版本'
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
        label="主原文件重复"
        loadThumbnail={loadThumbnail}
      />
      <Stack spacing={0.75} sx={{ px: 1.5, py: 1.25 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <DuplicateIcon fontSize="small" color="action" />
          <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>
            {group.item_count.toLocaleString('zh-CN')} 个主原文件相同的副本
          </Typography>
          <Chip size="small" variant="outlined" label="CAS 已去重" />
          <Chip size="small" variant="outlined" label={comparisonLabel} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {group.recommendation_reason}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {comparisonDescription}
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
  onLoadMoreDuplicate,
  onLoadMoreBurst,
  onRefresh,
  loadingMore,
}: {
  duplicates: MediaDuplicateGroupList | null
  bursts: MediaBurstReviewList | null
  loading?: boolean
  loadThumbnail: MediaThumbnailLoader
  onOpenDuplicate?: (group: MediaDuplicateGroup) => void
  onOpenBurst?: (group: MediaBurstReview) => void
  onLoadMoreDuplicate?: () => void
  onLoadMoreBurst?: () => void
  onRefresh?: () => void
  loadingMore?: 'duplicate' | 'burst' | null
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
          <Typography color="text.secondary">当前已索引素材暂时没有清理建议</Typography>
          <Typography variant="caption" color="text.secondary" align="center">
            结果仅覆盖已就绪的媒体索引，尚不能据此证明全库不存在重复照片。
          </Typography>
          {onRefresh ? <Button onClick={onRefresh} sx={{ minHeight: 44 }}>重新检查</Button> : null}
        </Stack>
      </Paper>
    )
  }

  return (
    <Stack spacing={3} data-xdrive-media-gallery-cleanup>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" fontWeight={700}>空间说明</Typography>
            {onRefresh ? <Button size="small" onClick={onRefresh} sx={{ minHeight: 44 }}>刷新清理建议</Button> : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            相同主文件已经由 xDrive CAS 按内容去重，因此删除重复引用通常不会释放共享 blob；
            这里分别显示逻辑重复体积与物理可释放空间。完整实况、RAW 和编辑配方需要单独核对。
            删除操作仍然先进入回收站，只会处理选中的真实文件，不会自动删除关联资源或合并相册、人物等信息。
            后台删除任务完成后可刷新检查最新组数；此列表目前仅包含已就绪的媒体索引。
          </Typography>
        </Stack>
      </Paper>

      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1.25 }}>
          <Typography variant="subtitle1" fontWeight={700}>主原文件重复</Typography>
          <Typography variant="caption" color="text.secondary">
            已显示 {duplicateGroups.length.toLocaleString('zh-CN')} / {(duplicates?.total_groups ?? 0).toLocaleString('zh-CN')} 组
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
          <Typography variant="body2" color="text.secondary">没有主原文件重复项</Typography>
        )}
        {(duplicates?.total_groups ?? 0) > duplicateGroups.length && onLoadMoreDuplicate ? (
          <Stack alignItems="center" sx={{ mt: 1.5 }}>
            <Button
              variant="outlined"
              onClick={onLoadMoreDuplicate}
              disabled={Boolean(loadingMore)}
              startIcon={loadingMore === 'duplicate' ? <CircularProgress size={16} /> : undefined}
              sx={{ minHeight: 44 }}
            >
              {loadingMore === 'duplicate' ? '正在加载' : '加载更多重复组'}
            </Button>
          </Stack>
        ) : null}
      </Box>

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
