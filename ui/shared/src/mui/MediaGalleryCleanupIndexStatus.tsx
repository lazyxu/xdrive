import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import type { MediaGalleryIndexStatus } from '../models'
import { useXDriveDeferredPendingLoading } from './useDeferredLoading'

/**
 * This on-demand coverage describes known active PhotoAssets only.
 * It does not prove that every file has been enumerated or indexed.
 */
export function XDriveMediaGalleryCleanupIndexStatus({
  status,
  loading = false,
  error,
  onRequest,
}: {
  status?: MediaGalleryIndexStatus | null
  loading?: boolean
  error?: string
  onRequest?: () => void
}) {
  const unready = status
    ? Math.max(0, status.known_assets - status.ready_assets)
    : null
  // Index-check requests can complete within one frame. Keep the button's
  // committed label/width unchanged; only show optional progress in its
  // reserved slot after a genuinely sustained Server read.
  const showDelayedLoading = useXDriveDeferredPendingLoading(loading)
  return (
    <Paper variant="outlined" data-xdrive-media-cleanup-index-coverage sx={{ p: 1.5 }}>
      <Stack spacing={0.75}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>
            索引覆盖核对
          </Typography>
          {onRequest ? (
            <Button
              size="small"
              variant="text"
              disabled={loading}
              aria-busy={loading || undefined}
              onClick={onRequest}
              data-xdrive-media-cleanup-check-index
              sx={{ minHeight: 44 }}
            >
              <Box data-xdrive-media-cleanup-index-quiet-action
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                <Typography component="span" variant="body2">
                  {status ? '刷新索引状态' : '查看索引状态'}
                </Typography>
                <Box data-xdrive-media-cleanup-index-progress-slot
                  aria-busy={loading || undefined}
                  sx={{ width: 16, height: 16, flexShrink: 0, display: 'grid',
                    placeItems: 'center', pointerEvents: 'none' }}>
                  {showDelayedLoading
                    ? <CircularProgress size={13} aria-label="正在检查清理索引" />
                    : null}
                </Box>
              </Box>
            </Button>
          ) : null}
        </Stack>
        {status ? (
          <Typography variant="body2" data-xdrive-media-cleanup-index-counts aria-live="polite">
            已识别照片资产：{status.ready_assets.toLocaleString('zh-CN')} /
            {' '}{status.known_assets.toLocaleString('zh-CN')} 就绪
            {unready !== null && unready > 0
              ? ` · ${unready.toLocaleString('zh-CN')} 项未就绪`
              : ''}
            {status.failed_assets > 0
              ? ` · 失败 ${status.failed_assets.toLocaleString('zh-CN')}`
              : ''}
            {status.unsupported_assets > 0
              ? ` · 不支持 ${status.unsupported_assets.toLocaleString('zh-CN')}`
              : ''}
            {status.missing_metadata_assets > 0
              ? ` · 缺少元数据 ${status.missing_metadata_assets.toLocaleString('zh-CN')}`
              : ''}
            {status.other_unready_assets > 0
              ? ` · 其他未就绪 ${status.other_unready_assets.toLocaleString('zh-CN')}`
              : ''}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            索引覆盖尚未核验；清理建议只反映当前已就绪的照片资产。
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          统计范围仅包含已识别的 PhotoAsset。尚未扫描、尚未形成资产的文件不计入，
          即使显示全部已就绪，也不能据此认定全库没有重复照片。
        </Typography>
        {status?.checked_at ? (
          <Typography variant="caption" color="text.secondary">
            核对时间：{new Date(status.checked_at).toLocaleString('zh-CN')}
          </Typography>
        ) : null}
        {error ? (
          <Typography variant="caption" color="error" role="alert">
            索引核对失败：{error}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  )
}
