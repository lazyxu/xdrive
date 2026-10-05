import { useState } from 'react'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import {
  Box,
  Collapse,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  formatBinarySize,
  formatXDriveTransferDuration,
  xDriveTransferActive,
  xDriveTransferAggregateBytes,
  xDriveTransferEtaMs,
  xDriveTransferIsGroup,
  xDriveTransferItemProgress,
  xDriveTransferKindLabel,
  xDriveTransferPercent,
  xDriveTransferPhaseLabel,
  xDriveTransferStateLabel,
  xDriveTransferTree,
  type XDriveTransferTask,
  type XDriveTransferTreeNode,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveDescriptionGrid, XDriveDescriptionItem } from './DescriptionGrid'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'

function transferTone(state: string) {
  if (state === 'completed') return 'good' as const
  if (state === 'failed') return 'bad' as const
  if (state === 'partial' || state === 'retrying' || state === 'cancelling' || state === 'cancelled') {
    return 'warning' as const
  }
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

function transferBytes(item: XDriveTransferTask) {
  return item.bytes_total > 0
    ? `${formatBinarySize(item.bytes_done)} / ${formatBinarySize(item.bytes_total)}`
    : item.bytes_done > 0 ? formatBinarySize(item.bytes_done) : '等待数据'
}

function TransferLeafItem({
  item,
  compact = false,
  retryDisabled,
  retryLoading,
  onRetry,
}: {
  item: XDriveTransferTask
  compact?: boolean
  retryDisabled: boolean
  retryLoading: boolean
  onRetry?: (id: string) => void
}) {
  const percent = xDriveTransferPercent(item)
  const eta = xDriveTransferEtaMs(item)
  const active = xDriveTransferActive(item)
  const byteProgress = transferBytes(item)

  if (compact) {
    return (
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, px: 1.25, py: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" fontWeight={650} noWrap title={item.relative_path || item.path || item.file_name}>
                {item.relative_path || item.file_name || item.path || item.id}
              </Typography>
              <XDriveStatusBadge tone={transferTone(item.state)} label={xDriveTransferStateLabel(item.state)} />
            </Stack>
            {item.relative_path && item.relative_path !== item.file_name ? (
              <Typography variant="caption" color="text.secondary" noWrap display="block" title={item.relative_path}>
                {item.relative_path}
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

        <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mt: 0.75, mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">{byteProgress}</Typography>
          <Typography variant="caption" fontWeight={700}>
            {item.bytes_total > 0
              ? `${percent.toFixed(1)}%`
              : active ? xDriveTransferPhaseLabel(item.phase) || '处理中' : xDriveTransferStateLabel(item.state)}
          </Typography>
        </Stack>
        <LinearProgress
          variant={item.bytes_total > 0 ? 'determinate' : active ? 'indeterminate' : 'determinate'}
          value={item.bytes_total > 0 ? percent : item.state === 'completed' ? 100 : 0}
          sx={{ height: 5, borderRadius: 999 }}
        />
        <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ mt: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            {transferSpeed(item.instant_bytes_per_second)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            已耗时 {formatXDriveTransferDuration(item.elapsed_ms)}
          </Typography>
          {eta !== undefined ? (
            <Typography variant="caption" color="text.secondary">
              剩余约 {formatXDriveTransferDuration(eta)}
            </Typography>
          ) : null}
        </Stack>
        {item.error ? <XDriveStatusAlert tone="bad" sx={{ mt: 0.75 }}>{item.error}</XDriveStatusAlert> : null}
      </Box>
    )
  }

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

function TransferGroupItem({
  node,
  depth = 0,
  retryDisabled,
  retryingID,
  onRetry,
}: {
  node: XDriveTransferTreeNode
  depth?: number
  retryDisabled: boolean
  retryingID: string
  onRetry?: (id: string) => void
}) {
  const item = node.task
  const [expanded, setExpanded] = useState(() => xDriveTransferActive(item))
  const children = node.children.map((child) => child.task)
  const bytes = xDriveTransferAggregateBytes(item, children)
  const progress = xDriveTransferItemProgress(item, children)
  const percent = bytes.total > 0 ? Math.max(0, Math.min(100, bytes.done * 100 / bytes.total)) : 0
  const active = xDriveTransferActive(item)
  const scanIncomplete = item.scan_complete === false
  const eta = scanIncomplete ? undefined : xDriveTransferEtaMs({ ...item, bytes_done: bytes.done, bytes_total: bytes.total })
  const processed = Math.min(progress.total, progress.completed + progress.failed)
  const phaseLabel = xDriveTransferPhaseLabel(item.phase)
  const discoveredLabel = scanIncomplete
    ? `已发现 ${progress.total.toLocaleString('zh-CN')} 个文件${bytes.total > 0 ? ` · ${formatBinarySize(bytes.total)}` : ''}`
    : null

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1.25 }}>
        <Tooltip title={expanded ? '收起子任务' : '展开子任务'}>
          <IconButton
            size="small"
            aria-label={expanded ? '收起子任务' : '展开子任务'}
            onClick={() => setExpanded((value) => !value)}
            sx={{ width: 30, height: 30, borderRadius: 1 }}
          >
            {expanded ? <ExpandMoreRoundedIcon /> : <ChevronRightRoundedIcon />}
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant={depth === 0 ? 'subtitle2' : 'body2'} fontWeight={700} noWrap title={item.path || item.file_name}>
              {item.file_name || item.path || item.id}
            </Typography>
            <XDriveStatusBadge tone={transferTone(item.state)} label={xDriveTransferStateLabel(item.state)} />
            <Typography variant="caption" color="text.secondary">
              {xDriveTransferKindLabel(item.kind || item.direction)} · 文件夹任务
            </Typography>
          </Stack>
          {item.path && item.path !== item.file_name ? (
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {item.path}
            </Typography>
          ) : null}
        </Box>
        {item.state === 'failed' && item.retryable && onRetry ? (
          <XDriveActionButton
            compact
            disabled={retryDisabled}
            loading={retryingID === item.id}
            loadingLabel="正在重试…"
            onClick={() => onRetry(item.id)}
          >
            重试
          </XDriveActionButton>
        ) : null}
      </Stack>

      <Box sx={{ px: 1.75, pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" spacing={1} flexWrap="wrap" sx={{ mb: 0.75 }}>
          <Typography variant="body2">
            {bytes.total > 0
              ? `${formatBinarySize(bytes.done)} / ${formatBinarySize(bytes.total)}`
              : bytes.done > 0 ? formatBinarySize(bytes.done) : discoveredLabel || '等待扫描'}
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {scanIncomplete
              ? phaseLabel || '正在扫描'
              : bytes.total > 0
                ? `${percent.toFixed(1)}%`
                : active ? phaseLabel || '处理中' : xDriveTransferStateLabel(item.state)}
          </Typography>
        </Stack>

        <LinearProgress
          variant={scanIncomplete && bytes.done <= 0 ? 'indeterminate' : bytes.total > 0 ? 'determinate' : active ? 'indeterminate' : 'determinate'}
          value={bytes.total > 0 ? percent : item.state === 'completed' ? 100 : 0}
          sx={{ height: 7, borderRadius: 999, mb: 1 }}
        />

        {scanIncomplete ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            {discoveredLabel}{bytes.done > 0 && bytes.total > 0 ? ` · 基于当前已发现文件 ${percent.toFixed(1)}%` : ''}
          </Typography>
        ) : null}

        <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ mb: 1.25 }}>
          <Typography variant="caption">
            <strong>{processed.toLocaleString('zh-CN')}</strong> / {progress.total.toLocaleString('zh-CN')} 文件
          </Typography>
          <Typography variant="caption" color="text.secondary">成功 {progress.completed.toLocaleString('zh-CN')}</Typography>
          <Typography variant="caption" color={progress.failed > 0 ? 'error.main' : 'text.secondary'}>失败 {progress.failed.toLocaleString('zh-CN')}</Typography>
          <Typography variant="caption" color="text.secondary">传输中 {progress.running.toLocaleString('zh-CN')}</Typography>
          <Typography variant="caption" color="text.secondary">等待 {progress.queued.toLocaleString('zh-CN')}</Typography>
        </Stack>

        <XDriveDescriptionGrid columns={4}>
          <XDriveDescriptionItem label="阶段">{phaseLabel || xDriveTransferStateLabel(item.state)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="总体进度">{bytes.total > 0 ? `${percent.toFixed(1)}%` : '—'}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="当前速度">{transferSpeed(item.instant_bytes_per_second)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="平均速度">{transferSpeed(item.average_bytes_per_second)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="开始时间">{transferTime(item.started_at)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="已耗时">{formatXDriveTransferDuration(item.elapsed_ms)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="预计剩余">{eta === undefined ? (active && !scanIncomplete ? '计算中' : '—') : formatXDriveTransferDuration(eta)}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="重试次数">{item.retry_count.toLocaleString('zh-CN')}</XDriveDescriptionItem>
        </XDriveDescriptionGrid>
        {item.error ? <XDriveStatusAlert tone="bad" sx={{ mt: 1.25 }}>{item.error}</XDriveStatusAlert> : null}
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.default', px: 1.25, py: 1.25 }}>
          {node.children.length === 0 ? (
            <XDriveStatePanel variant="plain" compact message={scanIncomplete ? '正在发现子任务…' : '暂无子任务。'} />
          ) : (
            <Stack spacing={0.75}>
              {node.children.map((child) => (
                xDriveTransferIsGroup(child.task) ? (
                  <TransferGroupItem
                    key={child.task.id}
                    node={child}
                    depth={depth + 1}
                    retryDisabled={retryDisabled}
                    retryingID={retryingID}
                    onRetry={onRetry}
                  />
                ) : (
                  <TransferLeafItem
                    key={child.task.id}
                    item={child.task}
                    compact
                    retryDisabled={retryDisabled}
                    retryLoading={retryingID === child.task.id}
                    onRetry={onRetry}
                  />
                )
              ))}
            </Stack>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

function TransferTreeItem({
  node,
  retryDisabled,
  retryingID,
  onRetry,
}: {
  node: XDriveTransferTreeNode
  retryDisabled: boolean
  retryingID: string
  onRetry?: (id: string) => void
}) {
  if (xDriveTransferIsGroup(node.task)) {
    return (
      <TransferGroupItem
        node={node}
        retryDisabled={retryDisabled}
        retryingID={retryingID}
        onRetry={onRetry}
      />
    )
  }
  return (
    <TransferLeafItem
      item={node.task}
      retryDisabled={retryDisabled}
      retryLoading={retryingID === node.task.id}
      onRetry={onRetry}
    />
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
  const roots = xDriveTransferTree(transfers)
  const active = roots.filter(({ task }) => xDriveTransferActive(task))
  const completed = roots.filter(({ task }) => (
    task.state === 'completed' || task.state === 'partial' || task.state === 'cancelled'
  ))
  const failed = roots.filter(({ task }) => task.state === 'failed')

  if (loading && roots.length === 0) return <XDriveStatePanel loading message="正在加载传输记录…" />

  const groups: Array<[string, XDriveTransferTreeNode[]]> = [
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
              {items.map((node) => (
                <TransferTreeItem
                  key={node.task.id}
                  node={node}
                  retryDisabled={retryDisabled}
                  retryingID={retryingID}
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
