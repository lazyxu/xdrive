import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { xDriveDesktopViewportRequest } from './abortableViewportRequest'
import type { FormEvent, ReactNode } from 'react'
import {
  Autocomplete,
  Box as MuiBox,
  Button as MuiButton,
  Checkbox,
  CircularProgress,
  Divider as MuiDivider,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded'
import FilterNoneRoundedIcon from '@mui/icons-material/FilterNoneRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'
import {
  XDriveAccountAvatarButton,
  XDriveAccountMenu,
  XDriveAccountMenuActions,
  XDriveActionButton,
  XDriveAuthField,
  XDriveAuthFieldStatus,
  XDriveAuthPanel,
  XDriveAuthPasswordField,
  XDriveAuthShell,
  XDriveAuthSubmitRow,
  XDriveBrandLockup,
  XDrivePasswordChangeForm,
  xDrivePasswordChangeValidationError,
  XDriveConfirmDialog,
  XDriveCloudStoragePage,
  createXDriveCloudStorageDataSource,
  XDriveLocalStoragePage,
  XDriveWorkspaceSidebar,
  XDriveWorkspaceContent,
  xDriveWorkspacePresentation,
  xDriveWorkspaceStorageSummary,
  XDriveSettingsDialog,
  XDriveFeedbackSnackbar,
  XDriveMediaGalleryPage,
  XDriveTaskCenterPage,
  XDriveFileExplorerActionFeedback,
  XDriveTransferPopover,
  XDriveWorkspaceShell,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  XDriveSourceManager,
  useXDriveCloudFilesController,
  useXDriveFileExplorerDeleteController,
  useXDriveFileOperationLifecycle,
  useXDriveFileOperationActions,
  useXDriveTaskCenterController,
  useXDriveServerUpdateController,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerNavigationState,
  XDriveFileExplorerSort,
  XDriveSidebarSectionModel,
  XDriveWorkspaceViewKey,
  XDriveStatusTone,
  XDriveLocalStorageDataSource,
} from '@xdrive/ui/mui'
import {
  XDRIVE_FILE_EXPLORER_DEFAULT_SORT,
  xDriveFileExplorerKeyboardProfileFromPlatform,
  xDriveLatestRedoableFileOperation,
  xDriveLatestUndoableFileOperation,
  xDriveLoginCredentialsReady,
  xDriveServerUpdateConfirmationDescription,
} from '@xdrive/shared'
import type { XDriveFileExplorerDownloadResult } from '@xdrive/shared'
import { DesktopFilesPage } from './DesktopFilesPage'
import type { DesktopFileExplorerAction, DesktopFileExplorerActionIntent } from './DesktopFileExplorer'
import { DesktopOverviewPage } from './DesktopOverviewPage'
import { DesktopConflictsPage } from './DesktopConflictsPage'
import { DesktopDiagnosticsPage } from './DesktopDiagnosticsPage'
import { createDesktopMediaGalleryDataSource } from './mediaGalleryAdapter'
import { desktopShareDialogAdapter } from './fileDialogAdapters'
import { DesktopSettingsContent } from './DesktopSettingsContent'
import { createDesktopSourceManagerAdapter, desktopSourceTargetBrowser } from './sourceManagerAdapter'
import type {
  XDriveAppearance,
  XDriveCloudFilesPort,
} from '@xdrive/shared'

type View = XDriveWorkspaceViewKey<'overview' | 'conflicts' | 'diagnostics'>

type ConfirmDialogState = {
  title: string
  message: string
  confirmLabel: string
  tone: 'primary' | 'warning' | 'error'
  onConfirm: () => unknown | Promise<unknown>
}

function platformLabel(platform: string) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  if (platform === 'darwin') return 'macOS'
  return platform || '未知'
}

function DesktopFrame({
  children,
  maximized,
  titlebarActions,
}: {
  children: ReactNode
  maximized: boolean
  titlebarActions?: ReactNode
}) {
  return (
    <div className="desktop-frame">
      <header className="desktop-titlebar">
        <XDriveBrandLockup iconSrc={xDriveBrandIcon} variant="titlebar" className="desktop-titlebar-brand" />
        <div className="desktop-titlebar-actions">{titlebarActions}</div>
        <div className="desktop-window-controls">
          <IconButton
            className="desktop-window-control"
            aria-label="最小化"
            title="最小化"
            disableRipple
            onClick={() => window.xdriveDesktop.minimizeWindow()}
          >
            <RemoveRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton
            className="desktop-window-control"
            aria-label={maximized ? '还原' : '最大化'}
            title={maximized ? '还原' : '最大化'}
            disableRipple
            onClick={() => window.xdriveDesktop.toggleMaximizeWindow()}
          >
            {maximized ? <FilterNoneRoundedIcon fontSize="small" /> : <CropSquareRoundedIcon fontSize="small" />}
          </IconButton>
          <IconButton
            className="desktop-window-control desktop-window-close"
            aria-label="关闭"
            title="关闭"
            disableRipple
            onClick={() => window.xdriveDesktop.closeWindow()}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>
      </header>
      <div className="desktop-body">{children}</div>
    </div>
  )
}

function cacheGiB(bytes: number) {
  if (!bytes) return '0'
  return String(Number((bytes / 1024 ** 3).toFixed(3)))
}

function updateModeDescription(mode: AgentUpdateMode) {
  if (mode === 'check') return '后台定期检查；发现新版本后只提示，不会自动下载。'
  if (mode === 'download') return '后台定期检查并自动下载、校验；安装前仍由你确认。'
  if (mode === 'install') return '后台定期检查，有新版本时自动下载并安装。'
  return '不在后台检查更新；只有点击“检查更新”时才访问更新服务。'
}

