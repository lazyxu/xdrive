const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const rendererApp = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')
const sharedSourceManager = [
  fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceManager.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceManagerDialogs.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceManagerDetailsDialog.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceManagerCreateDialog.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceManagerSettingsDialog.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceManagerListPage.tsx'), 'utf8'),
].join('\n')
const sharedSettingsDialog = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SettingsDialog.tsx'), 'utf8')
const sharedCloudStoragePage = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'CloudStoragePage.tsx'), 'utf8')
const desktopLocalStoragePage = fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopLocalStoragePage.tsx'), 'utf8')
const sharedShareDialog = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ShareDialog.tsx'), 'utf8')
const sharedTrashDialog = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'TrashDialog.tsx'), 'utf8')
const sharedVersionHistoryDialog = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'VersionHistoryDialog.tsx'), 'utf8')
const sharedFileNameDialog = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'FileNameDialog.tsx'), 'utf8')
const sharedTaskCenterPage = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'TaskCenterPage.tsx'), 'utf8')
const sharedMediaGalleryPage = [
  'MediaGallery.tsx',
  'MediaGalleryDetails.tsx',
  'MediaGalleryPreviewMedia.tsx',
  'MediaGalleryUtils.ts',
  'MediaGalleryFilters.tsx',
].map((name) => fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', name), 'utf8')).join('\n')
const sharedPasswordChangeForm = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'PasswordChangeForm.tsx'), 'utf8')
const desktopFileExplorer = fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopFileExplorer.tsx'), 'utf8')
const desktopSourceAdapter = fs.readFileSync(path.join(root, 'src', 'renderer', 'sourceManagerAdapter.ts'), 'utf8')
const desktopShareAdapter = fs.readFileSync(path.join(root, 'src', 'renderer', 'fileDialogAdapters.ts'), 'utf8')
const desktopOverviewPage = fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopOverviewPage.tsx'), 'utf8')
const desktopConflictsPage = fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopConflictsPage.tsx'), 'utf8')
const desktopDiagnosticsPage = fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopDiagnosticsPage.tsx'), 'utf8')
const desktopFilesPage = fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopFilesPage.tsx'), 'utf8')
const desktopSettingsContent = fs.readFileSync(path.join(root, 'src', 'renderer', 'DesktopSettingsContent.tsx'), 'utf8')
const renderer = [
  rendererApp,
  sharedSourceManager,
  sharedSettingsDialog,
  sharedCloudStoragePage,
  desktopLocalStoragePage,
  sharedShareDialog,
  sharedTrashDialog,
  sharedVersionHistoryDialog,
  sharedFileNameDialog,
  sharedTaskCenterPage,
  sharedMediaGalleryPage,
  sharedPasswordChangeForm,
  desktopFileExplorer,
  desktopSourceAdapter,
  desktopShareAdapter,
  desktopOverviewPage,
  desktopConflictsPage,
  desktopDiagnosticsPage,
  desktopFilesPage,
  desktopSettingsContent,
].join('\n')
const synologyGuide = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SynologyDsmGuideDialog.tsx'), 'utf8')
const dialogTitle = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'DialogTitle.tsx'), 'utf8')
const dialogActions = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'DialogActions.tsx'), 'utf8')
const dialogContent = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'DialogContent.tsx'), 'utf8')
const sharedActionButton = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ActionButton.tsx'), 'utf8')
const sharedStatePanel = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'StatePanel.tsx'), 'utf8')
const sharedStatusBadge = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'StatusBadge.tsx'), 'utf8')
const sharedSourceSummaryCard = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceSummaryCard.tsx'), 'utf8')
const sharedStatusAlert = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'StatusAlert.tsx'), 'utf8')
const sharedSidebarNav = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SidebarNav.tsx'), 'utf8')
const sharedWorkspaceSidebar = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'WorkspaceSidebar.tsx'), 'utf8')
const sharedWorkspaceShell = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'WorkspaceShell.tsx'), 'utf8')
const sharedAccountChrome = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'AccountChrome.tsx'), 'utf8')
const sharedBrandLockup = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'BrandLockup.tsx'), 'utf8')
const sharedAuthSurface = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'AuthSurface.tsx'), 'utf8')
const sharedAuthForm = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'AuthForm.tsx'), 'utf8')
const sharedDescriptionGrid = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'DescriptionGrid.tsx'), 'utf8')
const sharedSectionHeader = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SectionHeader.tsx'), 'utf8')
const sharedPageHeader = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'PageHeader.tsx'), 'utf8')
const sharedConfirmDialog = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ConfirmDialog.tsx'), 'utf8')
const sharedShareStatusBadge = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ShareStatusBadge.tsx'), 'utf8')
const sharedShareList = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ShareList.tsx'), 'utf8')
const sharedYikeCookieHelp = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'YikeCookieHelp.tsx'), 'utf8')
const sharedExternalSources = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'external-sources.ts'), 'utf8')
const sharedSourceRunProgress = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceRunProgress.tsx'), 'utf8')
const sharedSourceFailureItem = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceFailureItem.tsx'), 'utf8')
const sharedPaginationControls = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'PaginationControls.tsx'), 'utf8')
const sharedSourceRunSummary = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceRunSummary.tsx'), 'utf8')
const sharedSourceCollection = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceCollection.tsx'), 'utf8')
const sharedSourceScheduleFields = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceScheduleFields.tsx'), 'utf8')
const sharedSourceBasicFields = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceBasicFields.tsx'), 'utf8')
const sharedSourceCredentialFields = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceCredentialFields.tsx'), 'utf8')
const sharedSourceConnectorConfigFields = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceConnectorConfigFields.tsx'), 'utf8')
const sharedSourceIgnoreRulesField = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceIgnoreRulesField.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')

