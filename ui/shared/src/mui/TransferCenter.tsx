import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import {
  formatBinarySize,
  formatXDriveTransferDuration,
  xDriveTransferEtaMs,
  xDriveTransferKindLabel,
  xDriveTransferPercent,
  xDriveTransferStateLabel,
  type XDriveTransferTask,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveDescriptionGrid, XDriveDescriptionItem } from './DescriptionGrid'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'

function transferTone(state: string) {
  if (state === 'completed') return 'good' as const
  if (state === 'failed') return 'bad' as const
  if (state === 'retrying') return 'warning' as const
  return 'busy' as const
}

function transferSpeed(bytesPerSecond: number) {
  return bytesPerSecond > 0 ? `${formatBinarySize(bytesPerSecond)}/s` : '—'
}

function transferTime(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function TransferItem({
  item,
  retryDisabled,
  retryLoading,
  onRetry,
}: {
  item: XDriveTransferTask
  retryDisabled: boolean
  retryLoading: boolean
  onRetry?: (id: string) => void
}) {
  const percent = xDriveTransferPercent(item)
  const eta = xDriveTransferEtaMs(item)
  const active = item.state === 'running' || item.state === 'retrying'
  const byteProgress = item.bytes_total > 0
    ? `${formatBinarySize(item.bytes_done)} / ${formatBinarySize(item.bytes_total)}`
    : item.bytes_done > 0 ? formatBinarySize(item.bytes_done) : '等待数据'

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ px: 1.75, py: 1.5 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle2" fontWeight={700} noWrap title={item.path || item.file_name}>
              {item.file_name || item.path || item.id}
            </Typography>
            <XDriveStatusBadge tone={transferTone(item.state)} label={xDriveTransferStateLabel(item.state)} />
            <Typography variant="caption" color="text.secondary">
              {xDriveTransferKindLabel(item.kind || item.direction)}
            </Typography>
          </Stack>
          {item.path && item.path !== item.file_name ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, wordBreak: 'break-all' }}>
              {item.path}
            </Typography>
          ) : null}
        </Box>
        {item.state === 'failed' && item.retryable && onRetry ? (
          <XDriveActionButton
            compact
            disabled={retryDisabled}
            loading={retryLoading}
            loadingLabel="正在重试…"
            onClick={() => onRetry(item.id)}
          >
            重试
          </XDriveActionButton>
        ) : null}
      </Stack>

      <Box sx={{ px: 1.75, pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.75 }}>
          <Typography variant="body2">{byteProgress}</Typography>
          <Typography variant="body2" fontWeight={700}>
            {item.bytes_total > 0 ? `${percent.toFixed(1)}%` : active ? '处理中' : xDriveTransferStateLabel(item.state)}
          </Typography>
        </Stack>
        <LinearProgress
          variant={item.bytes_total > 0 ? 'determinate' : active ? 'indeterminate' : 'determinate'}
          value={item.bytes_total > 0 ? percent : item.state === 'completed' ? 100 : 0}
          sx={{ height: 7, borderRadius: 999, mb: 1.5 }}
        />

        <XDriveDescriptionGrid columns={4}>
          <XDriveDescriptionItem label="状态">{xDriveTransferStateLabel(item.state)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="当前大小">{formatBinarySize(item.bytes_done)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="总大小">{item.bytes_total > 0 ? formatBinarySize(item.bytes_total) : '未知'}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="百分比">{item.bytes_total > 0 ? `${percent.toFixed(1)}%` : '—'}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="开始时间">{transferTime(item.started_at)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="已耗时">{formatXDriveTransferDuration(item.elapsed_ms)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="预计剩余">{eta === undefined ? (active ? '计算中' : '—') : formatXDriveTransferDuration(eta)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="完成时间">{transferTime(item.completed_at)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="当前速度">{transferSpeed(item.instant_bytes_per_second)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="平均速度">{transferSpeed(item.average_bytes_per_second)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="方向">{xDriveTransferKindLabel(item.direction)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="重试次数">{item.retry_count.toLocaleString('zh-CN')}</XDriveDescriptionItem>
        </XDriveDescriptionGrid>
        {item.error ? <XDriveStatusAlert tone="bad" sx={{ mt: 1.25 }}>{item.error}</XDriveStatusAlert> : null}
      </Box>
    </Box>
  )
}

export function XDriveTransferCenter({
  transfers,
  loading = false,
  retryingID = '',
  retryDisabled = false,
  onRetry,
}: {
  transfers: XDriveTransferTask[]
  loading?: boolean
  retryingID?: string
  retryDisabled?: boolean
  onRetry?: (id: string) => void
}) {
  const active = transfers.filter((item) => item.state === 'running' || item.state === 'retrying')
  const completed = transfers.filter((item) => item.state === 'completed')
  const failed = transfers.filter((item) => item.state === 'failed')

  if (loading && transfers.length === 0) return <XDriveStatePanel loading message="正在加载传输记录…" />

  const groups: Array<[string, XDriveTransferTask[]]> = [
    ['进行中', active],
    ['已完成', completed],
    ['失败', failed],
  ]

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Typography variant="body2"><strong>{active.length}</strong> 进行中</Typography>
        <Typography variant="body2"><strong>{completed.length}</strong> 已完成</Typography>
        <Typography variant="body2"><strong>{failed.length}</strong> 失败</Typography>
      </Stack>
      {groups.map(([label, items]) => (
        <Box key={label}>
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>{label}</Typography>
            <Typography variant="caption" color="text.secondary">{items.length}</Typography>
          </Stack>
          {items.length === 0 ? (
            <XDriveStatePanel variant="plain" compact message={`暂无${label}传输。`} />
          ) : (
            <Stack spacing={1.25}>
              {items.map((item) => (
                <TransferItem
                  key={item.id}
                  item={item}
                  retryDisabled={retryDisabled}
                  retryLoading={retryingID === item.id}
                  onRetry={onRetry}
                />
              ))}
            </Stack>
          )}
        </Box>
      ))}
    </Stack>
  )
}
