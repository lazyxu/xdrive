import {
  Box,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { formatBinarySize } from '../format'
import {
  xDriveServerUpdateChannels,
  xDriveServerUpdateProgress,
  xDriveServerUpdateSources,
  xDriveServerUpdateStateLabel,
  type XDriveServerUpdateChannel,
  type XDriveServerUpdateSource,
  type XDriveServerUpdateState,
} from '../server-update'
import { XDriveActionButton } from './ActionButton'
import { XDriveDescriptionGrid, XDriveDescriptionItem } from './DescriptionGrid'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'

function tone(state?: string) {
  if (state === 'success') return 'good' as const
  if (state === 'failed') return 'bad' as const
  if (state === 'queued') return 'warning' as const
  if (state === 'running') return 'busy' as const
  return 'neutral' as const
}

function time(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export function XDriveServerUpdateCard({
  state,
  source,
  channel,
  disabled = false,
  loading = false,
  onSourceChange,
  onChannelChange,
  onStart,
  sx,
}: {
  state: XDriveServerUpdateState | null
  source: XDriveServerUpdateSource
  channel: XDriveServerUpdateChannel
  disabled?: boolean
  loading?: boolean
  onSourceChange: (value: XDriveServerUpdateSource) => void
  onChannelChange: (value: XDriveServerUpdateChannel) => void
  onStart: () => void
  sx?: SxProps<Theme>
}) {
  const active = state?.state === 'queued' || state?.state === 'running'
  const progress = xDriveServerUpdateProgress(state)
  const supported = state?.supported !== false
  const buttonDisabled = disabled || active || !supported

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, ...sx }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle1" fontWeight={700}>服务端更新</Typography>
            <XDriveStatusBadge tone={tone(state?.state)} label={xDriveServerUpdateStateLabel(state)} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            更新由服务器宿主机执行，会自动沿用升级前备份、健康检查和失败回滚；更新期间 Web/API 可能短暂不可用。
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ minWidth: { md: 410 } }}>
          <FormControl size="small" sx={{ minWidth: 135 }}>
            <InputLabel id="server-update-source-label">更新来源</InputLabel>
            <Select
              labelId="server-update-source-label"
              value={source}
              label="更新来源"
              disabled={buttonDisabled}
              onChange={(event) => onSourceChange(event.target.value as XDriveServerUpdateSource)}
            >
              {xDriveServerUpdateSources.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="server-update-channel-label">更新通道</InputLabel>
            <Select
              labelId="server-update-channel-label"
              value={channel}
              label="更新通道"
              disabled={buttonDisabled}
              onChange={(event) => onChannelChange(event.target.value as XDriveServerUpdateChannel)}
            >
              {xDriveServerUpdateChannels.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <XDriveActionButton
            intent="primary"
            disabled={buttonDisabled}
            loading={loading || active}
            loadingLabel={state?.state === 'queued' ? '等待执行…' : '正在更新…'}
            onClick={onStart}
          >
            更新服务端
          </XDriveActionButton>
        </Stack>
      </Stack>

      {active || state?.state === 'success' || state?.state === 'failed' ? (
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.75 }}>
            <Typography variant="body2">{state?.stage || state?.message || xDriveServerUpdateStateLabel(state)}</Typography>
            <Typography variant="body2" fontWeight={700}>{progress.toFixed(1)}%</Typography>
          </Stack>
          <LinearProgress
            variant={progress > 0 || state?.state === 'success' ? 'determinate' : 'indeterminate'}
            value={progress}
            sx={{ height: 7, borderRadius: 999, mb: 1.5 }}
          />
          <XDriveDescriptionGrid columns={4}>
            <XDriveDescriptionItem label="来源">{state?.source || source}</XDriveDescriptionItem>
            <XDriveDescriptionItem label="通道">{state?.channel || channel}</XDriveDescriptionItem>
            <XDriveDescriptionItem label="阶段">
              {(state?.stage_current || 0) > 0 && (state?.stage_total || 0) > 0
                ? `${state?.stage_current} / ${state?.stage_total}`
                : '—'}
            </XDriveDescriptionItem>
            <XDriveDescriptionItem label="下载进度">
              {(state?.bytes_total || 0) > 0
                ? `${formatBinarySize(state?.bytes_done || 0)} / ${formatBinarySize(state?.bytes_total || 0)}`
                : '—'}
            </XDriveDescriptionItem>
            <XDriveDescriptionItem label="开始时间">{time(state?.started_at)}</XDriveDescriptionItem>
            <XDriveDescriptionItem label="更新时间">{time(state?.updated_at)}</XDriveDescriptionItem>
            <XDriveDescriptionItem label="完成时间">{time(state?.finished_at)}</XDriveDescriptionItem>
            <XDriveDescriptionItem label="请求 ID">{state?.request_id || '—'}</XDriveDescriptionItem>
          </XDriveDescriptionGrid>
        </Box>
      ) : null}

      {!supported ? (
        <XDriveStatusAlert tone="warning" sx={{ mt: 1.5 }}>
          {state?.message || '宿主机更新控制服务不可用。请先更新服务器安装组件。'}
        </XDriveStatusAlert>
      ) : state?.error ? (
        <XDriveStatusAlert tone="bad" sx={{ mt: 1.5 }}>{state.error}</XDriveStatusAlert>
      ) : state?.message && state.state !== 'idle' ? (
        <XDriveStatusAlert tone="neutral" sx={{ mt: 1.5 }}>{state.message}</XDriveStatusAlert>
      ) : null}
    </Box>
  )
}
