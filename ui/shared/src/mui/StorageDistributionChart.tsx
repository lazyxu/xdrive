import { Box, Stack, Typography } from '@mui/material'
import type { StorageSizeBucket } from '../models'
import { formatBytes } from '../format'

export type XDriveStorageDistributionValue = 'count' | 'bytes'

export function XDriveStorageDistributionChart({
  title,
  subtitle,
  buckets,
  value,
}: {
  title: string
  subtitle?: string
  buckets: StorageSizeBucket[]
  value: XDriveStorageDistributionValue
}) {
  const amounts = buckets.map((bucket) => value === 'count' ? bucket.count : bucket.bytes)
  const total = amounts.reduce((sum, amount) => sum + Math.max(0, amount), 0)
  const max = Math.max(0, ...amounts)

  return (
    <Box
      role="img"
      aria-label={title}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        minWidth: 0,
      }}
    >
      <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
      {subtitle ? (
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      ) : null}

      <Stack spacing={1.25} sx={{ mt: 1.5 }}>
        {buckets.map((bucket) => {
          const amount = value === 'count' ? bucket.count : bucket.bytes
          const share = total > 0 ? amount / total : 0
          const width = max > 0 ? Math.max(0, Math.min(100, (amount / max) * 100)) : 0
          const formatted = value === 'count'
            ? bucket.count.toLocaleString()
            : formatBytes(bucket.bytes)
          return (
            <Stack key={bucket.key} spacing={0.5}>
              <Stack direction="row" justifyContent="space-between" spacing={1}>
                <Typography variant="caption" color="text.secondary">{bucket.label}</Typography>
                <Typography variant="caption" fontWeight={600}>
                  {formatted} · {(share * 100).toFixed(1)}%
                </Typography>
              </Stack>
              <Box
                aria-label={`${bucket.label}：${formatted}，占比 ${(share * 100).toFixed(1)}%`}
                sx={{
                  height: 8,
                  borderRadius: 999,
                  bgcolor: 'action.hover',
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    width: `${width}%`,
                    minWidth: amount > 0 ? 4 : 0,
                    height: '100%',
                    borderRadius: 'inherit',
                    bgcolor: 'primary.main',
                  }}
                />
              </Box>
            </Stack>
          )
        })}
        {buckets.length === 0 ? (
          <Typography variant="body2" color="text.secondary">暂无分布数据</Typography>
        ) : null}
      </Stack>
    </Box>
  )
}
