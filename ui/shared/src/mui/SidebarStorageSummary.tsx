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
  const diskUsedBytes = !hasQuota && boundedDiskTotal !== null && boundedDiskAvailable !== null
    ? Math.max(0, boundedDiskTotal - Math.min(boundedDiskTotal, boundedDiskAvailable))
    : null
  const diskPercentage = diskUsedBytes !== null && boundedDiskTotal
    ? (diskUsedBytes / boundedDiskTotal) * 100
    : null
  const xdriveDiskUsedBytes = diskUsedBytes === null
    ? null
    : Math.min(diskUsedBytes, boundedUsed)
  const otherDiskUsedBytes = diskUsedBytes === null || xdriveDiskUsedBytes === null
    ? null
    : Math.max(0, diskUsedBytes - xdriveDiskUsedBytes)
  const xdriveDiskPercentage = xdriveDiskUsedBytes !== null && boundedDiskTotal
    ? (xdriveDiskUsedBytes / boundedDiskTotal) * 100
    : null
  const otherDiskPercentage = otherDiskUsedBytes !== null && boundedDiskTotal
    ? (otherDiskUsedBytes / boundedDiskTotal) * 100
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
          display: 'flex',
          alignItems: 'center',
          gap: 0.6,
          mt: 0.35,
          color: hasQuota
            ? (dark ? '#8291a8' : 'text.secondary')
            : (dark ? 'primary.light' : 'primary.main'),
          overflowWrap: 'anywhere',
        }}
      >
        {!hasQuota ? (
          <Box
            component="span"
            aria-hidden
            sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'primary.main', flex: '0 0 auto' }}
          />
        ) : null}
        <Box component="span">
          已使用 {usedLabel}{hasQuota ? ` / ${formatBytes(boundedTotal)}` : ''}
        </Box>
      </Typography>
      {boundedDiskAvailable !== null ? (
        <Typography
          variant="caption"
          component="div"
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 0.6,
            rowGap: 0.1,
            mt: 0.1,
            color: dark ? '#8291a8' : 'text.secondary',
            overflowWrap: 'anywhere',
          }}
        >
          {!hasQuota && otherDiskUsedBytes !== null ? (
            <>
              <Box
                component="span"
                aria-hidden
                sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'secondary.main', flex: '0 0 auto' }}
              />
              <Box component="span" sx={{ color: dark ? 'secondary.light' : 'secondary.main' }}>
                其他占用 {formatBytes(otherDiskUsedBytes)}
              </Box>
              <Box component="span">
                · 磁盘占用 {diskPercentageLabel} · 可用 {formatBytes(boundedDiskAvailable)}
              </Box>
            </>
          ) : (
            <Box component="span">
              {diskPercentageLabel
                ? `磁盘占用 ${diskPercentageLabel} · 可用 ${formatBytes(boundedDiskAvailable)}`
                : `磁盘可用 ${formatBytes(boundedDiskAvailable)}`}
            </Box>
          )}
        </Typography>
      ) : null}
      {percentage !== null ? (
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
      ) : diskPercentage !== null ? (
        <Box
          data-xdrive-storage-breakdown
          role="img"
          aria-label={`磁盘占用 ${diskPercentageLabel}，我的存储 ${usedLabel}，其他占用 ${otherDiskUsedBytes === null ? '未知' : formatBytes(otherDiskUsedBytes)}`}
          sx={{
            mt: 0.75,
            height: 4,
            borderRadius: 999,
            overflow: 'hidden',
            display: 'flex',
            bgcolor: dark ? 'rgba(255,255,255,.10)' : 'action.selected',
          }}
        >
          <Box
            data-xdrive-storage-segment="mine"
            sx={{
              width: `${Math.max(0, Math.min(100, xdriveDiskPercentage ?? 0))}%`,
              bgcolor: 'primary.main',
              flexShrink: 0,
            }}
          />
          <Box
            data-xdrive-storage-segment="other"
            sx={{
              width: `${Math.max(0, Math.min(100, otherDiskPercentage ?? 0))}%`,
              bgcolor: 'secondary.main',
              flexShrink: 0,
            }}
          />
        </Box>
      ) : null}
    </Box>
  )
}
