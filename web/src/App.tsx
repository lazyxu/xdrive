import type { XDriveBaiduMapAdminUpdate, XDriveGeoNamesUpdate, XDriveGeoNamesRollbackInput, XDrivePhotoAutoUpdate, XDrivePhotoAutoRollbackInput, XDriveSourceWorkerUpdate, XDriveSourceWorkerRollbackInput } from '../../ui/shared/src'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import DnsRoundedIcon from '@mui/icons-material/DnsRounded'
import {
  AppBar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  XDriveAccountAvatarButton,
  XDriveAccountMenu,
  XDriveAccountMenuActions,
  XDriveActionButton,
  XDriveAuthField,
  XDriveAuthPanel,
  XDriveAuthPasswordField,
  XDriveAuthShell,
  XDriveAuthSubmitRow,
  XDriveBrandLockup,
  XDriveConfirmDialog,
  XDriveCloudStoragePage,
  createXDriveCloudStorageDataSource,
  XDriveLocalStoragePage,
  XDriveWorkspaceSidebar,
  XDriveServiceDependenciesPage,
  XDriveSettingsDialog,
  XDriveFeedbackSnackbar,
  XDriveMediaGalleryPage,
  XDriveShareDialog,
  XDriveSourceManager,
  XDriveDeviceBackupPage,
  createXDriveSourceManagerAdapter,
  XDriveStatePanel,
  XDriveTaskCenterPage,
  XDriveTransferPopover,
  XDriveUploadConflictDialog,
  useXDriveFileExplorerUploadController,
  xDriveFileExplorerUploadGroupLabel,
  useXDriveFileExplorerDeleteController,
  useXDriveCloudFilesController,
  useXDriveFileOperationLifecycle,
  useXDriveFileOperationActions,
  useXDriveTaskCenterController,
  useXDriveServerUpdateController,
  XDrivePasswordChangeForm,
  xDrivePasswordChangeValidationError,
  XDriveFileNameDialog,
  XDriveFileExplorerActionFeedback,
  XDriveVersionHistoryDialog,
  XDriveWorkspaceShell,
  XDriveWorkspaceContent,
  XDriveMobileAppHeader,
  xDriveWorkspacePresentation,
  xDriveWorkspaceStorageSummary,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerSort,
  XDriveSidebarSectionModel,
  XDriveWorkspaceViewKey,
  XDriveLocalStorageDataSource,
  MediaGallerySection,
} from '@xdrive/ui/mui'
import { ApiError, XDriveApi, sessionFromAuth } from './api'
import type { AuthResult, AuthSession, BuildInfo } from './api'
import type {
  MeResult,
  Node,
  QuotaUsage,
  XDriveAppearance,
  XDriveTransferTask,
  XDriveFileOperation,
  XDriveCloudFilesPort,
  XDriveWebAppBrowseContext,
  XDriveWebAppRoute,
} from '../../ui/shared/src'
import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT, xDriveFileExplorerCaseInsensitiveNameLookupPageOptions, xDriveFileExplorerEnsureUploadDirectory, xDriveFileExplorerResolveFolderUploadTargets, xDriveLatestRedoableFileOperation, xDriveLatestUndoableFileOperation, xDriveServerUpdateConfirmationDescription, xDriveUsernameValidationError, xDrivePasswordValidationError, xDriveWebAppViewer } from '../../ui/shared/src'
import AdminUsersPanel from './AdminUsers'
import AdminAuditPanel from './AdminAudit'
import PublicShareView from './PublicShare'
import StorageStatsPanel from './StorageStatsPanel'
import WebFileExplorer from './WebFileExplorer'
import WebOverviewPage from './WebOverviewPage'
import WebUnsupportedFileDialog from './WebUnsupportedFileDialog'
import { WebFileViewerApps, xDriveWebOpenRouteForNode } from './WebFileViewerApps'
import { useXDriveWebAppRuntime, xDriveCreateWebAppBrowseSession } from './webAppRuntime'
import { xDriveWebAppRouteForWorkspaceKey, xDriveWebAppWorkspaceKey } from './webApps'
import { createWebMediaGalleryDataSource } from './mediaGalleryAdapter'
import { createWebShareDialogAdapter, createWebTrashDialogAdapter, createWebVersionHistoryDialogAdapter } from './fileDialogAdapters'
import { clearWebBrowserCache, createWebBrowserStorageSnapshot } from './browserStorage'
import xDriveBrandIcon from '../../assets/icon/master/xdrive-icon-master.svg'

const ACCESS_KEY = 'xdrive.access_token'
const REFRESH_KEY = 'xdrive.refresh_token'
const EXPIRES_KEY = 'xdrive.access_expires_at'
const LEGACY_TOKEN_KEY = 'xdrive.token'
const USER_KEY = 'xdrive.username'


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

type AppView = XDriveWorkspaceViewKey<
  'overview' | 'admin-users' | 'admin-audit' | 'admin-storage' | 'admin-services'
