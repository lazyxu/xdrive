import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  Notification,
  powerMonitor,
  screen,
  session,
  shell,
  safeStorage,
  Tray,
  type OpenDialogOptions,
} from 'electron'
import { AgentLifecycle } from './agent_lifecycle.cjs'
import { desktopBuildInfo } from './build_metadata.cjs'
import { trayUpdatePresentation } from './tray_update.cjs'
import { trayTransferPresentation } from './tray_transfers.cjs'
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
import {
  defaultDesktopPreferences,
  normalizeDesktopPreferences,
  resolveWindowBounds,
  type DesktopPreferences,
} from './window_preferences.cjs'
import {
  automaticLoginProfile,
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
  type AgentCloudNode,
  type AgentCloudQuota,
  type AgentCloudStorageStats,
  type AgentCloudVersion,
  type AgentCloudShare,
  type AgentCreatedCloudShare,
  type AgentCloudSearchResult,
  type AgentMediaItem,
  type AgentMediaAlbum,
  type AgentMediaThumbnail,
  type AgentSource,
  type AgentCreateSourceInput,
  type AgentUpdateSourceInput,
  type AgentSourceRun,
  type AgentSourceRunFailure,
  type AgentSourceItem,
  type AgentSourceCollection,
  type AgentSourceCollectionItem,
  type AgentSourceCredentialStatus,
  type AgentSourceCredentialTestResult,
  type AgentSourceConnectorConfig,
  type AgentFileAvailability,
  type AgentSettings,
  type AgentUpdateMode,
  type AgentUpdateSource,
  type AgentUpdateState,
  type AgentStatus,
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
let desktopPreferences = defaultDesktopPreferences()
let loginHistory: LoginHistory = emptyLoginHistory()
let windowStateSaveTimer: NodeJS.Timeout | null = null
let closeDecisionPending = false
let pendingDesktopView: DesktopViewTarget | null = null
let tray: Tray | null = null
let quitting = false
let quitReason = 'system-or-application'
let lifecycleLog: DesktopLifecycleLog | null = null
let agentClient: AgentIPCClient | null = null
let agentLifecycle: AgentLifecycle | null = null
let agentState: AgentConnectionState = { connected: false, error: 'Connecting to xdrive-agent…' }
let agentTransfers: AgentTransfers = { revision: 0, transfers: [] }
let agentUpdateState: AgentUpdateState | null = null
let agentMonitor: AbortController | null = null
let transferMonitor: AbortController | null = null
let updateMonitor: AbortController | null = null
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
  return publicLoginHistory(loginHistory, securePasswordStorageAvailable())
}

async function persistLoginHistoryBestEffort() {
  try {
    await saveLoginHistory()
  } catch (error) {
    lifecycleLog?.record('login_history_save_failed', { error: formatLifecycleError(error) })
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
    return
  }
  mainWindow.setProgressBar(progress.value, { mode: progress.mode })
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
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.resolve(app.getAppPath(), '..', 'assets', 'icon', 'web', 'pwa-192.png')
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
    icon: desktopRuntimeIconPath(),
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
    if (showOnReady) win.show()
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
  updateTrayIcon()
  const status = agentState.status
  const configured = !!status?.configured
  const update = trayUpdatePresentation(agentUpdateState)
  const transfer = trayTransferPresentation(agentTransfers)
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
    if (isUnavailable(error)) publishAgentState({ connected: false, error: agentError(error).message })
    return { ok: false, error: agentError(error) }
  }
}

