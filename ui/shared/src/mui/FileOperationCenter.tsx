import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import {
  formatBinarySize,
  xDriveFileOperationActive,
  xDriveFileOperationPercent,
  xDriveFileOperationStatusLabel,
  xDriveFileOperationTypeLabel,
  type XDriveFileOperation,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveDescriptionGrid, XDriveDescriptionItem } from './DescriptionGrid'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'

function operationTone(status: string) {
  if (status === 'completed') return 'good' as const
  if (status === 'failed') return 'bad' as const
  if (status === 'cancelled' || status === 'cancel_requested') return 'warning' as const
  return 'busy' as const
}

function operationTime(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function OperationItem({
  operation,
  cancelling,
  retrying,
  disabled,
  onCancel,
  onRetry,
}: {
  operation: XDriveFileOperation
  cancelling: boolean
  retrying: boolean
  disabled: boolean
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
}) {
  const active = xDriveFileOperationActive(operation.status)
  const percent = xDriveFileOperationPercent(operation)
  const byteProgress = operation.total_bytes > 0
    ? `${formatBinarySize(operation.processed_bytes)} / ${formatBinarySize(operation.total_bytes)}`
    : '—'

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'center' }}
        sx={{ px: 1.75, py: 1.5 }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle2" fontWeight={700}>
              {xDriveFileOperationTypeLabel(operation.type)}
            </Typography>
            <XDriveStatusBadge tone={operationTone(operation.status)} label={xDriveFileOperationStatusLabel(operation.status)} />
            <Typography variant="caption" color="text.secondary">
              {operation.total_items.toLocaleString('zh-CN')} 个项目
            </Typography>
          </Stack>
          {operation.current_item ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }} noWrap title={operation.current_item}>
              当前：{operation.current_item}
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={1}>
          {active && operation.status !== 'cancel_requested' && onCancel ? (
            <XDriveActionButton
              compact
              disabled={disabled}
              loading={cancelling}
              loadingLabel="正在取消…"
              onClick={() => onCancel(operation.id)}
            >
              取消
            </XDriveActionButton>
          ) : null}
          {operation.retryable && onRetry ? (
            <XDriveActionButton
              compact
              disabled={disabled}
              loading={retrying}
              loadingLabel="正在重试…"
              onClick={() => onRetry(operation.id)}
            >
              重试
            </XDriveActionButton>
          ) : null}
        </Stack>
      </Stack>

      <Box sx={{ px: 1.75, pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.75 }}>
          <Typography variant="body2">
            {operation.processed_items.toLocaleString('zh-CN')} / {operation.total_items.toLocaleString('zh-CN')} 个项目
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {active || operation.status === 'completed' ? `${percent.toFixed(1)}%` : xDriveFileOperationStatusLabel(operation.status)}
          </Typography>
        </Stack>
        <LinearProgress
          variant={operation.status === 'queued' && percent === 0 ? 'indeterminate' : 'determinate'}
          value={percent}
          sx={{ height: 7, borderRadius: 999, mb: 1.5 }}
        />

        <XDriveDescriptionGrid columns={4}>
          <XDriveDescriptionItem label="状态">{xDriveFileOperationStatusLabel(operation.status)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="项目进度">
            {operation.processed_items.toLocaleString('zh-CN')} / {operation.total_items.toLocaleString('zh-CN')}
          </XDriveDescriptionItem>
          <XDriveDescriptionItem label="数据量">{byteProgress}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="百分比">{`${percent.toFixed(1)}%`}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="创建时间">{operationTime(operation.created_at)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="开始时间">{operationTime(operation.started_at)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="完成时间">{operationTime(operation.finished_at)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="任务 ID">{operation.id}</XDriveDescriptionItem>
        </XDriveDescriptionGrid>
        {operation.error ? <XDriveStatusAlert tone="bad" sx={{ mt: 1.25 }}>{operation.error}</XDriveStatusAlert> : null}
      </Box>
    </Box>
  )
}

export function XDriveFileOperationCenter({
  operations,
  loading = false,
  cancellingID = '',
  retryingID = '',
  disabled = false,
  onCancel,
  onRetry,
}: {
  operations: XDriveFileOperation[]
  loading?: boolean
  cancellingID?: string
  retryingID?: string
  disabled?: boolean
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
}) {
  const active = operations.filter((item) => xDriveFileOperationActive(item.status))
  const completed = operations.filter((item) => item.status === 'completed')
  const stopped = operations.filter((item) => item.status === 'failed' || item.status === 'cancelled')

  if (loading && operations.length === 0) return <XDriveStatePanel loading message="正在加载文件操作…" />

  const groups: Array<[string, XDriveFileOperation[]]> = [
    ['进行中', active],
    ['已完成', completed],
    ['失败或取消', stopped],
  ]

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Typography variant="body2"><strong>{active.length}</strong> 进行中</Typography>
        <Typography variant="body2"><strong>{completed.length}</strong> 已完成</Typography>
        <Typography variant="body2"><strong>{stopped.length}</strong> 失败或取消</Typography>
      </Stack>
      {groups.map(([label, items]) => (
        <Box key={label}>
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>{label}</Typography>
            <Typography variant="caption" color="text.secondary">{items.length}</Typography>
          </Stack>
          {items.length === 0 ? (
            <XDriveStatePanel variant="plain" compact message={`暂无${label}文件操作。`} />
          ) : (
            <Stack spacing={1.25}>
              {items.map((operation) => (
                <OperationItem
                  key={operation.id}
                  operation={operation}
                  cancelling={cancellingID === operation.id}
                  retrying={retryingID === operation.id}
                  disabled={disabled}
                  onCancel={onCancel}
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
