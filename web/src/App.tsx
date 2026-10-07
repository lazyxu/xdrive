import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import {
  AppBar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Toolbar,
  Typography,
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
  XDriveWorkspaceSidebar,
  XDriveSettingsDialog,
  XDriveFeedbackSnackbar,
  XDriveMediaGalleryPage,
  XDriveShareDialog,
  XDriveSourceManager,
  createXDriveSourceManagerAdapter,
  XDriveStatePanel,
  XDriveTaskCenterPage,
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
  XDriveTrashDialog,
  XDriveVersionHistoryDialog,
  XDriveWorkspaceShell,
  XDriveWorkspaceContent,
  xDriveWorkspacePresentation,
  xDriveWorkspaceStorageSummary,
  XDriveStatusAlert,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerSort,
  XDriveSidebarSectionModel,
  XDriveRemoteWorkspaceViewKey,
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
} from '../../ui/shared/src'
import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT, xDriveFileExplorerCaseInsensitiveNameLookupPageOptions, xDriveFileExplorerEnsureUploadDirectory, xDriveFileExplorerResolveFolderUploadTargets, xDriveLatestRedoableFileOperation, xDriveLatestUndoableFileOperation, xDriveServerUpdateConfirmationDescription, xDriveUsernameValidationError, xDrivePasswordValidationError } from '../../ui/shared/src'
import AdminUsersPanel from './AdminUsers'
import AdminAuditPanel from './AdminAudit'
import PublicShareView from './PublicShare'
import StorageStatsPanel from './StorageStatsPanel'
import WebFileExplorer from './WebFileExplorer'
import { createWebMediaGalleryDataSource } from './mediaGalleryAdapter'
import { createWebShareDialogAdapter, createWebTrashDialogAdapter, createWebVersionHistoryDialogAdapter } from './fileDialogAdapters'
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

