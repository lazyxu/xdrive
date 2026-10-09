const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const webApp = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
const webStyles = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'styles.css'), 'utf8')
const webFileExplorer = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'WebFileExplorer.tsx'), 'utf8')
const desktopApp = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const sharedSidebar = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SidebarNav.tsx'), 'utf8')
const sharedWorkspaceSidebar = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceSidebar.tsx'), 'utf8')
const sharedStorageSummary = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SidebarStorageSummary.tsx'), 'utf8')
const sharedCloudStorage = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudStoragePage.tsx'), 'utf8')
const sharedLocalStorage = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'LocalStoragePage.tsx'), 'utf8')
const sharedCloudFilesController = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'CloudFilesController.ts'), 'utf8')
const sharedWorkspace = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceSurface.tsx'), 'utf8')
const sharedWorkspaceShell = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceShell.tsx'), 'utf8')
const sharedWorkspaceContent = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceContent.tsx'), 'utf8')
const sharedWorkspaceRoute = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceRoute.ts'), 'utf8')
const sharedAccount = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'AccountChrome.tsx'), 'utf8')
const sharedBrand = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'BrandLockup.tsx'), 'utf8')
const sharedGallery = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx'), 'utf8')
const sharedAuthSurface = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'AuthSurface.tsx'), 'utf8')
const adminUsers = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'AdminUsers.tsx'), 'utf8')
const adminAudit = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'AdminAudit.tsx'), 'utf8')
const storageStats = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')

