import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box as MuiBox,
  CircularProgress,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import { formatBytes, formatBytesPerSecond } from '@xdrive/shared'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

/** Snapshot is only a label: only full published Git Commits can establish equality. */
function releaseCommit(state: AgentUpdateState): string | undefined {
  const note = state.release_notes?.match(/\bXDRIVE_RELEASE_COMMIT=([0-9a-f]{40})\b/i)?.[1]
  const name = state.release_name?.match(/\b([0-9a-f]{40})\b/i)?.[1]
  const version = state.latest_version?.match(/\b([0-9a-f]{40})\b/i)?.[1]
  return (note || name || version)?.toLowerCase()
}
function updateStatusLabel(state: AgentUpdateState | null) {
  if (!state) return '未知'
  if (state.status === 'idle') return '等待检查'
  if (state.status === 'checking') return '正在检查'
  if (state.status === 'available') return '发现新版本'
  if (state.status === 'up_to_date') return '更新通道未发现新版本'
  if (state.status === 'downloading') return '正在下载'
  if (state.status === 'downloaded') return '已下载，等待安装'
  if (state.status === 'installing') return '正在安装'
  if (state.status === 'error') return '更新错误'
  return state.status
}

function updateModeDescription(mode: AgentUpdateMode) {
  if (mode === 'check') return 'Agent 会自动检查更新，但不会下载。'
  if (mode === 'download') return 'Agent 会自动检查并下载更新，等待你手动安装。'
  if (mode === 'install') return 'Agent 会自动检查、下载并安装更新。'
  return '只在你主动点击“检查更新”时访问更新源。'
}


export type DesktopClientUpdateProps = {
  busy: string
  updateSupported: boolean
  clientUpdate: AgentUpdateState | null
  updateOperationBusy: boolean
  updateCancelling: boolean
  updateCancelSupported: boolean
  updateProgress: number
  currentVersion?: string
  currentCommit?: string
  onUpdateSourceChange: (source: AgentUpdateSource) => void
  onUpdateModeChange: (mode: AgentUpdateMode) => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onCancelUpdate: () => void
}

