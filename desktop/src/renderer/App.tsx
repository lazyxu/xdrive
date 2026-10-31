import { xDriveClearBaiduMapDiagnostic } from '../../../ui/shared/src/media-gallery-baidu-diagnostics'
import { xDriveClearBaiduConversionSession } from '../../../ui/shared/src/media-gallery-baidu-jsapi4-markers'
import type { XDriveBaiduMapAdminUpdate, XDriveGeoNamesUpdate, XDriveGeoNamesRollbackInput, XDrivePhotoAutoUpdate, XDrivePhotoAutoRollbackInput, XDriveSourceWorkerUpdate, XDriveSourceWorkerRollbackInput } from '@xdrive/shared'
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
import DnsRoundedIcon from '@mui/icons-material/DnsRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
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
  createXDriveCloudStorageDataSource,
  xDriveWorkspaceStorageSummary,
  XDriveSettingsDialog,
  XDriveFeedbackSnackbar,
  XDriveFileExplorerActionFeedback,
  xDriveFileExplorerHostCapabilities,
  XDriveTransferPopover,
  XDriveApp,
  xDriveWorkspaceHostSections,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  useXDriveCloudFilesController,
  useXDriveFileExplorerDeleteController,
  useXDriveFileOperationLifecycle,
  useXDriveFileOperationActions,
  useXDriveTaskCenterController,
  useXDriveWorkspaceNavigationState,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerNavigationState,
  XDriveFileExplorerSort,
  XDriveSidebarSectionModel,
  XDriveWorkspaceAppRoute,
  XDriveWorkspaceHostAdapter,
  XDriveStatusTone,
  XDriveLocalStorageDataSource,
} from '@xdrive/ui/mui'
import {
  XDRIVE_FILE_EXPLORER_DEFAULT_SORT,
  xDriveFileExplorerKeyboardProfileFromPlatform,
  xDriveLatestRedoableFileOperation,
  xDriveLatestUndoableFileOperation,
  xDriveLoginCredentialsReady,
  xDriveSystemDependenciesNeedsExitConfirmation,
} from '@xdrive/shared'
import type { XDriveFileExplorerDownloadResult, XDriveDeviceBackupDataSource, XDriveAdminUsersPort, XDriveAdminAuditPort, XDriveAdminStoragePort, XDriveAdminStorageRequest } from '@xdrive/shared'
import { DesktopFilesPage } from './DesktopFilesPage'
import { DesktopHostFrame } from './DesktopHostFrame'
import { desktopWindowHostAdapter } from './desktopWindowHostAdapter'
import { readDesktopLoginDraft, saveDesktopLoginDraft } from './loginDraft'
import { createDesktopFileExplorerHostPort } from './DesktopFileExplorerHostPort'
import { createDesktopCloudFilesHostPort } from './desktopCloudFilesHostPort'
import type { DesktopFileExplorerAction, DesktopFileExplorerActionIntent } from './DesktopFileExplorer'
import { desktopOverviewPort } from './desktopOverviewAdapter'
import { createDesktopMediaGalleryDataSource } from './mediaGalleryAdapter'
import { desktopShareDialogAdapter } from './fileDialogAdapters'
import { DesktopSettingsContent } from './DesktopSettingsContent'
import { createDesktopSourceManagerAdapter, desktopSourceTargetBrowser } from './sourceManagerAdapter'
import type {
  XDriveAppearance,
} from '@xdrive/shared'

