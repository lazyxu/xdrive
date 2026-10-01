const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'src', 'preload', 'index.cts'), 'utf8')
const rendererApp = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')
const renderer = rendererApp + fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SettingsDialog.tsx'), 'utf8') + fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopSettingsContent.tsx'), 'utf8')
const setVersion = fs.readFileSync(path.join(root, 'scripts', 'set-version.mjs'), 'utf8')

test('desktop native feedback wires taskbar progress and clickable navigation', () => {
  assert.ok(main.includes('setProgressBar'), 'missing Windows taskbar progress')
  assert.ok(main.includes('setOverlayIcon'), 'missing Windows taskbar status overlay')
  assert.ok(main.includes('flashFrame(true)'), 'missing Windows taskbar attention flash')
  assert.ok(main.includes("win.on('focus', () => win.flashFrame(false))"), 'missing taskbar flash reset on focus')
  assert.ok(main.includes("powerMonitor.on('resume'"), 'missing system-resume monitor recovery')
  assert.ok(main.includes('restartDesktopMonitors()'), 'missing monitor restart helper')
  assert.ok(main.includes('app.setUserTasks(windowsUserTasks(process.execPath))'), 'missing Windows Jump List tasks')
  assert.ok(main.includes("win.webContents.on('before-input-event'"), 'missing window-local keyboard shortcuts')
  assert.ok(main.includes("win.webContents.on('context-menu'"), 'missing native editable context menu')
  assert.ok(main.includes('editContextMenuTemplate(params.editFlags)'), 'missing edit-flag driven menu state')
  assert.ok(main.includes("app.on('second-instance', (_event, commandLine)"), 'missing second-instance shortcut routing')
  assert.ok(main.includes('tray.setImage(trayStatusImage())'), 'missing dynamic tray status icon updates')
  assert.ok(main.includes("path.join(process.resourcesPath, 'tray-icons')"), 'missing packaged tray icon resource path')
  assert.ok(main.includes("path.resolve(app.getAppPath(), '..', 'assets', 'icon', 'tray')"), 'missing development tray icon resource path')
  assert.ok(main.includes('nativeImage.createFromBuffer(taskbarOverlayPNG(kind))'), 'taskbar overlay must decode a PNG buffer')
  assert.ok(main.includes("lifecycleLog?.record('taskbar_overlay_invalid'"), 'invalid taskbar overlays must be logged without aborting startup')
  assert.ok(main.includes("lifecycleLog?.record('taskbar_overlay_failed'"), 'taskbar overlay failures must be non-fatal')
  assert.equal(main.includes('taskbar overlay badge is invalid'), false, 'taskbar badge decode failures must not throw during startup')
  assert.ok(main.includes("{ label: '设置', click: () => showDesktopView('settings') }"), 'missing tray settings shortcut')
  assert.ok(main.includes("label: '打开传输中心'"), 'missing tray transfer center shortcut')
  assert.ok(main.includes("showDesktopNotification('xDrive 冲突'"), 'missing clickable conflict notification')
  assert.ok(main.includes("'settings-update'"), 'update notification must navigate to the client update section')
  assert.ok(main.includes("'desktop:navigate'"), 'missing main-process navigation event')
  assert.ok(preload.includes("'desktop:navigate'"), 'missing preload navigation bridge')
  assert.ok(renderer.includes('window.xdriveDesktop.onNavigate'), 'missing renderer navigation subscription')
  assert.ok(main.includes("desktopBuildInfo"), 'desktop info must expose packaged build metadata')
  assert.ok(renderer.includes('Desktop 构建信息'), 'settings must show Desktop build metadata')
  assert.ok(renderer.includes('Server 构建信息'), 'settings must show Server build metadata')
  assert.ok(rendererApp.includes('buildInfoSectionID="desktop-build-info"'), 'About must target the Desktop/Server build information section')
  assert.ok(renderer.includes('id={buildInfoSectionID}'), 'shared Settings dialog must expose the build-info anchor')
  assert.ok(rendererApp.includes("{ title: 'Server 构建信息', info: status?.server_build }"), 'settings must bind Server build metadata')
  assert.ok(setVersion.includes('XDRIVE_BUILD_COMMIT'), 'desktop packaging must embed commit metadata')
  assert.ok(setVersion.includes('XDRIVE_BUILD_COMMIT_MESSAGE_B64'), 'desktop packaging must embed commit message metadata')
  assert.ok(setVersion.includes('XDRIVE_BUILD_COMMIT_TIME'), 'desktop packaging must embed commit time metadata')
  assert.ok(setVersion.includes('XDRIVE_BUILD_TIME'), 'desktop packaging must embed build time metadata')
})