test('desktop renderer default export is the full App root, not a helper component', () => {
  assert.match(rendererApp, /export default function App\(\{/)
  assert.equal(rendererApp.includes('export default function YikeCookieHelpGuide()'), false)
})

test('desktop GUI defaults to Chinese', () => {
  for (const text of [
    '概览',
    '云端文件',
    '同步文件夹',
    '立即扫描',
    '同步文件夹设置',
    '保存设置',
    '添加同步文件夹',
    '目标文件夹',
    '添加同步文件夹',
    '任务中心',
    '存储策略',
    '冲突副本',
    '客户端诊断',
    '客户端设置',
    '客户端更新',
    '更新来源',
    'GitHub',
    'GitLab',
    '关闭窗口时最小化到系统托盘',
    '手动检查',
    '自动检查',
    '有更新自动下载',
    '自动更新',
    '检查更新',
    '下载更新',
    '创建分享链接',
  ]) {
    assert.ok(renderer.includes(text), `missing Chinese desktop label: ${text}`)
  }

  for (const text of [
    '打开 xDrive 桌面版',
    '设置',
    '打开 xDrive 文件夹',
    '立即同步',
    '暂停同步',
    '退出 xDrive 桌面版',
    '客户端更新',
    '检查更新',
    '关闭 xDrive 桌面版',
    '最小化到托盘',
    '选择 xDrive 同步文件夹',
  ]) {
    assert.ok(main.includes(text), `missing Chinese desktop system label: ${text}`)
  }

  for (const text of ['群晖 DSM 配置', 'DSM 操作示意图', '上一步', '下一步', '完成']) {
    assert.ok(synologyGuide.includes(text), `missing Chinese Synology guide label: ${text}`)
  }

  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /<title>xDrive 桌面版<\/title>/)
})

test('desktop auth uses the shared centered MUI auth surface', () => {
  assert.ok(sharedAuthSurface.includes('export function XDriveAuthShell'), 'shared auth shell is missing')
  assert.ok(sharedAuthSurface.includes('export function XDriveAuthPanel'), 'shared auth panel is missing')
  assert.ok(sharedAuthSurface.includes("p: compact ? 3 : 'clamp(28px, 6vh, 52px) 24px 32px'"), 'shared desktop auth spacing is missing')
  assert.ok(sharedAuthSurface.includes("maxWidth ?? (compact ? 430 : 560)"), 'shared auth width contract is missing')
  assert.ok(sharedAuthSurface.includes("borderRadius: compact ? 2 : '18px'"), 'shared auth radius contract is missing')
  assert.ok(sharedAuthForm.includes('export function XDriveAuthField'), 'shared auth field chrome is missing')
  assert.ok(sharedAuthForm.includes('export function XDriveAuthPasswordField'), 'shared auth password chrome is missing')
  assert.equal((rendererApp.match(/<XDriveAuthShell\b/g) || []).length, 3, 'Desktop offline/login/password states should share one auth shell')
  assert.equal((rendererApp.match(/<XDriveAuthPanel\b/g) || []).length, 3, 'Desktop offline/login/password states should share one auth panel')
  assert.equal(styles.includes('.center-shell {'), false, 'Desktop must not retain a local auth shell implementation')
  assert.equal(/\.auth-[A-Za-z0-9_-]+/.test(styles), false, 'Desktop auth presentation must not return to local CSS')
  assert.equal(styles.includes('width: calc(100% - 24px)'), false, 'compact auth layout must not restore the oversized framed shell')
})

test('desktop custom titlebar owns the application identity and global controls', () => {
  assert.ok(renderer.includes("import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'"), 'missing shared desktop brand icon import')
  assert.equal((renderer.match(/iconSrc=\{xDriveBrandIcon\}/g) || []).length, 2, 'desktop should reuse the master icon in the titlebar and login identity')
  assert.ok(renderer.includes('XDriveBrandLockup'), 'missing shared brand lockup')
  assert.ok(renderer.includes('variant="titlebar"'), 'desktop should use the shared titlebar brand variant')
  assert.ok(renderer.includes('variant="compact"'), 'login should visually connect to the shared xDrive identity')
  assert.ok(sharedBrandLockup.includes('component="img"'), 'shared brand lockup must render the icon image')
  assert.equal(renderer.includes('desktop-titlebar-icon'), false, 'legacy desktop brand icon markup remains')
  assert.equal(renderer.includes('<span>桌面版</span>'), false, 'desktop titlebar should not repeat the platform label')
  assert.ok(renderer.includes('className="desktop-titlebar-actions"'), 'missing titlebar action slot')
  assert.match(styles, /\.desktop-titlebar-actions\s*\{[^}]*-webkit-app-region:\s*no-drag;/, 'interactive titlebar actions must opt out of window dragging')
  assert.ok(styles.includes('border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 58%, transparent);'), 'desktop titlebar divider should stay visually subdued')
})

test('desktop keeps global sync, settings and account actions in the window titlebar', () => {
  const actionStart = renderer.indexOf('const desktopTitlebarActions =')
  const shellStart = renderer.indexOf('return renderDesktopFrame(', actionStart)
  assert.notEqual(actionStart, -1, 'missing desktop titlebar action group')
  assert.notEqual(shellStart, -1, 'missing configured desktop shell')
  const titlebarActions = renderer.slice(actionStart, shellStart)

  assert.ok(titlebarActions.includes('ariaLabel="同步状态"'), 'missing titlebar sync status capsule')
  assert.ok(titlebarActions.includes('aria-label="立即同步"'), 'missing titlebar sync shortcut')
  assert.ok(titlebarActions.includes('aria-label="设置"'), 'missing titlebar settings shortcut')
  assert.ok(titlebarActions.includes('XDriveAccountAvatarButton'), 'missing shared titlebar account menu trigger')
  assert.ok(titlebarActions.includes('XDriveAccountMenu'), 'missing shared account menu container')
  assert.ok(sharedAccountChrome.includes('aria-label="账户菜单"'), 'shared account trigger must expose the account aria label')
  assert.ok(sharedAccountChrome.includes('XDriveAccountMenu'), 'shared account menu container is missing')
  assert.ok(sharedAccountChrome.includes('<XDriveAccountSummary'), 'shared account menu must own the account summary')
  assert.ok(titlebarActions.includes('XDriveAccountMenuActions'), 'Desktop must consume shared account menu actions')
  assert.ok(sharedAccountChrome.includes("aboutLabel = '关于 xDrive'"), 'shared account actions are missing About')
  assert.ok(sharedAccountChrome.includes("logoutLabel = '退出登录'"), 'shared account actions are missing logout')
  assert.equal(titlebarActions.includes('aria-label="更多同步操作"'), false, 'redundant sync overflow button should not remain')
  assert.ok(renderer.includes('打开同步文件夹'), 'missing global open-folder action')

  assert.equal(rendererApp.includes('<XDrivePageHeader'), false, 'Desktop App should not own duplicate generic page chrome')
  assert.ok((renderer.match(/<XDriveWorkspaceSurface\b/g) || []).length >= 6, 'Desktop extracted pages should use shared workspace surfaces')
  assert.ok(sharedPageHeader.includes('export function XDrivePageHeader'), 'shared page header primitive is missing')
  assert.ok(sharedPageHeader.includes('component="h1"'), 'shared page header must own the h1 title')
  assert.equal(renderer.includes('<header className="topbar">'), false, 'legacy desktop content topbar should be removed')

  assert.ok(renderer.includes('同步已暂停；此设备不会继续后台同步。'), 'missing paused-sync exception banner')
  assert.ok(renderer.includes('发现 {status.conflict_count || 0} 个同步冲突'), 'missing conflict exception banner')
  assert.ok(renderer.includes('同步异常：{status.last_error}'), 'missing sync-error exception banner')
})

test('desktop sidebar uses the shared complete sidebar renderer with Desktop-only extensions', () => {
  assert.ok(rendererApp.includes('<XDriveWorkspaceSidebar'), 'Desktop must render the shared complete sidebar')
  assert.ok(rendererApp.includes('showLocalStorage'), 'Desktop must opt into Local Storage')
  assert.ok(rendererApp.includes('sections={desktopSidebarSections}'), 'Desktop extensions should use the shared section model')
  assert.equal(rendererApp.includes('leadingItems='), false, 'Desktop must not keep the legacy leading-items extension contract')
  assert.equal(rendererApp.includes('trailingItems='), false, 'Desktop must not keep the legacy trailing-items extension contract')
  assert.ok(rendererApp.includes("key: 'overview',\n      placement: 'before-core'"), 'Desktop overview should be injected before shared core navigation')
  assert.ok(rendererApp.includes("key: 'conflicts',\n      placement: 'after-core'"), 'Desktop conflicts should be injected after shared core navigation')
  assert.ok(rendererApp.includes("ariaLabel: '桌面版辅助功能',\n      placement: 'bottom'"), 'Desktop diagnostics should use the bottom extension slot')
  assert.ok(rendererApp.includes("label: '概览'"), 'Desktop overview extension is missing')
  assert.ok(rendererApp.includes("label: '冲突'"), 'Desktop conflict extension is missing')
  assert.ok(rendererApp.includes("label: '诊断'"), 'Desktop diagnostics extension is missing')
  assert.ok(rendererApp.includes('badge: status?.conflict_count'), 'Desktop conflict badge is missing')

  for (const icon of [
    'DashboardRoundedIcon',
    'WarningAmberRoundedIcon',
    'BuildRoundedIcon',
  ]) {
    assert.ok(rendererApp.includes(icon), `missing Desktop-only sidebar icon: ${icon}`)
  }
  for (const icon of [
    'FolderRoundedIcon',
    'PhotoLibraryRoundedIcon',
    'CloudSyncRoundedIcon',
    'SwapVertRoundedIcon',
    'StorageRoundedIcon',
    'CloudRoundedIcon',
  ]) {
    assert.ok(sharedSidebarNav.includes(icon), `missing shared core sidebar icon: ${icon}`)
  }
  assert.ok(sharedSidebarNav.includes('showLocalStorage = false'), 'shared core navigation must capability-gate Local Storage')
  assert.ok(sharedWorkspaceSidebar.includes('export function XDriveWorkspaceSidebar'), 'shared complete sidebar renderer is missing')
  assert.ok(sharedWorkspaceSidebar.includes('<XDriveSidebarStorageSummary'), 'shared complete sidebar must own the footer')
  for (const token of ['<XDriveSidebarSurface', '<XDriveSidebarNavList', '<XDriveCoreWorkspaceNavItems', '<XDriveSidebarSection', '<XDriveSidebarStorageSummary']) {
    assert.equal(rendererApp.includes(token), false, `Desktop should not assemble sidebar primitive directly: ${token}`)
  }
  assert.ok(renderer.includes('<XDriveWorkspaceShell>'), 'Desktop should consume the shared sidebar/workspace shell')
  assert.ok(sharedWorkspaceShell.includes('XDRIVE_SIDEBAR_WIDTH'), 'shared workspace shell should own the standard sidebar width token')
  assert.ok(sharedWorkspaceShell.includes('XDRIVE_SIDEBAR_COMPACT_WIDTH'), 'shared workspace shell should own the compact sidebar width token')
  assert.equal(styles.includes('.shell {'), false, 'Desktop should not keep a duplicate local workspace grid')
  assert.equal(styles.includes('.sidebar {'), false, 'Desktop should not keep a duplicate local sidebar surface implementation')
})
test('desktop gates CfAPI-only storage controls by platform', () => {
  assert.ok(renderer.includes("const storagePoliciesSupported = info?.platform === 'win32'"), 'missing Windows storage capability gate')
  assert.ok(renderer.includes('当前平台不提供 Windows CfAPI'), 'missing Linux FUSE storage explanation')
  assert.ok(renderer.includes('按需访问'), 'missing local-storage on-demand access state')
  assert.ok(renderer.includes("storagePoliciesSupported ? '管理本地存储' : '查看本地存储'"), 'missing platform-aware local-storage action')
})

test('desktop external sources expose safe source deletion', () => {
  assert.ok(renderer.includes('删除同步文件夹'), 'missing source delete action')
  assert.ok(renderer.includes('已同步到 xDrive'), 'missing non-destructive delete confirmation prefix')
  assert.ok(renderer.includes('文件会保留，不会删除'), 'missing non-destructive delete confirmation result')
  assert.ok(desktopSourceAdapter.includes('agent.deleteSource(sourceID, revision)'), 'missing Desktop SourceManager delete transport mapping')
})

test('desktop settings use a dialog instead of a workspace page', () => {
  assert.ok(renderer.includes('open={settingsOpen}'), 'settings dialog state is missing')
  assert.ok(renderer.includes('title="设置"'), 'settings dialog title is missing')
  assert.ok(renderer.includes('XDriveAppearanceField'), 'settings dialog must expose appearance controls')
  assert.ok(renderer.includes('XDriveBuildInfoCard'), 'settings dialog must reuse shared build information')
  assert.equal(renderer.includes("view === 'settings'"), false, 'settings must not remain a workspace page')
})

test('desktop transient management surfaces use shared modal features', () => {
  assert.ok(rendererApp.includes('<XDriveSettingsDialog'), 'Desktop must render the shared settings dialog')
  assert.ok(rendererApp.includes('<XDriveSourceManager'), 'Desktop must render the shared Source manager')
  assert.ok(desktopFilesPage.includes('<XDriveShareDialog'), 'Desktop must render the shared share dialog')
  assert.ok(sharedSourceManager.includes('open={createOpen}'), 'shared Source create dialog is missing')
  assert.ok(sharedSourceManager.includes('open={!!setting}'), 'shared Source settings dialog is missing')
  assert.ok(desktopFilesPage.includes('trashActive={trashOpen}'), 'Desktop cloud page must route Trash into FileExplorer')
  assert.ok(desktopFilesPage.includes('<XDriveVersionHistoryDialog'), 'Desktop cloud page must render the shared version history dialog')
  assert.ok(desktopFileExplorer.includes('<XDriveFileNameDialog'), 'Desktop FileExplorer must render the shared file-name dialog')
  assert.equal(rendererApp.includes('source-create modal-form-surface'), false, 'Desktop must not retain a local Source create shell')
  assert.equal(rendererApp.includes('source-settings modal-form-surface'), false, 'Desktop must not retain a local Source settings shell')
})

test('desktop dialogs share one title, paper, content, and action treatment', () => {
  assert.ok(renderer.includes('XDriveDialogTitle') && renderer.includes('xDriveDialogPaperProps'), 'Desktop UI is not using the cross-client dialog chrome')
  assert.ok(synologyGuide.includes("from './DialogTitle'") && synologyGuide.includes('XDriveDialogTitle'), 'Synology guide is not using the cross-client dialog title')
  assert.ok(dialogTitle.includes('aria-label="关闭弹窗"'), 'shared dialog title is missing the close control')
  assert.ok(dialogTitle.includes('export const xDriveDialogPaperProps'), 'shared dialog paper contract is missing')
  assert.ok(dialogActions.includes('export function XDriveDialogActions({'), 'shared dialog actions component is missing')
  assert.ok(dialogActions.includes('export function XDriveDialogActionSpacer()'), 'shared dialog action spacer is missing')
  assert.ok(dialogContent.includes('export function XDriveDialogContent({'), 'shared dialog content component is missing')
  assert.ok(sharedSourceManager.includes('<XDriveDialogActions>'), 'shared Source dialogs must use shared actions')
  assert.ok(sharedSourceManager.includes('<XDriveDialogContent'), 'shared Source dialogs must use shared content')
  assert.ok(sharedTrashDialog.includes('<XDriveDialogContent dividers>'), 'shared Trash dialog must use shared content')
  assert.ok(sharedVersionHistoryDialog.includes('<XDriveDialogContent dividers>'), 'shared Version History dialog must use shared content')
  assert.ok(sharedFileNameDialog.includes('<XDriveDialogContent>'), 'shared File Name dialog must use shared content')
  assert.ok(sharedSettingsDialog.includes('<XDriveDialogContent dividers>'), 'shared Settings dialog must use shared content')
  assert.ok(sharedShareDialog.includes('<XDriveDialogContent dividers>'), 'shared Share dialog must use shared content')
  assert.equal(/<DialogContent(?:\s|>)/.test(rendererApp), false, 'raw MUI DialogContent remains in Desktop App')
  assert.equal(styles.includes('.desktop-dialog-title'), false, 'legacy desktop dialog title CSS remains')
  assert.equal(styles.includes('.desktop-dialog-paper'), false, 'legacy desktop dialog paper CSS remains')
  assert.equal(styles.includes('.desktop-dialog-actions'), false, 'legacy desktop dialog action CSS remains')
  assert.equal(styles.includes('.desktop-dialog-content'), false, 'legacy desktop dialog content CSS remains')
})

test('desktop transient feedback uses the shared non-layout-shifting Snackbar', () => {
  assert.ok(renderer.includes('<XDriveFeedbackSnackbar'), 'missing shared feedback Snackbar surface')
  assert.ok(renderer.includes("autoHideDuration={error ? null : 4000}"), 'success/error feedback lifetime contract is missing')
  assert.ok(renderer.includes("tone={error ? 'bad' : 'good'}"), 'shared Snackbar does not distinguish error and success feedback')
  assert.ok(renderer.includes('variant="filled"'), 'transient Snackbar alert should remain the filled special case')
  assert.ok(renderer.includes('dismissible'), 'desktop feedback should remain manually dismissible')
  assert.ok(renderer.includes("maxWidth: 520"), 'desktop feedback width contract drifted')
  assert.equal(renderer.includes('<Snackbar'), false, 'desktop must not render raw MUI Snackbar directly')
  assert.equal(renderer.includes('<MuiAlert'), false, 'desktop must not render raw MUI Alert directly')
  assert.equal(renderer.includes('className="alert error"'), false, 'legacy inline error feedback remains')
  assert.equal(renderer.includes('className="alert success"'), false, 'legacy inline success feedback remains')
  assert.equal(renderer.includes('className="alert warning"'), false, 'legacy alert panels remain')
  assert.equal(styles.includes('.alert.error'), false, 'legacy alert CSS remains')
})

test('desktop page actions use the cross-client MUI action component', () => {
  assert.ok(renderer.includes("from '@xdrive/ui/mui'"), 'desktop is not importing shared MUI primitives')
  assert.ok(renderer.includes('XDriveActionButton') && renderer.includes('XDriveStatePanel'), 'desktop shared MUI primitives are incomplete')
  assert.equal(renderer.includes('function DesktopActionButton({'), false, 'desktop still owns a local action button implementation')
  assert.ok(sharedActionButton.includes('export function XDriveActionButton({'), 'shared action button is missing')
  assert.ok(sharedActionButton.includes('<CircularProgress size={compact ? 12 : 14}'), 'shared action button does not expose a loading spinner')
  for (const label of ['重试连接', '添加同步文件夹', '回收站', '运行诊断', '检查更新', '保存设置', '退出登录']) {
    assert.ok(renderer.includes(label), `missing standardized action label: ${label}`)
  }
  assert.ok(renderer.includes('intent="primary"'), 'primary page action hierarchy is missing')
  assert.ok(renderer.includes('intent="danger"'), 'danger page action hierarchy is missing')
  assert.equal(renderer.includes('update-error'), false, 'legacy update error surface remains')
  assert.equal(renderer.includes('update-message'), false, 'legacy update message surface remains')
  assert.equal(renderer.includes('update-unavailable'), false, 'legacy update availability surface remains')
  assert.equal(renderer.includes('className="primary"'), false, 'legacy primary row button remains')
  assert.equal(renderer.includes('className="secondary"'), false, 'legacy secondary row button remains')
  assert.equal(renderer.includes('className="danger"'), false, 'legacy danger row button remains')
  assert.equal((rendererApp.match(/<MuiButton/g) || []).length, 3, 'raw MUI buttons must remain limited to inherit-color alert actions')
  assert.equal((rendererApp.match(/color="inherit"/g) || []).length, 3, 'raw MUI buttons must remain limited to inherit-color alert actions')
  assert.ok(sharedAuthForm.includes('clearSavedLabel') && renderer.includes('onClearSaved='), 'saved-password inline action must be owned by shared auth chrome')
  assert.equal(renderer.includes('className="auth-folder-button"'), false, 'sync-folder browsing should not remain in the login flow')
  assert.ok(renderer.includes('loadingLabel="正在创建…"'), 'cloud share creation lost shared loading feedback')
  assert.ok(renderer.includes("confirmDialog?.tone === 'error' ? 'danger'"), 'confirmation dialog tone is not mapped to the shared action intent')
})

test('desktop persistent sync states use the cross-client MUI status alert', () => {
  assert.ok(sharedStatusAlert.includes('export function XDriveStatusAlert({'), 'shared status alert is missing')
  assert.ok(sharedStatusAlert.includes("if (tone === 'bad') return 'error'"), 'shared alert bad tone mapping is missing')
  assert.ok(sharedStatusAlert.includes('className?: string'), 'shared status alert must support layout classes')
  assert.ok(sharedStatusAlert.includes('className={className}'), 'shared status alert does not forward layout classes')
  assert.equal((renderer.match(/<XDriveStatusAlert/g) || []).length >= 3, true, 'desktop persistent sync states are not using shared status alerts')
  assert.ok(renderer.includes('tone="bad"'), 'sync-error state is not mapped to the bad tone')
  assert.ok(renderer.includes('同步已暂停；此设备不会继续后台同步。'), 'paused status alert content is missing')
  assert.ok(renderer.includes('发现 {status.conflict_count || 0} 个同步冲突'), 'conflict status alert content is missing')
})

test('desktop page-level status alerts use the shared alert surface', () => {
  assert.equal((renderer.match(/<MuiAlert/g) || []).length, 0, 'desktop should not render raw MUI Alert after shared feedback migration')
  assert.equal(renderer.includes('<Snackbar'), false, 'desktop should not render raw MUI Snackbar after shared feedback migration')
  assert.ok(renderer.includes('variant="filled"'), 'transient Snackbar alert should remain the filled special case')
  assert.ok(renderer.includes('密码由操作系统安全凭据存储加密，不会以明文写入配置文件。'), 'login security note should remain a lightweight non-alert note')
  assert.ok(renderer.includes('自动登录未成功，已暂时关闭自动登录'), 'auto-login failures need an inline warning')
  assert.ok(renderer.includes('window.xdriveDesktop.onLoginHistory'), 'auto-login failures must be pushed to the renderer instead of silently falling back')
  assert.ok(renderer.includes('{error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}'), 'login errors need a stable inline error surface')
  for (const text of [
    '存储空间已超出配额',
    '未计入 CAS 尺寸分布',
    '当前平台不提供 Windows CfAPI',
    '当前 xdrive-agent 不支持更新设置',
    'clientUpdate.last_error ? <XDriveStatusAlert tone="bad"',
    '!clientUpdate.last_error && clientUpdate.message ? <XDriveStatusAlert tone="neutral"',
  ]) {
    assert.ok(renderer.includes(text), `missing shared status alert coverage: ${text}`)
  }
})

test('desktop global sync and diagnostic statuses use the cross-client MUI badge', () => {
  assert.ok(sharedStatusBadge.includes("export type XDriveStatusTone = 'neutral' | 'good' | 'warning' | 'bad' | 'busy'"), 'shared status tone contract is missing')
  assert.ok(sharedStatusBadge.includes('aria-label={ariaLabel}'), 'shared status badge is missing accessible labels')
  assert.ok(sharedStatusBadge.includes('onClick={onClick}'), 'shared status badge is missing interactive status support')
  assert.ok(renderer.includes('tone={globalSyncState.tone}'), 'global sync status does not use the shared status badge')
  assert.ok(renderer.includes('ariaLabel="同步状态"'), 'global sync status lost its accessible label')
  assert.ok(renderer.includes("PASS: { label: '正常', tone: 'good' as const }"), 'diagnostic PASS status must map to the shared good tone')
  assert.ok(renderer.includes("INFO: { label: '提示', tone: 'neutral' as const }"), 'diagnostic INFO status must map to the shared neutral tone')
  assert.ok(renderer.includes("WARN: { label: '需注意', tone: 'warning' as const }"), 'diagnostic WARN status must map to the shared warning tone')
  assert.ok(renderer.includes("FAIL: { label: '异常', tone: 'bad' as const }"), 'diagnostic FAIL status must map to the shared bad tone')
  assert.equal(renderer.includes('diagnostic-badge'), false, 'legacy diagnostic badge remains')
  assert.equal(styles.includes('.diagnostic-badge'), false, 'legacy diagnostic badge CSS remains')
})

test('desktop cloud shares use the cross-client MUI share status badge', () => {
  assert.ok(sharedShareStatusBadge.includes('export function XDriveShareStatusBadge({ status }'), 'shared share status badge is missing')
  for (const label of ['有效', '已过期', '已达上限', '已撤销']) {
    assert.ok(sharedShareStatusBadge.includes(label), `shared share status badge is missing label: ${label}`)
  }
  assert.ok(renderer.includes('<XDriveShareList'), 'desktop cloud shares do not use the shared list')
  assert.ok(sharedShareList.includes('<XDriveShareStatusBadge status={share.status} />'), 'shared share list is missing the shared status badge')
  assert.equal(renderer.includes('function shareStatusLabel('), false, 'desktop still owns a share status label mapper')
})

test('shared SourceManager owns run history, progress, pagination and cancellation', () => {
  assert.ok(sharedSourceRunSummary.includes('export function XDriveSourceRunSummary({'), 'shared source run summary component is missing')
  assert.ok(sharedSourceRunProgress.includes('export function XDriveSourceRunProgress({'), 'shared source run progress component is missing')
  assert.ok(sharedSourceRunProgress.includes('<LinearProgress'), 'shared source run progress is missing the progress bar')
  assert.ok(sharedSourceManager.includes('<XDriveSourceRunSummary'), 'SourceManager must render the shared run summary')
  assert.ok(sharedSourceManager.includes('detail={runDetail}'), 'SourceManager must bind run summaries to the shared detail view')
  assert.ok(sharedSourceManager.includes('<XDriveSourceRunProgress'), 'SourceManager must render shared run progress')
  assert.ok(sharedSourceManager.includes('progress={runDetail.progress}'), 'SourceManager must bind live run progress')
  assert.equal((sharedSourceManager.match(/<XDrivePaginationControls\b/g) || []).length, 3, 'Source history/failure/collection pagination must stay shared')
  assert.ok(sharedSourceManager.includes('SOURCE_HISTORY_PAGE_SIZE = 20'), 'Source history page-size contract is missing')
  assert.ok(sharedSourceManager.includes('SOURCE_RUN_FAILURE_PAGE_SIZE = 20'), 'Source failure page-size contract is missing')
  assert.ok(sharedSourceManager.includes('SOURCE_COLLECTION_ITEM_PAGE_SIZE = 50'), 'Source collection page-size contract is missing')
  assert.ok(sharedSourceManager.includes('await loadRunHistory(selected.source.id, 1, true)'), 'active Source history should refresh silently')
  assert.ok(sharedSourceManager.includes('await adapter.cancelSourceRun(row.source.id, run.id)'), 'run cancellation must go through the adapter')
})

test('shared SourceManager owns create, settings and connector forms', () => {
  assert.ok(sharedSourceManager.includes('open={createOpen}'), 'shared Source create dialog is missing')
  assert.ok(sharedSourceManager.includes('open={!!setting}'), 'shared Source settings dialog is missing')
  assert.ok(sharedSourceManager.includes('values={createValues}'), 'SourceManager must pass create form state into the create dialog')
  assert.ok(sharedSourceManager.includes('value={values.preset}'), 'shared Source create preset is not bound inside the create dialog')
  assert.equal((sharedSourceManager.match(/<XDriveSourceNameField\b/g) || []).length, 2, 'Source create/settings name fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSourceRunModeField\b/g) || []).length, 2, 'Source create/settings run-mode fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSourceStatusField\b/g) || []).length, 1, 'Source settings status field must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSourceScheduleFields\b/g) || []).length, 2, 'Source create/settings schedule fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSourceIgnoreRulesField\b/g) || []).length, 2, 'Source create/settings ignore-rules fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSourceCookieField\b/g) || []).length, 2, 'Source create/settings Cookie fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSynologyDsmCredentialFields\b/g) || []).length, 2, 'Source create/settings DSM fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSynologyPhotoSpacesField\b/g) || []).length, 2, 'Synology Photos space fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSynologyFileRootsField\b/g) || []).length, 2, 'File Station roots fields must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSourceTargetField\b/g) || []).length, 1, 'Source settings target field must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveStoredCredentialField\b/g) || []).length, 2, 'stored credential reveal fields must stay shared')
  assert.ok(sharedSourceManager.includes('loadingLabel="正在测试…"'), 'credential test action lost shared loading feedback')
  assert.ok(sharedSourceManager.includes('loadingLabel="正在保存…"'), 'Source settings save action lost shared loading feedback')
  assert.ok(sharedSourceManager.includes('loadingLabel="正在删除…"'), 'Source delete action lost shared loading feedback')
})