test('wide Web keeps compact chrome while mobile moves global controls into fullscreen app navigation', () => {
  const backgroundStart = webApp.indexOf('data-xdrive-workspace-background')
  assert.notEqual(backgroundStart, -1, 'missing authenticated workspace background')
  const appStart = webApp.indexOf('<AppBar\n          position="static"\n          elevation={0}\n          color="inherit"\n          className="web-appbar"', backgroundStart)
  const appEnd = webApp.indexOf('</AppBar>', appStart)
  assert.notEqual(appStart, -1, 'missing Web AppBar')
  assert.notEqual(appEnd, -1, 'missing Web AppBar end')
  const appBar = webApp.slice(appStart, appEnd)

  const actionsStart = webApp.indexOf('const workspaceActions = (')
  const actionsEnd = webApp.indexOf('\n  return (', actionsStart)
  assert.notEqual(actionsStart, -1, 'global actions must have one shared Web owner')
  const actions = webApp.slice(actionsStart, actionsEnd)
  assert.ok(actions.includes('<WebAccountMenu'), 'global actions must retain the account menu')
  assert.ok(actions.includes('<XDriveTransferPopover'), 'global actions must retain transfers')
  assert.ok(actions.includes('disabled={viewerActive || (compactWorkspace && !compactNavigationOpen)}'), 'Viewer and closed mobile navigation must close account/transfer portals')
  assert.ok(appBar.includes("display: { xs: 'none', md: 'flex' }"), 'mobile AppBar must reserve no viewport height')
  assert.ok(appBar.includes('{!compactWorkspace ? workspaceActions : null}'), 'wide Web AppBar must retain global actions without mounting a hidden second mobile copy')
  assert.ok(webApp.includes('compactFullscreen'), 'mobile Web must use the fullscreen app-navigation overlay')
  assert.ok(webApp.includes('compactActions={compactWorkspace ? workspaceActions : undefined}'), 'mobile global controls must be reachable inside app navigation')
  assert.ok(appBar.includes('variant="titlebar"'), 'Web AppBar should reuse the Desktop-scale brand lockup')
  assert.ok(appBar.includes("borderBottom: 1"), 'Web AppBar should separate chrome with a divider instead of elevation')
  assert.ok(appBar.includes("minHeight: '48px !important'"), 'Web AppBar should stay at the compact 48px height')
  assert.equal(webStyles.includes('box-shadow: 0 2px 12px'), false, 'Web AppBar should not keep the old elevated shadow')
  for (const label of ['用户管理', '审计日志', '全局存储']) {
    assert.equal(appBar.includes(label), false, `${label} should not remain in the AppBar`)
  }

  assert.ok(webApp.includes('<XDriveWorkspaceSidebar'), 'Web must use the shared complete sidebar renderer')
  assert.ok(webApp.includes("const webSidebarSections: XDriveSidebarSectionModel[] = ["), 'Web sidebar must use the shared section model')
  assert.ok(webApp.includes("...(profile?.role === 'admin'"), 'admin sidebar model must remain role-gated')
  assert.ok(webApp.includes("label: '管理'"), 'missing admin section label')
  assert.ok(webApp.includes("ariaLabel: '管理员功能'"), 'missing admin navigation landmark')
  for (const label of ['用户管理', '审计日志', '全局存储']) {
    assert.ok(webApp.includes(`label: '${label}'`), `missing admin sidebar destination: ${label}`)
  }
  assert.ok(webApp.includes('ManageAccountsRoundedIcon'), 'missing User Management icon')
  assert.ok(webApp.includes('AssessmentRoundedIcon'), 'missing Audit icon')
})
test('Web workspaces share page presentation while Files avoids a duplicate internal page header', () => {
  assert.equal(webApp.includes('<XDriveWorkspaceSurface presentation="page" title="文件">'), false, 'Files must not render a duplicate page header')
  assert.equal(webApp.includes("height: { xs: 560, md: '100%' }"), false, 'Files must use the available workspace height on narrow screens')
  assert.ok(webApp.includes('<XDriveMediaGalleryPage'), 'Gallery should mount the shared page directly')
  assert.ok(sharedGallery.includes('<XDriveWorkspaceSurface presentation="page" title="图库" showPageHeader={false}>'), 'shared Gallery page must own workspace page chrome without duplicating its title')
  assert.ok(webApp.includes('<XDriveSourceManager'), 'Sync Folders should mount the shared manager directly')
  assert.ok(webApp.includes('<XDriveLocalStoragePage source={localStorageSource} />'), 'Local Storage should render through the shared page')
  assert.ok(sharedLocalStorage.includes('title="浏览器存储"'), 'shared Local Storage should expose browser storage on Web')
  assert.ok(webApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Cloud Storage should render through the shared page')
})

test('Web admin workspaces are first-class pages while action dialogs stay local', () => {
  assert.equal(webApp.includes('adminOpen'), false, 'legacy User Management modal state should be removed')
  assert.equal(webApp.includes('auditOpen'), false, 'legacy Audit modal state should be removed')
  assert.equal(webApp.includes('storageStatsScope'), false, 'legacy Global Storage modal state should be removed')

  assert.ok(webApp.includes("<AdminUsersPanel\n            api={api}\n            currentUserID={profile.id}"), 'User Management should render as a page')
  assert.ok(webApp.includes("<AdminAuditPanel api={api} />"), 'Audit should render as a page')
  assert.ok(webApp.includes("<StorageStatsPanel\n            api={api}\n            scope=\"global\""), 'Global Storage should render as a page')

  for (const [name, source, title] of [
    ['User Management', adminUsers, '用户管理'],
    ['Audit', adminAudit, '审计日志'],
  ]) {
    assert.equal(source.includes("presentation = 'dialog'"), false, `${name} should not expose top-level dialog presentation`)
    assert.equal(source.includes("presentation?: 'dialog' | 'page'"), false, `${name} should be page-only`)
    assert.ok(source.includes('<XDriveWorkspaceSurface'), `${name} should use page workspace chrome`)
    assert.ok(source.includes('presentation="page"'), `${name} should stay page-only`)
    assert.ok(source.includes(`title="${title}"`), `${name} workspace title is missing`)
  }

  assert.ok(adminUsers.includes('pageActions={'), 'User Management primary actions should live in the shared page header')
  assert.ok(adminUsers.includes('正在刷新…'), 'User Management should expose an explicit refresh action')
  assert.ok(adminUsers.includes('open={createOpen}'), 'Create User should remain a local action dialog')
  assert.ok(adminUsers.includes('open={!!quotaUser}'), 'Quota editing should remain a local action dialog')
  assert.ok(adminUsers.includes('open={!!resetUser}'), 'Password reset should remain a local action dialog')
  assert.ok(storageStats.includes('export default function StorageStatsPanel'), 'Storage workspace should not retain Modal naming')
  assert.equal(storageStats.includes("presentation = 'dialog'"), false, 'Storage workspace should be page-only')
  assert.ok(storageStats.includes('<XDriveWorkspaceSurface'), 'Global Storage should reuse storage workspace chrome')
  assert.ok(storageStats.includes('presentation="page"'), 'Storage workspace should render as a page')
  assert.ok(storageStats.includes('subtitle={'), 'Storage workspace should explain the selected storage scope')
  assert.ok(storageStats.includes('pageActions={'), 'Storage workspace should expose page-level actions')
  assert.ok(storageStats.includes('setReloadKey((value) => value + 1)'), 'Storage workspace should expose a full-page refresh')
  assert.ok(storageStats.includes("title={scope === 'global' ? '全局存储' : '存储'}"), 'Global Storage title should align with sidebar navigation')
})


test('Web admin UI favors readable labels while preserving technical identifiers', () => {
  assert.ok(adminAudit.includes("'auth.login.success': '登录成功'"), 'Audit should map event codes to Chinese labels')
  assert.ok(adminAudit.includes('getOptionLabel={actionLabel}'), 'Audit filter should display readable action labels')
  assert.ok(adminAudit.includes('actionLabel(event.action)'), 'Audit table should display readable action labels')
  assert.ok(adminAudit.includes('actorRoleLabel(event.actor_role)'), 'Audit table should display readable actor roles')
  assert.ok(adminAudit.includes('{event.action}'), 'Audit table should preserve the exact event code as secondary text')
})

test('User Management prevents duplicate modal submissions', () => {
  for (const state of ['createSaving', 'quotaSaving', 'resetSaving']) {
    assert.ok(adminUsers.includes(state), `User Management missing busy state: ${state}`)
  }
  for (const label of ['正在创建…', '正在保存…', '正在重置…']) {
    assert.ok(adminUsers.includes(label), `User Management missing loading label: ${label}`)
  }
  assert.ok(adminUsers.includes('closeDisabled={createSaving}'), 'Create User dialog should not close while saving')
  assert.ok(adminUsers.includes('closeDisabled={quotaSaving}'), 'Quota dialog should not close while saving')
  assert.ok(adminUsers.includes('closeDisabled={resetSaving}'), 'Password reset dialog should not close while saving')
})

test('Web admin tables stay useful at common desktop widths', () => {
  assert.ok(
    adminUsers.includes("minWidth: { xs: 0, md: 900 }"),
    'User Management should use mobile card width while preserving the 900px desktop table contract',
  )
  assert.ok(
    adminUsers.includes("display: { xs: 'grid', md: 'none', xl: 'table-cell' }"),
    'User Management should expose lower-priority password/login metadata in mobile cards while keeping medium desktop compact',
  )
  assert.ok(adminAudit.includes('minWidth: 880'), 'Audit table should keep its core columns compact')
  assert.ok(adminAudit.includes('审计事件详情'), 'Audit should move source and metadata into a local detail dialog')
  assert.ok(adminAudit.includes('setDetailEvent(event)'), 'Audit table should expose a details action')
  assert.ok(adminAudit.includes('detailEvent.request_id'), 'Audit details should preserve request identifiers')
  assert.ok(adminAudit.includes('metadataText(detailEvent.metadata)'), 'Audit details should preserve metadata')
})

test('Web and Desktop shell composition lives in shared MUI', () => {
  assert.ok(sharedSidebar.includes('XDriveSidebarSurface'), 'shared sidebar surface primitive is missing')
  assert.ok(sharedSidebar.includes('XDriveSidebarNavList'), 'shared sidebar list primitive is missing')
  assert.ok(sharedSidebar.includes('XDriveSidebarNavItem'), 'shared sidebar item primitive is missing')
  assert.ok(sharedSidebar.includes('XDriveCoreWorkspaceNavItems'), 'shared core workspace navigation is missing')
  assert.ok(sharedSidebar.includes('XDriveSidebarSection'), 'shared sidebar section primitive is missing')
  assert.ok(sharedWorkspaceSidebar.includes('export function XDriveWorkspaceSidebar'), 'shared complete sidebar renderer is missing')
  assert.ok(sharedWorkspaceSidebar.includes('<XDriveSidebarSurface'), 'shared complete sidebar must own the surface')
  assert.ok(sharedWorkspaceSidebar.includes('<XDriveCoreWorkspaceNavItems'), 'shared complete sidebar must own core navigation')
  assert.ok(sharedWorkspaceSidebar.includes('<XDriveSidebarSection'), 'shared complete sidebar must own extension sections')
  assert.ok(sharedWorkspaceSidebar.includes('<XDriveSidebarStorageSummary'), 'shared complete sidebar must own the footer')
  assert.ok(webApp.includes('<XDriveWorkspaceSidebar'), 'Web should consume the shared complete sidebar')
  assert.ok(desktopApp.includes('<XDriveWorkspaceSidebar'), 'Desktop should consume the shared complete sidebar')
  for (const token of ['<XDriveSidebarSurface', '<XDriveSidebarNavList', '<XDriveCoreWorkspaceNavItems', '<XDriveSidebarSection', '<XDriveSidebarStorageSummary']) {
    assert.equal(webApp.includes(token), false, `Web should not assemble sidebar primitive directly: ${token}`)
    assert.equal(desktopApp.includes(token), false, `Desktop should not assemble sidebar primitive directly: ${token}`)
  }

  assert.ok(sharedStorageSummary.includes('XDriveSidebarStorageSummary'), 'shared sidebar storage summary is missing')
  assert.ok(sharedCloudStorage.includes('export function XDriveCloudStoragePage'), 'shared cloud storage workspace is missing')
  assert.ok(sharedCloudStorage.includes('title="云端存储"'), 'shared cloud storage workspace title is missing')
  assert.ok(webApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Web must render shared cloud storage')
  assert.ok(desktopApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Desktop must render shared cloud storage')
  assert.ok(sharedLocalStorage.includes('export function XDriveLocalStoragePage'), 'shared local-storage presentation is missing')
  assert.ok(sharedLocalStorage.includes('title="浏览器存储"'), 'shared local-storage page must expose browser storage')
  assert.ok(sharedLocalStorage.includes('title="Desktop 存储"'), 'shared local-storage page must support Desktop storage')
  assert.ok(desktopApp.includes('<XDriveLocalStoragePage source={localStorageSource} />'), 'Desktop must render shared local storage')
  assert.ok(webApp.includes('<XDriveLocalStoragePage source={localStorageSource} />'), 'Web must render shared local storage')

  assert.ok(sharedWorkspace.includes('XDriveWorkspaceSurface'), 'shared workspace surface is missing')
  assert.ok(sharedWorkspaceShell.includes('XDriveWorkspaceShell'), 'shared workspace shell is missing')
  assert.ok(sharedWorkspaceShell.includes('XDRIVE_SIDEBAR_WIDTH'), 'shared workspace shell should own sidebar width')
  assert.ok(sharedWorkspaceContent.includes('export function XDriveWorkspaceContent'), 'shared workspace content is missing')
  assert.ok(webApp.includes('<XDriveWorkspaceShell'), 'Web should consume the shared workspace shell')
  assert.ok(desktopApp.includes('<XDriveWorkspaceShell>'), 'Desktop should consume the shared workspace shell')
  assert.ok((webApp.match(/<XDriveWorkspaceContent\b/g) || []).length >= 2, 'Web should use shared workspace content for authenticated shells')
  assert.ok(desktopApp.includes('<XDriveWorkspaceContent'), 'Desktop should use shared workspace content')
  assert.ok(sharedAccount.includes('XDriveAccountAvatarButton'), 'shared account avatar trigger is missing')
  assert.ok(sharedBrand.includes('XDriveBrandLockup'), 'shared brand lockup is missing')
})
test('Web and Desktop share the authentication surface while keeping auth logic local', () => {
  assert.ok(sharedAuthSurface.includes('export function XDriveAuthShell'), 'shared auth shell is missing')
  assert.ok(sharedAuthSurface.includes('export function XDriveAuthPanel'), 'shared auth panel is missing')
  assert.ok(sharedAuthSurface.includes('viewport ? \'100vh\' : \'100%\''), 'shared auth shell must support viewport and parent filling')
  assert.ok(sharedAuthSurface.includes('decorated'), 'shared auth shell must support the Web login background')
  assert.ok(webApp.includes('<XDriveAuthShell viewport decorated spacing="compact">'), 'Web login should use the shared auth shell')
  assert.ok(webApp.includes('<XDriveAuthPanel size="compact">'), 'Web login/password surfaces should use the shared auth panel')
  assert.ok(desktopApp.includes('<XDriveAuthShell>'), 'Desktop auth states should use the shared auth shell')
  assert.ok(desktopApp.includes('<XDriveAuthPanel'), 'Desktop auth states should use the shared auth panel')
  assert.equal(webStyles.includes('.auth-shell'), false, 'Web must not retain a local auth shell implementation')
  assert.equal(webStyles.includes('.auth-card'), false, 'Web must not retain a local auth card implementation')
})

test('shared account trigger is informative on Web and compact on Desktop', () => {
  assert.ok(sharedAccount.includes("import ExpandMoreRoundedIcon"), 'full account trigger should expose a dropdown affordance')
  assert.ok(sharedAccount.includes('if (compact) {'), 'shared account trigger should retain an avatar-only compact mode')
  assert.ok(sharedAccount.includes('<ButtonBase'), 'full account trigger should use a compact labeled button surface')
  assert.ok(sharedAccount.includes("{username || '账户'}"), 'full account trigger should show the signed-in username')
  assert.ok(sharedAccount.includes('<ExpandMoreRoundedIcon'), 'full account trigger should show a dropdown arrow')
  assert.ok(sharedAccount.includes('minHeight: 36'), 'full account trigger should align with compact application chrome')
  assert.ok(webApp.includes('<XDriveAccountAvatarButton username={username}'), 'Web should use the full shared account trigger')
  assert.ok(desktopApp.includes('compact\n        className="desktop-titlebar-account-button"'), 'Desktop titlebar should retain compact avatar-only account chrome')
  assert.ok(sharedAccount.includes('export function XDriveAccountMenuActions'), 'shared account chrome must own common account actions')
  assert.ok(sharedAccount.includes('SettingsRoundedIcon'), 'shared account actions must own Settings presentation')
  assert.ok(sharedAccount.includes('InfoOutlinedIcon'), 'shared account actions must own About presentation')
  assert.ok(sharedAccount.includes('LogoutRoundedIcon'), 'shared account actions must own Logout presentation')
  assert.ok(webApp.includes('<XDriveAccountMenuActions'), 'Web must consume shared account menu actions')
  assert.ok(desktopApp.includes('<XDriveAccountMenuActions'), 'Desktop must consume shared account menu actions')
  assert.equal(webApp.includes('<ListItemText>退出登录</ListItemText>'), false, 'Web must not duplicate logout menu presentation')
  assert.equal(desktopApp.includes('<ListItemText>退出登录</ListItemText>'), false, 'Desktop must not duplicate logout menu presentation')
})

test('Shared sidebar uses compact system navigation chrome', () => {
  assert.ok(sharedSidebar.includes('minHeight: 36'), 'shared sidebar nav items should use compact 36px rows')
  assert.ok(sharedSidebar.includes("borderRadius: '8px'"), 'shared sidebar nav items should use restrained 8px corners')
  assert.ok(sharedSidebar.includes("'&.Mui-selected::before'"), 'selected navigation should expose a slim accent marker')
  assert.ok(sharedSidebar.includes("rgba(65,119,230,.08)"), 'light selected navigation should keep the background subtle')
  assert.ok(sharedSidebar.includes("rgba(95,143,244,.14)"), 'dark selected navigation should keep the background subtle')
  assert.ok(sharedSidebar.includes("fontSize: 11"), 'sidebar section labels should stay visually quiet')
  assert.equal(sharedSidebar.includes('borderTop:'), false, 'sidebar sections should not use long horizontal dividers')
  assert.equal(sharedSidebar.includes('borderLeft:'), false, 'responsive sidebar sections should separate by spacing rather than rules')
  assert.ok(sharedWorkspaceSidebar.includes('<XDriveWorkspaceCompactNavigation'), 'responsive narrow navigation belongs in the shared sidebar')
  assert.ok(sharedWorkspaceSidebar.includes("theme.breakpoints.down('md')"), 'compact navigation must use the same breakpoint as the shell')
  assert.ok(sharedSidebar.includes('export function XDriveSidebarBadge'), 'badge rendering must stay centralized')
})

test('Web and Desktop pass account quota into the shared sidebar footer', () => {
  assert.ok(sharedStorageSummary.includes("label = '云端存储'"), 'shared storage summary should identify account usage as cloud storage')
  assert.ok(sharedStorageSummary.includes("'无容量限制'"), 'unlimited accounts should use a natural capacity label')
  assert.ok(sharedStorageSummary.includes('diskPercentage'), 'unlimited storage footer should derive disk usage percentage')
  assert.ok(sharedStorageSummary.includes('<LinearProgress'), 'shared storage summary should show quota or disk progress')
  assert.ok(sharedWorkspaceSidebar.includes('storageSummary ? ('), 'shared WorkspaceSidebar must own footer placement')
  assert.ok(sharedWorkspaceSidebar.includes('storageSummary={storageSummary}'), 'compact navigation must receive the same account storage summary')

  for (const token of [
    'export function xDriveWorkspaceStorageSummary',
    'usedBytes: quota.physical_used_bytes',
    'totalBytes: quota.quota_bytes',
    'diskTotalBytes: quota.disk_total_bytes',
    'diskAvailableBytes: quota.disk_available_bytes',
  ]) {
    assert.ok(sharedWorkspaceSidebar.includes(token), `shared sidebar quota adapter missing: ${token}`)
  }
  assert.ok(webApp.includes('storageSummary={xDriveWorkspaceStorageSummary(quota)}'), 'Web must consume the shared sidebar quota adapter')
  assert.ok(desktopApp.includes('storageSummary={xDriveWorkspaceStorageSummary(cloudQuota)}'), 'Desktop must consume the shared sidebar quota adapter')
  assert.ok(sharedCloudFilesController.includes('quotaRefreshIntervalMs = 60_000'), 'shared Cloud Files controller should keep Web sidebar quota reasonably fresh')
  assert.ok(sharedCloudFilesController.includes('globalThis.setInterval(() => {'), 'shared Cloud Files controller should own periodic quota refresh')
  assert.ok(desktopApp.includes('useXDriveCloudFilesController<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>'), 'Desktop should use the shared quota refresh lifecycle')
})
test('shared workspace content owns page spacing and Files full-bleed behavior', () => {
  for (const token of [
    "export type XDriveWorkspaceContentPresentation = 'page' | 'files'",
    'export function XDriveWorkspaceContent',
    "const files = presentation === 'files'",
    "p: '34px 40px 48px'",
    "'@media (max-width: 960px)'",
    "height: '100%'",
    "overflowY: 'auto'",
    "overflow: 'hidden'",
  ]) {
    assert.ok(sharedWorkspaceContent.includes(token), `shared workspace content missing: ${token}`)
  }
  assert.ok(webApp.includes("height: '100vh'"), 'Web shell must retain a legacy viewport fallback')
  assert.ok(webApp.includes("'@supports (height: 100dvh)'"), 'Web shell must use the dynamic viewport when supported')
  assert.ok(webApp.includes("height: '100dvh'"), 'Web shell must fit the mobile viewport')
  assert.ok(sharedWorkspaceShell.includes("display: responsive ? { xs: 'flex', md: 'grid' } : 'grid'"), 'responsive shell must allocate the content and bottom navigation within the viewport')
  assert.equal(sharedWorkspaceShell.includes("xs: 'visible'"), false, 'the narrow shell must not introduce document scrolling')
  assert.equal(webApp.includes("height: { xs: 560, md: '100%' }"), false, 'Web Files must not retain a fixed mobile height')
  assert.equal(webFileExplorer.includes('minHeight: 420'), false, 'Web FileExplorer must be able to shrink in short mobile viewports')
  for (const legacy of ['.app-shell', '.topbar', '.file-manager-shell', '.files-workspace-surface']) {
    assert.equal(webStyles.includes(legacy), false, `Web shell layout must not stay in CSS: ${legacy}`)
  }
  assert.equal(webStyles.includes('.content-wrap'), false, 'Web must not retain local workspace-content layout CSS')
  assert.ok(sharedWorkspaceRoute.includes('export function xDriveWorkspacePresentation'), 'shared route model must own workspace presentation')
  assert.ok(webApp.includes('presentation={xDriveWorkspacePresentation(appView)}'), 'Web workspace must use shared route presentation')
  assert.ok(desktopApp.includes('presentation={xDriveWorkspacePresentation(view)}'), 'Desktop workspace must use shared route presentation')
  assert.equal(webApp.includes('<XDriveWorkspaceSurface presentation="page" title="文件">'), false, 'Files must not regain generic page chrome')
})

test('Viewer disables the retained Web workspace and compact navigation without remounting it', () => {
  assert.ok(webApp.includes('data-xdrive-workspace-background'), 'the retained workspace needs a background interaction boundary')
  assert.ok(webApp.includes("inert: viewerActive ? '' : undefined"), 'Viewer background must be inert, including keyboard navigation')
  assert.ok(webApp.includes('aria-hidden={viewerActive || undefined}'), 'Viewer background must leave the accessibility tree while covered')
  assert.ok(webApp.includes('disabled={viewerActive}'), 'the portalled More drawer must be closed/disabled while Viewer is active')
  assert.equal(/<XDriveWorkspace(?:Shell|Content)[^>]*\bkey=/s.test(webApp), false, 'route and breakpoint changes must not remount the workspace')
})
