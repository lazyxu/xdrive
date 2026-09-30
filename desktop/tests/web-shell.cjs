const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const webApp = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'App.tsx'), 'utf8')
const desktopApp = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'App.tsx'), 'utf8')
const sharedSidebar = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SidebarNav.tsx'), 'utf8')
const sharedStorageSummary = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'SidebarStorageSummary.tsx'), 'utf8')
const sharedWorkspace = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'WorkspaceSurface.tsx'), 'utf8')
const sharedAccount = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'AccountChrome.tsx'), 'utf8')
const sharedBrand = fs.readFileSync(path.join(repoRoot, 'ui', 'shared', 'src', 'mui', 'BrandLockup.tsx'), 'utf8')
const adminUsers = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'AdminUsers.tsx'), 'utf8')
const adminAudit = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'AdminAudit.tsx'), 'utf8')
const storageStats = fs.readFileSync(path.join(repoRoot, 'web', 'src', 'StorageStatsPanel.tsx'), 'utf8')

test('Web AppBar keeps global chrome compact while admin tools live in the sidebar', () => {
  const appStart = webApp.indexOf('<AppBar position="static" elevation={1}>', webApp.indexOf('className="app-shell"'))
  const appEnd = webApp.indexOf('</AppBar>', appStart)
  assert.notEqual(appStart, -1, 'missing Web AppBar')
  assert.notEqual(appEnd, -1, 'missing Web AppBar end')
  const appBar = webApp.slice(appStart, appEnd)

  assert.ok(appBar.includes('WebAccountMenu'), 'Web AppBar must retain the account menu')
  assert.equal(appBar.includes('用户管理'), false, 'User Management should not remain in the AppBar')
  assert.equal(appBar.includes('审计日志'), false, 'Audit should not remain in the AppBar')
  assert.equal(appBar.includes('全局存储'), false, 'Global Storage should not remain in the AppBar')

  const asideStart = webApp.indexOf('component="aside"')
  const asideEnd = webApp.indexOf('component="main"', asideStart)
  assert.notEqual(asideStart, -1, 'missing Web sidebar')
  assert.notEqual(asideEnd, -1, 'missing Web main content after sidebar')
  const sidebar = webApp.slice(asideStart, asideEnd)

  assert.ok(sidebar.includes("profile?.role === 'admin'"), 'admin navigation must remain role-gated')
  assert.ok(sidebar.includes('ariaLabel="管理员功能"'), 'missing admin navigation landmark')
  for (const label of ['管理', '用户管理', '审计日志', '全局存储']) {
    assert.ok(sidebar.includes(label), `missing admin sidebar label: ${label}`)
  }
  assert.ok(sidebar.includes('ManageAccountsRoundedIcon'), 'missing User Management icon')
  assert.ok(sidebar.includes('AssessmentRoundedIcon'), 'missing Audit icon')
  assert.ok(sidebar.includes("selected={appView === 'admin-users'}"), 'User Management should expose selected page state')
  assert.ok(sidebar.includes("selected={appView === 'admin-audit'}"), 'Audit should expose selected page state')
  assert.ok(sidebar.includes("selected={appView === 'admin-storage'}"), 'Global Storage should expose selected page state')
  assert.ok(sidebar.includes("setAppView('admin-users')"), 'User Management should navigate to a page')
  assert.ok(sidebar.includes("setAppView('admin-audit')"), 'Audit should navigate to a page')
  assert.ok(sidebar.includes("setAppView('admin-storage')"), 'Global Storage should navigate to a page')
})


test('Web first-class workspaces share the same page chrome', () => {
  assert.ok(webApp.includes('XDriveWorkspaceSurface'), 'Web app should reuse the shared workspace surface')
  assert.ok(webApp.includes('<XDriveWorkspaceSurface presentation="page" title="文件">'), 'Files page title must use workspace page chrome')
  assert.ok(webApp.includes('<XDriveWorkspaceSurface presentation="page" title="图库">'), 'Gallery page title must use workspace page chrome')
  assert.ok(webApp.includes('<ExternalSourcesPanel'), 'External Sources should remain a first-class page')
  assert.ok(webApp.includes('<StorageStatsPanel') && webApp.includes('scope="self"'), 'Storage should remain a first-class page')
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
  assert.ok(adminUsers.includes('minWidth: 900'), 'User Management table should avoid unnecessary wide-screen scrolling')
  assert.ok(adminUsers.includes("display: { xs: 'none', xl: 'table-cell' }"), 'User Management should collapse lower-priority columns below xl')
  assert.ok(adminAudit.includes('minWidth: 880'), 'Audit table should keep its core columns compact')
  assert.ok(adminAudit.includes('审计事件详情'), 'Audit should move source and metadata into a local detail dialog')
  assert.ok(adminAudit.includes('setDetailEvent(event)'), 'Audit table should expose a details action')
  assert.ok(adminAudit.includes('detailEvent.request_id'), 'Audit details should preserve request identifiers')
  assert.ok(adminAudit.includes('metadataText(detailEvent.metadata)'), 'Audit details should preserve metadata')
})