test('shared SourceManager owns source cards, states, collections and failure recovery', () => {
  assert.ok(sharedSourceSummaryCard.includes('<XDriveStatusBadge tone={statusTone} label={statusLabel} />'), 'shared source summary card must own status rendering')
  assert.ok(sharedSourceManager.includes('<XDriveSourceSummaryCard'), 'SourceManager must render shared source cards')
  assert.ok(sharedSourceManager.includes('statusTone={card.state.tone}'), 'Source state tone must be passed to the shared card')
  assert.ok(sharedSourceManager.includes('statusLabel={card.state.label}'), 'Source state label must be passed to the shared card')
  assert.ok(sharedSourceManager.includes('message="尚未添加同步文件夹"'), 'Source empty state must use the shared state panel')
  assert.ok(sharedSourceManager.includes('title="相册与集合"'), 'Source collections section is missing')
  assert.ok(sharedSourceManager.includes('该同步文件夹暂无相册/集合元数据'), 'Source collection empty state is missing')
  assert.ok(sharedSourceManager.includes('<XDriveSourceCollectionSummary'), 'Source collection summary must stay shared')
  assert.ok(sharedSourceManager.includes('<XDriveSourceCollectionItem'), 'Source collection item must stay shared')
  assert.ok(sharedSourceManager.includes('labelPrefix="成员"'), 'Source collection member pagination must stay shared')
  assert.equal((sharedSourceManager.match(/<XDriveSourceFailureItem\b/g) || []).length, 2, 'current and historical Source failures must use the shared item')
  assert.ok(sharedSourceManager.includes('查看失败项'), 'current failed-item action is missing')
  assert.ok(sharedSourceManager.includes('下一次扫描会自动重试'), 'current failure retry guidance is missing')
  assert.ok(sharedSourceManager.includes('本次失败文件'), 'historical failed-item section is missing')
  assert.ok(sharedSourceManager.includes('没有可恢复的逐文件失败快照'), 'legacy failure-history fallback is missing')
})

