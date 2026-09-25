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
  Notification,
  session,
  Tray,
  type OpenDialogOptions,
} from 'electron'
import { AgentLifecycle } from './agent_lifecycle.cjs'
import {
  AgentIPCClient,
  AgentIPCError,
  type AgentHello,
  type AgentConflict,
  type AgentDiagnosticReport,
  type AgentStorageTreeNode,
  type AgentCacheStats,
  type AgentCacheReleaseResult,
  type AgentFileAvailability,
  type AgentSettings,
  type AgentStatus,
  type AgentTransfers,
} from './agent_client.cjs'

const TRAY_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA20lEQVR42uWX4RGDIAyFNTPYDdrJ2rHsZHYD3UF/9Y6zCbxAQrwrfw35Hgk8ZBj+fYy5j/fnuluBPu/bCAuwBJeEUE84l596wjkORW9C6r36M09dgWWeTGKqWvBNnAMgMWoByzz9JOQAXExJCCTg8dqKpZZA0lx1C0qJaudQa0KpzKjg6/iAZVk17aqqQA6g3StVAhAfcBMQ6oThm1A6btLxNBWg7S06h1oSpStH7LrpLjgDOCAXY3YXpADEB9ys2M0Jpf9279/za/lAryqkHEKfUF4vo/C3Yfg4ANVHcjg82WLtAAAAAElFTkSuQmCC'

type AgentConnectionState = {
  connected: boolean
  hello?: AgentHello
  status?: AgentStatus
  error?: string
}

type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status?: number } }

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let agentClient: AgentIPCClient | null = null
let agentLifecycle: AgentLifecycle | null = null
let agentState: AgentConnectionState = { connected: false, error: 'Connecting to xdrive-agent…' }
let agentTransfers: AgentTransfers = { revision: 0, transfers: [] }
let agentMonitor: AbortController | null = null
let transferMonitor: AbortController | null = null
const backgroundLaunch = process.argv.includes('--background')
const desktopPreferencesName = 'desktop-settings.json'

type DesktopPreferences = {
  start_at_login: boolean
}

async function loadDesktopPreferences(): Promise<DesktopPreferences> {
  const file = path.join(app.getPath('userData'), desktopPreferencesName)
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<DesktopPreferences>
    if (typeof parsed.start_at_login === 'boolean') {
      return { start_at_login: parsed.start_at_login }
    }
  } catch {
    // First run or malformed local preference: use the product default below.
  }
  return { start_at_login: true }
}

async function saveDesktopPreferences(preferences: DesktopPreferences) {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, desktopPreferencesName),
    JSON.stringify(preferences, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  )
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
      'Name=xDrive Desktop',
      'Comment=Start xDrive in the background',
      `Exec=${quoteDesktopExec(process.execPath)} --background`,
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n')
    await writeFile(desktopFile, contents, { encoding: 'utf8', mode: 0o600 })
  }
}