test('Web and Desktop shell primitives live in shared MUI', () => {
  assert.ok(sharedSidebar.includes('XDriveSidebarNavList'), 'shared sidebar list primitive is missing')
  assert.ok(sharedSidebar.includes('XDriveSidebarNavItem'), 'shared sidebar item primitive is missing')
  assert.ok(sharedSidebar.includes('XDriveSidebarSection'), 'shared sidebar section primitive is missing')
  assert.ok(sharedSidebar.includes('XDRIVE_SIDEBAR_WIDTH = 184'), 'shared sidebar width token is missing')
  assert.ok(sharedSidebar.includes('XDRIVE_SIDEBAR_COMPACT_WIDTH = 176'), 'shared compact sidebar width token is missing')
  assert.ok(sharedStorageSummary.includes('XDriveSidebarStorageSummary'), 'shared sidebar storage summary is missing')
  assert.ok(sharedStorageSummary.includes('physical') === false, 'shared storage summary should remain presentation-only')
  assert.ok(sharedWorkspace.includes('XDriveWorkspaceSurface'), 'shared workspace surface is missing')
  assert.ok(sharedWorkspace.includes('subtitle={subtitle}'), 'shared workspace page subtitle plumbing is missing')
  assert.ok(sharedWorkspace.includes('actions={pageActions}'), 'shared workspace page actions plumbing is missing')
  assert.ok(sharedAccount.includes('XDriveAccountAvatarButton'), 'shared account avatar trigger is missing')
  assert.ok(sharedAccount.includes('XDriveAccountSummary'), 'shared account summary is missing')
  assert.ok(sharedAccount.includes('XDriveAccountMenu'), 'shared account menu container is missing')
  assert.ok(sharedBrand.includes('XDriveBrandLockup'), 'shared brand lockup is missing')
  assert.ok(webApp.includes('XDriveBrandLockup'), 'Web should consume shared brand lockup')
  assert.ok(webApp.includes('XDriveSidebarNavItem'), 'Web should consume shared sidebar navigation')
  assert.ok(webApp.includes('<XDriveSidebarSection label="管理" responsive>'), 'Web admin navigation should use shared sidebar section chrome')
  assert.ok(desktopApp.includes('<XDriveSidebarSection appearance="dark" pinnedBottom>'), 'Desktop diagnostics should use shared sidebar section chrome')
  assert.ok(webApp.includes('XDriveSidebarStorageSummary'), 'Web should consume shared sidebar storage summary')
  assert.ok(desktopApp.includes('XDriveSidebarStorageSummary'), 'Desktop should consume shared sidebar storage summary')
  assert.ok(webApp.includes('XDriveAccountAvatarButton'), 'Web should consume shared account chrome')
  assert.ok(webApp.includes('XDriveAccountMenu'), 'Web should consume the shared account menu container')
})

test('Web and Desktop show account storage usage at the bottom of the sidebar', () => {
  assert.ok(sharedStorageSummary.includes("label = '存储空间'"), 'shared storage summary should use Chinese storage label')
  assert.ok(sharedStorageSummary.includes('formatBinarySize(boundedUsed)'), 'shared storage summary should show used capacity')
  assert.ok(sharedStorageSummary.includes("formatBinarySize(boundedTotal) : '不限'"), 'shared storage summary should show total capacity or unlimited quota')
  assert.ok(sharedStorageSummary.includes('percentageLabel'), 'shared storage summary should show quota percentage when available')
  assert.ok(sharedStorageSummary.includes("warningQuota"), 'shared storage summary should distinguish near-full quota')
  assert.ok(sharedStorageSummary.includes("'空间紧张'"), 'shared storage summary should label near-full quota')
  assert.ok(sharedStorageSummary.includes("'已用满'"), 'shared storage summary should label full quota')
  assert.ok(sharedStorageSummary.includes("'已超额'"), 'shared storage summary should label over-quota usage')
  assert.ok(sharedStorageSummary.includes("'warning.light'"), 'dark sidebar should keep near-full quota readable')
  assert.ok(sharedStorageSummary.includes("'error.light'"), 'dark sidebar should keep full quota readable')
  assert.ok(sharedStorageSummary.includes('<LinearProgress'), 'shared storage summary should show quota progress')

  assert.ok(webApp.includes('usedBytes={quota.physical_used_bytes}'), 'Web sidebar should use current account physical usage')
  assert.ok(webApp.includes('totalBytes={quota.quota_bytes}'), 'Web sidebar should use current account quota')
  assert.equal(webApp.includes('secondary={quota ?'), false, 'Web Storage nav item should not duplicate quota text')
  assert.ok(webApp.includes('void api.quota()'), 'Web should refresh sidebar quota outside manual file actions')
  assert.ok(webApp.includes("height: { md: 'calc(100vh - 64px)' }"), 'Web desktop shell should keep the sidebar viewport-height')
  assert.ok(webApp.includes("overflowY: { md: 'auto' }"), 'Web desktop content should scroll without pushing sidebar footer away')

  assert.ok(desktopApp.includes('usedBytes={cloudQuota.physical_used_bytes}'), 'Desktop sidebar should use cloud account physical usage')
  assert.ok(desktopApp.includes('totalBytes={cloudQuota.quota_bytes}'), 'Desktop sidebar should use cloud account quota')
  assert.ok(desktopApp.includes('window.setInterval(() => void refresh(), 60_000)'), 'Desktop should keep sidebar quota reasonably fresh')
})
