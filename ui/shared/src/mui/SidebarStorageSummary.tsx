import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { formatBytes } from '../format'
import type { XDriveSidebarAppearance } from './SidebarNav'

export function XDriveSidebarStorageSummary({
  usedBytes,
  totalBytes,
  diskTotalBytes,
  diskAvailableBytes,
  appearance = 'light',
  label = '云端存储',
  sx,
}: {
  usedBytes: number
  totalBytes: number
  diskTotalBytes?: number
  diskAvailableBytes?: number
  appearance?: XDriveSidebarAppearance
  label?: string
  sx?: SxProps<Theme>
}) {
  const dark = appearance === 'dark'
  const boundedUsed = Math.max(0, Number.isFinite(usedBytes) ? usedBytes : 0)
  const boundedTotal = Math.max(0, Number.isFinite(totalBytes) ? totalBytes : 0)
  const hasQuota = boundedTotal > 0
  const hasDiskTotal = diskTotalBytes !== undefined && Number.isFinite(diskTotalBytes) && diskTotalBytes > 0
  const hasDiskAvailable = diskAvailableBytes !== undefined && Number.isFinite(diskAvailableBytes) && diskAvailableBytes >= 0
  const boundedDiskTotal = hasDiskTotal ? Math.max(0, diskTotalBytes) : null
  const boundedDiskAvailable = hasDiskAvailable ? Math.max(0, diskAvailableBytes) : null
  const usedLabel = boundedUsed > 0 && boundedUsed < 1024 ? '< 1 KiB' : formatBytes(boundedUsed)
  const percentage = hasQuota ? (boundedUsed / boundedTotal) * 100 : null
  const diskPercentage = !hasQuota && boundedDiskTotal !== null && boundedDiskAvailable !== null
    ? ((boundedDiskTotal - Math.min(boundedDiskTotal, boundedDiskAvailable)) / boundedDiskTotal) * 100
    : null
  const progressPercentage = percentage ?? diskPercentage
  const progress = progressPercentage === null ? 0 : Math.max(0, Math.min(100, progressPercentage))
  const overQuota = percentage !== null && percentage > 100
  const fullQuota = percentage !== null && percentage >= 100 && !overQuota
  const warningQuota = percentage !== null && percentage >= 85 && percentage < 100
  const fullDisk = diskPercentage !== null && diskPercentage >= 100
  const warningDisk = diskPercentage !== null && diskPercentage >= 85 && diskPercentage < 100
  const percentageLabel = percentage === null
    ? '无容量限制'
    : `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}%`
  const diskPercentageLabel = diskPercentage === null
    ? null
    : `${diskPercentage > 0 && diskPercentage < 0.1 ? '<0.1' : diskPercentage >= 10 ? diskPercentage.toFixed(0) : diskPercentage.toFixed(1)}%`
  const statusLabel = overQuota ? '已超额' : fullQuota ? '已用满' : warningQuota ? '空间紧张' : ''
  const usageLabel = statusLabel ? `${percentageLabel} · ${statusLabel}` : percentageLabel
  const progressColor = overQuota || fullQuota || fullDisk
    ? 'error'
    : warningQuota || warningDisk
      ? 'warning'
      : 'primary'

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
        已使用 {usedLabel}{hasQuota ? ` / ${formatBytes(boundedTotal)}` : ''}
      </Typography>
      {boundedDiskAvailable !== null ? (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mt: 0.1,
            color: dark ? '#8291a8' : 'text.secondary',
            overflowWrap: 'anywhere',
          }}
        >
          {diskPercentageLabel
            ? `磁盘占用 ${diskPercentageLabel} · 可用 ${formatBytes(boundedDiskAvailable)}`
            : `磁盘可用 ${formatBytes(boundedDiskAvailable)}`}
        </Typography>
      ) : null}
      {progressPercentage !== null ? (
        <LinearProgress
          variant="determinate"
          value={progress}
          color={progressColor}
          aria-label={hasQuota ? `${label}使用率 ${usageLabel}` : `磁盘占用 ${diskPercentageLabel}`}
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
