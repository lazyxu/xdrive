const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')
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
const sharedWorkspaceShell = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'WorkspaceShell.tsx'), 'utf8')
const sharedAccountChrome = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'AccountChrome.tsx'), 'utf8')
const sharedBrandLockup = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'BrandLockup.tsx'), 'utf8')
const sharedDescriptionGrid = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'DescriptionGrid.tsx'), 'utf8')
const sharedSectionHeader = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SectionHeader.tsx'), 'utf8')
const sharedPageHeader = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'PageHeader.tsx'), 'utf8')
const sharedConfirmDialog = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ConfirmDialog.tsx'), 'utf8')
const sharedShareStatusBadge = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'ShareStatusBadge.tsx'), 'utf8')
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
const sharedSourceIgnoreRulesField = fs.readFileSync(path.join(root, '..', 'ui', 'shared', 'src', 'mui', 'SourceIgnoreRulesField.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')

test('desktop renderer default export is the full App root, not a helper component', () => {
  assert.match(renderer, /export default function App\(\)/)
  assert.equal(renderer.includes('export default function YikeCookieHelpGuide()'), false)
})

test('desktop GUI defaults to Chinese', () => {
  for (const text of [
    '概览',
    '云端文件',
    '外部来源',
    '立即扫描',
    '来源设置',
    '保存设置',
    '添加外部来源',
    '目标文件夹',
    '添加来源',
    '传输中心',
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

test('desktop auth removes the oversized outer frame and uses one focused login surface', () => {
  assert.ok(renderer.includes('className="auth-panel auth-panel-form"'), 'login/password forms must use the dedicated auth surface')
  assert.match(styles, /\.center-shell\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*display:\s*flex;/s, 'auth shell should use the whole desktop body')
  assert.doesNotMatch(styles, /\.center-shell\s*\{[^}]*border:/s, 'the oversized outer auth border must not return')
  assert.equal(styles.includes('width: calc(100% - 24px)'), false, 'compact auth layout must not restore the oversized framed shell')
  assert.equal(styles.includes('.auth-folder-row'), false, 'obsolete login sync-folder layout styles must be removed')
  assert.match(styles, /\.auth-panel\s*\{[^}]*width:\s*min\(560px,100%\);[^}]*margin:\s*auto;[^}]*border-radius:\s*18px;/s, 'login surface should have a restrained centered width')
  assert.ok(styles.includes('.auth-panel-form .auth-form { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }'), 'nested auth form surface must remain transparent')
  assert.ok(styles.includes('.center-shell { padding: 20px 14px 24px; }'), 'compact auth spacing is missing')
})

test('desktop custom titlebar owns the application identity and global controls', () => {
  assert.ok(renderer.includes("import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'"), 'missing shared desktop brand icon import')
  assert.equal((renderer.match(/iconSrc=\{xDriveBrandIcon\}/g) || []).length, 2, 'desktop should reuse the master icon in the titlebar and login identity')
  assert.ok(renderer.includes('XDriveBrandLockup'), 'missing shared brand lockup')
  assert.ok(renderer.includes('variant="titlebar"'), 'desktop should use the shared titlebar brand variant')
  assert.ok(renderer.includes('variant="compact"') && renderer.includes('className="auth-brand-lockup"'), 'login should visually connect to the shared xDrive identity')
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
  assert.ok(titlebarActions.includes('关于 xDrive'), 'account menu is missing About')
  assert.ok(titlebarActions.includes('退出登录'), 'account menu is missing logout')
  assert.equal(titlebarActions.includes('aria-label="更多同步操作"'), false, 'redundant sync overflow button should not remain')
  assert.ok(renderer.includes('打开同步文件夹'), 'missing global open-folder action')

  assert.ok(renderer.includes('<XDrivePageHeader title={viewLabel(view)} eyebrow="xDrive" size="large" />'), 'desktop content should use the shared page header')
  assert.ok(sharedPageHeader.includes('export function XDrivePageHeader'), 'shared page header primitive is missing')
  assert.ok(sharedPageHeader.includes('component="h1"'), 'shared page header must own the h1 title')
  assert.ok(sharedPageHeader.includes("size === 'large'"), 'shared page header large variant is missing')
  assert.equal(renderer.includes('<header className="topbar">'), false, 'legacy desktop content topbar should be removed')

  assert.ok(renderer.includes('同步已暂停；此设备不会继续后台同步。'), 'missing paused-sync exception banner')
  assert.ok(renderer.includes('发现 {status.conflict_count || 0} 个同步冲突'), 'missing conflict exception banner')
  assert.ok(renderer.includes('同步异常：{status.last_error}'), 'missing sync-error exception banner')
})

test('desktop sidebar consumes shared MUI navigation with icons, state and badges', () => {
  const start = renderer.indexOf('<XDriveSidebarSurface ariaLabel="桌面版侧边栏" className="sidebar">')
  const end = renderer.indexOf('</XDriveSidebarSurface>', start)
  assert.notEqual(start, -1, 'missing shared desktop sidebar surface')
  assert.notEqual(end, -1, 'missing shared desktop sidebar surface end')
  const sidebar = renderer.slice(start, end)

  assert.equal(sidebar.includes("view === 'settings'"), false, 'settings should live in the titlebar, not the feature sidebar')
  assert.equal(sidebar.includes('className="account"'), false, 'legacy sidebar account summary should be removed')
  assert.equal((sidebar.match(/<XDriveSidebarNavItem/g) || []).length, 8, 'all primary and diagnostic destinations must use shared sidebar items')
  for (const icon of [
    'DashboardRoundedIcon',
    'FolderRoundedIcon',
    'PhotoLibraryRoundedIcon',
    'CloudSyncRoundedIcon',
    'SwapVertRoundedIcon',
    'StorageRoundedIcon',
    'WarningAmberRoundedIcon',
    'BuildRoundedIcon',
  ]) {
    assert.ok(sidebar.includes(icon), `missing sidebar icon: ${icon}`)
  }
  assert.equal((sidebar.match(/badge=/g) || []).length, 2, 'transfer/conflict counts must use the shared badge treatment')
  assert.ok(sidebar.includes('<XDriveSidebarSection pinnedBottom>'), 'diagnostics should stay in the shared pinned sidebar section')
  assert.equal(sidebar.includes('appearance="dark"'), false, 'Desktop sidebar should inherit the application theme instead of forcing dark mode')
  assert.ok(renderer.includes('<XDriveWorkspaceShell>'), 'Desktop should consume the shared sidebar/workspace shell')
  assert.ok(sharedWorkspaceShell.includes('XDRIVE_SIDEBAR_WIDTH'), 'shared workspace shell should own the standard sidebar width token')
  assert.ok(sharedWorkspaceShell.includes('XDRIVE_SIDEBAR_COMPACT_WIDTH'), 'shared workspace shell should own the compact sidebar width token')
  assert.equal(styles.includes('.shell {'), false, 'Desktop should not keep a duplicate local workspace grid')
  assert.equal(styles.includes('--xdrive-sidebar-width'), false, 'Desktop CSS should not duplicate the shared sidebar width')
  assert.equal(styles.includes('--xdrive-sidebar-compact-width'), false, 'Desktop CSS should not duplicate the shared compact sidebar width')
  assert.ok(sharedSidebarNav.includes('export function XDriveSidebarSurface'), 'shared sidebar surface primitive is missing')
  assert.ok(sharedSidebarNav.includes('component="aside"'), 'shared sidebar surface must own the aside landmark')
  assert.ok(sharedSidebarNav.includes("responsive ? { xs: 'block', md: 'flex' } : 'flex'"), 'shared responsive sidebar surface behavior is missing')
  assert.ok(sharedSidebarNav.includes("appearance = 'light'"), 'shared sidebar appearance contract is missing')
  assert.ok(sharedSidebarNav.includes("appearance === 'dark'"), 'shared dark sidebar appearance is missing')
  assert.ok(sharedSidebarNav.includes('export function XDriveSidebarSection'), 'shared sidebar section primitive is missing')
  assert.ok(sharedSidebarNav.includes("pinnedBottom ? 'auto'"), 'shared pinned-bottom sidebar section behavior is missing')
  assert.ok(sidebar.includes('primary="文件"'), 'desktop file navigation should match the Web label')
  assert.equal(sidebar.includes('primary="云端文件"'), false, 'desktop sidebar should not use the legacy cloud-files label')
  assert.equal(styles.includes('.sidebar {'), false, 'Desktop should not keep a duplicate local sidebar surface implementation')
})

test('desktop gates CfAPI-only storage controls by platform', () => {
  assert.ok(renderer.includes("const storagePoliciesSupported = info?.platform === 'win32'"), 'missing Windows storage capability gate')
  assert.ok(renderer.includes('Linux FUSE 模式不提供 Windows CfAPI'), 'missing Linux FUSE storage explanation')
  assert.ok(renderer.includes('FUSE 按需访问'), 'missing Linux read-only storage state')
  assert.ok(renderer.includes("storagePoliciesSupported ? '管理存储' : '查看存储'"), 'missing platform-aware storage action')
})

test('desktop external sources expose safe source deletion', () => {
  assert.ok(renderer.includes('删除来源'), 'missing source delete action')
  assert.ok(renderer.includes('已同步到 xDrive'), 'missing non-destructive delete confirmation prefix')
  assert.ok(renderer.includes('文件会保留，不会删除'), 'missing non-destructive delete confirmation result')
  assert.ok(renderer.includes('window.xdriveDesktop.agent.deleteSource'), 'missing renderer delete bridge call')
})

test('desktop transient management surfaces use modal dialogs', () => {
  for (const openProp of [
    'open={sourceCreateOpen}',
    'open={editingSourceID === row.source.id}',
    'open={cloudTrashOpen}',
    'open={!!cloudHistoryNode}',
    'open={!!cloudShareNode}',
  ]) {
    assert.ok(renderer.includes(openProp), `missing modal dialog state: ${openProp}`)
  }

  for (const label of ['添加外部来源', '来源设置', '回收站', '版本历史', '分享文件']) {
    assert.ok(renderer.includes(`aria-label="${label}"`), `missing modal dialog label: ${label}`)
  }

  assert.ok(renderer.includes('source-create modal-form-surface'), 'source creation must use the modal form surface')
  assert.ok(renderer.includes('source-settings modal-form-surface'), 'source settings must use the modal form surface')
  assert.equal(renderer.includes('cloud-subpanel modal-subpanel'), false, 'legacy cloud modal panel wrapper remains')
})

test('desktop dialogs share one title, paper, content, and action treatment', () => {
  assert.ok(renderer.includes('XDriveDialogTitle') && renderer.includes('xDriveDialogPaperProps'), 'App is not using the cross-client dialog chrome')
  assert.ok(synologyGuide.includes("from './DialogTitle'") && synologyGuide.includes('XDriveDialogTitle'), 'Synology guide is not using the cross-client dialog title')
  assert.ok(synologyGuide.includes('<XDriveDialogTitle'), 'Synology guide is not rendering the cross-client dialog title')
  assert.ok(dialogTitle.includes('aria-label="关闭弹窗"'), 'shared dialog title is missing the close control')
  assert.ok(dialogTitle.includes('export const xDriveDialogPaperProps'), 'shared dialog paper contract is missing')
  assert.ok(dialogTitle.includes("maxHeight: { xs: '92vh', sm: '84vh' }"), 'shared dialog viewport bounds are missing')
  assert.equal(styles.includes('.desktop-dialog-title'), false, 'legacy desktop dialog title CSS remains')
  assert.equal(styles.includes('.desktop-dialog-paper'), false, 'legacy desktop dialog paper CSS remains')
  assert.ok(dialogActions.includes('export function XDriveDialogActions({'), 'shared dialog actions component is missing')
  assert.ok(dialogActions.includes("bgcolor: 'action.hover'"), 'shared dialog actions surface styling is missing')
  assert.ok(dialogActions.includes("flexWrap: { xs: 'wrap', sm: 'nowrap' }"), 'shared dialog actions responsive wrapping is missing')
  assert.ok(dialogActions.includes('export function XDriveDialogActionSpacer()'), 'shared dialog action spacer is missing')
  assert.equal((renderer.match(/<XDriveDialogActions>/g) || []).length, 7, 'desktop app-local dialogs are not all using the shared action bar')
  assert.ok(sharedConfirmDialog.includes('<XDriveDialogActions>'), 'shared confirmation dialog must use the shared action bar')
  assert.ok(renderer.includes('<XDriveDialogActionSpacer />'), 'desktop destructive/settings dialog lost its shared action spacer')
  assert.equal(styles.includes('.desktop-dialog-actions'), false, 'legacy desktop dialog action CSS remains')
  assert.equal(styles.includes('.desktop-dialog-action-spacer'), false, 'legacy desktop dialog action spacer CSS remains')
  assert.ok(dialogContent.includes('export function XDriveDialogContent({'), 'shared dialog content component is missing')
  assert.ok(dialogContent.includes("px: flush ? 0 : { xs: 2, sm: 2.5 }"), 'shared dialog content horizontal spacing is missing')
  assert.ok(dialogContent.includes("py: flush ? 0 : { xs: 2, sm: 2.25 }"), 'shared dialog content vertical spacing is missing')
  assert.equal((renderer.match(/<XDriveDialogContent/g) || []).length, 7, 'desktop app-local dialogs are not all using shared dialog content')
  assert.ok(sharedConfirmDialog.includes('<XDriveDialogContent>'), 'shared confirmation dialog must use shared dialog content')
  assert.equal((renderer.match(/<XDriveDialogContent dividers flush>/g) || []).length, 3, 'desktop flush dialog surfaces are not preserved')
  assert.equal(/<DialogContent(?:\s|>)/.test(renderer), false, 'raw MUI DialogContent remains in desktop')
  assert.equal(styles.includes('.desktop-dialog-content'), false, 'legacy desktop dialog content CSS remains')
  assert.ok(renderer.includes('form="source-create-form"'), 'source create primary action is not in DialogActions')
  assert.ok(renderer.includes('form={`source-settings-form-${row.source.id}`}'), 'source settings primary action is not in DialogActions')
  assert.equal(renderer.includes('source-create-heading'), false, 'legacy source create panel heading remains inside the dialog')
  assert.equal(renderer.includes('source-settings-heading'), false, 'legacy source settings panel heading remains inside the dialog')
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
  for (const label of ['重试连接', '添加来源', '回收站', '运行诊断', '检查更新', '保存设置', '退出登录']) {
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
  assert.equal((renderer.match(/<MuiButton/g) || []).length, 6, 'unexpected raw MUI action buttons remain')
  assert.equal((renderer.match(/color="inherit"/g) || []).length, 5, 'five raw MUI buttons must remain limited to inherit-color alert actions')
  assert.ok(renderer.includes('className="auth-inline-action"') && renderer.includes('清除已保存密码'), 'saved-password inline action is missing')
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
  assert.ok(renderer.includes('className="auth-security-note"'), 'login security note should remain a lightweight non-alert note')
  assert.ok(renderer.includes('自动登录未成功，已暂时关闭自动登录'), 'auto-login failures need an inline warning')
  assert.ok(renderer.includes('window.xdriveDesktop.onLoginHistory'), 'auto-login failures must be pushed to the renderer instead of silently falling back')
  assert.ok(renderer.includes('{error ? <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert> : null}'), 'login errors need a stable inline error surface')
  for (const text of [
    '存储空间已超出配额',
    '未计入 CAS 分布',
    'Linux FUSE 模式不提供 Windows CfAPI',
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
  assert.ok(renderer.includes("check.status === 'PASS' ? 'good' : check.status === 'WARN' ? 'warning' : 'bad'"), 'diagnostic status does not map into shared tones')
  assert.equal(renderer.includes('diagnostic-badge'), false, 'legacy diagnostic badge remains')
  assert.equal(styles.includes('.diagnostic-badge'), false, 'legacy diagnostic badge CSS remains')
})

test('desktop cloud shares use the cross-client MUI share status badge', () => {
  assert.ok(sharedShareStatusBadge.includes('export function XDriveShareStatusBadge({ status }'), 'shared share status badge is missing')
  for (const label of ['有效', '已过期', '已达上限', '已撤销']) {
    assert.ok(sharedShareStatusBadge.includes(label), `shared share status badge is missing label: ${label}`)
  }
  assert.ok(renderer.includes('<XDriveShareStatusBadge status={share.status} />'), 'desktop cloud share status is not shared')
  assert.equal(renderer.includes('function shareStatusLabel('), false, 'desktop still owns a share status label mapper')
})

test('desktop external-source run history uses shared summary, status and progress surfaces', () => {
  assert.ok(sharedSourceRunSummary.includes('export function XDriveSourceRunSummary({'), 'shared source run summary component is missing')
  assert.ok(sharedSourceRunSummary.includes('ExternalSourceRunDetailView'), 'shared source run summary lost the shared view-model contract')
  assert.ok(sharedSourceRunSummary.includes('<XDriveStatusBadge'), 'shared source run summary is missing the status badge')
  assert.ok(sharedSourceRunSummary.includes('detail.modeLabel') && sharedSourceRunSummary.includes('detail.triggerLabel'), 'shared source run summary is missing mode/trigger metadata')
  assert.ok(sharedSourceRunSummary.includes('formatExternalSourceTime(detail.startedAt)'), 'shared source run summary is missing start-time formatting')
  assert.ok(renderer.includes('<XDriveSourceRunSummary'), 'desktop run history is not using the shared run summary')
  assert.ok(renderer.includes('runNumber={run.run_number}'), 'desktop run summary is not using the persisted run number')
  assert.ok(renderer.includes('detail={historyDetail}'), 'desktop run summary is not bound to the shared detail view')
  assert.ok(renderer.includes('wideAt="md"'), 'desktop run summary lost its responsive breakpoint')
  assert.equal(renderer.includes('(sourceHistoryPage - 1) * SOURCE_HISTORY_PAGE_SIZE + index + 1'), false, 'desktop still derives a fake run number from pagination order')
  assert.ok(sharedSourceRunProgress.includes('export function XDriveSourceRunProgress({'), 'shared source run progress component is missing')
  assert.ok(sharedSourceRunProgress.includes('ExternalSourceRunProgressView'), 'shared source run progress lost the shared view-model contract')
  assert.ok(sharedSourceRunProgress.includes('<LinearProgress'), 'shared source run progress is missing the progress bar')
  assert.ok(sharedSourceRunProgress.includes('当前文件：{progress.activePath}'), 'shared source run progress is missing active-path feedback')
  assert.ok(sharedSourceRunProgress.includes('loadingLabel="正在取消…"'), 'shared source run progress is missing cancel loading feedback')
  assert.ok(renderer.includes('<XDriveSourceRunProgress'), 'desktop run history is not using the shared run progress')
  assert.ok(renderer.includes('progress={historyDetail.progress}'), 'desktop run progress is not bound to the shared view model')
  assert.equal(renderer.includes('<LinearProgress'), false, 'desktop still owns a raw source run progress bar')
})

test('shared pagination controls own compact navigation and disabled-state rules', () => {
  assert.ok(sharedPaginationControls.includes('export function XDrivePaginationControls({'), 'shared pagination component is missing')
  assert.ok(sharedPaginationControls.includes('XDriveActionButton compact'), 'shared pagination does not use compact shared actions')
  assert.ok(sharedPaginationControls.includes('loading || page <= 1'), 'shared pagination previous-page guard is missing')
  assert.ok(sharedPaginationControls.includes('loading || !hasNext'), 'shared pagination next-page guard is missing')
  assert.ok(sharedPaginationControls.includes('labelPrefix'), 'shared pagination prefix contract is missing')
  assert.equal((renderer.match(/<XDrivePaginationControls/g) || []).length, 3, 'desktop Source history/failure/collection pagination is not fully shared')
  assert.equal(renderer.includes('失败项第 {failurePage.page}'), false, 'desktop still owns failure pagination text')
  assert.equal(renderer.includes('<span>第 {sourceHistoryPage} 页'), false, 'desktop still duplicates history pagination text in the heading')
})

test('desktop external-source create/settings surfaces use shared MUI alerts and actions', () => {
  const start = renderer.indexOf('open={sourceCreateOpen}')
  const end = renderer.indexOf('details={selectedSourceID === row.source.id && (', start)
  assert.ok(start >= 0 && end > start, 'could not isolate source create and source-card actions')
  const sourceCreateAndCard = renderer.slice(start, end)
  assert.equal((sourceCreateAndCard.match(/<MuiAlert/g) || []).length, 0, 'source create/card actions still render raw MUI alerts')
  assert.equal((sourceCreateAndCard.match(/<MuiButton/g) || []).length, 0, 'source create/card actions still render raw MUI buttons')
  assert.equal((sourceCreateAndCard.match(/<XDriveStatusAlert/g) || []).length >= 7, true, 'source create shared alert coverage is incomplete')
  assert.ok(sourceCreateAndCard.includes('yikeRateLimitNotice'), 'Yike API rate-limit notice is missing from source create UI')
  assert.equal((sourceCreateAndCard.match(/<XDriveActionButton/g) || []).length >= 9, true, 'source create/card shared action coverage is incomplete')
  assert.ok(renderer.includes('form={`source-settings-form-${row.source.id}`}'), 'source settings form binding is missing')
  assert.ok(renderer.includes('loadingLabel="正在测试…"'), 'credential test action lost shared loading feedback')
  assert.ok(renderer.includes('loadingLabel="正在保存…"'), 'source settings save action lost shared loading feedback')
})

test('desktop external-source detail/history surfaces use shared MUI alerts and actions', () => {
  const start = renderer.indexOf('details={selectedSourceID === row.source.id && (')
  const end = renderer.indexOf('after={editingSourceID === row.source.id && (', start)
  assert.ok(start >= 0 && end > start, 'could not isolate source detail/history UI')
  const sourceDetail = renderer.slice(start, end)
  assert.equal((sourceDetail.match(/<MuiAlert/g) || []).length, 0, 'source detail/history still renders raw MUI alerts')
  assert.equal((sourceDetail.match(/<MuiButton/g) || []).length, 2, 'source detail/history should only retain two inherit-color alert actions')
  assert.equal((sourceDetail.match(/<XDriveStatusAlert/g) || []).length >= 3, true, 'source detail/history shared alert coverage is incomplete')
  assert.equal((sourceDetail.match(/<XDriveSourceFailureItem/g) || []).length, 1, 'source detail/history shared failure-item coverage is incomplete')
  assert.equal((sourceDetail.match(/<XDrivePaginationControls/g) || []).length, 3, 'source detail/history/collection pagination is not fully shared')
  assert.equal((sourceDetail.match(/<XDriveSourceRunSummary/g) || []).length, 1, 'source detail/history shared summary coverage is incomplete')
  assert.equal((sourceDetail.match(/<XDriveSourceRunProgress/g) || []).length, 1, 'source detail/history shared progress coverage is incomplete')
  assert.ok(sourceDetail.includes("cancelLoading={busy === 'source-cancel-' + run.id}"), 'run cancel state is not forwarded to shared progress')
})

test('desktop external-source failed/delete dialogs use shared MUI surfaces', () => {
  const start = renderer.indexOf('open={sourceFailedItemsOpen')
  const end = renderer.indexOf('<SynologyDsmGuideDialog', start)
  assert.ok(start >= 0 && end > start, 'could not isolate source failed/delete dialogs')
  const sourceDialogs = renderer.slice(start, end)
  assert.equal((sourceDialogs.match(/<MuiAlert/g) || []).length, 0, 'source failed/delete dialogs still render raw MUI alerts')
  assert.equal((sourceDialogs.match(/<MuiButton/g) || []).length, 0, 'source failed/delete dialogs still render raw MUI buttons')
  assert.equal((sourceDialogs.match(/<XDriveStatusAlert/g) || []).length >= 1, true, 'source failed dialog shared alert coverage is incomplete')
  assert.equal((sourceDialogs.match(/<XDriveSourceFailureItem/g) || []).length, 1, 'source failed dialog shared failure-item coverage is incomplete')
  assert.equal((sourceDialogs.match(/<XDriveActionButton/g) || []).length >= 3, true, 'source failed/delete dialog shared action coverage is incomplete')
  assert.ok(sourceDialogs.includes('loadingLabel="正在删除…"'), 'source delete action lost shared loading feedback')
})

test('desktop external-source status uses the cross-client MUI badge', () => {
  assert.ok(sharedStatusBadge.includes('export function XDriveStatusBadge({'), 'shared status badge is missing')
  assert.ok(sharedSourceSummaryCard.includes('<XDriveStatusBadge tone={statusTone} label={statusLabel} />'), 'shared source summary card must own the status badge')
  assert.ok(renderer.includes('<XDriveSourceSummaryCard'), 'desktop source cards must consume the shared summary card')
  assert.ok(renderer.includes('statusTone={card.state.tone}'), 'desktop source status tone is not passed to the shared card')
  assert.ok(renderer.includes('statusLabel={card.state.label}'), 'desktop source status label is not passed to the shared card')
  assert.equal(renderer.includes('function desktopSourceTone('), false, 'desktop still owns a source tone mapper')
  assert.equal(renderer.includes('className="source-state"'), false, 'legacy desktop source state wrapper remains')
})

test('desktop empty and loading states use the cross-client MUI state panel', () => {
  assert.ok(sharedStatePanel.includes('export function XDriveStatePanel({'), 'shared state panel is missing')
  assert.ok(renderer.includes('<XDriveStatePanel loading message="正在加载设置…" />'), 'settings loading state is not shared')
  assert.ok(renderer.includes('message="尚未添加外部来源。"'), 'source empty state is not shared')
  assert.equal(renderer.includes('className="empty-state"'), false, 'legacy desktop empty-state remains')
  assert.equal(renderer.includes('className="cloud-empty"'), false, 'legacy cloud empty-state remains')
  assert.equal(renderer.includes('className="cache-unavailable"'), false, 'legacy cache unavailable state remains')
  assert.equal(styles.includes('.empty-state'), false, 'legacy empty-state CSS remains')
  assert.equal(styles.includes('.cloud-empty'), false, 'legacy cloud-empty CSS remains')
})

test('desktop uses app-native confirmation dialogs instead of browser confirms', () => {
  assert.equal(renderer.includes('window.confirm'), false, 'browser-native confirmation dialog remains in the desktop renderer')
  assert.ok(renderer.includes('type ConfirmDialogState ='), 'missing reusable confirmation dialog state')
  assert.ok(renderer.includes('XDriveConfirmDialog'), 'missing shared confirmation dialog')
  assert.ok(sharedConfirmDialog.includes('aria-label="确认操作"'), 'shared confirmation dialog must expose the confirmation aria label')
  assert.ok(sharedConfirmDialog.includes('closeDisabled={loading}'), 'shared confirmation dialog must prevent closing while loading')
  for (const label of [
    '清除凭据',
    '安装并重启',
    '永久删除',
    '恢复版本',
    '保留服务器版本',
    '保留本地版本',
    '退出登录',
  ]) {
    assert.ok(renderer.includes(label), `missing confirmation action label: ${label}`)
  }
})

test('desktop external sources expose Synology Push and Pull without duplicating the UI framework', () => {
  assert.ok(renderer.includes('<XDriveSourcePresetField'), 'source creation does not use the shared create preset field')
  assert.ok(renderer.includes("value={sourceCreatePreset}"), 'source creation does not pass the selected preset to the shared field')
  assert.ok(sharedSourceBasicFields.includes('externalSourceCreateOptions.map'), 'shared preset field is missing Source create options')
  assert.ok(sharedExternalSources.includes("label: '群晖 Photos · Push'"), 'missing Synology Push label')
  assert.ok(sharedExternalSources.includes("label: '群晖 Photos · Pull'"), 'missing Synology Pull label')
  assert.ok(sharedSourceCredentialFields.includes("'DSM 地址'"), 'shared credentials are missing DSM base URL field')
  assert.ok(sharedSourceCredentialFields.includes("'DSM 用户名'"), 'shared credentials are missing DSM username field')
  assert.ok(sharedSourceCredentialFields.includes("'DSM 密码'"), 'shared credentials are missing DSM password field')
  assert.ok(renderer.includes('同步空间'), 'missing Synology Photos space selector')
  assert.ok(renderer.includes('synologyPhotoSpaceOptions.map'), 'Synology space selector is not driven by shared options')
  assert.ok(renderer.includes('getSourceConnectorConfig'), 'missing Synology connector-config read path')
  assert.ok(renderer.includes('setSourceConnectorConfig'), 'missing Synology connector-config write path')
  assert.ok(renderer.includes("card.connector.manualTriggerExecutor === 'source_agent'"), 'DSM source-agent guide is not limited to Push sources')
  assert.ok(renderer.includes("sourceCreateProfile.credential === 'synology_dsm'"), 'Synology Pull credential UI is not profile-driven')
  assert.ok(renderer.includes('externalSourceCredentialLabel'), 'credential actions are not connector-neutral')
})

test('desktop Yike source exposes connection testing and V1 recovery UX', () => {
  assert.ok(renderer.includes('testSourceCredential'), 'missing candidate Cookie test')
  assert.ok(renderer.includes('testStoredSourceCredential'), 'missing stored Cookie test')
  assert.ok(renderer.includes('测试连接'), 'missing Yike connection test action')
  assert.ok(renderer.includes('XDriveYikeCookieHelp'), 'missing shared Yike Cookie acquisition guide')
  assert.equal((renderer.match(/<XDriveSourceCookieField\b/g) || []).length, 2, 'desktop Yike create/settings should reuse shared Cookie field')
  assert.equal(renderer.includes('function YikeCookieHelpGuide()'), false, 'desktop still owns a local Yike Cookie help implementation')
  assert.ok(sharedYikeCookieHelp.includes("variant: 'accordion' | 'dialog'"), 'shared Yike Cookie help does not support both clients')
  assert.ok(renderer.includes('yikeConnectorNotice'), 'missing Yike private-API notice')
  assert.ok(renderer.includes('yikeManagedTargetLabel'), 'missing Yike managed target label')
  assert.ok(renderer.includes('固定逻辑目录'), 'missing Yike managed target explanation')
  assert.ok(sharedYikeCookieHelp.includes('如何获取 Cookie？'), 'missing compact Yike Cookie help action')
  assert.ok(sharedYikeCookieHelp.includes('点击展开'), 'missing Web expandable Yike Cookie help affordance')
  assert.ok(dialogTitle.includes("maxHeight: { xs: '92vh', sm: '84vh' }"), 'shared dialog paper must stay viewport-bounded')
  assert.equal(renderer.includes('<Accordion'), false, 'Yike Cookie help must not expand inline')
  assert.ok(renderer.includes('立即重试'), 'missing Yike failed-item retry action')
  assert.ok(renderer.includes('已自动撤销'), 'missing Yike create rollback feedback')
  assert.ok(renderer.includes('自动回滚也失败'), 'missing Source rollback failure fallback')
  assert.ok(renderer.includes('externalSourceSavedCredentialMask'), 'saved Yike Cookie mask is not shown in settings')
  assert.ok(renderer.includes('isExternalSourceSavedCredentialMask(sourceEditCookie)'), 'saved Cookie mask could be submitted as a replacement value')
  assert.ok(renderer.includes('当前已保存的 Cookie 以遮罩显示'), 'missing saved Cookie UX explanation')
  assert.ok(renderer.includes("onFocus={() => {"), 'saved Cookie field does not enter replacement mode on focus')
})

test('desktop external-source details expose paged Source collections', () => {
  assert.ok(renderer.includes('相册与集合'), 'missing Source collection section')
  assert.ok(renderer.includes('getSourceCollections'), 'missing Source collection list bridge')
  assert.ok(renderer.includes('getSourceCollectionItems'), 'missing Source collection item bridge')
  assert.ok(renderer.includes('SOURCE_COLLECTION_ITEM_PAGE_SIZE = 50'), 'missing Source collection page-size contract')
  assert.ok(renderer.includes('<XDriveSourceCollectionSummary'), 'missing shared collection summary presentation')
  assert.ok(renderer.includes('<XDriveSourceCollectionItem'), 'missing shared collection item presentation')
  assert.ok(sharedSourceCollection.includes('externalSourceCollectionKindLabel'), 'shared collection summary is missing collection kind label')
  assert.ok(sharedSourceCollection.includes('externalSourceCollectionStateTone'), 'shared collection summary is missing collection state tone')
  assert.ok(renderer.includes('该来源暂无相册/集合元数据。'), 'missing empty collection state')
  assert.ok(renderer.includes('展开后加载成员。'), 'collection members must stay lazy-loaded')
  assert.ok(renderer.includes('labelPrefix="成员"'), 'collection members must use shared pagination')
})

test('desktop external sources expose per-Source scheduling', () => {
  for (const text of ['调度方式', '固定间隔', 'Cron', '仅手动', 'Cron 表达式', '运行间隔', 'IANA 时区']) {
    assert.ok(sharedSourceScheduleFields.includes(text), `missing shared Source schedule UI label: ${text}`)
  }
  assert.equal((renderer.match(/<XDriveSourceScheduleFields\b/g) || []).length, 2, 'desktop create/settings should reuse shared Source schedule fields')
  assert.ok(renderer.includes('wideAt="md"'), 'desktop Source schedule fields should preserve the md breakpoint')
  assert.ok(renderer.includes('schedule_type: sourceCreateScheduleType'), 'missing create schedule payload')
  assert.ok(renderer.includes('schedule_type: sourceEditScheduleType'), 'missing update schedule payload')
  assert.ok(renderer.includes('detail.scheduleLabel'), 'missing Source schedule detail label')
  assert.ok(main.includes('schedule_expression'), 'Electron main does not forward Source schedule fields')
  assert.ok(main.includes("value.schedule_type !== 'manual'"), 'Electron main does not accept manual-only Source schedules')
})

test('desktop external sources reuse the shared ignore-rules field', () => {
  assert.ok(sharedSourceIgnoreRulesField.includes('XDriveSourceIgnoreRulesField'), 'shared ignore-rules field is missing')
  assert.ok(sharedSourceIgnoreRulesField.includes('label="忽略规则"'), 'shared ignore-rules label is missing')
  assert.ok(sharedSourceIgnoreRulesField.includes('spellCheck: false'), 'shared ignore-rules field should disable spellcheck')
  assert.equal((renderer.match(/<XDriveSourceIgnoreRulesField\b/g) || []).length, 2, 'desktop create/settings should reuse shared ignore-rules field')
  assert.ok(renderer.includes('monospace'), 'desktop ignore-rules fields should preserve code-style text')
})

test('desktop external sources expose live progress and cooperative cancellation', () => {
  assert.ok(renderer.includes('<XDriveSourceRunProgress'), 'missing shared Source live progress surface')
  assert.ok(sharedSourceRunProgress.includes('<LinearProgress'), 'shared Source progress is missing the live progress bar')
  assert.ok(sharedSourceRunProgress.includes('当前文件：{progress.activePath}'), 'shared Source progress is missing the active file label')
  assert.ok(sharedSourceRunProgress.includes('loadingLabel="正在取消…"'), 'shared Source progress is missing cancellation feedback')
  assert.ok(renderer.includes('cancelSourceRun'), 'missing renderer Source cancel bridge call')
  assert.ok(renderer.includes('loadSources(true)'), 'missing silent Source progress refresh')
})

test('desktop cloud quota hides server disk wording for limited quotas', () => {
  assert.ok(renderer.includes('可用空间'), 'missing cloud available-space label')
  assert.ok(renderer.includes("cloudQuota.quota_bytes > 0 ? '用户配额限制' : '服务器磁盘可用'"), 'missing quota-aware disk visibility')
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
  assert.ok(renderer.includes('className="auth-panel auth-panel-form"'), 'auth forms must use the dedicated MUI form surface')
  assert.ok(renderer.includes('id="desktop-login-server"'), 'server address must stay directly editable for self-hosted deployments')
  assert.ok(renderer.includes('支持自建 xDrive 服务器；连接会在登录时再次验证。'), 'self-hosted server purpose should be explicit')
  assert.ok(renderer.includes('window.xdriveDesktop.probeServer(candidate)'), 'server field should expose reachability feedback before login')
  assert.ok(main.includes("ipcMain.handle('desktop:probe-server'"), 'main process server probe is missing')
  assert.ok(main.includes("normalized + '/api/v1/version'"), 'server probe should use the public version endpoint')
  assert.equal(renderer.includes('label="同步文件夹（可选）"'), false, 'sync-folder configuration should not remain in the login form')
  assert.equal(renderer.includes('className="auth-folder-row"'), false, 'login folder browse row should be removed')
  assert.ok(renderer.includes('登录后可在“设置”中修改'), 'login must explain where sync-folder configuration moved')
})

test('desktop login makes password and automatic-login state explicit', () => {
  assert.ok(renderer.includes("placeholder={savedPasswordAvailable ? '••••••••••••' : '输入密码'}"), 'saved password must not look like an empty field')
  assert.ok(renderer.includes('className="auth-saved-chip"') && renderer.includes('label="已保存"'), 'saved password state chip is missing')
  assert.ok(renderer.includes('VisibilityRoundedIcon') && renderer.includes('VisibilityOffRoundedIcon'), 'password visibility control is missing')
  assert.ok(renderer.includes('清除已保存密码'), 'saved password must be removable from the login page')
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
  assert.ok(renderer.includes('className="auth-security-note"'), 'credential-storage explanation needs a lightweight note')
  assert.ok(renderer.includes('不会以明文写入配置文件'), 'secure-storage copy should be concise and user-facing')
  assert.ok(renderer.includes('className="auth-version"'), 'desktop version/build information should remain visible on login')
  assert.ok(renderer.includes('按 Enter 登录'), 'keyboard login hint is missing')
  assert.equal(renderer.includes('凭据会直接传递给 Go Agent'), false, 'implementation-detail security copy should not remain on the login page')
  assert.equal(renderer.includes('<p className="eyebrow">登录</p>'), false, 'duplicate login eyebrow should be removed')
})

test('desktop login exposes compact pre-login diagnostics beside build information', () => {
  assert.ok(renderer.includes('className="auth-footer"'), 'login build metadata and diagnostics entry need one compact footer')
  assert.ok(renderer.includes('className="auth-diagnostics-toggle"'), 'pre-login diagnostics toggle is missing')
  assert.ok(renderer.includes('aria-label="登录诊断"'), 'pre-login diagnostics summary needs an accessible label')
  for (const label of ['Agent', '服务器', '安全凭据存储', '当前账号密码', '打开日志']) {
    assert.ok(renderer.includes(label), `missing pre-login diagnostic item: ${label}`)
  }
  assert.ok(renderer.includes("run('login-open-logs', () => window.xdriveDesktop.agent.openLogs())"), 'pre-login diagnostics should provide direct log access')
  assert.ok(styles.includes('.auth-login-diagnostics {'), 'pre-login diagnostics layout is missing')
  assert.ok(styles.includes('.auth-diagnostic-row strong.good'), 'diagnostic success state styling is missing')
  assert.ok(styles.includes('.auth-diagnostic-row strong.bad'), 'diagnostic failure state styling is missing')
})

test('desktop auth forms use MUI controls without legacy CSS overriding MUI internals', () => {
  assert.ok(renderer.includes('className="auth-field"'), 'auth fields need one shared external-label layout')
  assert.ok(renderer.includes('className="auth-options"'), 'remember/auto-login controls need one aligned option row')
  const authStart = renderer.indexOf('<form className="auth-panel auth-panel-form"')
  const authEnd = renderer.indexOf('</form>', authStart)
  assert.notEqual(authStart, -1, 'missing desktop auth form')
  assert.notEqual(authEnd, -1, 'missing desktop auth form end')
  const authSection = renderer.slice(authStart, authEnd)
  assert.equal(authSection.includes('label="服务器"'), false, 'server should not use a notched outlined label')
  assert.equal(renderer.includes('label="用户名"'), false, 'username should not use a notched outlined label')
  assert.equal(renderer.includes('label="密码"'), false, 'password should not use a notched outlined label')
  assert.ok(renderer.includes('<XDriveActionButton\n                className="auth-submit"'), 'auth submit action should use the shared MUI action button')
  assert.equal(renderer.includes('<label>当前密码<input'), false, 'password-change form must not keep native label/input markup')
  assert.equal(styles.includes('.auth-panel label,'), false, 'legacy auth label CSS must not override MUI controls')
  assert.equal(styles.includes('.auth-panel input,'), false, 'legacy auth input CSS must not override MUI controls')
  assert.ok(styles.includes('.auth-field .MuiOutlinedInput-root {'), 'auth inputs need shared radius/background treatment')
  assert.ok(styles.includes('.auth-options .auth-option.MuiFormControlLabel-root { margin: 0; }'), 'checkbox labels must not inherit detached margins')
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
  assert.equal((renderer.match(/<XDriveSectionHeader/g) || []).length, 7, 'desktop should reuse the shared section header for all seven repeated sections')
  assert.equal(renderer.includes('className="section-heading"'), false, 'legacy desktop section-heading wrapper should be removed')
  assert.equal(styles.includes('.section-heading {'), false, 'legacy desktop section-heading CSS should be removed')
  assert.equal(styles.includes('.source-heading-actions {'), false, 'legacy source header action CSS should be removed')
  assert.equal(styles.includes('.source-note {'), false, 'legacy source header note CSS should be removed')
  assert.equal(styles.includes('.storage-note {'), false, 'legacy storage header note CSS should be removed')
  assert.equal(styles.includes('.diagnostic-note {'), false, 'legacy diagnostics header note CSS should be removed')
})
