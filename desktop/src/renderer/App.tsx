import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Autocomplete,
  Box as MuiBox,
  Button as MuiButton,
  Checkbox,
  Chip,
  CircularProgress,
  Divider as MuiDivider,
  FormControlLabel,
  IconButton,
  InputAdornment,
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
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'
import {
  XDriveAccountAvatarButton,
  XDriveAccountMenu,
  XDriveActionButton,
  XDriveBrandLockup,
  XDrivePasswordChangeForm,
  xDrivePasswordChangeValidationError,
  XDriveConfirmDialog,
  XDriveCoreWorkspaceNavItems,
  XDriveSettingsDialog,
  XDriveFeedbackSnackbar,
  XDriveSidebarNavItem,
  XDriveSidebarNavList,
  XDriveSidebarSurface,
  XDriveSidebarSection,
  XDriveSidebarStorageSummary,
  XDriveWorkspaceShell,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  XDriveSourceManager,
} from '@xdrive/ui/mui'
import type { MediaGalleryDataSource, XDriveFileExplorerSort, XDriveStatusTone } from '@xdrive/ui/mui'
import {
  formatBinarySize,
  XDRIVE_FILE_OPERATION_HISTORY_LIMIT,
  xDriveFileExplorerCanLoadMore,
  xDriveFileExplorerDeleteOperationPlan,
  xDriveFileExplorerMergePageItems,
  xDriveFileOperationActive,
  xDriveFileOperationPollIntervalMs,
  xDriveFileOperationTransitionSnapshot,
} from '@xdrive/shared'
import { DesktopCloudPage } from './DesktopCloudPage'
import { DesktopOverviewPage } from './DesktopOverviewPage'
import { DesktopConflictsPage } from './DesktopConflictsPage'
import { DesktopDiagnosticsPage } from './DesktopDiagnosticsPage'
import { DesktopGalleryPage } from './DesktopGalleryPage'
import { DesktopTransfersPage } from './DesktopTransfersPage'
import { DesktopStoragePage } from './DesktopStoragePage'
import { DesktopSettingsContent } from './DesktopSettingsContent'
import { createDesktopSourceManagerAdapter, desktopSourceTargetBrowser } from './sourceManagerAdapter'
import type {
  XDriveAppearance,
  XDriveFileExplorerPageState,
  XDriveServerUpdateChannel,
  XDriveServerUpdateSource,
  XDriveServerUpdateState,
} from '@xdrive/shared'

type View = 'overview' | 'cloud' | 'gallery' | 'sources' | 'transfers' | 'files' | 'conflicts' | 'diagnostics'

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

