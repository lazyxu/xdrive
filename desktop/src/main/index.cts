import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os = require('node:os')
import path = require('node:path')
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  screen,
  session,
  shell,
  safeStorage,
  Tray,
  type NativeImage,
  type OpenDialogOptions,
} from 'electron'
import { DesktopViewportRequests } from './viewport_requests.cjs'
import { AgentLifecycle } from './agent_lifecycle.cjs'
import { desktopBuildInfo } from './build_metadata.cjs'
import { trayUpdatePresentation } from './tray_update.cjs'
import {
  trayTransferPresentation,
  trayTransferRateKey,
  TRAY_TRANSFER_RATE_DISPLAY_MS,
  type TrayTransferSpeedSample,
} from './tray_transfers.cjs'
import { desktopTaskbarProgress } from './taskbar_progress.cjs'
import { taskbarOverlayKind, taskbarOverlayPNG } from './taskbar_attention.cjs'
import { editContextMenuTemplate } from './edit_context_menu.cjs'
import {
  desktopShortcutActionFromArgs,
  desktopShortcutActionFromInput,
  desktopShortcutShowsWindow,
  windowsUserTasks,
  type DesktopShortcutAction,
} from './desktop_shortcuts.cjs'
import { trayStatusIconFile, trayStatusKind, type TrayStatusKind } from './tray_status.cjs'
import { DesktopLifecycleLog, formatLifecycleError } from './lifecycle_log.cjs'
import { DesktopFilePreviewProxy } from './file_preview_proxy.cjs'
import {
  desktopNativeDragOutSupported,
  resolveDesktopNativeDragOutPath,
} from './native_drag_out.cjs'
import {
  sourceRunIsTerminal,
  sourceRunNotificationPresentation,
} from './source_run_notification.cjs'
import {
  defaultDesktopPreferences,
  normalizeDesktopPreferences,
  resolveWindowBounds,
  type DesktopPreferences,
} from './window_preferences.cjs'
import {
  automaticLoginProfile,
  clearSavedPassword,
  disableAutomaticLogin,
  emptyLoginHistory,
  findLoginProfile,
  normalizeLoginHistory,
  publicLoginHistory,
  recordSuccessfulLogin,
  replaceSavedPassword,
  type LoginHistory,
} from './login_history.cjs'
import {
  AgentIPCClient,
  AgentIPCError,
  type AgentHello,
  type AgentConflict,
  type AgentDiagnosticReport,
  type AgentStorageTreeNode,
  type AgentCacheStats,
  type AgentCacheReleaseResult,
  type AgentLocalDiskSpace,
  type AgentCloudNode,
  type AgentCloudBatchNodeRef,
  type AgentCloudBatchResult,
  type AgentCloudFilePropertiesStats,
  type AgentCloudFileMediaDetails,
  type AgentBackgroundTask,
  type AgentBackgroundTaskPage,
  type AgentAdminBaiduMapAKReveal,
  type AgentAdminBaiduMapConfig,
  type AgentAdminPostgresPoolConfig,
  type AgentAdminPostgresPoolUpdate,
  type AgentAdminPostgresPoolRevisionPage,
  type AgentAdminPostgresPoolRollbackInput,
  type AgentAdminSourceWorkerConfig,
  type AgentAdminSourceWorkerUpdate,
  type AgentAdminSourceWorkerRevisionPage,
  type AgentAdminSourceWorkerRollbackInput,
  type AgentAdminPhotoAutoConfig,
  type AgentAdminPhotoAutoUpdate,
  type AgentAdminPhotoAutoRevisionPage,
  type AgentAdminPhotoAutoRollbackInput,
  type AgentAdminGeoNamesConfig,
  type AgentAdminGeoNamesUpdate,
  type AgentAdminGeoNamesReloadResult,
  type AgentAdminGeoNamesSnapshotInput,
  type AgentAdminGeoNamesSnapshotResult,
  type AgentAdminGeoNamesDatasetApplyInput,
  type AgentAdminGeoNamesRestoreMissingInput,
  type AgentAdminGeoNamesRevisionPage,
  type AgentAdminBaiduMapUpdate,
  type AgentServiceDependenciesSnapshot,
  type AgentBackgroundTaskActiveSummary,
  type AgentBackgroundTaskControlResult,
  type AgentCloudFileOperation,
  type AgentCloudUploadConflictPreflight,
  type AgentCloudUploadResult,
  type AgentCloudChildrenPage,
  type AgentCloudChildrenRange,
  type AgentCloudTrashRange,
  type AgentCloudNodeChangePage,
  type AgentCloudQuickAccessItem,
  type AgentFileTag,
  type AgentFileNodeTags,
  type AgentFileSavedSearch,
  type AgentFileSavedSearchInput,
  type AgentCloudFavoriteItem,
  type AgentCloudRecentItem,
  type AgentCloudQuota,
  type AgentCloudStorageStats,
  type AgentStorageCacheCleanup,
  type AgentStorageCacheCleanupKind,
  type AgentCloudVersion,
  type AgentCloudShare,
  type AgentCreatedCloudShare,
  type AgentCloudSearchPage,
  type AgentCloudSearchRange,
  type AgentCloudSearchFilters,
  type AgentFileExplorerGrouping,
  type AgentMediaItem,
  type AgentMediaItemRange,
  type AgentMediaGalleryFacets,
  type AgentMediaGalleryIndexStatus,
  type AgentMediaSelectionSnapshot,
  type AgentMediaSelectionSnapshotPage,
  type AgentMediaSelectionJob,
  type AgentMediaSelectionJobFailurePage,
  type AgentNodeLocation,
  type AgentMediaDuplicateOrganizePlan,
  type AgentMediaDuplicateOrganizeApplyResult,
  type AgentMediaSyncFolder,
  type AgentMediaFolderView,
  type AgentMediaAlbum,
  type AgentMediaAlbumFolder,
  type AgentMediaPlaceFacet,
  type AgentMediaMemory,
  type AgentMediaDuplicateGroupList,
  type AgentMediaBurstReviewList,
  type AgentMediaPetFacet,
  type AgentMediaPersonSuggestionReview,
  type AgentMediaSuggestedPerson,
  type AgentMediaPersonIdentity,
  type AgentMediaPersonSplit,
  type AgentMediaQuery,
  type AgentMediaFavorite,
  type AgentMediaBatchFavorite,
  type AgentMediaBatchTags,
  type AgentMediaTags,
  type AgentMediaPeople,
  type AgentMediaDescription,
  type AgentMediaEditRecipe,
  type AgentMediaEditRecipeInput,
  type AgentMediaCreativeGeneration,
  type AgentMediaCreativeInput,
  type AgentBaiduMapProvider,
  type AgentMediaThumbnail,
  type AgentSource,
  type AgentDeviceBackupOverview,
  type AgentVerifiedLocalDevice,
  type AgentLocalSourceDraftPage,
  type AgentDeviceBackupRunPage,
  type AgentLocalFolderGrant,
  type AgentCreateSourceInput,
  type AgentUpdateSourceInput,
  type AgentSourceRun,
  type AgentSourceRunFailure,
  type AgentSourceItem,
  type AgentSourceCollection,
  type AgentSourceCollectionItem,
  type AgentSourceCredentialStatus,
  type AgentSourceCredentialReveal,
  type AgentSourceCredentialTestResult,
  type AgentSourceConnectorConfig,
  type AgentSourceBrowsePage,
  type AgentFileAvailability,
  type AgentFileAvailabilityBatch,
  type AgentSettings,
  type AgentUpdateMode,
  type AgentUpdateSource,
  type AgentUpdateState,
  type AgentServerUpdateState,
  type AgentStatus,
  type AgentTransferLifecycleInput,
  type AgentTransfers,
} from './agent_client.cjs'


type DesktopViewTarget = 'overview' | 'cloud' | 'sources' | 'transfers' | 'files' | 'conflicts' | 'diagnostics' | 'settings' | 'settings-update'

type AgentConnectionState = {
  connected: boolean
  hello?: AgentHello
  status?: AgentStatus
  error?: string
}

type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status?: number; detail?: string } }

let mainWindow: BrowserWindow | null = null
let desktopWindowIcon: NativeImage | null = null
let desktopPreferences = defaultDesktopPreferences()
let loginHistory: LoginHistory = emptyLoginHistory()
let lastAutoLoginError = ''
let windowStateSaveTimer: NodeJS.Timeout | null = null
let closeDecisionPending = false
let pendingDesktopView: DesktopViewTarget | null = null
let tray: Tray | null = null
let quitting = false
let quitReason = 'system-or-application'
let lifecycleLog: DesktopLifecycleLog | null = null
let agentClient: AgentIPCClient | null = null
let agentLifecycle: AgentLifecycle | null = null
let filePreviewProxy: DesktopFilePreviewProxy | null = null
let agentState: AgentConnectionState = { connected: false, error: 'Connecting to xdrive-agent…' }
let agentTransfers: AgentTransfers = { revision: 0, transfers: [] }
let trayTransferRateSamples = new Map<string, TrayTransferSpeedSample>()
let trayTransferSampledAt = 0
let trayTransferRateTimer: NodeJS.Timeout | null = null
let agentUpdateState: AgentUpdateState | null = null
let agentMonitor: AbortController | null = null
let transferMonitor: AbortController | null = null
let sourceRunMonitor: AbortController | null = null
let updateMonitor: AbortController | null = null
const viewportRequests = new DesktopViewportRequests()
const filePropertiesRequests = new Map<string, AbortController>()
const cancelledFilePropertiesRequests = new Set<string>()
const mediaItemRequests = new Map<string, AbortController>()
const cancelledMediaItemRequests = new Set<string>()

function rememberCancelledMediaItemRequest(requestID: string) {
  cancelledMediaItemRequests.add(requestID)
  const timer = setTimeout(() => {
    cancelledMediaItemRequests.delete(requestID)
  }, 5_000)
  timer.unref()
}

function rememberCancelledFilePropertiesRequest(requestID: string) {
  cancelledFilePropertiesRequests.add(requestID)
  const timer = setTimeout(() => {
    cancelledFilePropertiesRequests.delete(requestID)
  }, 5_000)
  timer.unref()
}
let sourceRunNotificationInitialized = false
const sourceRunNotificationState = new Map<number, { runID: string; status: AgentSourceRun['status'] }>()
let startupFailurePending = false
let startupCoreReady = false
let startupRendererReady = false
let startupCompleteLogged = false
let windowsUserTasksDiagnostic: { status: 'PASS' | 'WARN'; detail: string } = {
  status: 'PASS',
  detail: '当前平台不需要注册 Windows 任务栏快捷操作。',
}
let rendererRecoveryExhausted = false
let rendererRecoveryDialogPending = false
let gpuSafeModeRelaunchPending = false
const gpuCrashTimes: number[] = []
const startupDesktopAction = desktopShortcutActionFromArgs(process.argv)
const backgroundLaunch = process.argv.includes('--background') ||
  (startupDesktopAction !== null && !desktopShortcutShowsWindow(startupDesktopAction))
const hardwareAccelerationDisabled = process.argv.includes('--disable-gpu')
if (hardwareAccelerationDisabled) app.disableHardwareAcceleration()
const desktopPreferencesName = 'desktop-settings.json'
const loginHistoryName = 'desktop-login-history.json'

function desktopLifecycleLogDirectory() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA?.trim()) {
    return path.join(process.env.LOCALAPPDATA, 'xDrive')
  }
  return app.getPath('logs')
}

function startupCheckpoint(stage: string, fields: Record<string, string | number | boolean | null | undefined> = {}) {
  lifecycleLog?.record('startup_checkpoint', { stage, ...fields })
}

function markStartupCompleteIfReady() {
  if (startupCompleteLogged || !startupCoreReady || !startupRendererReady) return
  startupCompleteLogged = true
  startupCheckpoint('startup_complete')
}

async function failDesktopStartup(event: string, error: unknown) {
  if (startupFailurePending) return
  startupFailurePending = true
  const formatted = formatLifecycleError(error)
  lifecycleLog?.record(event, { error: formatted })
  quitReason = 'startup-failed'

  if (!backgroundLaunch) {
    const logDirectory = desktopLifecycleLogDirectory()
    try {
      const result = await dialog.showMessageBox({
        type: 'error',
        title: 'xDrive Desktop 启动失败',
        message: 'xDrive Desktop 无法正常启动。',
        detail: `${formatted}\n\n日志目录：${logDirectory}`,
        buttons: ['打开日志目录', '退出'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (result.response === 0) {
        const openError = await shell.openPath(logDirectory)
        if (openError) lifecycleLog?.record('startup_log_folder_open_failed', { error: openError })
      }
    } catch (dialogError) {
      lifecycleLog?.record('startup_error_dialog_failed', { error: formatLifecycleError(dialogError) })
    }
  }

  app.exit(1)
}

async function showRendererRecoveryDialog() {
  if (rendererRecoveryDialogPending || quitting) return
  rendererRecoveryDialogPending = true
  try {
    const logDirectory = desktopLifecycleLogDirectory()
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'xDrive Desktop 界面恢复',
      message: 'xDrive Desktop 界面进程连续崩溃，已停止自动重载。',
      detail: `你可以重新加载界面，或打开日志目录排查问题。\n\n日志目录：${logDirectory}`,
      buttons: ['重新加载界面', '打开日志目录', '退出 xDrive'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (result.response === 0) {
      rendererRecoveryExhausted = false
      lifecycleLog?.record('renderer_manual_reload')
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload()
        mainWindow.show()
        mainWindow.focus()
      }
      return
    }
    if (result.response === 1) {
      const openError = await shell.openPath(logDirectory)
      if (openError) lifecycleLog?.record('renderer_log_folder_open_failed', { error: openError })
      return
    }
    requestDesktopQuit('renderer-recovery-dialog')
  } catch (error) {
    lifecycleLog?.record('renderer_recovery_dialog_failed', { error: formatLifecycleError(error) })
  } finally {
    rendererRecoveryDialogPending = false
  }
}

function requestDesktopQuit(reason: string) {
  quitReason = reason
  quitting = true
  lifecycleLog?.record('quit_requested', { reason })
  app.quit()
}

async function loadDesktopPreferences(): Promise<DesktopPreferences> {
  const file = path.join(app.getPath('userData'), desktopPreferencesName)
  try {
    return normalizeDesktopPreferences(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return defaultDesktopPreferences()
  }
}

async function saveDesktopPreferences(preferences: DesktopPreferences) {
  desktopPreferences = normalizeDesktopPreferences(preferences)
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, desktopPreferencesName),
    JSON.stringify(desktopPreferences, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  )
}

function publicDesktopPreferences() {
  return {
    appearance: desktopPreferences.appearance,
    start_at_login: desktopPreferences.start_at_login,
    close_to_tray: desktopPreferences.close_to_tray,
  }
}

async function loadLoginHistory(): Promise<LoginHistory> {
  try {
    return normalizeLoginHistory(JSON.parse(await readFile(path.join(app.getPath('userData'), loginHistoryName), 'utf8')))
  } catch {
    return emptyLoginHistory()
  }
}

async function saveLoginHistory() {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, loginHistoryName),
    JSON.stringify(loginHistory, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  )
}

function securePasswordStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform !== 'linux') return true
  const backend = safeStorage.getSelectedStorageBackend()
  return backend !== 'basic_text' && backend !== 'unknown'
}

function encryptLoginPassword(password: string) {
  return safeStorage.encryptString(password).toString('base64')
}

function decryptLoginPassword(encryptedPassword: string) {
  return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'))
}

function loginHistorySnapshot() {
  return {
    ...publicLoginHistory(loginHistory, securePasswordStorageAvailable()),
    ...(lastAutoLoginError ? { auto_login_error: lastAutoLoginError } : {}),
  }
}

async function persistLoginHistoryBestEffort() {
  try {
    await saveLoginHistory()
  } catch (error) {
    lifecycleLog?.record('login_history_save_failed', { error: formatLifecycleError(error) })
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:login-history', loginHistorySnapshot())
  }
}

async function probeDesktopServer(serverValue: string): Promise<DesktopResult<{ version?: string }>> {
  const normalized = serverValue.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return { ok: false, error: { code: 'invalid_server', message: '服务器地址格式无效。' } }
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    return { ok: false, error: { code: 'invalid_server', message: '服务器地址必须是 http(s) 地址，且不能包含用户名或密码。' } }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch(normalized + '/api/v1/version', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: 'server_unreachable',
          message: `服务器返回 HTTP ${response.status}。`,
          status: response.status,
        },
      }
    }
    const payload = await response.json().catch(() => ({})) as { version?: unknown }
    return {
      ok: true,
      data: typeof payload.version === 'string' && payload.version.trim()
        ? { version: payload.version.trim() }
        : {},
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? '连接服务器超时。'
      : formatLifecycleError(error)
    return { ok: false, error: { code: 'server_unreachable', message } }
  } finally {
    clearTimeout(timer)
  }
}

function quoteDesktopExec(value: string) {
  return '"' + value.replace(/([\\"])/g, '\\$1') + '"'
}

async function applyStartAtLogin(enabled: boolean) {
  if (!app.isPackaged) return

  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: enabled ? ['--background'] : [],
    })
    return
  }

  if (process.platform === 'linux') {
    const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
    const autostartDir = path.join(configHome, 'autostart')
    const desktopFile = path.join(autostartDir, 'xdrive-desktop.desktop')
    if (!enabled) {
      await rm(desktopFile, { force: true })
      return
    }
    await mkdir(autostartDir, { recursive: true })
    const contents = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=xDrive 桌面版',
      'Comment=在后台启动 xDrive',
      'Icon=xdrive',
      `Exec=${quoteDesktopExec(process.execPath)} --background`,
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n')
    await writeFile(desktopFile, contents, { encoding: 'utf8', mode: 0o600 })
  }
}

async function setStartAtLogin(enabled: boolean) {
  await saveDesktopPreferences({ ...desktopPreferences, start_at_login: enabled })
  await applyStartAtLogin(enabled)
  return { start_at_login: desktopPreferences.start_at_login }
}

async function setCloseToTray(enabled: boolean) {
  await saveDesktopPreferences({
    ...desktopPreferences,
    close_to_tray: enabled,
    close_behavior_prompted: true,
  })
  return publicDesktopPreferences()
}

async function setAppearance(appearance: DesktopPreferences['appearance']) {
  await saveDesktopPreferences({ ...desktopPreferences, appearance })
  nativeTheme.themeSource = desktopPreferences.appearance
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(desktopWindowBackground())
  }
  return publicDesktopPreferences()
}

async function persistWindowState(win: BrowserWindow) {
  if (win.isDestroyed()) return
  await saveDesktopPreferences({
    ...desktopPreferences,
    window_bounds: win.getNormalBounds(),
    window_maximized: win.isMaximized(),
  })
}

function scheduleWindowStateSave(win: BrowserWindow) {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null
    void persistWindowState(win)
  }, 250)
}

async function handleMainWindowClose(win: BrowserWindow) {
  if (closeDecisionPending || win.isDestroyed()) return
  await persistWindowState(win)

  if (!desktopPreferences.close_behavior_prompted) {
    closeDecisionPending = true
    try {
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        title: '关闭 xDrive 桌面版',
        message: '关闭窗口后，xDrive 是否继续在后台同步？',
        detail: '选择“最小化到托盘”后，窗口会隐藏但同步继续运行。之后可在“设置”中修改关闭行为。',
        buttons: ['最小化到托盘', '退出 xDrive', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      if (result.response === 2) return
      const closeToTray = result.response === 0
      await saveDesktopPreferences({
        ...desktopPreferences,
        close_to_tray: closeToTray,
        close_behavior_prompted: true,
      })
      if (closeToTray) {
        win.hide()
        return
      }
      requestDesktopQuit('window-close-dialog')
      return
    } finally {
      closeDecisionPending = false
    }
  }

  if (desktopPreferences.close_to_tray) {
    win.hide()
    return
  }
  requestDesktopQuit('window-close')
}

function showMainWindow() {
  if (rendererRecoveryExhausted) {
    void showRendererRecoveryDialog()
    return
  }
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function showDesktopView(view: DesktopViewTarget) {
  pendingDesktopView = view
  showMainWindow()
  if (rendererRecoveryExhausted) return
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return
  mainWindow.webContents.send('desktop:navigate', view)
  pendingDesktopView = null
}

async function performDesktopShortcutAction(action: DesktopShortcutAction) {
  if (action === 'transfers' || action === 'settings') {
    showDesktopView(action)
    return
  }

  const result = await runAgentAction(async () => {
    await requireAgentLifecycle().ensureRunning()
    if (action === 'open-folder') return requireAgentClient().openFolder()
    return requireAgentClient().syncNow()
  }, action === 'sync-now')

  if (!result.ok) {
    showDesktopView('overview')
    showDesktopNotification('xDrive', result.error.message, 'overview')
  }
}

function registerWindowsUserTasks() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    windowsUserTasksDiagnostic = {
      status: 'PASS',
      detail: '当前平台不需要注册 Windows 任务栏快捷操作。',
    }
    return
  }

  try {
    if (app.setUserTasks(windowsUserTasks(process.execPath))) {
      windowsUserTasksDiagnostic = {
        status: 'PASS',
        detail: 'Windows 任务栏快捷操作已注册。',
      }
      startupCheckpoint('windows_user_tasks_registered')
      return
    }
    windowsUserTasksDiagnostic = {
      status: 'WARN',
      detail: 'Windows 拒绝注册任务栏快捷操作；不影响同步和主窗口使用。',
    }
    lifecycleLog?.record('windows_user_tasks_failed', { reason: 'setUserTasks returned false' })
  } catch (error) {
    windowsUserTasksDiagnostic = {
      status: 'WARN',
      detail: 'Windows 任务栏快捷操作注册异常；不影响同步和主窗口使用。',
    }
    lifecycleLog?.record('windows_user_tasks_failed', { error: formatLifecycleError(error) })
  }
}

function updateTaskbarProgress() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return
  const progress = desktopTaskbarProgress(agentUpdateState, agentTransfers, agentState.status)
  if (!progress) {
    mainWindow.setProgressBar(-1)
    restoreWindowsTaskbarIcon()
    return
  }
  mainWindow.setProgressBar(progress.value, { mode: progress.mode })
  restoreWindowsTaskbarIcon()
}

function desktopWindowBackground() {
  return nativeTheme.shouldUseDarkColors ? '#0f141d' : '#f5f7fb'
}

function desktopWindowState(win = mainWindow) {
  return {
    maximized: !!win?.isMaximized(),
    minimized: !!win?.isMinimized(),
    fullscreen: !!win?.isFullScreen(),
  }
}

function publishDesktopWindowState(win: BrowserWindow) {
  if (win.isDestroyed()) return
  win.webContents.send('desktop:window-state', desktopWindowState(win))
}

function requestTaskbarAttention() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return
  mainWindow.flashFrame(true)
}

function desktopRuntimeIconPath() {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'app-icon.ico')
      : path.resolve(app.getAppPath(), '..', 'assets', 'icon', 'windows', 'app.ico')
  }
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.resolve(app.getAppPath(), '..', 'assets', 'icon', 'web', 'pwa-192.png')
}

function desktopRuntimeIcon(): NativeImage | string {
  if (desktopWindowIcon && !desktopWindowIcon.isEmpty()) return desktopWindowIcon
  const assetPath = desktopRuntimeIconPath()
  const image = nativeImage.createFromPath(assetPath)
  if (image.isEmpty()) {
    lifecycleLog?.record('desktop_window_icon_invalid', { asset_path: assetPath })
    return assetPath
  }
  desktopWindowIcon = image
  return image
}

function restoreWindowsTaskbarIcon() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.setIcon(desktopRuntimeIcon())
  } catch (error) {
    lifecycleLog?.record('taskbar_icon_restore_failed', { error: formatLifecycleError(error) })
  }
}