test('Desktop Source adapter is the only IPC boundary for the shared manager', () => {
  for (const token of [
    'getSources()',
    'getSourceRuns(',
    'getSourceRunFailures(',
    'cancelSourceRun(',
    'getSourceItems(',
    'getSourceCollections(',
    'getSourceCollectionItems(',
    'getSourceCredential(',
    'revealSourceCredential(',
    'testSourceCredential(',
    'testStoredSourceCredential(',
    'setSourceCredential(',
    'deleteSourceCredential(',
    'getSourceConnectorConfig(',
    'browseSourceDirectories(',
    'setSourceConnectorConfig(',
    'createSource(',
    'updateSource(',
    'deleteSource(',
    'triggerSource(',
  ]) {
    assert.ok(desktopSourceAdapter.includes(token), `Desktop Source adapter missing IPC operation: ${token}`)
  }
  assert.ok(rendererApp.includes('createDesktopSourceManagerAdapter'), 'Desktop App must inject the Source IPC adapter')
  assert.ok(rendererApp.includes('targetBrowser={desktopSourceTargetBrowser}'), 'Desktop target-folder browsing must be injected into the shared manager')
  assert.ok(desktopSourceAdapter.includes('cloudRoot()'), 'Desktop Source target browser must load the cloud root')
  assert.ok(desktopSourceAdapter.includes('cloudChildren(parentID)'), 'Desktop Source target browser must browse child folders')
})

