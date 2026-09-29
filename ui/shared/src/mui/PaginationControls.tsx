import type { SxProps, Theme } from '@mui/material/styles'
import { Stack, Typography } from '@mui/material'
import { XDriveActionButton } from './ActionButton'

export function XDrivePaginationControls({
  page,
  pageSize,
  hasNext,
  loading = false,
  labelPrefix = '',
  onPrevious,
  onNext,
  sx,
}: {
  page: number
  pageSize: number
  hasNext: boolean
  loading?: boolean
  labelPrefix?: string
  onPrevious: () => void
  onNext: () => void
  sx?: SxProps<Theme>
}) {
  return (
    <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" sx={sx}>
      <XDriveActionButton compact disabled={loading || page <= 1} onClick={onPrevious}>
        上一页
      </XDriveActionButton>
      <Typography variant="caption" color="text.secondary">
        {labelPrefix ? `${labelPrefix}第 ${page} 页 · 每页 ${pageSize} 条` : `第 ${page} 页 · 每页 ${pageSize} 条`}
      </Typography>
      <XDriveActionButton compact disabled={loading || !hasNext} onClick={onNext}>
        下一页
      </XDriveActionButton>
    </Stack>
  )
}
