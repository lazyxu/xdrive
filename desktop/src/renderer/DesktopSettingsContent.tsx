import {
  Box as MuiBox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDriveSectionHeader,
  XDriveStatePanel,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import { formatBytes, formatBytesPerSecond } from '@xdrive/shared'
import { DesktopVirtualDriveSettings } from './DesktopVirtualDriveSettings'

function updateStatusLabel(state: AgentUpdateState | null) {
  if (!state) return '未知'
  if (state.status === 'idle') return '等待检查'
  if (state.status === 'checking') return '正在检查'
  if (state.status === 'available') return '发现新版本'
  if (state.status === 'up_to_date') return '已是最新'
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

export function DesktopSettingsContent({
  desktopPreferences,
  busy,
  onRestartAgent,
  onStartAtLoginChange,
  onCloseToTrayChange,
  updateSupported,
  clientUpdate,
  updateOperationBusy,
  updateCancelling,
  updateCancelSupported,
  updateProgress,
  currentVersion,
  onUpdateSourceChange,
  onUpdateModeChange,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onCancelUpdate,
  settings,
  mountPath,
  cacheLimit,
  platform,
  storagePoliciesSupported,
  onMountPathChange,
  onCacheLimitChange,
  onChooseMountPath,
  onSaveSettings,
  onOpenStorage,
}: {
  desktopPreferences: DesktopPreferences
  busy: string
  onRestartAgent: () => void
  onStartAtLoginChange: (enabled: boolean) => void
  onCloseToTrayChange: (enabled: boolean) => void
  updateSupported: boolean
  clientUpdate: AgentUpdateState | null
  updateOperationBusy: boolean
  updateCancelling: boolean
  updateCancelSupported: boolean
  updateProgress: number
  currentVersion?: string
  onUpdateSourceChange: (source: AgentUpdateSource) => void
  onUpdateModeChange: (mode: AgentUpdateMode) => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onCancelUpdate: () => void
  settings: AgentSettings | null
  mountPath: string
  cacheLimit: string
  platform?: string
  storagePoliciesSupported: boolean
  onMountPathChange: (value: string) => void
  onCacheLimitChange: (value: string) => void
  onChooseMountPath: () => void
  onSaveSettings: (event: React.FormEvent<HTMLFormElement>) => void
  onOpenStorage: () => void
}) {
  return (
    <>
      <XDriveSectionHeader
        level="h3"
        title="客户端设置"
        subtitle="启动行为、客户端更新、同步生命周期与本地缓存"
        actions={(
          <XDriveActionButton
            disabled={Boolean(busy)}
            loading={busy === 'restart-agent'}
            loadingLabel="正在重启 Agent…"
            onClick={onRestartAgent}
          >
            重启 Agent
          </XDriveActionButton>
        )}
      />

      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <FormControlLabel
          control={(
            <Switch
              checked={desktopPreferences.start_at_login}
              onChange={(event) => onStartAtLoginChange(event.target.checked)}
            />
          )}
          label="登录系统后启动 xDrive 桌面版"
        />
        <Typography variant="caption" color="text.secondary" sx={{ pl: 6 }}>
          启动后保持后台 Agent 正常运行；主窗口可按你的关闭偏好处理。
        </Typography>
        <FormControlLabel
          control={(
            <Switch
              checked={desktopPreferences.close_to_tray}
              onChange={(event) => onCloseToTrayChange(event.target.checked)}
            />
          )}
          label="关闭窗口时最小化到系统托盘"
        />
        <Typography variant="caption" color="text.secondary" sx={{ pl: 6 }}>
          开启后，点击关闭按钮只隐藏主窗口并继续同步；关闭后将直接退出 xDrive 桌面版。
        </Typography>
      </Stack>

      <Paper
        id="client-update-card"
        variant="outlined"
        sx={{
          mt: 1.75,
          p: 2,
          borderRadius: 1.75,
          display: 'grid',
          gap: 1.5,
          bgcolor: 'action.hover',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2.25}
          alignItems="flex-start"
          justifyContent="space-between"
        >
          <MuiBox sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
            <Typography variant="subtitle2" fontWeight={700}>客户端更新</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
              默认不自动更新。你可以选择只检查、自动下载，或自动下载安装。
            </Typography>
          </MuiBox>
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
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              当前来源：{clientUpdate.source === 'gitlab' ? 'GitLab · http://gitlab.t-fluid.com:1080' : 'GitHub'}。
              {' '}{updateModeDescription(clientUpdate.mode)}
              {!clientUpdate.install_supported ? ' 当前平台不会后台安装更新；下载后请使用系统包管理器完成安装。' : ''}
            </Typography>
            <XDriveMetricGrid>
              <XDriveMetricCard title="当前版本" value={clientUpdate.current_version || currentVersion || '未知'} />
              <XDriveMetricCard title="最新版本" value={clientUpdate.latest_version || '尚未检查'} />
              <XDriveMetricCard title="状态" value={updateStatusLabel(clientUpdate)} />
              <XDriveMetricCard title="发布时间" value={clientUpdate.published_at ? new Date(clientUpdate.published_at).toLocaleString() : '未知'} />
              <XDriveMetricCard title="发布名称" value={clientUpdate.release_name || clientUpdate.latest_version || '—'} />
              <XDriveMetricCard title="安装包大小" value={clientUpdate.bytes_total ? formatBytes(clientUpdate.bytes_total) : '未知'} />
              <XDriveMetricCard title="更新通道" value={clientUpdate.channel || '—'} />
              <XDriveMetricCard title="上次检查" value={clientUpdate.last_checked_at ? new Date(clientUpdate.last_checked_at).toLocaleString() : '尚未检查'} />
            </XDriveMetricGrid>
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

            {(clientUpdate.status === 'downloading' || clientUpdate.bytes_done || clientUpdate.bytes_total) ? (
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

            {clientUpdate.last_error ? <XDriveStatusAlert tone="bad">{clientUpdate.last_error}</XDriveStatusAlert> : null}
            {!clientUpdate.last_error && clientUpdate.message ? <XDriveStatusAlert tone="neutral">{clientUpdate.message}</XDriveStatusAlert> : null}

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <XDriveActionButton
                disabled={Boolean(busy) || updateOperationBusy}
                loading={busy === 'update-check' || clientUpdate.status === 'checking'}
                loadingLabel="正在检查…"
                onClick={onCheckUpdate}
              >
                检查更新
              </XDriveActionButton>
              <XDriveActionButton
                disabled={Boolean(busy) || updateOperationBusy || !clientUpdate.update_available || clientUpdate.downloaded}
                loading={busy === 'update-download' || clientUpdate.status === 'downloading'}
                loadingLabel="正在下载…"
                onClick={onDownloadUpdate}
              >
                {clientUpdate.downloaded ? '已下载' : '下载更新'}
              </XDriveActionButton>
              <XDriveActionButton
                intent="primary"
                disabled={Boolean(busy) || updateOperationBusy || !clientUpdate.update_available || !clientUpdate.install_supported}
                loading={busy === 'update-install' || clientUpdate.status === 'installing'}
                loadingLabel="正在安装…"
                onClick={onInstallUpdate}
              >
                {clientUpdate.downloaded ? '安装更新' : '下载并安装'}
              </XDriveActionButton>
              {updateCancelSupported && (clientUpdate.status === 'checking' || clientUpdate.status === 'downloading') ? (
                <XDriveActionButton
                  disabled={updateCancelling}
                  loading={updateCancelling}
                  loadingLabel="正在取消…"
                  onClick={onCancelUpdate}
                >
                  取消
                </XDriveActionButton>
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
              自动策略在 Agent 启动后约 90 秒首次运行，之后约每 6 小时检查一次；切换到自动策略时会立即检查一次。
            </Typography>
          </>
        )}
      </Paper>

      {!settings ? (
        <XDriveStatePanel loading message="正在加载设置…" />
      ) : (
        <DesktopVirtualDriveSettings
          settings={settings}
          mountPath={mountPath}
          cacheLimit={cacheLimit}
          platform={platform}
          storagePoliciesSupported={storagePoliciesSupported}
          busy={busy}
          onMountPathChange={onMountPathChange}
          onCacheLimitChange={onCacheLimitChange}
          onChooseMountPath={onChooseMountPath}
          onSaveSettings={onSaveSettings}
          onOpenStorage={onOpenStorage}
        />
      )}
    </>
  )
}