async function setStartAtLogin(enabled: boolean) {
  const preferences = { start_at_login: enabled }
  await saveDesktopPreferences(preferences)
  await applyStartAtLogin(enabled)
  return preferences
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createMainWindow(showOnReady = true) {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'xDrive Desktop',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win
  win.on('minimize', () => win.hide())
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
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
  if (devURL) void win.loadURL(devURL)
  else void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  win.once('ready-to-show', () => {
    if (showOnReady) win.show()
  })
  win.webContents.once('did-finish-load', () => win.webContents.send('agent:state', agentState))
}

function statusLabel() {
  if (!agentState.connected) return 'Agent not connected'
  const status = agentState.status
  if (!status) return 'Connecting'
  if (status.has_conflict) return `Conflicts (${status.conflict_count})`
  if (status.paused) return 'Paused'
  return status.sync_status || status.auth_status
}

function rebuildTrayMenu() {
  if (!tray) return
  const status = agentState.status
  const configured = !!status?.configured
  tray.setToolTip(`xDrive — ${statusLabel()}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Open xDrive Desktop', click: showMainWindow },
    {
      label: 'Open xDrive Folder',
      enabled: agentState.connected && configured,
      click: () => { void runAgentAction(() => requireAgentClient().openFolder(), false) },
    },
    {
      label: 'Sync Now',
      enabled: agentState.connected && configured && !status?.paused,
      click: () => { void runAgentAction(() => requireAgentClient().syncNow()) },
    },
    {
      label: status?.paused ? 'Resume Sync' : 'Pause Sync',
      enabled: agentState.connected && configured,
      click: () => { void runAgentAction(() => requireAgentClient().setPaused(!status?.paused)) },
    },
    { type: 'separator' },
    {
      label: 'Quit xDrive Desktop',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ]))
}

function createTray() {
  const trayIcon = nativeImage
    .createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'))
    .resize({ width: process.platform === 'win32' ? 16 : 22, height: process.platform === 'win32' ? 16 : 22 })
  tray = new Tray(trayIcon)
  tray.on('click', showMainWindow)
  rebuildTrayMenu()
}

function notifyAgentTransition(previous: AgentConnectionState, next: AgentConnectionState) {
  if (!previous.connected || !next.connected || !previous.status || !next.status || !Notification.isSupported()) return

  const before = previous.status
  const after = next.status
  if (after.conflict_count > before.conflict_count) {
    new Notification({
      title: 'xDrive conflict',
      body: `${after.conflict_count} unresolved conflict${after.conflict_count === 1 ? '' : 's'} need attention.`,
    }).show()
  } else if (before.sync_status === '正在同步' && after.sync_status === '同步正常') {
    new Notification({ title: 'xDrive', body: 'Sync completed.' }).show()
  }

  if (before.auth_status !== after.auth_status && (after.auth_status === '登录已过期' || after.auth_status === '账户已禁用')) {
    new Notification({ title: 'xDrive', body: 'Your xDrive session needs attention. Open xDrive Desktop to sign in again.' }).show()
  }
}

function publishAgentState(next: AgentConnectionState) {
  const previous = agentState
  const changed = JSON.stringify(previous) !== JSON.stringify(next)
  if (changed) notifyAgentTransition(previous, next)
  agentState = next
  rebuildTrayMenu()
  if (changed && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:state', next)
}

function publishAgentTransfers(next: AgentTransfers) {
  const changed = JSON.stringify(agentTransfers) !== JSON.stringify(next)
  agentTransfers = next
  if (changed && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:transfers', next)
  }
}

function withDesktopCompatibility(report: AgentDiagnosticReport, hello: AgentHello): AgentDiagnosticReport {
  const compatibility = {
    name: 'Desktop / Agent compatibility',
    status: 'PASS' as const,
    detail: `Desktop ${app.getVersion()} · Agent ${hello.agent_version} · IPC desktop ${AgentIPCClient.protocolMin}-${AgentIPCClient.protocolMax} / agent ${hello.protocol_min}-${hello.protocol_max}`,
  }
  const checks = [...report.checks, compatibility]
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
    return { code: error.code, message: error.message, ...(error.status ? { status: error.status } : {}) }
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

function registerIPCHandlers() {
  ipcMain.handle('desktop:get-info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }))
  ipcMain.handle('desktop:get-startup', () => loadDesktopPreferences())
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
  ipcMain.handle('desktop:select-directory', async (_event, defaultPath?: unknown) => {
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], title: 'Choose xDrive sync folder' }
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
  ipcMain.handle('agent:login', (_event, input: unknown) => {
    const value = input as Partial<{ server: string; username: string; password: string; mount_path: string }>
    if (!value || typeof value.server !== 'string' || typeof value.username !== 'string' || typeof value.password !== 'string') {
      return { ok: false, error: { code: 'invalid_input', message: 'Server, username and password are required.' } }
    }
    const { server, username, password } = value
    const mountPath = typeof value.mount_path === 'string' ? value.mount_path.trim() : ''
    return runAgentAction(() => requireAgentClient().login({
      server,
      username,
      password,
      ...(mountPath ? { mount_path: mountPath } : {}),
    }))
  })
  ipcMain.handle('agent:logout', () => runAgentAction(() => requireAgentClient().logout()))
  ipcMain.handle('agent:change-password', (_event, input: unknown) => {
    const value = input as Partial<{ current_password: string; new_password: string }>
    if (!value || typeof value.current_password !== 'string' || typeof value.new_password !== 'string') {
      return { ok: false, error: { code: 'invalid_input', message: 'Current and new password are required.' } }
    }
    const { current_password: currentPassword, new_password: newPassword } = value
    return runAgentAction(() => requireAgentClient().changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    }))
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
        title: 'Export xDrive diagnostic report',
        defaultPath: path.join(app.getPath('documents'), `xdrive-diagnostics-${stamp}.txt`),
        filters: [{ name: 'Text report', extensions: ['txt'] }],
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
    quitting = true
    app.quit()
  })
}

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) showMainWindow()
    else void app.whenReady().then(showMainWindow)
  })
  app.on('before-quit', () => {
    quitting = true
    agentMonitor?.abort()
    transferMonitor?.abort()
  })
  void app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.lazyxu.xdrive.desktop')
    Menu.setApplicationMenu(null)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    const preferences = await loadDesktopPreferences()
    await applyStartAtLogin(preferences.start_at_login).catch((error) => {
      console.error('failed to configure desktop startup:', error)
    })

    agentClient = new AgentIPCClient(path.join(app.getPath('appData'), 'xdrive', 'desktop-ipc.json'))
    agentLifecycle = new AgentLifecycle(agentClient)
    registerIPCHandlers()
    createMainWindow(!backgroundLaunch)
    createTray()
    startAgentMonitor()
    startTransferMonitor()
  })
  app.on('activate', () => {
    if (mainWindow) showMainWindow()
    else createMainWindow()
  })
  app.on('window-all-closed', () => {
    // The tray owns the desktop lifetime. Explicit Quit exits the app.
  })
}
