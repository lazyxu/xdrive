import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { formatBinarySize } from '../format'
import type { XDriveSidebarAppearance } from './SidebarNav'

export function XDriveSidebarStorageSummary({
  usedBytes,
  totalBytes,
  appearance = 'light',
  label = '存储空间',
  sx,
}: {
  usedBytes: number
  totalBytes: number
  appearance?: XDriveSidebarAppearance
  label?: string
  sx?: SxProps<Theme>
}) {
  const dark = appearance === 'dark'
  const boundedUsed = Math.max(0, Number.isFinite(usedBytes) ? usedBytes : 0)
  const boundedTotal = Math.max(0, Number.isFinite(totalBytes) ? totalBytes : 0)
  const hasQuota = boundedTotal > 0
  const percentage = hasQuota ? (boundedUsed / boundedTotal) * 100 : null
  const progress = percentage === null ? 0 : Math.max(0, Math.min(100, percentage))
  const overQuota = percentage !== null && percentage > 100
  const percentageLabel = percentage === null
    ? '不限配额'
    : `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}%`

  return (
    <Box
      aria-label={label}
      sx={[
        {
          minWidth: 0,
          px: 1.25,
          py: 1.25,
          borderRadius: 1.25,
          bgcolor: dark ? 'rgba(255,255,255,.04)' : 'action.hover',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{ color: dark ? '#dfe8f7' : 'text.primary' }}
        >
          {label}
        </Typography>
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{ color: overQuota ? 'error.main' : dark ? '#9baac2' : 'text.secondary' }}
        >
          {percentageLabel}
        </Typography>
      </Stack>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          mt: 0.4,
          color: dark ? '#9baac2' : 'text.secondary',
          overflowWrap: 'anywhere',
        }}
      >
        {formatBinarySize(boundedUsed)} / {hasQuota ? formatBinarySize(boundedTotal) : '不限'}
      </Typography>
      {hasQuota ? (
        <LinearProgress
          variant="determinate"
          value={progress}
          color={overQuota ? 'error' : 'primary'}
          aria-label={`${label}使用率 ${percentageLabel}`}
          sx={{
            mt: 0.85,
            height: 5,
            borderRadius: 999,
            bgcolor: dark ? 'rgba(255,255,255,.10)' : 'action.selected',
            '& .MuiLinearProgress-bar': { borderRadius: 999 },
          }}
        />
      ) : null}
    </Box>
  )
}