export default function App({
  appearance,
  onAppearanceChange,
}: {
  appearance: XDriveAppearance
  onAppearanceChange: (appearance: XDriveAppearance) => Promise<void>
}) {
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences>({
    appearance: 'system',
    start_at_login: true,
    close_to_tray: true,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [agent, setAgent] = useState<AgentConnectionState>({ connected: false })
  const [view, setView] = useState<View>('overview')
  const [transferPopoverOpen, setTransferPopoverOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [syncMenuAnchor, setSyncMenuAnchor] = useState<HTMLElement | null>(null)
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<HTMLElement | null>(null)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [clientUpdate, setClientUpdate] = useState<AgentUpdateState | null>(null)
  const [updateCancelling, setUpdateCancelling] = useState(false)
  const [conflicts, setConflicts] = useState<AgentConflict[]>([])
  const [transfers, setTransfers] = useState<AgentTransfers>({ revision: 0, transfers: [] })
  const transfersRevisionRef = useRef(0)
  const acceptTransferSnapshot = useCallback((value: AgentTransfers) => {
    if (value.revision < transfersRevisionRef.current) return false
    transfersRevisionRef.current = value.revision
    setTransfers(value)
    return true
  }, [])
  const [diagnostics, setDiagnostics] = useState<AgentDiagnosticReport | null>(null)
  const [cloudTrashOpen, setCloudTrashOpen] = useState(false)
  const [cloudHistoryNode, setCloudHistoryNode] = useState<AgentCloudNode | null>(null)
  const [cloudHistoryCrumbs, setCloudHistoryCrumbs] = useState<AgentCloudCrumb[]>([])
  const [cloudShareNode, setCloudShareNode] = useState<AgentCloudNode | null>(null)
  const cloudFileDialogLifecycleRef = useRef('')
  const [cloudFileActionIntent, setCloudFileActionIntent] = useState<DesktopFileExplorerActionIntent | null>(null)
  const cloudFileActionSequenceRef = useRef(0)
  const [cloudFileExplorerNavigationSnapshot, setCloudFileExplorerNavigationSnapshot] = useState<{
    server: string
    username: string
    state: XDriveFileExplorerNavigationState<AgentCloudCrumb>
  } | null>(null)

  const mediaGallerySource = useMemo(
    () => createDesktopMediaGalleryDataSource(window.xdriveDesktop.agent),
    [],
  )


  const requestConfirmation = (
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => unknown | Promise<unknown>,
    tone: ConfirmDialogState['tone'] = 'primary',
  ) => {
    setConfirmDialog({ title, message, confirmLabel, onConfirm, tone })
  }

  const confirmPendingAction = async () => {
    const pending = confirmDialog
    if (!pending) return
    setConfirmDialog(null)
    await pending.onConfirm()
  }

  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginMount, setLoginMount] = useState('')
  const [loginHistory, setLoginHistory] = useState<DesktopLoginHistory>({ profiles: [], secure_password_storage: false })
  const [rememberPassword, setRememberPassword] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [serverProbe, setServerProbe] = useState<{
    key: 'idle' | 'checking' | 'ok' | 'error'
    version?: string
    detail?: string
  }>({ key: 'idle' })
  const [loginDiagnosticsOpen, setLoginDiagnosticsOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mountPath, setMountPath] = useState('')
  const [cacheLimit, setCacheLimit] = useState('0')

  const serverOptions = useMemo(
    () => Array.from(new Set(loginHistory.profiles.map((profile) => profile.server))),
    [loginHistory.profiles],
  )
  const usernameOptions = useMemo(() => {
    const normalizedServer = server.trim()
    const ordered = normalizedServer
      ? [
          ...loginHistory.profiles.filter((profile) => profile.server === normalizedServer),
          ...loginHistory.profiles.filter((profile) => profile.server !== normalizedServer),
        ]
      : loginHistory.profiles
    return Array.from(new Set(ordered.map((profile) => profile.username)))
  }, [loginHistory.profiles, server])
  const matchingLoginProfile = useMemo(
    () => loginHistory.profiles.find(
      (profile) => profile.server === server.trim() && profile.username === username.trim(),
    ),
    [loginHistory.profiles, server, username],
  )
  const hasStoredPassword = !!matchingLoginProfile?.password_available
  const savedPasswordAvailable = password.length === 0 && hasStoredPassword

  const status = agent.status
  const cloudFileExplorerNavigationState =
    cloudFileExplorerNavigationSnapshot &&
    cloudFileExplorerNavigationSnapshot.server === status?.server &&
    cloudFileExplorerNavigationSnapshot.username === status?.username
      ? cloudFileExplorerNavigationSnapshot.state
      : undefined
  const rememberCloudFileExplorerNavigationState = useCallback((
    state: XDriveFileExplorerNavigationState<AgentCloudCrumb>,
  ) => {
    const currentServer = status?.server
    const currentUsername = status?.username
    if (!currentServer || !currentUsername) return
    setCloudFileExplorerNavigationSnapshot({
      server: currentServer,
      username: currentUsername,
      state,
    })
  }, [status?.server, status?.username])
  const sourceManagerAdapter = useMemo(
    () => createDesktopSourceManagerAdapter(status?.username),
    [status?.username],
  )
  const configured = !!status?.configured
  const reloginRequired = !configured && status?.auth_status === '需要重新登录'
  const loginReady = xDriveLoginCredentialsReady({
    server,
    username,
    password,
    passwordAvailable: savedPasswordAvailable,
    requireServer: true,
  })
  const serverUpdateSupported =
    agent.hello?.capabilities.includes('server-update') ?? false
  const cloudChangeFeedSupported =
    agent.hello?.capabilities.includes('cloud-change-feed') ?? false
  const serverUpdatePort = useMemo(() => ({
    getState: () => window.xdriveDesktop.agent.getServerUpdate(),
    startUpdate: (source: 'github' | 'gitlab', channel: 'stable' | 'master', backupFileData: boolean) =>
      window.xdriveDesktop.agent.startServerUpdate(source, channel, backupFileData),
  }), [])
  const serverUpdate = useXDriveServerUpdateController({
    open: settingsOpen,
    enabled: agent.connected && configured,
    supported: serverUpdateSupported,
    port: serverUpdatePort,
    unsupportedMessage: '当前 xdrive-agent 不支持服务端更新，请先更新客户端核心组件。',
    onBusyChange: (active) => {
      setBusy((current) => active
        ? 'server-update'
        : current === 'server-update' ? '' : current)
    },
  })
  const cloudFilesPort = useMemo<XDriveCloudFilesPort<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>>(() => ({
    getRoot: async () => {
      const result = await window.xdriveDesktop.agent.cloudRoot()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    getPage: async (parentID, options) => {
      const result = await window.xdriveDesktop.agent.cloudChildrenPage(parentID, options)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    getRange: async (parentID, offset, limit, sort, includeCount, grouping, signal) => {
      const result = await xDriveDesktopViewportRequest(signal, (requestID) => window.xdriveDesktop.agent.cloudChildrenRange(
        parentID,
        offset,
        limit,
        sort.key,
        sort.direction,
        includeCount,
        grouping,
        requestID,
      ))
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    getChanges: cloudChangeFeedSupported
      ? async (after, limit) => {
          const result = await window.xdriveDesktop.agent.cloudChanges(after, limit)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    getQuota: async () => {
      const result = await window.xdriveDesktop.agent.cloudQuota()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  }), [cloudChangeFeedSupported])
  const handleCloudFilesError = useCallback((cloudError: unknown) => {
    setError(cloudError instanceof Error ? cloudError.message : String(cloudError))
  }, [])

  const {
    quota: cloudQuota,
    items: cloudItems,
    crumbs: cloudCrumbs,
    loading: cloudLoading,
    virtualDirectory: cloudVirtualDirectory,
    applyQuota: applyCloudQuota,
    refreshQuota: refreshCloudQuota,
    refreshCurrentDirectoryIfIdle: refreshCloudCurrentDirectoryIfIdle,
    loadDirectory: loadCloudDirectory,
  } = useXDriveCloudFilesController<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>({
    port: cloudFilesPort,
    enabled: agent.connected && configured,
    lifecycleKey: `${status?.server ?? ''}\n${status?.username ?? ''}`,
    defaultSort: XDRIVE_FILE_EXPLORER_DEFAULT_SORT,
    preserveStateOnDisable: true,
    onError: handleCloudFilesError,
  })

  const loadCloudFileOperations = useCallback(async (limit: number) => {
    const result = await window.xdriveDesktop.agent.cloudFileOperations(limit)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }, [])

  const {
    operations: cloudFileOperations,
    rememberOperation: rememberCloudFileOperation,
    refreshOperations: refreshCloudFileOperations,
  } = useXDriveFileOperationLifecycle<AgentCloudFileOperation>({
    enabled: agent.connected && configured,
    lifecycleKey: `${status?.server ?? ''}\n${status?.username ?? ''}`,
    taskCenterVisible: view === 'transfers' || view === 'overview',
    loadOperations: loadCloudFileOperations,
    onRefreshError: (operationError) => setError(
      operationError instanceof Error ? operationError.message : String(operationError),
    ),
    onTerminalTransition: () => {
      const expectedCurrentID = cloudCrumbs.at(-1)?.id
      void refreshCloudQuota()
      if (expectedCurrentID !== undefined) {
        void refreshCloudCurrentDirectoryIfIdle(expectedCurrentID)
      }
    },
  })

  const filesFeedbackLifecycleKey = `${status?.server ?? ''}\n${status?.username ?? ''}`
  const [filesActionFeedback, setFilesActionFeedback] = useState<{
    lifecycleKey: string
    operationID?: string
    downloadResult?: XDriveFileExplorerDownloadResult
  } | null>(null)
  const filesActionFeedbackIntentRef = useRef(0)
  useEffect(() => {
    filesActionFeedbackIntentRef.current += 1
    setFilesActionFeedback(null)
  }, [filesFeedbackLifecycleKey])
  const rememberFilesOperation = useCallback((operation: AgentCloudFileOperation) => {
    rememberCloudFileOperation(operation)
    filesActionFeedbackIntentRef.current += 1
    setFilesActionFeedback({ lifecycleKey: filesFeedbackLifecycleKey, operationID: operation.id })
  }, [filesFeedbackLifecycleKey, rememberCloudFileOperation])
  const beginFilesDownloadFeedback = useCallback(() => {
    const intent = ++filesActionFeedbackIntentRef.current
    return (result: XDriveFileExplorerDownloadResult) => {
      if (filesActionFeedbackIntentRef.current !== intent) return
      setFilesActionFeedback({ lifecycleKey: filesFeedbackLifecycleKey, downloadResult: result })
    }
  }, [filesFeedbackLifecycleKey])
  const currentFilesActionFeedback = filesActionFeedback?.lifecycleKey === filesFeedbackLifecycleKey
    ? filesActionFeedback
    : null
  const filesFeedbackOperation = currentFilesActionFeedback?.operationID
    ? cloudFileOperations.find((operation) => operation.id === currentFilesActionFeedback.operationID)
    : undefined

  const fileOperationConflictResolveSupported =
    agent.hello?.capabilities.includes('file-operation-conflict-resolution') ?? false
  const fileOperationUndoSupported =
    agent.hello?.capabilities.includes('file-operation-undo') ?? false
  const fileOperationRedoSupported =
    agent.hello?.capabilities.includes('file-operation-redo') ?? false
  const fileQuickAccessSupported =
    agent.hello?.capabilities.includes('file-quick-access') ?? false
  const fileTagsSupported =
    agent.hello?.capabilities.includes('file-tags') ?? false
  const fileSavedSearchesSupported =
    agent.hello?.capabilities.includes('file-saved-searches') ?? false
  const fileFavoritesSupported =
    agent.hello?.capabilities.includes('file-favorites') ?? false
  const fileRecentSupported =
    agent.hello?.capabilities.includes('file-recent') ?? false
  const filePropertiesStatsSupported =
    agent.hello?.capabilities.includes('file-properties-stats') ?? false
  const fileMediaDetailsSupported =
    agent.hello?.capabilities.includes('file-media-details') ?? false
  const fileAvailabilitySupported = Boolean(
    agent.hello?.platform === 'windows' &&
    agent.hello?.capabilities.includes('file-availability-batch'),
  )
  const fileOpenWithSupported =
    agent.hello?.capabilities.includes('open-with') ?? false
  const fileExplorerKeyboardProfile = xDriveFileExplorerKeyboardProfileFromPlatform(info?.platform)
  const backgroundTasksSupported =
    agent.hello?.capabilities.includes('background-tasks') ?? false
  const backgroundTaskSummarySupported =
    agent.hello?.capabilities.includes('background-task-summary') ?? false

  const fileOperationActions = useXDriveFileOperationActions<AgentCloudFileOperation, AgentTransfers>({
    lifecycleKey: `${status?.server ?? ''}\n${status?.username ?? ''}`,
    cancelOperation: async (id) => {
      const result = await window.xdriveDesktop.agent.cloudCancelFileOperation(id)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retryOperation: async (id) => {
      const result = await window.xdriveDesktop.agent.cloudRetryFileOperation(id)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    undoOperation: fileOperationUndoSupported
      ? async (id) => {
          const result = await window.xdriveDesktop.agent.cloudUndoFileOperation(id)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    redoOperation: fileOperationRedoSupported
      ? async (id) => {
          const result = await window.xdriveDesktop.agent.cloudRedoFileOperation(id)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    resolveConflict: fileOperationConflictResolveSupported
      ? async (id, policy) => {
          const result = await window.xdriveDesktop.agent.cloudResolveFileOperationConflict(id, policy)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    clearOperationHistory: async () => {
      setError('')
      const result = await window.xdriveDesktop.agent.cloudClearFileOperationHistory()
      if (!result.ok) throw new Error(result.error.message)
    },
    clearTransferHistory: async () => {
      const result = await window.xdriveDesktop.agent.clearTransferHistory('local')
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onTransferHistoryCleared: (value) => {
      acceptTransferSnapshot(value)
    },
    rememberOperation: rememberCloudFileOperation,
    refreshOperations: refreshCloudFileOperations,
    onError: (operationError) => setError(
      operationError instanceof Error ? operationError.message : String(operationError),
    ),
    onFeedback: setNotice,
  })

  const latestUndoableCloudFileOperation = xDriveLatestUndoableFileOperation(cloudFileOperations)
  const latestRedoableCloudFileOperation = xDriveLatestRedoableFileOperation(cloudFileOperations)

  const {
    busy: deleteToTrashBusy,
    remove: removeCloudNode,
    removeMany: removeCloudNodes,
  } = useXDriveFileExplorerDeleteController<AgentCloudNode, AgentCloudFileOperation>({
    lifecycleKey: `${status?.server ?? ''}\n${status?.username ?? ''}`,
    maxItems: 200,
    submitOperation: (operation, items) => {
      setError('')
      return window.xdriveDesktop.agent.cloudCreateFileOperation(operation, items)
    },
    onQueued: rememberFilesOperation,
    confirmationIntent: 'warning',
    requestConfirmation: (confirmation) => requestConfirmation(
      confirmation.title,
      confirmation.description,
      confirmation.confirmLabel,
      confirmation.run,
      confirmation.intent === 'danger' ? 'error' : 'warning',
    ),
    onFeedback: setNotice,
    onError: (deleteError) => setError(
      deleteError instanceof Error ? deleteError.message : String(deleteError),
    ),
  })

  const backgroundTaskPort = useMemo(() => backgroundTasksSupported ? ({
    loadActiveSummary: backgroundTaskSummarySupported
      ? async () => {
          const result = await window.xdriveDesktop.agent.cloudBackgroundTaskActiveSummary()
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    loadMinePage: async (limit: number, cursor?: string) => {
      const result = await window.xdriveDesktop.agent.cloudBackgroundTaskPage(
        false,
        limit,
        cursor ?? '',
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadGlobalPage: status?.role === 'admin'
      ? async (limit: number, cursor?: string) => {
          const result = await window.xdriveDesktop.agent.cloudBackgroundTaskPage(
            true,
            limit,
            cursor ?? '',
          )
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    control: async (id: string, action: string, global: boolean) => {
      const result = await window.xdriveDesktop.agent.cloudBackgroundTaskControl(
        id,
        action,
        global,
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  }) : undefined, [
    backgroundTaskSummarySupported,
    backgroundTasksSupported,
    status?.role,
  ])

  const taskCenter = useXDriveTaskCenterController({
    transfers: transfers.transfers,
    operations: cloudFileOperations,
    operationActions: fileOperationActions,
    externalBusy: Boolean(busy) || deleteToTrashBusy,
    conflictResolutionEnabled: fileOperationConflictResolveSupported,
    backgroundTaskPort,
    backgroundTasksEnabled: agent.connected && configured && backgroundTasksSupported,
    backgroundTasksVisible: view === 'transfers' || view === 'global-tasks' || view === 'overview',
    globalTasksEnabled: status?.role === 'admin',
    backgroundScope: view === 'global-tasks' ? 'global' : 'mine',
    onBackgroundTaskError: (taskError) => setError(
      taskError instanceof Error ? taskError.message : String(taskError),
    ),
  })

  const filesOperationFocusSequenceRef = useRef(0)
  const [filesOperationFocus, setFilesOperationFocus] = useState<{ operationID: string; requestID: number } | null>(null)
  useEffect(() => { setFilesOperationFocus(null) }, [filesFeedbackLifecycleKey])
  useEffect(() => {
    if (view !== 'transfers') setFilesOperationFocus(null)
  }, [view])
  const openFilesOperationTask = useCallback((operationID: string) => {
    taskCenter.pageProps.onBackgroundScopeChange?.('mine')
    filesOperationFocusSequenceRef.current += 1
    setFilesOperationFocus({ operationID, requestID: filesOperationFocusSequenceRef.current })
    setView('transfers')
  }, [taskCenter.pageProps.onBackgroundScopeChange])

  const updateSupported = agent.hello?.capabilities.includes('client-update') ?? false
  const updateCancelSupported = agent.hello?.capabilities.includes('client-update-cancel') ?? false
  const storageStatsSupported = agent.hello?.capabilities.includes('storage-intelligence') ?? false
  const storagePoliciesSupported = info?.platform === 'win32'
  const cloudStorageSource = useMemo(() => createXDriveCloudStorageDataSource({
    getQuota: () => window.xdriveDesktop.agent.cloudQuota(),
    getStats: storageStatsSupported
      ? () => window.xdriveDesktop.agent.cloudStorageStats()
      : undefined,
  }, {
    onQuota: applyCloudQuota,
    statsUnavailableMessage: storageStatsSupported
      ? undefined
      : '当前 xdrive-agent 不支持账号文件大小分布，请更新客户端核心组件。',
  }), [applyCloudQuota, storageStatsSupported])
  const localStorageSource = useMemo<XDriveLocalStorageDataSource>(() => ({
    load: async () => {
      const [browserResult, treeResult, cacheResult] = await Promise.all([
        window.xdriveDesktop.getBrowserCache(),
        window.xdriveDesktop.agent.getStorageTree(),
        window.xdriveDesktop.agent.getCache(),
      ])
      if (!browserResult.ok) throw new Error(browserResult.error.message)
      const desktopReason = !cacheResult.ok
        ? cacheResult.error.message
        : !treeResult.ok
          ? treeResult.error.message
          : undefined
      return {
        browserStorage: {
          supported: true,
          cache_bytes: browserResult.data.used_bytes,
          clear_supported: true,
          scope_label: 'Electron HTTP 缓存',
          detail: 'Desktop 的浏览器缓存由 Electron 单独管理；清理不会删除 Cookie、登录状态、token、主题、布局或其他应用偏好。',
        },
        desktopStorage: {
          supported: cacheResult.ok || treeResult.ok,
          reason: desktopReason,
          storagePoliciesSupported: storagePoliciesSupported && treeResult.ok,
          cacheStats: cacheResult.ok ? cacheResult.data : null,
          storageTree: treeResult.ok ? treeResult.data : null,
        },
      }
    },
    clearBrowserCache: async () => {
      const result = await window.xdriveDesktop.clearBrowserCache()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    releaseDesktopCache: async () => {
      const result = await window.xdriveDesktop.agent.releaseCache()
      if (!result.ok) throw new Error(result.error.message)
      return {
        released_files: result.data.released_files,
        released_bytes: result.data.released_bytes,
        failed_files: result.data.failed_files,
      }
    },
    setFolderMode: storagePoliciesSupported
      ? async (path, mode) => {
          const result = await window.xdriveDesktop.agent.setSyncRule(path, mode)
          if (!result.ok) throw new Error(result.error.message)
          setSettings(result.data)
        }
      : undefined,
  }), [storagePoliciesSupported])
  const updateOperationBusy = clientUpdate?.status === 'checking' || clientUpdate?.status === 'downloading' || clientUpdate?.status === 'installing'
  const updateProgress = clientUpdate?.bytes_total
    ? Math.max(0, Math.min(100, ((clientUpdate.bytes_done || 0) * 100) / clientUpdate.bytes_total))
    : 0
  const globalSyncState = useMemo<{
    label: string
    tone: XDriveStatusTone
  }>(() => {
    if (status?.last_error) return { label: '同步异常', tone: 'bad' }
    if (status?.has_conflict) return { label: `${status.conflict_count || 0} 个冲突`, tone: 'warning' }
    if (status?.paused) return { label: '同步已暂停', tone: 'warning' }
    if (taskCenter.activeTransferCount > 0) return { label: `正在同步 · ${taskCenter.activeTransferCount}`, tone: 'busy' }
    return { label: status?.sync_status || '同步正常', tone: 'good' }
  }, [
    taskCenter.activeTransferCount,
    status?.conflict_count,
    status?.has_conflict,
    status?.last_error,
    status?.paused,
    status?.sync_status,
  ])

  useEffect(() => {
    let active = true
    void window.xdriveDesktop.getInfo().then((value) => {
      if (active) setInfo(value)
    })
    void window.xdriveDesktop.getPreferences().then((value) => {
      if (active) setDesktopPreferences(value)
    })
    void window.xdriveDesktop.getLoginHistory().then((value) => {
      if (!active) return
      setLoginHistory(value)
      const latest = value.profiles[0]
      if (latest) {
        setServer(latest.server)
        setUsername(latest.username)
        setLoginMount(latest.mount_path || '')
        setRememberPassword(value.secure_password_storage && latest.remember_password)
        setAutoLogin(value.secure_password_storage && latest.auto_login)
      }
    })
    void window.xdriveDesktop.getWindowState().then((value) => {
      if (active) setWindowMaximized(value.maximized)
    })
    void window.xdriveDesktop.agent.getState().then((value) => {
      if (active) setAgent(value)
    })
    const unsubscribe = window.xdriveDesktop.agent.onState((value) => {
      if (active) setAgent(value)
    })
    const unsubscribeLoginHistory = window.xdriveDesktop.onLoginHistory((value) => {
      if (active) setLoginHistory(value)
    })
    const unsubscribeTransfers = window.xdriveDesktop.agent.onTransfers((value) => {
      if (active) {
        transfersRevisionRef.current = value.revision
        setTransfers(value)
      }
    })
    const unsubscribeWindowState = window.xdriveDesktop.onWindowState((value) => {
      if (active) setWindowMaximized(value.maximized)
    })
    const unsubscribeNavigate = window.xdriveDesktop.onNavigate((target) => {
      if (!active) return
      if (target === 'settings' || target === 'settings-update') {
        setSettingsOpen(true)
        if (target === 'settings-update') {
          window.setTimeout(() => {
            document.getElementById('client-update-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 120)
        }
        return
      }
      if (target === 'files') {
        setView('local-storage')
        return
      }
      if (target === 'cloud') {
        setView('files')
        return
      }
      if (target === 'transfers') {
        setTransferPopoverOpen(true)
        return
      }
      setView(target)
    })
    return () => {
      active = false
      unsubscribe()
      unsubscribeLoginHistory()
      unsubscribeTransfers()
      unsubscribeWindowState()
      unsubscribeNavigate()
    }
  }, [])

  useEffect(() => {
    transfersRevisionRef.current = 0
    setTransfers({ revision: 0, transfers: [] })
    setTransferPopoverOpen(false)

    if (!status?.server || !status?.username) return () => undefined

    let active = true
    void window.xdriveDesktop.agent.getTransfers().then((value) => {
      if (active) acceptTransferSnapshot(value)
    })

    return () => {
      active = false
    }
  }, [acceptTransferSnapshot, status?.server, status?.username])

  useEffect(() => {
    if (view === 'global-tasks' && status?.role !== 'admin') setView('transfers')
  }, [view, status?.role])

  useEffect(() => {
    if (configured || !status) return
    if (status.server) {
      setServer((current) => reloginRequired ? status.server || '' : current || status.server || '')
    }
    if (status.username) {
      setUsername((current) => reloginRequired ? status.username || '' : current || status.username || '')
    }
    if (status.mount_path) {
      setLoginMount((current) => reloginRequired ? status.mount_path || '' : current || status.mount_path || '')
    }
  }, [configured, reloginRequired, status?.mount_path, status?.server, status?.username])

  useEffect(() => {
    if (!matchingLoginProfile) {
      setRememberPassword(false)
      setAutoLogin(false)
      return
    }
    setRememberPassword(loginHistory.secure_password_storage && matchingLoginProfile.remember_password)
    setAutoLogin(loginHistory.secure_password_storage && matchingLoginProfile.auto_login)
  }, [loginHistory.secure_password_storage, matchingLoginProfile])

  useEffect(() => {
    if (configured) {
      setServerProbe({ key: 'idle' })
      return
    }
    const candidate = server.trim()
    if (!candidate) {
      setServerProbe({ key: 'idle' })
      return
    }
    let active = true
    setServerProbe({ key: 'checking' })
    const timer = window.setTimeout(() => {
      void window.xdriveDesktop.probeServer(candidate).then((result) => {
        if (!active) return
        if (result.ok) {
          setServerProbe({ key: 'ok', version: result.data.version })
          return
        }
        setServerProbe({ key: 'error', detail: result.error.message })
      })
    }, 450)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [configured, server])

  useEffect(() => {
    if (!agent.connected || !(agent.hello?.capabilities.includes('client-update') ?? false)) {
      setClientUpdate(null)
      return
    }
    let active = true
    const refresh = async () => {
      const result = await window.xdriveDesktop.agent.getUpdate()
      if (active && result.ok) setClientUpdate(result.data)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 4_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [agent.connected, agent.hello?.agent_version])

  useEffect(() => {
    const fileDialogLifecycleKey = `${status?.server ?? ''}\n${status?.username ?? ''}`
    if (cloudFileDialogLifecycleRef.current !== fileDialogLifecycleKey) {
      cloudFileDialogLifecycleRef.current = fileDialogLifecycleKey
      setCloudHistoryNode(null)
      setCloudHistoryCrumbs([])
      setCloudShareNode(null)
    }
    if (!agent.connected || !configured) {
      setSettings(null)
      setConflicts([])
      setDiagnostics(null)
      setCloudHistoryNode(null)
      setCloudHistoryCrumbs([])
      setCloudShareNode(null)
      return
    }
    if (settingsOpen) void loadSettings()
    if (view === 'conflicts') void loadConflicts()
    // Refresh lightweight settings/conflict state when the Agent revision changes.
    // Diagnostics are intentionally excluded because they perform network/system checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    settingsOpen,
    agent.connected,
    configured,
    status?.revision,
    status?.server,
    status?.username,
  ])

  useEffect(() => {
    if (view !== 'diagnostics' || !agent.connected || !configured) return
    void loadDiagnostics()
    // Diagnostics run once when entering the page or reconnecting, not on every status revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  const headline = useMemo(() => {
    if (!agent.connected) return 'xdrive-agent 未连接'
    if (!configured) return '登录 xDrive'
    if (status?.must_change_password) return '修改密码'
    if (status?.has_conflict) return `${status.conflict_count} 个冲突需要处理`
    if (status?.paused) return '同步已暂停'
    return status?.sync_status || 'xDrive 已就绪'
  }, [agent.connected, configured, status])

  const run = async <T,>(name: string, action: () => Promise<DesktopResult<T>>, success?: string) => {
    setBusy(name)
    setError('')
    setNotice('')
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error.message)
        return null
      }
      if (success) setNotice(success)
      return result.data
    } finally {
      setBusy('')
    }
  }

  const requestLogout = () => {
    requestConfirmation(
      '退出当前设备？',
      '确定要在此设备上退出 xDrive 吗？',
      '退出登录',
      async () => { await run('logout', () => window.xdriveDesktop.agent.logout()) },
      'error',
    )
  }

  const restartAgent = async () => {
    const data = await run('restart-agent', () => window.xdriveDesktop.agent.restart(), 'xdrive-agent 已重启。')
    if (data) setAgent(data)
  }

  const changeStartAtLogin = async (enabled: boolean) => {
    const result = await window.xdriveDesktop.setStartup(enabled)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDesktopPreferences((current) => ({ ...current, start_at_login: result.data.start_at_login }))
    setNotice(enabled ? 'xDrive 桌面版将在登录系统后自动启动。' : '已关闭开机启动。')
  }

  const changeCloseToTray = async (enabled: boolean) => {
    const result = await window.xdriveDesktop.setCloseToTray(enabled)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDesktopPreferences(result.data)
    setNotice(enabled ? '关闭窗口时将继续在系统托盘后台运行。' : '关闭窗口时将退出 xDrive 桌面版。')
  }

  const changeAppearance = async (next: XDriveAppearance) => {
    setBusy('appearance')
    setError('')
    try {
      await onAppearanceChange(next)
      setDesktopPreferences((current) => ({ ...current, appearance: next }))
      setNotice(next === 'system' ? '外观已改为跟随系统。' : next === 'dark' ? '已切换到黑夜模式。' : '已切换到白天模式。')
    } catch (error) {
      setError(error instanceof Error ? error.message : '切换外观失败。')
    } finally {
      setBusy('')
    }
  }

  const retry = async () => {
    setBusy('retry')
    setError('')
    const state = await window.xdriveDesktop.agent.retry()
    setAgent(state)
    if (!state.connected) setError(state.error || 'xdrive-agent 当前不可用。')
    setBusy('')
  }

  const chooseDirectory = async (current: string, apply: (value: string) => void) => {
    const selected = await window.xdriveDesktop.selectDirectory(current || undefined)
    if (selected) apply(selected)
  }

  const applyLoginProfile = (profile?: DesktopLoginProfile) => {
    if (!profile) return
    setLoginMount(profile.mount_path || '')
    setRememberPassword(loginHistory.secure_password_storage && profile.remember_password)
    setAutoLogin(loginHistory.secure_password_storage && profile.auto_login)
    setPassword('')
    setError('')
  }

  const selectLoginServer = (value: string) => {
    setServer(value)
    const normalized = value.trim()
    const profile = loginHistory.profiles.find((item) => item.server === normalized)
    if (profile) {
      setUsername(profile.username)
      applyLoginProfile(profile)
    }
  }

  const selectLoginUsername = (value: string) => {
    setUsername(value)
    const normalized = value.trim()
    const currentServer = server.trim()
    const profile = currentServer
      ? loginHistory.profiles.find((item) => item.server === currentServer && item.username === normalized)
      : loginHistory.profiles.find((item) => item.username === normalized)
    if (profile) {
      if (!currentServer) setServer(profile.server)
      applyLoginProfile(profile)
    }
  }

  const refreshLoginHistory = async () => {
    const value = await window.xdriveDesktop.getLoginHistory()
    setLoginHistory(value)
    return value
  }

  const login = async (event: FormEvent) => {
    event.preventDefault()
    if (!server.trim()) {
      setError('请输入服务器地址。')
      return
    }
    if (!username.trim()) {
      setError('请输入用户名。')
      return
    }
    if (!password && !savedPasswordAvailable) {
      setError('请输入密码。')
      return
    }
    setLoginHistory((current) => ({ ...current, auto_login_error: undefined }))
    const remember = loginHistory.secure_password_storage && rememberPassword
    const result = await run('login', () => window.xdriveDesktop.agent.login({
      server: server.trim(),
      username: username.trim(),
      password,
      ...(loginMount.trim() ? { mount_path: loginMount.trim() } : {}),
      remember_password: remember,
      auto_login: remember && autoLogin,
      use_saved_password: savedPasswordAvailable,
    }))
    if (result) {
      setPassword('')
        await refreshLoginHistory()
    }
  }

  const clearSavedLoginPassword = async () => {
    const serverValue = server.trim()
    const usernameValue = username.trim()
    if (!serverValue || !usernameValue || !hasStoredPassword) return
    const result = await run(
      'clear-saved-password',
      () => window.xdriveDesktop.clearSavedPassword(serverValue, usernameValue),
    )
    if (!result) return
    setLoginHistory(result)
    setRememberPassword(false)
    setAutoLogin(false)
    setPassword('')
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    const validationError = xDrivePasswordChangeValidationError({
      current: currentPassword,
      next: newPassword,
      confirm: confirmPassword,
    })
    if (validationError) {
      setError(validationError)
      return
    }
    const result = await run('password', () => window.xdriveDesktop.agent.changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    }), '密码已更新。')
    if (result) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  const loadSettings = async () => {
    const result = await window.xdriveDesktop.agent.getSettings()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setSettings(result.data)
    setMountPath(result.data.mount_path)
    setCacheLimit(cacheGiB(result.data.cache_limit_bytes))
  }

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    const gib = Number(cacheLimit)
    if (!Number.isFinite(gib) || gib < 0 || gib > 16384) {
      setError('缓存上限必须在 0 到 16384 GiB 之间。')
      return
    }
    const data = await run('settings', () => window.xdriveDesktop.agent.updateSettings({
      mount_path: mountPath.trim(),
      cache_limit_bytes: Math.round(gib * 1024 ** 3),
    }), '设置已保存。')
    if (data) setSettings(data)
  }

  const changeUpdateMode = async (mode: AgentUpdateMode) => {
    const data = await run(
      'update-mode',
      () => window.xdriveDesktop.agent.setUpdateMode(mode),
      mode === 'manual' ? '已关闭后台更新检查。' : '更新策略已保存，并将按新策略检查更新。',
    )
    if (data) setClientUpdate(data)
  }

  const changeUpdateSource = async (source: AgentUpdateSource) => {
    const data = await run(
      'update-source',
      () => window.xdriveDesktop.agent.setUpdateSource(source),
      `更新来源已切换为 ${source === 'gitlab' ? 'GitLab' : 'GitHub'}；下一次检查更新时生效。`,
    )
    if (data) setClientUpdate(data)
  }

  const checkClientUpdate = async () => {
    const data = await run('update-check', () => window.xdriveDesktop.agent.checkUpdate())
    if (!data) return
    setClientUpdate(data)
    setNotice(data.message === '更新操作已取消。'
      ? '更新操作已取消。'
      : data.update_available ? `发现新版本 ${data.latest_version || ''}。` : '当前已是最新版本。')
  }

  const downloadClientUpdate = async () => {
    const data = await run('update-download', () => window.xdriveDesktop.agent.downloadUpdate())
    if (!data) return
    setClientUpdate(data)
    setNotice(data.message === '更新操作已取消。'
      ? '更新操作已取消。'
      : data.downloaded ? '更新已下载并通过校验，等待安装。'
        : data.update_available ? `发现新版本 ${data.latest_version || ''}。` : '当前已是最新版本。')
  }

  const installClientUpdate = () => {
    requestConfirmation(
      '安装客户端更新？',
      '安装更新将关闭当前 xDrive 客户端，完成校验后自动重启。',
      '安装并重启',
      async () => {
        const data = await run('update-install', () => window.xdriveDesktop.agent.installUpdate())
        if (!data) return
        setClientUpdate(data)
        setNotice(data.message === '更新操作已取消。'
          ? '更新操作已取消。'
          : data.status === 'installing' ? '更新安装已启动，xDrive 将完成验证并重启。'
            : data.update_available ? `发现新版本 ${data.latest_version || ''}。` : '当前已是最新版本。')
      },
      'warning',
    )
  }

  const cancelClientUpdate = async () => {
    setUpdateCancelling(true)
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cancelUpdate()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setClientUpdate(result.data)
      setNotice('更新操作已取消。')
    } finally {
      setUpdateCancelling(false)
    }
  }

  const retryTransfer = async (id: string) => {
    const data = await run(`retry-transfer-${id}`, () => window.xdriveDesktop.agent.retryTransfer(id), '传输重试已完成。')
    if (data) acceptTransferSnapshot(data)
  }

  const clearNetworkTransferHistory = async () => {
    const data = await run('clear-transfer-history', () => window.xdriveDesktop.agent.clearTransferHistory('network'), '已清空传输历史。')
    if (data) acceptTransferSnapshot(data)
  }

  const openCloudTrash = () => setCloudTrashOpen(true)

  const cloudFileActionLifecycleKey = status?.server && status?.username
    ? `xdrive.desktop.files.navigation_session.v1:${encodeURIComponent(status.server)}:${encodeURIComponent(status.username)}`
    : ''

  const requestCloudFileAction = useCallback((action: DesktopFileExplorerAction) => {
    cloudFileActionSequenceRef.current += 1
    setCloudFileActionIntent({
      id: cloudFileActionSequenceRef.current,
      action,
      lifecycleKey: cloudFileActionLifecycleKey,
    })
    setView('files')
  }, [cloudFileActionLifecycleKey])

  const openCloud历史版本 = (node: AgentCloudNode, crumbs = cloudCrumbs) => {
    setCloudHistoryNode(node)
    setCloudHistoryCrumbs(crumbs)
  }

  const openCloudShares = (node: AgentCloudNode) => {
    setCloudShareNode(node)
  }

  const loadDiagnostics = async () => {
    setBusy('diagnostics')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.getDiagnostics()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setDiagnostics(result.data)
    } finally {
      setBusy('')
    }
  }

  const runDiagnosticAction = async (
    name: string,
    action: () => Promise<DesktopResult<unknown>>,
    success: string,
  ) => {
    const data = await run(name, action, success)
    if (data) await loadDiagnostics()
  }

  const exportDiagnostics = async () => {
    const data = await run('export-diagnostics', () => window.xdriveDesktop.agent.exportDiagnostics())
    if (!data) return
    if (data.saved) setNotice('诊断报告已导出。')
  }

  const loadConflicts = async () => {
    const result = await window.xdriveDesktop.agent.getConflicts()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setConflicts(result.data)
  }

  const dismissFeedback = () => {
    setError('')
    setNotice('')
  }

  const renderDesktopFrame = (content: ReactNode, titlebarActions?: ReactNode) => (
    <DesktopFrame maximized={windowMaximized} titlebarActions={titlebarActions}>
      {content}
      <XDriveFeedbackSnackbar
        open={Boolean(error || notice) && (configured || !agent.connected)}
        tone={error ? 'bad' : 'good'}
        message={error || notice}
        onClose={dismissFeedback}
        autoHideDuration={error ? null : 4000}
        variant="filled"
        dismissible
        alertSx={{ width: '100%', maxWidth: 520, alignItems: 'flex-start', boxShadow: 3 }}
      />
    </DesktopFrame>
  )

  const desktopSidebarSections: XDriveSidebarSectionModel[] = [
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
    {
      key: 'conflicts',
      placement: 'after-core',
      items: [
        {
          key: 'conflicts',
          label: '冲突',
          icon: <WarningAmberRoundedIcon fontSize="small" />,
          badge: status?.conflict_count,
        },
      ],
    },
    {
      key: 'diagnostics',
      ariaLabel: '桌面版辅助功能',
      placement: 'bottom',
      items: [
        {
          key: 'diagnostics',
          label: '诊断',
          icon: <BuildRoundedIcon fontSize="small" />,
        },
      ],
    },
  ]

  if (!agent.connected) {
    return renderDesktopFrame(
      <XDriveAuthShell>
        <XDriveAuthPanel>
          <Typography
            variant="overline"
            color="primary.main"
            fontWeight={800}
            sx={{ display: 'block', mb: 1, letterSpacing: '0.14em', lineHeight: 1.4 }}
          >
            AGENT 连接
          </Typography>
          <Typography
            component="h1"
            variant="h4"
            fontWeight={700}
            sx={{ fontSize: 27, letterSpacing: '-0.015em', lineHeight: 1.15 }}
          >
            {headline}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 500, mt: 1, lineHeight: 1.6 }}>
            xDrive 桌面版会自动启动并监控 Go 后台 Agent。如果自动恢复失败，请确认已安装完整的 xDrive 客户端。
          </Typography>
          <MuiBox
            sx={{
              my: 2.25,
              borderRadius: 1.5,
              p: 1.5,
              bgcolor: 'action.hover',
              color: 'text.secondary',
              fontSize: 13,
              overflowWrap: 'anywhere',
            }}
          >
            {agent.error || '正在等待桌面 IPC 连接…'}
          </MuiBox>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            sx={{ mt: 2.5, '& > *': { flex: 1 } }}
          >
            <XDriveActionButton
              intent="primary"
              disabled={!!busy}
              loading={busy === 'retry'}
              loadingLabel="正在连接…"
              onClick={() => void retry()}
            >
              重试连接
            </XDriveActionButton>
            <XDriveActionButton
              disabled={!!busy}
              loading={busy === 'restart-agent'}
              loadingLabel="正在重启…"
              onClick={() => void restartAgent()}
            >
              启动 / 重启 Agent
            </XDriveActionButton>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 2.25 }}>
            {info ? `桌面版 ${info.version} · ${platformLabel(info.platform)} ${info.arch}` : '正在加载桌面信息…'}
          </Typography>
        </XDriveAuthPanel>
      </XDriveAuthShell>
    )
  }

  if (!configured) {
    const buildLabel = info
      ? [
          `桌面版 ${info.version}`,
          info.channel,
          info.commit ? info.commit.slice(0, 10) : undefined,
          `${platformLabel(info.platform)} ${info.arch}`,
        ].filter(Boolean).join(' · ')
      : '正在加载桌面信息…'

    return renderDesktopFrame(
      <XDriveAuthShell>
        <XDriveAuthPanel
          form
          onSubmit={login}
        >
          <MuiBox sx={{ mb: 2.25 }}>
            <XDriveBrandLockup
              iconSrc={xDriveBrandIcon}
              variant="compact"
              subtitle="桌面版"
            />
          </MuiBox>
          <Typography
            component="h1"
            variant="h4"
            fontWeight={700}
            sx={{ fontSize: 27, letterSpacing: '-0.015em', lineHeight: 1.15 }}
          >
            {reloginRequired ? '登录状态已失效' : '欢迎使用 xDrive'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 500, mt: 1, lineHeight: 1.6 }}>
            {reloginRequired
              ? '你的登录状态已过期，请重新验证身份。原有同步设置会继续保留。'
              : '连接到你的 xDrive 服务器，登录后即可访问并同步文件。'}
          </Typography>

          <Stack spacing={1.75} sx={{ mt: 2.75 }}>
            {loginHistory.auto_login_error ? (
              <XDriveStatusAlert tone="warning">
                自动登录未成功，已暂时关闭自动登录：{loginHistory.auto_login_error}
              </XDriveStatusAlert>
            ) : null}
            {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}

            <XDriveAuthField
              label="服务器"
              htmlFor="desktop-login-server"
              required
              helper={(
                <XDriveAuthFieldStatus
                  loading={serverProbe.key === 'checking'}
                  tone={serverProbe.key === 'ok' ? 'good' : serverProbe.key === 'error' ? 'bad' : 'neutral'}
                  title={serverProbe.key === 'error' ? serverProbe.detail : undefined}
                >
                  {serverProbe.key === 'checking'
                    ? '正在检查服务器…'
                    : serverProbe.key === 'ok'
                      ? `服务器可访问${serverProbe.version ? ` · ${serverProbe.version}` : ''}`
                      : serverProbe.key === 'error'
                        ? '暂时无法连接此服务器；请检查地址、端口或证书。'
                        : '支持自建 xDrive 服务器；连接会在登录时再次验证。'}
                </XDriveAuthFieldStatus>
              )}
            >
              <Autocomplete
                freeSolo
                size="small"
                options={serverOptions}
                inputValue={server}
                disabled={busy === 'login'}
                onInputChange={(_event, value, reason) => {
                  if (reason !== 'reset') {
                    setServer(value)
                    setError('')
                  }
                }}
                onChange={(_event, value) => {
                  if (typeof value === 'string') selectLoginServer(value)
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    id="desktop-login-server"
                    fullWidth
                    size="small"
                    placeholder="https://drive.example.com"
                    autoFocus={!server}
                    required
                  />
                )}
              />
            </XDriveAuthField>

            <XDriveAuthField
              label="用户名"
              htmlFor="desktop-login-username"
              required
            >
              <Autocomplete
                freeSolo
                size="small"
                options={usernameOptions}
                inputValue={username}
                disabled={busy === 'login'}
                onInputChange={(_event, value, reason) => {
                  if (reason !== 'reset') {
                    setUsername(value)
                    setError('')
                  }
                }}
                onChange={(_event, value) => {
                  if (typeof value === 'string') selectLoginUsername(value)
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    id="desktop-login-username"
                    fullWidth
                    size="small"
                    autoComplete="username"
                    autoFocus={Boolean(server) && !username}
                    required
                  />
                )}
              />
            </XDriveAuthField>

            <XDriveAuthPasswordField
              id="desktop-login-password"
              value={password}
              disabled={busy === 'login'}
              required={!savedPasswordAvailable}
              autoFocus={Boolean(server) && Boolean(username)}
              placeholder={savedPasswordAvailable ? '••••••••••••' : '输入密码'}
              saved={hasStoredPassword}
              clearSavedDisabled={Boolean(busy)}
              onClearSaved={hasStoredPassword ? () => { void clearSavedLoginPassword() } : undefined}
              helper={password && hasStoredPassword
                ? '登录成功后将更新系统保存的密码。'
                : savedPasswordAvailable
                  ? '将使用系统安全保存的密码。'
                  : '密码输入默认隐藏，不会以明文写入配置文件。'}
              onChange={(value) => {
                setPassword(value)
                setError('')
              }}
            />

            <Stack
              direction="row"
              useFlexGap
              flexWrap="wrap"
              sx={{
                minHeight: 34,
                gap: '8px 28px',
                '& .MuiFormControlLabel-root': { m: 0 },
                '& .MuiCheckbox-root': { p: '4px 7px 4px 0' },
                '& .MuiFormControlLabel-label': {
                  color: 'text.secondary',
                  fontSize: 12.5,
                  fontWeight: 500,
                },
              }}
            >
              <FormControlLabel
                control={(
                  <Checkbox
                    size="small"
                    checked={rememberPassword}
                    disabled={!loginHistory.secure_password_storage || !!busy}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setRememberPassword(checked)
                      if (!checked) setAutoLogin(false)
                    }}
                  />
                )}
                label="安全保存密码"
              />
              <FormControlLabel
                control={(
                  <Checkbox
                    size="small"
                    checked={autoLogin}
                    disabled={!loginHistory.secure_password_storage || !!busy}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setAutoLogin(checked)
                      if (checked) setRememberPassword(true)
                    }}
                  />
                )}
                label="启动 xDrive 时自动登录"
              />
            </Stack>

            {loginHistory.secure_password_storage ? (
              <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ color: 'text.secondary' }}>
                <InfoOutlinedIcon sx={{ mt: '1px', color: 'text.disabled', fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontSize: 11.5, lineHeight: 1.5 }}>
                  密码由操作系统安全凭据存储加密，不会以明文写入配置文件。
                </Typography>
              </Stack>
            ) : (
              <XDriveStatusAlert tone="warning">
                当前系统没有可用的安全凭据存储，因此无法保存密码或启用自动登录。
              </XDriveStatusAlert>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11.5, lineHeight: 1.5 }}>
              {loginMount
                ? '将继续使用已配置的同步文件夹；登录后可在“设置”中修改。'
                : '同步文件夹将在登录后使用默认位置，并可在“设置”中修改。'}
            </Typography>

            <XDriveAuthSubmitRow hint="按 Enter 登录">
              <XDriveActionButton
                intent="primary"
                type="submit"
                disabled={!loginReady || !!busy}
                loading={busy === 'login'}
                loadingLabel="正在登录…"
              >
                登录
              </XDriveActionButton>
            </XDriveAuthSubmitRow>
          </Stack>

          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            justifyContent="center"
            sx={{ minHeight: 26, mt: 2 }}
          >
            <Typography
              component="span"
              variant="caption"
              title={info?.commit || undefined}
              color="text.disabled"
              sx={{ overflowWrap: 'anywhere', textAlign: 'center', fontSize: 11, lineHeight: 1.45 }}
            >
              {buildLabel}
            </Typography>
            <Typography component="span" variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
              ·
            </Typography>
            <XDriveActionButton
              compact
              startIcon={<BuildRoundedIcon fontSize="small" />}
              title={loginDiagnosticsOpen ? '收起登录诊断' : '展开登录诊断'}
              onClick={() => setLoginDiagnosticsOpen((current) => !current)}
            >
              {loginDiagnosticsOpen ? '收起诊断' : '诊断'}
            </XDriveActionButton>
          </Stack>

          {loginDiagnosticsOpen ? (
            <MuiBox
              aria-label="登录诊断"
              sx={{
                mt: 0.75,
                pt: 1.25,
                borderTop: 1,
                borderColor: 'divider',
                display: 'grid',
                gap: 0.75,
              }}
            >
              {[
                ['Agent', '已连接', 'good'],
                [
                  '服务器',
                  serverProbe.key === 'ok'
                    ? '可访问'
                    : serverProbe.key === 'error'
                      ? '连接失败'
                      : serverProbe.key === 'checking'
                        ? '检查中'
                        : '等待检查',
                  serverProbe.key === 'ok' ? 'good' : serverProbe.key === 'error' ? 'bad' : 'neutral',
                ],
                [
                  '安全凭据存储',
                  loginHistory.secure_password_storage ? '可用' : '不可用',
                  loginHistory.secure_password_storage ? 'good' : 'bad',
                ],
                ['当前账号密码', hasStoredPassword ? '已安全保存' : '未保存', 'neutral'],
              ].map(([label, value, tone]) => (
                <Stack
                  key={label}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11.5 }}>
                    {label}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={tone === 'good' ? 'success.main' : tone === 'bad' ? 'error.main' : 'text.secondary'}
                    sx={{ fontSize: 11.5, fontWeight: 650 }}
                  >
                    {value}
                  </Typography>
                </Stack>
              ))}
              {serverProbe.key === 'error' && serverProbe.detail ? (
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ mt: 0.125, fontSize: 11, lineHeight: 1.45, overflowWrap: 'anywhere' }}
                >
                  {serverProbe.detail}
                </Typography>
              ) : null}
              <MuiBox sx={{ justifySelf: 'end', mt: 0.125 }}>
                <XDriveActionButton
                  compact
                  disabled={!!busy}
                  onClick={() => void run('login-open-logs', () => window.xdriveDesktop.agent.openLogs())}
                >
                  打开日志
                </XDriveActionButton>
              </MuiBox>
            </MuiBox>
          ) : null}
        </XDriveAuthPanel>
      </XDriveAuthShell>
    )
  }

  if (status?.must_change_password) {
    return renderDesktopFrame(
      <XDriveAuthShell>
        <XDriveAuthPanel>
          <Typography
            variant="overline"
            color="primary.main"
            fontWeight={800}
            sx={{ display: 'block', mb: 1, letterSpacing: '0.14em', lineHeight: 1.4 }}
          >
            需要修改密码
          </Typography>
          <Typography
            component="h1"
            variant="h4"
            fontWeight={700}
            sx={{ fontSize: 27, letterSpacing: '-0.015em', lineHeight: 1.15 }}
          >
            {headline}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 500, mt: 1, lineHeight: 1.6 }}>
            管理员要求先修改密码，之后才能开始同步。
          </Typography>
          <XDrivePasswordChangeForm
            sx={{ mt: 2.75 }}
            submitFullWidth
            values={{
              current: currentPassword,
              next: newPassword,
              confirm: confirmPassword,
            }}
            error={error}
            loading={busy === 'password'}
            onChange={(field, value) => {
              setError('')
              if (field === 'current') setCurrentPassword(value)
              else if (field === 'next') setNewPassword(value)
              else setConfirmPassword(value)
            }}
            onSubmit={changePassword}
          />
        </XDriveAuthPanel>
      </XDriveAuthShell>
    )
  }

  const desktopTitlebarActions = (
    <Stack direction="row" alignItems="center" spacing={0.25} className="desktop-titlebar-action-row">
      <XDriveStatusBadge
        ariaLabel="同步状态"
        variant="outlined"
        tone={globalSyncState.tone}
        label={globalSyncState.label}
        onClick={(event) => {
          setAccountMenuAnchor(null)
          setSyncMenuAnchor(event.currentTarget)
        }}
      />
      <Tooltip title={status?.paused ? '同步已暂停' : '立即同步'}>
        <span>
          <IconButton className="desktop-titlebar-action" aria-label="立即同步" size="small" color="primary" disabled={!!busy || status?.paused} onClick={() => void run('sync', () => window.xdriveDesktop.agent.syncNow(), '已请求立即同步。')}>
            <SyncRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="设置">
        <IconButton className="desktop-titlebar-action" aria-label="设置" size="small" color={settingsOpen ? 'primary' : 'default'} onClick={() => {
          setSyncMenuAnchor(null)
          setAccountMenuAnchor(null)
          setSettingsOpen(true)
        }}>
          <SettingsRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <XDriveTransferPopover
        transfers={transfers.transfers}
        sessionKey={`${status?.server ?? ''}:${status?.username ?? ''}`}
        open={transferPopoverOpen}
        onOpenChange={setTransferPopoverOpen}
        clearHistoryLoading={busy === 'clear-transfer-history'}
        clearHistoryDisabled={Boolean(busy) || !agent.hello?.capabilities.includes('transfer-history-scope')}
        onClearHistory={() => { void clearNetworkTransferHistory() }}
        retryingID={busy.startsWith('retry-transfer-') ? busy.slice('retry-transfer-'.length) : ''}
        retryDisabled={Boolean(busy)}
        onRetry={(id) => { void retryTransfer(id) }}
      />
      <XDriveAccountAvatarButton
        username={status?.username}
        compact
        className="desktop-titlebar-account-button"
        onClick={(event) => {
          setSyncMenuAnchor(null)
          setAccountMenuAnchor(event.currentTarget)
        }}
      />

      <Menu id="global-sync-menu" anchorEl={syncMenuAnchor} open={Boolean(syncMenuAnchor)} onClose={() => setSyncMenuAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MuiBox sx={{ minWidth: 260, px: 2, py: 1.25 }}>
          <Typography variant="body2" fontWeight={700}>{globalSyncState.label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {status?.auth_status || '已登录'}{status?.server ? ` · ${status.server}` : ''}
          </Typography>
        </MuiBox>
        <MuiDivider />
        <MenuItem onClick={() => {
          setSyncMenuAnchor(null)
          void run('folder', () => window.xdriveDesktop.agent.openFolder())
        }}>
          <ListItemIcon><FolderOpenRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>打开同步文件夹</ListItemText>
        </MenuItem>
        <MenuItem disabled={!!busy} onClick={() => {
          setSyncMenuAnchor(null)
          const nextPaused = !status?.paused
          void run('pause', () => window.xdriveDesktop.agent.setPaused(nextPaused), nextPaused ? '同步已暂停。' : '同步已恢复。')
        }}>
          <ListItemIcon>{status?.paused ? <PlayArrowRoundedIcon fontSize="small" /> : <PauseRoundedIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{status?.paused ? '恢复同步' : '暂停同步'}</ListItemText>
        </MenuItem>
        {status?.has_conflict ? (
          <MenuItem onClick={() => {
            setSyncMenuAnchor(null)
            setView('conflicts')
          }}>
            <ListItemIcon><WarningAmberRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{`查看冲突（${status.conflict_count || 0}）`}</ListItemText>
          </MenuItem>
        ) : null}
        <MuiDivider />
        <MenuItem onClick={() => {
          setSyncMenuAnchor(null)
          setView('diagnostics')
        }}>
          <ListItemIcon><BuildRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>客户端诊断</ListItemText>
        </MenuItem>
      </Menu>

      <XDriveAccountMenu
        id="desktop-account-menu"
        anchorEl={accountMenuAnchor}
        onClose={() => setAccountMenuAnchor(null)}
        username={status?.username}
        secondary={status?.server}
        status={status?.auth_status}
      >
        <XDriveAccountMenuActions
          onClose={() => setAccountMenuAnchor(null)}
          onAbout={() => {
            setSettingsOpen(true)
            window.setTimeout(() => {
              document.getElementById('desktop-build-info')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 120)
          }}
          aboutSecondary={info?.version ? `Desktop ${info.version}` : undefined}
          onLogout={requestLogout}
        />
      </XDriveAccountMenu>
    </Stack>
  )

  return renderDesktopFrame(
    <XDriveWorkspaceShell>
      <XDriveWorkspaceSidebar
        ariaLabel="桌面版侧边栏"
        navAriaLabel="桌面版功能区"
        className="sidebar"
        selected={view}
        transferBadge={taskCenter.badge}
        showGlobalTasks={status?.role === 'admin'}
        showLocalStorage
        sections={desktopSidebarSections}
        storageSummary={xDriveWorkspaceStorageSummary(cloudQuota)}
        onSelect={(destination) => setView(destination as View)}
      />

      <XDriveWorkspaceContent presentation={xDriveWorkspacePresentation(view)}>
        {(status?.last_error || status?.paused || status?.has_conflict) ? (
          <Stack
            spacing={1}
            sx={{
              mt: view === 'files' ? 1.5 : 2,
              mx: view === 'files' ? 1.5 : 0,
              flexShrink: 0,
            }}
          >
            {status?.last_error ? (
              <XDriveStatusAlert
                tone="bad"
                action={<MuiButton color="inherit" size="small" onClick={() => setView('diagnostics')}>运行诊断</MuiButton>}
              >
                同步异常：{status.last_error}
              </XDriveStatusAlert>
            ) : null}
            {status?.paused ? (
              <XDriveStatusAlert
                tone="warning"
                action={(
                  <MuiButton
                    color="inherit"
                    size="small"
                    disabled={!!busy}
                    onClick={() => void run('pause', () => window.xdriveDesktop.agent.setPaused(false), '同步已恢复。')}
                  >
                    恢复同步
                  </MuiButton>
                )}
              >
                同步已暂停；此设备不会继续后台同步。
              </XDriveStatusAlert>
            ) : null}
            {status?.has_conflict ? (
              <XDriveStatusAlert
                tone="warning"
                action={<MuiButton color="inherit" size="small" onClick={() => setView('conflicts')}>处理冲突</MuiButton>}
              >
                发现 {status.conflict_count || 0} 个同步冲突，请进入“冲突”页面处理。
              </XDriveStatusAlert>
            ) : null}
          </Stack>
        ) : null}

        {view === 'overview' && (
          <DesktopOverviewPage
            status={status}
            quota={cloudQuota}
            activeTaskCount={taskCenter.badge ?? 0}
            transfers={transfers.transfers}
            fileOperations={cloudFileOperations}
            backgroundTasks={taskCenter.backgroundTasks}
            activityRevision={[
              status?.revision ?? 0,
              transfers.transfers.find((task) => (
                task.state === 'completed' ||
                task.state === 'partial' ||
                task.state === 'failed' ||
                task.state === 'cancelled'
              ))?.updated_at ?? '',
              cloudFileOperations.find((operation) => (
                operation.status === 'completed' ||
                operation.status === 'failed' ||
                operation.status === 'cancelled'
              ))?.updated_at ?? '',
            ].join(':')}
            recentSupported={fileRecentSupported}
            favoritesSupported={fileFavoritesSupported}
            fileAvailabilitySupported={fileAvailabilitySupported}
            localDiskSpaceSupported={agent.hello?.capabilities.includes('local-disk-space') ?? false}
            folderUploadSupported={Boolean(
              agent.hello?.capabilities.includes('upload-conflict-preflight') &&
              agent.hello?.capabilities.includes('upload-conflict-policy')
            )}
            openFolderLoading={busy === 'folder'}
            onOpenFolder={() => {
              void run('folder', () => window.xdriveDesktop.agent.openFolder())
            }}
            onOpenFiles={() => setView('files')}
            onRequestFileAction={requestCloudFileAction}
            onOpenGallery={() => setView('gallery')}
            onOpenTransfers={() => setTransferPopoverOpen(true)}
            onOpenConflicts={() => setView('conflicts')}
            onError={setError}
          />
        )}

        {view === 'gallery' && (
          <XDriveMediaGalleryPage
            source={mediaGallerySource}
            preferenceScope={`desktop:${status?.server ?? ''}:${status?.username ?? ''}`}
            shareDialog={{
              adapter: desktopShareDialogAdapter,
              expiryMode: 'days',
              listVariant: 'compact',
              showCloseAction: true,
            }}
            onError={(galleryError) => setError(
              galleryError instanceof Error ? galleryError.message : String(galleryError),
            )}
          />
        )}

        {view === 'sources' && (
          agent.hello?.capabilities.includes('external-sources') ? (
            <XDriveSourceManager
              adapter={sourceManagerAdapter}
              defaultTargetLabel="我的文件"
              defaultTargetPath=""
              targetBrowser={desktopSourceTargetBrowser}
              cookieHelpVariant="dialog"
              onError={(sourceError) => setError(
                sourceError instanceof Error ? sourceError.message : String(sourceError),
              )}
            />
          ) : (
            <XDriveStatePanel message="当前 xdrive-agent 不支持同步文件夹，请更新客户端核心组件。" />
          )
        )}

        {view === 'files' && (
          <DesktopFilesPage
            quota={cloudQuota}
            explorer={{
              items: cloudItems,
              crumbs: cloudCrumbs,
              virtualDirectory: cloudVirtualDirectory,
              loading: cloudLoading,
              onLoadDirectory: loadCloudDirectory,
              onRefreshCurrentDirectoryIfIdle: refreshCloudCurrentDirectoryIfIdle,
              navigationState: cloudFileExplorerNavigationState,
              navigationSessionStorageKey: cloudFileActionLifecycleKey || undefined,
              onNavigationStateChange: rememberCloudFileExplorerNavigationState,
              onOpenTrash: openCloudTrash,
              onOpenHistory: openCloud历史版本,
              onOpenShares: openCloudShares,
              onDelete: removeCloudNode,
              onDeleteMany: removeCloudNodes,
              onOperationQueued: rememberFilesOperation,
              onDownloadStart: beginFilesDownloadFeedback,
              actionFeedback: (
                <XDriveFileExplorerActionFeedback
                  value={currentFilesActionFeedback?.downloadResult
                    ? { kind: 'download', result: currentFilesActionFeedback.downloadResult }
                    : filesFeedbackOperation ? { kind: 'operation', operation: filesFeedbackOperation } : null}
                  onViewTask={openFilesOperationTask}
                  onDismiss={() => setFilesActionFeedback(null)}
                />
              ),
              canUndo: fileOperationUndoSupported && Boolean(latestUndoableCloudFileOperation) && !fileOperationActions.busy,
              onUndo: () => {
                if (latestUndoableCloudFileOperation) void fileOperationActions.undoOperation(latestUndoableCloudFileOperation.id)
              },
              canRedo: fileOperationRedoSupported && Boolean(latestRedoableCloudFileOperation) && !fileOperationActions.busy,
              onRedo: () => {
                if (latestRedoableCloudFileOperation) void fileOperationActions.redoOperation(latestRedoableCloudFileOperation.id)
              },
              onQuotaChanged: refreshCloudQuota,
              uploadConflictSupported: Boolean(
                agent.hello?.capabilities.includes('upload-conflict-preflight') &&
                agent.hello?.capabilities.includes('upload-conflict-policy')
              ),
              archiveDownloadSupported: agent.hello?.capabilities.includes('archive-download') ?? false,
              folderTreeDownloadSupported: agent.hello?.capabilities.includes('folder-download-tree') ?? false,
              textPreviewSupported: agent.hello?.capabilities.includes('file-text-preview') ?? false,
              previewStreamSupported: agent.hello?.capabilities.includes('file-preview-stream') ?? false,
              propertiesStatsSupported: filePropertiesStatsSupported,
              mediaDetailsSupported: fileMediaDetailsSupported,
              mediaPropertiesSupported: agent.hello?.capabilities.includes('media-item-properties') ?? false,
              fileAvailabilitySupported,
              openWithSupported: fileOpenWithSupported,
              quickAccessSupported: fileQuickAccessSupported,
              fileTagsSupported,
              savedSearchesSupported: fileSavedSearchesSupported,
              favoritesSupported: fileFavoritesSupported,
              recentSupported: fileRecentSupported,
              transferLifecycleSupported: agent.hello?.capabilities.includes('transfer-lifecycle') ?? false,
              transferLifecycleBatchSupported: agent.hello?.capabilities.includes('transfer-lifecycle-child-batch') ?? false,
              transfers: transfers.transfers,
              actionIntent: cloudFileActionIntent,
              onActionIntentConsumed: (id) => {
                setCloudFileActionIntent((current) => current?.id === id ? null : current)
              },
              keyboardProfile: fileExplorerKeyboardProfile,
              onError: (message) => setError(message),
              onFeedback: (_tone, message) => setNotice(message),
            }}
            trashOpen={cloudTrashOpen}
            onCloseTrash={() => setCloudTrashOpen(false)}
            onTrashChanged={async () => {
              const expectedCurrentID = cloudCrumbs.at(-1)?.id
              await refreshCloudQuota()
              if (expectedCurrentID !== undefined) {
                await refreshCloudCurrentDirectoryIfIdle(expectedCurrentID)
              }
            }}
            historyNode={cloudHistoryNode}
            onCloseHistory={() => {
              setCloudHistoryNode(null)
              setCloudHistoryCrumbs([])
            }}
            onHistoryRestored={async (restored) => {
              const expectedCurrentID = cloudHistoryCrumbs.at(-1)?.id
              setCloudHistoryNode(restored)
              await refreshCloudQuota()
              if (expectedCurrentID !== undefined) {
                await refreshCloudCurrentDirectoryIfIdle(expectedCurrentID)
              }
            }}
            shareNode={cloudShareNode}
            onCloseShare={() => setCloudShareNode(null)}
            onFileDialogError={(dialogError) => setError(
              dialogError instanceof Error ? dialogError.message : String(dialogError),
            )}
            onFileDialogFeedback={(message) => setNotice(message)}
          />
        )}

        {(view === 'transfers' || view === 'global-tasks') && (
          <XDriveTaskCenterPage
            {...taskCenter.pageProps}
            operationFocusID={filesOperationFocus?.operationID}
            operationFocusRequestID={filesOperationFocus?.requestID}
            clearHistory={{
              ...taskCenter.pageProps.clearHistory!,
              disabled: taskCenter.pageProps.clearHistory?.disabled || !agent.hello?.capabilities.includes('transfer-history-scope'),
            }}
            transferRetryingID={busy.startsWith('retry-transfer-') ? busy.slice('retry-transfer-'.length) : ''}
            transferRetryDisabled={Boolean(busy) || fileOperationActions.clearHistoryLoading}
            onRetryTransfer={(id) => { void retryTransfer(id) }}
          />
        )}

        {view === 'local-storage' && (
          <XDriveLocalStoragePage source={localStorageSource} />
        )}

        {view === 'cloud-storage' && (
          <XDriveCloudStoragePage source={cloudStorageSource} />
        )}

        {view === 'conflicts' && (
          <DesktopConflictsPage
            conflicts={conflicts}
            busy={Boolean(busy)}
            onRefresh={() => { void loadConflicts() }}
            onOpenBoth={(item) => {
              void run(`open-${item.id}`, () => window.xdriveDesktop.agent.openConflict(item.id, true))
            }}
            onKeepServer={(item) => {
              requestConfirmation(
                '保留服务器版本？',
                '这会保留服务器版本并删除本地冲突副本。',
                '保留服务器版本',
                () => run(`server-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'server'), '冲突已解决。').then(() => loadConflicts()),
                'warning',
              )
            }}
            onKeepLocal={(item) => {
              requestConfirmation(
                '保留本地版本？',
                '这会使用本地冲突副本替换服务器版本。',
                '保留本地版本',
                () => run(`local-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'local'), '冲突已解决。').then(() => loadConflicts()),
                'warning',
              )
            }}
          />
        )}

        {view === 'diagnostics' && (
          <DesktopDiagnosticsPage
            diagnostics={diagnostics}
            busy={busy}
            paused={Boolean(status?.paused)}
            onRun={() => { void loadDiagnostics() }}
            onRestartAgent={() => { void restartAgent().then(() => loadDiagnostics()) }}
            onReconnect={() => {
              void runDiagnosticAction(
                'reconnect',
                () => window.xdriveDesktop.agent.reconnect(),
                '同步引擎已重新连接。',
              )
            }}
            onRepairSyncRoot={() => {
              void runDiagnosticAction(
                'repair-sync-root',
                () => window.xdriveDesktop.agent.repairSyncRoot(),
                '同步根目录已修复并重新连接。',
              )
            }}
            onOpenStorage={() => setView('local-storage')}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenUpdateSettings={() => {
              setSettingsOpen(true)
              window.setTimeout(() => {
                document.getElementById('client-update-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }, 120)
            }}
            onOpenLogs={() => {
              void run(
                'open-logs',
                () => window.xdriveDesktop.agent.openLogs(),
                '已打开 xDrive 日志。',
              )
            }}
            onExport={() => { void exportDiagnostics() }}
          />
        )}

      </XDriveWorkspaceContent>

        <XDriveSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          subtitle="外观、客户端更新、同步生命周期与本地缓存"
          maxWidth="lg"
          appearance={appearance}
          appearanceDisabled={busy === 'appearance'}
          onAppearanceChange={(next) => void changeAppearance(next)}
          buildInfoSectionID="desktop-build-info"
          buildInfo={[
            { title: 'Desktop 构建信息', info },
            { title: 'Server 构建信息', info: status?.server_build },
          ]}
          serverUpdate={{
            state: serverUpdate.state,
            source: serverUpdate.source,
            channel: serverUpdate.channel,
            backupFileData: serverUpdate.backupFileData,
            loading: serverUpdate.busy,
            disabled: serverUpdate.state === null || (!!busy && busy !== 'server-update'),
            error: serverUpdate.error,
            onSourceChange: serverUpdate.setSource,
            onChannelChange: serverUpdate.setChannel,
            onBackupFileDataChange: serverUpdate.setBackupFileData,
            onStart: () => setConfirmDialog({
              title: '确认更新服务端？',
              message: xDriveServerUpdateConfirmationDescription({
                source: serverUpdate.source,
                channel: serverUpdate.channel,
                backupFileData: serverUpdate.backupFileData,
              }),
              confirmLabel: '开始更新',
              tone: 'warning',
              onConfirm: serverUpdate.start,
            }),
          }}
        >
          <DesktopSettingsContent
            desktopPreferences={desktopPreferences}
            busy={busy}
            onRestartAgent={() => { void restartAgent() }}
            onStartAtLoginChange={(enabled) => { void changeStartAtLogin(enabled) }}
            onCloseToTrayChange={(enabled) => { void changeCloseToTray(enabled) }}
            updateSupported={updateSupported}
            clientUpdate={clientUpdate}
            updateOperationBusy={updateOperationBusy}
            updateCancelling={updateCancelling}
            updateCancelSupported={updateCancelSupported}
            updateProgress={updateProgress}
            currentVersion={status?.version}
            onUpdateSourceChange={(source) => { void changeUpdateSource(source) }}
            onUpdateModeChange={(mode) => { void changeUpdateMode(mode) }}
            onCheckUpdate={() => { void checkClientUpdate() }}
            onDownloadUpdate={() => { void downloadClientUpdate() }}
            onInstallUpdate={() => { void installClientUpdate() }}
            onCancelUpdate={() => { void cancelClientUpdate() }}
            settings={settings}
            mountPath={mountPath}
            cacheLimit={cacheLimit}
            platform={info?.platform}
            storagePoliciesSupported={storagePoliciesSupported}
            onMountPathChange={setMountPath}
            onCacheLimitChange={setCacheLimit}
            onChooseMountPath={() => { void chooseDirectory(mountPath, setMountPath) }}
            onSaveSettings={saveSettings}
            onOpenStorage={() => {
              setSettingsOpen(false)
              setView('local-storage')
            }}
          />
        </XDriveSettingsDialog>

      <XDriveConfirmDialog
        open={!!confirmDialog}
        maxWidth="xs"
        title={confirmDialog?.title ?? '确认操作'}
        description={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel ?? '确认'}
        confirmIntent={confirmDialog?.tone === 'error' ? 'danger' : confirmDialog?.tone === 'warning' ? 'warning' : 'primary'}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => void confirmPendingAction()}
      />

    </XDriveWorkspaceShell>,
    desktopTitlebarActions,
  )
}
