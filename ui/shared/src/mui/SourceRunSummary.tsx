import { Box, Chip, Stack, Typography } from '@mui/material'
import type { ExternalSourceRunDetailView } from '../external-sources'
import { formatExternalSourceTime } from '../external-sources'
import { XDriveStatusBadge } from './StatusBadge'

export function XDriveSourceRunSummary({
  runNumber,
  detail,
  wideAt = 'sm',
}: {
  runNumber: number
  detail: ExternalSourceRunDetailView
  wideAt?: 'sm' | 'md'
}) {
  return (
    <Stack
      direction={wideAt === 'md' ? { xs: 'column', md: 'row' } : { xs: 'column', sm: 'row' }}
      spacing={1}
      alignItems={wideAt === 'md' ? { xs: 'flex-start', md: 'center' } : { xs: 'flex-start', sm: 'center' }}
      justifyContent="space-between"
      sx={{ width: '100%', pr: 1 }}
    >
      <Box>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
          <Typography variant="body2" fontWeight={700}>
            #{runNumber > 0 ? runNumber : '—'}
          </Typography>
          <XDriveStatusBadge tone={detail.statusTone} label={detail.statusLabel} />
          <Chip size="small" label={detail.modeLabel} />
          <Chip size="small" label={detail.triggerLabel} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {formatExternalSourceTime(detail.startedAt)}
          {detail.finishedAt ? ' → ' + formatExternalSourceTime(detail.finishedAt) : ' → 进行中'}
          {' · ' + detail.durationLabel}
        </Typography>
      </Box>
      <Stack direction="row" gap={1.25} alignItems="center" flexWrap="wrap" sx={{ minWidth: 0 }}>
        <Typography variant="caption">扫描 {detail.scannedItems.toLocaleString('zh-CN')}</Typography>
        <Typography variant="caption">已同步 {detail.successItems.toLocaleString('zh-CN')}</Typography>
        <Typography variant="caption" color="text.secondary">未变化 {detail.unchangedItems.toLocaleString('zh-CN')}</Typography>
        <Typography variant="caption" color="text.secondary">已忽略 {detail.ignoredItems.toLocaleString('zh-CN')}</Typography>
        <Typography variant="caption" color={detail.failedItems > 0 ? 'error' : 'text.secondary'}>
          失败 {detail.failedItems.toLocaleString('zh-CN')}
        </Typography>
        {detail.unprocessedItems !== undefined ? (
          <Typography variant="caption" color={detail.unprocessedItems > 0 ? 'warning.main' : 'text.secondary'}>
            已发现未处理 {detail.unprocessedItems.toLocaleString('zh-CN')}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  )
}