>

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
  disabled = false,
  onAppearanceChange,
  onLogout,
}: {
  username: string
  api: XDriveApi
  serverBuild: BuildInfo | null
  appearance: XDriveAppearance
  canUpdateServer: boolean
  disabled?: boolean
  onAppearanceChange: (appearance: XDriveAppearance) => void
  onLogout: () => void
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [serverUpdateConfirmOpen, setServerUpdateConfirmOpen] = useState(false)
  useEffect(() => {
    if (!disabled) return
    setAnchorEl(null)
    setSettingsOpen(false)
    setServerUpdateConfirmOpen(false)
  }, [disabled])
  const serverUpdatePort = useMemo(() => ({
    getState: () => api.adminServerUpdate(),
    startUpdate: (source: 'github' | 'gitlab', channel: 'stable' | 'master', backupFileData: boolean) =>
      api.adminStartServerUpdate(source, channel, backupFileData),
  }), [api])
  const serverUpdate = useXDriveServerUpdateController({
    open: settingsOpen && !disabled,
    enabled: canUpdateServer,
    initialChannel: serverBuild?.channel === 'master' ? 'master' : 'stable',
    port: serverUpdatePort,
  })

  return (
    <>
      <XDriveAccountAvatarButton username={username} onClick={(event) => {
        if (!disabled) setAnchorEl(event.currentTarget)
      }} />
      <XDriveAccountMenu
        id="web-account-menu"
        anchorEl={disabled ? null : anchorEl}
        onClose={() => setAnchorEl(null)}
        username={username}
        secondary={`Server ${serverBuild?.version || '未知'}`}
        status="已登录"
      >
        <XDriveAccountMenuActions
          onClose={() => setAnchorEl(null)}
          onSettings={() => { if (!disabled) setSettingsOpen(true) }}
          onLogout={() => { if (!disabled) onLogout() }}
        />
      </XDriveAccountMenu>
      <XDriveSettingsDialog
        open={settingsOpen && !disabled}
        onClose={() => setSettingsOpen(false)}
        subtitle="外观与服务端信息"
        appearance={appearance}
        onAppearanceChange={onAppearanceChange}
        buildInfo={[{ title: 'Server 构建信息', info: serverBuild }]}
        serverUpdate={{
          state: serverUpdate.state,
          source: serverUpdate.source,
          channel: serverUpdate.channel,
          backupFileData: serverUpdate.backupFileData,
          loading: serverUpdate.busy,
          disabled: serverUpdate.state === null,
          canUpdate: canUpdateServer,
          unavailableMessage: '仅管理员可以更新服务端。',
          error: serverUpdate.error,
          onSourceChange: serverUpdate.setSource,
          onChannelChange: serverUpdate.setChannel,
          onBackupFileDataChange: serverUpdate.setBackupFileData,
          onStart: () => { if (!disabled) setServerUpdateConfirmOpen(true) },
        }}
      />
      <XDriveConfirmDialog
        open={serverUpdateConfirmOpen && !disabled}
        title="确认更新服务端？"
        description={xDriveServerUpdateConfirmationDescription({
          source: serverUpdate.source,
          channel: serverUpdate.channel,
          backupFileData: serverUpdate.backupFileData,
          unavailableLabel: 'Web/API',
        })}
        confirmLabel="开始更新"
        confirmIntent="warning"
        loading={serverUpdate.busy}
        loadingLabel="正在提交…"
        onCancel={() => setServerUpdateConfirmOpen(false)}
        onConfirm={() => {
          if (disabled) return
          setServerUpdateConfirmOpen(false)
          void serverUpdate.start()
        }}
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
  const transferApiRef = useRef<XDriveApi | null>(null)
  const transferLifetimeRef = useRef(0)

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
    transferApiRef.current?.disposeTransfers()
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
    transferApiRef.current = api
    api.setTransferSessionKey(username ? `${window.location.origin}:${username}` : '')
  }, [api, username])

  useEffect(() => {
    const lifetime = ++transferLifetimeRef.current
    return () => {
      const ownedApi = transferApiRef.current
      // StrictMode replays effects while retaining the same live application.
      // Dispose after that synchronous replay; explicit logout remains immediate.
      queueMicrotask(() => {
        if (lifetime === transferLifetimeRef.current) ownedApi?.disposeTransfers()
      })
    }
  }, [])

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
      onAuthExpired={clearSession}
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
    const nextUsernameError = xDriveUsernameValidationError(loginUsername)
    const nextPasswordError = xDrivePasswordValidationError(password)
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
          <XDriveAuthField
            label="用户名"
            htmlFor="web-login-username"
            required
            error={Boolean(usernameError)}
            helper={usernameError || ' '}
          >
            <TextField
              id="web-login-username"
              autoFocus
              fullWidth
              size="small"
              autoComplete="username"
              value={loginUsername}
              error={Boolean(usernameError)}
              onChange={(event) => {
                setLoginUsername(event.target.value)
                if (usernameError) setUsernameError('')
              }}
            />
          </XDriveAuthField>
          <XDriveAuthPasswordField
            id="web-login-password"
            value={password}
            error={Boolean(passwordError)}
            helper={passwordError || ' '}
            onChange={(value) => {
              setPassword(value)
              if (passwordError) setPasswordError('')
            }}
          />
          <XDriveAuthSubmitRow fullWidth>
            <XDriveActionButton
              intent="primary"
              type="submit"
              fullWidth
              loading={busy}
              loadingLabel="正在登录…"
            >
              登录
            </XDriveActionButton>
          </XDriveAuthSubmitRow>
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
  const compactWorkspace = useMediaQuery('(max-width:899.95px)')
  const [profile, setProfile] = useState<MeResult | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const folderParentIDRef = useRef<number | null>(null)
  const { route, launch: launchWebApp, closeViewer, exitApp, canExitApp } = useXDriveWebAppRuntime()
  const workspaceRouteKey = xDriveWebAppWorkspaceKey(route.app, route.params)
  const [lastWorkspaceView, setLastWorkspaceView] = useState<AppView>(
    () => (workspaceRouteKey as AppView | undefined) ?? 'overview',
  )
  const appView = (workspaceRouteKey as AppView | undefined) ?? lastWorkspaceView
  const viewerActive = Boolean(xDriveWebAppViewer(route.app))
  const setAppView = useCallback((view: AppView) => {
    const next = xDriveWebAppRouteForWorkspaceKey(view)
    if (next) launchWebApp(next)
  }, [launchWebApp])
  const [legacySourceMissing, setLegacySourceMissing] = useState(false)
  useEffect(() => {
    if (route.app !== 'sync-folders') return
    const sourceID = route.params.source
    if (!sourceID) {
      launchWebApp({ app: 'remote-pull', params: {} }, { replace: true })
      return
    }
    let active = true
    setLegacySourceMissing(false)
    void api.sources().then((sources) => {
      if (!active) return
      const source = sources.find((item) => item.id === sourceID)
      if (!source) {
        setLegacySourceMissing(true)
        return
      }
      launchWebApp({
        app: source.direction === 'push' ? 'device-backup' : 'remote-pull',
        params: { source: sourceID },
      }, { replace: true })
    }).catch(() => {
      if (active) setLegacySourceMissing(true)
    })
    return () => { active = false }
  }, [api, route, launchWebApp])

  const [transfers, setTransfers] = useState<XDriveTransferTask[]>(() => api.transfers())
  const [transferPopoverOpen, setTransferPopoverOpen] = useState(false)
  const galleryUploadInputRef = useRef<HTMLInputElement>(null)
  const [galleryUploadRevision, setGalleryUploadRevision] = useState(0)
  const [compactNavigationOpen, setCompactNavigationOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [historyNode, setHistoryNode] = useState<Node | null>(null)
  const [shareNode, setShareNode] = useState<Node | null>(null)
  const [unsupportedOpenNode, setUnsupportedOpenNode] = useState<Node | null>(null)
  const [passwordValues, setPasswordValues] = useState({ current: '', next: '', confirm: '' })
  const [passwordError, setPasswordError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [taskCenterFocus, setTaskCenterFocus] = useState<{
    taskID: string
    requestID: number
  } | null>(null)
  const taskCenterFocusSequenceRef = useRef(0)

  useEffect(() => {
    setCompactNavigationOpen(false)
    setTransferPopoverOpen(false)
  }, [compactWorkspace, viewerActive])

  const trashDialogAdapter = useMemo(() => createWebTrashDialogAdapter(api), [api])
  const versionHistoryDialogAdapter = useMemo(() => createWebVersionHistoryDialogAdapter(api), [api])
  const shareDialogAdapter = useMemo(() => createWebShareDialogAdapter(api), [api])

  const gallerySource = useMemo(() => createWebMediaGalleryDataSource(api), [api])
  const sourceManagerAdapter = useMemo(() => createXDriveSourceManagerAdapter(api), [api])
  const deviceBackupSource = useMemo(() => ({
    list: () => api.deviceBackups(),
    runs: (sourceID: number, limit: number, offset: number) => api.deviceBackupRunSummaries(sourceID, limit, offset),
  }), [api])

  useEffect(() => {
    if (workspaceRouteKey) setLastWorkspaceView(workspaceRouteKey as AppView)
  }, [workspaceRouteKey])

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

  const fileUploads = useXDriveFileExplorerUploadController<File>({
    lifecycleKey: username,
    trackProgress: true,
    fileName: (file) => file.name,
    fileSize: (file) => file.size,
    preflight: (parentID, file, signal) => api.uploadConflictPreflight(parentID, file.name, signal),
    preflightBatch: (targets, signal) => api.uploadConflictPreflightBatch(
      targets.map((target) => ({ parent_id: target.parentID, name: target.file.name })),
      signal,
    ),
    upload: (parentID, file, conflictPolicy, onProgress, transferID, groupID) =>
      api.uploadWithConflictPolicy(parentID, file, conflictPolicy, onProgress, transferID, groupID),
    transferLifecycle: {
      startGroup: (input) => api.startTransferGroup(input),
      startChild: (groupID, input) => api.startTransferChild(groupID, input),
      startChildren: (groupID, inputs) => api.startTransferChildren(groupID, inputs),
      begin: (id, input) => {
        if (input?.group) api.updateTransferGroup(id, input.group)
        api.beginTransfer(id)
      },
      progress: (id, done, total) => api.progressTransfer(id, done, total),
      updateGroup: (id, progress) => api.updateTransferGroup(id, progress),
      finish: (id, input) => api.finishTransfer(id, input),
      isCancelled: (groupID) => api.isTransferCancelRequested(groupID),
      abortSignal: (groupID) => api.uploadGroupSignal(groupID),
    },
    onError: handleError,
    onFeedback: (tone, message) => setFeedback({ tone, message }),
  })

  const cloudFilesPort = useMemo<XDriveCloudFilesPort<Node, QuotaUsage, XDriveFileExplorerSort>>(() => ({
    getRoot: () => api.root(),
    getPage: (parentID, options) => api.listPage(parentID, options),
    getRange: (parentID, offset, limit, sort, includeCount, grouping, signal) => api.listRange(
      parentID,
      offset,
      limit,
      sort.key,
      sort.direction,
      includeCount,
      grouping,
      signal,
    ),
    getChanges: (after, limit) => api.nodeChanges(after, limit),
    getQuota: () => api.quota(),
  }), [api])

  const {
    quota,
    items,
    crumbs,
    current,
    loading,
    virtualDirectory,
    applyQuota,
    refreshQuota,
    refreshCurrentDirectoryIfIdle,
    loadDirectory,
  } = useXDriveCloudFilesController<Node, QuotaUsage, XDriveFileExplorerSort>({
    port: cloudFilesPort,
    enabled: Boolean(profile && !profile.must_change_password),
    lifecycleKey: username,
    defaultSort: XDRIVE_FILE_EXPLORER_DEFAULT_SORT,
    onError: handleError,
  })

  const refreshCurrentDirectory = refreshCurrentDirectoryIfIdle

  const cloudStorageSource = useMemo(() => createXDriveCloudStorageDataSource({
    getQuota: () => api.quota(),
    getStats: () => api.storageStats(),
  }, {
    onQuota: applyQuota,
    tolerateStatsError: true,
    statsUnavailableMessage: '当前服务端未提供账号文件大小分布。',
  }), [api, applyQuota])
  const localStorageSource = useMemo<XDriveLocalStorageDataSource>(() => ({
    load: async () => ({
      browserStorage: await createWebBrowserStorageSnapshot(),
    }),
    clearBrowserCache: clearWebBrowserCache,
  }), [])

  useEffect(() => {
    let active = true
    void api.me()
      .then((me) => {
        if (active) setProfile(me)
      })
      .catch((error) => {
        if (active) handleError(error)
      })
    return () => {
      active = false
    }
  }, [api, handleError])

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
    lifecycleKey: username,
    taskCenterVisible: appView === 'transfers',
    loadOperations: loadFileOperations,
    onRefreshError: handleError,
    onTerminalTransition: () => {
      const expectedCurrentID = current?.id
      if (expectedCurrentID !== undefined) {
        void refreshCurrentDirectoryIfIdle(expectedCurrentID)
      }
      void refreshQuota()
    },
  })

  const filesFeedbackLifecycleKey = username
  const [filesActionFeedback, setFilesActionFeedback] = useState<{
    lifecycleKey: string
    operationID: string
  } | null>(null)
  useEffect(() => { setFilesActionFeedback(null) }, [filesFeedbackLifecycleKey])
  const rememberFilesOperation = useCallback((operation: XDriveFileOperation) => {
    rememberFileOperation(operation)
    setFilesActionFeedback({ lifecycleKey: filesFeedbackLifecycleKey, operationID: operation.id })
  }, [filesFeedbackLifecycleKey, rememberFileOperation])
  const filesFeedbackOperation = filesActionFeedback?.lifecycleKey === filesFeedbackLifecycleKey
    ? fileOperations.find((operation) => operation.id === filesActionFeedback.operationID)
    : undefined

  const fileOperationActions = useXDriveFileOperationActions<XDriveFileOperation>({
    lifecycleKey: username,
    cancelOperation: (id) => api.cancelFileOperation(id),
    retryOperation: (id) => api.retryFileOperation(id),
    undoOperation: (id) => api.undoFileOperation(id),
    redoOperation: (id) => api.redoFileOperation(id),
    resolveConflict: (id, policy) => api.resolveFileOperationConflict(id, policy),
    clearOperationHistory: () => api.clearFileOperationHistory(),
    clearTransferHistory: async () => { api.clearTransferHistory('local') },
    rememberOperation: rememberFileOperation,
    refreshOperations: refreshFileOperations,
    onError: handleError,
    onFeedback: (message) => setFeedback({ tone: 'good', message }),
  })

  const latestUndoableFileOperation = xDriveLatestUndoableFileOperation(fileOperations)
  const latestRedoableFileOperation = xDriveLatestRedoableFileOperation(fileOperations)

  const {
    remove,
    removeMany,
  } = useXDriveFileExplorerDeleteController<Node, XDriveFileOperation>({
    lifecycleKey: username,
    maxItems: 200,
    submitOperation: (operation, items) => api.createFileOperation(operation, items),
    onQueued: rememberFilesOperation,
    requestConfirmation: (confirmation) => setConfirmAction(confirmation),
    onFeedback: (message) => setFeedback({ tone: 'good', message }),
    onError: handleError,
  })

  const backgroundTaskPort = useMemo(() => ({
    loadActiveSummary: () => api.backgroundTaskActiveSummary(),
    loadMinePage: (limit: number, cursor?: string) =>
      api.backgroundTaskPage(limit, cursor),
    loadGlobalPage: profile?.role === 'admin'
      ? (limit: number, cursor?: string) =>
          api.adminBackgroundTaskPage(limit, cursor)
      : undefined,
    control: (id: string, action: string, global: boolean) =>
      api.controlBackgroundTask(id, action, global),
  }), [api, profile?.role])

  const mediaSelectionJobPort = useMemo(() => ({
    list: () => api.listMediaSelectionJobs(),
    cancel: (id: string) => api.cancelMediaSelectionJob(id),
    retry: (id: string) => api.retryMediaSelectionJob(id),
    failures: (id: string, offset: number, limit: number) =>
      api.mediaSelectionJobFailures(id, offset, limit),
  }), [api])

  const taskCenter = useXDriveTaskCenterController({
    transfers,
    operations: fileOperations,
    operationActions: fileOperationActions,
    backgroundTaskPort,
    backgroundTasksLifecycleKey: `${profile?.id ?? ''}:${username}`,
    backgroundTasksEnabled: Boolean(profile && !profile.must_change_password),
    backgroundTasksVisible: appView === 'transfers' || appView === 'global-tasks' || appView === 'overview',
    globalTasksEnabled: profile?.role === 'admin',
    backgroundScope: appView === 'global-tasks' ? 'global' : 'mine',
    onBackgroundTaskError: handleError,
  })

  const filesOperationFocusSequenceRef = useRef(0)
  const [filesOperationFocus, setFilesOperationFocus] = useState<{ operationID: string; requestID: number } | null>(null)
  useEffect(() => { setFilesOperationFocus(null) }, [filesFeedbackLifecycleKey])
  useEffect(() => {
    if (appView !== 'transfers') setFilesOperationFocus(null)
  }, [appView])
  const openFilesOperationTask = useCallback((operationID: string) => {
    taskCenter.pageProps.onBackgroundScopeChange?.('mine')
    setTaskCenterFocus(null)
    filesOperationFocusSequenceRef.current += 1
    setFilesOperationFocus({ operationID, requestID: filesOperationFocusSequenceRef.current })
    setAppView('transfers')
  }, [setAppView, taskCenter.pageProps.onBackgroundScopeChange])

  useEffect(() => {
    if (route.app === 'admin-storage' && route.params.task) {
      launchWebApp({
        app: 'tasks',
        params: { scope: 'global', task: route.params.task },
      }, { replace: true })
    }
  }, [launchWebApp, route])

  useEffect(() => {
    if (route.app !== 'tasks') return
    if (route.params.scope) taskCenter.pageProps.onBackgroundScopeChange?.(route.params.scope)
    if (route.params.task) {
      taskCenterFocusSequenceRef.current += 1
      setTaskCenterFocus({
        taskID: route.params.task,
        requestID: taskCenterFocusSequenceRef.current,
      })
    }
  }, [route, taskCenter.pageProps.onBackgroundScopeChange])

  const openGlobalTaskCenter = useCallback(() => {
    setTaskCenterFocus(null)
    setAppView('global-tasks')
  }, [setAppView])

  const runStorageMaintenance = useCallback(async (
    kind: 'storage_verify' | 'storage_repair',
  ) => {
    const result = await api.controlBackgroundTask(`system-maintenance:${kind}`, 'run', true)
    const taskID = (result.result_task_id || result.task_id || '').trim()
    if (taskID) {
      taskCenterFocusSequenceRef.current += 1
      setTaskCenterFocus({
        taskID,
        requestID: taskCenterFocusSequenceRef.current,
      })
    }
    setAppView('global-tasks')
  }, [api, setAppView])

  useEffect(() => {
    if (appView !== 'transfers' && appView !== 'global-tasks') setTaskCenterFocus(null)
  }, [appView])

  useEffect(() => {
    if (profile && profile.role !== 'admin' && (appView.startsWith('admin-') || appView === 'global-tasks')) {
      setAppView('files')
    }
  }, [appView, profile])

  const serviceDependenciesPort = useMemo(() => ({
    load: () => api.adminServices(),
    loadMediaWorkerConfig: () => api.adminMediaWorkerConfig(),
    saveMediaWorkerConfig: (input: import('../../ui/shared/src').XDriveMediaWorkerUpdate) =>
      api.adminSaveMediaWorker(input),
    applyMediaWorker: (input: { revision: number }) => api.adminApplyMediaWorker(input),
    loadMediaWorkerRevisions: () => api.adminMediaWorkerRevisions(),
    rollbackMediaWorker: (input: import('../../ui/shared/src').XDriveMediaWorkerRollbackInput) =>
      api.adminRollbackMediaWorker(input),
    loadPostgresPoolConfig: () => api.adminPostgresPoolConfig(),
    savePostgresPoolConfig: (input: import('../../ui/shared/src').XDrivePostgresPoolUpdate) =>
      api.adminSavePostgresPoolConfig(input),
    loadPostgresPoolRevisions: () => api.adminPostgresPoolRevisions(),
    rollbackPostgresPool: (input: import('../../ui/shared/src').XDrivePostgresPoolRollbackInput) =>
      api.adminRollbackPostgresPool(input),
    loadSourceWorkerConfig: () => api.adminSourceWorkerConfig(),
    saveSourceWorkerConfig: (input: XDriveSourceWorkerUpdate) => api.adminSaveSourceWorkerConfig(input),
    loadSourceWorkerRevisions: () => api.adminSourceWorkerRevisions(),
    rollbackSourceWorker: (input: XDriveSourceWorkerRollbackInput) => api.adminRollbackSourceWorker(input),
    loadPhotoAutoConfig: () => api.adminPhotoAutoConfig(),
    savePhotoAutoConfig: (input: XDrivePhotoAutoUpdate) => api.adminSavePhotoAutoConfig(input),
    loadPhotoAutoRevisions: () => api.adminPhotoAutoRevisions(),
    rollbackPhotoAuto: (input: XDrivePhotoAutoRollbackInput) => api.adminRollbackPhotoAuto(input),
    loadBaiduMapConfig: () => api.adminBaiduMapConfig(),
    saveBaiduMapConfig: (input: XDriveBaiduMapAdminUpdate) => api.adminSaveBaiduMapConfig(input),
    revealBaiduMapAK: (revision: number) => api.adminRevealBaiduMapAK(revision),
    loadGeoNamesConfig: () => api.adminGeoNamesConfig(),
    saveGeoNamesConfig: (input: XDriveGeoNamesUpdate) => api.adminSaveGeoNamesConfig(input),
    reloadGeoNames: (expectedVersion: string) => api.adminReloadGeoNames(expectedVersion),
    stageGeoNamesSnapshot: (input: import('../../ui/shared/src').XDriveGeoNamesSnapshotInput) =>
      api.adminStageGeoNamesSnapshot(input),
    applyGeoNamesDataset: (input: import('../../ui/shared/src').XDriveGeoNamesDatasetApplyInput) =>
      api.adminApplyGeoNamesDataset(input),
    restoreMissingGeoNamesSnapshot: (input: import('../../ui/shared/src').XDriveGeoNamesRestoreMissingInput) =>
      api.adminRestoreMissingGeoNamesSnapshot(input),
    loadGeoNamesRevisions: () => api.adminGeoNamesRevisions(),
    rollbackGeoNames: (input: XDriveGeoNamesRollbackInput) => api.adminRollbackGeoNames(input),
  }), [api])

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
    action: 'upload' | 'drop-upload' | 'upload-folder' = 'upload',
  ) => {
    const expectedCurrentID = current?.id
    const result = await fileUploads.runTargets(targets, action)
    if (result.uploaded > 0 && reloadCurrent) {
      await refreshCurrentDirectory(expectedCurrentID)
    }
    if (result.uploaded > 0) await refreshQuota()
    return result
  }

  const uploadFilesTo = async (
    parentID: number,
    files: File[],
    action: 'upload' | 'drop-upload' = 'upload',
  ) => {
    await uploadTargets(files.map((file) => ({ parentID, file })), true, action)
  }

  const uploadFiles = async (parentID: number, files: FileList | null) => {
    if (!files?.length) return
    await uploadFilesTo(parentID, Array.from(files))
  }

  const uploadGalleryFiles = async (files: File[]) => {
    if (files.length === 0) return
    try {
      // Gallery media are files in the authenticated owner's cloud root,
      // not a separate media ingest/store or a connector-specific endpoint.
      const root = await api.root()
      const result = await uploadTargets(
        files.map((file) => ({ parentID: root.id, file })),
        false,
        'upload',
      )
      if (result.uploaded > 0 || result.skipped > 0) {
        setGalleryUploadRevision((revision) => revision + 1)
        setFeedback({
          tone: result.failed > 0 ? 'warning' : 'good',
          message: `图库文件上传完成：成功 ${result.uploaded}，跳过 ${result.skipped}，失败 ${result.failed}。媒体索引完成后将显示。`,
        })
      }
    } catch (error) {
      handleError(error)
    }
  }

  const uploadFolderEntriesTo = async (
    parentID: number,
    entries: XDriveFileExplorerExternalDropPayload['files'],
    directoryPaths: readonly string[] = [],
  ) => {
    const label = xDriveFileExplorerUploadGroupLabel(
      entries,
      (file) => file.name,
    )
    const result = await fileUploads.runGroup({
      label,
      path: label,
      action: 'upload-folder',
      itemsTotal: entries.length,
      bytesTotal: entries.reduce((sum, entry) => sum + Math.max(0, entry.file.size), 0),
      resolveTargets: async () => {
        const targets = await xDriveFileExplorerResolveFolderUploadTargets({
          rootParentID: parentID,
          entries,
          directoryPaths,
          ensureDirectory: (directoryParentID, name) => xDriveFileExplorerEnsureUploadDirectory({
            parentID: directoryParentID,
            name,
            createDirectory: (id, directoryName) => api.createDirectory(id, directoryName),
            findExistingDirectory: async (id, directoryName) => {
              const page = await api.listPage(
                id,
                xDriveFileExplorerCaseInsensitiveNameLookupPageOptions(directoryName),
              )
              return page.items[0] ?? null
            },
          }),
        })
        return targets.map(({ parentID: targetParentID, file, relativePath }) => ({
          parentID: targetParentID,
          file,
          relativePath,
        }))
      },
    })
    if (result.uploaded > 0) await refreshQuota()
    return result
  }

  const uploadFolderFiles = async (expectedCurrentID: number, files: FileList | null) => {
    if (!files?.length) return
    try {
      await uploadFolderEntriesTo(
        expectedCurrentID,
        Array.from(files).map((file) => ({
          file,
          relativePath: file.webkitRelativePath || file.name,
        })),
      )
      await refreshCurrentDirectory(expectedCurrentID)
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
    const expectedCurrentID = folderParentIDRef.current
    if (expectedCurrentID === null) return
    await api.createDirectory(expectedCurrentID, name)
    await refreshCurrentDirectory(expectedCurrentID)
  }

  const openTrash = () => setTrashOpen(true)

  const openHistory = (node: Node) => setHistoryNode(node)

  const openWebFile = (node: Node, context: XDriveWebAppBrowseContext) => {
    const contextID = xDriveCreateWebAppBrowseSession(context)
    const next = xDriveWebOpenRouteForNode(node, contextID)
    if (!next) {
      setUnsupportedOpenNode(node)
      return
    }
    launchWebApp(next, { viewerReturn: true })
  }

  const openWebQuickLook = (node: Node, context: XDriveWebAppBrowseContext) => {
    const contextID = xDriveCreateWebAppBrowseSession(context)
    launchWebApp({
      app: 'preview',
      params: { node: node.id, context: contextID },
    }, { viewerReturn: true })
  }

  const openWebNodeInBrowserTab = (node: Node) => {
    const next = node.type === 'dir'
      ? ({ app: 'files', params: { dir: node.id } } satisfies XDriveWebAppRoute)
      : xDriveWebOpenRouteForNode(node)
    if (!next) {
      setFeedback({ tone: 'warning', message: '此文件暂时没有可用的 Web 打开程序。' })
      return
    }
    launchWebApp(next, { newTab: true })
  }

  const webSidebarSections: XDriveSidebarSectionModel[] = [
    {
      key: 'overview',
      placement: 'before-core',
      items: [
        {
          key: 'overview',
          label: '主页',
          icon: <DashboardRoundedIcon fontSize="small" />,
        },
      ],
    },
    ...(profile?.role === 'admin'
      ? [{
          key: 'admin',
          label: '管理',
          ariaLabel: '管理员功能',
          placement: 'after-core' as const,
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
            {
              key: 'admin-services',
              label: '服务与依赖',
              icon: <DnsRoundedIcon fontSize="small" />,
            },
          ],
        }]
      : []),
  ]

  const transferAction = (
    <XDriveTransferPopover
      transfers={transfers}
      sessionKey={`${window.location.origin}:${username}`}
      disabled={viewerActive}
      open={transferPopoverOpen}
      onOpenChange={setTransferPopoverOpen}
      onClearHistory={() => { api.clearTransferHistory('network') }}
      canCancel={(id) => api.canCancelTransfer(id)}
      onCancel={(id) => {
        if (!api.cancelTransfer(id)) {
          setFeedback({ tone: 'warning', message: '这项传输不能从当前页面取消，或已经结束。' })
        }
      }}
      onShowInCloud={(task) => {
        const parentID = task.cloud_parent_id
        if (typeof parentID === 'number' && Number.isSafeInteger(parentID) && parentID > 0) {
          launchWebApp({ app: 'files', params: { dir: parentID } })
          return
        }
        const nodeID = task.cloud_node_id
        if (typeof nodeID === 'number' && Number.isSafeInteger(nodeID) && nodeID > 0) {
          void api.nodeLocation(Number(nodeID)).then((location) => {
            if (location.parent_id) launchWebApp({ app: 'files', params: { dir: location.parent_id } })
          }).catch(handleError)
        }
      }}
    />
  )
  const accountAction = (
    <WebAccountMenu
      disabled={viewerActive || (compactWorkspace && !compactNavigationOpen)}
      username={username}
      api={api}
      serverBuild={serverBuild}
      canUpdateServer={profile?.role === 'admin' && !profile.must_change_password}
      appearance={appearance}
      onAppearanceChange={onAppearanceChange}
      onLogout={onLogout}
    />
  )
  const workspaceActions = (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={{ xs: 0.5, sm: 1 }}>
      {transferAction}
      {accountAction}
    </Stack>
  )
  const mobileAppTitles: Record<string, string> = {
    overview: '主页', files: '文件', gallery: '图库', 'device-backup': '设备备份', 'remote-pull': '远程拉取',
    transfers: '任务', 'global-tasks': '全局任务', 'local-storage': '本地存储',
    'cloud-storage': '云端存储', 'admin-users': '用户管理',
    'admin-audit': '审计日志', 'admin-storage': '全局存储', 'admin-services': '服务与依赖',
  }

  return (
    <Box
      sx={{
        minHeight: 0,
        height: '100vh',
        '@supports (height: 100dvh)': { height: '100dvh' },
        overflow: 'hidden',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        data-xdrive-workspace-background
        {...{ inert: viewerActive ? '' : undefined }}
        aria-hidden={viewerActive || undefined}
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          pl: { xs: 0, md: 'env(safe-area-inset-left)' },
          pr: { xs: 0, md: 'env(safe-area-inset-right)' },
          pb: { xs: 0, md: 'env(safe-area-inset-bottom)' },
        }}
      >
      <AppBar
          position="static"
          elevation={0}
          color="inherit"
          className="web-appbar"
          sx={{ display: { xs: 'none', md: 'flex' }, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', pt: 'env(safe-area-inset-top)' }}
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
          {!compactWorkspace ? workspaceActions : null}
        </Toolbar>
      </AppBar>

      <XDriveWorkspaceShell
        responsive
        className="web-workspace-shell"
        sx={{ flex: 1, minHeight: 0 }}
      >
        <XDriveWorkspaceSidebar
          ariaLabel="网页端功能区"
          navAriaLabel="网页端功能区导航"
          responsive
          compactFullscreen
          compactOpen={compactNavigationOpen}
          onCompactOpenChange={setCompactNavigationOpen}
          compactActions={compactWorkspace ? accountAction : undefined}
          disabled={viewerActive}
          selected={appView}
          transferBadge={taskCenter.badge}
          showGlobalTasks={profile?.role === 'admin'}
          showLocalStorage
          sections={webSidebarSections}
          storageSummary={xDriveWorkspaceStorageSummary(quota)}
          onSelect={(destination, event) => {
            const next = xDriveWebAppRouteForWorkspaceKey(destination)
            if (!next) return
            if (event.ctrlKey || event.metaKey) {
              launchWebApp(next, { newTab: true })
              return
            }
            setAppView(destination as AppView)
          }}
        />

        <Box data-xdrive-mobile-app-frame sx={{ minWidth: 0, minHeight: 0, height: '100%', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {compactWorkspace ? (
            <XDriveMobileAppHeader
              title={mobileAppTitles[appView] ?? 'xDrive'}
              canGoBack={canExitApp}
              disabled={viewerActive}
              onBack={exitApp}
              onOpenApps={() => setCompactNavigationOpen(true)}
              transferAction={transferAction}
            />
          ) : null}
        <XDriveWorkspaceContent
          responsive
          presentation={xDriveWorkspacePresentation(appView)}
        >
        {appView === 'overview' ? (
          <WebOverviewPage
            api={api}
            username={username}
            quota={quota}
            activeTaskCount={taskCenter.badgeCount}
            transfers={transfers}
            fileOperations={fileOperations}
            backgroundTasks={taskCenter.backgroundTasks}
            activityRevision={[
              transfers.map((task) => task.updated_at).join(','),
              fileOperations.map((operation) => operation.updated_at).join(','),
              taskCenter.backgroundTasks.map((task) => task.updated_at).join(','),
            ].join('|')}
            uploadParentID={current?.id}
            onUploadFiles={uploadFiles}
            onUploadFolderFiles={uploadFolderFiles}
            onCreateFolder={() => {
              if (!current) {
                setAppView('files')
                return
              }
              folderParentIDRef.current = current.id
              setFolderOpen(true)
            }}
            onOpenFiles={() => setAppView('files')}
            onOpenDirectory={(id, nextCrumbs) => {
              setAppView('files')
              void loadDirectory(id, nextCrumbs)
            }}
            onOpenGallery={() => setAppView('gallery')}
            onOpenTransfers={() => setTransferPopoverOpen(true)}
          />
        ) : appView === 'files' ? (
          <Box
           
            sx={{
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
            }}
          >
              <WebFileExplorer
                api={api}
                items={items}
                crumbs={crumbs}
                virtualDirectory={virtualDirectory}
                loading={loading}
                navigationSessionStorageKey={`xdrive.files.navigation_session.v1:${encodeURIComponent(username)}`}
                initialDirectoryID={route.app === 'files' ? route.params.dir : undefined}
                uploadProgress={fileUploads.progress}
                onLoadDirectory={loadDirectory}
                onRefreshCurrentDirectoryIfIdle={refreshCurrentDirectoryIfIdle}
                onUploadFiles={uploadFiles}
                onUploadFolderFiles={uploadFolderFiles}
                onUploadDroppedFiles={(parentID, files) => uploadFilesTo(parentID, files, 'drop-upload')}
                onUploadDroppedFolderEntries={uploadDroppedFolderEntries}
                onCreateFolder={() => {
                  if (!current) return
                  folderParentIDRef.current = current.id
                  setFolderOpen(true)
                }}
                onOpenTrash={openTrash}
                trashActive={trashOpen}
                trashAdapter={trashDialogAdapter}
                onCloseTrash={() => setTrashOpen(false)}
                onTrashChanged={async () => {
                  const expectedCurrentID = current?.id
                  if (expectedCurrentID !== undefined) {
                    await refreshCurrentDirectoryIfIdle(expectedCurrentID)
                  }
                  await refreshQuota()
                }}
                onRemove={remove}
                onRemoveMany={removeMany}
                onOperationQueued={rememberFilesOperation}
                actionFeedback={(
                  <XDriveFileExplorerActionFeedback
                    value={filesFeedbackOperation ? { kind: 'operation', operation: filesFeedbackOperation } : null}
                    onViewTask={openFilesOperationTask}
                    onDismiss={() => setFilesActionFeedback(null)}
                  />
                )}
                canUndo={Boolean(latestUndoableFileOperation) && !fileOperationActions.busy}
                onUndo={() => {
                  if (latestUndoableFileOperation) void fileOperationActions.undoOperation(latestUndoableFileOperation.id)
                }}
                canRedo={Boolean(latestRedoableFileOperation) && !fileOperationActions.busy}
                onRedo={() => {
                  if (latestRedoableFileOperation) void fileOperationActions.redoOperation(latestRedoableFileOperation.id)
                }}
                onFeedback={(tone, message) => setFeedback({ tone, message })}
                onShare={setShareNode}
                onHistory={openHistory}
                onOpenFile={openWebFile}
                onOpenQuickLook={openWebQuickLook}
                onOpenNodeInBrowserTab={openWebNodeInBrowserTab}
                onDirectoryChange={(nodeID) => {
                  if (route.app === 'files' && route.params.dir !== nodeID) {
                    launchWebApp({ app: 'files', params: { dir: nodeID } }, { replace: true })
                  }
                }}
                onError={handleError}
              />
          </Box>
        ) : appView === 'gallery' ? (
          <>
          <input
            ref={galleryUploadInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif,.dng,.arw,.nef,.cr2,.cr3,.raf,.rw2,.orf,.livp"
            aria-label="选择上传到图库的照片或视频"
            data-xdrive-gallery-upload-picker
            style={{ display: 'none' }}
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.files || [])
              event.currentTarget.value = ''
              void uploadGalleryFiles(selected)
            }}
          />
          <XDriveMediaGalleryPage
            mobileWebChrome
            source={gallerySource}
            uploadRevision={galleryUploadRevision}
            onUploadRequested={() => galleryUploadInputRef.current?.click()}
            fileOperations={fileOperations}
            onFileOperationQueued={() => { void refreshFileOperations() }}
            onShowInFolder={(location) => {
              if (location.parent_id) launchWebApp({ app: 'files', params: { dir: location.parent_id } })
            }}
            preferenceScope={`web:${profile?.id ?? username}`}
            initialSection={route.app === 'gallery'
              ? route.params.section as MediaGallerySection | undefined
              : undefined}
            onSectionRouteChange={(section) => {
              if (route.app === 'gallery' && route.params.section !== section) {
                launchWebApp({ app: 'gallery', params: { section } }, { replace: true })
              }
            }}
            shareDialog={{
              adapter: shareDialogAdapter,
              expiryMode: 'datetime',
              listVariant: 'table',
            }}
            onOpenViewer={(item, context) => {
              const contextID = xDriveCreateWebAppBrowseSession({
                kind: 'gallery',
                target: context.target,
                activeIndex: context.activeIndex,
                totalCount: context.totalCount,
              })
              launchWebApp({
                app: 'media-viewer',
                params: { node: item.node.id, context: contextID },
              }, { viewerReturn: true })
            }}
            onError={handleError}
          />
          </>
        ) : appView === 'device-backup' ? (
          <XDriveDeviceBackupPage
            source={deviceBackupSource}
            initialSourceID={route.app === 'device-backup' ? route.params.source : undefined}
          />
        ) : appView === 'remote-pull' ? (
          route.app === 'sync-folders' ? (
            <XDriveStatePanel
              variant="plain"
              loading={!legacySourceMissing}
              message={legacySourceMissing
                ? '该同步文件夹不存在或没有查看权限。请从设备备份或远程拉取重新打开。'
                : '正在根据原同步文件夹 ID 确认 Push/Pull 归属…'}
            />
          ) : (
            <XDriveSourceManager
              directionFilter="pull"
              adapter={sourceManagerAdapter}
              initialSourceID={route.app === 'remote-pull' ? route.params.source : undefined}
              onSelectedSourceChange={(sourceID) => {
                if (route.app === 'remote-pull' && route.params.source !== sourceID) {
                  launchWebApp({ app: 'remote-pull', params: { source: sourceID } }, { replace: true })
                }
              }}
              defaultTargetNodeID={current?.id}
              defaultTargetLabel={current?.name ?? '我的文件'}
              defaultTargetPath={crumbs.slice(1).map((crumb) => crumb.name).join('/')}
              onError={handleError}
            />
          )
        ) : appView === 'transfers' || appView === 'global-tasks' ? (
          <XDriveTaskCenterPage
            {...taskCenter.pageProps}
            mediaSelectionJobPort={appView === 'transfers' ? mediaSelectionJobPort : undefined}
            operationFocusID={filesOperationFocus?.operationID}
            operationFocusRequestID={filesOperationFocus?.requestID}
            backgroundFocusTaskID={taskCenterFocus?.taskID}
            backgroundFocusRequestID={taskCenterFocus?.requestID}
          />
        ) : appView === 'local-storage' ? (
          <XDriveLocalStoragePage source={localStorageSource} />
        ) : appView === 'cloud-storage' ? (
          <XDriveCloudStoragePage source={cloudStorageSource} />
        ) : appView === 'admin-users' && profile?.role === 'admin' ? (
          <AdminUsersPanel
            api={api}
            currentUserID={profile.id}
            focusUserID={route.app === 'admin-users' ? route.params.user : undefined}
            onChanged={() => { void refreshQuota() }}
          />
        ) : appView === 'admin-audit' && profile?.role === 'admin' ? (
          <AdminAuditPanel api={api} />
        ) : appView === 'admin-services' && profile?.role === 'admin' ? (
          <XDriveServiceDependenciesPage source={serviceDependenciesPort} />
        ) : appView === 'admin-storage' && profile?.role === 'admin' ? (
          <StorageStatsPanel
            api={api}
            scope="global"
            focusSection={route.app === 'admin-storage' ? route.params.section : undefined}
            onOpenTaskCenter={openGlobalTaskCenter}
            onRunStorageMaintenance={runStorageMaintenance}
          />
        ) : (
          <Box sx={{ height: '100%', minHeight: 0 }}>
            <XDriveStatePanel variant="plain" loading message="正在切换工作区…" />
          </Box>
        )}
        </XDriveWorkspaceContent>
        </Box>
      </XDriveWorkspaceShell>
      </Box>

      {xDriveWebAppViewer(route.app) ? (
        <WebFileViewerApps
          route={route}
          api={api}
          gallerySource={gallerySource}
          shareDialogAdapter={shareDialogAdapter}
          onReplaceRoute={(next) => launchWebApp(next, { replace: true, viewerReturn: true })}
          onShowInFolder={(location) => {
            if (location.parent_id) launchWebApp({ app: 'files', params: { dir: location.parent_id } })
          }}
          onClose={(node) => closeViewer({
            app: 'files',
            params: { dir: node?.parent_id },
          })}
          onError={handleError}
        />
      ) : null}

      <XDriveUploadConflictDialog {...fileUploads.dialogProps} />

      <XDriveFileNameDialog
        open={folderOpen}
        mode="create-folder"
        onClose={() => {
          folderParentIDRef.current = null
          setFolderOpen(false)
        }}
        onSubmit={createFolder}
        onError={handleError}
      />

      <XDriveVersionHistoryDialog
        node={historyNode}
        adapter={versionHistoryDialogAdapter}
        onClose={() => setHistoryNode(null)}
        onError={handleError}
        onFeedback={(message) => setFeedback({ tone: 'good', message })}
        onRestored={async (restored) => {
          const expectedCurrentID = current?.id
          setHistoryNode(restored)
          if (expectedCurrentID !== undefined) {
            await refreshCurrentDirectoryIfIdle(expectedCurrentID)
          }
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

      <WebUnsupportedFileDialog
        node={unsupportedOpenNode}
        api={api}
        shareDialogAdapter={shareDialogAdapter}
        onClose={() => setUnsupportedOpenNode(null)}
        onError={handleError}
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
