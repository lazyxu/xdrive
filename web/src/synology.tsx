import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Box, Button, Stack, TextField, Typography, useTheme } from '@mui/material'
import {
  XDriveAppearanceThemeProvider,
  XDriveApp, XDriveSettingsDialog,
  xDriveWorkspaceHostSections,
  useXDriveWorkspaceNavigationState,
} from '@xdrive/ui/mui'
import type { XDriveSynologyBackupLocalClient } from '@xdrive/ui/mui'
import './styles.css'
import { createXDriveSynologyHost } from './synologyHost'
import { readDSMLoginDraft, saveDSMLoginDraft } from './synologyLoginDraft'
import { xDriveDSMLoginInputError, xDriveDSMLoginOwnerError } from './synologyLoginPreflight'

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
  const [profileStatus, setProfileStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const initialLoginDraft = useRef(readDSMLoginDraft()).current
  const [server, setServer] = useState(initialLoginDraft.server)
  const [username, setUsername] = useState(initialLoginDraft.username)
  const [password, setPassword] = useState('')
  useEffect(() => {
    saveDSMLoginDraft(server, username)
  }, [server, username])
  const [showPassword, setShowPassword] = useState(false)
  const [loginState, setLoginState] = useState<'idle' | 'checking' | 'logging' | 'failed'>('idle')
  const [loginError, setLoginError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const profileRef = useRef<AbortController | null>(null)
  const loginRef = useRef<AbortController | null>(null)
  // A preflight can be cancelled. Once a login POST begins, a lost ACK may
  // conceal an Owner commit; its eventual outcome still reloads the page.
  const loginPhaseRef = useRef<'idle' | 'checking' | 'logging'>('idle')

  useEffect(() => {
    controllerRef.current?.abort()
    profileRef.current?.abort()
    // A submitted login may already have changed the owning Agent. Do not
    // cancel its browser observation on dialog close: completion must reload
    // the app and retire all potentially stale Owner-scoped UI state.
    if (!open) {
      if (loginPhaseRef.current === 'checking') {
        loginRef.current?.abort()
        loginRef.current = null
        loginPhaseRef.current = 'idle'
        setLoginState('idle')
      }
      controllerRef.current = null
      profileRef.current = null
      setStatus('unchecked')
      setProfileStatus('loading')
      setPassword('')
      setLoginError('')
      // Keep loginState=logging if the Agent request is still in flight.
      // It will reload even if this shared Settings dialog is closed.
      return
    }
    const controller = new AbortController()
    profileRef.current = controller
    setProfileStatus('loading')
    void client.serverConnection(controller.signal).then(
      info => {
        if (profileRef.current !== controller || controller.signal.aborted) return
        // An unconfigured Agent has no Owner to override a failed draft.
        // A configured Agent always wins to avoid cross-Owner confusion.
        if (info.configured) {
          setServer(info.server ?? '')
          setUsername(info.username ?? '')
        }
        setProfileStatus('ready')
      },
      () => {
        if (profileRef.current !== controller || controller.signal.aborted) return
        setProfileStatus('unavailable')
      },
    )
    return () => {
      controller.abort()
      controllerRef.current?.abort()
      if (loginPhaseRef.current === 'checking') {
        loginRef.current?.abort()
        loginRef.current = null
        loginPhaseRef.current = 'idle'
        // The Host can change while Settings is open. Re-enable inputs so
        // the new Agent's verified identity can be checked again.
        setLoginState('idle')
      }
    }
  }, [open, client])

  const verifyOwnerConnection = () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('checking')
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

  const login = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loginPhaseRef.current !== 'idle') return
    controllerRef.current?.abort()
    const requestedServer = server.trim()
    const requestedUsername = username.trim()
    const requestedPassword = password
    const inputError = xDriveDSMLoginInputError(requestedServer, requestedUsername, requestedPassword)
    if (inputError) {
      // No Agent operation has started; preserve the typed password in memory.
      setLoginError(inputError)
      setLoginState('failed')
      return
    }

    loginRef.current?.abort()
    const controller = new AbortController()
    loginRef.current = controller
    loginPhaseRef.current = 'checking'
    setLoginState('checking')
    setLoginError('')
    // An unreadable Agent is not a failed POST. Do not send or discard a
    // password simply because a read-only preflight cannot finish.
    void client.serverConnection(controller.signal).then(
      info => {
        if (loginRef.current !== controller || controller.signal.aborted) return
        const ownerError = xDriveDSMLoginOwnerError(requestedServer, requestedUsername, info)
        if (ownerError) {
          loginRef.current = null
          loginPhaseRef.current = 'idle'
          setProfileStatus('ready')
          setLoginError(ownerError)
          setLoginState('failed')
          return
        }
        setProfileStatus('ready')
        // A POST may have changed Owner before its ACK is lost. From this
        // boundary onward, reload on both success and ambiguous failure.
        loginPhaseRef.current = 'logging'
        setPassword('')
        setLoginState('logging')
        void client.loginServer(requestedServer, requestedUsername, requestedPassword, controller.signal).then(
          () => {
            if (loginRef.current !== controller || controller.signal.aborted) return
            loginRef.current = null
            loginPhaseRef.current = 'idle'
            window.location.reload()
          },
          () => {
            if (loginRef.current !== controller || controller.signal.aborted) return
            loginRef.current = null
            loginPhaseRef.current = 'idle'
            // HTTP failure may still follow a committed Owner change: discard
            // all shared Owner-scoped UI, thumbnails, caches and async reads.
            window.location.reload()
          },
        )
      },
      () => {
        if (loginRef.current !== controller || controller.signal.aborted) return
        loginRef.current = null
        loginPhaseRef.current = 'idle'
        setProfileStatus('unavailable')
        setLoginError('无法读取本机 Agent 的当前账户；未发送密码，输入仍保留。请检查套件连接后重试。')
        setLoginState('failed')
      },
    )
  }

  const statusText: Record<OwnerConnectionCheck, string> = {
    unchecked: '尚未检查当前 Agent 的 Server Owner 读取。',
    checking: '正在验证 DSM Agent 对当前 Server Owner 的授权读取…',
    verified: '已验证：当前 Agent 可以读取 Server Owner 配额。',
    unavailable: '无法验证当前 Server Owner 读取；请检查登录、证书、Agent 和网络。',
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Server 连接</Typography>
      <Stack spacing={1.25}>
        <Typography variant="body2" color="text.secondary">
          DSM 与 Desktop 使用同一个 Server 账户。首次登录或对相同账户重新登录时，凭据仅经过当前 DSM HTTPS 会话和本机 Agent。
          为避免已有本机备份跨 Owner 误操作，当前不允许直接切换到不同 Server 或账户。
        </Typography>
        {profileStatus === 'unavailable' ? (
          <Typography variant="body2" role="status">
            当前 Agent 登录状态暂不可读。请确认套件运行和 DSM 认证有效。
          </Typography>
        ) : null}
        <Box component="form" onSubmit={login}>
          <Stack spacing={1}>
            <TextField label="Server HTTPS 地址" size="small" type="url"
              autoComplete="url" value={server} onChange={(e) => setServer(e.target.value)}
              placeholder="https://192.168.1.2:8443" required
              disabled={loginState === 'logging' || loginState === 'checking'} />
            <TextField label="xDrive 用户名" size="small"
              autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)}
              required disabled={loginState === 'logging' || loginState === 'checking'} />
            <TextField label="密码" size="small"
              type={showPassword ? 'text' : 'password'} autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              required disabled={loginState === 'logging' || loginState === 'checking'} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" onClick={() => setShowPassword((value) => !value)}
                disabled={loginState === 'logging' || loginState === 'checking'}>
                {showPassword ? '隐藏密码' : '显示密码'}
              </Button>
              <Button type="submit" variant="contained"
                disabled={loginState === 'logging' || loginState === 'checking' || profileStatus === 'loading' ||
                  !server.trim() || !username.trim() || !password}>
                {loginState === 'checking' ? '正在检查 Agent…' : loginState === 'logging' ? '正在安全登录…' : '登录当前 Server'}
              </Button>
            </Stack>
          </Stack>
        </Box>
        {loginState === 'failed' ? (
          <Typography variant="body2" role="alert">
            {loginError || '未能完成经过 Owner 验证的登录。检查 HTTPS 证书和账户；如需切换其他 Server/Owner，先通过 NAS 本地管理入口安全迁移已有备份。'}
          </Typography>
        ) : null}
        <Button variant="outlined" sx={{ alignSelf: 'flex-start' }}
          disabled={status === 'checking' || loginState === 'logging' || loginState === 'checking'} onClick={verifyOwnerConnection}>
          检查 Server Owner 连接
        </Button>
        <Typography variant="body2" role="status"
          color={status === 'verified' ? 'success.main' : 'text.secondary'}>
          {statusText[status]}
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
          subtitle="DSM 与 Desktop 共用设置对话框；Server 登录使用本机受限 Agent。"
        >
          <Typography variant="body2" color="text.secondary">
            外观仅在当前窗口生效。Server 登录由受限 Agent 管理；备份源授权和套件设置仍遵循 DSM 权限。
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
