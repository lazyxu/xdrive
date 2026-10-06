import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import {
  formatBytes,
  formatBytesPerSecond,
  formatXDriveTransferDuration,
  xDriveFileOperationActive,
  xDriveFileOperationAverageBytesPerSecond,
  xDriveFileOperationAverageItemsPerSecond,
  xDriveFileOperationElapsedMs,
  xDriveFileOperationEtaMs,
  xDriveFileOperationCanResolveConflict,
  xDriveFileOperationContinuationParentIDs,
  xDriveFileOperationFailureItemLabel,
  xDriveFileOperationFailureMessage,
  xDriveFileOperationPercent,
  xDriveFileOperationStatusLabel,
  xDriveFileOperationTypeLabel,
  type XDriveFileOperation,
  type XDriveFileOperationConflictResolution,
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

function operationRate(operation: XDriveFileOperation, now: number) {
  const bytesPerSecond = xDriveFileOperationAverageBytesPerSecond(operation, now)
  if (operation.total_bytes > 0 && bytesPerSecond > 0) {
    return formatBytesPerSecond(bytesPerSecond)
  }
  const itemsPerSecond = xDriveFileOperationAverageItemsPerSecond(operation, now)
  if (itemsPerSecond <= 0) return '—'
  const formatted = itemsPerSecond >= 10 ? itemsPerSecond.toFixed(0) : itemsPerSecond.toFixed(1)
  return `${formatted} 项/秒`
}

function OperationItem({
  operation,
  cancelling,
  retrying,
  undoing,
  redoing,
  resolving,
  resolvingPolicy,
  continued,
  disabled,
  onCancel,
  onRetry,
  onUndo,
  onRedo,
  onResolveConflict,
}: {
  operation: XDriveFileOperation
  cancelling: boolean
  retrying: boolean
  undoing: boolean
  redoing: boolean
  resolving: boolean
  resolvingPolicy: XDriveFileOperationConflictResolution | ''
  continued: boolean
  disabled: boolean
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
  onUndo?: (id: string) => void
  onRedo?: (id: string) => void
  onResolveConflict?: (id: string, policy: XDriveFileOperationConflictResolution) => void
}) {
  const active = xDriveFileOperationActive(operation.status)
  const percent = xDriveFileOperationPercent(operation)
  const now = Date.now()
  const elapsed = xDriveFileOperationElapsedMs(operation, now)
  const eta = xDriveFileOperationEtaMs(operation, now)
  const currentSize = operation.total_bytes > 0 ? formatBytes(operation.processed_bytes) : '—'
  const totalSize = operation.total_bytes > 0 ? formatBytes(operation.total_bytes) : '—'
  const elapsedLabel = operation.started_at ? formatXDriveTransferDuration(elapsed) : '—'
  const etaLabel = operation.status === 'queued'
    ? '等待开始'
    : eta === undefined
      ? (active ? '计算中' : '—')
      : formatXDriveTransferDuration(eta)
  const failureMessage = xDriveFileOperationFailureMessage(operation)
  const failureItem = xDriveFileOperationFailureItemLabel(operation)
  const canResolveConflict =
    !continued &&
    xDriveFileOperationCanResolveConflict(operation) &&
    Boolean(onResolveConflict)

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
          {operation.retryable && !continued && onRetry ? (
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
          {operation.undoable && onUndo ? (
            <XDriveActionButton
              compact
              disabled={disabled}
              loading={undoing}
              loadingLabel="正在撤销…"
              onClick={() => onUndo(operation.id)}
            >
              撤销
            </XDriveActionButton>
          ) : null}
          {operation.redoable && onRedo ? (
            <XDriveActionButton
              compact
              disabled={disabled}
              loading={redoing}
              loadingLabel="正在重做…"
              onClick={() => onRedo(operation.id)}
            >
              重做
            </XDriveActionButton>
          ) : null}
          {canResolveConflict ? (
            <>
              <XDriveActionButton
                compact
                disabled={disabled}
                loading={resolving && resolvingPolicy === 'skip'}
                loadingLabel="正在处理…"
                onClick={() => onResolveConflict?.(operation.id, 'skip')}
              >
                跳过冲突
              </XDriveActionButton>
              <XDriveActionButton
                compact
                disabled={disabled}
                loading={resolving && resolvingPolicy === 'keep_both'}
                loadingLabel="正在处理…"
                onClick={() => onResolveConflict?.(operation.id, 'keep_both')}
              >
                保留两者
              </XDriveActionButton>
            </>
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
          <XDriveDescriptionItem label="当前大小">{currentSize}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="总大小">{totalSize}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="百分比">{`${percent.toFixed(1)}%`}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="开始时间">{operationTime(operation.started_at)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="已耗时">{elapsedLabel}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="预计剩余">{etaLabel}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="平均处理速度">{operationRate(operation, now)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="完成时间">{operationTime(operation.finished_at)}</XDriveDescriptionItem>
          {operation.status === 'failed' ? (
            <>
              <XDriveDescriptionItem label="失败项目">{failureItem || '—'}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="错误代码">{operation.failure_code || '—'}</XDriveDescriptionItem>
            </>
          ) : null}
          <XDriveDescriptionItem label="任务 ID">{operation.id}</XDriveDescriptionItem>
        </XDriveDescriptionGrid>
        {failureMessage ? (
          <XDriveStatusAlert tone="bad" sx={{ mt: 1.25 }}>
            <Stack spacing={0.25}>
              <Typography variant="body2">{failureMessage}</Typography>
              {operation.error && operation.error !== failureMessage ? (
                <Typography variant="caption" sx={{ opacity: 0.85 }}>{operation.error}</Typography>
              ) : null}
            </Stack>
          </XDriveStatusAlert>
        ) : operation.error ? (
          <XDriveStatusAlert tone="bad" sx={{ mt: 1.25 }}>{operation.error}</XDriveStatusAlert>
        ) : null}
      </Box>
    </Box>
  )
}

export function XDriveFileOperationCenter({
  operations,
  loading = false,
  cancellingID = '',
  retryingID = '',
  undoingID = '',
  redoingID = '',
  resolvingID = '',
  resolvingPolicy = '',
  disabled = false,
  onCancel,
  onRetry,
  onUndo,
  onRedo,
  onResolveConflict,
}: {
  operations: XDriveFileOperation[]
  loading?: boolean
  cancellingID?: string
  retryingID?: string
  undoingID?: string
  redoingID?: string
  resolvingID?: string
  resolvingPolicy?: XDriveFileOperationConflictResolution | ''
  disabled?: boolean
  onCancel?: (id: string) => void
  onRetry?: (id: string) => void
  onUndo?: (id: string) => void
  onRedo?: (id: string) => void
  onResolveConflict?: (id: string, policy: XDriveFileOperationConflictResolution) => void
}) {
  const active = operations.filter((item) => xDriveFileOperationActive(item.status))
  const completed = operations.filter((item) => item.status === 'completed')
  const stopped = operations.filter((item) => item.status === 'failed' || item.status === 'cancelled')
  const continuationParentIDs = xDriveFileOperationContinuationParentIDs(operations)

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
                  undoing={undoingID === operation.id}
                  redoing={redoingID === operation.id}
                  resolving={resolvingID === operation.id}
                  resolvingPolicy={resolvingID === operation.id ? resolvingPolicy : ''}
                  continued={continuationParentIDs.has(operation.id)}
                  disabled={disabled}
                  onCancel={onCancel}
                  onRetry={onRetry}
                  onUndo={onUndo}
                  onRedo={onRedo}
                  onResolveConflict={onResolveConflict}
                />
              ))}
            </Stack>
          )}
        </Box>
      ))}
    </Stack>
  )
}