export function DesktopClientUpdatePanel({
  busy,
  updateSupported,
  clientUpdate,
  updateOperationBusy,
  updateCancelling,
  updateCancelSupported,
  updateProgress,
  currentVersion,
  currentCommit,
  onUpdateSourceChange,
  onUpdateModeChange,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onCancelUpdate,
}: DesktopClientUpdateProps) {
  const installedCommit = currentCommit && /^[0-9a-f]{40}$/i.test(currentCommit) ? currentCommit.toLowerCase() : undefined
  const latestCommit = clientUpdate ? releaseCommit(clientUpdate) : undefined
  const commitMatches = Boolean(installedCommit && latestCommit && installedCommit === latestCommit)
  const commitDiffers = Boolean(installedCommit && latestCommit && installedCommit !== latestCommit)
  const operating = clientUpdate?.status === 'checking' || clientUpdate?.status === 'downloading' ||
    clientUpdate?.status === 'installing'
  const busyNow = Boolean(busy) || updateOperationBusy || operating
  const summary = !clientUpdate ? '正在读取版本'
    : clientUpdate.status === 'error' ? '更新检查失败'
    : clientUpdate.status === 'downloading' ? '正在下载更新'
    : clientUpdate.status === 'installing' ? '正在安装更新'
    : clientUpdate.status === 'checking' ? '正在检查更新'
    : clientUpdate.update_available ? (clientUpdate.downloaded ? '已下载更新，等待安装' : '发现可用更新')
    : clientUpdate.status === 'up_to_date' && commitDiffers ? '版本信息需要核对'
    : clientUpdate.status === 'up_to_date' && commitMatches ? '当前已是最新版本'
    : updateStatusLabel(clientUpdate)
  return (
  <Paper
    id="client-update-card"
    variant="outlined"
    sx={{
      p: { xs: 2, md: 2.5 },
      borderRadius: 2,
      display: 'grid',
      gap: 1.5,
      bgcolor: 'background.paper',
    }}
  >
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2.25}
      alignItems="flex-start"
      justifyContent="space-between"
    >
      <MuiBox sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>当前设备 · 更新通道</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
          仅更新本机 Desktop 与 Agent，不会自动升级 Server 或其他设备。
        </Typography>
      </MuiBox>

    </Stack>

    {!updateSupported ? (
      <XDriveStatusAlert tone="warning">当前 xdrive-agent 不支持更新设置，请先安装包含新 Agent 的统一客户端版本。</XDriveStatusAlert>
    ) : !clientUpdate ? (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
        <CircularProgress size={16} />
        <Typography variant="body2">正在读取客户端更新状态…</Typography>
      </Stack>
    ) : (
      <>
        <MuiBox role="status" aria-live="polite" sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Typography variant="h6" fontWeight={700} data-client-update-status>{summary}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ mt: 1.5 }}>
            <MuiBox sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">当前 Desktop</Typography>
              <Typography variant="body1" fontWeight={600}>
                {currentVersion || clientUpdate.current_version || '未知'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                Commit：{installedCommit ? installedCommit.slice(0, 12) : '未提供'}
              </Typography>
            </MuiBox>
            <MuiBox sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">更新通道中的版本</Typography>
              <Typography variant="body1" fontWeight={600}>{clientUpdate.latest_version || '尚未检查'}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                Commit：{latestCommit ? latestCommit.slice(0, 12) : '未提供'}
              </Typography>
            </MuiBox>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
            上次检查：{clientUpdate.last_checked_at ? new Date(clientUpdate.last_checked_at).toLocaleString() : '尚未检查'}
          </Typography>
        </MuiBox>
        {commitDiffers && clientUpdate.status === 'up_to_date' && !clientUpdate.update_available ? (
          <XDriveStatusAlert tone="warning">
            更新通道报告没有新版本，但当前 Desktop 与最新发布的完整 Commit 不一致。
            不能仅凭 snapshot 名称判断一致；请重新检查或查看发布详情。
          </XDriveStatusAlert>
        ) : null}
        {clientUpdate.status === 'up_to_date' && !clientUpdate.update_available && (!installedCommit || !latestCommit) ? (
          <Typography variant="caption" color="text.secondary">
            更新通道未报告新版本；缺少完整 Commit，尚不能证明安装的程序与发布版本完全一致。
          </Typography>
        ) : null}
        <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" fontWeight={600}>更新设置、发布说明与技术信息</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.5}>
      {updateSupported && clientUpdate ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ minWidth: { sm: 360 } }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="client-update-source-label">更新来源</InputLabel>
            <Select
              labelId="client-update-source-label"
              value={clientUpdate.source}
              label="更新来源"
              disabled={Boolean(busy) || updateOperationBusy}
              onChange={(event) => onUpdateSourceChange(event.target.value as AgentUpdateSource)}
            >
              <MenuItem value="github">GitHub</MenuItem>
              <MenuItem value="gitlab">GitLab</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 190 }}>
            <InputLabel id="client-update-mode-label">更新策略</InputLabel>
            <Select
              labelId="client-update-mode-label"
              value={clientUpdate.mode}
              label="更新策略"
              disabled={Boolean(busy) || updateOperationBusy}
              onChange={(event) => onUpdateModeChange(event.target.value as AgentUpdateMode)}
            >
              <MenuItem value="manual">手动检查</MenuItem>
              <MenuItem value="check">自动检查</MenuItem>
              <MenuItem value="download">有更新自动下载</MenuItem>
              <MenuItem value="install" disabled={!clientUpdate.install_supported}>自动更新</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      ) : null}
        {clientUpdate.release_notes ? (
          <MuiBox sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>发布说明</Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {clientUpdate.release_notes}
            </Typography>
          </MuiBox>
        ) : null}
        {clientUpdate.release_url ? (
          <MuiBox sx={{ mt: 1 }}>
            <XDriveActionButton compact onClick={() => void window.xdriveDesktop.openExternal(clientUpdate.release_url || '')}>
              查看发布页面
            </XDriveActionButton>
          </MuiBox>
        ) : null}

              <Typography variant="caption" color="text.secondary">
                {updateModeDescription(clientUpdate.mode)}
                仅影响 Agent 更新通道，不改变当前 Server Bundle 的下载顺序。
              </Typography>
              {installedCommit ? <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>本机 Commit：{installedCommit}</Typography> : null}
              {latestCommit ? <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>通道 Commit：{latestCommit}</Typography> : null}
              <Typography variant="caption">通道：{clientUpdate.channel || '未提供'} · 来源：{clientUpdate.source === 'gitlab' ? 'GitLab' : 'GitHub'}</Typography>
              {clientUpdate.bytes_total ? <Typography variant="caption">安装包大小：{formatBytes(clientUpdate.bytes_total)}</Typography> : null}
              {clientUpdate.published_at ? <Typography variant="caption">发布时间：{new Date(clientUpdate.published_at).toLocaleString()}</Typography> : null}
              {clientUpdate.last_error && clientUpdate.status !== 'error' ? (
                <Typography variant="caption" color="text.secondary">此前错误：{clientUpdate.last_error}</Typography>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                自动策略由 Agent 执行，约在启动 90 秒后首次检查，之后约每 6 小时检查。
              </Typography>
            </Stack>
          </AccordionDetails>
        </Accordion>
        {(clientUpdate.status === 'downloading' || clientUpdate.status === 'downloaded' || clientUpdate.status === 'installing') ? (
          <Stack spacing={0.75}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              justifyContent="space-between"
            >
              <Typography variant="caption" color="text.secondary">
                {clientUpdate.message || '正在处理更新…'}
              </Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                {clientUpdate.bytes_total
                  ? `${formatBytes(clientUpdate.bytes_done || 0)} / ${formatBytes(clientUpdate.bytes_total)} · ${updateProgress.toFixed(1)}%`
                  : clientUpdate.bytes_done
                    ? formatBytes(clientUpdate.bytes_done)
                    : ''}
              </Typography>
            </Stack>
            {clientUpdate.bytes_total ? (
              <LinearProgress variant="determinate" value={updateProgress} />
            ) : null}
            {clientUpdate.bytes_per_second ? (
              <Typography variant="caption" color="text.secondary">
                {formatBytesPerSecond(clientUpdate.bytes_per_second)}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {clientUpdate.status === 'error' && clientUpdate.last_error ? <XDriveStatusAlert tone="bad">{clientUpdate.last_error}</XDriveStatusAlert> : null}
        {clientUpdate.status === 'error' && !clientUpdate.last_error && clientUpdate.message ? <XDriveStatusAlert tone="bad">{clientUpdate.message}</XDriveStatusAlert> : null}

        {clientUpdate.downloaded && clientUpdate.update_available && !clientUpdate.install_supported ? (
          <XDriveStatusAlert tone="neutral">安装包已经下载。本机不支持自动安装，请使用系统安装程序。</XDriveStatusAlert>
        ) : null}
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" data-client-update-actions>
          {clientUpdate.update_available && !operating && (clientUpdate.install_supported || !clientUpdate.downloaded) ? (
            <XDriveActionButton intent="primary" disabled={busyNow}
              onClick={clientUpdate.install_supported ? onInstallUpdate : onDownloadUpdate}>
              {clientUpdate.install_supported
                ? (clientUpdate.downloaded ? '安装更新' : '下载并安装')
                : '下载更新'}
            </XDriveActionButton>
          ) : null}
          <XDriveActionButton
            disabled={busyNow}
            loading={busy === 'update-check' || clientUpdate.status === 'checking'}
            loadingLabel="正在检查…"
            onClick={onCheckUpdate}
          >
            {clientUpdate.status === 'error' ? '重新检查' : '检查更新'}
          </XDriveActionButton>
          {updateCancelSupported && (clientUpdate.status === 'checking' || clientUpdate.status === 'downloading') ? (
            <XDriveActionButton disabled={updateCancelling} loading={updateCancelling}
              loadingLabel="正在取消…" onClick={onCancelUpdate}>取消</XDriveActionButton>
          ) : null}
        </Stack>
      </>
    )}
  </Paper>
  )
}
