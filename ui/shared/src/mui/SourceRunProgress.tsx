import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import type { ExternalSourceRunProgressView } from '../external-sources'
import { XDriveActionButton } from './ActionButton'

export function XDriveSourceRunProgress({
  progress,
  canCancel = false,
  cancelDisabled = false,
  cancelLoading = false,
  onCancel,
}: {
  progress: ExternalSourceRunProgressView
  canCancel?: boolean
  cancelDisabled?: boolean
  cancelLoading?: boolean
  onCancel?: () => void
}) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
        <Typography variant="body2">{progress.label}</Typography>
        {canCancel && onCancel ? (
          <XDriveActionButton
            compact
            intent="warning"
            disabled={cancelDisabled || progress.cancelling}
            loading={progress.cancelling || cancelLoading}
            loadingLabel="正在取消…"
            onClick={onCancel}
          >
            停止
          </XDriveActionButton>
        ) : null}
      </Stack>
      <LinearProgress
        variant={progress.percent === undefined ? 'indeterminate' : 'determinate'}
        value={progress.percent ?? 0}
      />
      {progress.activePath ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          当前文件：{progress.activePath}
        </Typography>
      ) : null}
    </Box>
  )
}
