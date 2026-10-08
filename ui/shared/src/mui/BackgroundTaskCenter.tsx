import {
  Box,
  Chip,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  formatXDriveTransferDuration,
  xDriveBackgroundTaskActive,
  xDriveBackgroundTaskControlCapabilityLabel,
  xDriveBackgroundTaskControlLabel,
  xDriveBackgroundTaskElapsedMs,
  xDriveBackgroundTaskKindLabel,
  xDriveBackgroundTaskPercent,
  xDriveBackgroundTaskProgressLabel,
  xDriveBackgroundTaskResourceLabel,
  xDriveBackgroundTaskStateLabel,
  xDriveBackgroundTaskTriggerLabel,
  type XDriveBackgroundTask,
  type XDriveBackgroundTaskControlAction,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'
import { XDriveTableSurface } from './TableSurface'

function taskTone(state: string) {
  if (state === 'completed') return 'good' as const
  if (state === 'failed') return 'bad' as const
  if (
    state === 'partial' ||
    state === 'issues' ||
    state === 'cancelled' ||
    state === 'cancelling' ||
    state === 'cancel_requested'
  ) return 'warning' as const
  return xDriveBackgroundTaskActive(state) ? 'busy' as const : 'neutral' as const
}

function taskTime(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function compactTaskKey(value: string) {
  if (value.length <= 28) return value
  return `${value.slice(0, 16)}…${value.slice(-8)}`
}

function BackgroundTaskOperationalMetadata({
  task,
  table = false,
}: {
  task: XDriveBackgroundTask
  table?: boolean
}) {
  const hasAttempt = (task.attempt ?? 0) > 0
  if (!hasAttempt && !task.retry_at && !task.trace_id && !task.parent_key) {
    return table ? (
      <Typography variant="caption" color="text.secondary">—</Typography>
    ) : null
  }

  const attemptLabel = task.active_count && task.active_count > 1
    ? `最高 #${task.attempt}`
    : `#${task.attempt}`

  return (
    <Stack
      direction={table ? 'column' : 'row'}
      spacing={table ? 0.25 : 2}
      alignItems={table ? 'flex-start' : 'center'}
      flexWrap="wrap"
    >
      {hasAttempt ? (
        <Typography variant="caption" color="text.secondary">
          尝试：{attemptLabel}
        </Typography>
      ) : null}
      {task.retry_at ? (
        <Typography variant="caption" color="text.secondary">
          下次尝试：{taskTime(task.retry_at)}
        </Typography>
      ) : null}
      {task.trace_id ? (
        <Typography variant="caption" color="text.secondary" title={task.trace_id}>
          Trace：<Box component="span" sx={{ fontFamily: 'monospace' }}>
            {compactTaskKey(task.trace_id)}
          </Box>
        </Typography>
      ) : null}
      {task.parent_key ? (
        <Typography variant="caption" color="text.secondary" title={task.parent_key}>
          父任务：<Box component="span" sx={{ fontFamily: 'monospace' }}>
            {compactTaskKey(task.parent_key)}
          </Box>
        </Typography>
      ) : null}
    </Stack>
  )
}

function BackgroundTaskControls({
  task,
  controlKey,
  onControl,
}: {
  task: XDriveBackgroundTask
  controlKey: string
  onControl?: (
    task: XDriveBackgroundTask,
    action: XDriveBackgroundTaskControlAction,
  ) => void
}) {
  const actions = task.control_actions ?? []
  if (actions.length === 0) return null

  if (!onControl) {
    return (
      <Stack direction="row" spacing={0.75} flexWrap="wrap">
        {actions.map((action) => (
          <Chip
            key={action}
            size="small"
            variant="outlined"
            label={xDriveBackgroundTaskControlCapabilityLabel(action)}
          />
        ))}
      </Stack>
    )
  }

  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap">
      {actions.map((action) => {
        const key = `${task.id}:${action}`
        const loading = controlKey === key
        return (
          <XDriveActionButton
            key={action}
            compact
            disabled={Boolean(controlKey) && !loading}
            loading={loading}
            loadingLabel="正在处理…"
            onClick={() => onControl(task, action)}
          >
            {xDriveBackgroundTaskControlLabel(action)}
          </XDriveActionButton>
        )
      })}
    </Stack>
  )
}

function BackgroundTaskItem({
  task,
  controlKey,
  focused = false,
  onControl,
}: {
  task: XDriveBackgroundTask
  controlKey: string
  focused?: boolean
  onControl?: (
    task: XDriveBackgroundTask,
    action: XDriveBackgroundTaskControlAction,
  ) => void
}) {
  const percent = xDriveBackgroundTaskPercent(task)
  const active = xDriveBackgroundTaskActive(task.state)
  const title = task.kind === 'source.sync' && task.source_name
    ? task.source_name
    : xDriveBackgroundTaskKindLabel(task.kind)

  return (
    <Box
      data-xdrive-background-task-id={task.id}
      tabIndex={focused ? -1 : undefined}
      sx={{
        border: 1,
        borderColor: focused ? 'primary.main' : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: focused ? 'action.selected' : undefined,
      }}
    >
      <Stack spacing={1.25} sx={{ px: 1.75, py: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
              <XDriveStatusBadge
                tone={taskTone(task.state)}
                label={xDriveBackgroundTaskStateLabel(task.state)}
              />
              {task.kind === 'source.sync' && task.source_kind ? (
                <Typography variant="caption" color="text.secondary">
                  {task.source_kind}
                </Typography>
              ) : null}
              {task.active_count && task.active_count > 1 ? (
                <Typography variant="caption" color="text.secondary">
                  {task.active_count.toLocaleString('zh-CN')} 个活动任务
                </Typography>
              ) : null}
              {task.instance_count && task.instance_count > 1 ? (
                <Typography variant="caption" color="text.secondary">
                  {task.instance_count.toLocaleString('zh-CN')} 台服务器
                </Typography>
              ) : null}
            </Stack>
            {task.progress?.current_item ? (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                title={task.progress.current_item}
              >
                当前：{task.progress.current_item}
              </Typography>
            ) : null}
          </Box>
          <BackgroundTaskControls
            task={task}
            controlKey={controlKey}
            onControl={onControl}
          />
        </Stack>

        <Stack direction="row" justifyContent="space-between" spacing={1}>
          <Typography variant="body2">{xDriveBackgroundTaskProgressLabel(task)}</Typography>
          <Typography variant="body2" fontWeight={700}>
            {percent === undefined
              ? xDriveBackgroundTaskStateLabel(task.state)
              : `${percent.toFixed(1)}%`}
          </Typography>
        </Stack>
        <LinearProgress
          variant={percent === undefined && active ? 'indeterminate' : 'determinate'}
          value={percent ?? (task.state === 'completed' ? 100 : 0)}
          sx={{ height: 7, borderRadius: 999 }}
        />
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={{ xs: 0.5, md: 2 }}
          flexWrap="wrap"
        >
          <Typography variant="caption" color="text.secondary">
            优先级：{task.priority === undefined ? '—' : `P${task.priority}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            资源：{xDriveBackgroundTaskResourceLabel(task.resource)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            触发：{xDriveBackgroundTaskTriggerLabel(task.trigger)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            开始：{taskTime(task.started_at)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            耗时：{task.started_at
              ? formatXDriveTransferDuration(xDriveBackgroundTaskElapsedMs(task))
              : '—'}
          </Typography>
        </Stack>
        <BackgroundTaskOperationalMetadata task={task} />
        {task.error ? <XDriveStatusAlert tone="bad">{task.error}</XDriveStatusAlert> : null}
      </Stack>
    </Box>
  )
}

export function XDriveBackgroundTaskList({
  tasks,
  loading = false,
  emptyMessage = '暂无任务',
  controlKey = '',
  focusedTaskID = '',
  onControl,
}: {
  tasks: XDriveBackgroundTask[]
  loading?: boolean
  emptyMessage?: string
  controlKey?: string
  focusedTaskID?: string
  onControl?: (
    task: XDriveBackgroundTask,
    action: XDriveBackgroundTaskControlAction,
  ) => void
}) {
  if (loading && tasks.length === 0) {
    return <XDriveStatePanel variant="plain" loading message="正在加载任务…" />
  }
  if (tasks.length === 0) {
    return <XDriveStatePanel variant="plain" message={emptyMessage} />
  }
  return (
    <Stack spacing={1.25}>
      {tasks.map((task) => (
        <BackgroundTaskItem
          key={task.id}
          task={task}
          controlKey={controlKey}
          focused={task.id === focusedTaskID}
          onControl={onControl}
        />
      ))}
    </Stack>
  )
}

export function XDriveBackgroundTaskTable({
  tasks,
  loading = false,
  controlKey = '',
  focusedTaskID = '',
  onControl,
}: {
  tasks: XDriveBackgroundTask[]
  loading?: boolean
  controlKey?: string
  focusedTaskID?: string
  onControl?: (
    task: XDriveBackgroundTask,
    action: XDriveBackgroundTaskControlAction,
  ) => void
}) {
  if (loading && tasks.length === 0) {
    return <XDriveStatePanel variant="plain" loading message="正在加载全局任务…" />
  }
  if (tasks.length === 0) {
    return <XDriveStatePanel variant="plain" message="暂无全局任务" />
  }
  return (
    <XDriveTableSurface>
      <Table size="small" aria-label="全局后台任务">
        <TableHead>
          <TableRow>
            <TableCell>用户</TableCell>
            <TableCell>任务类型</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>优先级</TableCell>
            <TableCell>资源类</TableCell>
            <TableCell>进度</TableCell>
            <TableCell>触发方式</TableCell>
            <TableCell>运维信息</TableCell>
            <TableCell>开始时间</TableCell>
            <TableCell>耗时</TableCell>
            <TableCell>控制能力</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.map((task) => (
            <TableRow
              key={task.id}
              hover
              selected={task.id === focusedTaskID}
              data-xdrive-background-task-id={task.id}
              tabIndex={task.id === focusedTaskID ? -1 : undefined}
            >
              <TableCell>
                {task.owner_username ||
                  (task.scope === 'system'
                    ? '系统'
                    : task.owner_id ? `#${task.owner_id}` : '—')}
              </TableCell>
              <TableCell>
                <Stack spacing={0.25}>
                  <Typography variant="body2" fontWeight={600}>
                    {task.kind === 'source.sync' && task.source_name
                      ? task.source_name
                      : xDriveBackgroundTaskKindLabel(task.kind)}
                  </Typography>
                  {task.kind === 'source.sync' ? (
                    <Typography variant="caption" color="text.secondary">
                      同步文件夹
                    </Typography>
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell>
                <Stack spacing={0.25} alignItems="flex-start">
                  <XDriveStatusBadge
                    tone={taskTone(task.state)}
                    label={xDriveBackgroundTaskStateLabel(task.state)}
                  />
                  {task.instance_count && task.instance_count > 1 ? (
                    <Typography variant="caption" color="text.secondary">
                      {task.instance_count.toLocaleString('zh-CN')} 台服务器
                    </Typography>
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell>
                {task.priority === undefined ? '—' : `P${task.priority}`}
              </TableCell>
              <TableCell>{xDriveBackgroundTaskResourceLabel(task.resource)}</TableCell>
              <TableCell>{xDriveBackgroundTaskProgressLabel(task)}</TableCell>
              <TableCell>{xDriveBackgroundTaskTriggerLabel(task.trigger)}</TableCell>
              <TableCell>
                <BackgroundTaskOperationalMetadata task={task} table />
              </TableCell>
              <TableCell>{taskTime(task.started_at)}</TableCell>
              <TableCell>
                {task.started_at
                  ? formatXDriveTransferDuration(xDriveBackgroundTaskElapsedMs(task))
                  : '—'}
              </TableCell>
              <TableCell>
                <BackgroundTaskControls
                  task={task}
                  controlKey={controlKey}
                  onControl={onControl}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </XDriveTableSurface>
  )
}