type View = XDriveWorkspaceAppRoute

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
  // Stable lifetime: no new native connection or Owner token per repaint.
  const fileExplorerHostPort = useMemo(createDesktopFileExplorerHostPort, [])
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences>({
    appearance: 'system',
    start_at_login: true,
    close_to_tray: true,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [agent, setAgent] = useState<AgentConnectionState>({ connected: false })
  // Desktop and DSM share one route state, latest-intent fencing, Server-admin
  // admission, and disposable page refresh. Only Desktop owns the native shell.
  const { selected: view, pageRevision, navigate: navigateWorkspace } =
    useXDriveWorkspaceNavigationState({
      platform: 'desktop',
      adminRoleVerified: agent.connected && agent.status?.role === 'admin',
    })
  const [systemDependenciesDraftDirty, setSystemDependenciesDraftDirty] = useState(false)
  const [pendingSystemDependenciesExit, setPendingSystemDependenciesExit] = useState<View | null>(null)
  const activeViewRef = useRef<View>(view)
  const systemDependenciesDraftRef = useRef(false)
  const systemDependenciesAdminRef = useRef(false)
  activeViewRef.current = view
  systemDependenciesDraftRef.current = systemDependenciesDraftDirty

  // Electron tray/menu IPC listeners remain mounted for this App lifetime.
  // Keep their callback stable while always consulting the latest Server role.
  const navigateWorkspaceRef = useRef(navigateWorkspace)
  navigateWorkspaceRef.current = navigateWorkspace
  const setView = useCallback((next: View) => {
    // Re-entering an unchanged editor must never dispose unsaved draft state.
    if (next === activeViewRef.current && next === 'admin-services' &&
        systemDependenciesDraftRef.current) return false
    if (systemDependenciesAdminRef.current && xDriveSystemDependenciesNeedsExitConfirmation(
      activeViewRef.current, next, systemDependenciesDraftRef.current,
    )) {
      setPendingSystemDependenciesExit(next)
      return false
    }
    return navigateWorkspaceRef.current(next)
  }, [])

  const [systemDependenciesNavigationResetKey, setSystemDependenciesNavigationResetKey] = useState(0)
  const [baiduDiagnosticLocation, setBaiduDiagnosticLocation] = useState<
    { service: 'baidu-map'; tab: 'verify' } | undefined
  >(undefined)
  const [transferPopoverOpen, setTransferPopoverOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const initialLoginDraft = useMemo(readDesktopLoginDraft, [])
  const [connectionRoute, setConnectionRoute] = useState<DesktopConnectionRoute>({
    mode: 'auto', lan_ip: initialLoginDraft.lanIp, public_ip: '',
  })
  const routeOriginRef = useRef(initialLoginDraft.server.trim().replace(/\/$/, ''))
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [syncMenuAnchor, setSyncMenuAnchor] = useState<HTMLElement | null>(null)
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<HTMLElement | null>(null)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [clientUpdate, setClientUpdate] = useState<AgentUpdateState | null>(null)
  const [updateCancelling, setUpdateCancelling] = useState(false)
  const [conflicts, setConflicts] = useState<AgentConflict[]>([])
  const [transfers, setTransfers] = useState<AgentTransfers>({ revision: 0, transfers: [] })
  const [galleryUploadRevision, setGalleryUploadRevision] = useState(0)
  const galleryUploadBusyRef = useRef(false)
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

  const mediaSelectionJobsSupported =
    agent.hello?.capabilities.includes('media-selection-jobs') ?? false
  const viewerDownloadCorrelationSupported =
    agent.hello?.capabilities.includes('transfer-download-correlation') ?? false
  const mediaGallerySource = useMemo(
    () => createDesktopMediaGalleryDataSource(
      window.xdriveDesktop.agent, mediaSelectionJobsSupported,
      viewerDownloadCorrelationSupported,
    ),
    [mediaSelectionJobsSupported, viewerDownloadCorrelationSupported],
  )

  const uploadGalleryFiles = async () => {
    if (galleryUploadBusyRef.current) return
    galleryUploadBusyRef.current = true
    try {
      const root = await window.xdriveDesktop.agent.cloudRoot()
      if (!root.ok) throw new Error(root.error.message)
      // Reuse the authenticated Agent's native multi-file picker.
      const result = await window.xdriveDesktop.agent.cloudUploadFiles(root.data.id)
      if (!result.ok) throw new Error(result.error.message)
      if (result.data.canceled) return
      const uploaded = result.data.uploaded.length
      const failed = result.data.failures.length
      if (uploaded > 0) {
        setGalleryUploadRevision((revision) => revision + 1)
      }
      if (uploaded > 0 || failed > 0) {
        setNotice(`图库文件上传完成：成功 ${uploaded}，失败 ${failed}。媒体索引完成后将显示。`)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      galleryUploadBusyRef.current = false
    }
  }

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

  const [server, setServer] = useState(initialLoginDraft.server)
  const [username, setUsername] = useState(initialLoginDraft.username)
  const [password, setPassword] = useState('')
  useEffect(() => {
    // Failed first-login drafts survive restart; no secret crosses Renderer storage.
    saveDesktopLoginDraft({ server, lanIp: connectionRoute.lan_ip, username })
  }, [server, connectionRoute.lan_ip, username])
  const [loginMount, setLoginMount] = useState('')
  const [loginHistory, setLoginHistory] = useState<DesktopLoginHistory>({ profiles: [], secure_password_storage: false })
  const [rememberPassword, setRememberPassword] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [serverProbe, setServerProbe] = useState<{
    key: 'idle' | 'checking' | 'ok' | 'error'
    version?: string
    detail?: string
    code?: string
  }>({ key: 'idle' })
  const [serverProbeRetry, setServerProbeRetry] = useState(0)
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
  const baiduDiagnosticScope = `desktop:${status?.server ?? ''}:${status?.username ?? ''}`
  // Desktop file: owns no provider SDK; only clear this process-local
  // bounded hint when identity changes or the renderer goes away.
  useEffect(() => () => {
    xDriveClearBaiduMapDiagnostic(baiduDiagnosticScope)
    xDriveClearBaiduConversionSession()
  }, [baiduDiagnosticScope])
  systemDependenciesAdminRef.current = status?.role === 'admin'
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
  const localFolderGrantSupported = agent.hello?.capabilities.includes('local-folder-root-grants') ?? false
  const sourceManagerAdapter = useMemo(
    () => createDesktopSourceManagerAdapter(status?.username, localFolderGrantSupported),
    [status?.username, localFolderGrantSupported],
  )
  // Changing account/server or disconnecting must replace the datasource
  // immediately, so the shared viewer discards old overview/history snapshots.
  const deviceBackupReadSupported = Boolean(
    agent.connected && status?.configured &&
    agent.hello?.capabilities.includes('device-backup-read'),
  )
  const localIdentityReadSupported = agent.hello?.capabilities.includes('device-backup-local-device') ?? false
  const deviceBackupSource = useMemo<XDriveDeviceBackupDataSource | undefined>(() => {
    if (!deviceBackupReadSupported) return undefined
    return {
      ...(localIdentityReadSupported ? {
        verifiedLocalDevice: async () => {
          const result = await window.xdriveDesktop.agent.getDeviceBackupLocalDevice()
          if (!result.ok) throw new Error(result.error.message)
          return result.data.device_id || null
        },
      } : {}),
      list: async (signal?: AbortSignal) => {
        const result = await xDriveDesktopViewportRequest(signal, requestID =>
          window.xdriveDesktop.agent.getDeviceBackups(requestID))
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      listPage: async (limit, afterDeviceID) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupsPage(limit, afterDeviceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      foldersPage: async (deviceID, limit, afterSourceID) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupFoldersPage(deviceID, limit, afterSourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      runs: async (sourceID, limit, offset) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupRuns(sourceID, limit, offset)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [deviceBackupReadSupported, localIdentityReadSupported, status?.server, status?.username, status?.auth_status])

  // Only the currently connected Desktop with native picker + Source IPC
  // may create a local Push draft. The Agent obtains the device token itself;
  // no credential, Root fingerprint or local OS path crosses Renderer props.
  const localBackupCreate = useMemo(() => {
    if (!deviceBackupSource || !localFolderGrantSupported ||
      !agent.hello?.capabilities.includes('external-sources')) return undefined
    return {
      create: async (name: string, targetNodeID: number) => {
        const created = await sourceManagerAdapter.createSource({
          name, kind: 'local_folder', direction: 'push',
          sync_mode: 'backup', run_mode: 'sync', schedule_type: 'manual',
          target_node_id: targetNodeID, ignore_rules: '',
        })
        return { id: created.id, revision: created.revision }
      },
      authorize: (sourceID: number) => sourceManagerAdapter.authorizeLocalFolder!(sourceID),
      discard: (sourceID: number, revision: number) => sourceManagerAdapter.deleteSource(sourceID, revision),
    }
  }, [deviceBackupSource, localFolderGrantSupported, agent.hello?.capabilities, sourceManagerAdapter])

  const localBackupDraftReader = useMemo(() => {
    if (!localBackupCreate || !localIdentityReadSupported ||
      !agent.hello?.capabilities.includes('device-backup-local-drafts')) return undefined
    return async (limit: number, afterID: number) => {
      const result = await window.xdriveDesktop.agent.getDeviceBackupLocalDrafts(limit, afterID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  }, [localBackupCreate, localIdentityReadSupported, agent.hello?.capabilities,
    status?.server, status?.username, status?.auth_status])

  const localBackupSettings = useMemo(() => {
    if (!deviceBackupSource || !localIdentityReadSupported ||
      !agent.hello?.capabilities.includes('device-backup-local-config')) return undefined
    return {
      load: async (sourceID: number) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalSource(sourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      rename: async (sourceID: number, revision: number, name: string) => {
        const result = await window.xdriveDesktop.agent.renameDeviceBackupLocalSource(sourceID, revision, name)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [deviceBackupSource, localIdentityReadSupported, agent.hello?.capabilities,
    status?.server, status?.username, status?.auth_status])

  const localBackupTarget = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-target') ||
      !agent.hello?.capabilities.includes('external-sources')) return undefined
    return {
      load: localBackupSettings.load,
      retarget: async (sourceID: number, revision: number, targetNodeID: number) => {
        const result = await window.xdriveDesktop.agent.retargetDeviceBackupLocalSource(
          sourceID, revision, targetNodeID,
        )
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupMode = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-mode')) return undefined
    return {
      load: localBackupSettings.load,
      setMode: async (sourceID: number, revision: number, mode: 'backup' | 'mirror') => {
        const result = await window.xdriveDesktop.agent.setDeviceBackupLocalMode(sourceID, revision, mode)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupRules = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-rules')) return undefined
    return {
      load: async (sourceID: number) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalRules(sourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      update: async (sourceID: number, revision: number, rules: string) => {
        const result = await window.xdriveDesktop.agent.setDeviceBackupLocalRules(sourceID, revision, rules)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupSchedule = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-schedule')) return undefined
    return {
      load: async (sourceID: number) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalSchedule(sourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      save: async (sourceID: number, revision: number, spec: {
        schedule_type: 'manual' | 'interval' | 'cron'
        schedule_expression: string
        schedule_timezone: string
      }) => {
        const result = await window.xdriveDesktop.agent.setDeviceBackupLocalSchedule(sourceID, revision, spec)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupPreview = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-preview')) return undefined
    return {
      preview: async (sourceID: number, requestID: string) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalPreview(sourceID, requestID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      cancel: async (requestID: string) => {
        await window.xdriveDesktop.agent.cancelDeviceBackupLocalPreview(requestID)
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupSnapshot = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-snapshot')) return undefined
    return {
      save: async (sourceID: number, requestID: string) => {
        const result = await window.xdriveDesktop.agent.saveDeviceBackupLocalSnapshot(sourceID, requestID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      cancel: async (requestID: string) => {
        await window.xdriveDesktop.agent.cancelDeviceBackupLocalSnapshot(requestID)
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupFirstFile = useMemo(() => {
    if (!localBackupSettings ||
      !agent.hello?.capabilities.includes('device-backup-local-first-file')) return undefined
    return {
      run: async (sourceID: number) => {
        const result = await window.xdriveDesktop.agent.startDeviceBackupLocalFirstFile(sourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      inspect: agent.hello?.capabilities.includes('device-backup-local-first-file-status')
        ? async (sourceID: number) => {
          const result = await window.xdriveDesktop.agent.getDeviceBackupLocalFirstFileStatus(sourceID)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
        : undefined,
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupCommonBatch = useMemo(() => {
    if (!localBackupSettings ||
      !agent.hello?.capabilities.includes('device-backup-local-common-batch')) return undefined
    return {
      run: async (sourceID: number) => {
        const result = await window.xdriveDesktop.agent.startDeviceBackupLocalCommonBatch(sourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      inspect: async (sourceID: number) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalCommonBatch(sourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      history: async (sourceID: number) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalCommonBatchHistory(sourceID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      // Do not expose owner-private Agent recovery to Web/Mobile or foreign
      // Desktop. The request remains a read-only, generation-pinned view.
      ...(agent.hello?.capabilities.includes('device-backup-local-common-recovery-review') ? {
        review: async (sourceID: number, afterFile: number, pageEpoch: string, requestID: string) => {
          const result = await window.xdriveDesktop.agent.getDeviceBackupLocalRecoveryReview(
            sourceID, afterFile, pageEpoch, requestID)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        },
        cancelReview: async (requestID: string) => {
          await window.xdriveDesktop.agent.cancelDeviceBackupLocalRecoveryReview(requestID)
        },
      } : {}),
      control: async (sourceID: number, action: 'pause' | 'cancel') => {
        const result = await window.xdriveDesktop.agent.controlDeviceBackupLocalCommonBatch(sourceID, action)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupDelta = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-delta')) return undefined
    return {
      compare: async (sourceID: number, requestID: string) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalDelta(sourceID, requestID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      cancel: async (requestID: string) => {
        await window.xdriveDesktop.agent.cancelDeviceBackupLocalDelta(requestID)
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupEvidence = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-evidence')) return undefined
    return {
      stage: async (sourceID: number, requestID: string) => {
        const result = await window.xdriveDesktop.agent.stageDeviceBackupLocalEvidence(sourceID, requestID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      cancel: async (requestID: string) => {
        await window.xdriveDesktop.agent.cancelDeviceBackupLocalEvidence(requestID)
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupEvidenceSummary = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-evidence-summary')) return undefined
    return {
      load: async (sourceID: number, requestID: string) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalEvidenceSummary(sourceID, requestID)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      cancel: async (requestID: string) => {
        await window.xdriveDesktop.agent.cancelDeviceBackupLocalEvidenceSummary(requestID)
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupEvidencePreflight = useMemo(() => {
    if (!localBackupSettings ||
      !agent.hello?.capabilities.includes('device-backup-local-evidence-preflight')) return undefined
    return {
      load: async (sourceID: number, afterEvidenceID: number, requestID: string) => {
        const result = await window.xdriveDesktop.agent.getDeviceBackupLocalEvidencePreflight(
          sourceID, afterEvidenceID, requestID)
        if (!result.ok) throw new Error('Local content preflight failed')
        return result.data
      },
      cancel: async (requestID: string) => {
        await window.xdriveDesktop.agent.cancelDeviceBackupLocalEvidencePreflight(requestID)
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

  const localBackupRemove = useMemo(() => {
    if (!localBackupSettings || !agent.hello?.capabilities.includes('device-backup-local-remove')) return undefined
    return {
      load: localBackupSettings.load,
      remove: async (sourceID: number, revision: number) => {
        const result = await window.xdriveDesktop.agent.removeDeviceBackupLocalSource(sourceID, revision)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }
  }, [localBackupSettings, agent.hello?.capabilities, status?.server, status?.username, status?.auth_status])

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
  const maintenanceBackupPort = useMemo<import('../../../ui/shared/src/server-backup-admin').XDriveServerBackupPort>(() => ({
    read: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminBackups()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    readSnapshotIndexPage: async query => {
      const result = await window.xdriveDesktop.agent.cloudAdminBackupSnapshotPage(query)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    submit: async request => {
      const result = await window.xdriveDesktop.agent.cloudAdminBackupAction(request)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  }), [status?.server, status?.username])
  const cloudFilesPort = useMemo(
    () => createDesktopCloudFilesHostPort(
      () => window.xdriveDesktop.agent, cloudChangeFeedSupported,
    ),
    [cloudChangeFeedSupported],
  )
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
    // Offscreen reads must not compete with foreground content; preserve
    // mutation/transfer status and the user's explicit file operations.
    foreground: view === 'files' || view === 'overview',
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
    rememberOperation: rememberFilesOperation,
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
      ? async (signal?: AbortSignal) => {
          const result = await xDriveDesktopViewportRequest(signal, requestID =>
            window.xdriveDesktop.agent.cloudBackgroundTaskActiveSummary(requestID))
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    loadMinePage: async (limit: number, cursor?: string, signal?: AbortSignal) => {
      const result = await xDriveDesktopViewportRequest(signal, requestID =>
        window.xdriveDesktop.agent.cloudBackgroundTaskPage(
          false, limit, cursor ?? '', requestID,
        ))
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadGlobalPage: status?.role === 'admin'
      ? async (limit: number, cursor?: string, signal?: AbortSignal) => {
          const result = await xDriveDesktopViewportRequest(signal, requestID =>
            window.xdriveDesktop.agent.cloudBackgroundTaskPage(
              true, limit, cursor ?? '', requestID,
            ))
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
      : undefined,
    // Durable Server task Cancel/Retry/etc does NOT own a viewport signal.
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

  const mediaSelectionJobPort = useMemo(() => (
    agent.connected && configured && mediaSelectionJobsSupported ? {
      list: async () => {
        const response = await window.xdriveDesktop.agent.listMediaSelectionJobs()
        if (!response.ok) throw new Error(response.error.message)
        return response.data
      },
      cancel: async (id: string) => {
        const response = await window.xdriveDesktop.agent.cancelMediaSelectionJob(id)
        if (!response.ok) throw new Error(response.error.message)
      },
      retry: async (id: string) => {
        const response = await window.xdriveDesktop.agent.retryMediaSelectionJob(id)
        if (!response.ok) throw new Error(response.error.message)
        return response.data
      },
      failures: async (id: string, offset: number, limit: number) => {
        const response = await window.xdriveDesktop.agent.mediaSelectionJobFailures(
          id, offset, limit,
        )
        if (!response.ok) throw new Error(response.error.message)
        return response.data
      },
    } : undefined
  ), [agent.connected, configured, mediaSelectionJobsSupported])

  const taskCenter = useXDriveTaskCenterController({
    transfers: transfers.transfers,
    operations: cloudFileOperations,
    operationActions: fileOperationActions,
    externalBusy: Boolean(busy) || deleteToTrashBusy,
    conflictResolutionEnabled: fileOperationConflictResolveSupported,
    backgroundTaskPort,
    backgroundTasksLifecycleKey: `${status?.server ?? ''}\n${status?.username ?? ''}`,
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
    getQuota: (signal?: AbortSignal) => xDriveDesktopViewportRequest(signal,
      requestID => window.xdriveDesktop.agent.cloudQuota(requestID)),
    getStats: storageStatsSupported
      ? (signal?: AbortSignal) => xDriveDesktopViewportRequest(signal,
        requestID => window.xdriveDesktop.agent.cloudStorageStats(requestID))
      : undefined,
  }, {
    onQuota: applyCloudQuota,
    statsUnavailableMessage: storageStatsSupported
      ? undefined
      : '当前 xdrive-agent 不支持账号文件大小分布，请更新客户端核心组件。',
  }), [applyCloudQuota, storageStatsSupported])
  const localStorageSource = useMemo<XDriveLocalStorageDataSource>(() => ({
    load: async (signal?: AbortSignal) => {
      // Browser cache does not expose cancellation; Agent storage/cache GETs do.
      // This scope never cancels persistent cache releases or policy changes.
      signal?.throwIfAborted()
      const [browserResult, treeResult, cacheResult] = await Promise.all([
        window.xdriveDesktop.getBrowserCache(),
        xDriveDesktopViewportRequest(signal,
          requestID => window.xdriveDesktop.agent.getStorageTree(requestID)),
        xDriveDesktopViewportRequest(signal,
          requestID => window.xdriveDesktop.agent.getCache(requestID)),
      ])
      signal?.throwIfAborted()
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
          scope_label: '当前设备 Electron HTTP 缓存（非账号专属）',
          detail: '范围是当前设备的 xDrive Electron 应用会话 HTTP 缓存，不按当前登录账号隔离；可能包含该会话先前账号访问过的资源。与本机 Agent 文件缓存相互独立。清理不会删除 Cookie、登录状态、token、主题、布局或其他应用偏好。',
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
    // A newer state IPC push owns this Renderer session. An older bootstrap
    // getState() response may arrive afterward, but may not restore old auth.
    let hasAgentStateEvent = false
    // An IPC history push supersedes the independently requested bootstrap history.
    let hasLoginHistoryEvent = false
    // Live maximize/restore events supersede the asynchronous startup snapshot.
    let hasWindowStateEvent = false
    void window.xdriveDesktop.getInfo().then((value) => {
      if (active) setInfo(value)
    })
    // The React state setter has a stable identity for this App instance.
    // Only a newer successful settings write may invalidate this bootstrap read.
    const preferencesRevisionAtBootstrap = Reflect.get(setDesktopPreferences, Symbol.for('xdrive.desktop.preferencesUserWriteRevision')) ?? 0
    void window.xdriveDesktop.getPreferences().then((value) => {
      if (!active) return
      if ((Reflect.get(setDesktopPreferences, Symbol.for('xdrive.desktop.preferencesUserWriteRevision')) ?? 0) !== preferencesRevisionAtBootstrap) return
      setDesktopPreferences(value)
    })
    void window.xdriveDesktop.getLoginHistory().then((value) => {
      if (!active || hasLoginHistoryEvent) return
      setLoginHistory(value)
      const latest = initialLoginDraft.server
        ? value.profiles.find((profile) =>
            profile.server === initialLoginDraft.server &&
            profile.username === initialLoginDraft.username)
        : value.profiles[0]
      if (latest) {
        // A failed first attempt must not be overwritten by an older
        // successful profile while the async history bootstrap completes.
        if (!initialLoginDraft.server) {
          setServer(latest.server)
          setConnectionRoute(latest.connection_route || { mode: 'auto', lan_ip: '', public_ip: '' })
          routeOriginRef.current = latest.server.trim().replace(/\/$/, '')
          setUsername(latest.username)
        }
        setLoginMount(latest.mount_path || '')
        setRememberPassword(value.secure_password_storage && latest.remember_password)
        setAutoLogin(value.secure_password_storage && latest.auto_login)
      }
    })
    void window.xdriveDesktop.getWindowState().then((value) => {
      if (active && !hasWindowStateEvent) setWindowMaximized(value.maximized)
    })
    void window.xdriveDesktop.agent.getState().then((value) => {
      if (active && !hasAgentStateEvent) setAgent(value)
    })
    const unsubscribe = window.xdriveDesktop.agent.onState((value) => {
      if (!active) return
      hasAgentStateEvent = true
      setAgent(value)
    })
    const unsubscribeLoginHistory = window.xdriveDesktop.onLoginHistory((value) => {
      if (!active) return
      hasLoginHistoryEvent = true
      setLoginHistory(value)
    })
    const unsubscribeTransfers = window.xdriveDesktop.agent.onTransfers((value) => {
      if (active) {
        transfersRevisionRef.current = value.revision
        setTransfers(value)
      }
    })
    const unsubscribeWindowState = window.xdriveDesktop.onWindowState((value) => {
      if (!active) return
      hasWindowStateEvent = true
      setWindowMaximized(value.maximized)
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
      // Old tray/main navigation still sends "sources"; the new two-App
      // architecture routes that legacy action to the full Pull manager.
      if (target === 'sources') {
        setView('remote-pull')
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
    if ((view === 'global-tasks' || view === 'admin-users' || view === 'admin-audit' || view === 'admin-storage' || view === 'admin-services' || view === 'admin-maintenance') && status?.role !== 'admin') setView('transfers')
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
    const key = server.trim().replace(/\/$/, '')
    if (routeOriginRef.current === key) return
    routeOriginRef.current = key
    const saved = loginHistory.profiles.find(profile => profile.server.trim().replace(/\/$/, '') === key)
    setConnectionRoute({ mode: 'auto', lan_ip: saved?.connection_route?.lan_ip || '', public_ip: '' })
  }, [server, loginHistory.profiles])

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
      void window.xdriveDesktop.probeServer(candidate, username.trim(), connectionRoute).then((result) => {
        if (!active) return
        if (result.ok) {
          setServerProbe({ key: 'ok', version: result.data.version })
          return
        }
        setServerProbe({ key: 'error', code: result.error.code, detail: result.error.message })
      }).catch(() => {
        if (active) setServerProbe({ key: 'error', detail: '服务器探测暂时失败，请重试。' })
      })
    }, 450)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [configured, server, username, serverProbeRetry, connectionRoute])

  useEffect(() => () => { void window.xdriveDesktop.cancelServerProbe?.().catch(() => {}) }, [configured, server, username, connectionRoute])

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

  const requestSwitchServer = () => {
    requestConfirmation(
      '手动切换服务器连接入口？',
      '当前 Agent 会话将退出，活动传输与同步可能中断。请在登录页手动填写可信的局域网 IP 或公网 HTTPS 地址。不同地址不会自动继承已保存密码；不绕过证书校验。',
      '退出并选择服务器地址',
      async () => {
        xDriveClearBaiduConversionSession()
        await run('logout', () => window.xdriveDesktop.agent.logout())
      },
      'warning',
    )
  }

  const requestLogout = () => {
    requestConfirmation(
      '退出当前设备？',
      '确定要在此设备上退出 xDrive 吗？',
      '退出登录',
      async () => {
        xDriveClearBaiduConversionSession()
        await run('logout', () => window.xdriveDesktop.agent.logout())
      },
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
    // An acknowledged user change owns the setting over an older startup read.
    const revisionKey = Symbol.for('xdrive.desktop.preferencesUserWriteRevision')
    Reflect.set(setDesktopPreferences, revisionKey, (Reflect.get(setDesktopPreferences, revisionKey) ?? 0) + 1)
    setDesktopPreferences((current) => ({ ...current, start_at_login: result.data.start_at_login }))
    setNotice(enabled ? 'xDrive 桌面版将在登录系统后自动启动。' : '已关闭开机启动。')
  }

  const changeCloseToTray = async (enabled: boolean) => {
    const result = await window.xdriveDesktop.setCloseToTray(enabled)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    // A saved close-to-tray choice supersedes an older startup preferences read.
    const revisionKey = Symbol.for('xdrive.desktop.preferencesUserWriteRevision')
    Reflect.set(setDesktopPreferences, revisionKey, (Reflect.get(setDesktopPreferences, revisionKey) ?? 0) + 1)
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
    setConnectionRoute({ mode: 'auto', lan_ip: profile.connection_route?.lan_ip || '', public_ip: '' })
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
    // Provide immediate feedback; Electron Main enforces this independently.
    let httpsOrigin: URL | null = null
    try { httpsOrigin = new URL(server.trim()) } catch { /* invalid input */ }
    if (!httpsOrigin || httpsOrigin.protocol !== 'https:' ||
        !httpsOrigin.hostname || httpsOrigin.username || httpsOrigin.password ||
        httpsOrigin.pathname !== '/' || httpsOrigin.search || httpsOrigin.hash) {
      setError('服务器地址必须是完整的 HTTPS 根地址，不能使用明文 HTTP。')
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
      connection_route: { mode: 'auto', lan_ip: connectionRoute.lan_ip, public_ip: '' },
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

  const cancelTransfer = async (id: string) => {
    const data = await run(`cancel-transfer-${id}`, () => window.xdriveDesktop.agent.cancelTransfer(id), '已向 Agent 请求取消传输。')
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
  const [cloudRevealTarget, setCloudRevealTarget] = useState<{
    parentID: number; nodeID: number; requestID: string
  } | null>(null)
  const cloudRevealSequenceRef = useRef(0)
  useEffect(() => {
    if (view !== 'files') setCloudRevealTarget(null)
  }, [view])
  const revealCloudNodeInDirectory = async (
    parentID: number, nodeID: number | undefined,
    ancestry: AgentCloudCrumb[],
  ) => {
    const requestID = ++cloudRevealSequenceRef.current
    setCloudRevealTarget(null)
    setView('files')
    try {
      const accepted = await loadCloudDirectory(parentID, ancestry)
      if (requestID !== cloudRevealSequenceRef.current || activeViewRef.current !== 'files' || accepted === false) return
      if (nodeID && Number.isSafeInteger(nodeID) && nodeID > 0 &&
        nodeID !== parentID) {
        setCloudRevealTarget({
          parentID, nodeID,
          requestID: `desktop-external:${cloudFileActionLifecycleKey}:${requestID}`,
        })
      }
    } catch (error) {
      if (requestID === cloudRevealSequenceRef.current) {
        setError(error instanceof Error ? error.message : String(error))
      }
    }
  }

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
    <DesktopHostFrame maximized={windowMaximized} titlebarActions={titlebarActions} windowHost={desktopWindowHostAdapter}>
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
    </DesktopHostFrame>
  )

  const adminServicesPort = useMemo(() => ({
    operationScope: status?.server && status?.username
      ? `desktop:${status.server}:${status.username}` : '',
    loadCaddyHTTPSConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminCaddyHTTPSConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveCaddyHTTPSConfig: async (input: import('../../../ui/shared/src').XDriveCaddyHTTPSUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminCaddyHTTPS(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveCaddyConfiguration: async (input: import('../../../ui/shared/src').XDriveCaddyConfigurationSaveInput) => {
      const result = await window.xdriveDesktop.agent.cloudSaveAdminCaddyConfiguration(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    startCaddyDeploy: async () => {
      const result = await window.xdriveDesktop.agent.cloudStartAdminCaddyDeploy()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    getCaddyDeployStatus: async (requestID: string) => {
      const result = await window.xdriveDesktop.agent.cloudAdminCaddyDeployStatus(requestID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadCaddyDeployHistory: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminCaddyDeployHistory()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadCaddyHTTPSRevisions: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminCaddyHTTPSRevisions()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    rollbackCaddyHTTPS: async (input: import('../../../ui/shared/src').XDriveCaddyHTTPSRollbackInput) => {
      const result = await window.xdriveDesktop.agent.cloudRollbackAdminCaddyHTTPS(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },

    verifyCaddyAliDNSRead: async (input: import('../../../ui/shared/src').XDriveCaddyAliDNSReadVerifyInput) => {
      const result = await window.xdriveDesktop.agent.cloudVerifyAdminCaddyAliDNSRead(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },

    loadCaddyHTTPSPreflight: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminCaddyHTTPSPreflight()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadCaddyHTTPSHostPlan: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminCaddyHTTPSHostPlan()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },

    loadCaddyAliDNSConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminCaddyAliDNSConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveCaddyAliDNS: async (input: import('../../../ui/shared/src').XDriveCaddyAliDNSUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminCaddyAliDNS(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    revealCaddyAliDNS: async (revision: number) => {
      const result = await window.xdriveDesktop.agent.cloudRevealAdminCaddyAliDNS(revision)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },

    loadMediaWorkerConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminMediaWorkerConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveMediaWorkerConfig: async (input: import('../../../ui/shared/src').XDriveMediaWorkerUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminMediaWorker(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    applyMediaWorker: async (input: { revision: number }) => {
      const result = await window.xdriveDesktop.agent.cloudApplyAdminMediaWorker(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadMediaWorkerRevisions: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminMediaWorkerRevisions()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    rollbackMediaWorker: async (input: import('../../../ui/shared/src').XDriveMediaWorkerRollbackInput) => {
      const result = await window.xdriveDesktop.agent.cloudRollbackAdminMediaWorker(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },

    loadPostgresPoolConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminPostgresPoolConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    savePostgresPoolConfig: async (input: import('../../../ui/shared/src').XDrivePostgresPoolUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminPostgresPool(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadPostgresPoolRevisions: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminPostgresPoolRevisions()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    rollbackPostgresPool: async (input: import('../../../ui/shared/src').XDrivePostgresPoolRollbackInput) => {
      const result = await window.xdriveDesktop.agent.cloudRollbackAdminPostgresPool(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadSourceWorkerConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminSourceWorkerConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveSourceWorkerConfig: async (input: XDriveSourceWorkerUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminSourceWorkerConfig(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadSourceWorkerRevisions: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminSourceWorkerRevisions()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    rollbackSourceWorker: async (input: XDriveSourceWorkerRollbackInput) => {
      const result = await window.xdriveDesktop.agent.cloudRollbackAdminSourceWorker(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadPhotoHostConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminPhotoHostConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadPhotoHostPreflight: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminPhotoHostPreflight()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    applyPhotoHost: async (input: import('../../../ui/shared/src').XDrivePhotoHostApplyInput) => {
      const result = await window.xdriveDesktop.agent.cloudApplyAdminPhotoHost(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    savePhotoHostConfig: async (input: import('../../../ui/shared/src').XDrivePhotoHostUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminPhotoHost(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadPhotoHostRevisions: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminPhotoHostRevisions()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    rollbackPhotoHost: async (input: import('../../../ui/shared/src').XDrivePhotoHostRollbackInput) => {
      const result = await window.xdriveDesktop.agent.cloudRollbackAdminPhotoHost(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadPhotoAutoConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminPhotoAutoConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    savePhotoAutoConfig: async (input: XDrivePhotoAutoUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminPhotoAutoConfig(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadPhotoAutoRevisions: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminPhotoAutoRevisions()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    rollbackPhotoAuto: async (input: XDrivePhotoAutoRollbackInput) => {
      const result = await window.xdriveDesktop.agent.cloudRollbackAdminPhotoAuto(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveGeoNamesConfig: async (input: XDriveGeoNamesUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminGeoNamesConfig(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadGeoNamesConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminGeoNamesConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadGeoNamesRevisions: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminGeoNamesRevisions()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    rollbackGeoNames: async (input: XDriveGeoNamesRollbackInput) => {
      const result = await window.xdriveDesktop.agent.cloudRollbackAdminGeoNames(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    applyGeoNamesDataset: async (input: import('../../../ui/shared/src').XDriveGeoNamesDatasetApplyInput) => {
      const result = await window.xdriveDesktop.agent.cloudApplyAdminGeoNamesDataset(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    restoreMissingGeoNamesSnapshot: async (input: import('../../../ui/shared/src').XDriveGeoNamesRestoreMissingInput) => {
      const result = await window.xdriveDesktop.agent.cloudRestoreMissingAdminGeoNamesSnapshot(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    stageGeoNamesSnapshot: async (input: import('../../../ui/shared/src').XDriveGeoNamesSnapshotInput) => {
      const result = await window.xdriveDesktop.agent.cloudStageAdminGeoNamesSnapshot(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    reloadGeoNames: async (expectedVersion: string) => {
      const result = await window.xdriveDesktop.agent.cloudReloadAdminGeoNames(expectedVersion)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    revealBaiduMapAK: async (revision: number) => {
      const result = await window.xdriveDesktop.agent.cloudRevealAdminBaiduMapAK(revision)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    verifyBaiduJSAPI4Loader: async (revision: number) => {
      const result = await window.xdriveDesktop.agent.cloudVerifyAdminBaiduJSAPI4Loader(revision)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    revealBaiduJSAPIAK: async (revision: number) => {
      const result = await window.xdriveDesktop.agent.cloudRevealAdminBaiduJSAPIAK(revision)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadBaiduJSAPIConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminBaiduJSAPIConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveBaiduJSAPIConfig: async (input: import('../../../ui/shared/src').XDriveBaiduJSAPIUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminBaiduJSAPIConfig(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    loadBaiduMapConfig: async () => {
      const result = await window.xdriveDesktop.agent.cloudAdminBaiduMapConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    saveBaiduMapConfig: async (input: XDriveBaiduMapAdminUpdate) => {
      const result = await window.xdriveDesktop.agent.cloudSetAdminBaiduMapConfig(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    load: async (signal?: AbortSignal) => {
      // Only disposable status inventory reads opt into this sender-scoped
      // cancel path; Admin mutations and post-save checks remain independent.
      const result = await xDriveDesktopViewportRequest(signal,
        requestID => window.xdriveDesktop.agent.cloudAdminServices(requestID))
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  }), [status?.server, status?.username])

  const adminUsersPort = useMemo<XDriveAdminUsersPort>(() => ({
    adminUsers: async (signal?: AbortSignal) => {
      const result = await xDriveDesktopViewportRequest(signal, requestID =>
        window.xdriveDesktop.agent.cloudAdminUsers(requestID))
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    adminCreateUser: async (input) => {
      const result = await window.xdriveDesktop.agent.cloudAdminCreateUser(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    adminUpdateUser: async (id, input) => {
      const result = await window.xdriveDesktop.agent.cloudAdminUpdateUser(id, input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    adminResetPassword: async (id, password, mustChangePassword = true) => {
      const result = await window.xdriveDesktop.agent.cloudAdminResetUserPassword(id, password, mustChangePassword)
      if (!result.ok) throw new Error(result.error.message)
    },
    adminRevokeSessions: async (id) => {
      const result = await window.xdriveDesktop.agent.cloudAdminRevokeUserSessions(id)
      if (!result.ok) throw new Error(result.error.message)
    },
    adminDeleteUser: async (id) => {
      const result = await window.xdriveDesktop.agent.cloudAdminDeleteUser(id)
      if (!result.ok) throw new Error(result.error.message)
    },
  }), [status?.server, status?.username])

  const adminAuditPort = useMemo<XDriveAdminAuditPort>(() => ({
    adminAuditRange: (params, signal) => xDriveDesktopViewportRequest(signal, async (requestID) => {
      const result = await window.xdriveDesktop.agent.cloudAdminAuditRange(params, requestID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }),
  }), [status?.server, status?.username])

  const adminStorageRequest = async <T,>(input: XDriveAdminStorageRequest): Promise<T> => {
    const result = await window.xdriveDesktop.agent.cloudAdminStorage<T>(input)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }
  const adminStoragePort = useMemo<XDriveAdminStoragePort>(() => ({
    // The Desktop administrator route is global-only; self branch is never shown.
    storageStats: () => adminStorageRequest({ operation: 'stats' }),
    adminStorageStats: () => adminStorageRequest({ operation: 'stats' }),
    adminStorageHealth: () => adminStorageRequest({ operation: 'health' }),
    adminStorageOptimizationAdvice: () => adminStorageRequest({ operation: 'optimization-advice' }),
    adminStorageHistory: (days = 30) => adminStorageRequest({
      operation: 'history', days: days as 30 | 90 | 180,
    }),
    adminStorageVerificationRuns: (limit = 20, cursor = '') => adminStorageRequest({
      operation: 'verification-runs', limit, cursor,
    }),
    adminStorageVerificationRunDetail: (runID: string) => adminStorageRequest({
      operation: 'verification-run-detail', verification_run_id: runID,
    }),
    adminStorageLegacyObjects: (limit = 20, cursor = '') => adminStorageRequest({
      operation: 'legacy', limit, cursor,
    }),
    adminStorageUnreferencedBlobs: (limit = 20, cursor = '') => adminStorageRequest({
      operation: 'unreferenced', limit, cursor,
    }),
    adminUploadStaging: (limit = 50, cursor = '', fresh = false) => adminStorageRequest({
      operation: 'staging', limit, cursor, fresh,
    }),
    adminStagingCleanupRuns: (limit = 20, offset = 0) => adminStorageRequest({
      operation: 'cleanup-runs', limit, offset,
    }),
    adminStagingCleanupFailures: (runID, limit = 100, offset = 0) => adminStorageRequest({
      operation: 'cleanup-failures', run_id: runID, limit, offset,
    }),
    adminCleanupUploadStaging: () => adminStorageRequest({ operation: 'cleanup-staging' }),
    adminCleanupStorageCache: (kind) => adminStorageRequest({ operation: 'cleanup-cache', kind }),
  }), [status?.server, status?.username])

  const desktopSidebarSections: XDriveSidebarSectionModel[] = xDriveWorkspaceHostSections({
    adminRoleVerified: status?.role === 'admin',
    conflictCount: status?.conflict_count,
    diagnosticsAriaLabel: '桌面版辅助功能',
  })

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
                自动恢复登录未成功：{loginHistory.auto_login_error}。如果只是网络不可用，下次启动仍会重试。
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
                        ? (serverProbe.detail || '暂时无法连接此服务器；请检查地址、端口或证书。')
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

            <TextField fullWidth size="small" label="内网 IP（可选）" placeholder="192.168.2.4"
              value={connectionRoute.lan_ip} disabled={!!busy}
              onChange={event => setConnectionRoute({ mode: 'auto', lan_ip: event.target.value.trim(), public_ip: '' })}
              helperText="自动优先尝试此内网地址；网络不可达时使用服务器域名 DNS。不会跳过 HTTPS 身份校验。"
            />

            {serverProbe.key === 'error' && (serverProbe.code === 'server_tls_trust' ||
              serverProbe.code === 'server_tls_pin_changed') &&
              /^https:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(server.trim()) ? (
              <XDriveStatusAlert tone="warning">
                首次连接此内网服务器需要验证身份。
                <XDriveActionButton compact disabled={!!busy}
                  onClick={() => {
                    const selected = server.trim()
                    void run('trust-lan', () => window.xdriveDesktop.trustLANServer(selected))
                      .then(result => { if (result?.trusted && server.trim() === selected) {
                        setServerProbeRetry(current => current + 1)
                      } })
                  }}>
                  验证此服务器
                </XDriveActionButton>
              </XDriveStatusAlert>
            ) : null}

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

  // Only a real Agent handshake can activate native Files capabilities.
  // The shared policy has no Electron IPC or DSM permission of its own.
  const filesHostCapabilities = xDriveFileExplorerHostCapabilities(agent.hello?.capabilities)
  // UI-owned JSX for migrated routes is composed by the shared XDriveAppRouteContent.
  // Only authenticated domain data and real Desktop operations are injected.
  const workspaceHost: XDriveWorkspaceHostAdapter = {
    platform: 'desktop',
    adminRoleVerified: status?.role === 'admin',
    services: {
      workspaceAlerts: {
        lastError: status?.last_error,
        paused: status?.paused,
        hasConflicts: status?.has_conflict,
        conflictCount: status?.conflict_count,
        resumeDisabled: !!busy,
        onOpenDiagnostics: () => setView('diagnostics'),
        onResumeSync: () => void run('pause',
          () => window.xdriveDesktop.agent.setPaused(false), '同步已恢复。'),
        onOpenConflicts: () => setView('conflicts'),
      },
      // Transitional native Files controller. It is mounted only from the
      // single shared Files page outlet; other routes never instantiate it.
      filesControllerContent: view === 'files' ? (
          <DesktopFilesPage
            quota={cloudQuota}
            explorer={{
              hostPort: fileExplorerHostPort,
              items: cloudItems,
              crumbs: cloudCrumbs,
              virtualDirectory: cloudVirtualDirectory,
              loading: cloudLoading,
              onLoadDirectory: loadCloudDirectory,
              onRefreshCurrentDirectoryIfIdle: refreshCloudCurrentDirectoryIfIdle,
              navigationState: cloudFileExplorerNavigationState,
              navigationSessionStorageKey: cloudFileActionLifecycleKey || undefined,
              onNavigationStateChange: rememberCloudFileExplorerNavigationState,
              revealTarget: cloudFileActionLifecycleKey && cloudRevealTarget?.requestID.startsWith(`desktop-external:${cloudFileActionLifecycleKey}:`)
                ? cloudRevealTarget : null,
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
                  onRetryTask={!filesFeedbackOperation || !cloudFileOperations.some(task => task.retry_of_id === filesFeedbackOperation.id)
                    ? (id) => { void fileOperationActions.retryOperation(id) } : undefined}
                  onUndoTask={fileOperationUndoSupported
                    ? (id) => { void fileOperationActions.undoOperation(id) } : undefined}
                  actionsBusy={fileOperationActions.busy}
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
              uploadConflictSupported: filesHostCapabilities.uploadConflictSupported,
              archiveDownloadSupported: filesHostCapabilities.archiveDownloadSupported,
              folderTreeDownloadSupported: filesHostCapabilities.folderTreeDownloadSupported,
              textPreviewSupported: filesHostCapabilities.textPreviewSupported,
              previewStreamSupported: filesHostCapabilities.previewStreamSupported,
              propertiesStatsSupported: filePropertiesStatsSupported,
              mediaDetailsSupported: fileMediaDetailsSupported,
              mediaPropertiesSupported: filesHostCapabilities.mediaPropertiesSupported,
              nodeLocationSupported: filesHostCapabilities.nodeLocationSupported,
              childPositionSupported: filesHostCapabilities.childPositionSupported,
              fileAvailabilitySupported,
              openWithSupported: fileOpenWithSupported,
              quickAccessSupported: fileQuickAccessSupported,
              fileTagsSupported,
              savedSearchesSupported: fileSavedSearchesSupported,
              favoritesSupported: fileFavoritesSupported,
              recentSupported: fileRecentSupported,
              transferLifecycleSupported: filesHostCapabilities.transferLifecycleSupported,
              transferLifecycleBatchSupported: filesHostCapabilities.transferLifecycleBatchSupported,
              transferGroupUploadCancelSupported: filesHostCapabilities.transferGroupUploadCancelSupported,
              viewerDownloadReceipt: mediaGallerySource.viewerDownloadReceipt,
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
      ) : undefined,
      overviewPage: {
        port: desktopOverviewPort,
        status: status,
        quota: cloudQuota,
        activeTaskCount: taskCenter.badge ?? 0,
        transfers: transfers.transfers,
        fileOperations: cloudFileOperations,
        backgroundTasks: taskCenter.backgroundTasks,
        activityRevision: [
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
            ].join(':'),
        recentSupported: fileRecentSupported,
        favoritesSupported: fileFavoritesSupported,
        fileAvailabilitySupported: fileAvailabilitySupported,
        localDiskSpaceSupported: filesHostCapabilities.localDiskSpaceSupported,
        folderUploadSupported: filesHostCapabilities.uploadConflictSupported,
        openFolderLoading: busy === 'folder',
        onOpenFolder: () => {
              void run('folder', () => window.xdriveDesktop.agent.openFolder())
            },
        onOpenFiles: () => setView('files'),
        onRequestFileAction: requestCloudFileAction,
        onOpenGallery: () => setView('gallery'),
        onOpenTransfers: () => setTransferPopoverOpen(true),
        onOpenConflicts: () => setView('conflicts'),
        onError: setError,
      },
      galleryPage: {
    source: mediaGallerySource,
    preferenceScope: `desktop:${status?.server ?? ''}:${status?.username ?? ''}`,
    onOpenSecureDesktopMap: (scope) => {
              void run('baidu-secure-map', () => window.xdriveDesktop.openBaiduMapSecure(scope))
                .catch((openError) => setError(
                  openError instanceof Error ? openError.message : String(openError),
                ))
            },
    onOpenBaiduMapDiagnostics: status?.role === 'admin' &&
              agent.hello?.capabilities.includes('admin-services') ? () => {
                setBaiduDiagnosticLocation({ service: 'baidu-map', tab: 'verify' })
                setView('admin-services')
              } : undefined,
    uploadRevision: galleryUploadRevision,
    onUploadRequested: () => { void uploadGalleryFiles() },
    fileOperations: cloudFileOperations,
    onFileOperationQueued: () => { void refreshCloudFileOperations() },
    onShowInFolder: (location) => {
              if (!location.parent_id) return
              const ancestry = location.breadcrumbs
                .filter((crumb) => crumb.id !== location.node_id)
                .map((crumb) => ({ id: crumb.id, name: crumb.name }))
              if (!ancestry.length || ancestry[ancestry.length - 1].id !== location.parent_id) return
              void revealCloudNodeInDirectory(location.parent_id, location.node_id, ancestry)
            },
    shareDialog: {
              adapter: desktopShareDialogAdapter,
              expiryMode: 'days',
              listVariant: 'compact',
              showCloseAction: true,
            },
    onError: (galleryError) => setError(
              galleryError instanceof Error ? galleryError.message : String(galleryError),
            ),
  },
      deviceBackupPage: {
    source: deviceBackupSource,
    localCreate: localBackupCreate,
    targetBrowser: localBackupCreate || localBackupTarget ? desktopSourceTargetBrowser : undefined,
    localDrafts: localBackupDraftReader,
    localSettings: localBackupSettings,
    localTarget: localBackupTarget,
    localMode: localBackupMode,
    localRules: localBackupRules,
    localSchedule: localBackupSchedule,
    localPreview: localBackupPreview,
    localSnapshot: localBackupSnapshot,
    localFirstFile: localBackupFirstFile,
    localCommonBatch: localBackupCommonBatch,
    localDelta: localBackupDelta,
    localEvidence: localBackupEvidence,
    localEvidenceSummary: localBackupEvidenceSummary,
    localEvidencePreflight: localBackupEvidencePreflight,
    localRemove: localBackupRemove,
  },
      remotePullPage: agent.hello?.capabilities.includes('external-sources')
        ? {
    directionFilter: "pull",
    adapter: sourceManagerAdapter,
    defaultTargetLabel: "我的文件",
    defaultTargetPath: "",
    targetBrowser: desktopSourceTargetBrowser,
    cookieHelpVariant: "dialog",
    onError: (sourceError) => setError(
                sourceError instanceof Error ? sourceError.message : String(sourceError),
              ),
  } : undefined,
      taskCenterPage: {
    ...taskCenter.pageProps,
    globalTasksEnabled: status?.role === 'admin',
    globalTasksAvailable: Boolean(taskCenter.pageProps.globalTasksEnabled),
    backgroundScope: view === 'global-tasks' ? 'global' : 'mine',
    onBackgroundScopeChange: (scope) => {
              taskCenter.pageProps.onBackgroundScopeChange?.(scope)
              setView(scope === 'global' ? 'global-tasks' : 'transfers')
            },
    mediaSelectionJobPort: view === 'transfers' ? mediaSelectionJobPort : undefined,
    operationFocusID: filesOperationFocus?.operationID,
    operationFocusRequestID: filesOperationFocus?.requestID,
    clearHistory: {
              ...taskCenter.pageProps.clearHistory!,
              disabled: taskCenter.pageProps.clearHistory?.disabled || !agent.hello?.capabilities.includes('transfer-history-scope'),
            },
    transferRetryingID: busy.startsWith('retry-transfer-') ? busy.slice('retry-transfer-'.length) : '',
    transferRetryDisabled: Boolean(busy) || fileOperationActions.clearHistoryLoading,
    onRetryTransfer: (id) => { void retryTransfer(id) },
  },
      localStorage: localStorageSource,
      cloudStorage: cloudStorageSource,
      conflictsPage: {
          conflicts: conflicts,
          busy: Boolean(busy),
          onRefresh: () => { void loadConflicts() },
          onOpenBoth: (item) => {
              void run(`open-${item.id}`, () => window.xdriveDesktop.agent.openConflict(item.id, true))
            },
          onKeepServer: (item) => {
              requestConfirmation(
                '保留服务器版本？',
                '这会保留服务器版本并删除本地冲突副本。',
                '保留服务器版本',
                () => run(`server-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'server'), '冲突已解决。').then(() => loadConflicts()),
                'warning',
              )
            },
          onKeepLocal: (item) => {
              requestConfirmation(
                '保留本地版本？',
                '这会使用本地冲突副本替换服务器版本。',
                '保留本地版本',
                () => run(`local-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'local'), '冲突已解决。').then(() => loadConflicts()),
                'warning',
              )
            },
      },
      diagnosticsPage: {
          diagnostics: diagnostics,
          busy: busy,
          paused: Boolean(status?.paused),
          onRun: () => { void loadDiagnostics() },
          onRestartAgent: () => { void restartAgent().then(() => loadDiagnostics()) },
          onReconnect: () => {
              void runDiagnosticAction(
                'reconnect',
                () => window.xdriveDesktop.agent.reconnect(),
                '同步引擎已重新连接。',
              )
            },
          onRepairSyncRoot: () => {
              void runDiagnosticAction(
                'repair-sync-root',
                () => window.xdriveDesktop.agent.repairSyncRoot(),
                '同步根目录已修复并重新连接。',
              )
            },
          onOpenStorage: () => setView('local-storage'),
          onOpenSettings: () => setSettingsOpen(true),
          onOpenUpdateSettings: () => {
              setSettingsOpen(true)
              window.setTimeout(() => {
                document.getElementById('client-update-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }, 120)
            },
          onOpenLogs: () => {
              void run(
                'open-logs',
                () => window.xdriveDesktop.agent.openLogs(),
                '已打开 xDrive 日志。',
              )
            },
          onExport: () => { void exportDiagnostics() },
      },
      adminMaintenancePage: status?.role === 'admin'
        ? {
        updatePort: serverUpdatePort,
        backupPort: agent.hello?.capabilities.includes('admin-backups') ? maintenanceBackupPort : undefined,
        onOpenStorage: () => setView('admin-storage'),
        supported: serverUpdateSupported,
        unavailableLabel: "服务端与 Desktop",
        unsupportedMessage: "当前 xdrive-agent 不支持服务端更新，请先更新客户端核心组件。",
        disabled: !!busy && busy !== 'server-update',
        onBusyChange: (active) => {
              setBusy((current) => active
                ? 'server-update'
                : current === 'server-update' ? '' : current)
            },
      } : undefined,
      adminUsersPage: status?.role === 'admin' && agent.hello?.capabilities.includes('admin-users')
        ? {
        api: adminUsersPort,
        currentUsername: status.username,
        onChanged: () => { void refreshCloudQuota() },
      } : undefined,
      adminAuditPage: status?.role === 'admin' && agent.hello?.capabilities.includes('admin-audit')
        ? {
        api: adminAuditPort,
      } : undefined,
      adminStoragePage: status?.role === 'admin' && agent.hello?.capabilities.includes('admin-storage')
        ? {
        api: adminStoragePort,
        scope: "global",
        onOpenTaskCenter: () => setView('global-tasks'),
        onRunStorageMaintenance: async (kind) => {
                const result = await window.xdriveDesktop.agent.cloudBackgroundTaskControl(
                  `system-maintenance:${kind}`, 'run', true,
                )
                if (!result.ok) throw new Error(result.error.message)
              },
      } : undefined,
      adminServicesPage: status?.role === 'admin' && agent.hello?.capabilities.includes('admin-services')
        ? {
        source: adminServicesPort,
        location: baiduDiagnosticLocation,
        diagnosticScope: `desktop:${status?.server ?? ''}:${status?.username ?? ''}`,
        onUnsavedChange: setSystemDependenciesDraftDirty,
        navigationResetKey: systemDependenciesNavigationResetKey,
      } : undefined,
    },
    unavailableMessage: (destination) => {
      if (destination === 'remote-pull') return '当前 xdrive-agent 不支持远程拉取，请更新客户端核心组件。'
      if (destination === 'admin-users') return '当前 xdrive-agent 不支持用户管理，请更新客户端核心组件。'
      if (destination === 'admin-audit') return '当前 xdrive-agent 不支持审计日志，请更新客户端核心组件。'
      if (destination === 'admin-storage') return '当前 xdrive-agent 不支持全局存储，请更新客户端核心组件。'
      if (destination === 'admin-services') return '当前 xdrive-agent 不支持服务状态查询，请更新客户端核心组件。'
      return '当前 Desktop Host 尚未接通此功能。'
    },
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
        canCancel={(id) => Boolean(agent.hello?.capabilities.includes('transfer-cancel')) &&
          transfers.transfers.some((task) => task.id === id && task.cancelable === true &&
            task.state !== 'cancelling' && (task.state === 'running' || task.state === 'retrying'))}
        onCancel={(id) => { void cancelTransfer(id) }}
        onShowInLocal={agent.hello?.capabilities.includes('transfer-open-local')
          ? (task) => {
            void run(
              `reveal-transfer-${task.id}`,
              () => window.xdriveDesktop.agent.openTransferLocal(task.id),
              '已打开本地文件所在位置。',
            )
          }
          : undefined}
        onShowInCloud={(task) => {
          const locatorID = task.cloud_parent_id || task.cloud_node_id
          if (typeof locatorID !== 'number' || !Number.isSafeInteger(locatorID) || locatorID <= 0) return
          void window.xdriveDesktop.agent.getNodeLocation(locatorID).then((result) => {
            if (!result.ok) { setError(result.error.message); return }
            const location = result.data
            const dir = task.cloud_parent_id || location.parent_id
            if (typeof dir !== 'number' || !Number.isSafeInteger(dir) || dir <= 0) return
            const ancestry = (task.cloud_parent_id
              ? location.breadcrumbs
              : location.breadcrumbs.filter((crumb) => crumb.id !== location.node_id)
            ).map((crumb) => ({ id: crumb.id, name: crumb.name }))
            if (!ancestry.length || ancestry[ancestry.length - 1].id !== dir) return
            const target = task.cloud_node_id
            const nodeID = typeof target === 'number' && Number.isSafeInteger(target) &&
              target > 0 ? target : undefined
            void revealCloudNodeInDirectory(dir, nodeID, ancestry)
          }).catch((error) => setError(error instanceof Error ? error.message : String(error)))
        }}
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
        <MenuItem data-xdrive-manual-server-switch disabled={!!busy} onClick={() => {
          setAccountMenuAnchor(null)
          requestSwitchServer()
        }}>
          <ListItemIcon><DnsRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="手动切换公网 / 局域网入口"
            secondary="退出当前会话后编辑服务器地址" />
        </MenuItem>
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
    <XDriveApp
      host={workspaceHost}
      view={view}
      revision={pageRevision}
      sidebar={{
        ariaLabel: '桌面版侧边栏',
        navAriaLabel: '桌面版功能区',
        className: 'sidebar',
        transferBadge: taskCenter.badge,
        showLocalStorage: true,
        sections: desktopSidebarSections,
        storageSummary: xDriveWorkspaceStorageSummary(cloudQuota),
      }}
      onNavigate={(destination) => {
        if (destination === 'settings') { setSettingsOpen(true); return }
        const accepted = setView(destination as View)
        if (accepted && destination === 'admin-services') {
          setSystemDependenciesNavigationResetKey((value) => value + 1)
        }
      }}
      overlays={<>
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
        open={pendingSystemDependenciesExit !== null}
        title="离开未保存的系统依赖配置？"
        description="离开系统依赖将放弃当前未保存的修改；已提交的宿主机或后台任务不会被取消。"
        confirmLabel="放弃修改并离开"
        onCancel={() => setPendingSystemDependenciesExit(null)}
        onConfirm={() => {
          const next = pendingSystemDependenciesExit
          if (!next) return
          systemDependenciesDraftRef.current = false
          setSystemDependenciesDraftDirty(false)
          setPendingSystemDependenciesExit(null)
          navigateWorkspace(next)
        }}
      />

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

      </>}
    />,
    desktopTitlebarActions,
  )
}