function createMainWindow(showOnReady = true) {
  const restoredBounds = resolveWindowBounds(
    desktopPreferences.window_bounds,
    screen.getAllDisplays().map((display) => display.workArea),
  )
  const win = new BrowserWindow({
    ...(restoredBounds || { width: 1120, height: 760 }),
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    title: 'xDrive 桌面版',
    icon: desktopRuntimeIcon(),
    backgroundColor: desktopWindowBackground(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win
  startupCheckpoint('window_created')
  updateTaskbarOverlay()
  if (desktopPreferences.window_maximized) win.maximize()

  let rendererLoadTimer: NodeJS.Timeout | null = setTimeout(() => {
    rendererLoadTimer = null
    void failDesktopStartup(
      'renderer_load_timeout',
      new Error('Desktop renderer did not finish loading within 15 seconds.'),
    )
  }, 15_000)
  let rendererCrashTimes: number[] = []
  let rendererRecoveryStableTimer: NodeJS.Timeout | null = null
  const clearRendererLoadTimer = () => {
    if (!rendererLoadTimer) return
    clearTimeout(rendererLoadTimer)
    rendererLoadTimer = null
  }
  const clearRendererRecoveryStableTimer = () => {
    if (!rendererRecoveryStableTimer) return
    clearTimeout(rendererRecoveryStableTimer)
    rendererRecoveryStableTimer = null
  }
  const markRendererRecoveryStable = () => {
    clearRendererRecoveryStableTimer()
    if (rendererCrashTimes.length === 0) return
    rendererRecoveryStableTimer = setTimeout(() => {
      rendererCrashTimes = []
      rendererRecoveryExhausted = false
      rendererRecoveryStableTimer = null
      lifecycleLog?.record('renderer_recovery_stable')
    }, 30_000)
  }

  win.on('move', () => scheduleWindowStateSave(win))
  win.on('resize', () => scheduleWindowStateSave(win))
  win.on('maximize', () => {
    scheduleWindowStateSave(win)
    publishDesktopWindowState(win)
  })
  win.on('unmaximize', () => {
    scheduleWindowStateSave(win)
    publishDesktopWindowState(win)
  })
  win.on('minimize', () => publishDesktopWindowState(win))
  win.on('restore', () => publishDesktopWindowState(win))
  win.on('enter-full-screen', () => publishDesktopWindowState(win))
  win.on('leave-full-screen', () => publishDesktopWindowState(win))
  win.on('focus', () => win.flashFrame(false))
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    void handleMainWindowClose(win)
  })
  win.on('closed', () => {
    clearRendererLoadTimer()
    clearRendererRecoveryStableTimer()
    if (mainWindow === win) mainWindow = null
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    clearRendererLoadTimer()
    void failDesktopStartup(
      'renderer_load_failed',
      new Error(`Renderer load failed (${errorCode}) ${errorDescription}: ${validatedURL}`),
    )
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    clearRendererLoadTimer()
    void failDesktopStartup(
      'preload_failed',
      new Error(`Preload failed at ${preloadPath}: ${formatLifecycleError(error)}`),
    )
  })
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return
    Menu.buildFromTemplate(editContextMenuTemplate(params.editFlags)).popup({ window: win })
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    lifecycleLog?.record('render_process_gone', {
      reason: details.reason,
      exit_code: details.exitCode,
    })
    if (quitting) return
    if (!['crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'killed'].includes(details.reason)) return

    clearRendererRecoveryStableTimer()
    const now = Date.now()
    rendererCrashTimes = rendererCrashTimes.filter((at) => now - at <= 60_000)
    rendererCrashTimes.push(now)
    if (rendererCrashTimes.length === 1) {
      lifecycleLog?.record('renderer_recovery_reload', { attempt: 1, reason: details.reason })
      setTimeout(() => {
        if (!quitting && !win.isDestroyed()) win.webContents.reload()
      }, 250)
      return
    }

    rendererRecoveryExhausted = true
    lifecycleLog?.record('renderer_recovery_exhausted', {
      crashes: rendererCrashTimes.length,
      window_ms: 60_000,
      reason: details.reason,
    })
    if (win.isVisible()) void showRendererRecoveryDialog()
  })
  win.on('unresponsive', () => lifecycleLog?.record('window_unresponsive'))
  win.webContents.on('before-input-event', (event, input) => {
    const action = desktopShortcutActionFromInput(input)
    if (!action) return
    event.preventDefault()
    void performDesktopShortcutAction(action)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devURL = process.env.XD_DESKTOP_DEV_URL
    if (devURL) {
      if (!url.startsWith(devURL)) event.preventDefault()
      return
    }
    if (!url.startsWith('file://')) event.preventDefault()
  })
  const devURL = process.env.XD_DESKTOP_DEV_URL
  const loadRenderer = devURL
    ? win.loadURL(devURL)
    : win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  void loadRenderer.catch((error) => {
    clearRendererLoadTimer()
    void failDesktopStartup('renderer_load_rejected', error)
  })
  win.once('ready-to-show', () => {
    startupCheckpoint('window_ready_to_show')
    if (showOnReady) {
      win.show()
      startupCheckpoint('window_shown', { visible: win.isVisible() })
    }
  })
  win.webContents.on('did-finish-load', () => {
    clearRendererLoadTimer()
    if (!startupRendererReady) {
      startupRendererReady = true
      startupCheckpoint('renderer_loaded')
      markStartupCompleteIfReady()
    } else if (rendererCrashTimes.length > 0) {
      lifecycleLog?.record('renderer_recovery_loaded', { crashes: rendererCrashTimes.length })
    }
    markRendererRecoveryStable()
    win.webContents.send('agent:state', agentState)
    publishDesktopWindowState(win)
    if (pendingDesktopView) {
      win.webContents.send('desktop:navigate', pendingDesktopView)
      pendingDesktopView = null
    }
    updateTaskbarProgress()
  })
}

function statusLabel() {
  if (!agentState.connected) return 'Agent 未连接'
  const status = agentState.status
  if (!status) return '正在连接'
  if (status.has_conflict) return `冲突 (${status.conflict_count})`
  if (status.paused) return '已暂停'
  return status.sync_status || status.auth_status
}

function trayStatusAssetPath(kind: TrayStatusKind) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icons')
    : path.resolve(app.getAppPath(), '..', 'assets', 'icon', 'tray')
  return path.join(root, trayStatusIconFile(kind))
}

function taskbarOverlayImage(kind: 'conflict' | 'offline') {
  const image = nativeImage.createFromBuffer(taskbarOverlayPNG(kind))
  if (image.isEmpty()) return null
  return image.resize({ width: 16, height: 16 })
}

function updateTaskbarOverlay() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return
  const kind = taskbarOverlayKind(agentState.connected, agentState.status)
  if (!kind) {
    mainWindow.setOverlayIcon(null, '')
    return
  }

  try {
    const image = taskbarOverlayImage(kind)
    if (!image) {
      lifecycleLog?.record('taskbar_overlay_invalid', { kind })
      mainWindow.setOverlayIcon(null, '')
      return
    }
    mainWindow.setOverlayIcon(
      image,
      kind === 'conflict' ? 'xDrive 有同步冲突' : 'xDrive 需要处理同步或登录问题',
    )
  } catch (error) {
    lifecycleLog?.record('taskbar_overlay_failed', {
      kind,
      error: formatLifecycleError(error),
    })
    try {
      mainWindow.setOverlayIcon(null, '')
    } catch {
      // A taskbar decoration must never block the Desktop from starting.
    }
  }
}

function trayStatusImage() {
  const kind = trayStatusKind(agentState.connected, agentState.status, agentTransfers, agentUpdateState)
  const assetPath = trayStatusAssetPath(kind)
  const image = nativeImage.createFromPath(assetPath)
  if (image.isEmpty()) throw new Error(`xDrive tray icon is missing or invalid: ${assetPath}`)
  return image.resize({ width: process.platform === 'win32' ? 16 : 22, height: process.platform === 'win32' ? 16 : 22 })
}

function updateTrayIcon() {
  if (!tray) return
  tray.setImage(trayStatusImage())
}

