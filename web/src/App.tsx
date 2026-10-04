import { useCallback, useEffect, useMemo, useState } from 'react'
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
  XDriveAuthPanel,
  XDriveAuthShell,
  XDriveBrandLockup,
  XDriveConfirmDialog,
  XDriveCloudStoragePage,
  XDriveWorkspaceSidebar,
  XDriveSettingsDialog,
  XDriveFeedbackSnackbar,
  XDriveMediaGalleryPage,
  XDriveShareDialog,
  XDriveSourceManager,
  XDriveStatePanel,
  XDriveTaskCenterPage,
  XDriveUploadConflictDialog,
  useXDriveUploadConflictResolver,
  useXDriveFileOperationLifecycle,
  useXDriveFileOperationActions,
  XDrivePasswordChangeForm,
  xDrivePasswordChangeValidationError,
  XDriveFileNameDialog,
  XDriveTrashDialog,
  XDriveVersionHistoryDialog,
  XDriveWorkspaceShell,
  XDriveWorkspaceContent,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import type {
  MediaGalleryDataSource,
  XDriveCloudStorageDataSource,
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerSort,
  XDriveSidebarSectionModel,
} from '@xdrive/ui/mui'
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
  XDriveFileExplorerPageState,
  XDriveUploadConflictPolicy,
} from '../../ui/shared/src'
import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT, xDriveFileExplorerCanLoadMore, xDriveFileExplorerDeleteOperationPlan, xDriveFileExplorerDirectoryPageTransition, xDriveFileExplorerEnsureUploadDirectory, xDriveFileExplorerPageRequestOptions, xDriveFileExplorerResolveFolderUploadTargets, xDriveFileOperationActive, xDriveUploadBatchSummary } from '../../ui/shared/src'
import AdminUsersPanel from './AdminUsers'
import AdminAuditPanel from './AdminAudit'
import PublicShareView from './PublicShare'
import StorageStatsPanel from './StorageStatsPanel'
import WebFileExplorer from './WebFileExplorer'
import { createWebShareDialogAdapter, createWebTrashDialogAdapter, createWebVersionHistoryDialogAdapter } from './fileDialogAdapters'
import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'

const ACCESS_KEY = 'xdrive.access_token'
const REFRESH_KEY = 'xdrive.refresh_token'
const EXPIRES_KEY = 'xdrive.access_expires_at'
const LEGACY_TOKEN_KEY = 'xdrive.token'
const USER_KEY = 'xdrive.username'

