import {
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import {
  XDriveActionButton,
  XDriveSectionHeader,
  XDriveStatePanel,
} from '@xdrive/ui/mui'
import { DesktopVirtualDriveSettings } from './DesktopVirtualDriveSettings'

export function DesktopSettingsContent({
  desktopPreferences,
  busy,
  onRestartAgent,
  onStartAtLoginChange,
  onCloseToTrayChange,
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
        subtitle="启动行为、同步生命周期与本地缓存"
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