async function attemptAutomaticLogin() {
  const profile = automaticLoginProfile(loginHistory)
  if (!profile || !profile.encrypted_password || !securePasswordStorageAvailable()) return
  if (!agentState.connected || agentState.status?.configured) return

  try {
    const password = decryptLoginPassword(profile.encrypted_password)
    const result = await runAgentAction(() => requireAgentClient().login({
      server: profile.server,
      username: profile.username,
      password,
      ...(profile.mount_path ? { mount_path: profile.mount_path } : {}),
    }))
    if (!result.ok) {
      loginHistory = disableAutomaticLogin(loginHistory)
      await persistLoginHistoryBestEffort()
      lifecycleLog?.record('auto_login_failed', { code: result.error.code, status: result.error.status })
    }
  } catch (error) {
    loginHistory = disableAutomaticLogin(loginHistory)
    await persistLoginHistoryBestEffort()
    lifecycleLog?.record('auto_login_failed', { error: formatLifecycleError(error) })
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

function restartDesktopMonitors() {
  startAgentMonitor()
  startTransferMonitor()
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
  ipcMain.handle('agent:get-media-items', (_event, kind: unknown = '', limit: unknown = 100, offset: unknown = 0) => runAgentAction<AgentMediaItem[]>(async () => {
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
    return requireAgentClient().mediaItems(kind.trim(), requestedLimit, requestedOffset)
  }, false))

  ipcMain.handle('agent:get-media-albums', () => runAgentAction<AgentMediaAlbum[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    return requireAgentClient().mediaAlbums()
  }, false))

  ipcMain.handle('agent:get-media-album-items', (_event, albumID: unknown, limit: unknown = 100, offset: unknown = 0) => runAgentAction<AgentMediaItem[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof albumID !== 'string' ||
      (!albumID.startsWith('folder:') && !albumID.startsWith('source:'))
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
    return requireAgentClient().mediaAlbumItems(albumID, requestedLimit, requestedOffset)
  }, false))

  ipcMain.handle('agent:get-media-thumbnail', (_event, nodeID: unknown) => runAgentAction<AgentMediaThumbnail>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'media-gallery')
    if (
      typeof nodeID !== 'number' ||
      !Number.isSafeInteger(nodeID) ||
      nodeID <= 0
    ) {
      throw new AgentIPCError('invalid_input', 0, 'Media node id is required.')
    }
    return requireAgentClient().mediaThumbnail(nodeID)
  }, false))

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
  ipcMain.handle('agent:cloud-search', (_event, query: unknown) => runAgentAction<AgentCloudSearchResult[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    if (typeof query !== 'string' || query.trim().length < 2) {
      throw new AgentIPCError('invalid_input', 0, 'Search requires at least 2 characters.')
    }
    return requireAgentClient().cloudSearch(query.trim())
  }, false))
  ipcMain.handle('agent:cloud-quota', () => runAgentAction<AgentCloudQuota>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudQuota()
  }, false))
  ipcMain.handle('agent:cloud-storage-stats', () => runAgentAction<AgentCloudStorageStats>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'storage-intelligence')
    return requireAgentClient().cloudStorageStats()
  }, false))
  ipcMain.handle('agent:cloud-trash', () => runAgentAction<AgentCloudNode[]>(async () => {
    const hello = await requireAgentLifecycle().ensureRunning()
    requireAgentCapability(hello, 'cloud-files')
    return requireAgentClient().cloudTrash()
  }, false))
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
    updateMonitor?.abort()
  })
  app.on('quit', (_event, exitCode) => lifecycleLog?.cleanExit(quitReason, exitCode))
  void app.whenReady().then(async () => {
    startupCheckpoint('electron_ready', { hardware_acceleration: hardwareAccelerationDisabled ? 'disabled' : 'enabled' })
    app.setAppUserModelId('io.github.lazyxu.xdrive.desktop')
    nativeTheme.themeSource = 'system'
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(desktopWindowBackground())
    })
    Menu.setApplicationMenu(null)
    registerWindowsUserTasks()
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    desktopPreferences = await loadDesktopPreferences()
    loginHistory = await loadLoginHistory()
    startupCheckpoint('preferences_loaded')
    await applyStartAtLogin(desktopPreferences.start_at_login).catch((error) => {
      lifecycleLog?.record('startup_preference_failed', { error: formatLifecycleError(error) })
    })

    agentClient = new AgentIPCClient(path.join(app.getPath('appData'), 'xdrive', 'desktop-ipc.json'))
    agentLifecycle = new AgentLifecycle(agentClient)
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
