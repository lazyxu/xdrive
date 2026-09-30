import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { formatBinarySize } from '../format'
import type { XDriveSidebarAppearance } from './SidebarNav'

export function XDriveSidebarStorageSummary({
  usedBytes,
  totalBytes,
  appearance = 'light',
  label = '存储',
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
  const usedLabel = boundedUsed > 0 && boundedUsed < 1024 ? '< 1 KiB' : formatBinarySize(boundedUsed)
  const percentage = hasQuota ? (boundedUsed / boundedTotal) * 100 : null
  const progress = percentage === null ? 0 : Math.max(0, Math.min(100, percentage))
  const overQuota = percentage !== null && percentage > 100
  const fullQuota = percentage !== null && percentage >= 100 && !overQuota
  const warningQuota = percentage !== null && percentage >= 85 && percentage < 100
  const percentageLabel = percentage === null
    ? '无容量限制'
    : `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}%`
  const statusLabel = overQuota ? '已超额' : fullQuota ? '已用满' : warningQuota ? '空间紧张' : ''
  const usageLabel = statusLabel ? `${percentageLabel} · ${statusLabel}` : percentageLabel
  const progressColor = overQuota || fullQuota ? 'error' : warningQuota ? 'warning' : 'primary'

  return (
    <Box
      aria-label={label}
      sx={[
        {
          minWidth: 0,
          px: 1,
          py: 1,
          borderRadius: 0,
          bgcolor: 'transparent',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
        <Typography
          variant="caption"
          fontWeight={600}
          sx={{ color: dark ? '#dfe8f7' : 'text.primary' }}
        >
          {label}
        </Typography>
        <Typography
          variant="caption"
          fontWeight={600}
          sx={{
            color: overQuota || fullQuota
              ? (dark ? 'error.light' : 'error.main')
              : warningQuota
                ? (dark ? 'warning.light' : 'warning.dark')
                : dark
                  ? '#8291a8'
                  : 'text.secondary',
          }}
        >
          {usageLabel}
        </Typography>
      </Stack>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          mt: 0.35,
          color: dark ? '#8291a8' : 'text.secondary',
          overflowWrap: 'anywhere',
        }}
      >
        已使用 {usedLabel}{hasQuota ? ` / ${formatBinarySize(boundedTotal)}` : ''}
      </Typography>
      {hasQuota ? (
        <LinearProgress
          variant="determinate"
          value={progress}
          color={progressColor}
          aria-label={`${label}使用率 ${usageLabel}`}
          sx={{
            mt: 0.75,
            height: 4,
            borderRadius: 999,
            bgcolor: dark ? 'rgba(255,255,255,.10)' : 'action.selected',
            '& .MuiLinearProgress-bar': { borderRadius: 999 },
          }}
        />
      ) : null}
    </Box>
  )
}