test('shared SourceManager preserves Yike and Synology connector safety UX', () => {
  assert.ok(sharedSourceManager.includes('testSourceCredential'), 'candidate credential test is missing')
  assert.ok(sharedSourceManager.includes('testStoredSourceCredential'), 'stored credential test is missing')
  assert.ok(sharedSourceManager.includes('XDriveYikeCookieHelp'), 'shared Yike Cookie guide is missing')
  assert.ok(sharedSourceManager.includes('yikeConnectorNotice'), 'Yike private-API notice is missing')
  assert.ok(sharedSourceManager.includes('yikeRateLimitNotice'), 'Yike rate-limit notice is missing')
  assert.ok(sharedSourceManager.includes('yikeManagedTargetLabel'), 'Yike managed target label is missing')
  assert.ok(sharedSourceManager.includes('固定逻辑目录'), 'Yike managed target explanation is missing')
  assert.ok(sharedSourceManager.includes('已自动撤销'), 'Source create rollback feedback is missing')
  assert.ok(sharedSourceManager.includes('自动回滚也失败'), 'Source rollback failure fallback is missing')
  assert.ok(sharedSourceManager.includes('label="已保存 Cookie"'), 'stored Yike Cookie field is missing')
  assert.ok(sharedSourceManager.includes('label="替换 Cookie"'), 'Yike replacement Cookie field is missing')
  assert.ok(sharedSourceManager.includes('已显示的 Cookie 不会自动带入此输入框'), 'revealed Cookie must stay separated from the replacement field')
  assert.ok(sharedSourceManager.includes("manualTriggerExecutor === 'source_agent'"), 'DSM guide must remain limited to source-agent connectors')
  assert.ok(sharedSourceManager.includes("createProfile.credential === 'synology_dsm'"), 'Synology credential UI must remain profile-driven')
  assert.ok(sharedSourceManager.includes('externalSourceCredentialLabel'), 'credential actions must stay connector-neutral')
})