const DESKTOP_FILE_PAGE_SIZE = 200
const DEFAULT_DESKTOP_FILE_SORT: XDriveFileExplorerSort = { key: 'name', direction: 'asc' }

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
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [syncMenuAnchor, setSyncMenuAnchor] = useState<HTMLElement | null>(null)
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<HTMLElement | null>(null)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [clientUpdate, setClientUpdate] = useState<AgentUpdateState | null>(null)
  const [updateCancelling, setUpdateCancelling] = useState(false)
  const [serverUpdate, setServerUpdate] = useState<XDriveServerUpdateState | null>(null)
  const [serverUpdateSource, setServerUpdateSource] = useState<XDriveServerUpdateSource>('github')
  const [serverUpdateChannel, setServerUpdateChannel] = useState<XDriveServerUpdateChannel>('stable')
  const [serverUpdateError, setServerUpdateError] = useState('')
  const [conflicts, setConflicts] = useState<AgentConflict[]>([])
  const [transfers, setTransfers] = useState<AgentTransfers>({ revision: 0, transfers: [] })
  const [cloudFileOperations, setCloudFileOperations] = useState<AgentCloudFileOperation[]>([])
  const [fileOperationAction, setFileOperationAction] = useState('')
  const cloudFileOperationStatusRef = useRef(new Map<string, string>())
  const [diagnostics, setDiagnostics] = useState<AgentDiagnosticReport | null>(null)
  const [cloudItems, setCloudItems] = useState<AgentCloudNode[]>([])
  const [cloudCrumbs, setCloudCrumbs] = useState<AgentCloudCrumb[]>([])
  const [cloudPage, setCloudPage] = useState<XDriveFileExplorerPageState<XDriveFileExplorerSort> | null>(null)
  const [cloudLoadingMore, setCloudLoadingMore] = useState(false)
  const [cloudQuota, setCloudQuota] = useState<AgentCloudQuota | null>(null)
  const [cloudStorageStats, setCloudStorageStats] = useState<AgentCloudStorageStats | null>(null)
  const [cloudTrashOpen, setCloudTrashOpen] = useState(false)
  const [cloudHistoryNode, setCloudHistoryNode] = useState<AgentCloudNode | null>(null)
  const [cloudHistoryCrumbs, setCloudHistoryCrumbs] = useState<AgentCloudCrumb[]>([])
  const [cloudShareNode, setCloudShareNode] = useState<AgentCloudNode | null>(null)

  const mediaGallerySource = useMemo<MediaGalleryDataSource>(() => ({
    listItems: async (limit, offset) => {
      const result = await window.xdriveDesktop.agent.getMediaItems('', limit, offset)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    listAlbums: async () => {
      const result = await window.xdriveDesktop.agent.getMediaAlbums()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    listAlbumItems: async (albumID, limit, offset) => {
      const result = await window.xdriveDesktop.agent.getMediaAlbumItems(albumID, limit, offset)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadThumbnail: async (nodeID) => {
      const result = await window.xdriveDesktop.agent.getMediaThumbnail(nodeID)
      if (!result.ok) throw new Error(result.error.message)
      const contentType = result.data.content_type || 'image/jpeg'
      return `data:${contentType};base64,${result.data.data_base64}`
    },
    loadLivePhotoMotion: async (nodeID) => {
      const result = await window.xdriveDesktop.agent.getMediaLivePhotoMotion(nodeID)
      if (!result.ok) throw new Error(result.error.message)
      const contentType = result.data.content_type || 'video/quicktime'
      return `data:${contentType};base64,${result.data.data_base64}`
    },
  }), [])


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
  const [showPassword, setShowPassword] = useState(false)
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
  const [storageTree, setStorageTree] = useState<AgentStorageTreeNode | null>(null)
  const [cacheStats, setCacheStats] = useState<AgentCacheStats | null>(null)
  const [expandedStorage, setExpandedStorage] = useState<Set<string>>(new Set())

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
  const sourceManagerAdapter = useMemo(
    () => createDesktopSourceManagerAdapter(status?.username),
    [status?.username],
  )
  const configured = !!status?.configured
  const reloginRequired = !configured && status?.auth_status === '需要重新登录'
  const loginReady = Boolean(server.trim() && username.trim() && (password || savedPasswordAvailable))
  const activeTransfers = transfers.transfers.filter((item) => item.state === 'running' || item.state === 'retrying')
  const activeFileOperations = cloudFileOperations.filter((item) => xDriveFileOperationActive(item.status))
  const hasTaskHistory =
    transfers.transfers.some((item) => item.state === 'completed' || item.state === 'failed') ||
    cloudFileOperations.some((item) => !xDriveFileOperationActive(item.status))
  const updateSupported = agent.hello?.capabilities.includes('client-update') ?? false
  const updateCancelSupported = agent.hello?.capabilities.includes('client-update-cancel') ?? false
  const storagePoliciesSupported = info?.platform === 'win32'
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
    if (activeTransfers.length > 0) return { label: `正在同步 · ${activeTransfers.length}`, tone: 'busy' }
    return { label: status?.sync_status || '同步正常', tone: 'good' }
  }, [
    activeTransfers.length,
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
    void window.xdriveDesktop.agent.getTransfers().then((value) => {
      if (active) setTransfers(value)
    })
    const unsubscribe = window.xdriveDesktop.agent.onState((value) => {
      if (active) setAgent(value)
    })
    const unsubscribeLoginHistory = window.xdriveDesktop.onLoginHistory((value) => {
      if (active) setLoginHistory(value)
    })
    const unsubscribeTransfers = window.xdriveDesktop.agent.onTransfers((value) => {
      if (active) setTransfers(value)
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

  const fileOperationPollIntervalMs = xDriveFileOperationPollIntervalMs(
    cloudFileOperations,
    view === 'transfers',
  )

  useEffect(() => {
    if (!agent.connected || !configured) {
      setCloudFileOperations([])
      cloudFileOperationStatusRef.current = new Map()
      return
    }
    let active = true
    const refresh = async () => {
      const result = await window.xdriveDesktop.agent.cloudFileOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)
      if (active && result.ok) setCloudFileOperations(result.data)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), fileOperationPollIntervalMs)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [agent.connected, agent.hello?.agent_version, configured, fileOperationPollIntervalMs])

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
    const supported = agent.hello?.capabilities.includes('server-update') ?? false
    if (!settingsOpen || !agent.connected || !configured) return
    if (!supported) {
      setServerUpdate({
        supported: false,
        state: 'unavailable',
        source: serverUpdateSource,
        channel: serverUpdateChannel,
        message: '当前 xdrive-agent 不支持服务端更新，请先更新客户端核心组件。',
      })
      return
    }
    let active = true
    const refresh = async () => {
      const result = await window.xdriveDesktop.agent.getServerUpdate()
      if (!active) return
      if (result.ok) {
        if (serverUpdate === null) {
          setServerUpdateSource(result.data.source)
          setServerUpdateChannel(result.data.channel)
        }
        setServerUpdate(result.data)
        setServerUpdateError('')
        return
      }
      if (result.error.status === 403) {
        setServerUpdate({
          supported: false,
          state: 'unavailable',
          source: serverUpdateSource,
          channel: serverUpdateChannel,
          message: '仅管理员可以更新服务端。',
        })
        setServerUpdateError('')
        return
      }
      if (serverUpdate?.state === 'queued' || serverUpdate?.state === 'running') {
        setServerUpdateError('服务端更新期间连接可能暂时中断，正在等待服务恢复…')
      } else {
        setServerUpdateError(result.error.message)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [
    agent.connected,
    agent.hello?.agent_version,
    configured,
    settingsOpen,
    serverUpdate?.state,
    serverUpdateChannel,
    serverUpdateSource,
  ])

  useEffect(() => {
    if (!agent.connected || !configured) {
      setSettings(null)
      setConflicts([])
      setDiagnostics(null)
      setStorageTree(null)
      setCacheStats(null)
      setCloudItems([])
      setCloudCrumbs([])
      setCloudQuota(null)
      setCloudStorageStats(null)
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
  }, [view, settingsOpen, agent.connected, configured, status?.revision])

  useEffect(() => {
    if (view !== 'diagnostics' || !agent.connected || !configured) return
    void loadDiagnostics()
    // Diagnostics run once when entering the page or reconnecting, not on every status revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  useEffect(() => {
    if (view !== 'files' || !agent.connected || !configured) return
    void loadStorage()
    // Storage tree and cache telemetry load once when entering the page or reconnecting.
    // Policy changes and the Refresh button perform explicit reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  useEffect(() => {
    if (view !== 'cloud' || !agent.connected || !configured) return
    void loadCloudHome()
    // Cloud browser loads once when entering the page or reconnecting.
    // Navigation, search, mutations and Refresh perform explicit reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  useEffect(() => {
    if (!agent.connected || !configured) return
    let active = true
    const refresh = async () => {
      const result = await window.xdriveDesktop.agent.cloudQuota()
      if (active && result.ok) setCloudQuota(result.data)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [agent.connected, configured, status?.server, status?.username])

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

  const startServerUpdate = async () => {
    setBusy('server-update')
    setServerUpdateError('')
    try {
      const result = await window.xdriveDesktop.agent.startServerUpdate(serverUpdateSource, serverUpdateChannel)
      if (!result.ok) {
        setServerUpdateError(result.error.message)
        return
      }
      setServerUpdate(result.data)
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
    setShowPassword(false)
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
      setShowPassword(false)
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
    setShowPassword(false)
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

  const loadStorage = async () => {
    setBusy('storage')
    setError('')
    try {
      const storageStatsSupported = agent.hello?.capabilities.includes('storage-intelligence') ?? false
      const [treeResult, cacheResult, quotaResult, cloudStatsResult] = await Promise.all([
        window.xdriveDesktop.agent.getStorageTree(),
        window.xdriveDesktop.agent.getCache(),
        window.xdriveDesktop.agent.cloudQuota(),
        storageStatsSupported ? window.xdriveDesktop.agent.cloudStorageStats() : Promise.resolve(null),
      ])
      if (!treeResult.ok) {
        setError(treeResult.error.message)
        return
      }
      if (!cacheResult.ok) {
        setError(cacheResult.error.message)
        return
      }
      setStorageTree(treeResult.data)
      setCacheStats(cacheResult.data)
      if (quotaResult.ok) setCloudQuota(quotaResult.data)
      if (cloudStatsResult?.ok) setCloudStorageStats(cloudStatsResult.data)
      else if (cloudStatsResult) setCloudStorageStats(null)
      setExpandedStorage((current) => {
        if (current.size > 0) return current
        return new Set((treeResult.data.children || []).map((child) => child.path))
      })
    } finally {
      setBusy('')
    }
  }

  const updateStorageMode = async (path: string, mode: 'exclude' | 'always-local' | 'default') => {
    const data = await run(
      `storage-rule-${path}-${mode}`,
      () => window.xdriveDesktop.agent.setSyncRule(path, mode),
      '文件夹策略已更新。',
    )
    if (!data) return
    setSettings(data)
    await loadStorage()
  }

  const releaseReclaimableCache = async () => {
    const data = await run('release-cache', () => window.xdriveDesktop.agent.releaseCache())
    if (!data) return
    setCacheStats(data.stats)
    if (data.released_files === 0 && data.failed_files === 0) {
      setNotice('当前没有可释放的缓存。')
      return
    }
    const failed = data.failed_files > 0 ? ` · ${data.failed_files} 个文件无法释放` : ''
    setNotice(`已从 ${data.released_files} 个文件释放 ${formatBinarySize(data.released_bytes)}${failed}。`)
  }

  const toggleStoragePath = (path: string) => {
    setExpandedStorage((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderStorageNode = (node: AgentStorageTreeNode, depth = 0) => {
    const children = node.children || []
    const expanded = expandedStorage.has(node.path)
    const inherited = node.mode === 'default' && node.effective_mode !== 'default'
    const effectiveLabel = node.effective_mode === 'exclude'
      ? '不同步'
      : node.effective_mode === 'always-local'
        ? '始终保留'
        : '默认'
    return (
      <div className="storage-node" key={node.path}>
        <div className="storage-row" style={{ paddingLeft: `${12 + depth * 18}px` }}>
          <button
            className="tree-toggle"
            type="button"
            disabled={children.length === 0}
            aria-label={expanded ? '折叠文件夹' : '展开文件夹'}
            onClick={() => toggleStoragePath(node.path)}
          >
            {children.length === 0 ? '·' : expanded ? '▾' : '▸'}
          </button>
          <div className="storage-folder">
            <strong>{node.name}</strong>
            <span>{node.file_count} 个文件 · {formatBinarySize(node.total_bytes)}</span>
            {storagePoliciesSupported && inherited && <small>继承策略：{effectiveLabel}</small>}
          </div>
          {storagePoliciesSupported ? (
            <div className="storage-modes" role="group" aria-label={`${node.name} 的存储策略`}>
              <button className={node.mode === 'default' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'default')}>默认</button>
              <button className={node.mode === 'exclude' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'exclude')}>不同步</button>
              <button className={node.mode === 'always-local' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'always-local')}>始终保留</button>
            </div>
          ) : (
            <Chip size="small" variant="outlined" label="FUSE 按需访问" />
          )}
        </div>
        {expanded && children.map((child) => renderStorageNode(child, depth + 1))}
      </div>
    )
  }

  const rememberCloudFileOperation = (operation: AgentCloudFileOperation) => {
    cloudFileOperationStatusRef.current.set(operation.id, operation.status)
    setCloudFileOperations((currentOperations) => [
      operation,
      ...currentOperations.filter((item) => item.id !== operation.id),
    ])
  }

  const refreshCloudFileOperations = async () => {
    const result = await window.xdriveDesktop.agent.cloudFileOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)
    if (!result.ok) {
      setError(result.error.message)
      return null
    }
    setCloudFileOperations(result.data)
    return result.data
  }

  const cancelCloudFileOperation = async (id: string) => {
    setFileOperationAction(`cancel:${id}`)
    try {
      const result = await window.xdriveDesktop.agent.cloudCancelFileOperation(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      rememberCloudFileOperation(result.data)
      await refreshCloudFileOperations()
    } finally {
      setFileOperationAction('')
    }
  }

  const retryCloudFileOperation = async (id: string) => {
    setFileOperationAction(`retry:${id}`)
    try {
      const result = await window.xdriveDesktop.agent.cloudRetryFileOperation(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      rememberCloudFileOperation(result.data)
      setNotice('文件操作已重新加入队列。')
      await refreshCloudFileOperations()
    } finally {
      setFileOperationAction('')
    }
  }

  const retryTransfer = async (id: string) => {
    const data = await run(`retry-transfer-${id}`, () => window.xdriveDesktop.agent.retryTransfer(id), '传输重试已完成。')
    if (data) setTransfers(data)
  }

  const clearTaskHistory = async () => {
    setFileOperationAction('clear-history')
    setError('')
    try {
      const operationResult = await window.xdriveDesktop.agent.cloudClearFileOperationHistory()
      if (!operationResult.ok) {
        setError(operationResult.error.message)
        return
      }

      const transferResult = await window.xdriveDesktop.agent.clearTransferHistory()
      if (!transferResult.ok) {
        setError(transferResult.error.message)
        await refreshCloudFileOperations()
        return
      }

      setTransfers(transferResult.data)
      await refreshCloudFileOperations()
      setNotice('已清空已完成、失败和已取消的任务历史。')
    } finally {
      setFileOperationAction('')
    }
  }

  const refreshCloudQuota = async () => {
    const result = await window.xdriveDesktop.agent.cloudQuota()
    if (!result.ok) {
      setError(result.error.message)
      return null
    }
    setCloudQuota(result.data)
    return result.data
  }

  const loadCloudDirectory = async (
    id: number,
    crumbs: AgentCloudCrumb[],
    sort: XDriveFileExplorerSort = cloudPage?.sort ?? DEFAULT_DESKTOP_FILE_SORT,
  ) => {
    setBusy('cloud-directory')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudChildrenPage(id, {
        limit: DESKTOP_FILE_PAGE_SIZE,
        sort: sort.key,
        order: sort.direction,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudItems(result.data.items)
      setCloudCrumbs(crumbs)
      setCloudPage({
        parentID: id,
        cursor: result.data.next_cursor ?? '',
        hasMore: result.data.has_more,
        sort,
      })
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    const transition = xDriveFileOperationTransitionSnapshot(
      cloudFileOperationStatusRef.current,
      cloudFileOperations,
    )
    cloudFileOperationStatusRef.current = transition.statuses
    if (!transition.hasTerminalTransition || cloudCrumbs.length === 0) return
    void refreshCloudQuota()
    void loadCloudDirectory(
      cloudCrumbs.at(-1)!.id,
      cloudCrumbs,
      cloudPage?.sort ?? DEFAULT_DESKTOP_FILE_SORT,
    )
    // File refreshes are intentionally keyed only by operation snapshot transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudFileOperations])

  const loadMoreCloudDirectory = async (id: number, sort: XDriveFileExplorerSort) => {
    const pageState = cloudPage
    if (!xDriveFileExplorerCanLoadMore(pageState, id, sort, cloudLoadingMore)) return

    setCloudLoadingMore(true)
    try {
      const result = await window.xdriveDesktop.agent.cloudChildrenPage(id, {
        limit: DESKTOP_FILE_PAGE_SIZE,
        cursor: pageState.cursor,
        sort: sort.key,
        order: sort.direction,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudItems((currentItems) => xDriveFileExplorerMergePageItems(currentItems, result.data.items))
      setCloudPage({
        parentID: id,
        cursor: result.data.next_cursor ?? '',
        hasMore: result.data.has_more,
        sort,
      })
    } finally {
      setCloudLoadingMore(false)
    }
  }

  const loadCloudHome = async () => {
    setBusy('cloud-load')
    setError('')
    try {
      const [rootResult, quotaResult] = await Promise.all([
        window.xdriveDesktop.agent.cloudRoot(),
        window.xdriveDesktop.agent.cloudQuota(),
      ])
      if (!rootResult.ok) {
        setError(rootResult.error.message)
        return
      }
      if (!quotaResult.ok) {
        setError(quotaResult.error.message)
        return
      }
      const childrenResult = await window.xdriveDesktop.agent.cloudChildrenPage(rootResult.data.id, {
        limit: DESKTOP_FILE_PAGE_SIZE,
        sort: DEFAULT_DESKTOP_FILE_SORT.key,
        order: DEFAULT_DESKTOP_FILE_SORT.direction,
      })
      if (!childrenResult.ok) {
        setError(childrenResult.error.message)
        return
      }
      setCloudItems(childrenResult.data.items)
      setCloudCrumbs([{ id: rootResult.data.id, name: '我的文件' }])
      setCloudPage({
        parentID: rootResult.data.id,
        cursor: childrenResult.data.next_cursor ?? '',
        hasMore: childrenResult.data.has_more,
        sort: DEFAULT_DESKTOP_FILE_SORT,
      })
      setCloudQuota(quotaResult.data)
    } finally {
      setBusy('')
    }
  }

  const openCloudTrash = () => setCloudTrashOpen(true)

  const removeCloudNode = (node: AgentCloudNode) => {
    requestConfirmation(
      `将“${node.name}”移到回收站？`,
      node.type === 'dir'
        ? '该文件夹及其中的内容会从云端文件列表中移除，之后仍可从回收站恢复。'
        : '该文件会从云端文件列表中移除，之后仍可从回收站恢复。',
      '移到回收站',
      async () => {
        const data = await run(
          `cloud-delete-${node.id}`,
          () => window.xdriveDesktop.agent.cloudDelete(node.id, node.revision),
          '已移到回收站。',
        )
        if (!data) return
        await refreshCloudQuota()
        if (cloudCrumbs.length > 0) {
          await loadCloudDirectory(cloudCrumbs.at(-1)!.id, cloudCrumbs)
        }
      },
      'warning',
    )
  }

  const removeCloudNodes = (nodes: AgentCloudNode[]) => {
    const plan = xDriveFileExplorerDeleteOperationPlan(nodes)
    if (plan.count === 0) return
    requestConfirmation(
      `将所选 ${plan.count} 个项目移到回收站？`,
      '所选文件和文件夹会从云端文件列表中移除，之后仍可从回收站恢复。',
      '移到回收站',
      async () => {
        setBusy('cloud-delete-many')
        setError('')
        try {
          const result = await window.xdriveDesktop.agent.cloudCreateFileOperation(
            plan.operation,
            plan.items,
          )
          if (!result.ok) {
            setError(result.error.message)
            return
          }
          rememberCloudFileOperation(result.data)
          setNotice(plan.message)
        } finally {
          setBusy('')
        }
      },
      'warning',
    )
  }

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

  if (!agent.connected) {
    return renderDesktopFrame(
      <div className="center-shell">
        <section className="auth-panel">
          <p className="eyebrow">AGENT 连接</p>
          <h1>{headline}</h1>
          <p className="subtitle">xDrive 桌面版会自动启动并监控 Go 后台 Agent。如果自动恢复失败，请确认已安装完整的 xDrive 客户端。</p>
          <div className="offline-box">{agent.error || '正在等待桌面 IPC 连接…'}</div>
          <div className="offline-actions">
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
          </div>
          <p className="footnote">{info ? `桌面版 ${info.version} · ${platformLabel(info.platform)} ${info.arch}` : '正在加载桌面信息…'}</p>
        </section>
      </div>
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
      <div className="center-shell">
        <form className="auth-panel auth-panel-form" onSubmit={login}>
          <XDriveBrandLockup
            iconSrc={xDriveBrandIcon}
            variant="compact"
            subtitle="桌面版"
            className="auth-brand-lockup"
          />
          <h1>{reloginRequired ? '登录状态已失效' : '欢迎使用 xDrive'}</h1>
          <p className="subtitle">
            {reloginRequired
              ? '你的登录状态已过期，请重新验证身份。原有同步设置会继续保留。'
              : '连接到你的 xDrive 服务器，登录后即可访问并同步文件。'}
          </p>

          <Stack className="auth-form" spacing={1.75}>
            {loginHistory.auto_login_error ? (
              <XDriveStatusAlert tone="warning">
                自动登录未成功，已暂时关闭自动登录：{loginHistory.auto_login_error}
              </XDriveStatusAlert>
            ) : null}
            {error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}

            <MuiBox className="auth-field">
              <Typography component="label" htmlFor="desktop-login-server" className="auth-field-label">
                服务器 <span className="auth-required" aria-hidden="true">*</span>
              </Typography>
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
              <Typography
                component="div"
                className="auth-field-helper"
                title={serverProbe.key === 'error' ? serverProbe.detail : undefined}
              >
                {serverProbe.key === 'checking' ? (
                  <>
                    <CircularProgress size={12} />
                    正在检查服务器…
                  </>
                ) : serverProbe.key === 'ok' ? (
                  <>
                    <span className="auth-connection-dot good" aria-hidden="true" />
                    服务器可访问{serverProbe.version ? ` · ${serverProbe.version}` : ''}
                  </>
                ) : serverProbe.key === 'error' ? (
                  <>
                    <span className="auth-connection-dot bad" aria-hidden="true" />
                    暂时无法连接此服务器；请检查地址、端口或证书。
                  </>
                ) : (
                  <>
                    <span className="auth-connection-dot neutral" aria-hidden="true" />
                    支持自建 xDrive 服务器；连接会在登录时再次验证。
                  </>
                )}
              </Typography>
            </MuiBox>

            <MuiBox className="auth-field">
              <Typography component="label" htmlFor="desktop-login-username" className="auth-field-label">
                用户名 <span className="auth-required" aria-hidden="true">*</span>
              </Typography>
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
            </MuiBox>

            <MuiBox className="auth-field">
              <Typography component="label" htmlFor="desktop-login-password" className="auth-field-label">
                密码 <span className="auth-required" aria-hidden="true">*</span>
              </Typography>
              <TextField
                id="desktop-login-password"
                fullWidth
                size="small"
                type={showPassword ? 'text' : 'password'}
                value={password}
                disabled={busy === 'login'}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError('')
                }}
                autoComplete="current-password"
                autoFocus={Boolean(server) && Boolean(username)}
                required={!savedPasswordAvailable}
                placeholder={savedPasswordAvailable ? '••••••••••••' : '输入密码'}
                slotProps={{
                  input: {
                    endAdornment: password ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          edge="end"
                          onClick={() => setShowPassword((current) => !current)}
                        >
                          {showPassword
                            ? <VisibilityOffRoundedIcon fontSize="small" />
                            : <VisibilityRoundedIcon fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ) : hasStoredPassword ? (
                      <InputAdornment position="end">
                        <Chip className="auth-saved-chip" size="small" label="已保存" />
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
              />
              <MuiBox className="auth-password-meta">
                <Typography component="span" className="auth-field-helper">
                  {password && hasStoredPassword
                    ? '登录成功后将更新系统保存的密码。'
                    : savedPasswordAvailable
                      ? '将使用系统安全保存的密码。'
                      : '密码输入默认隐藏，不会以明文写入配置文件。'}
                </Typography>
                {hasStoredPassword ? (
                  <MuiButton
                    className="auth-inline-action"
                    size="small"
                    variant="text"
                    disabled={!!busy}
                    onClick={() => void clearSavedLoginPassword()}
                  >
                    清除已保存密码
                  </MuiButton>
                ) : null}
              </MuiBox>
            </MuiBox>

            <MuiBox className="auth-options">
              <FormControlLabel
                className="auth-option"
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
                className="auth-option"
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
            </MuiBox>

            {loginHistory.secure_password_storage ? (
              <MuiBox className="auth-security-note">
                <InfoOutlinedIcon fontSize="small" />
                <Typography variant="caption">
                  密码由操作系统安全凭据存储加密，不会以明文写入配置文件。
                </Typography>
              </MuiBox>
            ) : (
              <XDriveStatusAlert tone="warning">
                当前系统没有可用的安全凭据存储，因此无法保存密码或启用自动登录。
              </XDriveStatusAlert>
            )}

            <Typography className="auth-sync-note" variant="caption">
              {loginMount
                ? '将继续使用已配置的同步文件夹；登录后可在“设置”中修改。'
                : '同步文件夹将在登录后使用默认位置，并可在“设置”中修改。'}
            </Typography>

            <MuiBox className="auth-submit-row">
              <Typography variant="caption" className="auth-submit-hint">按 Enter 登录</Typography>
              <XDriveActionButton
                className="auth-submit"
                intent="primary"
                type="submit"
                disabled={!loginReady || !!busy}
                loading={busy === 'login'}
                loadingLabel="正在登录…"
              >
                登录
              </XDriveActionButton>
            </MuiBox>
          </Stack>

          <MuiBox className="auth-footer">
            <Typography component="span" className="auth-version" title={info?.commit || undefined}>
              {buildLabel}
            </Typography>
            <span className="auth-footer-separator" aria-hidden="true">·</span>
            <XDriveActionButton
              className="auth-diagnostics-toggle"
              compact
              startIcon={<BuildRoundedIcon fontSize="small" />}
              title={loginDiagnosticsOpen ? '收起登录诊断' : '展开登录诊断'}
              onClick={() => setLoginDiagnosticsOpen((current) => !current)}
            >
              {loginDiagnosticsOpen ? '收起诊断' : '诊断'}
            </XDriveActionButton>
          </MuiBox>

          {loginDiagnosticsOpen ? (
            <MuiBox className="auth-login-diagnostics" aria-label="登录诊断">
              <div className="auth-diagnostic-row">
                <span>Agent</span>
                <strong className="good">已连接</strong>
              </div>
              <div className="auth-diagnostic-row">
                <span>服务器</span>
                <strong className={serverProbe.key === 'ok' ? 'good' : serverProbe.key === 'error' ? 'bad' : ''}>
                  {serverProbe.key === 'ok'
                    ? '可访问'
                    : serverProbe.key === 'error'
                      ? '连接失败'
                      : serverProbe.key === 'checking'
                        ? '检查中'
                        : '等待检查'}
                </strong>
              </div>
              <div className="auth-diagnostic-row">
                <span>安全凭据存储</span>
                <strong className={loginHistory.secure_password_storage ? 'good' : 'bad'}>
                  {loginHistory.secure_password_storage ? '可用' : '不可用'}
                </strong>
              </div>
              <div className="auth-diagnostic-row">
                <span>当前账号密码</span>
                <strong>{hasStoredPassword ? '已安全保存' : '未保存'}</strong>
              </div>
              {serverProbe.key === 'error' && serverProbe.detail ? (
                <Typography className="auth-diagnostic-detail" variant="caption">{serverProbe.detail}</Typography>
              ) : null}
              <XDriveActionButton
                className="auth-diagnostic-logs"
                compact
                disabled={!!busy}
                onClick={() => void run('login-open-logs', () => window.xdriveDesktop.agent.openLogs())}
              >
                打开日志
              </XDriveActionButton>
            </MuiBox>
          ) : null}
        </form>
      </div>
    )
  }

  if (status?.must_change_password) {
    return renderDesktopFrame(
      <div className="center-shell">
        <div className="auth-panel auth-panel-form">
          <p className="eyebrow">需要修改密码</p>
          <h1>{headline}</h1>
          <p className="subtitle">管理员要求先修改密码，之后才能开始同步。</p>
          <XDrivePasswordChangeForm
            className="auth-form"
            buttonClassName="auth-submit"
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
        </div>
      </div>
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
        <MenuItem onClick={() => {
          setAccountMenuAnchor(null)
          setSettingsOpen(true)
          window.setTimeout(() => {
            document.getElementById('desktop-build-info')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 120)
        }}>
          <ListItemIcon><InfoOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="关于 xDrive" secondary={info?.version ? `Desktop ${info.version}` : undefined} />
        </MenuItem>
        <MuiDivider />
        <MenuItem sx={{ color: 'error.main' }} onClick={() => {
          setAccountMenuAnchor(null)
          requestLogout()
        }}>
          <ListItemIcon sx={{ color: 'inherit' }}><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>退出登录</ListItemText>
        </MenuItem>
      </XDriveAccountMenu>
    </Stack>
  )

  return renderDesktopFrame(
    <XDriveWorkspaceShell>
      <XDriveSidebarSurface ariaLabel="桌面版侧边栏" className="sidebar">
        <XDriveSidebarNavList ariaLabel="桌面版功能区">
          <XDriveSidebarNavItem selected={view === 'overview'} icon={<DashboardRoundedIcon fontSize="small" />} primary="概览" onClick={() => setView('overview')} />
          <XDriveCoreWorkspaceNavItems
            selected={view === 'cloud' ? 'files' : view === 'files' ? 'storage' : view}
            transferBadge={(activeTransfers.length + activeFileOperations.length) || undefined}
            onSelect={(destination) => {
              if (destination === 'files') setView('cloud')
              else if (destination === 'storage') setView('files')
              else setView(destination)
            }}
          />
          <XDriveSidebarNavItem selected={view === 'conflicts'} icon={<WarningAmberRoundedIcon fontSize="small" />} primary="冲突" badge={status?.conflict_count || undefined} onClick={() => setView('conflicts')} />
        </XDriveSidebarNavList>
        <XDriveSidebarSection pinnedBottom>
          <XDriveSidebarNavList ariaLabel="桌面版辅助功能">
            <XDriveSidebarNavItem selected={view === 'diagnostics'} icon={<BuildRoundedIcon fontSize="small" />} primary="诊断" onClick={() => setView('diagnostics')} />
          </XDriveSidebarNavList>
        </XDriveSidebarSection>
        {cloudQuota && (
          <XDriveSidebarStorageSummary
           
            usedBytes={cloudQuota.physical_used_bytes}
            totalBytes={cloudQuota.quota_bytes}
            diskAvailableBytes={cloudQuota.disk_available_bytes}
            sx={{ mt: 1.25 }}
          />
        )}
      </XDriveSidebarSurface>

      <main className={view === 'cloud' ? 'content content-files-workspace' : 'content'}>
        {(status?.last_error || status?.paused || status?.has_conflict) ? (
          <Stack
            spacing={1}
            sx={{
              mt: view === 'cloud' ? 1.5 : 2,
              mx: view === 'cloud' ? 1.5 : 0,
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
            hello={agent.hello}
            openFolderLoading={busy === 'folder'}
            onOpenFolder={() => {
              void run('folder', () => window.xdriveDesktop.agent.openFolder())
            }}
          />
        )}

        {view === 'gallery' && (
          <DesktopGalleryPage
            source={mediaGallerySource}
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

        {view === 'cloud' && (
          <DesktopCloudPage
            quota={cloudQuota}
            explorer={{
              items: cloudItems,
              crumbs: cloudCrumbs,
              loading: busy === 'cloud-load' || busy === 'cloud-directory',
              loadingMore: cloudLoadingMore,
              hasMore: cloudPage?.hasMore ?? false,
              onLoadDirectory: loadCloudDirectory,
              onLoadMore: loadMoreCloudDirectory,
              onOpenTrash: openCloudTrash,
              onOpenHistory: openCloud历史版本,
              onOpenShares: openCloudShares,
              onDelete: removeCloudNode,
              onDeleteMany: removeCloudNodes,
              onOperationQueued: rememberCloudFileOperation,
              onQuotaChanged: refreshCloudQuota,
              onError: (message) => setError(message),
              onFeedback: (_tone, message) => setNotice(message),
            }}
            trashOpen={cloudTrashOpen}
            onCloseTrash={() => setCloudTrashOpen(false)}
            onTrashChanged={async () => {
              await refreshCloudQuota()
              if (cloudCrumbs.length > 0) {
                await loadCloudDirectory(cloudCrumbs.at(-1)!.id, cloudCrumbs)
              }
            }}
            historyNode={cloudHistoryNode}
            onCloseHistory={() => {
              setCloudHistoryNode(null)
              setCloudHistoryCrumbs([])
            }}
            onHistoryRestored={async (restored) => {
              setCloudHistoryNode(restored)
              await refreshCloudQuota()
              if (cloudHistoryCrumbs.length > 0) {
                await loadCloudDirectory(cloudHistoryCrumbs.at(-1)!.id, cloudHistoryCrumbs)
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

        {view === 'transfers' && (
          <DesktopTransfersPage
            transfers={transfers.transfers}
            operations={cloudFileOperations}
            retryingID={busy.startsWith('retry-transfer-') ? busy.slice('retry-transfer-'.length) : ''}
            retryDisabled={Boolean(busy) || fileOperationAction === 'clear-history'}
            operationCancellingID={fileOperationAction.startsWith('cancel:') ? fileOperationAction.slice('cancel:'.length) : ''}
            operationRetryingID={fileOperationAction.startsWith('retry:') ? fileOperationAction.slice('retry:'.length) : ''}
            operationDisabled={Boolean(fileOperationAction)}
            clearHistoryDisabled={!hasTaskHistory || Boolean(busy) || Boolean(fileOperationAction)}
            clearHistoryLoading={fileOperationAction === 'clear-history'}
            onRetry={(id) => { void retryTransfer(id) }}
            onCancelOperation={(id) => { void cancelCloudFileOperation(id) }}
            onRetryOperation={(id) => { void retryCloudFileOperation(id) }}
            onClearHistory={() => { void clearTaskHistory() }}
          />
        )}

        {view === 'files' && (
          <DesktopStoragePage
            storagePoliciesSupported={storagePoliciesSupported}
            busy={busy}
            cloudQuota={cloudQuota}
            cloudStorageStats={cloudStorageStats}
            cacheStats={cacheStats}
            storageTree={storageTree}
            renderStorageNode={renderStorageNode}
            onRefresh={() => { void loadStorage() }}
            onReleaseCache={() => { void releaseReclaimableCache() }}
          />
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

      </main>

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
            state: serverUpdate,
            source: serverUpdateSource,
            channel: serverUpdateChannel,
            loading: busy === 'server-update',
            disabled: serverUpdate === null || (!!busy && busy !== 'server-update'),
            error: serverUpdateError,
            onSourceChange: setServerUpdateSource,
            onChannelChange: setServerUpdateChannel,
            onStart: () => setConfirmDialog({
              title: '确认更新服务端？',
              message: `来源：${serverUpdateSource === 'gitlab' ? 'GitLab' : 'GitHub'} · 通道：${serverUpdateChannel}。更新会执行升级前备份、容器更新和健康检查，期间服务可能短暂不可用。`,
              confirmLabel: '开始更新',
              tone: 'warning',
              onConfirm: startServerUpdate,
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
              setView('files')
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
