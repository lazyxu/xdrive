import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Box, Button, Stack, Typography, useTheme } from '@mui/material'
import {
  XDriveAppearanceThemeProvider,
  XDriveApp, XDriveSettingsDialog,
  xDriveWorkspaceHostSections,
  useXDriveWorkspaceNavigationState,
} from '@xdrive/ui/mui'
import type { XDriveSynologyBackupLocalClient } from '@xdrive/ui/mui'
import './styles.css'
import { createXDriveSynologyHost } from './synologyHost'

// DSM's local Agent and CGI must never be contacted from an insecure page.
// Render a fail-closed explanation instead of crashing before React mounts.
function createSecureSynologyHost() {
  if (window.location.protocol === 'https:') {
    // Preserve the canonical authenticated DSM Host factory; the insecure
    // branch never constructs the Agent CGI client.
    const host = createXDriveSynologyHost()
    return host
  }
  return null
}
const host = createSecureSynologyHost()

type OwnerConnectionCheck = 'unchecked' | 'checking' | 'verified' | 'unavailable'

/** Host-specific capability inside the canonical shared Settings dialog. */
function SynologyServerConnectionSettings({
  open, client,
}: { open: boolean; client: XDriveSynologyBackupLocalClient }) {
  const [status, setStatus] = useState<OwnerConnectionCheck>('unchecked')
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) {
      controllerRef.current?.abort()
      controllerRef.current = null
      setStatus('unchecked')
    }
    return () => controllerRef.current?.abort()
  }, [open])

  const verifyOwnerConnection = () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('checking')
    // Existing Owner-authorized Agent->Server quota read. This proves an
    // actual authorized read, not just a successful DSM browser session.
    // No credential, arbitrary URL, write capability or new CGI route.
    void client.ownerQuota(controller.signal).then(
      () => {
        if (controllerRef.current !== controller || controller.signal.aborted) return
        controllerRef.current = null
        setStatus('verified')
      },
      () => {
        if (controllerRef.current !== controller || controller.signal.aborted) return
        controllerRef.current = null
        setStatus('unavailable')
      },
    )
  }

  const statusText: Record<OwnerConnectionCheck, string> = {
    unchecked: '尚未检查当前 Agent 的 Server Owner 读取。',
    checking: '正在验证 DSM Agent 对当前 Server Owner 的授权读取…',
    verified: '已验证：当前 Agent 可以读取 Server Owner 配额。',
    unavailable: '当前无法验证 Server Owner 读取；可能是登录、Agent、网络或该读取能力不可用，并不等同于 Server 离线。',
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Server 连接</Typography>
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          DSM 使用本机受限 xdrive-agent 已登录的 Server 会话。验证只读取当前 Owner 配额，不更改服务器地址或账号。
        </Typography>
        <Box>
          <Button variant="outlined" disabled={status === 'checking'} onClick={verifyOwnerConnection}>
            检查 Server Owner 连接
          </Button>
        </Box>
        <Typography variant="body2" role="status"
          color={status === 'verified' ? 'success.main' : 'text.secondary'}>
          {statusText[status]}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          当前 DSM 网页不提供修改 Server 地址或登录凭据的接口。首次登录或更换地址，请在 NAS 上以受限 xdrivenas 用户使用 <code>xd login --server</code> 配置；不要将密码填写到 DSM 网页或运行在 root 账户下。
        </Typography>
      </Stack>
    </Box>
  )
}

function SynologyWorkspace({ host, appearance, onAppearanceChange }: {
  host: ReturnType<typeof createXDriveSynologyHost>
  appearance: 'system' | 'light' | 'dark'
  onAppearanceChange: (value: 'system' | 'light' | 'dark') => void
}) {
  const theme = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Shared application navigation owns the same-route refresh lifecycle,
  // Server-admin gate and disposable foreground priority for every Host.
  // DSM contributes only authenticated domain ports, never page-specific JSX.
  const { selected, pageRevision, navigate } = useXDriveWorkspaceNavigationState({
    // This entry is DSM-only; the Host adapter's public platform union is
    // deliberately broader and cannot be passed to the navigation hook.
    platform: 'synology',
    adminRoleVerified: host.adminRoleVerified === true,
  })

  return (
    <XDriveApp
      host={host}
      view={selected}
      shellSx={{ height: '100dvh', minHeight: 0 }}
      sidebar={{
        ariaLabel: 'xDrive NAS 应用导航',
        navAriaLabel: 'xDrive 功能导航',
        appearance: theme.palette.mode,
        showLocalStorage: true,
        compactPrimaryKeys: ['overview', 'files', 'gallery', 'transfers'],
        sections: xDriveWorkspaceHostSections({
          adminRoleVerified: host.adminRoleVerified === true,
        }),
      }}
      onNavigate={(key) => {
        if (key === 'settings') { setSettingsOpen(true); return }
        navigate(key)
      }}
      revision={pageRevision}
      overlays={
        <XDriveSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          appearance={appearance}
          onAppearanceChange={onAppearanceChange}
          subtitle="DSM 与 Desktop 共用设置对话框；连接检查只读取本机 Agent 的真实 Server Owner 状态。"
        >
          <Typography variant="body2" color="text.secondary">
            外观仅在当前窗口生效。套件、账号及备份配置仍通过现有 DSM 或 xDrive 管理入口执行。
          </Typography>
          {host.services?.localBackupClient ? (
            <SynologyServerConnectionSettings open={settingsOpen} client={host.services.localBackupClient} />
          ) : (
            <Typography variant="body2" role="status">DSM Agent 连接能力尚未接通。</Typography>
          )}
        </XDriveSettingsDialog>
      }
    />
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('DSM authenticated xDrive application root missing')
function SynologyApp() {
  const [appearance, setAppearance] = useState<'system' | 'light' | 'dark'>('system')
  return (
    <XDriveAppearanceThemeProvider appearance={appearance}>
      {host ? (
        <SynologyWorkspace host={host} appearance={appearance} onAppearanceChange={setAppearance} />
      ) : (
        <Box component="main" role="alert" sx={{ p: 3 }}>
          <Typography variant="h6">DSM 连接需要 HTTPS</Typography>
          <Typography variant="body2" color="text.secondary">
            请使用群晖 DSM 已验证的 HTTPS 地址打开 xDrive 套件。当前非 HTTPS 页面不会连接本机 Agent、显示 Owner 数据或接受备份操作。
          </Typography>
        </Box>
      )}
    </XDriveAppearanceThemeProvider>
  )
}

ReactDOM.createRoot(root).render(
  <React.StrictMode><SynologyApp /></React.StrictMode>,
)