test('shared SourceManager persists schedule and ignore-rule semantics', () => {
  for (const text of ['调度方式', '固定间隔', 'Cron', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区']) {
    assert.ok(sharedSourceScheduleFields.includes(text), `missing shared Source schedule UI label: ${text}`)
  }
  assert.equal((sharedSourceManager.match(/<XDriveSourceScheduleFields\b/g) || []).length, 2, 'create/settings should share Source schedule fields')
  assert.ok((sharedSourceManager.match(/schedule_type: values\.schedule_type/g) || []).length >= 2, 'create/update schedule payloads are missing')
  assert.ok(sharedSourceIgnoreRulesField.includes('spellCheck: false'), 'shared ignore-rules field should disable spellcheck')
  assert.equal((sharedSourceManager.match(/<XDriveSourceIgnoreRulesField\b/g) || []).length, 2, 'create/settings should share ignore-rules fields')
  assert.ok(main.includes('schedule_expression'), 'Electron main does not forward Source schedule fields')
  assert.ok(main.includes("value.schedule_type !== 'manual'"), 'Electron main does not accept manual-only Source schedules')
})

test('desktop uses app-native confirmation dialogs instead of browser confirms', () => {
  assert.equal(rendererApp.includes('window.confirm'), false, 'browser-native confirmation dialog remains in the desktop renderer')
  assert.ok(rendererApp.includes('type ConfirmDialogState ='), 'missing reusable confirmation dialog state')
  assert.ok(rendererApp.includes('XDriveConfirmDialog'), 'missing shared confirmation dialog')
  assert.ok(sharedConfirmDialog.includes('aria-label="确认操作"'), 'shared confirmation dialog must expose the confirmation aria label')
  assert.ok(sharedConfirmDialog.includes('closeDisabled={loading}'), 'shared confirmation dialog must prevent closing while loading')
  for (const label of ['安装并重启', '永久删除', '恢复版本', '保留服务器版本', '保留本地版本', '退出登录']) {
    assert.ok(renderer.includes(label), `missing confirmation action label: ${label}`)
  }
  assert.ok(sharedSourceManager.includes('清除凭据'), 'Source credential clearing must use a confirmation action')
})

test('shared cloud storage hides server disk wording for limited quotas', () => {
  assert.ok(sharedCloudStoragePage.includes('可用空间'), 'missing cloud available-space label')
  assert.ok(
    sharedCloudStoragePage.includes("quota.quota_bytes > 0 ? '用户配额可用' : '服务器可用空间'"),
    'missing quota-aware cloud capacity wording',
  )
})

test('desktop external sources expose per-file failures through the shared item surface', () => {
  assert.ok(renderer.includes('getSourceItems'), 'missing Source item query')
  assert.ok(renderer.includes('查看失败项'), 'missing per-file failure action')
  assert.ok(renderer.includes('下一次扫描会自动重试'), 'missing retry guidance')
  assert.ok(renderer.includes('getSourceRunFailures'), 'missing historical Source failure query')
  assert.ok(renderer.includes('本次失败文件'), 'missing historical per-run failure section')
  assert.ok(renderer.includes('没有可恢复的逐文件失败快照'), 'missing legacy history fallback')
  assert.ok(sharedSourceFailureItem.includes('export function XDriveSourceFailureItem({'), 'shared Source failure item component is missing')
  assert.ok(sharedSourceFailureItem.includes('formatExternalSourceTime(failedAt)'), 'shared Source failure item lost failure-time formatting')
  assert.ok(sharedSourceFailureItem.includes("p: compact ? 1 : 1.5"), 'shared Source failure item lost density variants')
  assert.ok(sharedSourceFailureItem.includes("error || '未提供具体错误原因'"), 'shared Source failure item lost error fallback')
  assert.equal((renderer.match(/<XDriveSourceFailureItem/g) || []).length, 2, 'desktop failure cards are not all using the shared item')
  assert.equal(renderer.includes('<MuiBox key={failure.id}'), false, 'desktop historical failure card remains locally implemented')
  assert.equal(renderer.includes('<MuiBox key={item.source_item_id}'), false, 'desktop current failure card remains locally implemented')
})

test('desktop GUI does not regress to key English labels', () => {
  for (const text of [
    'AGENT CONNECTION',
    '>Overview</button>',
    '>Cloud files</button>',
    'TRANSFER CENTER',
    'STORAGE POLICIES',
    'CONFLICT COPIES',
    'CLIENT SETTINGS',
    'Share —',
    'Expires after',
    'Maximum downloads',
    'Password (optional)',
  ]) {
    assert.equal(renderer.includes(text), false, `English desktop GUI label returned: ${text}`)
  }

  for (const text of [
    'Open xDrive Desktop',
    'Open xDrive Folder',
    'Sync Now',
    'Resume Sync',
    'Pause Sync',
    'Quit xDrive Desktop',
    'Choose xDrive sync folder',
  ]) {
    assert.equal(main.includes(text), false, `English desktop system label returned: ${text}`)
  }
})


test('desktop login keeps self-hosted server configuration visible while simplifying the auth flow', () => {
  assert.ok(rendererApp.includes('<XDriveAuthPanel\n          form\n          onSubmit={login}'), 'login must use the shared MUI form surface directly')
  assert.ok(renderer.includes('id="desktop-login-server"'), 'server address must stay directly editable for self-hosted deployments')
  assert.ok(renderer.includes('支持自建 xDrive 服务器；连接会在登录时再次验证。'), 'self-hosted server purpose should be explicit')
  assert.ok(renderer.includes('window.xdriveDesktop.probeServer(candidate)'), 'server field should expose reachability feedback before login')
  assert.ok(main.includes("ipcMain.handle('desktop:probe-server'"), 'main process server probe is missing')
  assert.ok(main.includes("normalized + '/api/v1/version'"), 'server probe should use the public version endpoint')
  assert.equal(renderer.includes('label="同步文件夹（可选）"'), false, 'sync-folder configuration should not remain in the login form')
  assert.equal(renderer.includes('className="auth-folder-row"'), false, 'login folder browse row should be removed')
  assert.equal(/className="auth-[A-Za-z0-9_-]+/.test(rendererApp), false, 'Desktop App must not retain stale auth styling hooks')
  assert.ok(renderer.includes('登录后可在“设置”中修改'), 'login must explain where sync-folder configuration moved')
})

test('desktop login makes password and automatic-login state explicit', () => {
  assert.ok(renderer.includes("placeholder={savedPasswordAvailable ? '••••••••••••' : '输入密码'}"), 'saved password must not look like an empty field')
  assert.ok(renderer.includes('saved={hasStoredPassword}'), 'Desktop must pass saved-password state into shared auth chrome')
  assert.ok(sharedAuthForm.includes('label={savedLabel}'), 'shared auth chrome must render the saved-password chip')
  assert.ok(sharedAuthForm.includes('VisibilityRoundedIcon') && sharedAuthForm.includes('VisibilityOffRoundedIcon'), 'shared password visibility control is missing')
  assert.ok(sharedAuthForm.includes("clearSavedLabel = '清除已保存密码'"), 'saved password must be removable from the login page')
  assert.ok(main.includes("ipcMain.handle('desktop:clear-saved-password'"), 'saved-password clearing IPC is missing')
  assert.ok(renderer.includes('if (!checked) setAutoLogin(false)'), 'disabling password storage must also disable auto-login')
  assert.ok(renderer.includes('if (checked) setRememberPassword(true)'), 'enabling auto-login must enable secure password storage')
  assert.ok(renderer.includes('disabled={!loginReady || !!busy}'), 'login button must expose a clear disabled state')
  assert.ok(renderer.includes('loadingLabel="正在登录…"'), 'login button must expose an in-progress state')
})

test('desktop login explains recovery state and keeps errors from shifting the layout', () => {
  assert.ok(renderer.includes("status?.auth_status === '需要重新登录'"), 'expired sessions must be distinguished from a fresh login')
  assert.ok(renderer.includes('登录状态已失效'), 'expired-session heading is missing')
  assert.ok(renderer.includes('原有同步设置会继续保留'), 'expired-session recovery should explain preserved settings')
  assert.ok(renderer.includes('密码由操作系统安全凭据存储加密，不会以明文写入配置文件。'), 'credential-storage explanation needs a lightweight note')
  assert.ok(renderer.includes('不会以明文写入配置文件'), 'secure-storage copy should be concise and user-facing')
  assert.ok(renderer.includes('title={info?.commit || undefined}') && renderer.includes('{buildLabel}'), 'desktop version/build information should remain visible on login')
  assert.ok(renderer.includes('按 Enter 登录'), 'keyboard login hint is missing')
  assert.equal(renderer.includes('凭据会直接传递给 Go Agent'), false, 'implementation-detail security copy should not remain on the login page')
  assert.equal(renderer.includes('<p className="eyebrow">登录</p>'), false, 'duplicate login eyebrow should be removed')
})

test('desktop login exposes compact pre-login diagnostics beside build information', () => {
  assert.ok(renderer.includes('justifyContent="center"') && renderer.includes('{buildLabel}'), 'login build metadata and diagnostics entry need one compact MUI footer')
  assert.ok(renderer.includes("title={loginDiagnosticsOpen ? '收起登录诊断' : '展开登录诊断'}"), 'pre-login diagnostics toggle is missing')
  assert.ok(renderer.includes('aria-label="登录诊断"'), 'pre-login diagnostics summary needs an accessible label')
  for (const label of ['Agent', '服务器', '安全凭据存储', '当前账号密码', '打开日志']) {
    assert.ok(renderer.includes(label), `missing pre-login diagnostic item: ${label}`)
  }
  assert.ok(renderer.includes("run('login-open-logs', () => window.xdriveDesktop.agent.openLogs())"), 'pre-login diagnostics should provide direct log access')
  assert.ok(renderer.includes("color={tone === 'good' ? 'success.main' : tone === 'bad' ? 'error.main' : 'text.secondary'}"), 'diagnostic status colors should come from the MUI theme')
  assert.equal(/\.auth-[A-Za-z0-9_-]+/.test(styles), false, 'pre-login diagnostics must not depend on local auth CSS')
})

test('desktop auth forms use shared MUI controls without legacy CSS overriding MUI internals', () => {
  assert.ok(renderer.includes('<XDriveAuthField'), 'Desktop auth fields must use the shared external-label layout')
  assert.ok(renderer.includes('<XDriveAuthPasswordField'), 'Desktop password field must use shared auth chrome')
  assert.ok(renderer.includes('<XDriveAuthSubmitRow hint="按 Enter 登录">'), 'Desktop auth submit layout must be shared')
  assert.ok(renderer.includes("'& .MuiFormControlLabel-root': { m: 0 }"), 'remember/auto-login controls need one aligned MUI option row')
  assert.ok(sharedAuthForm.includes('component="label"') && sharedAuthForm.includes('htmlFor={htmlFor}'), 'shared auth field must own the external label')
  assert.ok(sharedAuthForm.includes("'& .MuiOutlinedInput-root'"), 'shared auth field must own input radius/background treatment')
  assert.ok(sharedAuthForm.includes("borderColor: 'primary.main'"), 'shared auth field must own focus treatment')
  assert.equal(renderer.includes('<label>当前密码<input'), false, 'password-change form must not keep native label/input markup')
  assert.equal(/\.auth-[A-Za-z0-9_-]+/.test(styles), false, 'legacy auth CSS must not override shared MUI controls')
})


test('desktop overview uses the shared description grid', () => {
  assert.ok(sharedDescriptionGrid.includes('XDriveDescriptionGrid'), 'shared description grid primitive is missing')
  assert.ok(sharedDescriptionGrid.includes('XDriveDescriptionItem'), 'shared description item primitive is missing')
  assert.ok(renderer.includes('<XDriveDescriptionGrid columns={4}'), 'desktop overview should use the shared four-column description grid')
  assert.equal(renderer.includes('<dl>'), false, 'legacy desktop overview definition list should be removed')
  assert.equal(styles.includes('dl { margin:'), false, 'legacy desktop description-grid CSS should be removed')
})


test('desktop sections use the shared section header', () => {
  assert.ok(sharedSectionHeader.includes('XDriveSectionHeader'), 'shared section header primitive is missing')
  assert.ok(sharedSectionHeader.includes("level === 'h3'"), 'shared section header needs h2/h3 semantics')
  assert.ok(sharedSectionHeader.includes('actions'), 'shared section header needs an action slot')
  assert.ok((renderer.match(/<XDriveSectionHeader/g) || []).length >= 9, 'desktop should reuse the shared section header across repeated sections')
  assert.equal(renderer.includes('className="section-heading"'), false, 'legacy desktop section-heading wrapper should be removed')
  assert.equal(styles.includes('.section-heading {'), false, 'legacy desktop section-heading CSS should be removed')
  assert.equal(styles.includes('.source-heading-actions {'), false, 'legacy source header action CSS should be removed')
  assert.equal(styles.includes('.source-note {'), false, 'legacy source header note CSS should be removed')
  assert.equal(styles.includes('.storage-note {'), false, 'legacy storage header note CSS should be removed')
  assert.equal(styles.includes('.diagnostic-note {'), false, 'legacy diagnostics header note CSS should be removed')
})