type AppView = XDriveRemoteWorkspaceViewKey<
  'admin-users' | 'admin-audit' | 'admin-storage'
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
  const [serverUpdateConfirmOpen, setServerUpdateConfirmOpen] = useState(false)
  const serverUpdatePort = useMemo(() => ({
    getState: () => api.adminServerUpdate(),
    startUpdate: (source: 'github' | 'gitlab', channel: 'stable' | 'master', backupFileData: boolean) =>
      api.adminStartServerUpdate(source, channel, backupFileData),
  }), [api])
  const serverUpdate = useXDriveServerUpdateController({
    open: settingsOpen,
    enabled: canUpdateServer,
    initialChannel: serverBuild?.channel === 'master' ? 'master' : 'stable',
    port: serverUpdatePort,
  })

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
        <XDriveAccountMenuActions
          onClose={() => setAnchorEl(null)}
          onSettings={() => setSettingsOpen(true)}
          onLogout={onLogout}
        />
      </XDriveAccountMenu>
      <XDriveSettingsDialog
        open={settingsOpen}
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
          onStart: () => setServerUpdateConfirmOpen(true),
        }}
      />
      <XDriveConfirmDialog
        open={serverUpdateConfirmOpen}
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
  const [profile, setProfile] = useState<MeResult | null>(null)
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

  const trashDialogAdapter = useMemo(() => createWebTrashDialogAdapter(api), [api])
  const versionHistoryDialogAdapter = useMemo(() => createWebVersionHistoryDialogAdapter(api), [api])
  const shareDialogAdapter = useMemo(() => createWebShareDialogAdapter(api), [api])

  const gallerySource = useMemo(() => createWebMediaGalleryDataSource(api), [api])
  const sourceManagerAdapter = useMemo(() => createXDriveSourceManagerAdapter(api), [api])

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
    trackProgress: true,
    fileName: (file) => file.name,
    fileSize: (file) => file.size,
    preflight: (parentID, file) => api.uploadConflictPreflight(parentID, file.name),
    upload: (parentID, file, conflictPolicy, onProgress, transferID) =>
      api.uploadWithConflictPolicy(parentID, file, conflictPolicy, onProgress, transferID),
    transferLifecycle: {
      startGroup: (input) => api.startTransferGroup(input),
      startChild: (groupID, input) => api.startTransferChild(groupID, input),
      begin: (id, input) => {
        if (input?.group) api.updateTransferGroup(id, input.group)
        api.beginTransfer(id)
      },
      progress: (id, done, total) => api.progressTransfer(id, done, total),
      updateGroup: (id, progress) => api.updateTransferGroup(id, progress),
      finish: (id, input) => api.finishTransfer(id, input),
    },
    onError: handleError,
    onFeedback: (tone, message) => setFeedback({ tone, message }),
  })

  const cloudFilesPort = useMemo<XDriveCloudFilesPort<Node, QuotaUsage, XDriveFileExplorerSort>>(() => ({
    getRoot: () => api.root(),
    getPage: (parentID, options) => api.listPage(parentID, options),
    getRange: (parentID, offset, limit, sort, includeCount) => api.listRange(
      parentID,
      offset,
      limit,
      sort.key,
      sort.direction,
      includeCount,
    ),
    getQuota: () => api.quota(),
  }), [api])

  const {
    quota,
    items,
    crumbs,
    current,
    sort: directorySort,
    loading,
    virtualDirectory,
    applyQuota,
    refreshQuota,
    loadDirectory,
  } = useXDriveCloudFilesController<Node, QuotaUsage, XDriveFileExplorerSort>({
    port: cloudFilesPort,
    enabled: Boolean(profile && !profile.must_change_password),
    defaultSort: XDRIVE_FILE_EXPLORER_DEFAULT_SORT,
    onError: handleError,
  })

  const cloudStorageSource = useMemo(() => createXDriveCloudStorageDataSource({
    getQuota: () => api.quota(),
    getStats: () => api.storageStats(),
    cleanupCache: profile?.role === 'admin'
      ? (kind) => api.adminCleanupStorageCache(kind)
      : undefined,
  }, {
    onQuota: applyQuota,
    tolerateStatsError: true,
    statsUnavailableMessage: '当前服务端未提供云端存储情报。',
  }), [api, applyQuota, profile?.role])

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
    taskCenterVisible: appView === 'transfers',
    loadOperations: loadFileOperations,
    onRefreshError: handleError,
    onTerminalTransition: () => {
      if (!current) return
      void loadDirectory(current.id, crumbs, directorySort)
      void refreshQuota()
    },
  })

  const fileOperationActions = useXDriveFileOperationActions<XDriveFileOperation>({
    cancelOperation: (id) => api.cancelFileOperation(id),
    retryOperation: (id) => api.retryFileOperation(id),
    undoOperation: (id) => api.undoFileOperation(id),
    redoOperation: (id) => api.redoFileOperation(id),
    resolveConflict: (id, policy) => api.resolveFileOperationConflict(id, policy),
    clearOperationHistory: () => api.clearFileOperationHistory(),
    clearTransferHistory: async () => { api.clearTransferHistory() },
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
    submitOperation: (operation, items) => api.createFileOperation(operation, items),
    onQueued: rememberFileOperation,
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

  const taskCenter = useXDriveTaskCenterController({
    transfers,
    operations: fileOperations,
    operationActions: fileOperationActions,
    backgroundTaskPort,
    backgroundTasksEnabled: Boolean(profile && !profile.must_change_password),
    backgroundTasksVisible: appView === 'transfers',
    globalTasksEnabled: profile?.role === 'admin',
    onBackgroundTaskError: handleError,
  })

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
    action: 'upload' | 'drop-upload' | 'upload-folder' = 'upload',
  ) => {
    const result = await fileUploads.runTargets(targets, action)
    if (result.uploaded > 0 && reloadCurrent && current) {
      await loadDirectory(current.id)
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

  const uploadFiles = async (files: FileList | null) => {
    if (!current || !files?.length) return
    await uploadFilesTo(current.id, Array.from(files))
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
          transferBadge={taskCenter.badge}
          sections={webSidebarSections}
          storageSummary={xDriveWorkspaceStorageSummary(quota)}
          onSelect={(destination) => setAppView(destination as AppView)}
        />

        <XDriveWorkspaceContent
          responsive
          presentation={xDriveWorkspacePresentation(appView)}
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
                virtualDirectory={virtualDirectory}
                loading={loading}
                uploadProgress={fileUploads.progress}
                onLoadDirectory={loadDirectory}
                onUploadFiles={uploadFiles}
                onUploadFolderFiles={uploadFolderFiles}
                onUploadDroppedFiles={(parentID, files) => uploadFilesTo(parentID, files, 'drop-upload')}
                onUploadDroppedFolderEntries={uploadDroppedFolderEntries}
                onCreateFolder={() => setFolderOpen(true)}
                onOpenTrash={openTrash}
                onRemove={remove}
                onRemoveMany={removeMany}
                onOperationQueued={rememberFileOperation}
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
                onError={handleError}
              />
          </Box>
        ) : appView === 'gallery' ? (
          <XDriveMediaGalleryPage source={gallerySource} onError={handleError} />
        ) : appView === 'sources' ? (
          <XDriveSourceManager
            adapter={sourceManagerAdapter}
            defaultTargetNodeID={current?.id}
            defaultTargetLabel={current?.name ?? '我的文件'}
            defaultTargetPath={crumbs.slice(1).map((crumb) => crumb.name).join('/')}
            onError={handleError}
          />
        ) : appView === 'transfers' ? (
          <XDriveTaskCenterPage {...taskCenter.pageProps} />
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

      <XDriveUploadConflictDialog {...fileUploads.dialogProps} />

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