function rebuildTrayMenu() {
  if (!tray) return
  // Byte/progress updates may arrive much faster than the numeric rate UI.
  // Snapshot only the rates on a 2s clock; preserve their real freshness.
  const now = Date.now()
  const hasActiveTransfer = agentTransfers.transfers.some((item) =>
    item.state === 'queued' || item.state === 'running' ||
    item.state === 'retrying' || item.state === 'cancelling'
  )
  if (hasActiveTransfer && !trayTransferRateTimer) {
    trayTransferRateTimer = setInterval(() => rebuildTrayMenu(), TRAY_TRANSFER_RATE_DISPLAY_MS)
  } else if (!hasActiveTransfer && trayTransferRateTimer) {
    clearInterval(trayTransferRateTimer)
    trayTransferRateTimer = null
  }
  if (!hasActiveTransfer) {
    trayTransferSampledAt = 0
    trayTransferRateSamples.clear()
  } else if (now - trayTransferSampledAt >= TRAY_TRANSFER_RATE_DISPLAY_MS) {
    trayTransferSampledAt = now
    trayTransferRateSamples = new Map(agentTransfers.transfers.map((item) => [
      trayTransferRateKey(item),
      {
        instant_bytes_per_second: item.instant_bytes_per_second,
        speed_updated_at: item.speed_updated_at,
        updated_at: item.updated_at,
      },
    ]))
  }
  updateTrayIcon()
  const status = agentState.status
  const configured = !!status?.configured
  const update = trayUpdatePresentation(agentUpdateState)
  const transfer = trayTransferPresentation(agentTransfers, 3, now, trayTransferRateSamples)
  const updateSupported = agentState.connected && (agentState.hello?.capabilities.includes('client-update') ?? false)
  tray.setToolTip(`xDrive — ${statusLabel()}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    {
      label: `客户端更新 · ${update.headline}`,
      enabled: updateSupported,
      submenu: [
        ...(agentUpdateState?.current_version
          ? [{ label: `当前版本 ${agentUpdateState.current_version}`, enabled: false }]
          : []),
        { label: update.headline, enabled: false },
        ...(update.detail ? [{ label: update.detail, enabled: false }] : []),
        { type: 'separator' as const },
        {
          label: '检查更新',
          enabled: updateSupported && !update.busy,
          click: () => {
            void runAgentAction(async () => {
              const hello = await requireAgentLifecycle().ensureRunning()
              requireAgentCapability(hello, 'client-update')
              const next = await requireAgentClient().checkUpdate()
              publishAgentUpdate(next)
              return next
            }, false)
          },
        },
      ],
    },
    {
      label: transfer.label,
      submenu: [
        ...(transfer.items.length > 0
          ? transfer.items.map((item) => ({ label: item.label, enabled: false }))
          : [{ label: transfer.failed > 0 ? '当前没有进行中的传输' : '当前没有传输任务', enabled: false }]),
        ...(transfer.extraActive > 0
          ? [{ label: `另有 ${transfer.extraActive} 个进行中任务`, enabled: false }]
          : []),
        ...(transfer.failed > 0
          ? [{ label: `${transfer.failed} 个失败任务需要处理`, enabled: false }]
          : []),
        { type: 'separator' as const },
        { label: '打开传输中心', click: () => showDesktopView('transfers') },
      ],
    },
    { type: 'separator' },
    { label: '打开 xDrive 桌面版', click: showMainWindow },
    { label: '设置', click: () => showDesktopView('settings') },
    {
      label: '打开 xDrive 文件夹',
      enabled: agentState.connected && configured,
      click: () => { void runAgentAction(() => requireAgentClient().openFolder(), false) },
    },
    {
      label: '立即同步',
      enabled: agentState.connected && configured && !status?.paused,
      click: () => { void runAgentAction(() => requireAgentClient().syncNow()) },
    },
    {
      label: status?.paused ? '继续同步' : '暂停同步',
      enabled: agentState.connected && configured,
      click: () => { void runAgentAction(() => requireAgentClient().setPaused(!status?.paused)) },
    },
    { type: 'separator' },
    {
      label: '退出 xDrive 桌面版',
      click: () => {
        requestDesktopQuit('tray-menu')
      },
    },
  ]))
}

function createTray() {
  tray = new Tray(trayStatusImage())
  tray.on('click', showMainWindow)
  rebuildTrayMenu()
}

function showDesktopNotification(title: string, body: string, view?: DesktopViewTarget) {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.on('click', () => {
    if (view) showDesktopView(view)
    else showMainWindow()
  })
  notification.show()
}

function resetSourceRunNotificationState() {
  sourceRunNotificationInitialized = false
  sourceRunNotificationState.clear()
}

function notifyAgentTransition(previous: AgentConnectionState, next: AgentConnectionState) {
  if (!previous.connected || !next.connected || !previous.status || !next.status) return

  const before = previous.status
  const after = next.status
  if (after.conflict_count > before.conflict_count) {
    requestTaskbarAttention()
    showDesktopNotification('xDrive 冲突', `${after.conflict_count} 个未解决冲突需要处理。`, 'conflicts')
  } else if (before.sync_status === '正在同步' && after.sync_status === '同步正常') {
    showDesktopNotification('xDrive', '同步已完成。', 'transfers')
  }

  if (before.auth_status !== after.auth_status && (after.auth_status === '登录已过期' || after.auth_status === '账户已禁用')) {
    requestTaskbarAttention()
    showDesktopNotification('xDrive', 'xDrive 登录状态需要处理，请打开 xDrive 桌面版重新登录。')
  }
  if (after.last_error && after.last_error !== before.last_error && !after.has_conflict) {
    requestTaskbarAttention()
  }
}

function notifyUpdateTransition(previous: AgentUpdateState | null, next: AgentUpdateState | null) {
  if (!next) return
  if (next.status === 'available' && previous?.status !== 'available') {
    const details = [
      next.latest_version ? `新版本 ${next.latest_version}` : '发现新的 xDrive 客户端版本',
      next.published_at ? `发布于 ${new Date(next.published_at).toLocaleString()}` : '',
      next.release_name && next.release_name !== next.latest_version ? next.release_name : '',
    ].filter(Boolean)
    showDesktopNotification(
      'xDrive 有可用更新',
      details.join(' · '),
      'settings-update',
    )
  }
  if (next.status === 'downloaded' && previous?.status !== 'downloaded') {
    showDesktopNotification(
      'xDrive 更新已下载',
      next.latest_version ? `版本 ${next.latest_version} 已下载并通过校验，可开始安装。` : '客户端更新已下载并通过校验，可开始安装。',
      'settings-update',
    )
  }
}

function publishAgentState(next: AgentConnectionState) {
  const previous = agentState
  const changed = JSON.stringify(previous) !== JSON.stringify(next)
  if (
    previous.status &&
    next.status &&
    (
      previous.status.configured !== next.status.configured ||
      previous.status.auth_status !== next.status.auth_status
    )
  ) {
    resetSourceRunNotificationState()
  }
  if (changed) notifyAgentTransition(previous, next)
  agentState = next
  rebuildTrayMenu()
  updateTaskbarOverlay()
  updateTaskbarProgress()
  if (changed && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:state', next)
}

function publishAgentTransfers(next: AgentTransfers) {
  const changed = JSON.stringify(agentTransfers) !== JSON.stringify(next)
  agentTransfers = next
  rebuildTrayMenu()
  updateTaskbarProgress()
  if (changed && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:transfers', next)
  }
}

function publishAgentUpdate(next: AgentUpdateState | null) {
  const previous = agentUpdateState
  const changed = JSON.stringify(previous) !== JSON.stringify(next)
  if (changed) notifyUpdateTransition(previous, next)
  agentUpdateState = next
  if (changed) rebuildTrayMenu()
  updateTaskbarProgress()
}

function withDesktopCompatibility(report: AgentDiagnosticReport, hello: AgentHello): AgentDiagnosticReport {
  const compatibility = {
    name: '桌面版 / Agent 兼容性',
    status: 'PASS' as const,
    detail: `桌面版 ${app.getVersion()} · Agent ${hello.agent_version} · IPC 桌面版 ${AgentIPCClient.protocolMin}-${AgentIPCClient.protocolMax} / Agent ${hello.protocol_min}-${hello.protocol_max}`,
  }
  const desktopChecks: AgentDiagnosticReport['checks'] = [compatibility]
  if (process.platform === 'win32' && app.isPackaged) {
    desktopChecks.push({
      name: 'Windows 任务栏快捷操作',
      status: windowsUserTasksDiagnostic.status,
      detail: windowsUserTasksDiagnostic.detail,
    })
    desktopChecks.push({
      name: '桌面图形加速',
      status: hardwareAccelerationDisabled ? 'WARN' : 'PASS',
      detail: hardwareAccelerationDisabled
        ? '检测到重复 GPU 崩溃后已禁用硬件加速，当前运行在兼容模式。'
        : '硬件加速已启用；重复 GPU 崩溃时会自动切换到兼容模式。',
    })
  }
  const checks = [...report.checks, ...desktopChecks]
  return {
    ...report,
    checks,
    summary: {
      pass: checks.filter((check) => check.status === 'PASS').length,
      warn: checks.filter((check) => check.status === 'WARN').length,
      fail: checks.filter((check) => check.status === 'FAIL').length,
    },
  }
}

function formatDesktopDiagnosticReport(report: AgentDiagnosticReport) {
  const lines = [
    'xDrive diagnostic report',
    `generated: ${report.generated_at}`,
    `platform: ${report.platform}/${report.arch}`,
    'redaction: secrets/tokens/session IDs are never printed; home paths are shortened',
    '',
    ...report.checks.map((check) => `[${check.status}] ${check.name.padEnd(20)} ${check.detail}`),
    '',
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    report.summary.fail === 0 ? 'doctor result: usable; review warnings if present' : 'doctor result: attention required',
    '',
  ]
  return lines.join('\n')
}

function agentError(error: unknown) {
  if (error instanceof AgentIPCError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.status ? { status: error.status } : {}),
      ...(error.detail ? { detail: error.detail } : {}),
    }
  }
  return { code: 'desktop_error', message: error instanceof Error ? error.message : 'Desktop operation failed.' }
}

function isUnavailable(error: unknown) {
  return error instanceof AgentIPCError &&
    (error.code === 'agent_unavailable' || error.code === 'invalid_discovery' || error.code === 'unsupported_ipc_version')
}

function requireAgentClient() {
  if (!agentClient) throw new AgentIPCError('agent_unavailable', 0, 'xdrive-agent Desktop IPC is not initialized.')
  return agentClient
}

function requireAgentLifecycle() {
  if (!agentLifecycle) throw new AgentIPCError('agent_unavailable', 0, 'xdrive-agent lifecycle is not initialized.')
  return agentLifecycle
}

function normalizeCloudBatchItems(value: unknown): AgentCloudBatchNodeRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new AgentIPCError('invalid_input', 0, 'Batch items must contain between 1 and 200 entries.')
  }
  return value.map((item) => {
    if (
      typeof item !== 'object' || item === null ||
      typeof (item as { id?: unknown }).id !== 'number' ||
      !Number.isSafeInteger((item as { id: number }).id) ||
      (item as { id: number }).id <= 0 ||
      typeof (item as { revision?: unknown }).revision !== 'number' ||
      !Number.isSafeInteger((item as { revision: number }).revision) ||
      (item as { revision: number }).revision <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Each batch item requires a positive id and revision.')
    }
    return { id: (item as { id: number }).id, revision: (item as { revision: number }).revision }
  })
}

function normalizeCloudFileOperationType(value: unknown): 'copy' | 'move' | 'delete' {
  if (value === 'copy' || value === 'move' || value === 'delete') return value
  throw new AgentIPCError('invalid_input', 0, 'File operation type must be copy, move, or delete.')
}

function normalizeCloudFileOperationID(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentIPCError('invalid_input', 0, 'File operation id is required.')
  }
  return value.trim()
}

function normalizeFilePropertiesRequestID(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 160
  ) {
    throw new AgentIPCError('invalid_input', 0, 'File Properties request id is required.')
  }
  return value.trim()
}

function normalizeCloudFileOperationConflictPolicy(value: unknown): 'skip' | 'keep_both' | 'replace' {
  if (value === 'skip' || value === 'keep_both' || value === 'replace') return value
  throw new AgentIPCError(
    'invalid_input',
    0,
    'File operation conflict policy must be skip, keep_both, or replace.',
  )
}

function normalizeGalleryTimeZone(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'UTC'
  if (
    typeof value !== 'string' || value.length > 80 ||
    !/^[A-Za-z0-9_+\/-]+$/.test(value) ||
    (value !== 'UTC' && !value.includes('/'))
  ) {
    throw new AgentIPCError('invalid_input', 0, 'Media time zone must be a valid IANA name.')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    throw new AgentIPCError('invalid_input', 0, 'Media time zone must be a valid IANA name.')
  }
}

function normalizeMediaGalleryQuery(value: unknown): AgentMediaQuery {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentIPCError('invalid_input', 0, 'Media query must be an object.')
  }

  const input = value as Record<string, unknown>
  const out: AgentMediaQuery = {}
  if (input.fold_duplicates !== undefined) {
    if (typeof input.fold_duplicates !== 'boolean') {
      throw new AgentIPCError('invalid_input', 0, 'Media duplicate folding must be boolean.')
    }
    out.fold_duplicates = input.fold_duplicates
  }
  if (input.fold_member_ids !== undefined) {
    const ids = input.fold_member_ids
    if (!Array.isArray(ids) || ids.length > 512 ||
        !ids.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
      throw new AgentIPCError('invalid_input', 0, 'Media fold members must be positive node ids.')
    }
    out.fold_member_ids = [...new Set(ids)]
    out.fold_duplicates = false
  }
  if (input.time_zone !== undefined) {
    out.time_zone = normalizeGalleryTimeZone(input.time_zone)
  }
  if (input.search !== undefined) {
    if (typeof input.search !== 'string' || [...input.search].length > 200) {
      throw new AgentIPCError('invalid_input', 0, 'Media search must be at most 200 characters.')
    }
    const search = input.search.trim()
    if (search) out.search = search
  }
  if (input.asset_kind !== undefined) {
    if (
      typeof input.asset_kind !== 'string' ||
      !['image', 'video', 'live_photo', 'raw_pair', 'sidecar', 'burst'].includes(input.asset_kind)
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media asset kind is invalid.')
    }
    out.asset_kind = input.asset_kind
  }
  if (input.category !== undefined) {
    if (
      typeof input.category !== 'string' ||
      !['gif', 'panorama'].includes(input.category)
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media category is invalid.')
    }
    out.category = input.category
  }
  for (const [key, label] of [
    ['cameras', 'camera'],
    ['formats', 'format'],
  ] as const) {
    const raw = input[key]
    if (raw === undefined) continue
    if (
      !Array.isArray(raw) ||
      raw.length > 32 ||
      !raw.every((value) => (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        [...value.trim()].length <= 160
      ))
    ) {
      throw new AgentIPCError('invalid_input', 0, `Media ${label} filters are invalid.`)
    }
    out[key] = Array.from(new Set(
      raw.map((value) => (value as string).trim().toLowerCase()),
    )).sort()
  }
  if (input.folder_id !== undefined) {
    if (
      typeof input.folder_id !== 'number' ||
      !Number.isSafeInteger(input.folder_id) ||
      input.folder_id <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media folder id is invalid.')
    }
    out.folder_id = input.folder_id
  }
  if (input.include_descendants !== undefined) {
    if (typeof input.include_descendants !== 'boolean') throw new AgentIPCError('invalid_input', 0, 'Media include-descendants scope must be boolean.')
    if (input.include_descendants && !out.folder_id) throw new AgentIPCError('invalid_input', 0, 'Media include-descendants scope requires a folder.')
    out.include_descendants = input.include_descendants
  }
  for (const key of ['captured_from', 'captured_to'] as const) {
    const raw = input[key]
    if (raw === undefined) continue
    if (typeof raw !== 'string') {
      throw new AgentIPCError('invalid_input', 0, 'Media capture time must be an ISO date.')
    }
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) {
      throw new AgentIPCError('invalid_input', 0, 'Media capture time must be an ISO date.')
    }
    out[key] = date.toISOString()
  }
  if (
    out.captured_from &&
    out.captured_to &&
    new Date(out.captured_from).getTime() >= new Date(out.captured_to).getTime()
  ) {
    throw new AgentIPCError('invalid_input', 0, 'Media capture start must be before end.')
  }
  if (input.has_location !== undefined) {
    if (typeof input.has_location !== 'boolean') {
      throw new AgentIPCError('invalid_input', 0, 'Media location filter must be boolean.')
    }
    out.has_location = input.has_location
  }
  if (input.favorite !== undefined) {
    if (typeof input.favorite !== 'boolean') {
      throw new AgentIPCError('invalid_input', 0, 'Media favorite filter must be boolean.')
    }
    out.favorite = input.favorite
  }
  if (input.tag !== undefined) {
    if (typeof input.tag !== 'string' || [...input.tag].length > 64) {
      throw new AgentIPCError('invalid_input', 0, 'Media tag must be at most 64 characters.')
    }
    const tag = input.tag.trim()
    if (tag) out.tag = tag
  }
  if (input.person !== undefined) {
    if (typeof input.person !== 'string' || [...input.person].length > 64) {
      throw new AgentIPCError('invalid_input', 0, 'Media person must be at most 64 characters.')
    }
    const person = input.person.trim()
    if (person) out.person = person
  }
  if (input.person_identity !== undefined) {
    if (
      typeof input.person_identity !== 'string' ||
      !/^person:v1:[0-9a-f-]{36}$/.test(input.person_identity.trim())
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Durable person id is invalid.')
    }
    out.person_identity = input.person_identity.trim()
  }
  if (input.place !== undefined) {
    if (
      typeof input.place !== 'string' ||
      input.place.length > 64 ||
      !/^place:-?\d+:-?\d+$/.test(input.place.trim())
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media place filter is invalid.')
    }
    out.place = input.place.trim()
  }
  return out
}


function normalizeMediaGalleryQueryForAgent(hello: AgentHello, value: unknown): AgentMediaQuery {
  const query = normalizeMediaGalleryQuery(value)
  if (query.include_descendants) requireAgentCapability(hello, 'media-folder-recursive')
  return query
}

function normalizeMediaRangeWindow(limit: unknown, offset: unknown) {
  const requestedLimit = limit === undefined ? 200 : limit
  const requestedOffset = offset === undefined ? 0 : offset
  if (
    typeof requestedLimit !== 'number' ||
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 500
  ) {
    throw new AgentIPCError('invalid_input', 0, 'Media range limit must be between 1 and 500.')
  }
  if (
    typeof requestedOffset !== 'number' ||
    !Number.isSafeInteger(requestedOffset) ||
    requestedOffset < 0
  ) {
    throw new AgentIPCError('invalid_input', 0, 'Media range offset must be zero or greater.')
  }
  return { limit: requestedLimit, offset: requestedOffset }
}

function requireAgentCapability(hello: AgentHello, capability: string) {
  if (!hello.capabilities.includes(capability)) {
    throw new AgentIPCError(
      'unsupported_capability',
      0,
      `xdrive-agent ${hello.agent_version} does not support ${capability}. Update the unified xDrive client.`,
    )
  }
}

async function refreshAgentState() {
  try {
    const hello = await requireAgentLifecycle().ensureRunning()
    const status = await requireAgentClient().status()
    const next: AgentConnectionState = { connected: true, hello, status }
    publishAgentState(next)
    return next
  } catch (error) {
    const next: AgentConnectionState = { connected: false, error: agentError(error).message }
    publishAgentState(next)
    return next
  }
}

async function runAgentAction<T>(operation: () => Promise<T>, refresh = true): Promise<DesktopResult<T>> {
  try {
    const data = await operation()
    if (refresh) await refreshAgentState()
    return { ok: true, data }
  } catch (error) {
    // refresh=false is used by renderer reads/background probes. Those requests
    // may report their own error, but the long-lived Agent monitor remains the
    // owner of global connected/disconnected transitions.
    if (refresh && isUnavailable(error)) {
      publishAgentState({ connected: false, error: agentError(error).message })
    }
    return { ok: false, error: agentError(error) }
  }
}

async function attemptAutomaticLogin() {
  const profile = automaticLoginProfile(loginHistory)
  if (!profile || !profile.encrypted_password || !securePasswordStorageAvailable()) return
  if (!agentState.connected || agentState.status?.configured) return

  lastAutoLoginError = ''
  try {
    const password = decryptLoginPassword(profile.encrypted_password)
    const result = await runAgentAction(() => requireAgentClient().login({
      server: profile.server,
      username: profile.username,
      password,
      ...(profile.mount_path ? { mount_path: profile.mount_path } : {}),
    }))
    if (!result.ok) {
      lastAutoLoginError = result.error.message || '自动登录失败，请手动登录。'
      loginHistory = disableAutomaticLogin(loginHistory)
      await persistLoginHistoryBestEffort()
      lifecycleLog?.record('auto_login_failed', { code: result.error.code, status: result.error.status })
      return
    }
    lastAutoLoginError = ''
  } catch (error) {
    lastAutoLoginError = formatLifecycleError(error)
    loginHistory = disableAutomaticLogin(loginHistory)
    await persistLoginHistoryBestEffort()
    lifecycleLog?.record('auto_login_failed', { error: lastAutoLoginError })
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function startAgentMonitor() {
  agentMonitor?.abort()
  const monitor = new AbortController()
  agentMonitor = monitor
  void (async () => {
    while (!monitor.signal.aborted) {
      try {
        const hello = await requireAgentLifecycle().ensureRunning()
        const status = await requireAgentClient().status(monitor.signal)
        publishAgentState({ connected: true, hello, status })
        let revision = status.revision
        while (!monitor.signal.aborted) {
          const event = await requireAgentClient().events(revision, 25_000, monitor.signal)
          if (!event) continue
          revision = event.revision
          publishAgentState({ connected: true, hello, status: event.status })
        }
      } catch (error) {
        if (monitor.signal.aborted) return
        publishAgentState({ connected: false, error: agentError(error).message })
        requireAgentClient().invalidate()
        if (error instanceof AgentIPCError && error.code === 'incompatible_agent') {
          await wait(5_000, monitor.signal)
        } else {
          await wait(1_000, monitor.signal)
        }
      }
    }
  })()
}

function startTransferMonitor() {
  transferMonitor?.abort()
  const monitor = new AbortController()
  transferMonitor = monitor
  void (async () => {
    while (!monitor.signal.aborted) {
      try {
        const hello = await requireAgentLifecycle().ensureRunning()
        if (!hello.capabilities.includes('transfers') || !hello.capabilities.includes('transfer-events')) {
          publishAgentTransfers({ revision: 0, transfers: [] })
          await wait(5_000, monitor.signal)
          continue
        }
        const snapshot = await requireAgentClient().transfers()
        publishAgentTransfers(snapshot)
        let revision = snapshot.revision
        while (!monitor.signal.aborted) {
          const event = await requireAgentClient().transferEvents(revision, 25_000, monitor.signal)
          if (!event) continue
          revision = event.revision
          publishAgentTransfers({ revision: event.revision, transfers: event.transfers })
        }
      } catch {
        if (monitor.signal.aborted) return
        requireAgentClient().invalidate()
        await wait(1_000, monitor.signal)
      }
    }
  })()
}

function publishSourceRunSnapshot(rows: Array<{ source: AgentSource; run?: AgentSourceRun }>) {
  const initializing = !sourceRunNotificationInitialized
  const sourceIDs = new Set<number>()

  for (const row of rows) {
    sourceIDs.add(row.source.id)
    const run = row.run
    const previous = sourceRunNotificationState.get(row.source.id)
    if (!run) {
      sourceRunNotificationState.delete(row.source.id)
      continue
    }
    sourceRunNotificationState.set(row.source.id, { runID: run.id, status: run.status })

    const becameTerminal = sourceRunIsTerminal(run.status) && (
      !previous ||
      previous.runID !== run.id ||
      !sourceRunIsTerminal(previous.status)
    )
    if (!initializing && becameTerminal) {
      const presentation = sourceRunNotificationPresentation(row.source, run)
      showDesktopNotification(presentation.title, presentation.body, 'sources')
    }
  }

  for (const sourceID of [...sourceRunNotificationState.keys()]) {
    if (!sourceIDs.has(sourceID)) sourceRunNotificationState.delete(sourceID)
  }
  sourceRunNotificationInitialized = true
}

function startSourceRunMonitor() {
  sourceRunMonitor?.abort()
  const monitor = new AbortController()
  sourceRunMonitor = monitor
  void (async () => {
    while (!monitor.signal.aborted) {
      try {
        const hello = await requireAgentLifecycle().ensureRunning()
        if (!hello.capabilities.includes('external-sources')) {
          resetSourceRunNotificationState()
          await wait(30_000, monitor.signal)
          continue
        }
        const sources = await requireAgentClient().sources()
        const rows = await Promise.all(sources.map(async (source) => ({
          source,
          run: (await requireAgentClient().sourceRuns(source.id, 1, 0))[0],
        })))
        publishSourceRunSnapshot(rows)
        const active = rows.some((row) => row.run?.status === 'running') ||
          sources.some((source) => Boolean(source.run_requested_at))
        await wait(active ? 3_000 : 15_000, monitor.signal)
      } catch {
        if (monitor.signal.aborted) return
        await wait(5_000, monitor.signal)
      }
    }
  })()
}

function restartDesktopMonitors() {
  startAgentMonitor()
  startTransferMonitor()
  startSourceRunMonitor()
  startUpdateMonitor()
}

function startUpdateMonitor() {
  updateMonitor?.abort()
  const monitor = new AbortController()
  updateMonitor = monitor
  void (async () => {
    while (!monitor.signal.aborted) {
      try {
        const hello = await requireAgentLifecycle().ensureRunning()
        if (!hello.capabilities.includes('client-update')) {
          publishAgentUpdate(null)
          await wait(30_000, monitor.signal)
          continue
        }
        const state = await requireAgentClient().updateState()
        publishAgentUpdate(state)
        const active = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing'
        await wait(active ? 1_000 : 15_000, monitor.signal)
      } catch {
        if (monitor.signal.aborted) return
        publishAgentUpdate(null)
        await wait(5_000, monitor.signal)
      }
    }
  })()
}

function normalizeSourceCredentialPayload(value: unknown): Record<string, string> | null {
  if (typeof value === 'string') {
    const cookie = value.trim()
    return cookie ? { cookie } : null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim() || typeof item !== 'string') return null
    out[key] = item
  }
  return Object.keys(out).length ? out : null
}

function registerIPCHandlers() {
  ipcMain.handle('desktop:get-info', () => ({
    ...desktopBuildInfo,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }))
  ipcMain.handle('desktop:get-startup', () => ({ start_at_login: desktopPreferences.start_at_login }))
  ipcMain.handle('desktop:get-preferences', () => publicDesktopPreferences())
  ipcMain.handle('desktop:get-login-history', () => loginHistorySnapshot())
  ipcMain.handle('desktop:get-browser-cache', async () => {
    try {
      const usedBytes = await session.defaultSession.getCacheSize()
      return { ok: true, data: { used_bytes: usedBytes } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('desktop:clear-browser-cache', async () => {
    try {
      const before = await session.defaultSession.getCacheSize()
      await session.defaultSession.clearCache()
      const after = await session.defaultSession.getCacheSize()
      return {
        ok: true,
        data: {
          released_bytes: Math.max(0, before - after),
          cleared_entries: 0,
        },
      }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('desktop:probe-server', async (_event, serverValue: unknown) => {
    if (typeof serverValue !== 'string' || !serverValue.trim()) {
      return { ok: false, error: { code: 'invalid_input', message: 'Server is required.' } }
    }
    return probeDesktopServer(serverValue)
  })
  ipcMain.handle('desktop:clear-saved-password', async (_event, serverValue: unknown, usernameValue: unknown) => {
    if (typeof serverValue !== 'string' || typeof usernameValue !== 'string') {
      return { ok: false, error: { code: 'invalid_input', message: 'Server and username are required.' } }
    }
    const server = serverValue.trim()
    const username = usernameValue.trim()
    if (!server || !username) {
      return { ok: false, error: { code: 'invalid_input', message: 'Server and username are required.' } }
    }
    loginHistory = clearSavedPassword(loginHistory, server, username)
    await persistLoginHistoryBestEffort()
    lastAutoLoginError = ''
    return { ok: true, data: loginHistorySnapshot() }
  })
  ipcMain.handle('desktop:get-window-state', () => desktopWindowState())
  ipcMain.on('desktop:window-minimize', () => mainWindow?.minimize())
  ipcMain.on('desktop:window-toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('desktop:window-close', () => mainWindow?.close())
  ipcMain.handle('desktop:set-startup', async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: { code: 'invalid_input', message: 'start_at_login must be a boolean.' } }
    }
    try {
      return { ok: true, data: await setStartAtLogin(enabled) }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('desktop:set-close-to-tray', async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: { code: 'invalid_input', message: 'close_to_tray must be a boolean.' } }
    }
    try {
      return { ok: true, data: await setCloseToTray(enabled) }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('desktop:set-appearance', async (_event, appearance: unknown) => {
    if (appearance !== 'system' && appearance !== 'light' && appearance !== 'dark') {
      return { ok: false, error: { code: 'invalid_input', message: 'appearance must be system, light, or dark.' } }
    }
    try {
      return { ok: true, data: await setAppearance(appearance) }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('desktop:open-external', async (_event, rawURL: unknown) => {
    if (typeof rawURL !== 'string') return { ok: false, error: { code: 'invalid_input', message: 'URL is required.' } }
    try {
      const parsed = new URL(rawURL)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, error: { code: 'invalid_input', message: 'Only HTTP(S) release links are allowed.' } }
      }
      await shell.openExternal(parsed.toString())
      return { ok: true, data: { opened: true } }
    } catch {
      return { ok: false, error: { code: 'invalid_input', message: 'Release URL is invalid.' } }
    }
  })
  ipcMain.handle('desktop:select-directory', async (_event, defaultPath?: unknown) => {
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], title: '选择 xDrive 同步文件夹' }
    if (typeof defaultPath === 'string' && defaultPath.trim()) options.defaultPath = defaultPath
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  // The Renderer provides only a Source ID. It cannot nominate a local OS
  // path: Electron MAIN opens a native picker and sends its result to Agent.
  ipcMain.handle('desktop:authorize-local-folder', (_event, sourceID: unknown) =>
    runAgentAction<{ cancelled: boolean; grant?: AgentLocalFolderGrant }>(async () => {
      if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
        throw new AgentIPCError('invalid_input', 0, 'Source ID must be a positive integer.')
      }
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'local-folder-root-grants')
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new AgentIPCError('agent_unavailable', 0, 'Desktop window is unavailable for folder authorization.')
      }
      const selected = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择要主动同步的本机文件夹',
      })
      if (selected.canceled || !selected.filePaths[0]) return { cancelled: true }
      return {
        cancelled: false,
        grant: await requireAgentClient().authorizeLocalFolder(sourceID, selected.filePaths[0]),
      }
    }, false),
  )
  ipcMain.on('desktop:start-native-drag-out', (event, relativePathValue: unknown) => {
    if (!desktopNativeDragOutSupported()) return
    if (typeof relativePathValue !== 'string') return
    try {
      const file = resolveDesktopNativeDragOutPath(
        agentState.status?.mount_path,
        relativePathValue,
      )
      event.sender.startDrag({
        file,
        icon: desktopWindowIcon ?? nativeImage.createEmpty(),
      })
    } catch {
      // Native drag is a pointer gesture. Invalid/stale local paths simply do
      // not start an OS drag and never expose the resolved absolute path.
    }
  })

  ipcMain.handle('agent:get-state', () => agentState)
  ipcMain.handle('agent:get-transfers', () => agentTransfers)
  ipcMain.handle('agent:get-storage-tree', () => runAgentAction<AgentStorageTreeNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'storage-tree')
    return requireAgentClient().storageTree()
  }, false))
  ipcMain.handle('agent:get-cache', () => runAgentAction<AgentCacheStats>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cache-management')
    return requireAgentClient().cacheStats()
  }, false))
  ipcMain.handle('agent:get-local-disk-space', () => runAgentAction<AgentLocalDiskSpace>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'local-disk-space')
    return requireAgentClient().localDiskSpace()
  }, false))
  ipcMain.handle('agent:release-cache', () => runAgentAction<AgentCacheReleaseResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cache-management')
    return requireAgentClient().releaseCache()
  }, false))
  ipcMain.handle('agent:get-sources', () => runAgentAction<AgentSource[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    return requireAgentClient().sources()
  }, false))
  // Read-only, owner-scoped B projection. Never feed another device through
  // generic Source, RunFailure or SourceItem IPC.
  ipcMain.handle('agent:get-device-backup-local-device', () => runAgentAction<AgentVerifiedLocalDevice>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'device-backup-local-device')
    return requireAgentClient().verifiedLocalDevice()
  }, false))
  ipcMain.handle('agent:get-device-backup-local-drafts', (_event, limit: unknown = 20, afterID: unknown = 0) =>
    runAgentAction<AgentLocalSourceDraftPage>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'device-backup-local-drafts')
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        typeof afterID !== 'number' || !Number.isSafeInteger(afterID) || afterID < 0) {
        throw new AgentIPCError('invalid_input', 0, 'Local draft limit or cursor is invalid.')
      }
      return requireAgentClient().deviceBackupLocalDrafts(limit, afterID)
    }, false))
  ipcMain.handle('agent:get-device-backups', () => runAgentAction<AgentDeviceBackupOverview>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'device-backup-read')
    return requireAgentClient().deviceBackups()
  }, false))
  ipcMain.handle('agent:get-device-backup-runs', (_event, sourceID: unknown, limit: unknown, offset: unknown) => runAgentAction<AgentDeviceBackupRunPage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'device-backup-read')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Backup source id must be positive.')
    }
    const requestedLimit = limit === undefined ? 20 : limit
    if (typeof requestedLimit !== 'number' || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      throw new AgentIPCError('invalid_input', 0, 'Backup run limit must be between 1 and 100.')
    }
    const requestedOffset = offset === undefined ? 0 : offset
    if (typeof requestedOffset !== 'number' || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Backup run offset must be zero or greater.')
    }
    return requireAgentClient().deviceBackupRuns(sourceID, requestedLimit, requestedOffset)
  }, false))

  ipcMain.handle('agent:get-source-runs', (_event, sourceID: unknown, limit: unknown, offset: unknown) => runAgentAction<AgentSourceRun[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    const requestedLimit = limit === undefined ? 1 : limit
    if (typeof requestedLimit !== 'number' || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
      throw new AgentIPCError('invalid_input', 0, 'Source run limit must be between 1 and 200.')
    }
    const requestedOffset = offset === undefined ? 0 : offset
    if (typeof requestedOffset !== 'number' || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source run offset must be zero or greater.')
    }
    return requireAgentClient().sourceRuns(sourceID, requestedLimit, requestedOffset)
  }, false))

  ipcMain.handle('agent:get-source-run-failures', (_event, sourceID: unknown, runID: unknown, limit: unknown, offset: unknown) => runAgentAction<AgentSourceRunFailure[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    if (typeof runID !== 'string' || !runID.trim()) {
      throw new AgentIPCError('invalid_input', 0, 'Source run id is required.')
    }
    const requestedLimit = limit === undefined ? 20 : limit
    if (typeof requestedLimit !== 'number' || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
      throw new AgentIPCError('invalid_input', 0, 'Source run failure limit must be between 1 and 1000.')
    }
    const requestedOffset = offset === undefined ? 0 : offset
    if (typeof requestedOffset !== 'number' || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source run failure offset must be zero or greater.')
    }
    return requireAgentClient().sourceRunFailures(sourceID, runID.trim(), requestedLimit, requestedOffset)
  }, false))
  ipcMain.handle('agent:cancel-source-run', (_event, sourceID: unknown, runID: unknown) => runAgentAction<AgentSourceRun>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof runID !== 'string' || !runID.trim()
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Source id and run id are required.')
    }
    return requireAgentClient().cancelSourceRun(sourceID, runID.trim())
  }, false))
  ipcMain.handle('agent:get-media-item', (event, nodeID: unknown, requestIDValue: unknown) =>
    runAgentAction<AgentMediaItem>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      requireAgentCapability(hello, 'media-item-properties')
      if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
        throw new AgentIPCError('invalid_input', 0, 'Media node id must be a positive integer.')
      }
      const requestID = normalizeFilePropertiesRequestID(requestIDValue)
      if (mediaItemRequests.has(requestID)) {
        throw new AgentIPCError('invalid_input', 0, 'Duplicate media property request id.')
      }
      if (cancelledMediaItemRequests.delete(requestID)) {
        throw new AgentIPCError('aborted', 0, 'Media property request was cancelled.')
      }
      const controller = new AbortController()
      mediaItemRequests.set(requestID, controller)
      const onDestroyed = () => controller.abort()
      event.sender.once('destroyed', onDestroyed)
      try {
        return await requireAgentClient().mediaItem(nodeID, controller.signal)
      } finally {
        event.sender.removeListener('destroyed', onDestroyed)
        if (mediaItemRequests.get(requestID) === controller) {
          mediaItemRequests.delete(requestID)
        }
      }
    }, false))
  ipcMain.handle('agent:cancel-media-item', (_event, requestIDValue: unknown) =>
    runAgentAction(async () => {
      const requestID = normalizeFilePropertiesRequestID(requestIDValue)
      const controller = mediaItemRequests.get(requestID)
      if (controller) {
        controller.abort()
      } else {
        rememberCancelledMediaItemRequest(requestID)
      }
      return { cancelled: true }
    }, false))

  ipcMain.handle('agent:get-media-items', (_event, kind: unknown = '', limit: unknown = 100, offset: unknown = 0, query: unknown = undefined) => runAgentAction<AgentMediaItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof kind !== 'string' ||
      (kind.trim() && !['image', 'video'].includes(kind.trim()))
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media kind must be image or video.')
    }
    const requestedLimit = limit === undefined ? 100 : limit
    const requestedOffset = offset === undefined ? 0 : offset
    if (
      typeof requestedLimit !== 'number' ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 500
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media limit must be between 1 and 500.')
    }
    if (
      typeof requestedOffset !== 'number' ||
      !Number.isSafeInteger(requestedOffset) ||
      requestedOffset < 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media offset must be zero or greater.')
    }
    const mediaQuery = normalizeMediaGalleryQueryForAgent(hello, query)
    if (mediaQuery.time_zone && mediaQuery.time_zone !== 'UTC') {
      requireAgentCapability(hello, 'media-timezone')
    }
    return requireAgentClient().mediaItems(
      kind.trim(),
      requestedLimit,
      requestedOffset,
      mediaQuery,
    )
  }, false))

  ipcMain.handle('agent:get-media-item-range', (
    event,
    kind: unknown = '',
    limit: unknown = 200,
    offset: unknown = 0,
    query: unknown = undefined,
    requestID: unknown = undefined,
  ) => runAgentAction<AgentMediaItemRange>(
    () => viewportRequests.run(event.sender, requestID, async (signal) => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof kind !== 'string' ||
        (kind.trim() && !['image', 'video'].includes(kind.trim()))
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Media kind must be image or video.')
      }
      const window = normalizeMediaRangeWindow(limit, offset)
      const mediaQuery = normalizeMediaGalleryQueryForAgent(hello, query)
      if (mediaQuery.time_zone && mediaQuery.time_zone !== 'UTC') {
        requireAgentCapability(hello, 'media-timezone')
      }
      return requireAgentClient().mediaItemRange(
        kind.trim(),
        window.limit,
        window.offset,
        mediaQuery,
        signal,
      )
    }),
    false,
  ))

  ipcMain.handle('agent:get-media-facets', (
    _event,
    query: unknown = undefined,
    albumID: unknown = '',
  ) => runAgentAction<AgentMediaGalleryFacets>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' ||
      (
        albumID.trim() &&
        !['folder:', 'source:', 'manual:', 'smart:'].some((prefix) => (
          albumID.trim().startsWith(prefix) &&
          albumID.trim().length > prefix.length
        ))
      )
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media album id is invalid.')
    }
    const mediaQuery = normalizeMediaGalleryQueryForAgent(hello, query)
    if (mediaQuery.time_zone && mediaQuery.time_zone !== 'UTC') {
      requireAgentCapability(hello, 'media-timezone')
    }
    return requireAgentClient().mediaFacets(
      mediaQuery,
      albumID.trim(),
    )
  }, false))

  ipcMain.handle('agent:get-media-index-status', () =>
    runAgentAction<AgentMediaGalleryIndexStatus>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-index-status')
      return requireAgentClient().mediaIndexStatus()
    }, false),
  )

  ipcMain.handle('agent:create-media-selection-snapshot', (_event, query: unknown, albumID: unknown = '', day: unknown = '') =>
    runAgentAction<AgentMediaSelectionSnapshot>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-snapshot')
      if (typeof albumID !== 'string' || typeof day !== 'string' ||
        (day !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) ||
        (albumID !== '' && !['folder:', 'source:', 'manual:', 'smart:'].some(
          (prefix) => albumID.startsWith(prefix) && albumID.length > prefix.length,
        ))) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid Gallery album or date selection.')
      }
      const normalized = normalizeMediaGalleryQueryForAgent(hello, query)
      if (normalized.fold_duplicates || normalized.fold_member_ids?.length) {
        throw new AgentIPCError('invalid_input', 0, 'Turn off duplicate folding to select an entire query.')
      }
      return requireAgentClient().createMediaSelectionSnapshot(normalized, albumID, day)
    }, false),
  )
  ipcMain.handle('agent:get-media-selection-snapshot', (_event, token: unknown, offset: unknown, limit: unknown) =>
    runAgentAction<AgentMediaSelectionSnapshotPage>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-snapshot')
      if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token) ||
        typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 ||
        typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid Gallery selection token or page.')
      }
      return requireAgentClient().getMediaSelectionSnapshot(token, offset, limit)
    }, false),
  )
  ipcMain.handle('agent:set-media-selection-excluded', (_event, token: unknown, nodeID: unknown, excluded: unknown, version: unknown) =>
    runAgentAction<AgentMediaSelectionSnapshot>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-snapshot')
      if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token) ||
        typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0 ||
        typeof excluded !== 'boolean' ||
        typeof version !== 'number' || !Number.isSafeInteger(version) || version <= 0) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid Gallery selection exclusion.')
      }
      return requireAgentClient().setMediaSelectionExcluded(token, nodeID, excluded, version)
    }, false),
  )
  ipcMain.handle('agent:delete-media-selection-snapshot', (_event, token: unknown) =>
    runAgentAction<void>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-snapshot')
      if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid Gallery selection token.')
      }
      return requireAgentClient().deleteMediaSelectionSnapshot(token)
    }, false),
  )

  ipcMain.handle('agent:submit-media-selection-favorite-job', (_event, token: unknown, version: unknown, favorite: unknown) =>
    runAgentAction<AgentMediaSelectionJob>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-jobs')
      if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token) ||
        typeof version !== 'number' || !Number.isSafeInteger(version) || version <= 0 ||
        typeof favorite !== 'boolean') {
        throw new AgentIPCError('invalid_input', 0, 'Selection token, version and favorite are required.')
      }
      return requireAgentClient().submitMediaSelectionFavoriteJob(token, version, favorite)
    }, false),
  )
  ipcMain.handle('agent:get-media-selection-job', (_event, id: unknown) =>
    runAgentAction<AgentMediaSelectionJob>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-jobs')
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new AgentIPCError('invalid_input', 0, 'Media selection job id is invalid.')
      }
      return requireAgentClient().getMediaSelectionJob(id)
    }, false),
  )
  ipcMain.handle('agent:list-media-selection-jobs', () =>
    runAgentAction<AgentMediaSelectionJob[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-jobs')
      return requireAgentClient().listMediaSelectionJobs()
    }, false),
  )
  ipcMain.handle('agent:cancel-media-selection-job', (_event, id: unknown) =>
    runAgentAction<void>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-jobs')
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new AgentIPCError('invalid_input', 0, 'Media selection job id is invalid.')
      }
      return requireAgentClient().cancelMediaSelectionJob(id)
    }, false),
  )
  ipcMain.handle('agent:retry-media-selection-job', (_event, id: unknown) =>
    runAgentAction<AgentMediaSelectionJob>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-jobs')
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new AgentIPCError('invalid_input', 0, 'Media selection job id is invalid.')
      }
      return requireAgentClient().retryMediaSelectionJob(id)
    }, false),
  )
  ipcMain.handle('agent:media-selection-job-failures', (_event, id: unknown, offset: unknown, limit: unknown) =>
    runAgentAction<AgentMediaSelectionJobFailurePage>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-selection-jobs')
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) ||
        typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 ||
        typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new AgentIPCError('invalid_input', 0, 'Media selection job page is invalid.')
      }
      return requireAgentClient().mediaSelectionJobFailures(id, offset, limit)
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-duplicate-organize-plan',
    (_event, keeperNodeID: unknown, nodeIDs: unknown) =>
      runAgentAction<AgentMediaDuplicateOrganizePlan>(async () => {
        if (typeof keeperNodeID !== 'number' || !Number.isSafeInteger(keeperNodeID) ||
            keeperNodeID <= 0 || !Array.isArray(nodeIDs) ||
            nodeIDs.length < 2 || nodeIDs.length > 32 ||
            !nodeIDs.every((id) => typeof id === 'number' &&
              Number.isSafeInteger(id) && id > 0) ||
            new Set(nodeIDs).size !== nodeIDs.length ||
            !nodeIDs.includes(keeperNodeID)) {
          throw new AgentIPCError('invalid_input', 0, 'Select a keeper and 2–32 distinct media files.')
        }
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'media-duplicate-organize-plan')
        return requireAgentClient().mediaDuplicateOrganizePlan(
          keeperNodeID, nodeIDs as number[],
        )
      }, false),
  )

  ipcMain.handle('agent:get-node-location', (event, nodeID: unknown, requestID: unknown) =>
    runAgentAction<AgentNodeLocation>(
      () => viewportRequests.run(event.sender, requestID, async (signal) => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'node-location')
        if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
          throw new AgentIPCError('invalid_input', 0, 'Node id must be a positive integer.')
        }
        if (signal?.aborted) throw new AgentIPCError('aborted', 0, 'Node location request was cancelled.')
        return requireAgentClient().nodeLocation(nodeID, signal)
      }),
      false,
    ),
  )

  ipcMain.handle(
    'agent:apply-media-duplicate-organize',
    (_event, input: unknown) =>
      runAgentAction<AgentMediaDuplicateOrganizeApplyResult>(async () => {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          throw new AgentIPCError('invalid_input', 0, 'Confirmed organization input must be an object.')
        }
        const data = input as Record<string, unknown>
        const keeper = data.keeper_node_id
        const ids = data.node_ids
        const revision = data.expected_plan_revision
        const selectedDescription = data.selected_description
        if (selectedDescription !== undefined &&
            (typeof selectedDescription !== 'string' || [...selectedDescription].length > 4096)) {
          throw new AgentIPCError('invalid_input', 0, 'The selected description is invalid or too long.')
        }
        if (typeof keeper !== 'number' || !Number.isSafeInteger(keeper) || keeper <= 0 ||
            !Array.isArray(ids) || ids.length < 2 || ids.length > 32 ||
            !ids.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
            new Set(ids).size !== ids.length || !ids.includes(keeper) ||
            typeof revision !== 'string' || !/^[0-9a-fA-F]{64}$/.test(revision) ||
            data.confirm !== true) {
          throw new AgentIPCError('invalid_input', 0, 'Select a keeper, 2–32 original files and explicitly confirm the current review.')
        }
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'media-duplicate-organize-apply')
        return requireAgentClient().mediaDuplicateOrganizeApply({
          keeper_node_id: keeper,
          node_ids: ids as number[],
          expected_plan_revision: revision,
          ...(typeof selectedDescription === 'string'
            ? { selected_description: selectedDescription }
            : {}),
          confirm: true,
        })
      }, false),
  )

  ipcMain.handle('agent:get-media-sync-folders', () =>
    runAgentAction<AgentMediaSyncFolder[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      return requireAgentClient().mediaSyncFolders()
    }, false))

  ipcMain.handle(
    'agent:get-media-sync-folder',
    (
      _event,
      sourceID: unknown,
      folderID: unknown,
    ) => runAgentAction<AgentMediaFolderView>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      for (const [value, label] of [[sourceID, 'source'], [folderID, 'folder']] as const) {
        if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value <= 0
        ) {
          throw new AgentIPCError('invalid_input', 0, `Media ${label} id is invalid.`)
        }
      }
      return requireAgentClient().mediaSyncFolder(sourceID as number, folderID as number)
    }, false),
  )

  ipcMain.handle('agent:get-media-trash', (
    _event,
    limit: unknown = 200,
    offset: unknown = 0,
  ) => runAgentAction<AgentMediaItemRange>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    const window = normalizeMediaRangeWindow(limit, offset)
    return requireAgentClient().mediaTrash(window.limit, window.offset)
  }, false))

  ipcMain.handle('agent:get-media-albums', () => runAgentAction<AgentMediaAlbum[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    return requireAgentClient().mediaAlbums()
  }, false))

  const validAlbumFolderID = (value: unknown, allowRoot = false): value is number => (
    typeof value === 'number' && Number.isSafeInteger(value) &&
    (allowRoot ? value >= 0 : value > 0)
  )
  const requireAlbumFolderCapability = async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-album-folders')
  }

  ipcMain.handle('agent:get-media-album-folders', () =>
    runAgentAction<AgentMediaAlbumFolder[]>(async () => {
      await requireAlbumFolderCapability()
      return requireAgentClient().mediaAlbumFolders()
    }, false))

  ipcMain.handle('agent:create-media-album-folder',
    (_event, name: unknown, parentID: unknown) =>
      runAgentAction<AgentMediaAlbumFolder>(async () => {
        await requireAlbumFolderCapability()
        if (typeof name !== 'string' || !name.trim() ||
          [...name.trim()].length > 200 || !validAlbumFolderID(parentID, true)) {
          throw new AgentIPCError('invalid_input', 0, 'Album folder name and parent are invalid.')
        }
        return requireAgentClient().createMediaAlbumFolder(name.trim(), parentID)
      }, false))

  ipcMain.handle('agent:update-media-album-folder',
    (_event, folderID: unknown, revision: unknown, change: unknown) =>
      runAgentAction<AgentMediaAlbumFolder>(async () => {
        await requireAlbumFolderCapability()
        if (!validAlbumFolderID(folderID) || !validAlbumFolderID(revision) ||
          typeof change !== 'object' || change === null || Array.isArray(change)) {
          throw new AgentIPCError('invalid_input', 0, 'Album folder update is invalid.')
        }
        const data = change as Record<string, unknown>
        const next: { name?: string; parent_id?: number } = {}
        if (data.name !== undefined) {
          if (typeof data.name !== 'string' || !data.name.trim() ||
            [...data.name.trim()].length > 200) {
            throw new AgentIPCError('invalid_input', 0, 'Album folder name is invalid.')
          }
          next.name = data.name.trim()
        }
        if (data.parent_id !== undefined) {
          if (!validAlbumFolderID(data.parent_id, true)) {
            throw new AgentIPCError('invalid_input', 0, 'Album folder parent is invalid.')
          }
          next.parent_id = data.parent_id
        }
        if (next.name === undefined && next.parent_id === undefined) {
          throw new AgentIPCError('invalid_input', 0, 'Album folder update requires a change.')
        }
        return requireAgentClient().updateMediaAlbumFolder(folderID, revision, next)
      }, false))

  ipcMain.handle('agent:delete-media-album-folder',
    (_event, folderID: unknown, revision: unknown) =>
      runAgentAction<{ ok: boolean }>(async () => {
        await requireAlbumFolderCapability()
        if (!validAlbumFolderID(folderID) || !validAlbumFolderID(revision)) {
          throw new AgentIPCError('invalid_input', 0, 'Album folder id and revision are invalid.')
        }
        await requireAgentClient().deleteMediaAlbumFolder(folderID, revision)
        return { ok: true }
      }, false))

  ipcMain.handle('agent:move-media-album-to-folder',
    (_event, albumID: unknown, revision: unknown, folderID: unknown) =>
      runAgentAction<AgentMediaAlbum>(async () => {
        await requireAlbumFolderCapability()
        if (typeof albumID !== 'string' ||
          !['manual:', 'smart:'].some(prefix => albumID.startsWith(prefix) && albumID.length > prefix.length) ||
          !validAlbumFolderID(revision) || !validAlbumFolderID(folderID, true)) {
          throw new AgentIPCError('invalid_input', 0, 'Album folder move is invalid.')
        }
        return requireAgentClient().moveMediaAlbumToFolder(albumID, revision, folderID)
      }, false))

  ipcMain.handle('agent:get-media-places', (_event, limit: unknown = 24) => runAgentAction<AgentMediaPlaceFacet[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    const requestedLimit = limit === undefined ? 24 : limit
    if (
      typeof requestedLimit !== 'number' ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 1000
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media place limit must be between 1 and 1000.')
    }
    return requireAgentClient().mediaPlaces(requestedLimit)
  }, false))

  ipcMain.handle(
    'agent:get-media-memories',
    (
      _event,
      anchorDate: unknown = '',
      limit: unknown = 24,
      timeZone: unknown = 'UTC',
    ) => runAgentAction<AgentMediaMemory[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      const zone = normalizeGalleryTimeZone(timeZone)
      if (zone !== 'UTC') requireAgentCapability(hello, 'media-timezone')
      const requestedAnchorDate = typeof anchorDate === 'string' ? anchorDate.trim() : ''
      if (
        requestedAnchorDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(requestedAnchorDate)
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Memory anchor date must use YYYY-MM-DD.')
      }
      const requestedLimit = limit === undefined ? 24 : limit
      if (
        typeof requestedLimit !== 'number' ||
        !Number.isSafeInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > 100
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Memory limit must be between 1 and 100.')
      }
      return requireAgentClient().mediaMemories(requestedAnchorDate, requestedLimit, zone)
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-memory-item-range',
    (
      _event,
      memoryID: unknown,
      limit: unknown = 200,
      offset: unknown = 0,
      timeZone: unknown = 'UTC',
    ) => runAgentAction<AgentMediaItemRange>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      const zone = normalizeGalleryTimeZone(timeZone)
      if (zone !== 'UTC') requireAgentCapability(hello, 'media-timezone')
      if (
        typeof memoryID !== 'string' ||
        memoryID.trim() === '' ||
        memoryID.trim().length > 128
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Memory id is invalid.')
      }
      const window = normalizeMediaRangeWindow(limit, offset)
      return requireAgentClient().mediaMemoryItemRange(
        memoryID.trim(),
        window.limit,
        window.offset,
        zone,
      )
    }, false),
  )

  const normalizeMediaCleanupLimit = (limit: unknown = 24) => {
    const requestedLimit = limit === undefined ? 24 : limit
    if (
      typeof requestedLimit !== 'number' ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 100
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Cleanup review limit must be between 1 and 100.')
    }
    return requestedLimit
  }

  const normalizeMediaCleanupOffset = (offset: unknown = 0) => {
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 10000000
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Cleanup group offset must be between 0 and 10000000.')
    }
    return offset
  }

  const normalizeMediaCleanupID = (value: unknown, label: string) => {
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.trim().length > 128
    ) {
      throw new AgentIPCError('invalid_input', 0, `${label} id is invalid.`)
    }
    return value.trim()
  }

  ipcMain.handle(
    'agent:get-media-duplicate-groups',
    (_event, limit: unknown = 24, offset: unknown = 0) => runAgentAction<AgentMediaDuplicateGroupList>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      return requireAgentClient().mediaDuplicateGroups(
        normalizeMediaCleanupLimit(limit),
        normalizeMediaCleanupOffset(offset),
      )
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-duplicate-item-range',
    (
      _event,
      duplicateID: unknown,
      limit: unknown = 200,
      offset: unknown = 0,
    ) => runAgentAction<AgentMediaItemRange>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      const window = normalizeMediaRangeWindow(limit, offset)
      return requireAgentClient().mediaDuplicateItemRange(
        normalizeMediaCleanupID(duplicateID, 'Duplicate'),
        window.limit,
        window.offset,
      )
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-burst-reviews',
    (_event, limit: unknown = 24, offset: unknown = 0) => runAgentAction<AgentMediaBurstReviewList>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      return requireAgentClient().mediaBurstReviews(
        normalizeMediaCleanupLimit(limit),
        normalizeMediaCleanupOffset(offset),
      )
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-burst-item-range',
    (
      _event,
      burstID: unknown,
      limit: unknown = 200,
      offset: unknown = 0,
    ) => runAgentAction<AgentMediaItemRange>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      const window = normalizeMediaRangeWindow(limit, offset)
      return requireAgentClient().mediaBurstReviewItemRange(
        normalizeMediaCleanupID(burstID, 'Burst'),
        window.limit,
        window.offset,
      )
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-pets',
    () => runAgentAction<AgentMediaPetFacet[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      return requireAgentClient().mediaPets()
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-pet-item-range',
    (
      _event,
      petKind: unknown,
      limit: unknown = 200,
      offset: unknown = 0,
    ) => runAgentAction<AgentMediaItemRange>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (petKind !== 'dog' && petKind !== 'cat') {
        throw new AgentIPCError('invalid_input', 0, 'Pet kind must be dog or cat.')
      }
      const window = normalizeMediaRangeWindow(limit, offset)
      return requireAgentClient().mediaPetItemRange(
        petKind,
        window.limit,
        window.offset,
      )
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-suggested-people-reviewed',
    (
      _event,
      includeReviewed: unknown = false,
      limit: unknown = 24,
    ) => runAgentAction<AgentMediaSuggestedPerson[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (typeof includeReviewed !== 'boolean') {
        throw new AgentIPCError('invalid_input', 0, 'includeReviewed must be boolean.')
      }
      const requestedLimit = limit === undefined ? 24 : limit
      if (
        typeof requestedLimit !== 'number' ||
        !Number.isSafeInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > 100
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Suggested people limit must be between 1 and 100.')
      }
      return requireAgentClient().mediaSuggestedPeopleWithReview(
        includeReviewed,
        requestedLimit,
      )
    }, false),
  )

  ipcMain.handle('agent:get-media-suggested-people', (_event, limit: unknown = 24) => runAgentAction<AgentMediaSuggestedPerson[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    const requestedLimit = limit === undefined ? 24 : limit
    if (
      typeof requestedLimit !== 'number' ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 100
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Suggested people limit must be between 1 and 100.')
    }
    return requireAgentClient().mediaSuggestedPeople(requestedLimit)
  }, false))

  ipcMain.handle(
    'agent:get-media-suggested-person-items',
    (
      _event,
      personID: unknown,
      limit: unknown = 100,
      offset: unknown = 0,
      query: unknown = undefined,
    ) => runAgentAction<AgentMediaItem[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof personID !== 'string' ||
        !/^auto:v1:[0-9a-f]{64}$/.test(personID.trim())
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Suggested person id is invalid.')
      }
      const requestedLimit = limit === undefined ? 100 : limit
      const requestedOffset = offset === undefined ? 0 : offset
      if (
        typeof requestedLimit !== 'number' ||
        !Number.isSafeInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > 500
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Media limit must be between 1 and 500.')
      }
      if (
        typeof requestedOffset !== 'number' ||
        !Number.isSafeInteger(requestedOffset) ||
        requestedOffset < 0
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Media offset must be zero or greater.')
      }
      return requireAgentClient().mediaSuggestedPersonItems(
        personID.trim(),
        requestedLimit,
        requestedOffset,
        normalizeMediaGalleryQueryForAgent(hello, query),
      )
    }, false),
  )


  ipcMain.handle(
    'agent:get-media-suggested-person-item-range',
    (
      _event,
      personID: unknown,
      limit: unknown = 200,
      offset: unknown = 0,
      query: unknown = undefined,
    ) => runAgentAction<AgentMediaItemRange>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof personID !== 'string' ||
        !/^auto:v1:[0-9a-f]{64}$/.test(personID.trim())
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Suggested person id is invalid.')
      }
      const window = normalizeMediaRangeWindow(limit, offset)
      return requireAgentClient().mediaSuggestedPersonItemRange(
        personID.trim(),
        window.limit,
        window.offset,
        normalizeMediaGalleryQueryForAgent(hello, query),
      )
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-people',
    (
      _event,
      includeHidden: unknown = false,
      limit: unknown = 100,
      offset: unknown = 0,
    ) => runAgentAction<AgentMediaPersonIdentity[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (typeof includeHidden !== 'boolean') {
        throw new AgentIPCError('invalid_input', 0, 'includeHidden must be boolean.')
      }
      if (
        typeof limit !== 'number' || !Number.isSafeInteger(limit) ||
        limit < 1 || limit > 100 ||
        typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid durable people pagination.')
      }
      return requireAgentClient().mediaPeople(includeHidden, limit, offset)
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-person-items',
    (
      _event,
      personID: unknown,
      limit: unknown = 100,
      offset: unknown = 0,
      query: unknown = undefined,
    ) => runAgentAction<AgentMediaItem[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof personID !== 'string' ||
        !/^person:v1:[0-9a-f-]{36}$/.test(personID.trim())
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Durable person id is invalid.')
      }
      if (
        typeof limit !== 'number' || !Number.isSafeInteger(limit) ||
        limit < 1 || limit > 500 ||
        typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid durable person pagination.')
      }
      return requireAgentClient().mediaPersonItems(
        personID.trim(),
        limit,
        offset,
        normalizeMediaGalleryQueryForAgent(hello, query),
      )
    }, false),
  )


  ipcMain.handle(
    'agent:get-media-person-item-range',
    (
      _event,
      personID: unknown,
      limit: unknown = 200,
      offset: unknown = 0,
      query: unknown = undefined,
    ) => runAgentAction<AgentMediaItemRange>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof personID !== 'string' ||
        !/^person:v1:[0-9a-f-]{36}$/.test(personID.trim())
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Durable person id is invalid.')
      }
      const window = normalizeMediaRangeWindow(limit, offset)
      return requireAgentClient().mediaPersonItemRange(
        personID.trim(),
        window.limit,
        window.offset,
        normalizeMediaGalleryQueryForAgent(hello, query),
      )
    }, false),
  )

  ipcMain.handle(
    'agent:review-media-suggested-person',
    (
      _event,
      suggestionID: unknown,
      state: unknown,
    ) => runAgentAction<AgentMediaPersonSuggestionReview>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof suggestionID !== 'string' ||
        !/^auto:v1:[0-9a-f]{64}$/.test(suggestionID.trim())
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Suggested person id is invalid.')
      }
      if (state !== 'pending' && state !== 'dismissed') {
        throw new AgentIPCError('invalid_input', 0, 'Review state must be pending or dismissed.')
      }
      return requireAgentClient().reviewMediaSuggestedPerson(
        suggestionID.trim(),
        state,
      )
    }, false),
  )

  ipcMain.handle(
    'agent:add-media-suggested-person-to-person',
    (
      _event,
      suggestionID: unknown,
      personID: unknown,
      revision: unknown,
    ) => runAgentAction<AgentMediaPersonIdentity>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof suggestionID !== 'string' ||
        !/^auto:v1:[0-9a-f]{64}$/.test(suggestionID.trim()) ||
        typeof personID !== 'string' ||
        !/^person:v1:[0-9a-f-]{36}$/.test(personID.trim()) ||
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Person suggestion input is invalid.')
      }
      return requireAgentClient().addMediaSuggestedPersonToPerson(
        personID.trim(),
        revision,
        suggestionID.trim(),
      )
    }, false),
  )

  ipcMain.handle(
    'agent:adopt-media-suggested-person',
    (_event, suggestionID: unknown, name: unknown = '') =>
      runAgentAction<AgentMediaPersonIdentity>(async () => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'media-gallery')
        if (
          typeof suggestionID !== 'string' ||
          !/^auto:v1:[0-9a-f]{64}$/.test(suggestionID.trim()) ||
          typeof name !== 'string'
        ) {
          throw new AgentIPCError('invalid_input', 0, 'Suggested person input is invalid.')
        }
        return requireAgentClient().adoptMediaSuggestedPerson(
          suggestionID.trim(),
          name.trim(),
        )
      }, false),
  )

  ipcMain.handle(
    'agent:update-media-person',
    (_event, personID: unknown, revision: unknown, input: unknown) =>
      runAgentAction<AgentMediaPersonIdentity>(async () => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'media-gallery')
        if (
          typeof personID !== 'string' ||
          !/^person:v1:[0-9a-f-]{36}$/.test(personID.trim()) ||
          typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
          !input || typeof input !== 'object'
        ) {
          throw new AgentIPCError('invalid_input', 0, 'Durable person update is invalid.')
        }
        const value = input as {
          name?: unknown
          hidden?: unknown
          cover_node_id?: unknown
        }
        const next: { name?: string; hidden?: boolean; cover_node_id?: number } = {}
        if (value.name !== undefined) {
          if (typeof value.name !== 'string') throw new AgentIPCError('invalid_input', 0, 'Person name is invalid.')
          next.name = value.name
        }
        if (value.hidden !== undefined) {
          if (typeof value.hidden !== 'boolean') throw new AgentIPCError('invalid_input', 0, 'Hidden flag is invalid.')
          next.hidden = value.hidden
        }
        if (value.cover_node_id !== undefined) {
          if (
            typeof value.cover_node_id !== 'number' ||
            !Number.isSafeInteger(value.cover_node_id) ||
            value.cover_node_id <= 0
          ) {
            throw new AgentIPCError('invalid_input', 0, 'Cover node id is invalid.')
          }
          next.cover_node_id = value.cover_node_id
        }
        if (Object.keys(next).length === 0) {
          throw new AgentIPCError('invalid_input', 0, 'Durable person update is empty.')
        }
        return requireAgentClient().updateMediaPerson(
          personID.trim(),
          revision,
          next,
        )
      }, false),
  )

  ipcMain.handle(
    'agent:merge-media-people',
    (_event, targetID: unknown, revision: unknown, sourceIDs: unknown) =>
      runAgentAction<AgentMediaPersonIdentity>(async () => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'media-gallery')
        if (
          typeof targetID !== 'string' ||
          !/^person:v1:[0-9a-f-]{36}$/.test(targetID.trim()) ||
          typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
          !Array.isArray(sourceIDs) || sourceIDs.length === 0 ||
          sourceIDs.some((id) => typeof id !== 'string' || !/^person:v1:[0-9a-f-]{36}$/.test(id.trim()))
        ) {
          throw new AgentIPCError('invalid_input', 0, 'Durable person merge is invalid.')
        }
        return requireAgentClient().mergeMediaPeople(
          targetID.trim(),
          revision,
          sourceIDs.map((id) => id.trim()),
        )
      }, false),
  )

  ipcMain.handle(
    'agent:split-media-person',
    (
      _event,
      personID: unknown,
      revision: unknown,
      nodeIDs: unknown,
      name: unknown = '',
    ) => runAgentAction<AgentMediaPersonSplit>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof personID !== 'string' ||
        !/^person:v1:[0-9a-f-]{36}$/.test(personID.trim()) ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
        !Array.isArray(nodeIDs) || nodeIDs.length === 0 ||
        nodeIDs.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) ||
        typeof name !== 'string'
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Durable person split is invalid.')
      }
      return requireAgentClient().splitMediaPerson(
        personID.trim(),
        revision,
        nodeIDs,
        name.trim(),
      )
    }, false),
  )

  ipcMain.handle('agent:create-media-album', (_event, name: unknown) => runAgentAction<AgentMediaAlbum>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (typeof name !== 'string' || !name.trim()) {
      throw new AgentIPCError('invalid_input', 0, 'Media album name is required.')
    }
    return requireAgentClient().createMediaAlbum(name.trim())
  }, false))

  ipcMain.handle('agent:rename-media-album', (_event, albumID: unknown, revision: unknown, name: unknown) => runAgentAction<AgentMediaAlbum>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' || !albumID.startsWith('manual:') ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      typeof name !== 'string' || !name.trim()
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Manual album id, revision, and name are required.')
    }
    return requireAgentClient().renameMediaAlbum(albumID, revision, name.trim())
  }, false))

  ipcMain.handle('agent:set-media-album-cover', (
    _event, albumID: unknown, revision: unknown, nodeID: unknown,
  ) => runAgentAction<AgentMediaAlbum>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' || !albumID.startsWith('manual:') ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID < 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Manual album id, revision and nonnegative cover Node ID are required.')
    }
    return requireAgentClient().setMediaAlbumCover(albumID, revision, nodeID)
  }, false))

  ipcMain.handle('agent:delete-media-album', (_event, albumID: unknown, revision: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' || !albumID.startsWith('manual:') ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Manual album id and revision are required.')
    }
    await requireAgentClient().deleteMediaAlbum(albumID, revision)
    return { ok: true }
  }, false))

  ipcMain.handle('agent:create-smart-media-album', (_event, name: unknown, query: unknown) => runAgentAction<AgentMediaAlbum>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (typeof name !== 'string' || !name.trim()) {
      throw new AgentIPCError('invalid_input', 0, 'Smart album name is required.')
    }
    return requireAgentClient().createSmartMediaAlbum(
      name.trim(),
      normalizeMediaGalleryQueryForAgent(hello, query),
    )
  }, false))

  ipcMain.handle(
    'agent:update-smart-media-album',
    (_event, albumID: unknown, revision: unknown, input: unknown) => runAgentAction<AgentMediaAlbum>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof albumID !== 'string' || !albumID.startsWith('smart:') ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
        !input || typeof input !== 'object'
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Smart album id, revision, and update are required.')
      }
      const value = input as { name?: unknown; query?: unknown }
      const name = value.name === undefined
        ? undefined
        : typeof value.name === 'string' && value.name.trim()
          ? value.name.trim()
          : null
      if (name === null) {
        throw new AgentIPCError('invalid_input', 0, 'Smart album name is invalid.')
      }
      const query = value.query === undefined
        ? undefined
        : normalizeMediaGalleryQueryForAgent(hello, value.query)
      if (name === undefined && query === undefined) {
        throw new AgentIPCError('invalid_input', 0, 'Smart album name or query is required.')
      }
      return requireAgentClient().updateSmartMediaAlbum(
        albumID,
        revision,
        {
          ...(name !== undefined ? { name } : {}),
          ...(query !== undefined ? { query } : {}),
        },
      )
    }, false),
  )

  ipcMain.handle('agent:delete-smart-media-album', (_event, albumID: unknown, revision: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' || !albumID.startsWith('smart:') ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Smart album id and revision are required.')
    }
    await requireAgentClient().deleteSmartMediaAlbum(albumID, revision)
    return { ok: true }
  }, false))

  ipcMain.handle('agent:add-media-album-items', (_event, albumID: unknown, revision: unknown, nodeIDs: unknown) => runAgentAction<AgentMediaAlbum>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' || !albumID.startsWith('manual:') ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      !Array.isArray(nodeIDs) || nodeIDs.length === 0 ||
      !nodeIDs.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Manual album id, revision, and media node ids are required.')
    }
    return requireAgentClient().addMediaAlbumItems(albumID, revision, nodeIDs as number[])
  }, false))

  ipcMain.handle('agent:remove-media-album-item', (_event, albumID: unknown, revision: unknown, nodeID: unknown) => runAgentAction<AgentMediaAlbum>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' || !albumID.startsWith('manual:') ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Manual album id, revision, and media node id are required.')
    }
    return requireAgentClient().removeMediaAlbumItem(albumID, revision, nodeID)
  }, false))

  ipcMain.handle('agent:get-media-album-items', (_event, albumID: unknown, limit: unknown = 100, offset: unknown = 0, query: unknown = undefined) => runAgentAction<AgentMediaItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' ||
      !(['folder:', 'source:', 'manual:', 'smart:'].some((prefix) => albumID.startsWith(prefix) && albumID.length > prefix.length))
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid media album id is required.')
    }
    const requestedLimit = limit === undefined ? 100 : limit
    const requestedOffset = offset === undefined ? 0 : offset
    if (
      typeof requestedLimit !== 'number' ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 500
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media limit must be between 1 and 500.')
    }
    if (
      typeof requestedOffset !== 'number' ||
      !Number.isSafeInteger(requestedOffset) ||
      requestedOffset < 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media offset must be zero or greater.')
    }
    return requireAgentClient().mediaAlbumItems(
      albumID,
      requestedLimit,
      requestedOffset,
      normalizeMediaGalleryQueryForAgent(hello, query),
    )
  }, false))

  ipcMain.handle('agent:get-media-album-item-range', (
    _event,
    albumID: unknown,
    limit: unknown = 200,
    offset: unknown = 0,
    query: unknown = undefined,
  ) => runAgentAction<AgentMediaItemRange>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' ||
      !(['folder:', 'source:', 'manual:', 'smart:'].some((prefix) => albumID.startsWith(prefix) && albumID.length > prefix.length))
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid media album id is required.')
    }
    const window = normalizeMediaRangeWindow(limit, offset)
    return requireAgentClient().mediaAlbumItemRange(
      albumID,
      window.limit,
      window.offset,
      normalizeMediaGalleryQueryForAgent(hello, query),
    )
  }, false))


  ipcMain.handle('agent:set-media-favorite', (_event, nodeID: unknown, favorite: unknown) => runAgentAction<AgentMediaFavorite>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof nodeID !== 'number' ||
      !Number.isSafeInteger(nodeID) ||
      nodeID <= 0 ||
      typeof favorite !== 'boolean'
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node id and favorite state are required.')
    }
    return requireAgentClient().setMediaFavorite(nodeID, favorite)
  }, false))

  ipcMain.handle('agent:set-media-favorite-batch', (_event, nodeIDs: unknown, favorite: unknown) => runAgentAction<AgentMediaBatchFavorite>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      !Array.isArray(nodeIDs) ||
      nodeIDs.length === 0 ||
      nodeIDs.length > 1000 ||
      !nodeIDs.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
      typeof favorite !== 'boolean'
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Up to 1000 media node ids and favorite state are required.')
    }
    return requireAgentClient().setMediaFavoriteBatch(nodeIDs, favorite)
  }, false))

  ipcMain.handle('agent:add-media-tags-batch', (_event, nodeIDs: unknown, tags: unknown) => runAgentAction<AgentMediaBatchTags>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      !Array.isArray(nodeIDs) ||
      nodeIDs.length === 0 ||
      nodeIDs.length > 1000 ||
      !nodeIDs.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
      !Array.isArray(tags) ||
      tags.length === 0 ||
      tags.length > 32 ||
      !tags.every((value) => typeof value === 'string')
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node ids and up to 32 tags are required.')
    }
    return requireAgentClient().addMediaTagsBatch(nodeIDs, tags)
  }, false))

  ipcMain.handle('agent:set-media-tags', (_event, nodeID: unknown, tags: unknown) => runAgentAction<AgentMediaTags>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof nodeID !== 'number' ||
      !Number.isSafeInteger(nodeID) ||
      nodeID <= 0 ||
      !Array.isArray(tags) ||
      tags.length > 32 ||
      !tags.every((value) => typeof value === 'string')
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node id and up to 32 tags are required.')
    }
    return requireAgentClient().setMediaTags(nodeID, tags)
  }, false))

  ipcMain.handle('agent:set-media-people', (_event, nodeID: unknown, people: unknown) => runAgentAction<AgentMediaPeople>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof nodeID !== 'number' ||
      !Number.isSafeInteger(nodeID) ||
      nodeID <= 0 ||
      !Array.isArray(people) ||
      people.length > 32 ||
      !people.every((value) => typeof value === 'string')
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node id and up to 32 people labels are required.')
    }
    return requireAgentClient().setMediaPeople(nodeID, people)
  }, false))

  ipcMain.handle('agent:set-media-description', (_event, nodeID: unknown, description: unknown) => runAgentAction<AgentMediaDescription>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof nodeID !== 'number' ||
      !Number.isSafeInteger(nodeID) ||
      nodeID <= 0 ||
      typeof description !== 'string' ||
      Array.from(description).length > 4096
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node id and description up to 4096 characters are required.')
    }
    return requireAgentClient().setMediaDescription(nodeID, description)
  }, false))

  ipcMain.handle(
    'agent:get-media-edit',
    (_event, nodeID: unknown) => runAgentAction<AgentMediaEditRecipe>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof nodeID !== 'number' ||
        !Number.isSafeInteger(nodeID) ||
        nodeID <= 0
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Media node id is required.')
      }
      return requireAgentClient().mediaEditRecipe(nodeID)
    }, false),
  )

  ipcMain.handle(
    'agent:save-media-edit',
    (
      _event,
      nodeID: unknown,
      input: unknown,
    ) => runAgentAction<AgentMediaEditRecipe>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof nodeID !== 'number' ||
        !Number.isSafeInteger(nodeID) ||
        nodeID <= 0 ||
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input)
      ) {
        throw new AgentIPCError(
          'invalid_input',
          0,
          'Media node id and edit recipe are required.',
        )
      }
      return requireAgentClient().saveMediaEditRecipe(
        nodeID,
        input as AgentMediaEditRecipeInput,
      )
    }, false),
  )

  ipcMain.handle(
    'agent:reset-media-edit',
    (
      _event,
      nodeID: unknown,
      revision: unknown,
    ) => runAgentAction<AgentMediaEditRecipe>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof nodeID !== 'number' ||
        !Number.isSafeInteger(nodeID) ||
        nodeID <= 0 ||
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision <= 0
      ) {
        throw new AgentIPCError(
          'invalid_input',
          0,
          'Valid media node id and edit revision are required.',
        )
      }
      return requireAgentClient().resetMediaEditRecipe(nodeID, revision)
    }, false),
  )

  ipcMain.handle(
    'agent:create-media-creative',
    (
      _event,
      nodeID: unknown,
      input: unknown,
    ) => runAgentAction<AgentMediaCreativeGeneration>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof nodeID !== 'number' ||
        !Number.isSafeInteger(nodeID) ||
        nodeID <= 0 ||
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input)
      ) {
        throw new AgentIPCError(
          'invalid_input',
          0,
          'Media node id and creative input are required.',
        )
      }
      return requireAgentClient().createMediaCreativeGeneration(
        nodeID,
        input as AgentMediaCreativeInput,
      )
    }, false),
  )

  ipcMain.handle(
    'agent:get-media-creative',
    (
      _event,
      generationID: unknown,
    ) => runAgentAction<AgentMediaCreativeGeneration>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof generationID !== 'string' ||
        generationID.trim() === '' ||
        generationID.trim().length > 64
      ) {
        throw new AgentIPCError(
          'invalid_input',
          0,
          'Creative generation id is invalid.',
        )
      }
      return requireAgentClient().mediaCreativeGeneration(generationID.trim())
    }, false),
  )

  ipcMain.handle(
    'agent:cancel-media-creative',
    (
      _event,
      generationID: unknown,
    ) => runAgentAction<AgentMediaCreativeGeneration>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'media-gallery')
      if (
        typeof generationID !== 'string' ||
        generationID.trim() === '' ||
        generationID.trim().length > 64
      ) {
        throw new AgentIPCError(
          'invalid_input',
          0,
          'Creative generation id is invalid.',
        )
      }
      return requireAgentClient().cancelMediaCreativeGeneration(generationID.trim())
    }, false),
  )

  ipcMain.handle('agent:cancel-viewport-request', (event, requestID: unknown) =>
    runAgentAction(async () => {
      viewportRequests.cancel(event.sender, requestID)
      return { cancelled: true }
    }, false),
  )

  ipcMain.handle('agent:get-baidu-map-provider', () =>
    runAgentAction<AgentBaiduMapProvider>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'baidu-static-map')
      return requireAgentClient().mediaBaiduMapProvider()
    }, false),
  )
  ipcMain.handle('agent:get-baidu-static-map', (
    event, lat: unknown, lng: unknown, zoom: unknown, width: unknown, height: unknown, requestID: unknown,
  ) => runAgentAction<AgentMediaThumbnail>(() => viewportRequests.run(event.sender, requestID, async (signal) => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'baidu-static-map')
    if (typeof lat !== 'number' || !Number.isFinite(lat) ||
        typeof lng !== 'number' || !Number.isFinite(lng) ||
        typeof zoom !== 'number' || !Number.isSafeInteger(zoom) ||
        typeof width !== 'number' || !Number.isSafeInteger(width) ||
        typeof height !== 'number' || !Number.isSafeInteger(height) ||
        lat < -85 || lat > 85 || lng < -180 || lng > 180 ||
        zoom < 3 || zoom > 18 || width < 128 || width > 512 ||
        height < 128 || height > 512) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid map parameters.')
    }
    return requireAgentClient().mediaBaiduStaticMap(lat, lng, zoom, width, height, signal)
  }), false))
  ipcMain.handle('agent:get-media-thumbnail', (event, nodeID: unknown, requestID: unknown, revision: unknown, reportProgress: unknown) =>
    runAgentAction<AgentMediaThumbnail>(
      () => viewportRequests.run(event.sender, requestID, async (signal) => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'media-gallery')
        if (
          typeof nodeID !== 'number' ||
          !Number.isSafeInteger(nodeID) ||
          nodeID <= 0
        ) {
          throw new AgentIPCError('invalid_input', 0, 'Media node id is required.')
        }
        if (revision !== undefined &&
          (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) {
          throw new AgentIPCError('invalid_input', 0, 'Thumbnail source revision is invalid.')
        }
        if (signal?.aborted) throw new AgentIPCError('aborted', 0, 'Thumbnail request was cancelled.')
        const notify = reportProgress === true && typeof requestID === 'string'
          ? (loadedBytes: number, totalBytes?: number) => {
              if (signal?.aborted || event.sender.isDestroyed()) return
              event.sender.send('agent:media-binary-progress', {
                request_id: requestID, loaded_bytes: loadedBytes, total_bytes: totalBytes,
              })
            }
          : undefined
        return requireAgentClient().mediaThumbnail(nodeID, signal,
          typeof revision === 'number' && revision > 0 ? revision : undefined, notify)
      }),
      false,
    ),
  )

  ipcMain.handle('agent:get-media-analysis-preview', (event, nodeID: unknown, requestID: unknown, reportProgress: unknown) =>
    runAgentAction<AgentMediaThumbnail>(
      () => viewportRequests.run(event.sender, requestID, async (signal) => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'media-gallery')
        if (
          typeof nodeID !== 'number' ||
          !Number.isSafeInteger(nodeID) ||
          nodeID <= 0
        ) {
          throw new AgentIPCError('invalid_input', 0, 'RAW preview node id is required.')
        }
        if (signal?.aborted) throw new AgentIPCError('aborted', 0, 'RAW preview was cancelled.')
        const notify = reportProgress === true && typeof requestID === 'string'
          ? (loadedBytes: number, totalBytes?: number) => {
              if (signal?.aborted || event.sender.isDestroyed()) return
              event.sender.send('agent:media-binary-progress', {
                request_id: requestID, loaded_bytes: loadedBytes, total_bytes: totalBytes,
              })
            }
          : undefined
        return requireAgentClient().mediaAnalysisPreview(nodeID, signal, notify)
      }),
      false,
    ),
  )

  ipcMain.handle('agent:put-media-video-poster', (_event, nodeID: unknown, revision: unknown, data: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0 ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      !(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > (4 << 20)
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid media node id, revision, and JPEG poster are required.')
    }
    await requireAgentClient().mediaVideoPoster(nodeID, revision, data)
    return { ok: true }
  }, false))

  ipcMain.handle('agent:get-media-live-photo-still', (_event, nodeID: unknown) => runAgentAction<string>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    requireAgentCapability(hello, 'file-preview-stream')
    if (
      typeof nodeID !== 'number' ||
      !Number.isSafeInteger(nodeID) ||
      nodeID <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node id is required.')
    }
    if (!filePreviewProxy) {
      throw new AgentIPCError('file_preview_unavailable', 0, 'File preview proxy is not initialized.')
    }
    const ticket = await requireAgentClient().mediaLivePhotoStillTicket(nodeID)
    return filePreviewProxy.createURLFromTicket(ticket)
  }, false))

  ipcMain.handle('agent:get-media-live-photo-motion', (
    event,
    nodeID: unknown,
    progressRequestID: unknown,
  ) => runAgentAction<string>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    requireAgentCapability(hello, 'file-preview-stream')
    if (
      typeof nodeID !== 'number' ||
      !Number.isSafeInteger(nodeID) ||
      nodeID <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node id is required.')
    }
    if (!filePreviewProxy) {
      throw new AgentIPCError('file_preview_unavailable', 0, 'File preview proxy is not initialized.')
    }
    const requestID = typeof progressRequestID === 'string' && progressRequestID.length <= 128
      ? progressRequestID
      : ''
    const ticket = await requireAgentClient().mediaLivePhotoMotionTicket(nodeID)
    return filePreviewProxy.createURLFromTicket(
      ticket,
      requestID
        ? (loadedBytes, totalBytes) => {
            if (event.sender.isDestroyed()) return
            event.sender.send('agent:media-live-photo-motion-progress', {
              request_id: requestID,
              loaded_bytes: loadedBytes,
              total_bytes: totalBytes,
            })
          }
        : undefined,
    )
  }, false))

  ipcMain.handle('agent:release-media-live-photo-motion', (_event, value: unknown) => {
    if (typeof value !== 'string' || value.length > 4096) {
      return { ok: false, error: { code: 'invalid_input', message: 'Live Photo motion URL is invalid.' } }
    }
    return { ok: true, data: { released: filePreviewProxy?.releaseURL(value) ?? false } }
  })

  ipcMain.handle('agent:get-source-items', (_event, sourceID: unknown, state: unknown = 'error', limit: unknown = 1000, offset: unknown = 0) => runAgentAction<AgentSourceItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof state !== 'string' ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid Source item query is required.')
    }
    const normalizedState = state.trim()
    if (normalizedState && !['pending', 'synced', 'missing', 'ignored', 'error'].includes(normalizedState)) {
      throw new AgentIPCError('invalid_input', 0, 'Source item state is invalid.')
    }
    return requireAgentClient().sourceItems(sourceID, normalizedState, limit, offset)
  }, false))
  ipcMain.handle('agent:get-source-collections', (_event, sourceID: unknown, state: unknown = '') => runAgentAction<AgentSourceCollection[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof state !== 'string'
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid Source collection query is required.')
    }
    const normalizedState = state.trim()
    if (normalizedState && !['active', 'missing'].includes(normalizedState)) {
      throw new AgentIPCError('invalid_input', 0, 'Source collection state is invalid.')
    }
    return requireAgentClient().sourceCollections(sourceID, normalizedState)
  }, false))
  ipcMain.handle('agent:get-source-collection-items', (_event, sourceID: unknown, collectionID: unknown, limit: unknown = 100, offset: unknown = 0) => runAgentAction<AgentSourceCollectionItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof collectionID !== 'number' || !Number.isSafeInteger(collectionID) || collectionID <= 0 ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid Source collection item query is required.')
    }
    return requireAgentClient().sourceCollectionItems(sourceID, collectionID, limit, offset)
  }, false))
  ipcMain.handle('agent:get-source-credential', (_event, sourceID: unknown) => runAgentAction<AgentSourceCredentialStatus>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    return requireAgentClient().sourceCredentialStatus(sourceID)
  }, false))
  ipcMain.handle('agent:reveal-source-credential', (_event, sourceID: unknown) => runAgentAction<AgentSourceCredentialReveal>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    return requireAgentClient().revealSourceCredential(sourceID)
  }, false))
  ipcMain.handle('agent:test-source-credential', (_event, kind: unknown, credential: unknown) => runAgentAction<AgentSourceCredentialTestResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    const payload = normalizeSourceCredentialPayload(credential)
    if (typeof kind !== 'string' || !kind.trim() || !payload) {
      throw new AgentIPCError('invalid_input', 0, 'Source kind and credential payload are required.')
    }
    return requireAgentClient().testSourceCredential(kind.trim(), payload)
  }, false))
  ipcMain.handle('agent:test-stored-source-credential', (_event, sourceID: unknown) => runAgentAction<AgentSourceCredentialTestResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    return requireAgentClient().testStoredSourceCredential(sourceID)
  }, false))
  ipcMain.handle('agent:set-source-credential', (_event, sourceID: unknown, credential: unknown) => runAgentAction<AgentSourceCredentialStatus>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    const payload = normalizeSourceCredentialPayload(credential)
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      !payload
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Source id and credential payload are required.')
    }
    return requireAgentClient().setSourceCredential(sourceID, payload)
  }, false))
  ipcMain.handle('agent:delete-source-credential', (_event, sourceID: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    return requireAgentClient().deleteSourceCredential(sourceID)
  }, false))
  ipcMain.handle('agent:get-source-connector-config', (_event, sourceID: unknown) => runAgentAction<AgentSourceConnectorConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    return requireAgentClient().sourceConnectorConfig(sourceID)
  }, false))
  ipcMain.handle('agent:browse-source-directories', (_event, sourceID: unknown, path: unknown = '', limit: unknown = 200, offset: unknown = 0) => runAgentAction<AgentSourceBrowsePage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof path !== 'string' ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid Source browse query is required.')
    }
    return requireAgentClient().browseSourceDirectories(sourceID, path, limit, offset)
  }, false))
  ipcMain.handle('agent:set-source-connector-config', (_event, sourceID: unknown, revision: unknown, payload: unknown) => runAgentAction<AgentSourceConnectorConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      typeof payload !== 'object' || payload === null || Array.isArray(payload)
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Source id, config revision, and payload are required.')
    }
    return requireAgentClient().setSourceConnectorConfig(sourceID, revision, payload as Record<string, unknown>)
  }, false))
  ipcMain.handle('agent:create-source', (_event, input: unknown) => runAgentAction<AgentSource>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof input !== 'object' || input === null) {
      throw new AgentIPCError('invalid_input', 0, 'Source input is required.')
    }
    const value = input as Partial<AgentCreateSourceInput>
    if (
      typeof value.name !== 'string' || !value.name.trim() ||
      typeof value.kind !== 'string' || !value.kind.trim() ||
      (value.direction !== 'push' && value.direction !== 'pull') ||
      value.sync_mode !== 'backup' ||
      (value.run_mode !== 'scan' && value.run_mode !== 'sync') ||
      (value.schedule_type !== undefined && value.schedule_type !== 'interval' && value.schedule_type !== 'cron' && value.schedule_type !== 'manual') ||
      (value.schedule_expression !== undefined && typeof value.schedule_expression !== 'string') ||
      (value.schedule_timezone !== undefined && typeof value.schedule_timezone !== 'string') ||
      typeof value.target_node_id !== 'number' || !Number.isSafeInteger(value.target_node_id) ||
      (value.kind === 'yike_photos' ? value.target_node_id !== 0 : value.target_node_id <= 0) ||
      (value.ignore_rules !== undefined && typeof value.ignore_rules !== 'string')
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Valid Source configuration is required.')
    }
    return requireAgentClient().createSource({
      name: value.name.trim(),
      kind: value.kind.trim(),
      direction: value.direction,
      sync_mode: value.sync_mode,
      run_mode: value.run_mode,
      target_node_id: value.target_node_id,
      ...(value.schedule_type === undefined ? {} : { schedule_type: value.schedule_type }),
      ...(value.schedule_expression === undefined ? {} : { schedule_expression: value.schedule_expression.trim() }),
      ...(value.schedule_timezone === undefined ? {} : { schedule_timezone: value.schedule_timezone.trim() }),
      ...(value.ignore_rules === undefined ? {} : { ignore_rules: value.ignore_rules }),
    })
  }, false))
  ipcMain.handle('agent:update-source', (_event, sourceID: unknown, revision: unknown, input: unknown) => runAgentAction<AgentSource>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      typeof input !== 'object' || input === null
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Source id, revision, and update are required.')
    }
    const value = input as AgentUpdateSourceInput
    if (
      (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim())) ||
      (value.run_mode !== undefined && value.run_mode !== 'scan' && value.run_mode !== 'sync') ||
      (value.status !== undefined && value.status !== 'active' && value.status !== 'paused') ||
      (value.schedule_type !== undefined && value.schedule_type !== 'interval' && value.schedule_type !== 'cron' && value.schedule_type !== 'manual') ||
      (value.schedule_expression !== undefined && typeof value.schedule_expression !== 'string') ||
      (value.schedule_timezone !== undefined && typeof value.schedule_timezone !== 'string') ||
      (value.target_node_id !== undefined && (typeof value.target_node_id !== 'number' || !Number.isSafeInteger(value.target_node_id) || value.target_node_id <= 0)) ||
      (value.ignore_rules !== undefined && typeof value.ignore_rules !== 'string')
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Source update contains invalid values.')
    }
    return requireAgentClient().updateSource(sourceID, revision, {
      ...value,
      ...(value.name === undefined ? {} : { name: value.name.trim() }),
      ...(value.schedule_expression === undefined ? {} : { schedule_expression: value.schedule_expression.trim() }),
      ...(value.schedule_timezone === undefined ? {} : { schedule_timezone: value.schedule_timezone.trim() }),
    })
  }, false))
  ipcMain.handle('agent:delete-source', (_event, sourceID: unknown, revision: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (
      typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Source id and revision are required.')
    }
    return requireAgentClient().deleteSource(sourceID, revision)
  }, false))
  ipcMain.handle('agent:trigger-source', (_event, sourceID: unknown) => runAgentAction<AgentSource>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'external-sources')
    if (typeof sourceID !== 'number' || !Number.isSafeInteger(sourceID) || sourceID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Source id is required.')
    }
    return requireAgentClient().triggerSource(sourceID)
  }, false))

  ipcMain.handle('agent:cloud-root', () => runAgentAction<AgentCloudNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudRoot()
  }, false))
  ipcMain.handle('agent:cloud-children', (_event, parentID: unknown) => runAgentAction<AgentCloudNode[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Parent node id is required.')
    }
    return requireAgentClient().cloudChildren(parentID)
  }, false))
  ipcMain.handle('agent:cloud-children-page', (_event, parentID: unknown, options: unknown) => runAgentAction<AgentCloudChildrenPage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Parent node id is required.')
    }
    const input = typeof options === 'object' && options !== null ? options as Record<string, unknown> : {}
    const limit = input.limit === undefined ? 200 : input.limit
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new AgentIPCError('invalid_input', 0, 'Directory page limit must be between 1 and 500.')
    }
    const sort = input.sort === undefined ? 'name' : input.sort
    const order = input.order === undefined ? 'asc' : input.order
    if (!['name', 'updated', 'size', 'type'].includes(String(sort)) || !['asc', 'desc'].includes(String(order))) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid directory sort options.')
    }
    const cursor = typeof input.cursor === 'string' ? input.cursor : ''
    const name = typeof input.name === 'string' ? input.name : ''
    const nameInsensitive = typeof input.nameInsensitive === 'string' ? input.nameInsensitive : ''
    return requireAgentClient().cloudChildrenPage(parentID, {
      limit,
      cursor,
      sort: sort as 'name' | 'updated' | 'size' | 'type',
      order: order as 'asc' | 'desc',
      ...(name ? { name } : {}),
      ...(nameInsensitive ? { nameInsensitive } : {}),
    })
  }, false))
  const normalizeFileExplorerGrouping = (value: unknown): AgentFileExplorerGrouping => {
    if (value === undefined || value === null) {
      return { groupBy: 'none', foldersFirst: true }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentIPCError('invalid_input', 0, 'File grouping must be an object.')
    }
    const raw = value as Record<string, unknown>
    const groupBy = raw.groupBy === undefined ? 'none' : raw.groupBy
    if (
      groupBy !== 'none' &&
      groupBy !== 'type' &&
      groupBy !== 'modified' &&
      groupBy !== 'size'
    ) {
      throw new AgentIPCError('invalid_input', 0, 'File group is invalid.')
    }
    const foldersFirst = raw.foldersFirst === undefined ? true : raw.foldersFirst
    if (typeof foldersFirst !== 'boolean') {
      throw new AgentIPCError('invalid_input', 0, 'foldersFirst must be boolean.')
    }
    return { groupBy, foldersFirst }
  }

  ipcMain.handle('agent:cloud-children-range', (
    event,
    parentID: unknown,
    offset: unknown,
    limit: unknown,
    sort: unknown,
    order: unknown,
    includeCount: unknown,
    groupingValue: unknown,
    requestID: unknown,
  ) => runAgentAction<AgentCloudChildrenRange>(
    () => viewportRequests.run(event.sender, requestID, async (signal) => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Parent node id is required.')
    }
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Directory range offset must be zero or greater.')
    }
    const normalizedLimit = limit === undefined ? 200 : limit
    if (typeof normalizedLimit !== 'number' || !Number.isSafeInteger(normalizedLimit) ||
        normalizedLimit < 1 || normalizedLimit > 500) {
      throw new AgentIPCError('invalid_input', 0, 'Directory range limit must be between 1 and 500.')
    }
    const normalizedSort = sort === undefined ? 'name' : sort
    const normalizedOrder = order === undefined ? 'asc' : order
    if (!['name', 'updated', 'size', 'type'].includes(String(normalizedSort)) ||
        !['asc', 'desc'].includes(String(normalizedOrder))) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid directory range sort options.')
    }
    const normalizedIncludeCount = includeCount === undefined ? true : includeCount
    const grouping = normalizeFileExplorerGrouping(groupingValue)
    if (typeof normalizedIncludeCount !== 'boolean') {
      throw new AgentIPCError('invalid_input', 0, 'Directory range includeCount must be boolean.')
    }
    if (signal?.aborted) throw new AgentIPCError('aborted', 0, 'Directory range request was cancelled.')
    return requireAgentClient().cloudChildrenRange(
      parentID,
      offset,
      normalizedLimit,
      normalizedSort as 'name' | 'updated' | 'size' | 'type',
      normalizedOrder as 'asc' | 'desc',
      normalizedIncludeCount,
      grouping,
      signal,
    )
    }), false,
  ))

  ipcMain.handle('agent:cloud-changes', (
    _event,
    afterValue: unknown,
    limitValue: unknown,
  ) => runAgentAction<AgentCloudNodeChangePage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-change-feed')
    const after = afterValue === undefined ? 0 : afterValue
    const limit = limitValue === undefined ? 200 : limitValue
    if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Change cursor must be a non-negative integer.')
    }
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new AgentIPCError('invalid_input', 0, 'Change limit must be between 1 and 1000.')
    }
    return requireAgentClient().cloudChanges(after, limit)
  }, false))

  ipcMain.handle('agent:cloud-quick-access', () => runAgentAction<AgentCloudQuickAccessItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-quick-access')
    return requireAgentClient().cloudFileQuickAccess()
  }, false))
  ipcMain.handle('agent:cloud-quick-access-pin', (_event, nodeID: unknown) => runAgentAction<AgentCloudQuickAccessItem>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-quick-access')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id is required.')
    }
    return requireAgentClient().cloudPinFileQuickAccess(nodeID)
  }, false))
  ipcMain.handle('agent:cloud-quick-access-unpin', (_event, nodeID: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-quick-access')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id is required.')
    }
    return requireAgentClient().cloudUnpinFileQuickAccess(nodeID)
  }, false))

  ipcMain.handle('agent:cloud-quick-access-reorder', (_event, nodeIDs: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-quick-access')
    if (!Array.isArray(nodeIDs) || nodeIDs.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
      throw new AgentIPCError('invalid_input', 0, 'Quick access node ids are invalid.')
    }
    return requireAgentClient().cloudReorderFileQuickAccess(nodeIDs as number[])
  }, false))
  ipcMain.handle('agent:cloud-tags', () => runAgentAction<AgentFileTag[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-tags')
    return requireAgentClient().cloudFileTags()
  }, false))
  ipcMain.handle('agent:cloud-tag-create', (_event, name: unknown, color: unknown) => runAgentAction<AgentFileTag>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-tags')
    if (typeof name !== 'string' || typeof color !== 'string') throw new AgentIPCError('invalid_input', 0, 'Tag input is invalid.')
    return requireAgentClient().cloudCreateFileTag(name, color)
  }, false))
  ipcMain.handle('agent:cloud-tag-update', (_event, id: unknown, input: unknown) => runAgentAction<AgentFileTag>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-tags')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || !input || typeof input !== 'object') {
      throw new AgentIPCError('invalid_input', 0, 'Tag update is invalid.')
    }
    return requireAgentClient().cloudUpdateFileTag(id, input as { name?: string; color?: string })
  }, false))
  ipcMain.handle('agent:cloud-tag-delete', (_event, id: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-tags')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new AgentIPCError('invalid_input', 0, 'Tag id is invalid.')
    return requireAgentClient().cloudDeleteFileTag(id)
  }, false))
  ipcMain.handle('agent:cloud-tags-query', (_event, nodeIDs: unknown) => runAgentAction<AgentFileNodeTags[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-tags')
    if (!Array.isArray(nodeIDs) || nodeIDs.length === 0 || nodeIDs.length > 500 ||
        nodeIDs.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
      throw new AgentIPCError('invalid_input', 0, 'Tag node ids are invalid.')
    }
    return requireAgentClient().cloudQueryFileNodeTags(nodeIDs as number[])
  }, false))
  ipcMain.handle('agent:cloud-tag-nodes', (_event, tagID: unknown, nodeIDs: unknown, assigned: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-tags')
    if (typeof tagID !== 'number' || !Number.isSafeInteger(tagID) || tagID <= 0 ||
        !Array.isArray(nodeIDs) || nodeIDs.length === 0 || nodeIDs.length > 500 ||
        nodeIDs.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) ||
        typeof assigned !== 'boolean') {
      throw new AgentIPCError('invalid_input', 0, 'Tag assignment is invalid.')
    }
    return requireAgentClient().cloudSetFileTagNodes(tagID, nodeIDs as number[], assigned)
  }, false))
  ipcMain.handle('agent:cloud-saved-searches', () => runAgentAction<AgentFileSavedSearch[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-saved-searches')
    return requireAgentClient().cloudFileSavedSearches()
  }, false))
  ipcMain.handle('agent:cloud-saved-search-create', (_event, input: unknown) => runAgentAction<AgentFileSavedSearch>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-saved-searches')
    if (!input || typeof input !== 'object') throw new AgentIPCError('invalid_input', 0, 'Saved search input is invalid.')
    return requireAgentClient().cloudCreateFileSavedSearch(input as AgentFileSavedSearchInput)
  }, false))
  ipcMain.handle('agent:cloud-saved-search-update', (_event, id: unknown, input: unknown) => runAgentAction<AgentFileSavedSearch>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-saved-searches')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || !input || typeof input !== 'object') throw new AgentIPCError('invalid_input', 0, 'Saved search input is invalid.')
    return requireAgentClient().cloudUpdateFileSavedSearch(id, input as AgentFileSavedSearchInput)
  }, false))
  ipcMain.handle('agent:cloud-saved-search-delete', (_event, id: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-saved-searches')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new AgentIPCError('invalid_input', 0, 'Saved search id is invalid.')
    return requireAgentClient().cloudDeleteFileSavedSearch(id)
  }, false))
  ipcMain.handle('agent:cloud-saved-search-reorder', (_event, ids: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-saved-searches')
    if (!Array.isArray(ids) || ids.length > 64 ||
        ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
      throw new AgentIPCError('invalid_input', 0, 'Saved search order is invalid.')
    }
    return requireAgentClient().cloudReorderFileSavedSearches(ids as number[])
  }, false))

  ipcMain.handle('agent:cloud-favorites', () => runAgentAction<AgentCloudFavoriteItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-favorites')
    return requireAgentClient().cloudFileFavorites()
  }, false))
  ipcMain.handle('agent:cloud-favorite', (_event, nodeID: unknown) => runAgentAction<AgentCloudFavoriteItem>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-favorites')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id is required.')
    }
    return requireAgentClient().cloudFavoriteFile(nodeID)
  }, false))
  ipcMain.handle('agent:cloud-unfavorite', (_event, nodeID: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-favorites')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id is required.')
    }
    return requireAgentClient().cloudUnfavoriteFile(nodeID)
  }, false))
  ipcMain.handle('agent:cloud-recent', (_event, limit: unknown) => runAgentAction<AgentCloudRecentItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-recent')
    const value = limit === undefined ? 16 : limit
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 50) {
      throw new AgentIPCError('invalid_input', 0, 'Recent item limit must be between 1 and 50.')
    }
    return requireAgentClient().cloudFileRecent(value)
  }, false))
  ipcMain.handle('agent:cloud-recent-touch', (_event, nodeID: unknown) => runAgentAction<AgentCloudRecentItem>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-recent')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id is required.')
    }
    return requireAgentClient().cloudTouchFileRecent(nodeID)
  }, false))
  ipcMain.handle('agent:cloud-recent-clear', () => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'file-recent')
    return requireAgentClient().cloudClearFileRecent()
  }, false))
  ipcMain.handle('agent:cloud-create-directory', (_event, parentID: unknown, name: unknown) => runAgentAction<AgentCloudNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0 ||
        typeof name !== 'string' || !name.trim()) {
      throw new AgentIPCError('invalid_input', 0, 'Parent node id and directory name are required.')
    }
    return requireAgentClient().cloudCreateDirectory(parentID, name.trim())
  }, false))
  ipcMain.handle('agent:cloud-rename', (_event, id: unknown, revision: unknown, name: unknown) => runAgentAction<AgentCloudNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
        typeof name !== 'string' || !name.trim()) {
      throw new AgentIPCError('invalid_input', 0, 'Node id, revision, and name are required.')
    }
    return requireAgentClient().cloudRename(id, revision, name.trim())
  }, false))
  ipcMain.handle('agent:cloud-copy', (_event, id: unknown, parentID: unknown) => runAgentAction<AgentCloudNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id and target parent id are required.')
    }
    return requireAgentClient().cloudCopy(id, parentID)
  }, false))
  ipcMain.handle('agent:cloud-move', (_event, id: unknown, revision: unknown, parentID: unknown) => runAgentAction<AgentCloudNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
        typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id, revision, and target parent id are required.')
    }
    return requireAgentClient().cloudMove(id, revision, parentID)
  }, false))
  ipcMain.handle('agent:cloud-delete', (_event, id: unknown, revision: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Node id and revision are required.')
    }
    return requireAgentClient().cloudDelete(id, revision)
  }, false))
  ipcMain.handle('agent:cloud-batch-copy', (_event, items: unknown, parentID: unknown) => runAgentAction<AgentCloudBatchResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    const refs = normalizeCloudBatchItems(items)
    if (typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Target parent id is required.')
    }
    return requireAgentClient().cloudBatchCopy(refs, parentID)
  }, false))
  ipcMain.handle('agent:cloud-batch-move', (_event, items: unknown, parentID: unknown) => runAgentAction<AgentCloudBatchResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    const refs = normalizeCloudBatchItems(items)
    if (typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Target parent id is required.')
    }
    return requireAgentClient().cloudBatchMove(refs, parentID)
  }, false))
  ipcMain.handle('agent:cloud-batch-delete', (_event, items: unknown) => runAgentAction<AgentCloudBatchResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudBatchDelete(normalizeCloudBatchItems(items))
  }, false))

  ipcMain.handle(
    'agent:cloud-file-properties-stats',
    (event, items: unknown, requestIDValue: unknown) =>
      runAgentAction<AgentCloudFilePropertiesStats>(async () => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'cloud-files')
        requireAgentCapability(hello, 'file-properties-stats')
        const refs = normalizeCloudBatchItems(items)
        const requestID = normalizeFilePropertiesRequestID(requestIDValue)
        if (filePropertiesRequests.has(requestID)) {
          throw new AgentIPCError('invalid_input', 0, 'Duplicate File Properties request id.')
        }
        if (cancelledFilePropertiesRequests.delete(requestID)) {
          throw new AgentIPCError('aborted', 0, 'File Properties request was cancelled.')
        }

        const controller = new AbortController()
        filePropertiesRequests.set(requestID, controller)
        const onDestroyed = () => controller.abort()
        event.sender.once('destroyed', onDestroyed)
        try {
          return await requireAgentClient().cloudFilePropertiesStats(
            refs,
            controller.signal,
          )
        } finally {
          event.sender.removeListener('destroyed', onDestroyed)
          if (filePropertiesRequests.get(requestID) === controller) {
            filePropertiesRequests.delete(requestID)
          }
        }
      }, false),
  )
  ipcMain.handle(
    'agent:cloud-file-properties-stats-cancel',
    (_event, requestIDValue: unknown) => runAgentAction(async () => {
      const requestID = normalizeFilePropertiesRequestID(requestIDValue)
      const controller = filePropertiesRequests.get(requestID)
      if (controller) {
        controller.abort()
      } else {
        rememberCancelledFilePropertiesRequest(requestID)
      }
      return { cancelled: true }
    }, false),
  )
  ipcMain.handle(
    'agent:cloud-file-media-details',
    (_event, items: unknown) => runAgentAction<AgentCloudFileMediaDetails[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      requireAgentCapability(hello, 'file-media-details')
      return requireAgentClient().cloudFileMediaDetails(normalizeCloudBatchItems(items))
    }, false),
  )

  ipcMain.handle('agent:cloud-file-operation-create', (_event, type: unknown, items: unknown, parentID: unknown) => runAgentAction<AgentCloudFileOperation>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    const operationType = normalizeCloudFileOperationType(type)
    const refs = normalizeCloudBatchItems(items)
    const targetParent = parentID === undefined || parentID === null ? 0 : parentID
    if (
      (operationType === 'copy' || operationType === 'move') &&
      (typeof targetParent !== 'number' || !Number.isSafeInteger(targetParent) || targetParent <= 0)
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Target parent id is required for copy and move operations.')
    }
    return requireAgentClient().cloudCreateFileOperation(
      operationType,
      refs,
      typeof targetParent === 'number' ? targetParent : 0,
    )
  }, false))
  ipcMain.handle('agent:cloud-reveal-admin-baidu-map-ak', (_event, revision: unknown) => runAgentAction<AgentAdminBaiduMapAKReveal>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid Baidu map configuration revision.')
    }
    return requireAgentClient().cloudRevealAdminBaiduMapAK(revision)
  }, false))
  ipcMain.handle('agent:cloud-admin-postgres-pool', () =>
    runAgentAction<AgentAdminPostgresPoolConfig>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'admin-services')
      return requireAgentClient().cloudAdminPostgresPoolConfig()
    }, false))
  ipcMain.handle('agent:cloud-set-admin-postgres-pool', (_event, value: unknown) =>
    runAgentAction<AgentAdminPostgresPoolConfig>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'admin-services')
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AgentIPCError('invalid_input', 0, 'PostgreSQL pool needs a versioned complete desired config.')
      }
      const input = value as Partial<AgentAdminPostgresPoolUpdate>
      const desired = input.desired
      const open = desired?.max_open_connections
      const idle = desired?.max_idle_connections
      if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
          typeof open !== 'number' || !Number.isSafeInteger(open) ||
          typeof idle !== 'number' || !Number.isSafeInteger(idle) ||
          !(open === 0 || (open >= 8 && open <= 256)) ||
          idle < 0 || idle > 32 || (open !== 0 && idle > open)) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid PostgreSQL pool bounds or expected revision.')
      }
      return requireAgentClient().cloudSetAdminPostgresPool({
        revision: input.revision, desired: { max_open_connections: open, max_idle_connections: idle },
      })
    }, false))
  ipcMain.handle('agent:cloud-admin-postgres-pool-revisions', () =>
    runAgentAction<AgentAdminPostgresPoolRevisionPage>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'admin-services')
      return requireAgentClient().cloudAdminPostgresPoolRevisions()
    }, false))
  ipcMain.handle('agent:cloud-rollback-admin-postgres-pool', (_event, value: unknown) =>
    runAgentAction<AgentAdminPostgresPoolConfig>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'admin-services')
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AgentIPCError('invalid_input', 0, 'PostgreSQL pool rollback requires two revisions.')
      }
      const input = value as Partial<AgentAdminPostgresPoolRollbackInput>
      if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) ||
          typeof input.target_revision !== 'number' || !Number.isSafeInteger(input.target_revision) ||
          input.target_revision < 0 || input.revision <= input.target_revision) {
        throw new AgentIPCError('invalid_input', 0, 'PostgreSQL pool rollback requires an older revision.')
      }
      return requireAgentClient().cloudRollbackAdminPostgresPool({
        revision: input.revision, target_revision: input.target_revision,
      })
    }, false))
  ipcMain.handle('agent:cloud-admin-source-worker', () => runAgentAction<AgentAdminSourceWorkerConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminSourceWorkerConfig()
  }, false))
  ipcMain.handle('agent:cloud-set-admin-source-worker', (_event, value: unknown) => runAgentAction<AgentAdminSourceWorkerConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentIPCError('invalid_input', 0, 'Pull Worker policy must be an object.')
    }
    const input = value as Partial<AgentAdminSourceWorkerUpdate>
    const v = input.desired
    if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      !v || typeof v !== 'object' || Array.isArray(v) ||
      Object.keys(v).sort().join(',') !== 'max_concurrency,poll_interval_seconds,scan_interval_seconds' ||
      !Number.isSafeInteger(v.scan_interval_seconds) || v.scan_interval_seconds < 60 || v.scan_interval_seconds > 604800 ||
      !Number.isSafeInteger(v.poll_interval_seconds) || v.poll_interval_seconds < 10 || v.poll_interval_seconds > 3600 ||
      !Number.isSafeInteger(v.max_concurrency) || v.max_concurrency < 1 || v.max_concurrency > 8) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid Pull Worker revision or scheduling parameters.')
    }
    return requireAgentClient().cloudSetAdminSourceWorkerConfig({
      revision: input.revision, desired: v,
    })
  }, false))
  ipcMain.handle('agent:cloud-admin-source-worker-revisions', () => runAgentAction<AgentAdminSourceWorkerRevisionPage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminSourceWorkerRevisions()
  }, false))
  ipcMain.handle('agent:cloud-rollback-admin-source-worker', (_event, value: unknown) => runAgentAction<AgentAdminSourceWorkerConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentIPCError('invalid_input', 0, 'Pull Worker rollback must be an object.')
    }
    const input = value as Partial<AgentAdminSourceWorkerRollbackInput>
    if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision <= 0 ||
      typeof input.target_revision !== 'number' || !Number.isSafeInteger(input.target_revision) ||
      input.target_revision < 0 || input.target_revision >= input.revision) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid Pull Worker rollback revisions.')
    }
    return requireAgentClient().cloudRollbackAdminSourceWorker({
      revision: input.revision, target_revision: input.target_revision,
    })
  }, false))

  ipcMain.handle('agent:cloud-admin-photo-intelligence', () => runAgentAction<AgentAdminPhotoAutoConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminPhotoAutoConfig()
  }, false))
  ipcMain.handle('agent:cloud-set-admin-photo-intelligence', (_event, input: unknown) => runAgentAction<AgentAdminPhotoAutoConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid Photo Intelligence policy.')
    }
    const data = input as Partial<AgentAdminPhotoAutoUpdate>
    if (typeof data.auto_enabled !== 'boolean' ||
        typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid Photo Intelligence policy revision or switch.')
    }
    const kinds = data.kinds
    if (kinds !== undefined && (!kinds || typeof kinds !== 'object' || Array.isArray(kinds) ||
        Object.keys(kinds).sort().join(',') !== 'face,person_cluster,semantic,smart' ||
        typeof kinds.face !== 'boolean' || typeof kinds.smart !== 'boolean' ||
        typeof kinds.semantic !== 'boolean' || typeof kinds.person_cluster !== 'boolean')) {
      throw new AgentIPCError('invalid_input', 0, 'All Photo Intelligence kind switches must be booleans.')
    }
    return requireAgentClient().cloudSetAdminPhotoAutoConfig({
      revision: data.revision, auto_enabled: data.auto_enabled,
      ...(kinds ? { kinds } : {}),
    })
  }, false))
  ipcMain.handle('agent:cloud-admin-photo-intelligence-revisions', () => runAgentAction<AgentAdminPhotoAutoRevisionPage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminPhotoAutoRevisions()
  }, false))
  ipcMain.handle('agent:cloud-rollback-admin-photo-intelligence', (_event, value: unknown) => runAgentAction<AgentAdminPhotoAutoConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentIPCError('invalid_input', 0, 'Photo Intelligence rollback requires two revisions.')
    }
    const input = value as Partial<AgentAdminPhotoAutoRollbackInput>
    if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) ||
        typeof input.target_revision !== 'number' || !Number.isSafeInteger(input.target_revision) ||
        input.target_revision < 0 || input.revision <= input.target_revision) {
      throw new AgentIPCError('invalid_input', 0, 'Photo Intelligence target revision must be older.')
    }
    return requireAgentClient().cloudRollbackAdminPhotoAuto({
      revision: input.revision, target_revision: input.target_revision,
    })
  }, false))
  ipcMain.handle('agent:cloud-admin-geonames', () => runAgentAction<AgentAdminGeoNamesConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminGeoNamesConfig()
  }, false))
  ipcMain.handle('agent:cloud-set-admin-geonames', (_event, input: unknown) => runAgentAction<AgentAdminGeoNamesConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AgentIPCError('invalid_input', 0, 'GeoNames settings must be an object.')
    }
    const data = input as Partial<AgentAdminGeoNamesUpdate>
    if (typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
        typeof data.max_distance_km !== 'number' || !Number.isFinite(data.max_distance_km) ||
        data.max_distance_km <= 0 || data.max_distance_km > 500) {
      throw new AgentIPCError('invalid_input', 0, 'GeoNames radius or revision is invalid.')
    }
    return requireAgentClient().cloudSetAdminGeoNamesConfig({
      revision: data.revision, max_distance_km: data.max_distance_km,
    })
  }, false))
  ipcMain.handle('agent:cloud-admin-geonames-revisions', () => runAgentAction<AgentAdminGeoNamesRevisionPage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminGeoNamesRevisions()
  }, false))
  ipcMain.handle('agent:cloud-rollback-admin-geonames', (_event, value: unknown) => runAgentAction<AgentAdminGeoNamesConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentIPCError('invalid_input', 0, 'GeoNames rollback requires a revision and an older target.')
    }
    const input = value as Partial<{ revision: number; target_revision: number }>
    if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) ||
        typeof input.target_revision !== 'number' || !Number.isSafeInteger(input.target_revision) ||
        input.revision <= input.target_revision || input.target_revision < 0) {
      throw new AgentIPCError('invalid_input', 0, 'GeoNames rollback target revision is invalid.')
    }
    return requireAgentClient().cloudRollbackAdminGeoNames({
      revision: input.revision, target_revision: input.target_revision,
    })
  }, false))
  ipcMain.handle('agent:cloud-apply-admin-geonames-dataset', (_event, data: unknown) =>
    runAgentAction<AgentAdminGeoNamesConfig>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'admin-services')
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new AgentIPCError('invalid_input', 0, 'GeoNames apply expects a dataset revision and target.')
      }
      const input = data as Partial<AgentAdminGeoNamesDatasetApplyInput>
      const validFingerprint = (value: string) => /^[0-9a-f]{64}$/.test(value)
      if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
          typeof input.expected_version !== 'string' || !input.expected_version ||
          input.expected_version.length > 128 || typeof input.expected_fingerprint !== 'string' ||
          (input.expected_fingerprint !== '' && !validFingerprint(input.expected_fingerprint)) ||
          typeof input.target !== 'string' ||
          (input.target !== 'deployment' && !validFingerprint(input.target))) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid GeoNames dataset apply target or stale revision.')
      }
      return requireAgentClient().cloudApplyAdminGeoNamesDataset({
        revision: input.revision, expected_version: input.expected_version,
        expected_fingerprint: input.expected_fingerprint, target: input.target,
      })
    }, false))
  ipcMain.handle('agent:cloud-restore-missing-admin-geonames-snapshot', (_event, data: unknown) =>
    runAgentAction<AgentAdminGeoNamesConfig>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'admin-services')
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new AgentIPCError('invalid_input', 0, 'GeoNames missing-archive restore needs a current revision.')
      }
      const input = data as Partial<AgentAdminGeoNamesRestoreMissingInput>
      const validFingerprint = (value: string) => /^[0-9a-f]{64}$/.test(value)
      if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
          typeof input.expected_version !== 'string' || !input.expected_version ||
          input.expected_version.length > 128 || typeof input.expected_fingerprint !== 'string' ||
          (input.expected_fingerprint !== '' && !validFingerprint(input.expected_fingerprint))) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid GeoNames restore-missing revision or expected source.')
      }
      return requireAgentClient().cloudRestoreMissingAdminGeoNamesSnapshot({
        revision: input.revision, expected_version: input.expected_version,
        expected_fingerprint: input.expected_fingerprint,
      })
    }, false))
  ipcMain.handle('agent:cloud-stage-admin-geonames-snapshot', (_event, data: unknown) =>
    runAgentAction<AgentAdminGeoNamesSnapshotResult>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'admin-services')
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new AgentIPCError('invalid_input', 0, 'GeoNames snapshot requires a revision and expected version.')
      }
      const input = data as Partial<AgentAdminGeoNamesSnapshotInput>
      if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) ||
          input.revision < 0 || typeof input.expected_version !== 'string' ||
          !input.expected_version.length || input.expected_version.length > 128) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid GeoNames snapshot revision or version.')
      }
      return requireAgentClient().cloudStageAdminGeoNamesSnapshot({
        revision: input.revision, expected_version: input.expected_version,
      })
    }, false))
  ipcMain.handle('agent:cloud-reload-admin-geonames', (_event, version: unknown) => runAgentAction<AgentAdminGeoNamesReloadResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (typeof version !== 'string' || version.length === 0 || version.length > 128) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid GeoNames dataset version.')
    }
    return requireAgentClient().cloudReloadAdminGeoNames(version)
  }, false))
  ipcMain.handle('agent:cloud-admin-baidu-map', () => runAgentAction<AgentAdminBaiduMapConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminBaiduMapConfig()
  }, false))
  ipcMain.handle('agent:cloud-set-admin-baidu-map', (_event, data: unknown) => runAgentAction<AgentAdminBaiduMapConfig>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid Baidu map settings.')
    }
    const input = data as Partial<AgentAdminBaiduMapUpdate>
    if (typeof input.enabled !== 'boolean' ||
        typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
        (input.ak !== undefined && (typeof input.ak !== 'string' || input.ak.length > 256)) ||
        (input.clear_ak !== undefined && typeof input.clear_ak !== 'boolean') ||
        (input.clear_ak === true && Boolean(input.ak))) {
      throw new AgentIPCError('invalid_input', 0, 'Invalid Baidu map settings.')
    }
    return requireAgentClient().cloudSetAdminBaiduMapConfig({
      enabled: input.enabled,
      revision: input.revision,
      ...(input.ak ? { ak: input.ak } : {}),
      ...(input.clear_ak === true ? { clear_ak: true } : {}),
    })
  }, false))
  ipcMain.handle('agent:cloud-admin-services', () => runAgentAction<AgentServiceDependenciesSnapshot>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'admin-services')
    return requireAgentClient().cloudAdminServices()
  }, false))
  ipcMain.handle(
    'agent:cloud-background-task-summary',
    () => runAgentAction<AgentBackgroundTaskActiveSummary>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'background-task-summary')
      return requireAgentClient().cloudBackgroundTaskActiveSummary()
    }, false),
  )
  ipcMain.handle('agent:cloud-background-task-page', (
    _event,
    global: unknown,
    limit: unknown,
    cursor: unknown,
  ) => runAgentAction<AgentBackgroundTaskPage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'background-tasks')
    const parsedLimit = typeof limit === 'number' && Number.isSafeInteger(limit)
      ? Math.min(200, Math.max(1, limit))
      : 50
    const parsedCursor = typeof cursor === 'string' ? cursor.trim() : ''
    return requireAgentClient().cloudBackgroundTaskPage(
      global === true,
      parsedLimit,
      parsedCursor,
    )
  }, false))
  ipcMain.handle('agent:cloud-background-tasks', (_event, global: unknown, limit: unknown) => runAgentAction<AgentBackgroundTask[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'background-tasks')
    const parsedLimit = typeof limit === 'number' && Number.isSafeInteger(limit)
      ? Math.min(200, Math.max(1, limit))
      : 100
    return requireAgentClient().cloudBackgroundTasks(global === true, parsedLimit)
  }, false))
  ipcMain.handle('agent:cloud-background-task-control', (
    _event,
    id: unknown,
    action: unknown,
    global: unknown,
  ) => runAgentAction<AgentBackgroundTaskControlResult>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'background-tasks')
    if (typeof id !== 'string' || !id.trim()) {
      throw new AgentIPCError('invalid_input', 0, 'Background task id is required.')
    }
    if (typeof action !== 'string' || !action.trim()) {
      throw new AgentIPCError('invalid_input', 0, 'Background task action is required.')
    }
    return requireAgentClient().cloudBackgroundTaskControl(
      id.trim(),
      action.trim(),
      global === true,
    )
  }, false))
  ipcMain.handle('agent:cloud-file-operations', (_event, limit: unknown) => runAgentAction<AgentCloudFileOperation[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    const parsedLimit = typeof limit === 'number' && Number.isSafeInteger(limit)
      ? Math.min(200, Math.max(1, limit))
      : 100
    return requireAgentClient().cloudFileOperations(parsedLimit)
  }, false))
  ipcMain.handle('agent:cloud-file-operations-clear', () => runAgentAction(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    await requireAgentClient().cloudClearFileOperationHistory()
    return { ok: true }
  }, false))
  ipcMain.handle('agent:cloud-file-operation', (_event, id: unknown) => runAgentAction<AgentCloudFileOperation>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudFileOperation(normalizeCloudFileOperationID(id))
  }, false))
  ipcMain.handle('agent:cloud-file-operation-cancel', (_event, id: unknown) => runAgentAction<AgentCloudFileOperation>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudCancelFileOperation(normalizeCloudFileOperationID(id))
  }, false))
  ipcMain.handle('agent:cloud-file-operation-retry', (_event, id: unknown) => runAgentAction<AgentCloudFileOperation>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudRetryFileOperation(normalizeCloudFileOperationID(id))
  }, false))
  ipcMain.handle('agent:cloud-file-operation-undo', (_event, id: unknown) => runAgentAction<AgentCloudFileOperation>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudUndoFileOperation(normalizeCloudFileOperationID(id))
  }, false))
  ipcMain.handle('agent:cloud-file-operation-redo', (_event, id: unknown) => runAgentAction<AgentCloudFileOperation>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    requireAgentCapability(hello, 'file-operation-redo')
    return requireAgentClient().cloudRedoFileOperation(normalizeCloudFileOperationID(id))
  }, false))
  ipcMain.handle('agent:cloud-file-operation-resolve', (_event, id: unknown, policy: unknown) => runAgentAction<AgentCloudFileOperation>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    requireAgentCapability(hello, 'file-operation-conflict-resolution')
    return requireAgentClient().cloudResolveFileOperationConflict(
      normalizeCloudFileOperationID(id),
      normalizeCloudFileOperationConflictPolicy(policy),
    )
  }, false))

  ipcMain.handle('agent:cloud-upload-preflight', (_event, parentID: unknown, name: unknown) =>
    runAgentAction<AgentCloudUploadConflictPreflight>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      requireAgentCapability(hello, 'upload-conflict-preflight')
      if (
        typeof parentID !== 'number' ||
        !Number.isSafeInteger(parentID) ||
        parentID <= 0 ||
        typeof name !== 'string' ||
        !name.trim()
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Parent node id and file name are required.')
      }
      return requireAgentClient().cloudUploadPreflight(parentID, name.trim())
    }, false))

  ipcMain.handle('agent:cloud-upload-preflight-batch', (_event, items: unknown) =>
    runAgentAction<AgentCloudUploadConflictPreflight[]>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      requireAgentCapability(hello, 'upload-conflict-preflight-batch')
      if (
        !Array.isArray(items) ||
        items.length === 0 ||
        items.length > 200 ||
        items.some((item) => (
          !item ||
          typeof item !== 'object' ||
          typeof (item as { parent_id?: unknown }).parent_id !== 'number' ||
          !Number.isSafeInteger((item as { parent_id: number }).parent_id) ||
          typeof (item as { name?: unknown }).name !== 'string'
        ))
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Upload preflight batch must contain 1-200 parent/name entries.')
      }
      return requireAgentClient().cloudUploadPreflightBatch(
        items.map((item) => ({
          parent_id: (item as { parent_id: number }).parent_id,
          name: (item as { name: string }).name,
        })),
      )
    }, false))

  ipcMain.handle(
    'agent:cloud-upload-file',
    (_event, parentID: unknown, localPath: unknown, name: unknown, policy: unknown, transferID: unknown) =>
      runAgentAction<AgentCloudUploadResult>(async () => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'cloud-files')
        requireAgentCapability(hello, 'upload-conflict-policy')
        if (
          typeof parentID !== 'number' ||
          !Number.isSafeInteger(parentID) ||
          parentID <= 0 ||
          typeof localPath !== 'string' ||
          !localPath.trim() ||
          !path.isAbsolute(localPath) ||
          typeof name !== 'string' ||
          !name.trim() ||
          (policy !== 'fail' && policy !== 'skip' && policy !== 'keep_both' && policy !== 'overwrite') ||
          (transferID !== undefined && typeof transferID !== 'string')
        ) {
          throw new AgentIPCError('invalid_input', 0, 'Valid upload path, name, and conflict policy are required.')
        }
        if (typeof transferID === 'string' && transferID.trim()) {
          requireAgentCapability(hello, 'transfer-lifecycle')
        }
        return requireAgentClient().cloudUploadWithConflictPolicy(
          parentID,
          path.resolve(localPath),
          name.trim(),
          policy,
          typeof transferID === 'string' ? transferID.trim() : '',
        )
      }, false),
  )

  ipcMain.handle('agent:cloud-upload-files', async (_event, parentID: unknown) => {
    if (typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0) {
      return { ok: false, error: { code: 'invalid_input', message: 'Parent node id is required.' } }
    }
    try {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      const options: OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        title: '选择要上传到 xDrive 的文件',
      }
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (selected.canceled || selected.filePaths.length === 0) {
        return { ok: true, data: { canceled: true, uploaded: [], failures: [] } }
      }

      const uploaded: AgentCloudNode[] = []
      const failures: Array<{ name: string; message: string }> = []
      for (const localPath of selected.filePaths) {
        const name = path.basename(localPath)
        try {
          uploaded.push(await requireAgentClient().cloudUpload(parentID, localPath, name))
        } catch (error) {
          failures.push({ name, message: agentError(error).message })
        }
      }
      return { ok: true, data: { canceled: false, uploaded, failures } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('agent:cloud-upload-paths', async (_event, parentID: unknown, input: unknown) => {
    if (
      typeof parentID !== 'number' || !Number.isSafeInteger(parentID) || parentID <= 0 ||
      !Array.isArray(input) || input.length === 0 || input.length > 1000 ||
      input.some((value) => typeof value !== 'string' || !value.trim() || !path.isAbsolute(value))
    ) {
      return { ok: false, error: { code: 'invalid_input', message: 'Parent id and absolute dropped-file paths are required.' } }
    }
    try {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      const uploaded: AgentCloudNode[] = []
      const failures: Array<{ name: string; message: string }> = []
      for (const value of input as string[]) {
        const localPath = path.resolve(value)
        const name = path.basename(localPath)
        try {
          uploaded.push(await requireAgentClient().cloudUpload(parentID, localPath, name))
        } catch (error) {
          failures.push({ name, message: agentError(error).message })
        }
      }
      return { ok: true, data: { canceled: false, uploaded, failures } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })

  ipcMain.handle('agent:cloud-text-preview', (_event, id: unknown) => runAgentAction<{ text: string; truncated: boolean; size: number }>(async () => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'File id is required.')
    }
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    requireAgentCapability(hello, 'file-text-preview')
    return requireAgentClient().cloudFileTextPreview(id)
  }, false))

  ipcMain.handle('agent:cloud-file-preview-url', (_event, id: unknown) => runAgentAction<string>(async () => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'File id is required.')
    }
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    requireAgentCapability(hello, 'file-preview-stream')
    if (!filePreviewProxy) {
      throw new AgentIPCError('file_preview_unavailable', 0, 'File preview proxy is not initialized.')
    }
    return filePreviewProxy.createURL(id)
  }, false))

  ipcMain.handle('agent:cloud-download', async (_event, id: unknown, name: unknown) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof name !== 'string' || !name.trim()) {
      return { ok: false, error: { code: 'invalid_input', message: 'File id and name are required.' } }
    }
    try {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      const rawName = path.basename(name.trim())
      const safeName = process.platform === 'win32'
        ? rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        : rawName
      const options = {
        title: '下载 xDrive 文件',
        defaultPath: path.join(app.getPath('downloads'), safeName || 'download'),
      }
      const selected = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (selected.canceled || !selected.filePath) {
        return { ok: true, data: { saved: false } }
      }
      await requireAgentClient().cloudDownload(id, selected.filePath)
      return { ok: true, data: { saved: true } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })

  ipcMain.handle('agent:cloud-download-files', async (_event, input: unknown) => {
    if (!Array.isArray(input) || input.length === 0 || input.length > 1000) {
      return { ok: false, error: { code: 'invalid_input', message: 'A non-empty file list is required.' } }
    }
    const files: Array<{ id: number; name: string }> = []
    for (const item of input) {
      if (
        typeof item !== 'object' || item === null ||
        typeof (item as { id?: unknown }).id !== 'number' ||
        !Number.isSafeInteger((item as { id: number }).id) ||
        (item as { id: number }).id <= 0 ||
        typeof (item as { name?: unknown }).name !== 'string' ||
        !(item as { name: string }).name.trim()
      ) {
        return { ok: false, error: { code: 'invalid_input', message: 'Each file requires a valid id and name.' } }
      }
      files.push({ id: (item as { id: number }).id, name: (item as { name: string }).name.trim() })
    }
    try {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      const options: OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择批量下载目录',
        defaultPath: app.getPath('downloads'),
      }
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const directory = selected.filePaths[0]
      if (selected.canceled || !directory) {
        return { ok: true, data: { canceled: true, downloaded: [], failures: [] } }
      }

      const reserved = new Set<string>()
      const downloaded: string[] = []
      const failures: Array<{ name: string; message: string }> = []
      for (const file of files) {
        const rawName = path.basename(file.name)
        const safeName = process.platform === 'win32'
          ? rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
          : rawName
        const ext = path.extname(safeName)
        const stem = path.basename(safeName, ext) || 'download'
        let candidate = safeName || 'download'
        for (let index = 2; index <= 10000; index += 1) {
          const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate
          let occupied = reserved.has(key)
          if (!occupied) {
            try {
              await access(path.join(directory, candidate))
              occupied = true
            } catch {
              occupied = false
            }
          }
          if (!occupied) {
            reserved.add(key)
            break
          }
          candidate = `${stem} (${index})${ext}`
        }
        try {
          await requireAgentClient().cloudDownload(file.id, path.join(directory, candidate))
          downloaded.push(candidate)
        } catch (error) {
          failures.push({ name: file.name, message: agentError(error).message })
        }
      }
      return { ok: true, data: { canceled: false, downloaded, failures } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })

  ipcMain.handle('agent:cloud-download-folder', async (_event, idValue: unknown, parentIDValue: unknown) => {
    if (
      typeof idValue !== 'number' ||
      !Number.isSafeInteger(idValue) ||
      idValue <= 0 ||
      typeof parentIDValue !== 'number' ||
      !Number.isSafeInteger(parentIDValue) ||
      parentIDValue <= 0
    ) {
      return { ok: false, error: { code: 'invalid_input', message: 'A valid folder id and parent id are required.' } }
    }
    try {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      requireAgentCapability(hello, 'folder-download-tree')
      const options: OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择文件夹下载目录',
        defaultPath: app.getPath('downloads'),
      }
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const directory = selected.filePaths[0]
      if (selected.canceled || !directory) {
        return { ok: true, data: { canceled: true, root: '', downloaded: 0, failed: 0 } }
      }
      const result = await requireAgentClient().cloudDownloadFolder(idValue, parentIDValue, directory)
      return { ok: true, data: { canceled: false, ...result } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })

  ipcMain.handle('agent:cloud-download-archive', async (_event, input: unknown) => {
    if (
      !Array.isArray(input) ||
      input.length === 0 ||
      input.length > 1000 ||
      input.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
    ) {
      return { ok: false, error: { code: 'invalid_input', message: 'A non-empty archive node id list is required.' } }
    }
    try {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'cloud-files')
      requireAgentCapability(hello, 'archive-download')
      const options: OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择下载目录',
        defaultPath: app.getPath('downloads'),
      }
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const directory = selected.filePaths[0]
      if (selected.canceled || !directory) {
        return { ok: true, data: { canceled: true, downloaded: [] } }
      }
      const result = await requireAgentClient().cloudDownloadArchive(input as number[], directory)
      return { ok: true, data: { canceled: false, downloaded: result.downloaded } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })

  ipcMain.handle('agent:open-path', (_event, pathValue: unknown, revealValue: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'open-path')
    if (typeof pathValue !== 'string') {
      throw new AgentIPCError('invalid_input', 0, 'A relative xDrive path is required.')
    }
    const relativePath = pathValue.trim()
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
      throw new AgentIPCError('invalid_input', 0, 'A safe relative xDrive path is required.')
    }
    if (revealValue !== undefined && typeof revealValue !== 'boolean') {
      throw new AgentIPCError('invalid_input', 0, 'Reveal must be a boolean.')
    }
    return requireAgentClient().openPath(relativePath, revealValue === true)
  }, false))

  ipcMain.handle('agent:open-with', (_event, pathValue: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'open-with')
    if (typeof pathValue !== 'string') {
      throw new AgentIPCError('invalid_input', 0, 'A relative xDrive path is required.')
    }
    const relativePath = pathValue.trim()
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
      throw new AgentIPCError('invalid_input', 0, 'A safe relative xDrive path is required.')
    }
    return requireAgentClient().openWith(relativePath)
  }, false))

  const normalizeCloudSearchFilters = (value: unknown): AgentCloudSearchFilters => {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentIPCError('invalid_input', 0, 'Search filters must be an object.')
    }
    const raw = value as Record<string, unknown>
    const out: AgentCloudSearchFilters = {}
    const kinds = new Set([
      'folder', 'file', 'image', 'video', 'audio', 'pdf', 'document',
      'spreadsheet', 'presentation', 'archive', 'code', 'text', 'other',
    ])
    if (raw.kind !== undefined) {
      if (typeof raw.kind !== 'string' || !kinds.has(raw.kind)) {
        throw new AgentIPCError('invalid_input', 0, 'Search kind filter is invalid.')
      }
      out.kind = raw.kind as AgentCloudSearchFilters['kind']
    }
    for (const [sourceKey, targetKey] of [
      ['modifiedFrom', 'modifiedFrom'],
      ['modifiedTo', 'modifiedTo'],
    ] as const) {
      const item = raw[sourceKey]
      if (item !== undefined) {
        if (typeof item !== 'string' || !item.trim()) {
          throw new AgentIPCError('invalid_input', 0, 'Search time filter is invalid.')
        }
        out[targetKey] = item.trim()
      }
    }
    for (const [sourceKey, targetKey] of [
      ['minSize', 'minSize'],
      ['maxSize', 'maxSize'],
    ] as const) {
      const item = raw[sourceKey]
      if (item !== undefined) {
        if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0) {
          throw new AgentIPCError('invalid_input', 0, 'Search size filter is invalid.')
        }
        out[targetKey] = item
      }
    }
    if (raw.sourceID !== undefined) {
      if (typeof raw.sourceID !== 'number' || !Number.isSafeInteger(raw.sourceID) || raw.sourceID <= 0) {
        throw new AgentIPCError('invalid_input', 0, 'Search synchronization-folder filter is invalid.')
      }
      out.sourceID = raw.sourceID
    }
    if (raw.tagID !== undefined) {
      if (typeof raw.tagID !== 'number' || !Number.isSafeInteger(raw.tagID) || raw.tagID <= 0) {
        throw new AgentIPCError('invalid_input', 0, 'Search tag filter is invalid.')
      }
      out.tagID = raw.tagID
    }
    if (raw.availability !== undefined) {
      const availability = new Set(['local', 'always-local', 'online-only', 'cloud', 'mixed', 'syncing'])
      if (typeof raw.availability !== 'string' || !availability.has(raw.availability)) {
        throw new AgentIPCError('invalid_input', 0, 'Search availability filter is invalid.')
      }
      out.availability = raw.availability as AgentCloudSearchFilters['availability']
    }
    return out
  }
  const cloudSearchFiltersActive = (filters: AgentCloudSearchFilters) => (
    filters.kind !== undefined ||
    filters.modifiedFrom !== undefined ||
    filters.modifiedTo !== undefined ||
    filters.minSize !== undefined ||
    filters.maxSize !== undefined ||
    filters.sourceID !== undefined ||
    filters.tagID !== undefined ||
    filters.availability !== undefined
  )

  ipcMain.handle('agent:cloud-search', (_event, query: unknown, cursor: unknown, sort: unknown, order: unknown, filtersValue: unknown) => runAgentAction<AgentCloudSearchPage>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    const filters = normalizeCloudSearchFilters(filtersValue)
    if (filters.availability !== undefined) {
      throw new AgentIPCError('invalid_input', 0, 'Availability filtering requires range Search.')
    }
    if (typeof query !== 'string' ||
        (query.trim().length < 2 && !(query.trim().length === 0 && cloudSearchFiltersActive(filters)))) {
      throw new AgentIPCError('invalid_input', 0, 'Search requires at least 2 characters or a structured filter.')
    }
    if (cursor !== undefined && typeof cursor !== 'string') {
      throw new AgentIPCError('invalid_input', 0, 'Search cursor must be a string.')
    }
    const sortKey = sort === undefined ? 'name' : sort
    const sortOrder = order === undefined ? 'asc' : order
    if (sortKey !== 'name' && sortKey !== 'updated' && sortKey !== 'size' && sortKey !== 'type') {
      throw new AgentIPCError('invalid_input', 0, 'Search sort is invalid.')
    }
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
      throw new AgentIPCError('invalid_input', 0, 'Search order is invalid.')
    }
    return requireAgentClient().cloudSearch(
      query.trim(),
      typeof cursor === 'string' ? cursor.trim() : '',
      sortKey,
      sortOrder,
      filters,
    )
  }, false))
  ipcMain.handle('agent:cloud-search-range', (
    _event,
    query: unknown,
    offset: unknown,
    limit: unknown,
    sort: unknown,
    order: unknown,
    filtersValue: unknown,
    groupingValue: unknown,
  ) => runAgentAction<AgentCloudSearchRange>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    const filters = normalizeCloudSearchFilters(filtersValue)
    const grouping = normalizeFileExplorerGrouping(groupingValue)
    if (typeof query !== 'string' ||
        (query.trim().length < 2 && !(query.trim().length === 0 && cloudSearchFiltersActive(filters)))) {
      throw new AgentIPCError('invalid_input', 0, 'Search requires at least 2 characters or a structured filter.')
    }
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Search range offset must be zero or greater.')
    }
    const normalizedLimit = limit === undefined ? 200 : limit
    if (typeof normalizedLimit !== 'number' || !Number.isSafeInteger(normalizedLimit) ||
        normalizedLimit < 1 || normalizedLimit > 200) {
      throw new AgentIPCError('invalid_input', 0, 'Search range limit must be between 1 and 200.')
    }
    const sortKey = sort === undefined ? 'name' : sort
    const sortOrder = order === undefined ? 'asc' : order
    if (sortKey !== 'name' && sortKey !== 'updated' && sortKey !== 'size' && sortKey !== 'type') {
      throw new AgentIPCError('invalid_input', 0, 'Search sort is invalid.')
    }
    if (sortOrder !== 'asc' && sortOrder !== 'desc') {
      throw new AgentIPCError('invalid_input', 0, 'Search order is invalid.')
    }
    return requireAgentClient().cloudSearchRange(
      query.trim(),
      offset,
      normalizedLimit,
      sortKey,
      sortOrder,
      filters,
      grouping,
    )
  }, false))
  ipcMain.handle('agent:cloud-quota', () => runAgentAction<AgentCloudQuota>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudQuota()
  }, false))
  ipcMain.handle('agent:get-server-update', () => runAgentAction<AgentServerUpdateState>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'server-update')
    return requireAgentClient().serverUpdate()
  }, false))
  ipcMain.handle('agent:start-server-update', (_event, sourceValue: unknown, channelValue: unknown, backupFileDataValue: unknown) => runAgentAction<AgentServerUpdateState>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'server-update')
    if ((sourceValue !== 'github' && sourceValue !== 'gitlab') ||
        (channelValue !== 'stable' && channelValue !== 'master') ||
        (backupFileDataValue !== undefined && typeof backupFileDataValue !== 'boolean')) {
      throw new AgentIPCError('invalid_input', 0, 'Server update source/channel/backup option are invalid.')
    }
    return requireAgentClient().startServerUpdate(sourceValue, channelValue, backupFileDataValue === true)
  }, false))
  ipcMain.handle('agent:cloud-storage-stats', () => runAgentAction<AgentCloudStorageStats>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'storage-intelligence')
    return requireAgentClient().cloudStorageStats()
  }, false))
  ipcMain.handle('agent:cloud-storage-cache-cleanup', (_event, kind: AgentStorageCacheCleanupKind) => runAgentAction<AgentStorageCacheCleanup>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'storage-cache-cleanup')
    if (!['media_thumbnail', 'analysis_preview', 'upload_staging', 'storage_temp', 'all'].includes(kind)) {
      throw new AgentIPCError('invalid_input', 0, 'Storage cleanup kind is invalid.')
    }
    return requireAgentClient().cloudCleanupStorageCache(kind)
  }, false))
  ipcMain.handle('agent:cloud-trash', () => runAgentAction<AgentCloudNode[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudTrash()
  }, false))
  ipcMain.handle(
    'agent:cloud-trash-range',
    (_event, offset: unknown, limit: unknown, sort: unknown, order: unknown, includeCount: unknown) =>
      runAgentAction<AgentCloudTrashRange>(async () => {
        const hello = await requireAgentLifecycle().ensureRunning()
        requireAgentCapability(hello, 'cloud-files')
        if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 ||
            typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 ||
            !['name', 'updated', 'size', 'type'].includes(String(sort)) ||
            !['asc', 'desc'].includes(String(order)) ||
            typeof includeCount !== 'boolean') {
          throw new AgentIPCError('invalid_input', 0, 'Trash range arguments are invalid.')
        }
        return requireAgentClient().cloudTrashRange(
          offset,
          limit,
          sort as 'name' | 'updated' | 'size' | 'type',
          order as 'asc' | 'desc',
          includeCount,
        )
      }, false),
  )
  ipcMain.handle('agent:cloud-restore-trash', (_event, id: unknown, revision: unknown) => runAgentAction<AgentCloudNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Trash id and revision are required.')
    }
    return requireAgentClient().cloudRestoreTrash(id, revision)
  }, false))
  ipcMain.handle('agent:cloud-delete-trash', (_event, id: unknown, revision: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Trash id and revision are required.')
    }
    return requireAgentClient().cloudDeleteTrash(id, revision)
  }, false))
  ipcMain.handle('agent:cloud-versions', (_event, nodeID: unknown) => runAgentAction<AgentCloudVersion[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'File node id is required.')
    }
    return requireAgentClient().cloudVersions(nodeID)
  }, false))
  ipcMain.handle('agent:cloud-restore-version', (_event, nodeID: unknown, revision: unknown, versionID: unknown) => runAgentAction<AgentCloudNode>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if ([nodeID, revision, versionID].some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)) {
      throw new AgentIPCError('invalid_input', 0, 'Node id, current revision, and version id are required.')
    }
    return requireAgentClient().cloudRestoreVersion(nodeID as number, revision as number, versionID as number)
  }, false))
  ipcMain.handle('agent:cloud-shares', (_event, nodeID: unknown) => runAgentAction<AgentCloudShare[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'File node id is required.')
    }
    return requireAgentClient().cloudShares(nodeID)
  }, false))
  ipcMain.handle('agent:cloud-create-share', (_event, nodeID: unknown, input: unknown) => runAgentAction<AgentCreatedCloudShare>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof nodeID !== 'number' || !Number.isSafeInteger(nodeID) || nodeID <= 0 || typeof input !== 'object' || input === null) {
      throw new AgentIPCError('invalid_input', 0, 'Valid share input is required.')
    }
    const value = input as { expires_at?: unknown; password?: unknown; max_downloads?: unknown }
    const expiresAt = typeof value.expires_at === 'string' ? value.expires_at : undefined
    const password = typeof value.password === 'string' ? value.password : undefined
    const maxDownloads = value.max_downloads === undefined ? 0 : value.max_downloads
    if (typeof maxDownloads !== 'number' || !Number.isSafeInteger(maxDownloads) || maxDownloads < 0) {
      throw new AgentIPCError('invalid_input', 0, 'Maximum downloads must be a non-negative integer.')
    }
    return requireAgentClient().cloudCreateShare(nodeID, {
      expires_at: expiresAt,
      password,
      max_downloads: maxDownloads,
    })
  }, false))
  ipcMain.handle('agent:cloud-revoke-share', (_event, id: unknown) => runAgentAction<{ ok: boolean }>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new AgentIPCError('invalid_input', 0, 'Share id is required.')
    }
    return requireAgentClient().cloudRevokeShare(id)
  }, false))
  ipcMain.handle('agent:get-diagnostics', () => runAgentAction<AgentDiagnosticReport>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'diagnostics')
    const report = await requireAgentClient().diagnostics()
    return withDesktopCompatibility(report, hello)
  }, false))
  ipcMain.handle('agent:retry', () => refreshAgentState())
  ipcMain.handle('agent:restart', async () => {
    try {
      const hello = await requireAgentLifecycle().restart()
      const status = await requireAgentClient().status()
      const next: AgentConnectionState = { connected: true, hello, status }
      publishAgentState(next)
      return { ok: true, data: next }
    } catch (error) {
      const next: AgentConnectionState = { connected: false, error: agentError(error).message }
      publishAgentState(next)
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('agent:login', async (_event, input: unknown) => {
    const value = input as Partial<{
      server: string
      username: string
      password: string
      mount_path: string
      remember_password: boolean
      auto_login: boolean
      use_saved_password: boolean
    }>
    if (!value || typeof value.server !== 'string' || typeof value.username !== 'string' || typeof value.password !== 'string') {
      return { ok: false, error: { code: 'invalid_input', message: 'Server, username and password are required.' } }
    }
    const server = value.server.trim()
    const username = value.username.trim()
    const mountPath = typeof value.mount_path === 'string' ? value.mount_path.trim() : ''
    const rememberPassword = value.remember_password === true
    const autoLogin = value.auto_login === true
    const useSavedPassword = value.use_saved_password === true
    lastAutoLoginError = ''
    if (!server || !username) {
      return { ok: false, error: { code: 'invalid_input', message: 'Server and username are required.' } }
    }
    if (autoLogin && !rememberPassword) {
      return { ok: false, error: { code: 'invalid_input', message: 'Auto login requires remembered password.' } }
    }
    if (rememberPassword && !securePasswordStorageAvailable()) {
      return { ok: false, error: { code: 'secure_storage_unavailable', message: 'Secure password storage is unavailable on this system.' } }
    }

    const existing = findLoginProfile(loginHistory, server, username)
    let password = value.password
    if (!password && useSavedPassword) {
      if (!existing?.encrypted_password || !securePasswordStorageAvailable()) {
        return { ok: false, error: { code: 'saved_password_unavailable', message: 'The saved password is unavailable. Please enter the password again.' } }
      }
      try {
        password = decryptLoginPassword(existing.encrypted_password)
      } catch {
        return { ok: false, error: { code: 'saved_password_unavailable', message: 'The saved password could not be decrypted. Please enter the password again.' } }
      }
    }
    if (!password) {
      return { ok: false, error: { code: 'invalid_input', message: 'Password is required.' } }
    }

    let encryptedPassword: string | undefined
    if (rememberPassword) {
      if (!value.password && useSavedPassword && existing?.encrypted_password) {
        encryptedPassword = existing.encrypted_password
      } else {
        try {
          encryptedPassword = encryptLoginPassword(password)
        } catch {
          return { ok: false, error: { code: 'secure_storage_unavailable', message: 'Password could not be stored securely.' } }
        }
      }
    }

    const result = await runAgentAction(() => requireAgentClient().login({
      server,
      username,
      password,
      ...(mountPath ? { mount_path: mountPath } : {}),
    }))
    if (result.ok) {
      loginHistory = recordSuccessfulLogin(loginHistory, {
        server,
        username,
        ...(mountPath ? { mount_path: mountPath } : {}),
        last_used_at: new Date().toISOString(),
        remember_password: rememberPassword,
        auto_login: autoLogin,
        ...(encryptedPassword ? { encrypted_password: encryptedPassword } : {}),
      })
      await persistLoginHistoryBestEffort()
    }
    return result
  })
  ipcMain.handle('agent:logout', () => runAgentAction(() => requireAgentClient().logout()))
  ipcMain.handle('agent:change-password', async (_event, input: unknown) => {
    const value = input as Partial<{ current_password: string; new_password: string }>
    if (!value || typeof value.current_password !== 'string' || typeof value.new_password !== 'string') {
      return { ok: false, error: { code: 'invalid_input', message: 'Current and new password are required.' } }
    }
    const { current_password: currentPassword, new_password: newPassword } = value
    const result = await runAgentAction(() => requireAgentClient().changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    }))
    const currentServer = agentState.status?.server?.trim()
    const currentUsername = agentState.status?.username?.trim()
    if (result.ok && currentServer && currentUsername && securePasswordStorageAvailable()) {
      const profile = findLoginProfile(loginHistory, currentServer, currentUsername)
      if (profile?.remember_password) {
        try {
          loginHistory = replaceSavedPassword(loginHistory, currentServer, currentUsername, encryptLoginPassword(newPassword))
          await persistLoginHistoryBestEffort()
        } catch (error) {
          lifecycleLog?.record('login_password_refresh_failed', { error: formatLifecycleError(error) })
        }
      }
    }
    return result
  })
  ipcMain.handle('agent:set-paused', (_event, paused: unknown) => {
    if (typeof paused !== 'boolean') return { ok: false, error: { code: 'invalid_input', message: 'Paused must be a boolean.' } }
    return runAgentAction(() => requireAgentClient().setPaused(paused))
  })
  ipcMain.handle('agent:sync-now', () => runAgentAction(() => requireAgentClient().syncNow()))
  ipcMain.handle('agent:get-settings', () => runAgentAction<AgentSettings>(() => requireAgentClient().settings(), false))
  ipcMain.handle('agent:update-settings', (_event, input: unknown) => {
    const value = input as Partial<{ mount_path: string; cache_limit_bytes: number }>
    const update: { mount_path?: string; cache_limit_bytes?: number } = {}
    if (typeof value?.mount_path === 'string') update.mount_path = value.mount_path
    if (typeof value?.cache_limit_bytes === 'number' && Number.isFinite(value.cache_limit_bytes)) {
      update.cache_limit_bytes = Math.round(value.cache_limit_bytes)
    }
    if (Object.keys(update).length === 0) {
      return { ok: false, error: { code: 'invalid_input', message: 'At least one valid setting is required.' } }
    }
    return runAgentAction<AgentSettings>(() => requireAgentClient().updateSettings(update))
  })
  ipcMain.handle('agent:get-update', () => runAgentAction<AgentUpdateState>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'client-update')
    const next = await requireAgentClient().updateState()
    publishAgentUpdate(next)
    return next
  }, false))
  ipcMain.handle('agent:set-update-mode', (_event, mode: unknown) => {
    if (mode !== 'manual' && mode !== 'check' && mode !== 'download' && mode !== 'install') {
      return { ok: false, error: { code: 'invalid_input', message: 'A valid client update mode is required.' } }
    }
    return runAgentAction<AgentUpdateState>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'client-update')
      const next = await requireAgentClient().setUpdateMode(mode as AgentUpdateMode)
      publishAgentUpdate(next)
      return next
    }, false)
  })
  ipcMain.handle('agent:set-update-source', (_event, source: unknown) => {
    if (source !== 'github' && source !== 'gitlab') {
      return { ok: false, error: { code: 'invalid_input', message: 'A valid client update source is required.' } }
    }
    return runAgentAction<AgentUpdateState>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'client-update')
      const next = await requireAgentClient().setUpdateSource(source as AgentUpdateSource)
      publishAgentUpdate(next)
      return next
    }, false)
  })
  ipcMain.handle('agent:check-update', () => runAgentAction<AgentUpdateState>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'client-update')
    const next = await requireAgentClient().checkUpdate()
    publishAgentUpdate(next)
    return next
  }, false))
  ipcMain.handle('agent:download-update', () => runAgentAction<AgentUpdateState>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'client-update')
    const next = await requireAgentClient().downloadUpdate()
    publishAgentUpdate(next)
    return next
  }, false))
  ipcMain.handle('agent:install-update', () => runAgentAction<AgentUpdateState>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'client-update')
    const next = await requireAgentClient().installUpdate()
    publishAgentUpdate(next)
    return next
  }, false))
  ipcMain.handle('agent:cancel-update', () => runAgentAction<AgentUpdateState>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'client-update-cancel')
    const next = await requireAgentClient().cancelUpdate()
    publishAgentUpdate(next)
    return next
  }, false))
  ipcMain.handle('agent:set-sync-rule', (_event, path: unknown, mode: unknown) => {
    if (typeof path !== 'string' || !path.trim() || (mode !== 'exclude' && mode !== 'always-local' && mode !== 'default')) {
      return { ok: false, error: { code: 'invalid_input', message: 'A sync-rule path and valid mode are required.' } }
    }
    return runAgentAction<AgentSettings>(() => requireAgentClient().setSyncRule(path, mode), false)
  })
  ipcMain.handle('agent:get-file-availability', (_event, path: unknown) => {
    if (typeof path !== 'string' || !path.trim()) {
      return { ok: false, error: { code: 'invalid_input', message: 'A file or directory path is required.' } }
    }
    return runAgentAction<AgentFileAvailability>(() => requireAgentClient().fileAvailability(path), false)
  })
  ipcMain.handle('agent:get-file-availability-batch', (_event, value: unknown) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 2048) {
      return { ok: false, error: { code: 'invalid_input', message: '1 to 2048 file paths are required.' } }
    }
    const paths = [...new Set(value.map((item) => (
      typeof item === 'string' ? item.trim() : ''
    )).filter(Boolean))]
    if (paths.length === 0) {
      return { ok: false, error: { code: 'invalid_input', message: 'At least one file path is required.' } }
    }
    return runAgentAction<AgentFileAvailabilityBatch>(() => {
      const hello = agentState.connected ? agentState.hello : undefined
      if (!hello) {
        throw new AgentIPCError('agent_unavailable', 0, 'xdrive-agent is not connected.')
      }
      requireAgentCapability(hello, 'file-availability-batch')
      return requireAgentClient().fileAvailabilityBatch(paths)
    }, false)
  })
  ipcMain.handle('agent:set-file-availability', (_event, path: unknown, action: unknown) => {
    if (
      typeof path !== 'string' || !path.trim() ||
      (action !== 'keep' && action !== 'release' && action !== 'online' && action !== 'sync')
    ) {
      return { ok: false, error: { code: 'invalid_input', message: 'A path and valid file-availability action are required.' } }
    }
    return runAgentAction(() => requireAgentClient().setFileAvailability(path, action), action === 'sync')
  })
  ipcMain.handle('agent:reconnect', () => runAgentAction(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'diagnostic-actions')
    return requireAgentClient().reconnect()
  }))
  ipcMain.handle('agent:repair-sync-root', () => runAgentAction(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'diagnostic-actions')
    return requireAgentClient().repairSyncRoot()
  }))
  ipcMain.handle('agent:open-logs', () => runAgentAction(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'diagnostic-actions')
    return requireAgentClient().openLogs()
  }, false))
  ipcMain.handle('agent:export-diagnostics', async () => {
    try {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'diagnostics')
      const report = withDesktopCompatibility(await requireAgentClient().diagnostics(), hello)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const options = {
        title: '导出 xDrive 诊断报告',
        defaultPath: path.join(app.getPath('documents'), `xdrive-diagnostics-${stamp}.txt`),
        filters: [{ name: '文本报告', extensions: ['txt'] }],
      }
      const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: true, data: { saved: false } }
      await writeFile(result.filePath, formatDesktopDiagnosticReport(report), { encoding: 'utf8', mode: 0o600 })
      return { ok: true, data: { saved: true } }
    } catch (error) {
      return { ok: false, error: agentError(error) }
    }
  })
  ipcMain.handle('agent:retry-transfer', (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: { code: 'invalid_input', message: 'Transfer id is required.' } }
    }
    return runAgentAction<AgentTransfers>(async () => {
      const next = await requireAgentClient().retryTransfer(id)
      publishAgentTransfers(next)
      return next
    }, false)
  })
  ipcMain.handle('agent:cancel-transfer', (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: { code: 'invalid_input', message: 'Transfer id is required.' } }
    }
    return runAgentAction<AgentTransfers>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'transfer-cancel')
      const next = await requireAgentClient().cancelTransfer(id)
      publishAgentTransfers(next)
      return next
    }, false)
  })
  ipcMain.handle('agent:open-transfer-local', (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: { code: 'invalid_input', message: 'Transfer id is required.' } }
    }
    return runAgentAction<{ ok: boolean }>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'transfer-open-local')
      return requireAgentClient().openTransferLocal(id)
    }, false)
  })
  ipcMain.handle('agent:transfer-lifecycle', (_event, input: unknown) =>
    runAgentAction<{ id?: string; ids?: string[]; ok?: boolean }>(async () => {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'transfer-lifecycle')
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new AgentIPCError('invalid_input', 0, 'Transfer lifecycle input is required.')
      }
      const action = (input as { action?: unknown }).action
      if (
        action !== 'start_group' &&
        action !== 'start_child' &&
        action !== 'start_children' &&
        action !== 'begin' &&
        action !== 'progress' &&
        action !== 'update_group' &&
        action !== 'finish'
      ) {
        throw new AgentIPCError('invalid_input', 0, 'Invalid transfer lifecycle action.')
      }
      if (action === 'start_children') {
        requireAgentCapability(hello, 'transfer-lifecycle-child-batch')
      }
      return requireAgentClient().transferLifecycle(input as AgentTransferLifecycleInput)
    }, false),
  )
  ipcMain.handle('agent:clear-transfer-history', (_event, scope: unknown = 'all') => runAgentAction<AgentTransfers>(async () => {
    if (scope !== 'all' && scope !== 'network' && scope !== 'local') {
      throw new AgentIPCError('invalid_input', 0, 'Invalid transfer history scope.')
    }
    if (scope !== 'all') {
      const hello = await requireAgentLifecycle().ensureRunning()
      requireAgentCapability(hello, 'transfer-history-scope')
    }
    const next = await requireAgentClient().clearTransferHistory(scope)
    publishAgentTransfers(next)
    return next
  }, false))
  ipcMain.handle('agent:get-conflicts', () => runAgentAction<AgentConflict[]>(() => requireAgentClient().conflicts(), false))
  ipcMain.handle('agent:open-conflict', (_event, id: unknown, both: unknown) => {
    if (typeof id !== 'string' || !id.trim() || typeof both !== 'boolean') {
      return { ok: false, error: { code: 'invalid_input', message: 'Conflict id and open mode are required.' } }
    }
    return runAgentAction(() => requireAgentClient().openConflict(id, both), false)
  })
  ipcMain.handle('agent:resolve-conflict', (_event, id: unknown, choice: unknown) => {
    if (typeof id !== 'string' || !id.trim() || (choice !== 'server' && choice !== 'local')) {
      return { ok: false, error: { code: 'invalid_input', message: 'Conflict id and resolution choice are required.' } }
    }
    return runAgentAction(() => requireAgentClient().resolveConflict(id, choice))
  })
  ipcMain.handle('agent:open-folder', () => runAgentAction(() => requireAgentClient().openFolder(), false))
  ipcMain.on('desktop:hide', () => mainWindow?.hide())
  ipcMain.on('desktop:quit', () => {
    requestDesktopQuit('renderer-request')
  })
}

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  lifecycleLog = new DesktopLifecycleLog(desktopLifecycleLogDirectory())
  lifecycleLog.start({
    version: app.getVersion(),
    channel: desktopBuildInfo.channel,
    commit: desktopBuildInfo.commit,
    background: backgroundLaunch,
  })
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    lifecycleLog?.record('uncaught_exception', { origin, error: formatLifecycleError(error) })
  })
  process.on('unhandledRejection', (reason) => {
    lifecycleLog?.record('unhandled_rejection', { error: formatLifecycleError(reason) })
  })
  process.on('exit', (code) => lifecycleLog?.record('process_exit', { exit_code: code }))
  app.on('child-process-gone', (_event, details) => {
    lifecycleLog?.record('child_process_gone', {
      process_type: details.type,
      reason: details.reason,
      exit_code: details.exitCode,
      service_name: details.serviceName,
    })
    if (
      process.platform !== 'win32' ||
      details.type !== 'GPU' ||
      quitting ||
      hardwareAccelerationDisabled ||
      gpuSafeModeRelaunchPending ||
      !['crashed', 'oom', 'abnormal-exit', 'launch-failed'].includes(details.reason)
    ) {
      return
    }

    const now = Date.now()
    while (gpuCrashTimes.length > 0 && now - gpuCrashTimes[0] > 60_000) gpuCrashTimes.shift()
    gpuCrashTimes.push(now)
    if (gpuCrashTimes.length < 2) return

    gpuSafeModeRelaunchPending = true
    lifecycleLog?.record('gpu_safe_mode_relaunch', {
      crashes: gpuCrashTimes.length,
      window_ms: 60_000,
      reason: details.reason,
    })
    app.relaunch({
      args: [...process.argv.slice(1).filter((arg) => arg !== '--disable-gpu'), '--disable-gpu'],
    })
    quitting = true
    quitReason = 'gpu-safe-mode-relaunch'
    app.exit(0)
  })
  app.on('second-instance', (_event, commandLine) => {
    const action = desktopShortcutActionFromArgs(commandLine)
    if (action) {
      void app.whenReady().then(() => performDesktopShortcutAction(action))
      return
    }
    if (mainWindow) showMainWindow()
    else void app.whenReady().then(showMainWindow)
  })
  app.on('before-quit', () => {
    quitting = true
    lifecycleLog?.record('before_quit', { reason: quitReason })
    agentMonitor?.abort()
    transferMonitor?.abort()
    if (trayTransferRateTimer) clearInterval(trayTransferRateTimer)
    trayTransferRateTimer = null
    sourceRunMonitor?.abort()
    updateMonitor?.abort()
    void filePreviewProxy?.close()
  })
  app.on('quit', (_event, exitCode) => lifecycleLog?.cleanExit(quitReason, exitCode))
  void app.whenReady().then(async () => {
    startupCheckpoint('electron_ready', { hardware_acceleration: hardwareAccelerationDisabled ? 'disabled' : 'enabled' })
    app.setAppUserModelId('io.github.lazyxu.xdrive.desktop')
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(desktopWindowBackground())
    })
    Menu.setApplicationMenu(null)
    registerWindowsUserTasks()
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    desktopPreferences = await loadDesktopPreferences()
    nativeTheme.themeSource = desktopPreferences.appearance
    loginHistory = await loadLoginHistory()
    startupCheckpoint('preferences_loaded')
    await applyStartAtLogin(desktopPreferences.start_at_login).catch((error) => {
      lifecycleLog?.record('startup_preference_failed', { error: formatLifecycleError(error) })
    })

    agentClient = new AgentIPCClient(path.join(app.getPath('appData'), 'xdrive', 'desktop-ipc.json'))
    agentLifecycle = new AgentLifecycle(agentClient)
    filePreviewProxy = new DesktopFilePreviewProxy(
      (nodeID) => requireAgentClient().cloudFilePreviewTicket(nodeID),
      (input, init) => net.fetch(input, init),
    )
    registerIPCHandlers()
    startupCheckpoint('ipc_ready')
    createMainWindow(!backgroundLaunch)
    createTray()
    startupCheckpoint('tray_created')
    const initialAgentState = await refreshAgentState()
    startupCheckpoint('agent_checked', { connected: initialAgentState.connected })
    if (initialAgentState.connected && !initialAgentState.status?.configured) {
      await attemptAutomaticLogin()
    }
    restartDesktopMonitors()
    startupCheckpoint('monitors_started')
    powerMonitor.on('resume', () => {
      restartDesktopMonitors()
    })
    if (startupDesktopAction) await performDesktopShortcutAction(startupDesktopAction)
    startupCoreReady = true
    markStartupCompleteIfReady()
  }).catch((error) => {
    void failDesktopStartup('startup_failed', error)
  })
  app.on('activate', () => {
    if (mainWindow) showMainWindow()
    else createMainWindow()
  })
  app.on('window-all-closed', () => {
    // The tray owns the desktop lifetime. Explicit Quit exits the app.
  })
}