test('desktop startup failures are visible and renderer loading is guarded', () => {
  assert.ok(main.includes("title: 'xDrive Desktop 启动失败'"), 'foreground startup failures need a native error dialog')
  assert.ok(main.includes("buttons: ['打开日志目录', '退出']"), 'startup error dialog must offer the lifecycle log directory')
  assert.ok(main.includes("win.webContents.on('did-fail-load'"), 'missing main-frame load failure handling')
  assert.ok(main.includes("win.webContents.on('preload-error'"), 'missing preload failure handling')
  assert.ok(main.includes("'renderer_load_timeout'"), 'missing renderer startup timeout')
  assert.ok(main.includes('15_000'), 'renderer startup timeout should be bounded')
})

test('desktop startup lifecycle records checkpoints and non-fatal Windows task registration', () => {
  for (const stage of [
    'electron_ready',
    'preferences_loaded',
    'ipc_ready',
    'window_created',
    'tray_created',
    'agent_checked',
    'monitors_started',
    'renderer_loaded',
    'window_shown',
    'startup_complete',
  ]) {
    assert.ok(main.includes(`startupCheckpoint('${stage}'`), `missing startup checkpoint: ${stage}`)
  }
  assert.ok(main.includes("'windows_user_tasks_failed'"), 'Windows user-task failures must reach the lifecycle log')
  assert.ok(main.includes("'Windows 任务栏快捷操作'"), 'Windows user-task status must appear in diagnostics')
  assert.equal(main.includes("console.error('failed to register Windows taskbar user tasks')"), false, 'user-task registration should not be console-only')
})


test('desktop renderer crashes recover once and then enter a bounded recovery flow', () => {
  assert.ok(main.includes("'renderer_recovery_reload'"), 'first renderer crash should trigger an automatic reload')
  assert.ok(main.includes("'renderer_recovery_exhausted'"), 'repeated renderer crashes should stop the automatic reload loop')
  assert.ok(main.includes("title: 'xDrive Desktop 界面恢复'"), 'repeated crashes need a native recovery dialog')
  assert.ok(main.includes("buttons: ['重新加载界面', '打开日志目录', '退出 xDrive']"), 'recovery dialog must expose retry, logs, and exit')
  assert.ok(main.includes("'renderer_recovery_stable'"), 'successful recovery should clear the crash window after a stable period')
  assert.ok(main.includes('if (win.isVisible()) void showRendererRecoveryDialog()'), 'visible windows should surface recovery even after a background launch')
  assert.ok(main.includes('if (rendererRecoveryExhausted) return'), 'navigation must wait for recovery instead of sending into a crashed renderer')
})

test('repeated Windows GPU crashes relaunch Desktop in hardware-acceleration compatibility mode', () => {
  assert.ok(main.includes("process.argv.includes('--disable-gpu')"), 'Desktop must recognize GPU compatibility mode')
  assert.ok(main.includes('app.disableHardwareAcceleration()'), 'GPU compatibility mode must disable acceleration before ready')
  assert.ok(main.includes("'gpu_safe_mode_relaunch'"), 'repeated GPU crashes must be recorded')
  assert.ok(main.includes('app.relaunch({'), 'repeated GPU crashes must relaunch Desktop')
  assert.ok(main.includes("'桌面图形加速'"), 'diagnostics must report the current graphics acceleration mode')
})
