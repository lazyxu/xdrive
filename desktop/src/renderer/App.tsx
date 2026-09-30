import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Alert as MuiAlert,
  Autocomplete,
  Avatar,
  Box as MuiBox,
  Button as MuiButton,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContentText,
  Divider as MuiDivider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded'
import FilterNoneRoundedIcon from '@mui/icons-material/FilterNoneRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'
import {
  XDriveActionButton,
  XDriveDialogActions,
  XDriveDialogActionSpacer,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveMediaGalleryPage,
  XDrivePaginationControls,
  XDriveStatePanel,
  XDriveShareStatusBadge,
  XDriveStatusAlert,
  XDriveStatusBadge,
  XDriveSourceRunProgress,
  XDriveSourceRunSummary,
  XDriveSourceFailureItem,
  XDriveSynologyDsmGuideDialog as SynologyDsmGuideDialog,
  XDriveYikeCookieHelp,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import type { MediaGalleryDataSource, XDriveStatusTone } from '@xdrive/ui/mui'
import {
  externalSourceCardView,
  externalSourceCollectionKindLabel,
  externalSourceCollectionStateLabel,
  externalSourceCollectionStateTone,
  externalSourceConnectorProfile,
  externalSourceCreateOption,
  externalSourceCreateOptions,
  externalSourceCredentialLabel,
  externalSourceCredentialTestErrorLabel,
  externalSourceSavedCredentialMask,
  isExternalSourceSavedCredentialMask,
  externalSourceCredentialTestSuccessLabel,
  externalSourceDefaults,
  externalSourceDetailView,
  externalSourceRunDetailView,
  externalSourceTriggerActionLabel,
  formatBinarySize,
  formatExternalSourceTime,
  normalizeSynologyPhotoSpaces,
  synologyPhotoSpaceOptions,
  synologyDsmAddressHelp,
  yikeConnectorNotice,
  yikeRateLimitNotice,
  yikeManagedTargetLabel,
} from '@xdrive/shared'
import type {
  BuildInfo,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceConnectorConfig,
  ExternalSourceCreatePreset,
  ExternalSourceCredentialTestResult,
  ExternalSourceItem,
  ExternalSourceRow,
  ExternalSourceRun,
  ExternalSourceRunFailure,
  ExternalSourceScheduleType,
  SynologyPhotoSpace,
  SupportedExternalSourceKind,
} from '@xdrive/shared'

const SOURCE_HISTORY_PAGE_SIZE = 20
const SOURCE_RUN_FAILURE_PAGE_SIZE = 20
const SOURCE_COLLECTION_ITEM_PAGE_SIZE = 50

type SourceRunFailurePage = {
  items: ExternalSourceRunFailure[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

type SourceCollectionItemPage = {
  items: ExternalSourceCollectionItem[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

type View = 'overview' | 'cloud' | 'gallery' | 'sources' | 'transfers' | 'files' | 'conflicts' | 'diagnostics' | 'settings'

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
        <div className="desktop-titlebar-brand">
          <img className="desktop-titlebar-icon" src={xDriveBrandIcon} alt="" aria-hidden="true" />
          <strong>xDrive</strong>
        </div>
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

function buildInfoTime(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function BuildInfoCard({ title, info }: { title: string; info?: BuildInfo | null }) {
  return (
    <MuiBox sx={{ flex: '1 1 360px', minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{title}</Typography>
      <Stack spacing={0.75}>
        <Typography variant="body2"><strong>版本：</strong>{info?.version || '未知'}</Typography>
        <Typography variant="body2"><strong>通道：</strong>{info?.channel || '—'}</Typography>
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}><strong>Commit：</strong>{info?.commit || '—'}</Typography>
        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}><strong>Commit message：</strong>{info?.commit_message || '—'}</Typography>
        <Typography variant="body2"><strong>Commit 时间：</strong>{buildInfoTime(info?.commit_time)}</Typography>
        <Typography variant="body2"><strong>构建时间：</strong>{buildInfoTime(info?.build_time)}</Typography>
      </Stack>
    </MuiBox>
  )
}

function cacheGiB(bytes: number) {
  if (!bytes) return '0'
  return String(Number((bytes / 1024 ** 3).toFixed(3)))
}

function formatTransferSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  return `${formatBinarySize(Math.round(bytesPerSecond))}/s`
}

function formatElapsed(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0 秒'
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${remain} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

function transferKindLabel(kind: string) {
  if (kind === 'upload') return '上传'
  if (kind === 'download') return '下载'
  if (kind === 'hydration') return '下载到本地'
  if (kind === 'dehydration') return '释放空间'
  return kind
}

function viewLabel(view: View) {
  const labels: Record<View, string> = {
    overview: '概览',
    cloud: '文件',
    gallery: '图库',
    sources: '外部来源',
    transfers: '传输',
    files: '存储',
    conflicts: '冲突',
    diagnostics: '诊断',
    settings: '设置',
  }
  return labels[view]
}

function updateStatusLabel(state: AgentUpdateState | null) {
  if (!state) return '不可用'
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
  if (mode === 'check') return '后台定期检查；发现新版本后只提示，不会自动下载。'
  if (mode === 'download') return '后台定期检查并自动下载、校验；安装前仍由你确认。'
  if (mode === 'install') return '后台定期检查，有新版本时自动下载并安装。'
  return '不在后台检查更新；只有点击“检查更新”时才访问更新服务。'
}

export default function App() {
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences>({
    start_at_login: true,
    close_to_tray: true,
  })
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
  const [conflicts, setConflicts] = useState<AgentConflict[]>([])
  const [transfers, setTransfers] = useState<AgentTransfers>({ revision: 0, transfers: [] })
  const [diagnostics, setDiagnostics] = useState<AgentDiagnosticReport | null>(null)
  const [sources, setSources] = useState<ExternalSourceRow[]>([])
  const [selectedSourceID, setSelectedSourceID] = useState<number | null>(null)
  const [editingSourceID, setEditingSourceID] = useState<number | null>(null)
  const [sourceEditName, setSourceEditName] = useState('')
  const [sourceEditRunMode, setSourceEditRunMode] = useState<'scan' | 'sync'>('scan')
  const [sourceEditStatus, setSourceEditStatus] = useState<'active' | 'paused'>('active')
  const [sourceEditScheduleType, setSourceEditScheduleType] = useState<ExternalSourceScheduleType>('interval')
  const [sourceEditScheduleExpression, setSourceEditScheduleExpression] = useState('6h')
  const [sourceEditScheduleTimezone, setSourceEditScheduleTimezone] = useState('UTC')
  const [sourceEditIgnoreRules, setSourceEditIgnoreRules] = useState('')
  const [sourceEditCookie, setSourceEditCookie] = useState('')
  const [sourceEditDsmBaseURL, setSourceEditDsmBaseURL] = useState('')
  const [sourceEditDsmUsername, setSourceEditDsmUsername] = useState('')
  const [sourceEditDsmPassword, setSourceEditDsmPassword] = useState('')
  const [sourceEditSpaces, setSourceEditSpaces] = useState<SynologyPhotoSpace[]>(['personal', 'shared'])
  const [sourceEditConnectorConfig, setSourceEditConnectorConfig] = useState<ExternalSourceConnectorConfig | null>(null)
  const [sourceCreateOpen, setSourceCreateOpen] = useState(false)
  const initialSourceOption = externalSourceCreateOption('synology_push')
  const initialSourceDefaults = externalSourceDefaults(initialSourceOption.kind, initialSourceOption.direction)
  const [sourceCreatePreset, setSourceCreatePreset] = useState<ExternalSourceCreatePreset>(initialSourceOption.value)
  const sourceCreateOption = externalSourceCreateOption(sourceCreatePreset)
  const sourceCreateKind = sourceCreateOption.kind
  const sourceCreateDirection = sourceCreateOption.direction
  const sourceCreateProfile = externalSourceConnectorProfile(sourceCreateKind, sourceCreateDirection)
  const [sourceCreateName, setSourceCreateName] = useState(initialSourceDefaults.name)
  const [sourceCreateRunMode, setSourceCreateRunMode] = useState<'scan' | 'sync'>(initialSourceDefaults.runMode)
  const [sourceCreateScheduleType, setSourceCreateScheduleType] = useState<ExternalSourceScheduleType>(initialSourceDefaults.scheduleType)
  const [sourceCreateScheduleExpression, setSourceCreateScheduleExpression] = useState(initialSourceDefaults.scheduleExpression)
  const [sourceCreateScheduleTimezone, setSourceCreateScheduleTimezone] = useState(initialSourceDefaults.scheduleTimezone)
  const [sourceCreateIgnoreRules, setSourceCreateIgnoreRules] = useState(initialSourceDefaults.ignoreRules)
  const [sourceCreateCookie, setSourceCreateCookie] = useState('')
  const [sourceCreateDsmBaseURL, setSourceCreateDsmBaseURL] = useState('')
  const [sourceCreateDsmUsername, setSourceCreateDsmUsername] = useState('')
  const [sourceCreateDsmPassword, setSourceCreateDsmPassword] = useState('')
  const [sourceCreateSpaces, setSourceCreateSpaces] = useState<SynologyPhotoSpace[]>(['personal', 'shared'])
  const [sourceCreateCredentialTest, setSourceCreateCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [sourceEditCredentialTest, setSourceEditCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [sourceFailedItems, setSourceFailedItems] = useState<ExternalSourceItem[]>([])
  const [sourceFailedItemsSourceID, setSourceFailedItemsSourceID] = useState<number | null>(null)
  const [sourceFailedItemsLoadingID, setSourceFailedItemsLoadingID] = useState<number | null>(null)
  const [sourceFailedItemsOpen, setSourceFailedItemsOpen] = useState(false)
  const [sourceFailedItemsLimitReached, setSourceFailedItemsLimitReached] = useState(false)
  const [sourceHistoryRuns, setSourceHistoryRuns] = useState<ExternalSourceRun[]>([])
  const [sourceHistoryPage, setSourceHistoryPage] = useState(1)
  const [sourceHistoryHasNext, setSourceHistoryHasNext] = useState(false)
  const [sourceHistoryLoading, setSourceHistoryLoading] = useState(false)
  const [sourceRunFailurePages, setSourceRunFailurePages] = useState<Record<string, SourceRunFailurePage>>({})
  const [sourceCollections, setSourceCollections] = useState<ExternalSourceCollection[]>([])
  const [sourceCollectionsSourceID, setSourceCollectionsSourceID] = useState<number | null>(null)
  const [sourceCollectionsLoadingID, setSourceCollectionsLoadingID] = useState<number | null>(null)
  const [sourceCollectionItemPages, setSourceCollectionItemPages] = useState<Record<number, SourceCollectionItemPage>>({})
  const [sourceDeleteTarget, setSourceDeleteTarget] = useState<ExternalSourceRow | null>(null)
  const [synologyGuideSource, setSynologyGuideSource] = useState<AgentSource | null>(null)
  const [sourceTargetCrumbs, setSourceTargetCrumbs] = useState<AgentCloudCrumb[]>([])
  const [sourceTargetDirectories, setSourceTargetDirectories] = useState<AgentCloudNode[]>([])
  const [sourceTargetLoading, setSourceTargetLoading] = useState(false)
  const [cloudRoot, setCloudRoot] = useState<AgentCloudNode | null>(null)
  const [cloudItems, setCloudItems] = useState<AgentCloudNode[]>([])
  const [cloudCrumbs, setCloudCrumbs] = useState<AgentCloudCrumb[]>([])
  const [cloudQuota, setCloudQuota] = useState<AgentCloudQuota | null>(null)
  const [cloudStorageStats, setCloudStorageStats] = useState<AgentCloudStorageStats | null>(null)
  const [cloudQuery, setCloudQuery] = useState('')
  const [cloudSearchActive, setCloudSearchActive] = useState(false)
  const [cloudResults, setCloudResults] = useState<AgentCloudSearchResult[]>([])
  const [cloudTrashOpen, setCloudTrashOpen] = useState(false)
  const [cloudTrash, setCloudTrash] = useState<AgentCloudNode[]>([])
  const [cloudHistoryNode, setCloudHistoryNode] = useState<AgentCloudNode | null>(null)
  const [cloudHistoryCrumbs, setCloudHistoryCrumbs] = useState<AgentCloudCrumb[]>([])
  const [cloudVersions, setCloudVersions] = useState<AgentCloudVersion[]>([])
  const [cloudShareNode, setCloudShareNode] = useState<AgentCloudNode | null>(null)
  const [cloudShares, setCloudShares] = useState<AgentCloudShare[]>([])
  const [shareExpiresDays, setShareExpiresDays] = useState('7')
  const [sharePassword, setSharePassword] = useState('')
  const [shareMaxDownloads, setShareMaxDownloads] = useState('0')
  const [createdShareURL, setCreatedShareURL] = useState('')

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
  const savedPasswordAvailable = password.length === 0 && !!matchingLoginProfile?.password_available

  const status = agent.status
  const configured = !!status?.configured
  const activeTransfers = transfers.transfers.filter((item) => item.state === 'running' || item.state === 'retrying')
  const completedTransfers = transfers.transfers.filter((item) => item.state === 'completed')
  const failedTransfers = transfers.transfers.filter((item) => item.state === 'failed')
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
    const unsubscribeTransfers = window.xdriveDesktop.agent.onTransfers((value) => {
      if (active) setTransfers(value)
    })
    const unsubscribeWindowState = window.xdriveDesktop.onWindowState((value) => {
      if (active) setWindowMaximized(value.maximized)
    })
    const unsubscribeNavigate = window.xdriveDesktop.onNavigate((target) => {
      if (!active) return
      if (target === 'settings-update') {
        setView('settings')
        window.setTimeout(() => {
          document.getElementById('client-update-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 120)
        return
      }
      setView(target)
    })
    return () => {
      active = false
      unsubscribe()
      unsubscribeTransfers()
      unsubscribeWindowState()
      unsubscribeNavigate()
    }
  }, [])

  useEffect(() => {
    if (configured || !status) return
    if (status.server) setServer((current) => current || status.server || '')
    if (status.username) setUsername((current) => current || status.username || '')
    if (status.mount_path) setLoginMount((current) => current || status.mount_path || '')
  }, [configured, status?.mount_path, status?.server, status?.username])

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
    if (!agent.connected || !configured) {
      setSettings(null)
      setConflicts([])
      setDiagnostics(null)
      setSources([])
      setSelectedSourceID(null)
      setEditingSourceID(null)
      setSourceEditCookie('')
      setSourceCreateOpen(false)
      setSourceCreateCookie('')
      setSourceDeleteTarget(null)
      setSynologyGuideSource(null)
      setSourceTargetCrumbs([])
      setSourceTargetDirectories([])
      setStorageTree(null)
      setCacheStats(null)
      setCloudRoot(null)
      setCloudItems([])
      setCloudCrumbs([])
      setCloudQuota(null)
      setCloudSearchActive(false)
      setCloudResults([])
      setCloudTrash([])
      setCloudHistoryNode(null)
      setCloudHistoryCrumbs([])
      setCloudVersions([])
      setCloudShareNode(null)
      setCloudShares([])
      setCreatedShareURL('')
      return
    }
    if (view === 'settings') void loadSettings()
    if (view === 'conflicts') void loadConflicts()
    // Refresh lightweight settings/conflict state when the Agent revision changes.
    // Diagnostics are intentionally excluded because they perform network/system checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured, status?.revision])

  useEffect(() => {
    if (view !== 'sources' || !agent.connected || !configured) return
    void loadSources()
    // External Sources load when entering the page or reconnecting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  useEffect(() => {
    if (
      view !== 'sources' || !agent.connected || !configured ||
      !sources.some((row) => row.latestRun?.status === 'running' || row.source.run_requested_at)
    ) return
    const timer = window.setInterval(() => {
      void loadSources(true)
    }, 1500)
    return () => window.clearInterval(timer)
    // Poll only while a Source is active/pending; loadSources is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured, sources])

  useEffect(() => {
    if (view !== 'sources' || !agent.connected || !configured || !selectedSourceID || sourceHistoryPage !== 1) return
    const selectedRow = sources.find((row) => row.source.id === selectedSourceID)
    if (!selectedRow || (selectedRow.latestRun?.status !== 'running' && !selectedRow.source.run_requested_at)) return
    const timer = window.setInterval(() => {
      void loadSourceHistory(selectedSourceID, 1, true)
    }, 1500)
    return () => window.clearInterval(timer)
    // Poll only the first history page while the selected Source is active/pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured, selectedSourceID, sourceHistoryPage, sources])

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
    if (!password && !savedPasswordAvailable) {
      setError('请输入密码。')
      return
    }
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

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
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

  const loadSourceRunFailures = async (sourceID: number, runID: string, page = 1) => {
    const nextPage = Math.max(1, Math.trunc(page))
    setSourceRunFailurePages((current) => ({
      ...current,
      [runID]: {
        items: current[runID]?.items ?? [],
        page: current[runID]?.page ?? nextPage,
        hasNext: current[runID]?.hasNext ?? false,
        loading: true,
        loaded: current[runID]?.loaded ?? false,
      },
    }))
    const offset = (nextPage - 1) * SOURCE_RUN_FAILURE_PAGE_SIZE
    const result = await window.xdriveDesktop.agent.getSourceRunFailures(
      sourceID,
      runID,
      SOURCE_RUN_FAILURE_PAGE_SIZE + 1,
      offset,
    )
    if (!result.ok) {
      setError(result.error.message)
      setSourceRunFailurePages((current) => ({
        ...current,
        [runID]: {
          items: current[runID]?.items ?? [],
          page: current[runID]?.page ?? nextPage,
          hasNext: current[runID]?.hasNext ?? false,
          loading: false,
          loaded: current[runID]?.loaded ?? false,
        },
      }))
      return
    }
    setSourceRunFailurePages((current) => ({
      ...current,
      [runID]: {
        items: result.data.slice(0, SOURCE_RUN_FAILURE_PAGE_SIZE),
        page: nextPage,
        hasNext: result.data.length > SOURCE_RUN_FAILURE_PAGE_SIZE,
        loading: false,
        loaded: true,
      },
    }))
  }

  const loadSourceHistory = async (sourceID: number, page: number, silent = false) => {
    const nextPage = Math.max(1, Math.trunc(page))
    if (!silent) setSourceHistoryLoading(true)
    try {
      const offset = (nextPage - 1) * SOURCE_HISTORY_PAGE_SIZE
      const result = await window.xdriveDesktop.agent.getSourceRuns(sourceID, SOURCE_HISTORY_PAGE_SIZE + 1, offset)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSourceHistoryRuns(result.data.slice(0, SOURCE_HISTORY_PAGE_SIZE))
      setSourceHistoryHasNext(result.data.length > SOURCE_HISTORY_PAGE_SIZE)
      setSourceHistoryPage(nextPage)
    } finally {
      if (!silent) setSourceHistoryLoading(false)
    }
  }

  const loadSources = async (silent = false) => {
    if (!silent) {
      setBusy('sources')
      setError('')
    }
    try {
      if (!(agent.hello?.capabilities.includes('external-sources') ?? false)) {
        setSources([])
        setError('当前 xdrive-agent 不支持外部来源，请更新客户端核心组件。')
        return
      }
      const sourceResult = await window.xdriveDesktop.agent.getSources()
      if (!sourceResult.ok) {
        setError(sourceResult.error.message)
        return
      }
      const rows = await Promise.all(sourceResult.data.map(async (source) => {
        const [runsResult, credentialResult] = await Promise.all([
          window.xdriveDesktop.agent.getSourceRuns(source.id, 1),
          externalSourceConnectorProfile(source.kind, source.direction).credential
            ? window.xdriveDesktop.agent.getSourceCredential(source.id)
            : Promise.resolve(null),
        ])
        if (!runsResult.ok) setError(runsResult.error.message)
        if (credentialResult && !credentialResult.ok) setError(credentialResult.error.message)
        return {
          source,
          latestRun: runsResult.ok ? runsResult.data[0] : undefined,
          credential: credentialResult && credentialResult.ok ? credentialResult.data : undefined,
        }
      }))
      setSources(rows)
    } finally {
      if (!silent) setBusy('')
    }
  }

  const loadSourceCollections = async (sourceID: number) => {
    setSourceCollectionsLoadingID(sourceID)
    try {
      const result = await window.xdriveDesktop.agent.getSourceCollections(sourceID)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSourceCollections(result.data)
      setSourceCollectionsSourceID(sourceID)
    } finally {
      setSourceCollectionsLoadingID(null)
    }
  }

  const loadSourceCollectionItems = async (sourceID: number, collectionID: number, page = 1) => {
    const nextPage = Math.max(1, Math.trunc(page))
    setSourceCollectionItemPages((current) => ({
      ...current,
      [collectionID]: {
        items: current[collectionID]?.items ?? [],
        page: current[collectionID]?.page ?? nextPage,
        hasNext: current[collectionID]?.hasNext ?? false,
        loading: true,
        loaded: current[collectionID]?.loaded ?? false,
      },
    }))
    const offset = (nextPage - 1) * SOURCE_COLLECTION_ITEM_PAGE_SIZE
    const result = await window.xdriveDesktop.agent.getSourceCollectionItems(
      sourceID,
      collectionID,
      SOURCE_COLLECTION_ITEM_PAGE_SIZE + 1,
      offset,
    )
    if (!result.ok) {
      setError(result.error.message)
      setSourceCollectionItemPages((current) => ({
        ...current,
        [collectionID]: {
          items: current[collectionID]?.items ?? [],
          page: current[collectionID]?.page ?? nextPage,
          hasNext: current[collectionID]?.hasNext ?? false,
          loading: false,
          loaded: current[collectionID]?.loaded ?? false,
        },
      }))
      return
    }
    setSourceCollectionItemPages((current) => ({
      ...current,
      [collectionID]: {
        items: result.data.slice(0, SOURCE_COLLECTION_ITEM_PAGE_SIZE),
        page: nextPage,
        hasNext: result.data.length > SOURCE_COLLECTION_ITEM_PAGE_SIZE,
        loading: false,
        loaded: true,
      },
    }))
  }

  const toggleSourceDetails = async (row: ExternalSourceRow) => {
    const sourceID = row.source.id
    if (selectedSourceID === sourceID) {
      setSelectedSourceID(null)
      setSourceFailedItems([])
      setSourceFailedItemsSourceID(null)
      setSourceFailedItemsOpen(false)
      setSourceFailedItemsLimitReached(false)
      setSourceHistoryRuns([])
      setSourceHistoryPage(1)
      setSourceHistoryHasNext(false)
      setSourceRunFailurePages({})
      setSourceCollections([])
      setSourceCollectionsSourceID(null)
      setSourceCollectionsLoadingID(null)
      setSourceCollectionItemPages({})
      return
    }

    setSelectedSourceID(sourceID)
    setSourceFailedItems([])
    setSourceFailedItemsSourceID(null)
    setSourceFailedItemsOpen(false)
    setSourceFailedItemsLimitReached(false)
    setSourceHistoryRuns([])
    setSourceHistoryPage(1)
    setSourceHistoryHasNext(false)
    setSourceRunFailurePages({})
    setSourceCollections([])
    setSourceCollectionsSourceID(null)
    setSourceCollectionItemPages({})
    setSourceFailedItemsLoadingID(sourceID)
    setError('')
    void loadSourceHistory(sourceID, 1)
    void loadSourceCollections(sourceID)
    try {
      const result = await window.xdriveDesktop.agent.getSourceItems(sourceID, 'error', 1000, 0)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSourceFailedItems(result.data)
      setSourceFailedItemsSourceID(sourceID)
      setSourceFailedItemsLimitReached(result.data.length >= 1000)
    } finally {
      setSourceFailedItemsLoadingID(null)
    }
  }

  const triggerSourceNow = async (row: ExternalSourceRow) => {
    const sourceID = row.source.id
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    const success = profile.manualTriggerExecutor === 'source_agent'
      ? '已请求立即扫描，等待群晖 source-agent 下一次任务检查。'
      : '已请求立即扫描，Pull worker 将在下一次轮询或唤醒时开始。'
    const data = await run(
      `source-trigger-${sourceID}`,
      () => window.xdriveDesktop.agent.triggerSource(sourceID),
      success,
    )
    if (data) await loadSources()
  }

  const cancelSourceRunNow = async (row: ExternalSourceRow) => {
    const sourceRun = row.latestRun
    if (!sourceRun || sourceRun.status !== 'running' || sourceRun.cancel_requested_at) return
    const data = await run(
      `source-cancel-${sourceRun.id}`,
      () => window.xdriveDesktop.agent.cancelSourceRun(row.source.id, sourceRun.id),
      '已请求停止当前运行。',
    )
    if (data) await loadSources(true)
  }

  const loadSourceTargetDirectory = async (nodeID: number, crumbs: AgentCloudCrumb[]) => {
    setSourceTargetLoading(true)
    setError('')
    try {
      const children = await window.xdriveDesktop.agent.cloudChildren(nodeID)
      if (!children.ok) {
        setError(children.error.message)
        return false
      }
      setSourceTargetCrumbs(crumbs)
      setSourceTargetDirectories(children.data.filter((item) => item.type === 'dir'))
      return true
    } finally {
      setSourceTargetLoading(false)
    }
  }

  const resetSourceCreateCredential = () => {
    setSourceCreateCookie('')
    setSourceCreateDsmBaseURL('')
    setSourceCreateDsmUsername('')
    setSourceCreateDsmPassword('')
    setSourceCreateSpaces(['personal', 'shared'])
    setSourceCreateCredentialTest(null)
  }

  const openSourceCreate = async () => {
    const option = externalSourceCreateOption('synology_push')
    const defaults = externalSourceDefaults(option.kind, option.direction)
    setSourceCreatePreset(option.value)
    setSourceCreateName(defaults.name)
    setSourceCreateRunMode(defaults.runMode)
    setSourceCreateScheduleType(defaults.scheduleType)
    setSourceCreateScheduleExpression(defaults.scheduleExpression)
    setSourceCreateScheduleTimezone(defaults.scheduleTimezone)
    setSourceCreateIgnoreRules(defaults.ignoreRules)
    resetSourceCreateCredential()
    setSourceCreateOpen(true)
    setSourceTargetLoading(true)
    setError('')
    try {
      const root = await window.xdriveDesktop.agent.cloudRoot()
      if (!root.ok) {
        setError(root.error.message)
        return
      }
      await loadSourceTargetDirectory(root.data.id, [{ id: root.data.id, name: '我的文件' }])
    } finally {
      setSourceTargetLoading(false)
    }
  }

  const changeSourceCreatePreset = (preset: ExternalSourceCreatePreset) => {
    const option = externalSourceCreateOption(preset)
    const defaults = externalSourceDefaults(option.kind, option.direction)
    setSourceCreatePreset(option.value)
    setSourceCreateName(defaults.name)
    setSourceCreateRunMode(defaults.runMode)
    setSourceCreateScheduleType(defaults.scheduleType)
    setSourceCreateScheduleExpression(defaults.scheduleExpression)
    setSourceCreateScheduleTimezone(defaults.scheduleTimezone)
    setSourceCreateIgnoreRules(defaults.ignoreRules)
    resetSourceCreateCredential()
  }

  const sourceCreateCredentialPayload = (): Record<string, string> | null => {
    if (sourceCreateProfile.credential === 'cookie') {
      const cookie = sourceCreateCookie.trim()
      return cookie ? { cookie } : null
    }
    if (sourceCreateProfile.credential === 'synology_dsm') {
      const baseURL = sourceCreateDsmBaseURL.trim()
      const username = sourceCreateDsmUsername.trim()
      return baseURL && username && sourceCreateDsmPassword
        ? { base_url: baseURL, username, password: sourceCreateDsmPassword }
        : null
    }
    return {}
  }

  const testCreateSourceCredential = async () => {
    if (!sourceCreateProfile.credential) return null
    const payload = sourceCreateCredentialPayload()
    if (!payload) {
      setError(sourceCreateProfile.credential === 'cookie'
        ? '请先填写一刻相册 Cookie。'
        : '请完整填写 DSM 地址、用户名和密码。')
      return null
    }
    setBusy('source-create-test')
    setError('')
    setNotice('')
    try {
      const result = await window.xdriveDesktop.agent.testSourceCredential(sourceCreateKind, payload)
      if (!result.ok) {
        setSourceCreateCredentialTest(null)
        setError(externalSourceCredentialTestErrorLabel(result.error.code || result.error.message, result.error.detail))
        return null
      }
      setSourceCreateCredentialTest(result.data)
      setNotice(externalSourceCredentialTestSuccessLabel(result.data))
      return result.data
    } finally {
      setBusy('')
    }
  }

  const rollbackCreatedSource = async (created: AgentSource, reason: string) => {
    const rollback = await window.xdriveDesktop.agent.deleteSource(created.id, created.revision)
    if (rollback.ok) {
      setError(`${reason}。刚创建的来源已自动撤销，请检查后重试。`)
      await loadSources()
      return true
    }
    setError(`${reason}；自动回滚也失败：${rollback.error.message}。请进入“设置”修复或删除该来源。`)
    await loadSources()
    return false
  }

  const createExternalSource = async (event: FormEvent) => {
    event.preventDefault()
    const name = sourceCreateName.trim()
    const target = sourceTargetCrumbs.at(-1)
    if (!name) {
      setError('来源名称不能为空。')
      return
    }
    if (sourceCreateKind !== 'yike_photos' && !target) {
      setError('请选择目标文件夹。')
      return
    }
    const credentialPayload = sourceCreateProfile.credential ? sourceCreateCredentialPayload() : null
    if (sourceCreateProfile.credential && !credentialPayload) {
      setError(sourceCreateProfile.credential === 'cookie'
        ? '请填写一刻相册 Cookie。'
        : '请完整填写 Synology DSM 地址、用户名和密码。')
      return
    }
    if (sourceCreateProfile.credential === 'synology_dsm' && sourceCreateSpaces.length === 0) {
      setError('至少选择一个 Synology Photos 空间。')
      return
    }

    setBusy('source-create')
    setError('')
    setNotice('')
    try {
      if (sourceCreateProfile.credential) {
        const tested = await window.xdriveDesktop.agent.testSourceCredential(sourceCreateKind, credentialPayload as Record<string, string>)
        if (!tested.ok) {
          setSourceCreateCredentialTest(null)
          setError(externalSourceCredentialTestErrorLabel(tested.error.code || tested.error.message, tested.error.detail))
          return
        }
        setSourceCreateCredentialTest(tested.data)
      }
      const created = await window.xdriveDesktop.agent.createSource({
        name,
        kind: sourceCreateKind,
        direction: sourceCreateDirection,
        sync_mode: 'backup',
        run_mode: sourceCreateRunMode,
        schedule_type: sourceCreateScheduleType,
        schedule_expression: sourceCreateScheduleType === 'manual' ? '' : sourceCreateScheduleExpression.trim(),
        schedule_timezone: sourceCreateScheduleType === 'cron' ? sourceCreateScheduleTimezone.trim() : '',
        target_node_id: sourceCreateKind === 'yike_photos' ? 0 : (target?.id ?? 0),
        ignore_rules: sourceCreateIgnoreRules,
      })
      if (!created.ok) {
        setError(created.error.message)
        return
      }

      if (sourceCreateProfile.credential === 'synology_dsm') {
        const config = await window.xdriveDesktop.agent.getSourceConnectorConfig(created.data.id)
        if (!config.ok) {
          await rollbackCreatedSource(created.data, `读取群晖空间配置失败：${config.error.message}`)
          return
        }
        const savedConfig = await window.xdriveDesktop.agent.setSourceConnectorConfig(
          created.data.id,
          config.data.revision,
          { spaces: normalizeSynologyPhotoSpaces(sourceCreateSpaces) },
        )
        if (!savedConfig.ok) {
          await rollbackCreatedSource(created.data, `保存群晖空间配置失败：${savedConfig.error.message}`)
          return
        }
      }

      if (sourceCreateProfile.credential && credentialPayload) {
        const credential = await window.xdriveDesktop.agent.setSourceCredential(created.data.id, credentialPayload)
        if (!credential.ok) {
          const label = externalSourceCredentialLabel(sourceCreateProfile)
          await rollbackCreatedSource(created.data, `${label}保存失败：${externalSourceCredentialTestErrorLabel(credential.error.code || credential.error.message, credential.error.detail)}`)
          return
        }
      }

      setSourceCreateOpen(false)
      resetSourceCreateCredential()
      if (sourceCreateProfile.manualTriggerExecutor === 'source_agent') {
        setSynologyGuideSource(created.data)
        setNotice('群晖 Push 来源已添加。请按 DSM 配置向导绑定 xdrive-source-agent。')
      } else if (sourceCreateKind === 'yike_photos') {
        setNotice(`一刻相册来源已添加，目标目录固定为 ${yikeManagedTargetLabel}。`)
      } else {
        setNotice('群晖 Pull 来源已添加；xDrive Server 将按调度直接读取 Synology Photos。')
      }
      await loadSources()
    } finally {
      setBusy('')
    }
  }

  const openSourceSettings = (row: ExternalSourceRow) => {
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    setEditingSourceID(row.source.id)
    setSourceEditName(row.source.name)
    setSourceEditRunMode(row.source.run_mode)
    setSourceEditStatus(row.source.status)
    setSourceEditScheduleType(row.source.schedule_type ?? 'interval')
    setSourceEditScheduleExpression(row.source.schedule_expression || '6h')
    setSourceEditScheduleTimezone(row.source.schedule_timezone || externalSourceDefaults(row.source.kind as SupportedExternalSourceKind, row.source.direction).scheduleTimezone)
    setSourceEditIgnoreRules(row.source.ignore_rules || '')
    setSourceEditCookie(profile.credential === 'cookie' && row.credential?.configured ? externalSourceSavedCredentialMask : '')
    setSourceEditDsmBaseURL('')
    setSourceEditDsmUsername('')
    setSourceEditDsmPassword('')
    setSourceEditSpaces(['personal', 'shared'])
    setSourceEditConnectorConfig(null)
    setSourceEditCredentialTest(null)
    if (profile.credential === 'synology_dsm') {
      void window.xdriveDesktop.agent.getSourceConnectorConfig(row.source.id).then((config) => {
        if (!config.ok) {
          setError(config.error.message)
          return
        }
        setSourceEditConnectorConfig(config.data)
        const spaces = Array.isArray(config.data.payload.spaces)
          ? config.data.payload.spaces.filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
          : []
        setSourceEditSpaces(spaces.length ? spaces : ['personal', 'shared'])
      })
    }
  }

  const sourceEditCredentialPayload = (row: ExternalSourceRow): Record<string, string> | null | undefined => {
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    if (profile.credential === 'cookie') {
      if (isExternalSourceSavedCredentialMask(sourceEditCookie)) return null
      const cookie = sourceEditCookie.trim()
      return cookie ? { cookie } : null
    }
    if (profile.credential === 'synology_dsm') {
      const baseURL = sourceEditDsmBaseURL.trim()
      const username = sourceEditDsmUsername.trim()
      const anyPending = Boolean(baseURL || username || sourceEditDsmPassword)
      if (!anyPending) return null
      return baseURL && username && sourceEditDsmPassword
        ? { base_url: baseURL, username, password: sourceEditDsmPassword }
        : undefined
    }
    return null
  }

  const testSettingsSourceCredential = async (row: ExternalSourceRow) => {
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    if (!profile.credential) return null
    const pending = sourceEditCredentialPayload(row)
    if (pending === undefined) {
      setError('更新 DSM 凭据时请完整填写地址、用户名和密码。')
      return null
    }
    setBusy(`source-credential-test-${row.source.id}`)
    setError('')
    setNotice('')
    try {
      const result = pending
        ? await window.xdriveDesktop.agent.testSourceCredential(row.source.kind, pending)
        : await window.xdriveDesktop.agent.testStoredSourceCredential(row.source.id)
      if (!result.ok) {
        setSourceEditCredentialTest(null)
        setError(externalSourceCredentialTestErrorLabel(result.error.code || result.error.message, result.error.detail))
        return null
      }
      setSourceEditCredentialTest(result.data)
      setNotice(externalSourceCredentialTestSuccessLabel(result.data))
      return result.data
    } finally {
      setBusy('')
    }
  }

  const saveSourceSettings = async (event: FormEvent, row: ExternalSourceRow) => {
    event.preventDefault()
    const name = sourceEditName.trim()
    if (!name) {
      setError('来源名称不能为空。')
      return
    }
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    const pendingCredential = sourceEditCredentialPayload(row)
    if (pendingCredential === undefined) {
      setError('更新 DSM 凭据时请完整填写地址、用户名和密码。')
      return
    }
    if (profile.credential === 'synology_dsm' && sourceEditSpaces.length === 0) {
      setError('至少选择一个 Synology Photos 空间。')
      return
    }
    const busyKey = `source-settings-${row.source.id}`
    setBusy(busyKey)
    setError('')
    setNotice('')
    try {
      if (pendingCredential) {
        const tested = await window.xdriveDesktop.agent.testSourceCredential(row.source.kind, pendingCredential)
        if (!tested.ok) {
          setSourceEditCredentialTest(null)
          setError(externalSourceCredentialTestErrorLabel(tested.error.code || tested.error.message, tested.error.detail))
          return
        }
        setSourceEditCredentialTest(tested.data)
      }

      const updated = await window.xdriveDesktop.agent.updateSource(row.source.id, row.source.revision, {
        name,
        run_mode: sourceEditRunMode,
        status: pendingCredential && !row.credential?.configured ? 'paused' : sourceEditStatus,
        schedule_type: sourceEditScheduleType,
        schedule_expression: sourceEditScheduleType === 'manual' ? '' : sourceEditScheduleExpression.trim(),
        schedule_timezone: sourceEditScheduleType === 'cron' ? sourceEditScheduleTimezone.trim() : '',
        ignore_rules: sourceEditIgnoreRules,
      })
      if (!updated.ok) {
        setError(updated.error.message)
        return
      }

      if (profile.credential === 'synology_dsm') {
        let config = sourceEditConnectorConfig
        if (!config) {
          const loaded = await window.xdriveDesktop.agent.getSourceConnectorConfig(row.source.id)
          if (!loaded.ok) {
            setError(loaded.error.message)
            return
          }
          config = loaded.data
        }
        const currentSpaces = Array.isArray(config.payload.spaces)
          ? config.payload.spaces.filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
          : []
        if (currentSpaces.join(',') !== normalizeSynologyPhotoSpaces(sourceEditSpaces).join(',')) {
          const saved = await window.xdriveDesktop.agent.setSourceConnectorConfig(
            row.source.id,
            config.revision,
            { spaces: normalizeSynologyPhotoSpaces(sourceEditSpaces) },
          )
          if (!saved.ok) {
            setError(saved.error.message)
            return
          }
          setSourceEditConnectorConfig(saved.data)
        }
      }

      if (pendingCredential) {
        const credential = await window.xdriveDesktop.agent.setSourceCredential(row.source.id, pendingCredential)
        if (!credential.ok) {
          setError(`来源设置已保存，但${externalSourceCredentialLabel(profile)}更新失败：${externalSourceCredentialTestErrorLabel(credential.error.code || credential.error.message, credential.error.detail)}`)
          await loadSources()
          return
        }
      }

      if (pendingCredential && sourceEditStatus === 'paused') {
        const sourcesResult = await window.xdriveDesktop.agent.getSources()
        if (sourcesResult.ok) {
          const fresh = sourcesResult.data.find((source) => source.id === row.source.id)
          if (fresh && fresh.status !== 'paused') {
            const paused = await window.xdriveDesktop.agent.updateSource(fresh.id, fresh.revision, { status: 'paused' })
            if (!paused.ok) {
              setError(`凭据已更新，但重新暂停来源失败：${paused.error.message}`)
              await loadSources()
              return
            }
          }
        }
      }

      setEditingSourceID(null)
      setSourceEditCookie('')
      setSourceEditDsmBaseURL('')
      setSourceEditDsmUsername('')
      setSourceEditDsmPassword('')
      setSourceEditConnectorConfig(null)
      setNotice('来源设置已保存。')
      await loadSources()
    } finally {
      setBusy('')
    }
  }

  const clearSourceCookie = (row: ExternalSourceRow) => {
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    const label = externalSourceCredentialLabel(profile)
    requestConfirmation(
      `清除已保存的${label}？`,
      `清除“${row.source.name}”保存的${label}后，Pull 扫描将暂停，直到重新配置有效凭据。`,
      '清除凭据',
      async () => {
        const data = await run(
          `source-credential-delete-${row.source.id}`,
          () => window.xdriveDesktop.agent.deleteSourceCredential(row.source.id),
          `${label}已清除。`,
        )
        if (data) {
          setSourceEditCookie('')
          setSourceEditDsmBaseURL('')
          setSourceEditDsmUsername('')
          setSourceEditDsmPassword('')
          setSourceEditStatus('paused')
          await loadSources()
        }
      },
      'error',
    )
  }

  const deleteExternalSource = async () => {
    if (!sourceDeleteTarget) return
    const row = sourceDeleteTarget
    const data = await run(
      `source-delete-${row.source.id}`,
      () => window.xdriveDesktop.agent.deleteSource(row.source.id, row.source.revision),
      '来源已删除；已同步到 xDrive 的文件已保留。',
    )
    if (data) {
      if (selectedSourceID === row.source.id) setSelectedSourceID(null)
      if (editingSourceID === row.source.id) setEditingSourceID(null)
      setSourceDeleteTarget(null)
      await loadSources()
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
      const [treeResult, cacheResult] = await Promise.all([
        window.xdriveDesktop.agent.getStorageTree(),
        window.xdriveDesktop.agent.getCache(),
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

  const retryTransfer = async (id: string) => {
    const data = await run(`retry-transfer-${id}`, () => window.xdriveDesktop.agent.retryTransfer(id), '传输重试已完成。')
    if (data) setTransfers(data)
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

  const loadCloudDirectory = async (id: number, crumbs: AgentCloudCrumb[]) => {
    setBusy('cloud-directory')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudChildren(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudItems(result.data)
      setCloudCrumbs(crumbs)
      setCloudSearchActive(false)
      setCloudResults([])
      setCloudQuery('')
    } finally {
      setBusy('')
    }
  }

  const loadCloudHome = async () => {
    setBusy('cloud-load')
    setError('')
    try {
      const storageStatsSupported = agent.hello?.capabilities.includes('storage-intelligence') ?? false
      const [rootResult, quotaResult, storageStatsResult] = await Promise.all([
        window.xdriveDesktop.agent.cloudRoot(),
        window.xdriveDesktop.agent.cloudQuota(),
        storageStatsSupported ? window.xdriveDesktop.agent.cloudStorageStats() : Promise.resolve(null),
      ])
      if (!rootResult.ok) {
        setError(rootResult.error.message)
        return
      }
      if (!quotaResult.ok) {
        setError(quotaResult.error.message)
        return
      }
      if (storageStatsResult && !storageStatsResult.ok) {
        setCloudStorageStats(null)
      }
      const childrenResult = await window.xdriveDesktop.agent.cloudChildren(rootResult.data.id)
      if (!childrenResult.ok) {
        setError(childrenResult.error.message)
        return
      }
      setCloudRoot(rootResult.data)
      setCloudItems(childrenResult.data)
      setCloudCrumbs([{ id: rootResult.data.id, name: '我的文件' }])
      setCloudQuota(quotaResult.data)
      setCloudStorageStats(storageStatsResult?.ok ? storageStatsResult.data : null)
      setCloudSearchActive(false)
      setCloudResults([])
      setCloudQuery('')
    } finally {
      setBusy('')
    }
  }

  const searchCloud = async () => {
    const query = cloudQuery.trim()
    if (query.length < 2) {
      setError('搜索关键字至少需要 2 个字符。')
      return
    }
    setBusy('cloud-search')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudSearch(query)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudSearchActive(true)
      setCloudResults(result.data)
    } finally {
      setBusy('')
    }
  }

  const loadCloudTrash = async () => {
    setBusy('cloud-trash')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudTrash()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudTrash(result.data)
      setCloudTrashOpen(true)
    } finally {
      setBusy('')
    }
  }

  const restoreCloudTrash = async (node: AgentCloudNode) => {
    const data = await run('cloud-trash-restore', () => window.xdriveDesktop.agent.cloudRestoreTrash(node.id, node.revision), '项目已恢复。')
    if (!data) return
    await loadCloudTrash()
    await refreshCloudQuota()
    if (cloudCrumbs.length > 0) await loadCloudDirectory(cloudCrumbs.at(-1)!.id, cloudCrumbs)
  }

  const deleteCloudTrash = (node: AgentCloudNode) => {
    requestConfirmation(
      '永久删除项目？',
      `永久删除“${node.name}”也会删除已保存的历史版本，且无法撤销。`,
      '永久删除',
      async () => {
        const data = await run('cloud-trash-delete', () => window.xdriveDesktop.agent.cloudDeleteTrash(node.id, node.revision), '已永久删除。')
        if (!data) return
        await loadCloudTrash()
        await refreshCloudQuota()
      },
      'error',
    )
  }

  const openCloud历史版本 = async (node: AgentCloudNode, crumbs = cloudCrumbs) => {
    setBusy('cloud-history')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudVersions(node.id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudHistoryNode(node)
      setCloudHistoryCrumbs(crumbs)
      setCloudVersions(result.data)
    } finally {
      setBusy('')
    }
  }

  const restoreCloudVersion = (version: AgentCloudVersion) => {
    if (!cloudHistoryNode) return
    const historyNode = cloudHistoryNode
    requestConfirmation(
      '恢复历史版本？',
      `将“${historyNode.name}”恢复到版本 r${version.revision}。当前内容会先保留到历史版本中。`,
      '恢复版本',
      async () => {
        const restored = await run(
          'cloud-version-restore',
          () => window.xdriveDesktop.agent.cloudRestoreVersion(historyNode.id, historyNode.revision, version.id),
          '版本已恢复。',
        )
        if (!restored) return
        setCloudHistoryNode(restored)
        const versions = await window.xdriveDesktop.agent.cloudVersions(restored.id)
        if (versions.ok) setCloudVersions(versions.data)
        await refreshCloudQuota()
        if (cloudHistoryCrumbs.length > 0) {
          await loadCloudDirectory(cloudHistoryCrumbs.at(-1)!.id, cloudHistoryCrumbs)
        }
      },
      'warning',
    )
  }

  const openCloudShares = async (node: AgentCloudNode) => {
    setBusy('cloud-shares')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudShares(node.id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudShareNode(node)
      setCloudShares(result.data)
      setCreatedShareURL('')
      setShareExpiresDays('7')
      setSharePassword('')
      setShareMaxDownloads('0')
    } finally {
      setBusy('')
    }
  }

  const createCloudShare = async () => {
    if (!cloudShareNode) return
    const days = Number(shareExpiresDays)
    const maxDownloads = Number(shareMaxDownloads)
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      setError('分享有效期必须在 0 到 3650 天之间。')
      return
    }
    if (!Number.isSafeInteger(maxDownloads) || maxDownloads < 0) {
      setError('最大下载次数必须是非负整数。')
      return
    }
    if (sharePassword && sharePassword.length < 8) {
      setError('分享密码至少需要 8 个字符。')
      return
    }
    const expiresAt = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : undefined
    const created = await run(
      'cloud-share-create',
      () => window.xdriveDesktop.agent.cloudCreateShare(cloudShareNode.id, {
        expires_at: expiresAt,
        password: sharePassword,
        max_downloads: maxDownloads,
      }),
      '分享链接已创建。请立即复制，令牌只会显示一次。',
    )
    if (!created) return
    setCreatedShareURL(created.url)
    const shares = await window.xdriveDesktop.agent.cloudShares(cloudShareNode.id)
    if (shares.ok) setCloudShares(shares.data)
  }

  const revokeCloudShare = async (share: AgentCloudShare) => {
    const data = await run('cloud-share-revoke', () => window.xdriveDesktop.agent.cloudRevokeShare(share.id), '分享已撤销。')
    if (!data || !cloudShareNode) return
    const shares = await window.xdriveDesktop.agent.cloudShares(cloudShareNode.id)
    if (shares.ok) setCloudShares(shares.data)
  }

  const copyShareURL = async () => {
    if (!createdShareURL) return
    try {
      await navigator.clipboard.writeText(createdShareURL)
      setNotice('分享链接已复制。')
    } catch {
      setError('无法自动复制，请手动选择并复制链接。')
    }
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
      <Snackbar
        open={Boolean(error || notice)}
        autoHideDuration={error ? null : 4000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          dismissFeedback()
        }}
      >
        <MuiAlert
          severity={error ? 'error' : 'success'}
          variant="filled"
          onClose={dismissFeedback}
          sx={{ width: '100%', maxWidth: 520, alignItems: 'flex-start', boxShadow: 3 }}
        >
          {error || notice}
        </MuiAlert>
      </Snackbar>
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
    return renderDesktopFrame(
      <div className="center-shell">
        <form className="auth-panel auth-panel-form" onSubmit={login}>
          <p className="eyebrow">登录</p>
          <h1>{headline}</h1>
          <p className="subtitle">凭据会直接传递给 Go Agent，Electron 渲染进程不会接触 access token 或 refresh token。</p>
          <Stack className="auth-form" spacing={2}>
            <Autocomplete
              freeSolo
              size="small"
              options={serverOptions}
              inputValue={server}
              onInputChange={(_event, value, reason) => {
                if (reason !== 'reset') setServer(value)
              }}
              onChange={(_event, value) => {
                if (typeof value === 'string') selectLoginServer(value)
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  fullWidth
                  size="small"
                  label="服务器"
                  placeholder="https://drive.example.com"
                  required
                />
              )}
            />
            <Autocomplete
              freeSolo
              size="small"
              options={usernameOptions}
              inputValue={username}
              onInputChange={(_event, value, reason) => {
                if (reason !== 'reset') setUsername(value)
              }}
              onChange={(_event, value) => {
                if (typeof value === 'string') selectLoginUsername(value)
              }}
              renderInput={(params) => (
                <TextField {...params} fullWidth size="small" label="用户名" autoComplete="username" required />
              )}
            />
            <TextField
              fullWidth
              size="small"
              label="密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required={!savedPasswordAvailable}
              placeholder={savedPasswordAvailable ? '已保存密码（留空继续使用）' : undefined}
              helperText={savedPasswordAvailable ? '已找到此服务器和用户名对应的安全保存密码。' : undefined}
            />
            <MuiBox className="auth-folder-row">
              <TextField
                fullWidth
                size="small"
                label="同步文件夹（可选）"
                value={loginMount}
                onChange={(event) => setLoginMount(event.target.value)}
                placeholder="使用默认 xDrive 文件夹"
              />
              <XDriveActionButton
                className="auth-folder-button"
                compact
                onClick={() => void chooseDirectory(loginMount, setLoginMount)}
              >
                浏览
              </XDriveActionButton>
            </MuiBox>
            <MuiBox className="auth-options">
              <FormControlLabel
                className="auth-option"
                control={(
                  <Checkbox
                    size="small"
                    checked={rememberPassword}
                    disabled={!loginHistory.secure_password_storage}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setRememberPassword(checked)
                      if (!checked) setAutoLogin(false)
                    }}
                  />
                )}
                label="记住密码"
              />
              <FormControlLabel
                className="auth-option"
                control={(
                  <Checkbox
                    size="small"
                    checked={autoLogin}
                    disabled={!loginHistory.secure_password_storage || !rememberPassword}
                    onChange={(event) => setAutoLogin(event.target.checked)}
                  />
                )}
                label="自动登录"
              />
            </MuiBox>
            <MuiAlert
              className="auth-security-note"
              severity={loginHistory.secure_password_storage ? 'info' : 'warning'}
              variant="outlined"
            >
              {loginHistory.secure_password_storage
                ? '保存的密码由操作系统安全凭据能力加密，登录历史文件不保存密码明文。'
                : '当前系统没有可用的安全凭据存储，因此“记住密码”和“自动登录”已禁用。'}
            </MuiAlert>
            <XDriveActionButton
              className="auth-submit"
              fullWidth
              intent="primary"
              type="submit"
              loading={busy === 'login'}
              loadingLabel="正在登录…"
            >
              登录
            </XDriveActionButton>
          </Stack>
        </form>
      </div>
    )
  }

  if (status?.must_change_password) {
    return renderDesktopFrame(
      <div className="center-shell">
        <form className="auth-panel auth-panel-form" onSubmit={changePassword}>
          <p className="eyebrow">需要修改密码</p>
          <h1>{headline}</h1>
          <p className="subtitle">管理员要求先修改密码，之后才能开始同步。</p>
          <Stack className="auth-form" spacing={2}>
            <TextField
              fullWidth
              size="small"
              label="当前密码"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <TextField
              fullWidth
              size="small"
              label="新密码"
              type="password"
              inputProps={{ minLength: 8 }}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <TextField
              fullWidth
              size="small"
              label="确认新密码"
              type="password"
              inputProps={{ minLength: 8 }}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <XDriveActionButton
              className="auth-submit"
              fullWidth
              intent="primary"
              type="submit"
              loading={busy === 'password'}
              loadingLabel="正在更新…"
            >
              修改密码
            </XDriveActionButton>
          </Stack>
        </form>
      </div>
    )
  }

  const accountInitial = status?.username?.trim().slice(0, 1).toUpperCase() || '?'
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
        <IconButton className="desktop-titlebar-action" aria-label="设置" size="small" color={view === 'settings' ? 'primary' : 'default'} onClick={() => {
          setSyncMenuAnchor(null)
          setAccountMenuAnchor(null)
          setView('settings')
        }}>
          <SettingsRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={status?.username ? `${status.username} · 账户` : '账户'}>
        <IconButton className="desktop-titlebar-account-button" aria-label="账户菜单" size="small" onClick={(event) => {
          setSyncMenuAnchor(null)
          setAccountMenuAnchor(event.currentTarget)
        }}>
          <Avatar sx={{ width: 24, height: 24, fontSize: 12, fontWeight: 700 }}>{accountInitial}</Avatar>
        </IconButton>
      </Tooltip>

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

      <Menu id="desktop-account-menu" anchorEl={accountMenuAnchor} open={Boolean(accountMenuAnchor)} onClose={() => setAccountMenuAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MuiBox sx={{ minWidth: 250, maxWidth: 320, px: 2, py: 1.25 }}>
          <Typography variant="body2" fontWeight={700} noWrap>{status?.username || '已登录用户'}</Typography>
          <Typography variant="caption" color="text.secondary" component="div" noWrap>{status?.server || '服务器未提供'}</Typography>
          <Typography variant="caption" color="text.secondary">{status?.auth_status || '已登录'}</Typography>
        </MuiBox>
        <MuiDivider />
        <MenuItem onClick={() => {
          setAccountMenuAnchor(null)
          setView('settings')
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
      </Menu>
    </Stack>
  )

  return renderDesktopFrame(
    <div className="shell">
      <aside className="sidebar">
        <List component="nav" aria-label="桌面版功能区" disablePadding className="sidebar-nav">
          <ListItemButton className="sidebar-nav-item" selected={view === 'overview'} onClick={() => setView('overview')}>
            <ListItemIcon><DashboardRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="概览" />
          </ListItemButton>
          <ListItemButton className="sidebar-nav-item" selected={view === 'cloud'} onClick={() => setView('cloud')}>
            <ListItemIcon><FolderRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="文件" />
          </ListItemButton>
          <ListItemButton className="sidebar-nav-item" selected={view === 'gallery'} onClick={() => setView('gallery')}>
            <ListItemIcon><PhotoLibraryRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="图库" />
          </ListItemButton>
          <ListItemButton className="sidebar-nav-item" selected={view === 'sources'} onClick={() => setView('sources')}>
            <ListItemIcon><CloudSyncRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="外部来源" />
          </ListItemButton>
          <ListItemButton className="sidebar-nav-item" selected={view === 'transfers'} onClick={() => setView('transfers')}>
            <ListItemIcon><SwapVertRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="传输" />
            {activeTransfers.length ? <Chip className="sidebar-nav-badge" size="small" label={activeTransfers.length} /> : null}
          </ListItemButton>
          <ListItemButton className="sidebar-nav-item" selected={view === 'files'} onClick={() => setView('files')}>
            <ListItemIcon><StorageRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="存储" />
          </ListItemButton>
          <ListItemButton className="sidebar-nav-item" selected={view === 'conflicts'} onClick={() => setView('conflicts')}>
            <ListItemIcon><WarningAmberRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="冲突" />
            {status?.conflict_count ? <Chip className="sidebar-nav-badge" size="small" label={status.conflict_count} /> : null}
          </ListItemButton>
        </List>
        <List component="nav" aria-label="桌面版辅助功能" disablePadding className="sidebar-nav sidebar-secondary">
          <ListItemButton className="sidebar-nav-item" selected={view === 'diagnostics'} onClick={() => setView('diagnostics')}>
            <ListItemIcon><BuildRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="诊断" />
          </ListItemButton>
        </List>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">xDrive</p>
            <h1>{viewLabel(view)}</h1>
          </div>
        </header>

        {(status?.last_error || status?.paused || status?.has_conflict) ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
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
          <>
            <section className="status-grid">
              <article className="status-card"><span className={`status-dot ${status?.paused ? 'waiting' : 'ready'}`} /><div><strong>同步</strong><p>{status?.sync_status}</p></div></article>
              <article className="status-card"><span className={`status-dot ${status?.has_conflict ? 'warning' : 'ready'}`} /><div><strong>冲突</strong><p>{status?.conflict_count || 0} 个未解决</p></div></article>
              <article className="status-card"><span className="status-dot ready" /><div><strong>Agent</strong><p>{status?.auth_status} · v{agent.hello?.agent_version || status?.version} · IPC {agent.hello?.protocol_min ?? '?'}-{agent.hello?.protocol_max ?? '?'}</p></div></article>
              <article className="status-card"><span className="status-dot ready" /><div><strong>桌面桥接</strong><p>已通过受保护的本地 IPC 连接。</p></div></article>
            </section>

            <section className="system-card">
              <div className="section-heading">
                <div><p className="eyebrow">同步位置</p><h2>{status?.mount_path || '默认 xDrive 文件夹'}</h2></div>
                <XDriveActionButton
                  loading={busy === 'folder'}
                  loadingLabel="正在打开…"
                  onClick={() => void run('folder', () => window.xdriveDesktop.agent.openFolder())}
                >
                  打开
                </XDriveActionButton>
              </div>
              <dl>
                <div><dt>服务器</dt><dd>{status?.server}</dd></div>
                <div><dt>用户</dt><dd>{status?.username}</dd></div>
                <div><dt>状态</dt><dd>{status?.paused ? '已暂停' : status?.sync_status}</dd></div>
                <div><dt>修订号</dt><dd>{status?.revision}</dd></div>
              </dl>
            </section>
          </>
        )}



        {view === 'gallery' && (
          <section className="panel">
            <XDriveMediaGalleryPage
              source={mediaGallerySource}
              onError={(galleryError) => setError(
                galleryError instanceof Error ? galleryError.message : String(galleryError),
              )}
            />
          </section>
        )}

        {view === 'sources' && (
          <section className="panel source-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">外部来源</p>
                <h2>管理照片与媒体来源</h2>
                <p className="source-note">来源状态通过 xdrive-agent 的受保护本地 IPC 读取，渲染进程不会接触服务器令牌或已保存的来源凭据明文。</p>
              </div>
              <div className="source-heading-actions">
                <XDriveActionButton
                  disabled={!!busy}
                  loading={busy === 'sources'}
                  loadingLabel="正在刷新…"
                  onClick={() => void loadSources()}
                >
                  刷新
                </XDriveActionButton>
                <XDriveActionButton intent="primary" disabled={!!busy} onClick={() => void openSourceCreate()}>
                  + 添加来源
                </XDriveActionButton>
              </div>
            </div>

            {sourceCreateOpen && (
              <Dialog
                open={sourceCreateOpen}
                onClose={() => { if (!busy) setSourceCreateOpen(false) }}
                maxWidth="md"
                fullWidth
                scroll="paper"
                aria-label="添加外部来源"
                slotProps={{ paper: xDriveDialogPaperProps }}
              >
                <XDriveDialogTitle
                  title="添加外部来源"
                  subtitle={sourceCreateKind === 'yike_photos'
                    ? '一刻相册目标目录由服务器自动管理。'
                    : sourceCreateDirection === 'pull'
                      ? '群晖 Pull 由 xDrive Server 直接连接 DSM，并同步到选定目标文件夹。'
                      : '群晖 Push 由 DSM 上的 xdrive-source-agent 主动推送到选定目标文件夹。'}
                  onClose={() => setSourceCreateOpen(false)}
                  closeDisabled={!!busy}
                />
                <XDriveDialogContent dividers>
                  <form id="source-create-form" className="source-create modal-form-surface" onSubmit={(event) => void createExternalSource(event)}>
                <div className="source-create-grid">
                  <label>
                    <span>来源类型</span>
                    <select value={sourceCreatePreset} onChange={(event) => changeSourceCreatePreset(event.target.value as ExternalSourceCreatePreset)}>
                      {externalSourceCreateOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <small>{sourceCreateOption.description}</small>
                  </label>
                  <label>
                    <span>名称</span>
                    <input value={sourceCreateName} onChange={(event) => setSourceCreateName(event.target.value)} maxLength={128} required />
                  </label>
                  <label>
                    <span>运行模式</span>
                    <select value={sourceCreateRunMode} onChange={(event) => setSourceCreateRunMode(event.target.value as 'scan' | 'sync')}>
                      <option value="scan">仅扫描</option>
                      <option value="sync">同步</option>
                    </select>
                  </label>
                </div>

                <MuiBox sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 1fr' }, gap: 1.5, mb: 1.5 }}>
                  <TextField select size="small" label="调度方式" value={sourceCreateScheduleType} onChange={(event) => setSourceCreateScheduleType(event.target.value as ExternalSourceScheduleType)}>
                    <MenuItem value="interval">固定间隔</MenuItem>
                    <MenuItem value="cron">Cron</MenuItem>
                    <MenuItem value="manual">仅手动</MenuItem>
                  </TextField>
                  {sourceCreateScheduleType !== 'manual' && (
                    <TextField size="small" label={sourceCreateScheduleType === 'cron' ? 'Cron 表达式' : '运行间隔'} value={sourceCreateScheduleExpression} onChange={(event) => setSourceCreateScheduleExpression(event.target.value)} helperText={sourceCreateScheduleType === 'cron' ? '标准 5 段，例如：0 3 * * *' : '例如：30m、6h、24h'} />
                  )}
                  {sourceCreateScheduleType === 'cron' && (
                    <TextField size="small" label="时区" value={sourceCreateScheduleTimezone} onChange={(event) => setSourceCreateScheduleTimezone(event.target.value)} helperText="IANA 时区，例如 Asia/Shanghai" sx={{ gridColumn: { md: '2 / 3' } }} />
                  )}
                </MuiBox>

                {sourceCreateKind === 'yike_photos' ? (
                  <XDriveStatusAlert tone="neutral" sx={{ mb: 1.5 }}>
                    固定逻辑目录：{yikeManagedTargetLabel}。连接成功后自动创建；底层文件仍使用 xDrive CAS 存储。
                  </XDriveStatusAlert>
                ) : (
                <div className="source-target">
                  <div className="source-target-heading">
                    <div>
                      <strong>目标文件夹</strong>
                      <span>当前选择：{sourceTargetCrumbs.map((crumb) => crumb.name).join(' / ') || '正在加载…'}</span>
                    </div>
                    {sourceTargetLoading && <span>正在加载…</span>}
                  </div>
                  <div className="source-target-crumbs">
                    {sourceTargetCrumbs.map((crumb, index) => (
                      <button
                        key={crumb.id}
                        type="button"
                        disabled={sourceTargetLoading || index === sourceTargetCrumbs.length - 1}
                        onClick={() => void loadSourceTargetDirectory(crumb.id, sourceTargetCrumbs.slice(0, index + 1))}
                      >
                        {crumb.name}
                      </button>
                    ))}
                  </div>
                  <div className="source-target-list">
                    {sourceTargetDirectories.length === 0 ? (
                      <span className="source-target-empty">当前目录下没有子文件夹，可直接使用当前目录。</span>
                    ) : sourceTargetDirectories.map((directory) => (
                      <button
                        className="source-target-folder"
                        key={directory.id}
                        type="button"
                        disabled={sourceTargetLoading}
                        onClick={() => void loadSourceTargetDirectory(directory.id, [...sourceTargetCrumbs, { id: directory.id, name: directory.name }])}
                      >
                        <strong>{directory.name}</strong>
                        <span>进入文件夹 ›</span>
                      </button>
                    ))}
                  </div>
                </div>
                )}

                <label className="source-create-wide">
                  <span>忽略规则</span>
                  <textarea
                    value={sourceCreateIgnoreRules}
                    onChange={(event) => setSourceCreateIgnoreRules(event.target.value)}
                    rows={5}
                    spellCheck={false}
                    placeholder="每行一条 gitignore 风格规则"
                  />
                </label>
                {sourceCreateProfile.credential === 'cookie' && (
                  <label className="source-create-wide">
                    <span>一刻相册 Cookie</span>
                    <input
                      type="password"
                      value={sourceCreateCookie}
                      onChange={(event) => {
                        setSourceCreateCookie(event.target.value)
                        setSourceCreateCredentialTest(null)
                      }}
                      autoComplete="off"
                      placeholder="粘贴已登录的一刻相册 Web Cookie"
                      required
                    />
                    <small>Cookie 仅通过受保护 IPC 发送到服务器并加密保存，不会回读明文。</small>
                    <XDriveStatusAlert tone="warning" sx={{ mt: 0.5 }}>{yikeConnectorNotice}</XDriveStatusAlert>
                    <XDriveStatusAlert tone="neutral" sx={{ mt: 0.5 }}>{yikeRateLimitNotice}</XDriveStatusAlert>
                    <XDriveYikeCookieHelp variant="dialog" />
                    <MuiBox component="span" sx={{ alignSelf: 'flex-start', mt: 0.5 }}>
                      <XDriveActionButton
                        compact
                        disabled={!!busy}
                        loading={busy === 'source-create-test'}
                        loadingLabel="正在测试…"
                        onClick={() => void testCreateSourceCredential()}
                      >
                        测试连接
                      </XDriveActionButton>
                    </MuiBox>
                    {sourceCreateCredentialTest && (
                      <XDriveStatusAlert tone="good" sx={{ mt: 0.5 }}>
                        {externalSourceCredentialTestSuccessLabel(sourceCreateCredentialTest)}
                      </XDriveStatusAlert>
                    )}
                  </label>
                )}
                {sourceCreateProfile.credential === 'synology_dsm' && (
                  <>
                    <MuiDivider className="source-create-wide" />
                    <label className="source-create-wide">
                      <span>DSM 地址</span>
                      <input
                        value={sourceCreateDsmBaseURL}
                        onChange={(event) => {
                          setSourceCreateDsmBaseURL(event.target.value)
                          setSourceCreateCredentialTest(null)
                        }}
                        autoComplete="off"
                        placeholder="https://nas.example.com:5001"
                        required
                      />
                      <small>{synologyDsmAddressHelp}</small>
                    </label>
                    <label>
                      <span>DSM 用户名</span>
                      <input
                        value={sourceCreateDsmUsername}
                        onChange={(event) => {
                          setSourceCreateDsmUsername(event.target.value)
                          setSourceCreateCredentialTest(null)
                        }}
                        autoComplete="username"
                        required
                      />
                    </label>
                    <label>
                      <span>DSM 密码</span>
                      <input
                        type="password"
                        value={sourceCreateDsmPassword}
                        onChange={(event) => {
                          setSourceCreateDsmPassword(event.target.value)
                          setSourceCreateCredentialTest(null)
                        }}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                    <div className="source-create-wide">
                      <span>同步空间</span>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {synologyPhotoSpaceOptions.map((option) => (
                          <FormControlLabel
                            key={option.value}
                            control={(
                              <Checkbox
                                checked={sourceCreateSpaces.includes(option.value)}
                                onChange={(event) => setSourceCreateSpaces((current) => event.target.checked
                                  ? Array.from(new Set([...current, option.value]))
                                  : current.filter((space) => space !== option.value))}
                              />
                            )}
                            label={option.label}
                          />
                        ))}
                      </Stack>
                    </div>
                    <XDriveStatusAlert tone="neutral" className="source-create-wide">
                      DSM 凭据只会在服务器端加密保存；Pull worker 通过 Synology Photos API 只读发现和下载媒体，不会删除 NAS 中的照片。
                    </XDriveStatusAlert>
                    <MuiBox component="span" sx={{ alignSelf: 'flex-start' }}>
                      <XDriveActionButton
                        compact
                        disabled={!!busy}
                        loading={busy === 'source-create-test'}
                        loadingLabel="正在测试…"
                        onClick={() => void testCreateSourceCredential()}
                      >
                        测试连接
                      </XDriveActionButton>
                    </MuiBox>
                    {sourceCreateCredentialTest && (
                      <XDriveStatusAlert tone="good" className="source-create-wide">
                        {externalSourceCredentialTestSuccessLabel(sourceCreateCredentialTest)}
                      </XDriveStatusAlert>
                    )}
                  </>
                )}
                {sourceCreateProfile.manualTriggerExecutor === 'source_agent' && (
                  <XDriveStatusAlert tone="warning" className="source-create-note">
                    创建 Source 后，还需要在群晖 DSM 上配置 xdrive-source-agent；NAS 始终主动发起 Push 连接。
                  </XDriveStatusAlert>
                )}
                  </form>
                </XDriveDialogContent>
                <XDriveDialogActions>
                  <XDriveActionButton disabled={!!busy} onClick={() => setSourceCreateOpen(false)}>取消</XDriveActionButton>
                  <XDriveActionButton
                    intent="primary"
                    type="submit"
                    form="source-create-form"
                    disabled={!!busy || (sourceCreateKind !== 'yike_photos' && sourceTargetLoading)}
                    loading={busy === 'source-create'}
                    loadingLabel="正在添加…"
                  >
                    添加来源
                  </XDriveActionButton>
                </XDriveDialogActions>
              </Dialog>
            )}

            {sources.length === 0 && busy !== 'sources' ? (
              <XDriveStatePanel message="尚未添加外部来源。" />
            ) : (
              <div className="source-list">
                {sources.map((row) => {
                  const card = externalSourceCardView(row)
                  const detail = externalSourceDetailView(row)
                  const failedItems = sourceFailedItemsSourceID === row.source.id ? sourceFailedItems : []
                  return (
                    <article className="source-card" key={row.source.id}>
                      <div className="source-card-header">
                        <div className="source-title">
                          <strong>{row.source.name}</strong>
                          <span>{card.modeLabel}</span>
                        </div>
                        <XDriveStatusBadge tone={card.state.tone} label={card.state.label} />
                      </div>
                      <div className="source-card-meta">
                        <span>{card.lastActivityLabel}：{formatExternalSourceTime(card.lastActivityAt)}</span>
                        <span>
                          {card.scannedItems === undefined || card.scannedBytes === undefined
                            ? '尚无扫描统计'
                            : `${card.scannedItems.toLocaleString('zh-CN')} 项 · ${formatBinarySize(card.scannedBytes)}${card.failedItems ? ` · 失败 ${card.failedItems}` : ''}`}
                        </span>
                      </div>
                      {row.source.last_error && !row.source.run_requested_at && row.latestRun?.status !== 'running' && <div className="source-error">{row.source.last_error}</div>}
                      <div className="source-card-actions">
                        <XDriveActionButton
                          compact
                          disabled={sourceFailedItemsLoadingID !== null}
                          loading={sourceFailedItemsLoadingID === row.source.id}
                          loadingLabel="正在检查…"
                          onClick={() => void toggleSourceDetails(row)}
                        >
                          {selectedSourceID === row.source.id ? '收起' : '查看'}
                        </XDriveActionButton>
                        {card.connector.manualTriggerExecutor === 'source_agent' && (
                          <XDriveActionButton compact disabled={!!busy} onClick={() => setSynologyGuideSource(row.source)}>
                            DSM 配置
                          </XDriveActionButton>
                        )}
                        <XDriveActionButton
                          compact
                          title={card.trigger.label}
                          disabled={!!busy || !card.trigger.ready}
                          loading={busy === `source-trigger-${row.source.id}`}
                          loadingLabel="正在请求…"
                          onClick={() => void triggerSourceNow(row)}
                        >
                          {externalSourceTriggerActionLabel(row)}
                        </XDriveActionButton>
                        {row.latestRun?.status === 'running' && (
                          <XDriveActionButton
                            compact
                            intent="warning"
                            disabled={!!busy || Boolean(row.latestRun.cancel_requested_at)}
                            loading={Boolean(row.latestRun.cancel_requested_at) || busy === `source-cancel-${row.latestRun.id}`}
                            loadingLabel="正在取消…"
                            onClick={() => void cancelSourceRunNow(row)}
                          >
                            停止
                          </XDriveActionButton>
                        )}
                        <XDriveActionButton
                          compact
                          disabled={!!busy}
                          onClick={() => editingSourceID === row.source.id
                            ? setEditingSourceID(null)
                            : openSourceSettings(row)}
                        >
                          {editingSourceID === row.source.id ? '取消设置' : '设置'}
                        </XDriveActionButton>
                      </div>
                      {editingSourceID === row.source.id && (
                        <Dialog
                          open={editingSourceID === row.source.id}
                          onClose={() => { if (!busy) setEditingSourceID(null) }}
                          maxWidth="md"
                          fullWidth
                          scroll="paper"
                          aria-label="来源设置"
                          slotProps={{ paper: xDriveDialogPaperProps }}
                        >
                          <XDriveDialogTitle
                            title="来源设置"
                            subtitle={`${row.source.name} · 目标节点：${row.source.target_node_id ? `#${row.source.target_node_id}` : '未配置'}`}
                            onClose={() => setEditingSourceID(null)}
                            closeDisabled={!!busy}
                          />
                          <XDriveDialogContent dividers>
                            <form id={`source-settings-form-${row.source.id}`} className="source-settings modal-form-surface" onSubmit={(event) => void saveSourceSettings(event, row)}>
                          <div className="source-settings-grid">
                            <label>
                              <span>名称</span>
                              <input value={sourceEditName} onChange={(event) => setSourceEditName(event.target.value)} maxLength={128} required />
                            </label>
                            <label>
                              <span>运行模式</span>
                              <select value={sourceEditRunMode} onChange={(event) => setSourceEditRunMode(event.target.value as 'scan' | 'sync')}>
                                <option value="scan">仅扫描</option>
                                <option value="sync">同步</option>
                              </select>
                            </label>
                            <label>
                              <span>状态</span>
                              <select value={sourceEditStatus} onChange={(event) => setSourceEditStatus(event.target.value as 'active' | 'paused')}>
                                <option value="active">启用</option>
                                <option value="paused">暂停</option>
                              </select>
                            </label>
                          </div>
                          <MuiBox sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 1fr' }, gap: 1.5, mb: 1.5 }}>
                            <TextField select size="small" label="调度方式" value={sourceEditScheduleType} onChange={(event) => setSourceEditScheduleType(event.target.value as ExternalSourceScheduleType)}>
                              <MenuItem value="interval">固定间隔</MenuItem>
                              <MenuItem value="cron">Cron</MenuItem>
                              <MenuItem value="manual">仅手动</MenuItem>
                            </TextField>
                            {sourceEditScheduleType !== 'manual' && (
                              <TextField size="small" label={sourceEditScheduleType === 'cron' ? 'Cron 表达式' : '运行间隔'} value={sourceEditScheduleExpression} onChange={(event) => setSourceEditScheduleExpression(event.target.value)} helperText={sourceEditScheduleType === 'cron' ? '标准 5 段，例如：0 3 * * *' : '例如：30m、6h、24h'} />
                            )}
                            {sourceEditScheduleType === 'cron' && (
                              <TextField size="small" label="时区" value={sourceEditScheduleTimezone} onChange={(event) => setSourceEditScheduleTimezone(event.target.value)} helperText="IANA 时区，例如 Asia/Shanghai" sx={{ gridColumn: { md: '2 / 3' } }} />
                            )}
                          </MuiBox>
                          <label className="source-settings-wide">
                            <span>忽略规则</span>
                            <textarea
                              value={sourceEditIgnoreRules}
                              onChange={(event) => setSourceEditIgnoreRules(event.target.value)}
                              rows={5}
                              spellCheck={false}
                              placeholder="每行一条 gitignore 风格规则"
                            />
                          </label>
                          {externalSourceConnectorProfile(row.source.kind, row.source.direction).credential === 'cookie' && (
                            <label className="source-settings-wide">
                              <span>一刻相册 Cookie</span>
                              <input
                                type="password"
                                value={sourceEditCookie}
                                onFocus={() => {
                                  if (isExternalSourceSavedCredentialMask(sourceEditCookie)) {
                                    setSourceEditCookie('')
                                  }
                                }}
                                onChange={(event) => {
                                  setSourceEditCookie(event.target.value)
                                  setSourceEditCredentialTest(null)
                                }}
                                autoComplete="off"
                                placeholder={row.credential?.configured ? externalSourceSavedCredentialMask : '当前未配置，请粘贴 Cookie'}
                              />
                              <small>
                                {row.credential?.configured
                                  ? '当前已保存的 Cookie 以遮罩显示；点击输入框即可替换。不修改直接保存会保留原值。'
                                  : '当前未配置 Cookie，请粘贴新的 Cookie。'}
                              </small>
                              <XDriveStatusAlert tone="neutral" sx={{ mt: 0.5 }}>{yikeRateLimitNotice}</XDriveStatusAlert>
                              <XDriveYikeCookieHelp variant="dialog" />
                              <MuiBox component="span" sx={{ alignSelf: 'flex-start', mt: 0.5 }}>
                                <XDriveActionButton
                                  compact
                                  disabled={!!busy}
                                  loading={busy === `source-credential-test-${row.source.id}`}
                                  loadingLabel="正在测试…"
                                  onClick={() => void testSettingsSourceCredential(row)}
                                >
                                  测试连接
                                </XDriveActionButton>
                              </MuiBox>
                              {sourceEditCredentialTest && (
                                <XDriveStatusAlert tone="good" sx={{ mt: 0.5 }}>
                                  {externalSourceCredentialTestSuccessLabel(sourceEditCredentialTest)}
                                </XDriveStatusAlert>
                              )}
                            </label>
                          )}
                          {externalSourceConnectorProfile(row.source.kind, row.source.direction).credential === 'synology_dsm' && (
                            <>
                              <MuiDivider className="source-settings-wide" />
                              <XDriveStatusAlert tone={row.credential?.configured ? 'good' : 'warning'} className="source-settings-wide">
                                {row.credential?.configured
                                  ? 'DSM 凭据已配置。出于安全原因，地址、用户名和密码不会回读；更新时请重新完整填写三项。'
                                  : 'DSM 凭据未配置；Pull 来源会保持暂停，直到保存有效凭据。'}
                              </XDriveStatusAlert>
                              <label className="source-settings-wide">
                                <span>更新 DSM 地址</span>
                                <input
                                  value={sourceEditDsmBaseURL}
                                  onChange={(event) => {
                                    setSourceEditDsmBaseURL(event.target.value)
                                    setSourceEditCredentialTest(null)
                                  }}
                                  autoComplete="off"
                                  placeholder="留空则保持当前配置不变"
                                />
                                <small>{synologyDsmAddressHelp}</small>
                              </label>
                              <label>
                                <span>更新 DSM 用户名</span>
                                <input
                                  value={sourceEditDsmUsername}
                                  onChange={(event) => {
                                    setSourceEditDsmUsername(event.target.value)
                                    setSourceEditCredentialTest(null)
                                  }}
                                  autoComplete="username"
                                  placeholder="留空则保持当前配置不变"
                                />
                              </label>
                              <label>
                                <span>更新 DSM 密码</span>
                                <input
                                  type="password"
                                  value={sourceEditDsmPassword}
                                  onChange={(event) => {
                                    setSourceEditDsmPassword(event.target.value)
                                    setSourceEditCredentialTest(null)
                                  }}
                                  autoComplete="new-password"
                                  placeholder="留空则保持当前配置不变"
                                />
                              </label>
                              <div className="source-settings-wide">
                                <span>同步空间</span>
                                <Stack direction="row" spacing={1} flexWrap="wrap">
                                  {synologyPhotoSpaceOptions.map((option) => (
                                    <FormControlLabel
                                      key={option.value}
                                      control={(
                                        <Checkbox
                                          checked={sourceEditSpaces.includes(option.value)}
                                          onChange={(event) => setSourceEditSpaces((current) => event.target.checked
                                            ? Array.from(new Set([...current, option.value]))
                                            : current.filter((space) => space !== option.value))}
                                        />
                                      )}
                                      label={option.label}
                                    />
                                  ))}
                                </Stack>
                                {!sourceEditConnectorConfig && <small>正在读取当前空间配置；默认使用个人空间和共享空间。</small>}
                              </div>
                              <MuiBox component="span" sx={{ alignSelf: 'flex-start' }}>
                                <XDriveActionButton
                                  compact
                                  disabled={!!busy}
                                  loading={busy === `source-credential-test-${row.source.id}`}
                                  loadingLabel="正在测试…"
                                  onClick={() => void testSettingsSourceCredential(row)}
                                >
                                  测试连接
                                </XDriveActionButton>
                              </MuiBox>
                              {sourceEditCredentialTest && (
                                <XDriveStatusAlert tone="good" className="source-settings-wide">
                                  {externalSourceCredentialTestSuccessLabel(sourceEditCredentialTest)}
                                </XDriveStatusAlert>
                              )}
                            </>
                          )}
                            </form>
                          </XDriveDialogContent>
                          <XDriveDialogActions>
                            {externalSourceConnectorProfile(row.source.kind, row.source.direction).credential && row.credential?.configured && (
                              <XDriveActionButton intent="danger" disabled={!!busy} onClick={() => void clearSourceCookie(row)}>
                                清除{externalSourceCredentialLabel(externalSourceConnectorProfile(row.source.kind, row.source.direction))}
                              </XDriveActionButton>
                            )}
                            <XDriveActionButton
                              intent="danger"
                              disabled={!!busy || row.latestRun?.status === 'running'}
                              onClick={() => setSourceDeleteTarget(row)}
                            >
                              删除来源
                            </XDriveActionButton>
                            <XDriveDialogActionSpacer />
                            <XDriveActionButton disabled={!!busy} onClick={() => setEditingSourceID(null)}>取消</XDriveActionButton>
                            <XDriveActionButton
                              intent="primary"
                              type="submit"
                              form={`source-settings-form-${row.source.id}`}
                              disabled={!!busy}
                              loading={busy === `source-settings-${row.source.id}`}
                              loadingLabel="正在保存…"
                            >
                              保存设置
                            </XDriveActionButton>
                          </XDriveDialogActions>
                        </Dialog>
                      )}
                      {selectedSourceID === row.source.id && (
                        <div className="source-detail">
                          <div className="source-detail-grid">
                            <div><span>来源类型</span><strong>{detail.kindLabel}</strong></div>
                            <div><span>工作方式</span><strong>{detail.modeLabel}</strong></div>
                            <div><span>状态</span><strong>{detail.state.label}</strong></div>
                            <div>
                              <span>目标目录</span>
                              <strong>{row.source.kind === 'yike_photos' ? yikeManagedTargetLabel : (detail.targetNodeID ? `#${detail.targetNodeID}` : '未配置')}</strong>
                            </div>
                            <div><span>调度</span><strong>{detail.scheduleLabel}</strong></div>
                            <div><span>上次运行</span><strong>{formatExternalSourceTime(detail.lastRunAt)}</strong></div>
                            <div><span>上次成功</span><strong>{formatExternalSourceTime(detail.lastSuccessAt)}</strong></div>
                            {detail.credential && (
                              <div><span>{detail.credential.label}</span><strong>{detail.credential.configured ? '已配置' : '未配置'}</strong></div>
                            )}
                            <div><span>配置修订号</span><strong>{detail.revision}</strong></div>
                          </div>
                          {detail.ignoreRules && (
                            <div className="source-ignore">
                              <span>忽略规则</span>
                              <pre>{detail.ignoreRules}</pre>
                            </div>
                          )}
                          <div className="source-run-detail">
                            <div className="source-run-heading">
                              <strong>相册与集合</strong>
                              <span>
                                {sourceCollectionsSourceID === row.source.id
                                  ? sourceCollections.length.toLocaleString('zh-CN') + ' 个'
                                  : '正在读取…'}
                              </span>
                            </div>
                            {sourceCollectionsLoadingID === row.source.id ? (
                              <XDriveStatePanel loading message="正在加载相册/集合…" />
                            ) : sourceCollectionsSourceID !== row.source.id || sourceCollections.length === 0 ? (
                              <XDriveStatePanel message="该来源暂无相册/集合元数据。" />
                            ) : (
                              <Stack spacing={1}>
                                {sourceCollections.map((collection) => {
                                  const page = sourceCollectionItemPages[collection.id]
                                  return (
                                    <MuiBox
                                      key={collection.id}
                                      component="details"
                                      onToggle={(event) => {
                                        const details = event.currentTarget as HTMLDetailsElement
                                        if (details.open && !page?.loaded && !page?.loading) {
                                          void loadSourceCollectionItems(row.source.id, collection.id, 1)
                                        }
                                      }}
                                      sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
                                    >
                                      <MuiBox component="summary" sx={{ cursor: 'pointer', p: 1.25 }}>
                                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ width: '100%', pr: 1 }}>
                                          <MuiBox>
                                            <Typography variant="body2" fontWeight={700}>{collection.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                              {externalSourceCollectionKindLabel(collection.kind)} · {collection.item_count.toLocaleString('zh-CN')} 项 · 上次发现 {formatExternalSourceTime(collection.last_seen_at)}
                                            </Typography>
                                          </MuiBox>
                                          <XDriveStatusBadge tone={externalSourceCollectionStateTone(collection.state)} label={externalSourceCollectionStateLabel(collection.state)} />
                                        </Stack>
                                      </MuiBox>
                                      <MuiBox sx={{ px: 1.5, pb: 1.5 }}>
                                        {page?.loading && !page.loaded ? (
                                          <XDriveStatePanel loading message="正在加载集合成员…" />
                                        ) : page?.loaded && page.items.length > 0 ? (
                                          <Stack spacing={0.75}>
                                            {page.items.map((item) => (
                                              <MuiBox key={item.external_id} sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.75} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                                                  <MuiBox sx={{ minWidth: 0 }}>
                                                    <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                                                      {item.path || item.external_id}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                                                      {item.metadata?.captured_at ? '拍摄 ' + formatExternalSourceTime(item.metadata.captured_at) + ' · ' : ''}
                                                      {formatBinarySize(item.size)}
                                                      {item.metadata?.original_path ? ' · 原始路径 ' + item.metadata.original_path : ''}
                                                    </Typography>
                                                  </MuiBox>
                                                  <XDriveStatusBadge
                                                    tone={item.state === 'synced' ? 'good' : item.state === 'error' ? 'bad' : item.state === 'missing' ? 'warning' : 'neutral'}
                                                    label={item.state === 'synced' ? '已同步' : item.state === 'missing' ? '远端缺失' : item.state === 'error' ? '失败' : item.state}
                                                  />
                                                </Stack>
                                              </MuiBox>
                                            ))}
                                            <XDrivePaginationControls
                                              page={page.page}
                                              pageSize={SOURCE_COLLECTION_ITEM_PAGE_SIZE}
                                              hasNext={page.hasNext}
                                              loading={page.loading}
                                              labelPrefix="成员"
                                              onPrevious={() => void loadSourceCollectionItems(row.source.id, collection.id, page.page - 1)}
                                              onNext={() => void loadSourceCollectionItems(row.source.id, collection.id, page.page + 1)}
                                            />
                                          </Stack>
                                        ) : page?.loaded ? (
                                          <XDriveStatePanel message="该集合暂无成员。" />
                                        ) : (
                                          <Typography variant="caption" color="text.secondary">展开后加载成员。</Typography>
                                        )}
                                      </MuiBox>
                                    </MuiBox>
                                  )
                                })}
                              </Stack>
                            )}
                          </div>

                          <div className="source-run-detail">
                            <div className="source-run-heading">
                              <strong>同步历史</strong>
                            </div>
                            {sourceHistoryLoading && sourceHistoryRuns.length === 0 ? (
                              <Typography variant="caption" color="text.secondary">正在加载运行历史…</Typography>
                            ) : sourceHistoryRuns.length === 0 ? (
                              <Typography variant="caption" color="text.secondary">尚无运行记录</Typography>
                            ) : (
                              <Stack spacing={1}>
                                {sourceHistoryRuns.map((run) => {
                                  const historyDetail = externalSourceRunDetailView(run)
                                  const canCancel = run.status === 'running' && row.latestRun?.id === run.id
                                  const failurePage = sourceRunFailurePages[run.id]
                                  return (
                                    <MuiBox
                                      key={run.id}
                                      component="details"
                                      onToggle={(event) => {
                                        const details = event.currentTarget as HTMLDetailsElement
                                        if (details.open && run.failed_items > 0 && !failurePage?.loaded && !failurePage?.loading) {
                                          void loadSourceRunFailures(row.source.id, run.id, 1)
                                        }
                                      }}
                                      sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
                                    >
                                      <MuiBox component="summary" sx={{ cursor: 'pointer', p: 1.25 }}>
                                        <XDriveSourceRunSummary
                                          runNumber={run.run_number}
                                          detail={historyDetail}
                                          wideAt="md"
                                        />
                                      </MuiBox>
                                      <MuiBox sx={{ px: 1.5, pb: 1.5 }}>
                                        {historyDetail.progress && (
                                          <XDriveSourceRunProgress
                                            progress={historyDetail.progress}
                                            canCancel={canCancel}
                                            cancelDisabled={!!busy}
                                            cancelLoading={busy === 'source-cancel-' + run.id}
                                            onCancel={() => void cancelSourceRunNow(row)}
                                          />
                                        )}
                                        <div className="source-run-grid">
                                          <div><span>运行 ID</span><strong>{run.id}</strong></div>
                                          <div><span>运行状态</span><XDriveStatusBadge tone={historyDetail.statusTone} label={historyDetail.statusLabel} /></div>
                                          <div><span>触发方式</span><strong>{historyDetail.triggerLabel}</strong></div>
                                          <div><span>耗时</span><strong>{historyDetail.durationLabel}</strong></div>
                                          <div><span>开始时间</span><strong>{formatExternalSourceTime(historyDetail.startedAt)}</strong></div>
                                          <div><span>结束时间</span><strong>{historyDetail.finishedAt ? formatExternalSourceTime(historyDetail.finishedAt) : '进行中'}</strong></div>
                                          <div><span>成功项</span><strong>{historyDetail.successItems.toLocaleString('zh-CN')} 项</strong></div>
                                          <div><span>失败项</span><strong>{historyDetail.failedItems.toLocaleString('zh-CN')} 项</strong></div>
                                          {historyDetail.metrics.map((metric) => (
                                            <div key={metric.key}>
                                              <span>{metric.label}</span>
                                              <strong>
                                                {metric.items.toLocaleString('zh-CN')} 项
                                                {metric.bytes === undefined ? '' : ' · ' + formatBinarySize(metric.bytes)}
                                              </strong>
                                            </div>
                                          ))}
                                        </div>
                                        <XDriveStatusAlert tone={historyDetail.error ? 'bad' : 'good'} sx={{ mt: 1.25 }}>
                                          运行日志：{historyDetail.error || '无错误日志'}
                                        </XDriveStatusAlert>
                                        {historyDetail.failedItems > 0 && (
                                          <MuiBox sx={{ mt: 1.25 }}>
                                            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.75 }}>本次失败文件</Typography>
                                            {failurePage?.loading && !failurePage.loaded ? (
                                              <Typography variant="caption" color="text.secondary">正在加载失败文件…</Typography>
                                            ) : failurePage?.loaded && failurePage.items.length > 0 ? (
                                              <Stack spacing={0.75}>
                                                {failurePage.items.map((failure) => (
                                                  <XDriveSourceFailureItem
                                                    key={failure.id}
                                                    compact
                                                    title={failure.path || failure.external_id}
                                                    externalID={failure.external_id}
                                                    sizeLabel={formatBinarySize(failure.size)}
                                                    failedAt={failure.failed_at}
                                                    error={failure.error}
                                                  />
                                                ))}
                                                <XDrivePaginationControls
                                                  page={failurePage.page}
                                                  pageSize={SOURCE_RUN_FAILURE_PAGE_SIZE}
                                                  hasNext={failurePage.hasNext}
                                                  loading={failurePage.loading}
                                                  labelPrefix="失败项"
                                                  onPrevious={() => void loadSourceRunFailures(row.source.id, run.id, failurePage.page - 1)}
                                                  onNext={() => void loadSourceRunFailures(row.source.id, run.id, failurePage.page + 1)}
                                                />
                                              </Stack>
                                            ) : failurePage?.loaded ? (
                                              <XDriveStatusAlert tone="warning">
                                                该历史 Run 记录了 {historyDetail.failedItems.toLocaleString('zh-CN')} 个失败项，但没有可恢复的逐文件失败快照。
                                              </XDriveStatusAlert>
                                            ) : (
                                              <Typography variant="caption" color="text.secondary">展开后加载本次失败文件明细。</Typography>
                                            )}
                                          </MuiBox>
                                        )}
                                      </MuiBox>
                                    </MuiBox>
                                  )
                                })}
                                <XDrivePaginationControls
                                  page={sourceHistoryPage}
                                  pageSize={SOURCE_HISTORY_PAGE_SIZE}
                                  hasNext={sourceHistoryHasNext}
                                  loading={sourceHistoryLoading}
                                  onPrevious={() => void loadSourceHistory(row.source.id, sourceHistoryPage - 1)}
                                  onNext={() => void loadSourceHistory(row.source.id, sourceHistoryPage + 1)}
                                />
                              </Stack>
                            )}
                          </div>
                          {sourceFailedItemsLoadingID === row.source.id && (
                            <Typography variant="caption" color="text.secondary">正在检查逐文件失败记录…</Typography>
                          )}
                          {failedItems.length > 0 && (
                            <XDriveStatusAlert
                              tone="bad"
                              sx={{ mt: 1.5 }}
                              action={(
                                <Stack direction="row" spacing={0.5}>
                                  <MuiButton color="inherit" size="small" onClick={() => setSourceFailedItemsOpen(true)}>
                                    查看失败项（{failedItems.length}）
                                  </MuiButton>
                                  <MuiButton
                                    color="inherit"
                                    size="small"
                                    disabled={!!busy || !card.trigger.ready}
                                    onClick={() => void triggerSourceNow(row)}
                                  >
                                    {busy === `source-trigger-${row.source.id}` ? '正在请求…' : '立即重试'}
                                  </MuiButton>
                                </Stack>
                              )}
                            >
                              当前仍有 {failedItems.length} 个文件处于失败状态；下一次扫描会自动重试。
                            </XDriveStatusAlert>
                          )}
                        </div>
                      )}

                    </article>
                  )
                })}
              </div>
            )}
          </section>
        )}


        {view === 'cloud' && (
          <section className="panel cloud-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">云端文件</p>
                <h2>浏览和管理云端内容</h2>
                <p className="cloud-note">云端操作通过 xdrive-agent 执行，渲染进程不会接触服务器 access token 或 refresh token。</p>
              </div>
              <div className="cloud-heading-actions">
                <XDriveActionButton
                  disabled={!!busy}
                  loading={busy === 'cloud-trash'}
                  loadingLabel="正在打开…"
                  onClick={() => void loadCloudTrash()}
                >
                  回收站
                </XDriveActionButton>
                <XDriveActionButton
                  disabled={!!busy}
                  loading={busy === 'cloud-load'}
                  loadingLabel="正在刷新…"
                  onClick={() => void loadCloudHome()}
                >
                  刷新
                </XDriveActionButton>
              </div>
            </div>

            {cloudQuota?.over_quota && (
              <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>
                存储空间已超出配额。请永久删除回收站内容，或联系管理员提高配额。
              </XDriveStatusAlert>
            )}
            {cloudQuota && (
              <div className="cloud-quota-grid">
                <div><span>物理占用</span><strong>{formatBinarySize(cloudQuota.physical_used_bytes)}</strong><small>{cloudQuota.quota_bytes > 0 ? `配额 ${formatBinarySize(cloudQuota.quota_bytes)}` : '不限配额'}</small></div>
                <div>
                  <span>可用空间</span>
                  <strong>{formatBinarySize(cloudQuota.available_bytes)}</strong>
                  <small>{cloudQuota.quota_bytes > 0 ? '用户配额限制' : '服务器磁盘可用'}</small>
                </div>
                <div><span>当前文件</span><strong>{formatBinarySize(cloudQuota.logical_file_bytes)}</strong><small>有效逻辑内容</small></div>
                <div><span>回收站</span><strong>{formatBinarySize(cloudQuota.trash_bytes)}</strong><small>计入物理配额</small></div>
                <div><span>历史版本</span><strong>{formatBinarySize(cloudQuota.history_bytes)}</strong><small>已保存的历史内容</small></div>
              </div>
            )}

            {cloudStorageStats && (
              <div className="cloud-subpanel storage-intelligence">
                <div className="cloud-subpanel-heading">
                  <div>
                    <strong>CAS 存储情报</strong>
                    <span>用于评估 CDC 与 small-file packing 的真实收益</span>
                  </div>
                </div>
                <div className="cloud-quota-grid">
                  <div><span>CAS Blob</span><strong>{cloudStorageStats.cas_blob_count.toLocaleString()}</strong><small>唯一物理对象</small></div>
                  <div><span>CAS 物理容量</span><strong>{formatBinarySize(cloudStorageStats.cas_physical_bytes)}</strong><small>实际占用</small></div>
                  <div><span>逻辑引用容量</span><strong>{formatBinarySize(cloudStorageStats.cas_logical_referenced_bytes)}</strong><small>含重复引用</small></div>
                  <div><span>去重节省</span><strong>{formatBinarySize(cloudStorageStats.cas_dedup_saved_bytes)}</strong><small>{cloudStorageStats.cas_dedup_ratio.toFixed(2)}× · {(cloudStorageStats.cas_savings_ratio * 100).toFixed(1)}%</small></div>
                  <div><span>平均 Blob</span><strong>{formatBinarySize(cloudStorageStats.average_blob_size_bytes)}</strong><small>算术平均</small></div>
                  <div><span>P50</span><strong>{formatBinarySize(cloudStorageStats.p50_blob_size_bytes)}</strong><small>中位尺寸</small></div>
                  <div><span>P90</span><strong>{formatBinarySize(cloudStorageStats.p90_blob_size_bytes)}</strong><small>90% Blob 不超过</small></div>
                  <div><span>P99</span><strong>{formatBinarySize(cloudStorageStats.p99_blob_size_bytes)}</strong><small>99% Blob 不超过</small></div>
                </div>
                <div className="cloud-compact-list">
                  {cloudStorageStats.buckets.map((bucket) => (
                    <div className="cloud-compact-row" key={bucket.key}>
                      <div><strong>{bucket.label}</strong><span>{bucket.count.toLocaleString()} 个 Blob</span></div>
                      <strong>{formatBinarySize(bucket.bytes)}</strong>
                    </div>
                  ))}
                </div>
                {cloudStorageStats.legacy_blob_count > 0 && (
                  <XDriveStatusAlert tone="warning" sx={{ m: 1.5 }}>
                    仍有 {cloudStorageStats.legacy_blob_count.toLocaleString()} 个 legacy 对象（{formatBinarySize(cloudStorageStats.legacy_physical_bytes)}），未计入 CAS 分布。
                  </XDriveStatusAlert>
                )}
              </div>
            )}

            <div className="cloud-search-row">
              <div className="cloud-search-input">
                <input
                  value={cloudQuery}
                  onChange={(event) => setCloudQuery(event.target.value)}
                  placeholder="搜索全部云端文件和文件夹"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void searchCloud()
                    }
                  }}
                />
                <XDriveActionButton
                  intent="primary"
                  disabled={!!busy || cloudQuery.trim().length < 2}
                  loading={busy === 'cloud-search'}
                  loadingLabel="正在搜索…"
                  onClick={() => void searchCloud()}
                >
                  搜索
                </XDriveActionButton>
              </div>
              {cloudSearchActive && (
                <XDriveActionButton onClick={() => {
                  setCloudSearchActive(false)
                  setCloudResults([])
                  setCloudQuery('')
                }}>
                  清除结果
                </XDriveActionButton>
              )}
            </div>

            {!cloudSearchActive && (
              <div className="cloud-breadcrumbs">
                {cloudCrumbs.map((crumb, index) => (
                  <button
                    type="button"
                    key={crumb.id}
                    disabled={index === cloudCrumbs.length - 1 || !!busy}
                    onClick={() => void loadCloudDirectory(crumb.id, cloudCrumbs.slice(0, index + 1))}
                  >
                    {crumb.name}
                  </button>
                ))}
              </div>
            )}

            <div className="cloud-list">
              <div className="cloud-list-header">
                <span>名称</span><span>大小</span><span>修改时间</span><span />
              </div>
              {cloudSearchActive ? (
                cloudResults.length === 0 ? (
                  <XDriveStatePanel variant="plain" compact message={`未找到与“${cloudQuery.trim()}”匹配的云端文件或文件夹。`} />
                ) : cloudResults.map((result) => (
                  <div className="cloud-row" key={`search:${result.node.id}:${result.path}`}>
                    <div className="cloud-name">
                      <strong>{result.node.name}</strong>
                      <span>{result.path}</span>
                    </div>
                    <span>{result.node.type === 'dir' ? '—' : formatBinarySize(result.node.size)}</span>
                    <span>{new Date(result.node.updated_at).toLocaleString()}</span>
                    <div className="cloud-row-actions">
                      {result.node.type === 'dir' ? (
                        <XDriveActionButton compact disabled={!!busy} onClick={() => void loadCloudDirectory(result.node.id, result.crumbs)}>打开</XDriveActionButton>
                      ) : (
                        <>
                          <XDriveActionButton compact disabled={!!busy} onClick={() => void openCloud历史版本(result.node, result.crumbs)}>历史版本</XDriveActionButton>
                          <XDriveActionButton compact disabled={!!busy} onClick={() => void openCloudShares(result.node)}>分享</XDriveActionButton>
                        </>
                      )}
                    </div>
                  </div>
                ))
              ) : cloudItems.length === 0 ? (
                <XDriveStatePanel variant="plain" compact message="此云端文件夹为空。" />
              ) : (
                cloudItems.map((node) => (
                  <div className="cloud-row" key={node.id}>
                    <div className="cloud-name">
                      <strong>{node.name}</strong>
                      <span>{node.type === 'dir' ? 'Folder' : 'File'}</span>
                    </div>
                    <span>{node.type === 'dir' ? '—' : formatBinarySize(node.size)}</span>
                    <span>{new Date(node.updated_at).toLocaleString()}</span>
                    <div className="cloud-row-actions">
                      {node.type === 'dir' ? (
                        <XDriveActionButton
                          compact
                          disabled={!!busy}
                          onClick={() => void loadCloudDirectory(
                            node.id,
                            [...cloudCrumbs, { id: node.id, name: node.name }],
                          )}
                        >
                          打开
                        </XDriveActionButton>
                      ) : (
                        <>
                          <XDriveActionButton compact disabled={!!busy} onClick={() => void openCloud历史版本(node, cloudCrumbs)}>历史版本</XDriveActionButton>
                          <XDriveActionButton compact disabled={!!busy} onClick={() => void openCloudShares(node)}>分享</XDriveActionButton>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {cloudTrashOpen && (
              <Dialog
                open={cloudTrashOpen}
                onClose={() => { if (!busy) setCloudTrashOpen(false) }}
                maxWidth="md"
                fullWidth
                scroll="paper"
                aria-label="回收站"
                slotProps={{ paper: xDriveDialogPaperProps }}
              >
                <XDriveDialogTitle
                  title="回收站"
                  subtitle={`${cloudTrash.length} 个项目`}
                  onClose={() => setCloudTrashOpen(false)}
                  closeDisabled={!!busy}
                />
                <XDriveDialogContent dividers flush>
                  {cloudTrash.length === 0 ? <XDriveStatePanel variant="plain" compact message="回收站为空。" /> : (
                    <div className="cloud-compact-list">
                      {cloudTrash.map((node) => (
                        <div className="cloud-compact-row" key={node.id}>
                          <div><strong>{node.name}</strong><span>{node.type === 'dir' ? '文件夹' : formatBinarySize(node.size)} · 删除于 {node.deleted_at ? new Date(node.deleted_at).toLocaleString() : '—'}</span></div>
                          <div className="cloud-row-actions">
                            <XDriveActionButton compact disabled={!!busy} onClick={() => void restoreCloudTrash(node)}>恢复</XDriveActionButton>
                            <XDriveActionButton compact intent="danger" disabled={!!busy} onClick={() => void deleteCloudTrash(node)}>永久删除</XDriveActionButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </XDriveDialogContent>
                <XDriveDialogActions>
                  <XDriveActionButton disabled={!!busy} onClick={() => setCloudTrashOpen(false)}>关闭</XDriveActionButton>
                </XDriveDialogActions>
              </Dialog>
            )}

            {cloudHistoryNode && (
              <Dialog
                open={!!cloudHistoryNode}
                onClose={() => {
                  if (busy) return
                  setCloudHistoryNode(null)
                  setCloudHistoryCrumbs([])
                  setCloudVersions([])
                }}
                maxWidth="md"
                fullWidth
                scroll="paper"
                aria-label="版本历史"
                slotProps={{ paper: xDriveDialogPaperProps }}
              >
                <XDriveDialogTitle
                  title={`版本历史 — ${cloudHistoryNode.name}`}
                  subtitle={`当前版本 r${cloudHistoryNode.revision}`}
                  onClose={() => {
                    setCloudHistoryNode(null)
                    setCloudHistoryCrumbs([])
                    setCloudVersions([])
                  }}
                  closeDisabled={!!busy}
                />
                <XDriveDialogContent dividers flush>
                  {cloudVersions.length === 0 ? <XDriveStatePanel variant="plain" compact message="暂无历史版本。" /> : (
                    <div className="cloud-compact-list">
                      {cloudVersions.map((version) => (
                        <div className="cloud-compact-row" key={version.id}>
                          <div><strong>Revision r{version.revision}</strong><span>{formatBinarySize(version.size)} · {new Date(version.created_at).toLocaleString()}</span></div>
                          <XDriveActionButton compact intent="primary" disabled={!!busy} onClick={() => void restoreCloudVersion(version)}>恢复</XDriveActionButton>
                        </div>
                      ))}
                    </div>
                  )}
                </XDriveDialogContent>
                <XDriveDialogActions>
                  <XDriveActionButton
                    disabled={!!busy}
                    onClick={() => {
                      setCloudHistoryNode(null)
                      setCloudHistoryCrumbs([])
                      setCloudVersions([])
                    }}
                  >
                    关闭
                  </XDriveActionButton>
                </XDriveDialogActions>
              </Dialog>
            )}

            {cloudShareNode && (
              <Dialog
                open={!!cloudShareNode}
                onClose={() => {
                  if (busy) return
                  setCloudShareNode(null)
                  setCloudShares([])
                  setCreatedShareURL('')
                }}
                maxWidth="md"
                fullWidth
                scroll="paper"
                aria-label="分享文件"
                slotProps={{ paper: xDriveDialogPaperProps }}
              >
                <XDriveDialogTitle
                  title={`分享 — ${cloudShareNode.name}`}
                  subtitle="分享令牌只会在创建时显示一次。"
                  onClose={() => {
                    setCloudShareNode(null)
                    setCloudShares([])
                    setCreatedShareURL('')
                  }}
                  closeDisabled={!!busy}
                />
                <XDriveDialogContent dividers flush>
                  {createdShareURL && (
                    <div className="share-created-row">
                      <input value={createdShareURL} readOnly />
                      <XDriveActionButton intent="primary" onClick={() => void copyShareURL()}>复制链接</XDriveActionButton>
                    </div>
                  )}

                  <div className="share-form">
                    <label>
                      有效期
                      <div className="input-with-unit">
                        <input type="number" min="0" max="3650" step="1" value={shareExpiresDays} onChange={(event) => setShareExpiresDays(event.target.value)} />
                        <span>天</span>
                      </div>
                      <small>0 表示永不过期。</small>
                    </label>
                    <label>
                      最大下载次数
                      <input type="number" min="0" step="1" value={shareMaxDownloads} onChange={(event) => setShareMaxDownloads(event.target.value)} />
                      <small>0 表示不限次数。</small>
                    </label>
                    <label>
                      密码（可选）
                      <input type="password" autoComplete="new-password" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} placeholder="至少 8 个字符" />
                    </label>
                    <XDriveActionButton
                      intent="primary"
                      disabled={!!busy}
                      loading={busy === 'cloud-share-create'}
                      loadingLabel="正在创建…"
                      onClick={() => void createCloudShare()}
                    >
                      创建分享链接
                    </XDriveActionButton>
                  </div>

                  <div className="cloud-compact-list">
                    {cloudShares.length === 0 ? <XDriveStatePanel variant="plain" compact message="此文件暂无分享链接。" /> : cloudShares.map((share) => (
                      <div className="cloud-compact-row" key={share.id}>
                        <div>
                          <XDriveShareStatusBadge status={share.status} />
                          <span>
                            {share.has_password ? '密码保护' : '仅链接'} ·
                            {' '}{share.expires_at ? `到期时间 ${new Date(share.expires_at).toLocaleString()}` : '永不过期'} ·
                            {' '}{share.download_count}{share.max_downloads > 0 ? ` / ${share.max_downloads}` : ' / 不限'} 次下载
                          </span>
                        </div>
                        <XDriveActionButton compact intent="danger" disabled={!!busy || share.status === 'revoked'} onClick={() => void revokeCloudShare(share)}>撤销</XDriveActionButton>
                      </div>
                    ))}
                  </div>
                </XDriveDialogContent>
                <XDriveDialogActions>
                  <XDriveActionButton
                    disabled={!!busy}
                    onClick={() => {
                      setCloudShareNode(null)
                      setCloudShares([])
                      setCreatedShareURL('')
                    }}
                  >
                    关闭
                  </XDriveActionButton>
                </XDriveDialogActions>
              </Dialog>
            )}
          </section>
        )}

        {view === 'transfers' && (
          <section className="panel transfer-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">传输中心</p>
                <h2>上传、下载与本地可用性</h2>
              </div>
              <div className="transfer-summary">
                <span><strong>{activeTransfers.length}</strong> 进行中</span>
                <span><strong>{completedTransfers.length}</strong> 已完成</span>
                <span><strong>{failedTransfers.length}</strong> 失败</span>
              </div>
            </div>

            {([
              ['进行中', activeTransfers],
              ['已完成', completedTransfers],
              ['失败', failedTransfers],
            ] as Array<[string, AgentTransfer[]]>).map(([label, items]) => (
              <div className="transfer-section" key={label}>
                <div className="transfer-section-title"><h3>{label}</h3><span>{items.length}</span></div>
                {items.length === 0 ? <div className="transfer-empty">暂无{label}任务。</div> : (
                  <div className="transfer-list">
                    {items.map((item) => {
                      const percent = Math.max(0, Math.min(100, item.percent || 0))
                      const byteProgress = item.bytes_total > 0
                        ? `${formatBinarySize(item.bytes_done)} / ${formatBinarySize(item.bytes_total)}`
                        : item.bytes_done > 0 ? formatBinarySize(item.bytes_done) : '暂无字节流'
                      return (
                        <article className="transfer-row" key={item.id}>
                          <div className="transfer-main">
                            <div className="transfer-title">
                              <strong title={item.path || item.file_name}>{item.file_name || item.path || item.id}</strong>
                              <span className={`transfer-kind ${item.kind}`}>{transferKindLabel(item.kind)}</span>
                            </div>
                            {(item.state === 'running' || item.state === 'retrying') && (
                              <div className="transfer-progress">
                                <div className="transfer-progress-track"><span style={{ width: `${percent}%` }} /></div>
                                <span>{item.bytes_total > 0 ? `${percent.toFixed(1)}%` : item.state === 'retrying' ? '正在重试' : '处理中'}</span>
                              </div>
                            )}
                            {item.error && <div className="transfer-error">{item.error}</div>}
                            <div className="transfer-meta">
                              <span>{transferKindLabel(item.direction)}</span>
                              <span>{byteProgress}</span>
                              <span>当前 {formatTransferSpeed(item.instant_bytes_per_second)}</span>
                              <span>平均 {formatTransferSpeed(item.average_bytes_per_second)}</span>
                              <span>{formatElapsed(item.elapsed_ms)}</span>
                              {item.retry_count > 0 && <span>重试 {item.retry_count} 次</span>}
                            </div>
                          </div>
                          {item.state === 'failed' && item.retryable && (
                            <XDriveActionButton
                              compact
                              disabled={!!busy}
                              loading={busy === `retry-transfer-${item.id}`}
                              loadingLabel="正在重试…"
                              onClick={() => void retryTransfer(item.id)}
                            >
                              重试
                            </XDriveActionButton>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {view === 'files' && (
          <section className="panel storage-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">存储策略</p>
                <h2>{storagePoliciesSupported ? '选择此设备保留的内容' : 'Linux FUSE 挂载'}</h2>
                <p className="storage-note">
                  {storagePoliciesSupported
                    ? '策略应用于云端文件夹。“默认”继承最近的父级策略；“不同步”会从此设备移除该文件夹；“始终保留”会将已同步内容固定保存在本地。'
                    : 'Linux 当前使用 FUSE 远程挂载；目录在此处只读展示，文件内容在打开时按需获取。'}
                </p>
              </div>
              <XDriveActionButton
                disabled={!!busy}
                loading={busy === 'storage'}
                loadingLabel="正在刷新…"
                onClick={() => void loadStorage()}
              >
                刷新
              </XDriveActionButton>
            </div>

            {!storagePoliciesSupported ? (
              <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
                Linux FUSE 模式不提供 Windows CfAPI 的“不同步”“始终保留”或持久化本地缓存语义；这些策略只在 Windows 客户端可配置。
              </XDriveStatusAlert>
            ) : null}

            {storagePoliciesSupported ? (cacheStats ? (
              <div className="cache-card">
                <div className="cache-metrics">
                  <div><span>已使用</span><strong>{formatBinarySize(cacheStats.used_bytes)}</strong><small>{cacheStats.cached_files} 个缓存文件</small></div>
                  <div><span>上限</span><strong>{cacheStats.limit_bytes > 0 ? formatBinarySize(cacheStats.limit_bytes) : '不限'}</strong><small>固定内容受保护</small></div>
                  <div><span>可释放</span><strong>{formatBinarySize(cacheStats.reclaimable_bytes)}</strong><small>{cacheStats.reclaimable_files} 个文件</small></div>
                  <div><span>已固定</span><strong>{formatBinarySize(cacheStats.pinned_bytes)}</strong><small>{cacheStats.pinned_files} 个文件</small></div>
                </div>
                {cacheStats.supported ? (
                  <div className="cache-actions">
                    <p>只会释放已完整同步且未固定的云端文件。“始终保留”的内容永远不会被回收。</p>
                    <XDriveActionButton
                      disabled={!!busy || cacheStats.reclaimable_bytes <= 0}
                      loading={busy === 'release-cache'}
                      loadingLabel="正在释放…"
                      onClick={() => void releaseReclaimableCache()}
                    >
                      释放可回收缓存
                    </XDriveActionButton>
                  </div>
                ) : (
                  <XDriveStatePanel variant="plain" compact align="left" borderTop message={cacheStats.reason || '当前平台不支持持久化本地缓存管理。'} />
                )}
              </div>
            ) : <XDriveStatePanel loading message="正在加载缓存用量…" />) : null}

            <div className="storage-tree-header">
              <div>
                <strong>云端文件夹</strong>
                <span>{storagePoliciesSupported ? '默认 / 不同步 / 始终保留' : '只读目录视图 · FUSE 按需访问'}</span>
              </div>
              {storageTree && <span>{storageTree.file_count} 个文件 · {formatBinarySize(storageTree.total_bytes)}</span>}
            </div>
            {!storageTree ? (
              <XDriveStatePanel loading message="正在加载云端文件夹树…" />
            ) : (storageTree.children || []).length === 0 ? (
              <XDriveStatePanel message="暂无云端文件夹。" />
            ) : (
              <div className="storage-tree">{(storageTree.children || []).map((node) => renderStorageNode(node))}</div>
            )}
          </section>
        )}

        {view === 'conflicts' && (
          <section className="panel">
            <div className="section-heading">
              <div><p className="eyebrow">冲突副本</p><h2>解决同步冲突</h2></div>
              <XDriveActionButton disabled={!!busy} onClick={() => void loadConflicts()}>刷新</XDriveActionButton>
            </div>
            {conflicts.length === 0 ? <XDriveStatePanel message="没有未解决的冲突。" /> : (
              <div className="conflict-list">
                {conflicts.map((item) => (
                  <article className="conflict-row" key={item.id}>
                    <div className="conflict-copy">
                      <strong>{item.original_path}</strong>
                      <span>冲突副本：{item.conflict_path}</span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <div className="row-actions">
                      <XDriveActionButton compact onClick={() => void run(`open-${item.id}`, () => window.xdriveDesktop.agent.openConflict(item.id, true))}>同时打开</XDriveActionButton>
                      <XDriveActionButton compact onClick={() => {
                        requestConfirmation(
                          '保留服务器版本？',
                          '这会保留服务器版本并删除本地冲突副本。',
                          '保留服务器版本',
                          () => run(`server-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'server'), '冲突已解决。').then(() => loadConflicts()),
                          'warning',
                        )
                      }}>保留服务器版本</XDriveActionButton>
                      <XDriveActionButton compact intent="primary" onClick={() => {
                        requestConfirmation(
                          '保留本地版本？',
                          '这会使用本地冲突副本替换服务器版本。',
                          '保留本地版本',
                          () => run(`local-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'local'), '冲突已解决。').then(() => loadConflicts()),
                          'warning',
                        )
                      }}>保留本地版本</XDriveActionButton>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}


        {view === 'diagnostics' && (
          <section className="panel diagnostics-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">诊断与自修复</p>
                <h2>客户端诊断</h2>
                <p className="diagnostic-note">Agent 会运行与 <code>xd doctor</code> 相同的脱敏检查。密钥、会话 ID 和用户目录路径不会暴露给渲染进程。</p>
              </div>
              <XDriveActionButton
                intent="primary"
                disabled={!!busy}
                loading={busy === 'diagnostics'}
                loadingLabel="正在检查…"
                onClick={() => void loadDiagnostics()}
              >
                运行诊断
              </XDriveActionButton>
            </div>

            {diagnostics ? (
              <>
                <div className="diagnostic-summary">
                  <div className="diagnostic-count pass"><strong>{diagnostics.summary.pass}</strong><span>通过</span></div>
                  <div className="diagnostic-count warn"><strong>{diagnostics.summary.warn}</strong><span>警告</span></div>
                  <div className="diagnostic-count fail"><strong>{diagnostics.summary.fail}</strong><span>失败</span></div>
                  <div className="diagnostic-generated"><span>上次检查</span><strong>{new Date(diagnostics.generated_at).toLocaleString()}</strong></div>
                </div>

                <div className="diagnostic-actions">
                  <XDriveActionButton
                    disabled={!!busy}
                    loading={busy === 'restart-agent'}
                    loadingLabel="正在重启 Agent…"
                    onClick={() => void restartAgent().then(() => loadDiagnostics())}
                  >
                    重启 Agent
                  </XDriveActionButton>
                  <XDriveActionButton
                    disabled={!!busy || status?.paused}
                    loading={busy === 'reconnect'}
                    loadingLabel="正在重新连接…"
                    onClick={() => void runDiagnosticAction(
                      'reconnect',
                      () => window.xdriveDesktop.agent.reconnect(),
                      '同步引擎已重新连接。',
                    )}
                  >
                    重新连接
                  </XDriveActionButton>
                  <XDriveActionButton
                    disabled={!!busy || status?.paused}
                    loading={busy === 'repair-sync-root'}
                    loadingLabel="正在修复…"
                    onClick={() => void runDiagnosticAction(
                      'repair-sync-root',
                      () => window.xdriveDesktop.agent.repairSyncRoot(),
                      '同步根目录已修复并重新连接。',
                    )}
                  >
                    修复同步根目录
                  </XDriveActionButton>
                  <XDriveActionButton
                    disabled={!!busy}
                    loading={busy === 'open-logs'}
                    loadingLabel="正在打开…"
                    onClick={() => void run(
                      'open-logs',
                      () => window.xdriveDesktop.agent.openLogs(),
                      '已打开 xDrive 日志。',
                    )}
                  >
                    打开日志
                  </XDriveActionButton>
                  <XDriveActionButton
                    disabled={!!busy}
                    loading={busy === 'export-diagnostics'}
                    loadingLabel="正在导出…"
                    onClick={() => void exportDiagnostics()}
                  >
                    导出报告
                  </XDriveActionButton>
                </div>

                <div className="diagnostic-list">
                  {diagnostics.checks.map((check, index) => (
                    <article className="diagnostic-row" key={`${check.name}:${index}`}>
                      <XDriveStatusBadge
                        tone={check.status === 'PASS' ? 'good' : check.status === 'WARN' ? 'warning' : 'bad'}
                        label={check.status}
                      />
                      <div>
                        <strong>{check.name}</strong>
                        <p>{check.detail}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <XDriveStatePanel message="运行诊断可检查服务器/TLS、登录与凭据存储、Agent/IPC、同步根目录、CfAPI/FUSE、缓存策略、版本兼容性和磁盘空间。" />
            )}
          </section>
        )}

        {view === 'settings' && (
          <section className="panel">
            <div className="section-heading">
              <div><p className="eyebrow">客户端设置</p><h2>同步、更新、生命周期与缓存</h2></div>
              <XDriveActionButton
                disabled={!!busy}
                loading={busy === 'restart-agent'}
                loadingLabel="正在重启 Agent…"
                onClick={() => void restartAgent()}
              >
                重启 Agent
              </XDriveActionButton>
            </div>
            <Stack id="desktop-build-info" direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <BuildInfoCard title="Desktop 构建信息" info={info} />
              <BuildInfoCard title="Server 构建信息" info={status?.server_build} />
            </Stack>
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              <FormControlLabel
                control={(
                  <Switch
                    checked={desktopPreferences.start_at_login}
                    onChange={(event) => void changeStartAtLogin(event.target.checked)}
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
                    onChange={(event) => void changeCloseToTray(event.target.checked)}
                  />
                )}
                label="关闭窗口时最小化到系统托盘"
              />
              <Typography variant="caption" color="text.secondary" sx={{ pl: 6 }}>
                开启后，点击关闭按钮只隐藏主窗口并继续同步；关闭后将直接退出 xDrive 桌面版。
              </Typography>
            </Stack>
            <div className="update-card" id="client-update-card">
              <div className="update-card-header">
                <div>
                  <strong>客户端更新</strong>
                  <span>默认不自动更新。你可以选择只检查、自动下载，或自动下载安装。</span>
                </div>
                {updateSupported && clientUpdate ? (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ minWidth: { sm: 360 } }}>
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                      <InputLabel id="client-update-source-label">更新来源</InputLabel>
                      <Select
                        labelId="client-update-source-label"
                        value={clientUpdate.source}
                        label="更新来源"
                        disabled={!!busy || updateOperationBusy}
                        onChange={(event) => void changeUpdateSource(event.target.value as AgentUpdateSource)}
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
                        disabled={!!busy || updateOperationBusy}
                        onChange={(event) => void changeUpdateMode(event.target.value as AgentUpdateMode)}
                      >
                        <MenuItem value="manual">手动检查</MenuItem>
                        <MenuItem value="check">自动检查</MenuItem>
                        <MenuItem value="download">有更新自动下载</MenuItem>
                        <MenuItem value="install" disabled={!clientUpdate.install_supported}>自动更新</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>
                ) : null}
              </div>

              {!updateSupported ? (
                <XDriveStatusAlert tone="warning">当前 xdrive-agent 不支持更新设置，请先安装包含新 Agent 的统一客户端版本。</XDriveStatusAlert>
              ) : !clientUpdate ? (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2">正在读取客户端更新状态…</Typography>
                </Stack>
              ) : (
                <>
                  <p className="update-mode-note">
                    当前来源：{clientUpdate.source === 'gitlab' ? 'GitLab · http://gitlab.t-fluid.com:1080' : 'GitHub'}。
                    {' '}{updateModeDescription(clientUpdate.mode)}
                    {!clientUpdate.install_supported ? ' 当前平台不会后台安装更新；下载后请使用系统包管理器完成安装。' : ''}
                  </p>
                  <div className="update-metrics">
                    <div><span>当前版本</span><strong>{clientUpdate.current_version || status?.version || '未知'}</strong></div>
                    <div><span>最新版本</span><strong>{clientUpdate.latest_version || '尚未检查'}</strong></div>
                    <div><span>状态</span><strong>{updateStatusLabel(clientUpdate)}</strong></div>
                    <div><span>发布时间</span><strong>{clientUpdate.published_at ? new Date(clientUpdate.published_at).toLocaleString() : '未知'}</strong></div>
                    <div><span>发布名称</span><strong>{clientUpdate.release_name || clientUpdate.latest_version || '—'}</strong></div>
                    <div><span>安装包大小</span><strong>{clientUpdate.bytes_total ? formatBinarySize(clientUpdate.bytes_total) : '未知'}</strong></div>
                    <div><span>更新通道</span><strong>{clientUpdate.channel || '—'}</strong></div>
                    <div><span>上次检查</span><strong>{clientUpdate.last_checked_at ? new Date(clientUpdate.last_checked_at).toLocaleString() : '尚未检查'}</strong></div>
                  </div>
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
                      <XDriveActionButton
                        compact
                        onClick={() => void window.xdriveDesktop.openExternal(clientUpdate.release_url || '')}
                      >
                        查看发布页面
                      </XDriveActionButton>
                    </MuiBox>
                  ) : null}

                  {(clientUpdate.status === 'downloading' || clientUpdate.bytes_done || clientUpdate.bytes_total) ? (
                    <div className="update-progress">
                      <div className="update-progress-copy">
                        <span>{clientUpdate.message || '正在处理更新…'}</span>
                        <strong>
                          {clientUpdate.bytes_total
                            ? `${formatBinarySize(clientUpdate.bytes_done || 0)} / ${formatBinarySize(clientUpdate.bytes_total)} · ${updateProgress.toFixed(1)}%`
                            : clientUpdate.bytes_done
                              ? formatBinarySize(clientUpdate.bytes_done)
                              : ''}
                        </strong>
                      </div>
                      {clientUpdate.bytes_total ? (
                        <div className="update-progress-track"><span style={{ width: `${updateProgress}%` }} /></div>
                      ) : null}
                      {clientUpdate.bytes_per_second ? <small>{formatTransferSpeed(clientUpdate.bytes_per_second)}</small> : null}
                    </div>
                  ) : null}

                  {clientUpdate.last_error ? <XDriveStatusAlert tone="bad">{clientUpdate.last_error}</XDriveStatusAlert> : null}
                  {!clientUpdate.last_error && clientUpdate.message ? <XDriveStatusAlert tone="neutral">{clientUpdate.message}</XDriveStatusAlert> : null}

                  <div className="update-actions">
                    <XDriveActionButton
                      disabled={!!busy || updateOperationBusy}
                      loading={busy === 'update-check' || clientUpdate.status === 'checking'}
                      loadingLabel="正在检查…"
                      onClick={() => void checkClientUpdate()}
                    >
                      检查更新
                    </XDriveActionButton>
                    <XDriveActionButton
                      disabled={!!busy || updateOperationBusy || !clientUpdate.update_available || clientUpdate.downloaded}
                      loading={busy === 'update-download' || clientUpdate.status === 'downloading'}
                      loadingLabel="正在下载…"
                      onClick={() => void downloadClientUpdate()}
                    >
                      {clientUpdate.downloaded ? '已下载' : '下载更新'}
                    </XDriveActionButton>
                    <XDriveActionButton
                      intent="primary"
                      disabled={!!busy || updateOperationBusy || !clientUpdate.update_available || !clientUpdate.install_supported}
                      loading={busy === 'update-install' || clientUpdate.status === 'installing'}
                      loadingLabel="正在安装…"
                      onClick={() => void installClientUpdate()}
                    >
                      {clientUpdate.downloaded ? '安装更新' : '下载并安装'}
                    </XDriveActionButton>
                    {updateCancelSupported && (clientUpdate.status === 'checking' || clientUpdate.status === 'downloading') ? (
                      <XDriveActionButton
                        disabled={updateCancelling}
                        loading={updateCancelling}
                        loadingLabel="正在取消…"
                        onClick={() => void cancelClientUpdate()}
                      >
                        取消
                      </XDriveActionButton>
                    ) : null}
                  </div>
                  <small className="update-footnote">自动策略在 Agent 启动后约 90 秒首次运行，之后约每 6 小时检查一次；切换到自动策略时会立即检查一次。</small>
                </>
              )}
            </div>
            {!settings ? <XDriveStatePanel loading message="正在加载设置…" /> : (
              <form className="settings-form" onSubmit={saveSettings}>
                <label>
                  同步文件夹
                  <div className="input-action">
                    <input value={mountPath} onChange={(e) => setMountPath(e.target.value)} required />
                    <XDriveActionButton onClick={() => void chooseDirectory(mountPath, setMountPath)}>浏览</XDriveActionButton>
                  </div>
                </label>
                <label>
                  缓存上限
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="0"
                      max="16384"
                      step="0.25"
                      value={cacheLimit}
                      onChange={(e) => setCacheLimit(e.target.value)}
                      disabled={info?.platform !== 'win32'}
                      required
                    />
                    <span>GiB</span>
                  </div>
                  <small>
                    {info?.platform === 'win32'
                      ? `0 表示不限；新设备默认 20 GiB。当前值：${formatBinarySize(settings.cache_limit_bytes)}。已固定 / 始终保留的内容不会被清理。`
                      : '持久化下载缓存上限适用于 Windows CfAPI；Linux FUSE 对每次打开使用临时文件。'}
                  </small>
                </label>
                <div className="settings-divider" />
                <div className="setting-link-row">
                  <div>
                    <strong>{storagePoliciesSupported ? '文件夹存储策略' : 'Linux FUSE 存储模式'}</strong>
                    <span>
                      {storagePoliciesSupported
                        ? '可在“存储”页面的云端目录树中选择“默认”“不同步”或“始终保留”。'
                        : 'Linux 使用 FUSE 远程挂载；“存储”页面提供只读目录视图，不提供 Windows CfAPI 的选择性同步和固定保留。'}
                    </span>
                  </div>
                  <XDriveActionButton onClick={() => setView('files')}>
                    {storagePoliciesSupported ? '管理存储' : '查看存储'}
                  </XDriveActionButton>
                </div>
                <div className="settings-divider" />
                <div className="form-actions">
                  <XDriveActionButton
                    intent="primary"
                    type="submit"
                    loading={busy === 'settings'}
                    loadingLabel="正在保存…"
                  >
                    保存设置
                  </XDriveActionButton>
                </div>
              </form>
            )}
          </section>
        )}
      </main>

      <Dialog
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        aria-label="确认操作"
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle title={confirmDialog?.title ?? '确认操作'} onClose={() => setConfirmDialog(null)} />
        <XDriveDialogContent>
          <DialogContentText>{confirmDialog?.message ?? ''}</DialogContentText>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton onClick={() => setConfirmDialog(null)}>取消</XDriveActionButton>
          <XDriveActionButton
            intent={confirmDialog?.tone === 'error' ? 'danger' : confirmDialog?.tone === 'warning' ? 'warning' : 'primary'}
            onClick={() => void confirmPendingAction()}
          >
            {confirmDialog?.confirmLabel ?? '确认'}
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog
        open={sourceFailedItemsOpen && sourceFailedItems.length > 0}
        onClose={() => setSourceFailedItemsOpen(false)}
        maxWidth="md"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="失败文件"
          subtitle={`${sourceFailedItems.length} 个失败项`}
          onClose={() => setSourceFailedItemsOpen(false)}
        />
        <XDriveDialogContent dividers>
          {sourceFailedItemsLimitReached && (
            <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>当前最多显示前 1000 个失败项。</XDriveStatusAlert>
          )}
          <Stack spacing={1.5}>
            {sourceFailedItems.map((item) => (
              <XDriveSourceFailureItem
                key={item.source_item_id}
                title={item.path || item.external_id}
                externalID={item.external_id}
                sizeLabel={formatBinarySize(item.size)}
                error={item.last_error}
              />
            ))}
          </Stack>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton onClick={() => setSourceFailedItemsOpen(false)}>关闭</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog
        open={!!sourceDeleteTarget}
        onClose={() => busy.startsWith('source-delete-') ? undefined : setSourceDeleteTarget(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="删除外部来源？"
          subtitle={sourceDeleteTarget?.source.name}
          onClose={() => setSourceDeleteTarget(null)}
          closeDisabled={busy.startsWith('source-delete-')}
        />
        <XDriveDialogContent>
          <DialogContentText>
            删除“{sourceDeleteTarget?.source.name ?? ''}”只会移除同步配置、运行记录、来源映射和已保存凭据。
            已经同步到 xDrive 的文件会保留，不会删除。
          </DialogContentText>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton disabled={busy.startsWith('source-delete-')} onClick={() => setSourceDeleteTarget(null)}>取消</XDriveActionButton>
          <XDriveActionButton
            intent="danger"
            disabled={busy.startsWith('source-delete-')}
            loading={busy.startsWith('source-delete-')}
            loadingLabel="正在删除…"
            onClick={() => void deleteExternalSource()}
          >
            删除来源
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <SynologyDsmGuideDialog
        open={!!synologyGuideSource}
        source={synologyGuideSource}
        serverURL={status?.server}
        username={status?.username}
        onClose={() => setSynologyGuideSource(null)}
      />
    </div>,
    desktopTitlebarActions,
  )
}