type Crumb = { id: number; name: string }

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
  | 'cloud-storage'
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
  const [serverUpdateBackupFileData, setServerUpdateBackupFileData] = useState(false)
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
      const state = await api.adminStartServerUpdate(serverUpdateSource, serverUpdateChannel, serverUpdateBackupFileData)
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
          backupFileData: serverUpdateBackupFileData,
          loading: serverUpdateBusy,
          disabled: serverUpdate === null,
          canUpdate: canUpdateServer,
          unavailableMessage: '仅管理员可以更新服务端。',
          error: serverUpdateError,
          onSourceChange: setServerUpdateSource,
          onChannelChange: setServerUpdateChannel,
          onBackupFileDataChange: setServerUpdateBackupFileData,
          onStart: () => setServerUpdateConfirmOpen(true),
        }}
      />
      <XDriveConfirmDialog
        open={serverUpdateConfirmOpen}
        title="确认更新服务端？"
        description={`来源：${serverUpdateSource === 'gitlab' ? 'GitLab' : 'GitHub'} · 通道：${serverUpdateChannel} · 文件数据备份：${serverUpdateBackupFileData ? '开启' : '关闭'}。数据库与一致性备份始终执行；更新期间 Web/API 可能短暂不可用。`}
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
    <XDriveAuthShell viewport decorated spacing="compact">
      <XDriveAuthPanel size="compact">
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
      </XDriveAuthPanel>
    </XDriveAuthShell>
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
  const [directoryPage, setDirectoryPage] = useState<XDriveFileExplorerPageState<XDriveFileExplorerSort> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [appView, setAppView] = useState<AppView>('files')
  const [transfers, setTransfers] = useState<XDriveTransferTask[]>(() => api.transfers())
  const [trashOpen, setTrashOpen] = useState(false)
  const [historyNode, setHistoryNode] = useState<Node | null>(null)
  const [shareNode, setShareNode] = useState<Node | null>(null)
  const [passwordValues, setPasswordValues] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const uploadConflicts = useXDriveUploadConflictResolver()

  const current = crumbs.at(-1)

  const trashDialogAdapter = useMemo(() => createWebTrashDialogAdapter(api), [api])
  const versionHistoryDialogAdapter = useMemo(() => createWebVersionHistoryDialogAdapter(api), [api])
  const shareDialogAdapter = useMemo(() => createWebShareDialogAdapter(api), [api])

  const gallerySource = useMemo<MediaGalleryDataSource>(() => ({
    listItems: (limit, offset, query) => api.mediaItems('', limit, offset, query),
    listAlbums: () => api.mediaAlbums(),
    createAlbum: (name) => api.createMediaAlbum(name),
    createSmartAlbum: (name, query) => api.createSmartMediaAlbum(name, query),
    updateSmartAlbum: (albumID, revision, input) =>
      api.updateSmartMediaAlbum(albumID, revision, input),
    deleteSmartAlbum: (albumID, revision) =>
      api.deleteSmartMediaAlbum(albumID, revision),
    renameAlbum: (albumID, revision, name) => api.renameMediaAlbum(albumID, revision, name),
    deleteAlbum: (albumID, revision) => api.deleteMediaAlbum(albumID, revision),
    addToAlbum: (albumID, revision, nodeIDs) => api.addMediaAlbumItems(albumID, revision, nodeIDs),
    removeFromAlbum: (albumID, revision, nodeID) => api.removeMediaAlbumItem(albumID, revision, nodeID),
    listAlbumItems: (albumID, limit, offset, query) => api.mediaAlbumItems(
      albumID,
      limit,
      offset,
      query,
    ),
    setFavorite: async (nodeID, favorite) => {
      await api.setMediaFavorite(nodeID, favorite)
    },
    setTags: async (nodeID, tags) => {
      const result = await api.setMediaTags(nodeID, tags)
      return result.tags
    },
    loadThumbnail: async (nodeID) => URL.createObjectURL(await api.mediaThumbnail(nodeID)),
    loadLivePhotoMotion: async (nodeID) => URL.createObjectURL(await api.mediaLivePhotoMotion(nodeID)),
    loadVideo: (nodeID) => api.mediaVideoURL(nodeID),
  }), [api])

  const cloudStorageSource = useMemo<XDriveCloudStorageDataSource>(() => ({
    load: async () => {
      const [quotaValue, statsValue] = await Promise.all([
        api.quota(),
        api.storageStats().catch(() => null),
      ])
      setQuota(quotaValue)
      return {
        quota: quotaValue,
        stats: statsValue,
        statsUnavailableMessage: statsValue ? undefined : '当前服务端未提供云端存储情报。',
      }
    },
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
    sort: XDriveFileExplorerSort = directoryPage?.sort ?? XDRIVE_FILE_EXPLORER_DEFAULT_SORT,
  ) => {
    setLoading(true)
    try {
      const page = await api.listPage(id, xDriveFileExplorerPageRequestOptions(sort))
      const transition = xDriveFileExplorerDirectoryPageTransition(id, page, sort, false)
      setItems(transition.applyItems)
      setDirectoryPage(transition.pageState)
      if (nextCrumbs) setCrumbs(nextCrumbs)
    } catch (err) {
      handleError(err)
    } finally {
      setLoading(false)
    }
  }

  const loadMoreDirectory = async (id: number, sort: XDriveFileExplorerSort) => {
    const pageState = directoryPage
    if (!xDriveFileExplorerCanLoadMore(pageState, id, sort, loadingMore)) return

    setLoadingMore(true)
    try {
      const page = await api.listPage(
        id,
        xDriveFileExplorerPageRequestOptions(sort, pageState.cursor),
      )
      const transition = xDriveFileExplorerDirectoryPageTransition(id, page, sort, true)
      setItems(transition.applyItems)
      setDirectoryPage(transition.pageState)
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
      const page = await api.listPage(
        root.id,
        xDriveFileExplorerPageRequestOptions(XDRIVE_FILE_EXPLORER_DEFAULT_SORT),
      )
      const transition = xDriveFileExplorerDirectoryPageTransition(root.id, page, XDRIVE_FILE_EXPLORER_DEFAULT_SORT, false)
      setCrumbs([{ id: root.id, name: '我的文件' }])
      setItems(transition.applyItems)
      setDirectoryPage(transition.pageState)
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

  const loadFileOperations = useCallback(
    (limit: number) => api.fileOperations(limit),
    [api],
  )
  const {
    operations: fileOperations,
    rememberOperation: rememberFileOperation,
    refreshOperations: refreshFileOperations,
  } = useXDriveFileOperationLifecycle<XDriveFileOperation>({
    enabled: Boolean(profile && !profile.must_change_password),
    taskCenterVisible: appView === 'transfers',
    loadOperations: loadFileOperations,
    onRefreshError: handleError,
    onTerminalTransition: () => {
      if (!current) return
      void loadDirectory(current.id, crumbs, directoryPage?.sort ?? XDRIVE_FILE_EXPLORER_DEFAULT_SORT)
      void refreshQuota()
    },
  })

  const {
    busy: fileOperationActionBusy,
    cancellingID: fileOperationCancellingID,
    retryingID: fileOperationRetryingID,
    resolvingID: fileOperationResolvingID,
    resolvingPolicy: fileOperationResolvingPolicy,
    clearHistoryLoading: fileOperationClearHistoryLoading,
    cancelOperation: cancelFileOperation,
    retryOperation: retryFileOperation,
    resolveConflict: resolveFileOperationConflict,
    clearHistory: clearTaskHistory,
  } = useXDriveFileOperationActions<XDriveFileOperation>({
    cancelOperation: (id) => api.cancelFileOperation(id),
    retryOperation: (id) => api.retryFileOperation(id),
    resolveConflict: (id, policy) => api.resolveFileOperationConflict(id, policy),
    clearOperationHistory: () => api.clearFileOperationHistory(),
    clearTransferHistory: async () => { api.clearTransferHistory() },
    rememberOperation: rememberFileOperation,
    refreshOperations: refreshFileOperations,
    onError: handleError,
    onFeedback: (message) => setFeedback({ tone: 'good', message }),
  })

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
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar
          position="static"
          elevation={0}
          color="inherit"
          className="web-appbar"
          sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
          <Toolbar
            sx={{
              minHeight: '48px !important',
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
            }}
          >
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
        <XDriveWorkspaceContent responsive>
          <XDriveAuthPanel size="compact">
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
          </XDriveAuthPanel>
        </XDriveWorkspaceContent>
        <XDriveFeedbackSnackbar
          open={Boolean(feedback)}
          tone={feedback?.tone ?? 'neutral'}
          message={feedback?.message ?? ''}
          onClose={() => setFeedback(null)}
        />
      </Box>
    )
  }

  type WebUploadTarget = { parentID: number; file: File }

  const uploadTargets = async (
    targets: readonly WebUploadTarget[],
    reloadCurrent = true,
  ) => {
    if (targets.length === 0) return { uploaded: 0, skipped: 0, cancelled: false }
    if (!uploadConflicts.beginBatch()) return { uploaded: 0, skipped: 0, cancelled: true }
    let uploaded = 0
    let skipped = 0
    let cancelled = false
    let fatalError: unknown = null
    try {
      for (const target of targets) {
        const { parentID, file } = target
        let conflictPolicy: XDriveUploadConflictPolicy = 'fail'
        try {
          const preflight = await api.uploadConflictPreflight(parentID, file.name)
          if (preflight.conflict) {
            const decision = await uploadConflicts.resolveConflict(file.name)
            if (decision === 'cancel') {
              cancelled = true
              break
            }
            conflictPolicy = decision
          }
          if (conflictPolicy === 'skip') {
            skipped += 1
            continue
          }
          setUploadProgress(0)
          const result = await api.uploadWithConflictPolicy(
            parentID,
            file,
            conflictPolicy,
            setUploadProgress,
          )
          if (result.skipped) skipped += 1
          else uploaded += 1
        } catch (error) {
          fatalError = error
          break
        } finally {
          setUploadProgress(null)
        }
      }
    } finally {
      uploadConflicts.endBatch()
    }

    if (uploaded > 0 && reloadCurrent && current) await loadDirectory(current.id)
    if (uploaded > 0) await refreshQuota()
    if (fatalError) {
      handleError(fatalError)
      return { uploaded, skipped, cancelled }
    }
    const summary = xDriveUploadBatchSummary({ uploaded, skipped, failed: 0, cancelled })
    if (summary) setFeedback(summary)
    return { uploaded, skipped, cancelled }
  }

  const uploadFilesTo = async (parentID: number, files: File[]) => {
    await uploadTargets(files.map((file) => ({ parentID, file })))
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!current || !files?.length) return
    await uploadFilesTo(current.id, Array.from(files))
  }

  const uploadFolderEntriesTo = async (
    parentID: number,
    entries: XDriveFileExplorerExternalDropPayload['files'],
    directoryPaths: readonly string[] = [],
  ) => {
    const targets = await xDriveFileExplorerResolveFolderUploadTargets({
      rootParentID: parentID,
      entries,
      directoryPaths,
      ensureDirectory: (directoryParentID, name) => xDriveFileExplorerEnsureUploadDirectory({
        parentID: directoryParentID,
        name,
        createDirectory: (id, directoryName) => api.createDirectory(id, directoryName),
        listChildren: (id) => api.list(id),
      }),
    })
    await uploadTargets(
      targets.map(({ parentID: targetParentID, file }) => ({
        parentID: targetParentID,
        file,
      })),
      false,
    )
  }

  const uploadFolderFiles = async (files: FileList | null) => {
    if (!current || !files?.length) return
    try {
      await uploadFolderEntriesTo(
        current.id,
        Array.from(files).map((file) => ({
          file,
          relativePath: file.webkitRelativePath || file.name,
        })),
      )
      await loadDirectory(current.id)
    } catch (error) {
      handleError(error)
    }
  }

  const uploadDroppedFolderEntries = async (
    parentID: number,
    payload: XDriveFileExplorerExternalDropPayload,
  ) => {
    try {
      await uploadFolderEntriesTo(parentID, payload.files, payload.directories)
    } catch (error) {
      handleError(error)
    }
  }

  const createFolder = async (name: string) => {
    if (!current) return
    await api.createDirectory(current.id, name)
    await loadDirectory(current.id)
  }

  const remove = (node: Node) => {
    const plan = xDriveFileExplorerDeleteOperationPlan([node])
    if (plan.count === 0) return
    setConfirmAction({
      title: `将 ${node.name} 移到回收站？`,
      description: node.type === 'dir'
        ? '该文件夹及其中的全部内容会从同步文件夹中移除，但之后仍可恢复。'
        : '该文件会从同步文件夹中移除，但之后仍可恢复。',
      confirmLabel: '移到回收站',
      intent: 'danger',
      run: async () => {
        const operation = await api.createFileOperation(plan.operation, plan.items)
        rememberFileOperation(operation)
        setFeedback({ tone: 'good', message: plan.message })
      },
    })
  }

  const removeMany = (nodes: Node[]) => {
    const plan = xDriveFileExplorerDeleteOperationPlan(nodes)
    if (plan.count === 0) return
    setConfirmAction({
      title: `将所选 ${plan.count} 个项目移到回收站？`,
      description: '所选文件和文件夹会从同步文件夹中移除，但之后仍可从回收站恢复。',
      confirmLabel: '移到回收站',
      intent: 'danger',
      run: async () => {
        const operation = await api.createFileOperation(plan.operation, plan.items)
        rememberFileOperation(operation)
        setFeedback({ tone: 'good', message: plan.message })
      },
    })
  }

  const openTrash = () => setTrashOpen(true)

  const openHistory = (node: Node) => setHistoryNode(node)

  const webSidebarSections: XDriveSidebarSectionModel[] = profile?.role === 'admin'
    ? [
        {
          key: 'admin',
          label: '管理',
          ariaLabel: '管理员功能',
          placement: 'after-core',
          items: [
            {
              key: 'admin-users',
              label: '用户管理',
              icon: <ManageAccountsRoundedIcon fontSize="small" />,
            },
            {
              key: 'admin-audit',
              label: '审计日志',
              icon: <AssessmentRoundedIcon fontSize="small" />,
            },
            {
              key: 'admin-storage',
              label: '全局存储',
              icon: <StorageRoundedIcon fontSize="small" />,
            },
          ],
        },
      ]
    : []

  return (
    <Box
      sx={{
        minHeight: '100vh',
        height: { md: '100vh' },
        overflow: { md: 'hidden' },
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
        <Toolbar
            sx={{
              minHeight: '48px !important',
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
            }}
          >
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
        <XDriveWorkspaceSidebar
          ariaLabel="网页端功能区"
          navAriaLabel="网页端功能区导航"
          responsive
          selected={appView}
          transferBadge={(transfers.filter((item) => item.state === 'running' || item.state === 'retrying').length + fileOperations.filter((item) => xDriveFileOperationActive(item.status)).length) || undefined}
          sections={webSidebarSections}
          storageSummary={quota ? {
            usedBytes: quota.physical_used_bytes,
            totalBytes: quota.quota_bytes,
            diskTotalBytes: quota.disk_total_bytes,
            diskAvailableBytes: quota.disk_available_bytes,
          } : null}
          onSelect={(destination) => setAppView(destination as AppView)}
        />

        <XDriveWorkspaceContent
          responsive
          presentation={appView === 'files' ? 'files' : 'page'}
        >
        {appView === 'files' ? (
          <Box
           
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
                onUploadFolderFiles={uploadFolderFiles}
                onUploadDroppedFiles={uploadFilesTo}
                onUploadDroppedFolderEntries={uploadDroppedFolderEntries}
                onCreateFolder={() => setFolderOpen(true)}
                onOpenTrash={openTrash}
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
          <XDriveMediaGalleryPage source={gallerySource} onError={handleError} />
        ) : appView === 'sources' ? (
          <XDriveSourceManager
            adapter={api}
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
              ) || fileOperationActionBusy,
              loading: fileOperationClearHistoryLoading,
              onClear: () => { void clearTaskHistory() },
            }}
            operationCancellingID={fileOperationCancellingID}
            operationRetryingID={fileOperationRetryingID}
            operationResolvingID={fileOperationResolvingID}
            operationResolvingPolicy={fileOperationResolvingPolicy}
            operationDisabled={fileOperationActionBusy}
            onCancelOperation={(id) => { void cancelFileOperation(id) }}
            onRetryOperation={(id) => { void retryFileOperation(id) }}
            onResolveOperationConflict={(id, policy) => { void resolveFileOperationConflict(id, policy) }}
          />
        ) : appView === 'cloud-storage' ? (
          <XDriveCloudStoragePage source={cloudStorageSource} />
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
          <Box sx={{ height: { xs: 560, md: '100%' }, minHeight: { xs: 480, md: 0 } }}>
            <XDriveStatePanel variant="plain" loading message="正在切换工作区…" />
          </Box>
        )}
        </XDriveWorkspaceContent>
      </XDriveWorkspaceShell>

      <XDriveUploadConflictDialog {...uploadConflicts.dialogProps} />

      <XDriveFileNameDialog
        open={folderOpen}
        mode="create-folder"
        onClose={() => setFolderOpen(false)}
        onSubmit={createFolder}
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

      <XDriveShareDialog
        adapter={shareDialogAdapter}
        node={shareNode}
        onClose={() => setShareNode(null)}
        onError={handleError}
        expiryMode="datetime"
        listVariant="table"
      />

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
