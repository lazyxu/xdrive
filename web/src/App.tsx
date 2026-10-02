import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import {
  AppBar,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import {
  XDriveAccountAvatarButton,
  XDriveAccountMenu,
  XDriveActionButton,
  XDriveBrandLockup,
  XDriveConfirmDialog,
  XDriveCoreWorkspaceNavItems,
  XDriveSettingsDialog,
  XDriveFeedbackSnackbar,
  XDriveMediaGalleryPage,
  XDriveSidebarNavItem,
  XDriveSidebarNavList,
  XDriveSidebarSurface,
  XDriveSidebarSection,
  XDriveSidebarStorageSummary,
  XDriveStatePanel,
  XDriveTaskCenterPage,
  XDrivePasswordChangeForm,
  xDrivePasswordChangeValidationError,
  XDriveFileNameDialog,
  XDriveTrashDialog,
  XDriveVersionHistoryDialog,
  XDriveWorkspaceSurface,
  XDriveWorkspaceShell,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import type { MediaGalleryDataSource, XDriveFileExplorerSort } from '@xdrive/ui/mui'
import { ApiError, XDriveApi, sessionFromAuth } from './api'
import type { AuthResult, AuthSession, BuildInfo } from './api'
import type {
  MeResult,
  Node,
  QuotaUsage,
  XDriveAppearance,
  XDriveServerUpdateChannel,
  XDriveServerUpdateSource,
  XDriveServerUpdateState,
  XDriveTransferTask,
  XDriveFileOperation,
} from '../../ui/shared/src'
import { xDriveFileOperationActive } from '../../ui/shared/src'
import AdminUsersPanel from './AdminUsers'
import AdminAuditPanel from './AdminAudit'
import PublicShareView from './PublicShare'
import ShareDialog from './ShareDialog'
import StorageStatsPanel from './StorageStatsPanel'
import ExternalSourcesPanel from './ExternalSources'
import WebFileExplorer from './WebFileExplorer'
import { createWebTrashDialogAdapter, createWebVersionHistoryDialogAdapter } from './fileDialogAdapters'
import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'

const ACCESS_KEY = 'xdrive.access_token'
const REFRESH_KEY = 'xdrive.refresh_token'
const EXPIRES_KEY = 'xdrive.access_expires_at'
const LEGACY_TOKEN_KEY = 'xdrive.token'
const USER_KEY = 'xdrive.username'

type Crumb = { id: number; name: string }

const DEFAULT_FILE_SORT: XDriveFileExplorerSort = { key: 'name', direction: 'asc' }
const FILE_PAGE_SIZE = 200

type DirectoryPageState = {
  parentID: number
  cursor: string
  hasMore: boolean
  sort: XDriveFileExplorerSort
}

type Feedback = {
  tone: 'good' | 'bad' | 'warning' | 'neutral'
  message: string
}

type ConfirmAction = {
  title: string
  description: string
  confirmLabel: string
  intent?: 'primary' | 'danger' | 'warning'
  run: () => Promise<void>
}

type AppView =
  | 'files'
  | 'gallery'
  | 'sources'
  | 'transfers'
  | 'storage'
  | 'admin-users'
  | 'admin-audit'
  | 'admin-storage'

function initialSession(): AuthSession {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY) ?? ''
  return {
    accessToken: localStorage.getItem(ACCESS_KEY) ?? legacy,
    refreshToken: localStorage.getItem(REFRESH_KEY) ?? '',
    accessExpiresAt: Number(localStorage.getItem(EXPIRES_KEY) ?? '0') || 0,
  }
}

function WebAccountMenu({
  username,
  api,
  serverBuild,
  appearance,
  canUpdateServer,
  onAppearanceChange,
  onLogout,
}: {
  username: string
  api: XDriveApi
  serverBuild: BuildInfo | null
  appearance: XDriveAppearance
  canUpdateServer: boolean
  onAppearanceChange: (appearance: XDriveAppearance) => void
  onLogout: () => void
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [serverUpdate, setServerUpdate] = useState<XDriveServerUpdateState | null>(null)
  const [serverUpdateSource, setServerUpdateSource] = useState<XDriveServerUpdateSource>('github')
  const [serverUpdateChannel, setServerUpdateChannel] = useState<XDriveServerUpdateChannel>(
    serverBuild?.channel === 'master' ? 'master' : 'stable',
  )
  const [serverUpdateBusy, setServerUpdateBusy] = useState(false)
  const [serverUpdateError, setServerUpdateError] = useState('')
  const [serverUpdateConfirmOpen, setServerUpdateConfirmOpen] = useState(false)

  useEffect(() => {
    if (!settingsOpen || !canUpdateServer) return
    let active = true
    const refresh = async () => {
      try {
        const state = await api.adminServerUpdate()
        if (!active) return
        if (serverUpdate === null) {
          setServerUpdateSource(state.source)
          setServerUpdateChannel(state.channel)
        }
        setServerUpdate(state)
        setServerUpdateError('')
      } catch (error) {
        if (!active) return
        setServerUpdateError(
          serverUpdate?.state === 'queued' || serverUpdate?.state === 'running'
            ? '服务端更新期间连接可能暂时中断，正在等待服务恢复…'
            : error instanceof Error ? error.message : '无法读取服务端更新状态。',
        )
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [api, canUpdateServer, settingsOpen, serverUpdate?.state])

  const startServerUpdate = async () => {
    setServerUpdateConfirmOpen(false)
    setServerUpdateBusy(true)
    setServerUpdateError('')
    try {
      const state = await api.adminStartServerUpdate(serverUpdateSource, serverUpdateChannel)
      setServerUpdate(state)
    } catch (error) {
      setServerUpdateError(error instanceof Error ? error.message : '提交服务端更新失败。')
    } finally {
      setServerUpdateBusy(false)
    }
  }

  return (
    <>
      <XDriveAccountAvatarButton username={username} onClick={(event) => setAnchorEl(event.currentTarget)} />
      <XDriveAccountMenu
        id="web-account-menu"
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        username={username}
        secondary={`Server ${serverBuild?.version || '未知'}`}
        status="已登录"
      >
        <MenuItem
          onClick={() => {
            setAnchorEl(null)
            setSettingsOpen(true)
          }}
        >
          <ListItemIcon><SettingsRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>设置</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            setAnchorEl(null)
            onLogout()
          }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}>
            <LogoutRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>退出登录</ListItemText>
        </MenuItem>
      </XDriveAccountMenu>
      <XDriveSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        subtitle="外观与服务端信息"
        appearance={appearance}
        onAppearanceChange={onAppearanceChange}
        buildInfo={[{ title: 'Server 构建信息', info: serverBuild }]}
        serverUpdate={{
          state: serverUpdate,
          source: serverUpdateSource,
          channel: serverUpdateChannel,
          loading: serverUpdateBusy,
          disabled: serverUpdate === null,
          canUpdate: canUpdateServer,
          unavailableMessage: '仅管理员可以更新服务端。',
          error: serverUpdateError,
          onSourceChange: setServerUpdateSource,
          onChannelChange: setServerUpdateChannel,
          onStart: () => setServerUpdateConfirmOpen(true),
        }}
      />
      <XDriveConfirmDialog
        open={serverUpdateConfirmOpen}
        title="确认更新服务端？"
        description={`来源：${serverUpdateSource === 'gitlab' ? 'GitLab' : 'GitHub'} · 通道：${serverUpdateChannel}。更新会执行升级前备份、容器更新和健康检查，期间 Web/API 可能短暂不可用。`}
        confirmLabel="开始更新"
        confirmIntent="warning"
        loading={serverUpdateBusy}
        loadingLabel="正在提交…"
        onCancel={() => setServerUpdateConfirmOpen(false)}
        onConfirm={() => void startServerUpdate()}
      />
    </>
  )
}

function App({
  appearance,
  onAppearanceChange,
}: {
  appearance: XDriveAppearance
  onAppearanceChange: (appearance: XDriveAppearance) => void
}) {
  const [session, setSession] = useState<AuthSession>(initialSession)
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY) ?? '')
  const [serverBuild, setServerBuild] = useState<BuildInfo | null>(null)
  const [authNotice, setAuthNotice] = useState('')

  const publicShareToken = useMemo(() => {
    const match = window.location.hash.match(/^#\/s\/([^/]+)\/?$/)
    if (!match) return ''
    try {
      return decodeURIComponent(match[1])
    } catch {
      return ''
    }
  }, [])

  const persistSession = useCallback((next: AuthSession) => {
    localStorage.setItem(ACCESS_KEY, next.accessToken)
    localStorage.setItem(LEGACY_TOKEN_KEY, next.accessToken)
    localStorage.setItem(REFRESH_KEY, next.refreshToken)
    localStorage.setItem(EXPIRES_KEY, String(next.accessExpiresAt))
    setSession(next)
  }, [])

  const clearSession = useCallback((notice = '') => {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(EXPIRES_KEY)
    localStorage.removeItem(USER_KEY)
    setSession({ accessToken: '', refreshToken: '', accessExpiresAt: 0 })
    setUsername('')
    setAuthNotice(notice)
  }, [])

  const api = useMemo(
    () => new XDriveApi(session, persistSession),
    [session.accessToken, session.refreshToken, session.accessExpiresAt, persistSession],
  )

  useEffect(() => {
    let active = true
    const refresh = () => {
      void api.serverVersion()
        .then((build) => { if (active) setServerBuild(build) })
        .catch(() => { if (active) setServerBuild(null) })
    }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [api])

  const signOut = () => {
    void api.logout().finally(() => clearSession())
  }

  if (publicShareToken) {
    return <PublicShareView token={publicShareToken} />
  }

  if (!session.accessToken) {
    return (
      <AuthView
        api={api}
        serverBuild={serverBuild}
        notice={authNotice}
        onAuthenticated={(result) => {
          setAuthNotice('')
          persistSession(sessionFromAuth(result))
          localStorage.setItem(USER_KEY, result.username)
          setUsername(result.username)
        }}
      />
    )
  }

  return (
    <FileManager
      api={api}
      username={username}
      serverBuild={serverBuild}
      appearance={appearance}
      onAppearanceChange={onAppearanceChange}
      onAuthExpired={(notice) => clearSession(notice)}
      onLogout={signOut}
    />
  )
}

function AuthView({
  api,
  serverBuild,
  notice,
  onAuthenticated,
}: {
  api: XDriveApi
  serverBuild: BuildInfo | null
  notice: string
  onAuthenticated: (result: AuthResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loginUsername, setLoginUsername] = useState('')
  const [password, setPassword] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const username = loginUsername.trim()
    const nextUsernameError = !username
      ? '请填写用户名'
      : username.length < 3 || username.length > 64
        ? '用户名长度需要 3–64 个字符'
        : ''
    const nextPasswordError = password.length < 8 || password.length > 128
      ? '密码长度需要 8–128 个字符'
      : ''
    setUsernameError(nextUsernameError)
    setPasswordError(nextPasswordError)
    if (nextUsernameError || nextPasswordError) return

    setBusy(true)
    setError('')
    try {
      onAuthenticated(await api.login(username, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <Card className="auth-card" sx={{ p: 3, borderRadius: 2 }}>
        <XDriveBrandLockup
          iconSrc={xDriveBrandIcon}
          variant="large"
          subtitle="将云端文件挂载为本地磁盘。"
          meta={<Chip size="small" label={`Server ${serverBuild?.version || '未知'}`} />}
        />

        {notice && <XDriveStatusAlert tone="warning" sx={{ mb: 2 }}>{notice}</XDriveStatusAlert>}
        {error && <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>{error}</XDriveStatusAlert>}

        <Stack component="form" spacing={2} onSubmit={(event) => void submit(event)}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="用户名"
            autoComplete="username"
            value={loginUsername}
            error={Boolean(usernameError)}
            helperText={usernameError || ' '}
            onChange={(event) => {
              setLoginUsername(event.target.value)
              if (usernameError) setUsernameError('')
            }}
          />
          <TextField
            fullWidth
            size="small"
            type="password"
            label="密码"
            autoComplete="current-password"
            value={password}
            error={Boolean(passwordError)}
            helperText={passwordError || ' '}
            onChange={(event) => {
              setPassword(event.target.value)
              if (passwordError) setPasswordError('')
            }}
          />
          <XDriveActionButton
            intent="primary"
            type="submit"
            fullWidth
            loading={busy}
            loadingLabel="正在登录…"
          >
            登录
          </XDriveActionButton>
        </Stack>

        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 2 }}>
          账户由 xDrive 管理员创建。
        </Typography>
      </Card>
    </div>
  )
}

function FileManager({
  api,
  username,
  serverBuild,
  appearance,
  onAppearanceChange,
  onAuthExpired,
  onLogout,
}: {
  api: XDriveApi
  username: string
  serverBuild: BuildInfo | null
  appearance: XDriveAppearance
  onAppearanceChange: (appearance: XDriveAppearance) => void
  onAuthExpired: (notice?: string) => void
  onLogout: () => void
}) {
  const [profile, setProfile] = useState<MeResult | null>(null)
  const [quota, setQuota] = useState<QuotaUsage | null>(null)
  const [items, setItems] = useState<Node[]>([])
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [directoryPage, setDirectoryPage] = useState<DirectoryPageState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [renameNode, setRenameNode] = useState<Node | null>(null)
  const [appView, setAppView] = useState<AppView>('files')
  const [transfers, setTransfers] = useState<XDriveTransferTask[]>(() => api.transfers())
  const [fileOperations, setFileOperations] = useState<XDriveFileOperation[]>([])
  const [fileOperationAction, setFileOperationAction] = useState('')
  const fileOperationStatusRef = useRef(new Map<string, string>())
  const [trashOpen, setTrashOpen] = useState(false)
  const [historyNode, setHistoryNode] = useState<Node | null>(null)
  const [shareNode, setShareNode] = useState<Node | null>(null)
  const [passwordValues, setPasswordValues] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const current = crumbs.at(-1)

  const trashDialogAdapter = useMemo(() => createWebTrashDialogAdapter(api), [api])
  const versionHistoryDialogAdapter = useMemo(() => createWebVersionHistoryDialogAdapter(api), [api])

  const gallerySource = useMemo<MediaGalleryDataSource>(() => ({
    listItems: (limit, offset) => api.mediaItems('', limit, offset),
    listAlbums: () => api.mediaAlbums(),
    listAlbumItems: (albumID, limit, offset) => api.mediaAlbumItems(albumID, limit, offset),
    loadThumbnail: async (nodeID) => URL.createObjectURL(await api.mediaThumbnail(nodeID)),
    loadLivePhotoMotion: async (nodeID) => URL.createObjectURL(await api.mediaLivePhotoMotion(nodeID)),
  }), [api])

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.message.includes('account_disabled')) {
        onAuthExpired('登录状态已失效，请重新登录。')
        return
      }
      if (err.message.includes('password_change_required')) {
        setProfile((currentProfile) => currentProfile ? { ...currentProfile, must_change_password: true } : currentProfile)
        setFeedback({ tone: 'warning', message: '请先修改密码，再使用文件功能。' })
        return
      }
      if (err.status === 507 && err.message.includes('quota_exceeded')) {
        setFeedback({ tone: 'bad', message: '剩余存储配额不足（包含进行中上传的预占空间）。请释放空间、等待/取消其他上传，或联系管理员提高配额。' })
        return
      }
      if (err.status === 507 && err.message.includes('storage_capacity_exceeded')) {
        setFeedback({ tone: 'bad', message: '服务器存储空间不足。请释放服务器磁盘空间后重试。' })
        return
      }
    }
    setFeedback({ tone: 'bad', message: err instanceof Error ? err.message : '请求失败' })
  }, [onAuthExpired])

  const loadDirectory = async (
    id: number,
    nextCrumbs?: Crumb[],
    sort: XDriveFileExplorerSort = directoryPage?.sort ?? DEFAULT_FILE_SORT,
  ) => {
    setLoading(true)
    try {
      const page = await api.listPage(id, {
        limit: FILE_PAGE_SIZE,
        sort: sort.key,
        order: sort.direction,
      })
      setItems(page.items)
      setDirectoryPage({
        parentID: id,
        cursor: page.next_cursor ?? '',
        hasMore: page.has_more,
        sort,
      })
      if (nextCrumbs) setCrumbs(nextCrumbs)
    } catch (err) {
      handleError(err)
    } finally {
      setLoading(false)
    }
  }

  const loadMoreDirectory = async (id: number, sort: XDriveFileExplorerSort) => {
    const pageState = directoryPage
    if (
      !pageState ||
      pageState.parentID !== id ||
      !pageState.hasMore ||
      !pageState.cursor ||
      pageState.sort.key !== sort.key ||
      pageState.sort.direction !== sort.direction ||
      loadingMore
    ) return

    setLoadingMore(true)
    try {
      const page = await api.listPage(id, {
        limit: FILE_PAGE_SIZE,
        cursor: pageState.cursor,
        sort: sort.key,
        order: sort.direction,
      })
      setItems((currentItems) => {
        const merged = new Map(currentItems.map((item) => [item.id, item]))
        for (const item of page.items) merged.set(item.id, item)
        return [...merged.values()]
      })
      setDirectoryPage({
        parentID: id,
        cursor: page.next_cursor ?? '',
        hasMore: page.has_more,
        sort,
      })
    } catch (err) {
      handleError(err)
    } finally {
      setLoadingMore(false)
    }
  }

  const refreshQuota = async () => {
    try {
      setQuota(await api.quota())
    } catch (err) {
      handleError(err)
    }
  }

  const loadInitial = async () => {
    setLoading(true)
    try {
      const me = await api.me()
      setProfile(me)
      if (me.must_change_password) return
      setQuota(await api.quota())
      const root = await api.root()
      const page = await api.listPage(root.id, {
        limit: FILE_PAGE_SIZE,
        sort: DEFAULT_FILE_SORT.key,
        order: DEFAULT_FILE_SORT.direction,
      })
      setCrumbs([{ id: root.id, name: '我的文件' }])
      setItems(page.items)
      setDirectoryPage({
        parentID: root.id,
        cursor: page.next_cursor ?? '',
        hasMore: page.has_more,
        sort: DEFAULT_FILE_SORT,
      })
    } catch (err) {
      handleError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!active) return
      await loadInitial()
    })()
    return () => { active = false }
    // api changes when auth tokens rotate; reload identity and data then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => api.onTransfers(setTransfers), [api])

  const refreshFileOperations = useCallback(async () => {
    const operations = await api.fileOperations(100)
    setFileOperations(operations)
    return operations
  }, [api])

  useEffect(() => {
    if (!profile || profile.must_change_password) return
    let active = true
    const refresh = async () => {
      try {
        const operations = await api.fileOperations(100)
        if (active) setFileOperations(operations)
      } catch {
        // Background task polling must not turn a transient network failure into repeated UI alerts.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [api, profile?.id, profile?.must_change_password])

  useEffect(() => {
    const previous = fileOperationStatusRef.current
    let shouldRefreshFiles = false
    const next = new Map<string, string>()
    for (const operation of fileOperations) {
      const previousStatus = previous.get(operation.id)
      if (
        previousStatus &&
        xDriveFileOperationActive(previousStatus) &&
        !xDriveFileOperationActive(operation.status)
      ) {
        shouldRefreshFiles = true
      }
      next.set(operation.id, operation.status)
    }
    fileOperationStatusRef.current = next
    if (!shouldRefreshFiles || !current) return
    void loadDirectory(current.id, crumbs, directoryPage?.sort ?? DEFAULT_FILE_SORT)
    void refreshQuota()
    // Directory/task transitions are intentionally keyed only by operation snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileOperations])

  useEffect(() => {
    if (!profile || profile.must_change_password) return
    const timer = window.setInterval(() => {
      void api.quota()
        .then(setQuota)
        .catch(handleError)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [api, handleError, profile?.id, profile?.must_change_password])

  useEffect(() => {
    if (profile && profile.role !== 'admin' && appView.startsWith('admin-')) {
      setAppView('files')
    }
  }, [appView, profile])

  const executeConfirm = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmBusy(true)
    try {
      await action.run()
      setConfirmAction(null)
    } catch (err) {
      setConfirmAction(null)
      handleError(err)
    } finally {
      setConfirmBusy(false)
    }
  }

  if (profile?.must_change_password) {
    const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const validationError = xDrivePasswordChangeValidationError(passwordValues)
      if (validationError) {
        setPasswordError(validationError)
        return
      }
      try {
        await api.changePassword(passwordValues.current, passwordValues.next)
        setPasswordValues({ current: '', next: '', confirm: '' })
        setPasswordError('')
        setFeedback({ tone: 'good', message: '密码已修改' })
        setProfile({ ...profile, must_change_password: false })
      } catch (err) {
        handleError(err)
      }
    }

    return (
      <Box className="app-shell" sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar
          position="static"
          elevation={0}
          color="inherit"
          className="web-appbar"
          sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
          <Toolbar className="topbar">
            <XDriveBrandLockup iconSrc={xDriveBrandIcon} variant="titlebar" />
            <WebAccountMenu
              username={username}
              api={api}
              serverBuild={serverBuild}
              canUpdateServer={profile?.role === 'admin' && !profile.must_change_password}
              appearance={appearance}
              onAppearanceChange={onAppearanceChange}
              onLogout={onLogout}
            />
          </Toolbar>
        </AppBar>
        <Box component="main" className="content-wrap">
          <Card className="auth-card" sx={{ p: 3, mx: 'auto', borderRadius: 2 }}>
            <Typography component="h2" variant="h6" fontWeight={700} sx={{ mb: 2 }}>
              修改临时密码
            </Typography>
            <XDriveStatusAlert tone="warning" sx={{ mb: 2 }}>
              管理员要求先修改密码，之后才能访问文件。
            </XDriveStatusAlert>
            <XDrivePasswordChangeForm
              values={passwordValues}
              error={passwordError}
              onChange={(field, value) => {
                setPasswordValues((currentValues) => ({ ...currentValues, [field]: value }))
                if (passwordError) setPasswordError('')
              }}
              onSubmit={(event) => { void submitPassword(event) }}
            />
          </Card>
        </Box>
        <XDriveFeedbackSnackbar
          open={Boolean(feedback)}
          tone={feedback?.tone ?? 'neutral'}
          message={feedback?.message ?? ''}
          onClose={() => setFeedback(null)}
        />
      </Box>
    )
  }

  const uploadFilesTo = async (parentID: number, files: File[]) => {
    if (files.length === 0) return
    for (const file of files) {
      try {
        setUploadProgress(0)
        await api.upload(parentID, file, setUploadProgress)
        setFeedback({ tone: 'good', message: `${file.name} 已上传` })
      } catch (err) {
        handleError(err)
        break
      } finally {
        setUploadProgress(null)
      }
    }
    if (current) await loadDirectory(current.id)
    await refreshQuota()
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!current || !files?.length) return
    await uploadFilesTo(current.id, Array.from(files))
  }

  const createFolder = async (name: string) => {
    if (!current) return
    await api.createDirectory(current.id, name)
    await loadDirectory(current.id)
  }

  const rename = async (name: string) => {
    if (!renameNode || !current) return
    await api.rename(renameNode.id, renameNode.revision, name)
    await loadDirectory(current.id)
  }

  const remove = (node: Node) => {
    setConfirmAction({
      title: `将 ${node.name} 移到回收站？`,
      description: node.type === 'dir'
        ? '该文件夹及其中的全部内容会从同步文件夹中移除，但之后仍可恢复。'
        : '该文件会从同步文件夹中移除，但之后仍可恢复。',
      confirmLabel: '移到回收站',
      intent: 'danger',
      run: async () => {
        await api.remove(node.id, node.revision)
        setFeedback({ tone: 'good', message: '已移到回收站' })
        if (current) await loadDirectory(current.id)
        await refreshQuota()
      },
    })
  }

  const rememberFileOperation = (operation: XDriveFileOperation) => {
    fileOperationStatusRef.current.set(operation.id, operation.status)
    setFileOperations((currentOperations) => [
      operation,
      ...currentOperations.filter((item) => item.id !== operation.id),
    ])
  }

  const cancelFileOperation = async (id: string) => {
    setFileOperationAction(`cancel:${id}`)
    try {
      rememberFileOperation(await api.cancelFileOperation(id))
      await refreshFileOperations()
    } catch (error) {
      handleError(error)
    } finally {
      setFileOperationAction('')
    }
  }

  const retryFileOperation = async (id: string) => {
    setFileOperationAction(`retry:${id}`)
    try {
      const operation = await api.retryFileOperation(id)
      rememberFileOperation(operation)
      setFeedback({ tone: 'good', message: '文件操作已重新加入队列。' })
      await refreshFileOperations()
    } catch (error) {
      handleError(error)
    } finally {
      setFileOperationAction('')
    }
  }

  const clearTaskHistory = async () => {
    setFileOperationAction('clear-history')
    try {
      await api.clearFileOperationHistory()
      api.clearTransferHistory()
      await refreshFileOperations()
      setFeedback({ tone: 'good', message: '已清空已完成、失败和已取消的任务历史。' })
    } catch (error) {
      handleError(error)
    } finally {
      setFileOperationAction('')
    }
  }

  const removeMany = (nodes: Node[]) => {
    if (nodes.length === 0) return
    setConfirmAction({
      title: `将所选 ${nodes.length} 个项目移到回收站？`,
      description: '所选文件和文件夹会从同步文件夹中移除，但之后仍可从回收站恢复。',
      confirmLabel: '移到回收站',
      intent: 'danger',
      run: async () => {
        const operation = await api.createFileOperation(
          'delete',
          nodes.map((node) => ({ id: node.id, revision: node.revision })),
        )
        rememberFileOperation(operation)
        setFeedback({ tone: 'good', message: `已将 ${nodes.length} 个项目加入删除任务。` })
      },
    })
  }

  const openTrash = () => setTrashOpen(true)

  const openHistory = (node: Node) => setHistoryNode(node)

  return (
    <Box
      className="app-shell file-manager-shell"
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        display: { xs: 'block', md: 'flex' },
        flexDirection: { md: 'column' },
      }}
    >
      <AppBar
          position="static"
          elevation={0}
          color="inherit"
          className="web-appbar"
          sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
        <Toolbar className="topbar">
          <XDriveBrandLockup iconSrc={xDriveBrandIcon} variant="titlebar" />
          <WebAccountMenu
              username={username}
              api={api}
              serverBuild={serverBuild}
              canUpdateServer={profile?.role === 'admin' && !profile.must_change_password}
              appearance={appearance}
              onAppearanceChange={onAppearanceChange}
              onLogout={onLogout}
            />
        </Toolbar>
      </AppBar>

      <XDriveWorkspaceShell
        responsive
        className="web-workspace-shell"
        sx={{ flex: { md: 1 }, minHeight: { md: 0 } }}
      >
        <XDriveSidebarSurface ariaLabel="网页端功能区" responsive>
          <XDriveSidebarNavList ariaLabel="网页端功能区导航" responsive>
            <XDriveCoreWorkspaceNavItems
              selected={appView}
              transferBadge={(transfers.filter((item) => item.state === 'running' || item.state === 'retrying').length + fileOperations.filter((item) => xDriveFileOperationActive(item.status)).length) || undefined}
              onSelect={(destination) => setAppView(destination)}
            />
          </XDriveSidebarNavList>

          {profile?.role === 'admin' && (
            <XDriveSidebarSection label="管理" responsive>
              <XDriveSidebarNavList ariaLabel="管理员功能" responsive>
                <XDriveSidebarNavItem
                  selected={appView === 'admin-users'}
                  icon={<ManageAccountsRoundedIcon fontSize="small" />}
                  primary="用户管理"
                  onClick={() => setAppView('admin-users')}
                />
                <XDriveSidebarNavItem
                  selected={appView === 'admin-audit'}
                  icon={<AssessmentRoundedIcon fontSize="small" />}
                  primary="审计日志"
                  onClick={() => setAppView('admin-audit')}
                />
                <XDriveSidebarNavItem
                  selected={appView === 'admin-storage'}
                  icon={<StorageRoundedIcon fontSize="small" />}
                  primary="全局存储"
                  onClick={() => setAppView('admin-storage')}
                />
              </XDriveSidebarNavList>
            </XDriveSidebarSection>
          )}

          {quota && (
            <Box sx={{ display: { xs: 'none', md: 'block' }, mt: 'auto', pt: 1.5 }}>
              <XDriveSidebarStorageSummary
                usedBytes={quota.physical_used_bytes}
                totalBytes={quota.quota_bytes}
                diskAvailableBytes={quota.disk_available_bytes}
              />
            </Box>
          )}
        </XDriveSidebarSurface>

        <Box
          component="main"
          className={appView === 'files' ? 'content-wrap files-workspace' : 'content-wrap'}
          sx={{
            minWidth: 0,
            minHeight: 0,
            width: '100%',
            overflowY: { md: appView === 'files' ? 'hidden' : 'auto' },
          }}
        >
        {appView === 'files' ? (
          <Box
            className="files-workspace-surface"
            sx={{
              height: { xs: 560, md: '100%' },
              minHeight: { xs: 480, md: 0 },
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
            }}
          >
              <WebFileExplorer
                api={api}
                items={items}
                crumbs={crumbs}
                loading={loading}
                loadingMore={loadingMore}
                hasMore={directoryPage?.hasMore ?? false}
                uploadProgress={uploadProgress}
                onLoadDirectory={loadDirectory}
                onLoadMore={loadMoreDirectory}
                onUploadFiles={uploadFiles}
                onUploadDroppedFiles={uploadFilesTo}
                onCreateFolder={() => setFolderOpen(true)}
                onOpenTrash={openTrash}
                onRename={setRenameNode}
                onRemove={remove}
                onRemoveMany={removeMany}
                onOperationQueued={rememberFileOperation}
                onFeedback={(tone, message) => setFeedback({ tone, message })}
                onShare={setShareNode}
                onHistory={openHistory}
                onError={handleError}
              />
          </Box>
        ) : appView === 'gallery' ? (
          <XDriveWorkspaceSurface presentation="page" title="图库">
            <XDriveMediaGalleryPage source={gallerySource} onError={handleError} />
          </XDriveWorkspaceSurface>
        ) : appView === 'sources' ? (
          <ExternalSourcesPanel
            api={api}
            defaultTargetNodeID={current?.id}
            defaultTargetLabel={current?.name ?? '我的文件'}
            defaultTargetPath={crumbs.slice(1).map((crumb) => crumb.name).join('/')}
            onError={handleError}
          />
        ) : appView === 'transfers' ? (
          <XDriveTaskCenterPage
            transfers={transfers}
            operations={fileOperations}
            clearHistory={{
              disabled: (
                !transfers.some((item) => item.state === 'completed' || item.state === 'failed') &&
                !fileOperations.some((item) => !xDriveFileOperationActive(item.status))
              ) || Boolean(fileOperationAction),
              loading: fileOperationAction === 'clear-history',
              onClear: () => { void clearTaskHistory() },
            }}
            operationCancellingID={fileOperationAction.startsWith('cancel:') ? fileOperationAction.slice('cancel:'.length) : ''}
            operationRetryingID={fileOperationAction.startsWith('retry:') ? fileOperationAction.slice('retry:'.length) : ''}
            operationDisabled={Boolean(fileOperationAction)}
            onCancelOperation={(id) => { void cancelFileOperation(id) }}
            onRetryOperation={(id) => { void retryFileOperation(id) }}
          />
        ) : appView === 'storage' ? (
          <StorageStatsPanel
            api={api}
            scope="self"
          />
        ) : appView === 'admin-users' && profile?.role === 'admin' ? (
          <AdminUsersPanel
            api={api}
            currentUserID={profile.id}
            onChanged={() => { void refreshQuota() }}
          />
        ) : appView === 'admin-audit' && profile?.role === 'admin' ? (
          <AdminAuditPanel api={api} />
        ) : appView === 'admin-storage' && profile?.role === 'admin' ? (
          <StorageStatsPanel
            api={api}
            scope="global"
          />
        ) : (
          <Box className="files-workspace-surface" sx={{ height: { xs: 560, md: '100%' }, minHeight: { xs: 480, md: 0 } }}>
            <XDriveStatePanel variant="plain" loading message="正在切换工作区…" />
          </Box>
        )}
        </Box>
      </XDriveWorkspaceShell>

      <XDriveFileNameDialog
        open={folderOpen}
        mode="create-folder"
        onClose={() => setFolderOpen(false)}
        onSubmit={createFolder}
        onError={handleError}
      />

      <XDriveFileNameDialog
        open={Boolean(renameNode)}
        mode="rename"
        initialValue={renameNode?.name ?? ''}
        onClose={() => setRenameNode(null)}
        onSubmit={rename}
        onError={handleError}
      />

      <XDriveTrashDialog
        open={trashOpen}
        adapter={trashDialogAdapter}
        onClose={() => setTrashOpen(false)}
        onError={handleError}
        onFeedback={(message) => setFeedback({ tone: 'good', message })}
        onChanged={async () => {
          if (current) await loadDirectory(current.id)
          await refreshQuota()
        }}
      />

      <XDriveVersionHistoryDialog
        node={historyNode}
        adapter={versionHistoryDialogAdapter}
        onClose={() => setHistoryNode(null)}
        onError={handleError}
        onFeedback={(message) => setFeedback({ tone: 'good', message })}
        onRestored={async (restored) => {
          setHistoryNode(restored)
          if (current) await loadDirectory(current.id)
          await refreshQuota()
        }}
      />

      <XDriveConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title ?? '确认操作'}
        description={confirmAction?.description}
        confirmLabel={confirmAction?.confirmLabel ?? '确认'}
        confirmIntent={confirmAction?.intent ?? 'primary'}
        loading={confirmBusy}
        loadingLabel="正在处理…"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void executeConfirm()}
      />

      <ShareDialog api={api} node={shareNode} onClose={() => setShareNode(null)} onError={handleError} />

      <XDriveFeedbackSnackbar
        open={Boolean(feedback)}
        tone={feedback?.tone ?? 'neutral'}
        message={feedback?.message ?? ''}
        onClose={() => setFeedback(null)}
      />
    </Box>
  )
}

export default App
