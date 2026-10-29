const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedNav = read('ui', 'shared', 'src', 'mui', 'SidebarNav.tsx')
const sharedModel = read('ui', 'shared', 'src', 'mui', 'WorkspaceNavigation.tsx')
const sharedRoute = read('ui', 'shared', 'src', 'mui', 'WorkspaceRoute.ts')
const routeTitles = read('ui', 'shared', 'src', 'mui', 'WorkspaceRouteTitles.ts')
const sharedSidebar = read('ui', 'shared', 'src', 'mui', 'WorkspaceSidebar.tsx')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const sharedApp = read('ui', 'shared', 'src', 'mui', 'XDriveApp.tsx')
const sharedHostOutlet = read('ui', 'shared', 'src', 'mui', 'XDriveAppPageOutlet.tsx')
const sharedHostSections = read('ui', 'shared', 'src', 'mui', 'WorkspaceHostSections.tsx')

test('shared core navigation owns common destinations and capability-gates local storage rendering', () => {
  assert.ok(sharedRoute.includes('export const XDRIVE_CORE_WORKSPACE_KEYS = ['), 'shared route model must own core workspace keys')
  assert.ok(sharedRoute.includes("export type XDriveCoreWorkspaceKey = typeof XDRIVE_CORE_WORKSPACE_KEYS[number]"), 'shared route model must derive the core workspace key union')
  assert.ok(sharedNav.includes('export function XDriveCoreWorkspaceNavItems'))
  assert.ok(sharedModel.includes('showLocalStorage = false'), 'local storage remains an explicit client capability even though Web and Desktop both opt in')
  assert.ok(sharedNav.includes('xDriveCoreWorkspaceDestinations({ transferBadge, showLocalStorage }).map'), 'sidebar and compact navigation must derive core destinations from the same model')
  assert.ok(
    sharedModel.includes("key: 'files', label: xDriveWorkspaceRouteTitle('files'), icon: <CloudOutlinedIcon fontSize=\"small\" />"),
    'Files should use a cloud icon rather than a local-folder glyph',
  )
  assert.ok(
    sharedModel.includes("key: 'cloud-storage', label: xDriveWorkspaceRouteTitle('cloud-storage'), icon: <CloudRoundedIcon fontSize=\"small\" />"),
    'Cloud Storage should keep a distinct filled cloud glyph',
  )
  assert.equal(sharedModel.includes('FolderRoundedIcon'), false, 'shared core Files navigation must not look like a local folder')
  // Labels are canonical in WorkspaceRouteTitles; the shared destination
  // model controls ordering, icons and capability-gated availability.
  const keys = [
    ["key: 'files'", "files: '文件'"],
    ["key: 'gallery'", "gallery: '图库'"],
    ["key: 'device-backup'", "'device-backup': '设备备份'"],
    ["key: 'remote-pull'", "'remote-pull': '远程拉取'"],
    ["key: 'transfers'", "transfers: '任务'"],
    ["key: 'local-storage' as const", "'local-storage': '本地存储'"],
    ["key: 'cloud-storage'", "'cloud-storage': '云端存储'"],
  ]
  let cursor = -1
  for (const [route, title] of keys) {
    const next = sharedModel.indexOf(route)
    assert.ok(next > cursor, `shared core navigation order missing or changed: ${route}`)
    assert.ok(routeTitles.includes(title), `canonical Chinese route title missing: ${title}`)
    cursor = next
  }
  assert.ok(sharedModel.includes('...(showLocalStorage'), 'local storage destination must remain capability-gated')
  assert.ok(sharedModel.includes('badge: transferBadge'), 'shared transfer destination must own the transfer badge slot')
})

test('shared sidebar exposes one destination, section and badge contract', () => {
  for (const token of [
    'export type XDriveSidebarBadgeValue = string | number',
    'export function XDriveSidebarBadge',
    "value > 99 ? '99+' : Math.floor(value)",
    'export type XDriveSidebarDestinationModel',
    "export type XDriveSidebarSectionPlacement = 'before-core' | 'after-core' | 'bottom'",
    'export type XDriveSidebarSectionModel',
    'placement?: XDriveSidebarSectionPlacement',
    'items: XDriveSidebarDestinationModel[]',
  ]) {
    assert.ok((sharedNav + sharedSidebar + sharedModel).includes(token), `shared sidebar contract missing: ${token}`)
  }
  assert.equal(sharedSidebar.includes('leadingItems'), false, 'complete sidebar should not keep a second extension API')
  assert.equal(sharedSidebar.includes('trailingItems'), false, 'complete sidebar should not keep a second extension API')
  assert.equal(sharedSidebar.includes('XDriveSidebarDestination ='), false, 'legacy destination alias should not remain exported')
  assert.equal(sharedSidebar.includes('XDriveWorkspaceSidebarSectionModel'), false, 'legacy section-model alias should not remain exported')
})

test('shared WorkspaceSidebar owns the complete sidebar composition and extension placement', () => {
  for (const token of [
    'export function XDriveWorkspaceSidebar',
    '<XDriveSidebarSurface',
    '<XDriveSidebarNavList',
    '<XDriveCoreWorkspaceNavItems',
    '<XDriveSidebarSection',
    '<XDriveSidebarStorageSummary',
    "sectionPlacement(section) === 'before-core'",
    "sectionPlacement(section) === 'after-core'",
    "sectionPlacement(section) === 'bottom'",
    'beforeCoreInlineItems.map',
    'afterCoreInlineItems.map',
    'bottomSections.map',
    'showLocalStorage={showLocalStorage}',
    "mt: bottomSections.length > 0 ? 0 : 'auto'",
  ]) {
    assert.ok(sharedSidebar.includes(token), `shared WorkspaceSidebar missing: ${token}`)
  }
})

test('Web and Desktop consume the same shared WorkspaceSidebar', () => {
  assert.equal((web.match(/<XDriveWorkspaceSidebar\b/g) || []).length, 1)
  assert.equal((desktop.match(/<XDriveApp\b/g) || []).length, 1)
  assert.equal((sharedApp.match(/<XDriveWorkspaceSidebar\b/g) || []).length, 1)
  assert.ok(sharedApp.includes('selected={view}') && sharedApp.includes('onSelect={onNavigate}'), 'one shared frame must own selection and navigation')
  for (const token of [
    '<XDriveSidebarSurface',
    '<XDriveSidebarNavList',
    '<XDriveCoreWorkspaceNavItems',
    '<XDriveSidebarSection',
    '<XDriveSidebarStorageSummary',
  ]) {
    assert.equal(web.includes(token), false, `Web must not assemble sidebar primitive directly: ${token}`)
    assert.equal(desktop.includes(token), false, `Desktop must not assemble sidebar primitive directly: ${token}`)
  }
  for (const label of [
    'primary="文件"',
    'primary="图库"',
    'primary="同步文件夹"',
    'primary="传输"',
    'primary="本地存储"',
    'primary="云端存储"',
  ]) {
    assert.equal(web.includes(label), false, `Web must not duplicate shared core label: ${label}`)
    assert.equal(desktop.includes(label), false, `Desktop must not duplicate shared core label: ${label}`)
  }
})

test('Desktop and DSM derive extension routes from one shared Host sections factory', () => {
  assert.ok(desktop.includes('const desktopSidebarSections: XDriveSidebarSectionModel[] = xDriveWorkspaceHostSections({'))
  assert.ok(desktop.includes("adminRoleVerified: status?.role === 'admin'"))
  assert.ok(desktop.includes('conflictCount: status?.conflict_count'))
  assert.ok(desktop.includes("diagnosticsAriaLabel: '桌面版辅助功能'"))
  assert.ok(desktop.includes('sections: desktopSidebarSections,') && sharedApp.includes('{...sidebar}'))
  for (const [key, label] of [
    ['overview', '主页'], ['conflicts', '冲突'], ['admin-users', '用户管理'],
    ['admin-audit', '审计日志'], ['admin-storage', '全局存储'],
    ['admin-services', '系统依赖'], ['admin-maintenance', '备份与系统维护'],
  ]) {
    assert.ok(sharedHostSections.includes("key: '" + key + "'") &&
      sharedHostSections.includes("label: xDriveWorkspaceRouteTitle('" + key + "')") &&
      routeTitles.includes((key === 'overview' || key === 'conflicts' ? key : "'" + key + "'") +
        ": '" + label + "'"), key)
  }
  assert.ok(sharedHostSections.includes('badge: conflictCount'))
  assert.ok(sharedHostSections.includes('items: [xDriveDiagnosticsSidebarDestination()]'))
  assert.ok(sharedHostSections.includes("key: 'settings'") &&
    sharedHostSections.includes('items: [xDriveSettingsSidebarDestination()]'))
  assert.ok(desktop.includes("if (destination === 'settings')") &&
    desktop.includes('setSettingsOpen(true)'), 'Desktop must open actual Settings dialog')
  assert.equal(desktop.includes('leadingItems='), false)
  assert.equal(desktop.includes('trailingItems='), false)
})

test('Web Home and admin destinations use the canonical Host sections and route titles', () => {
  assert.ok(web.includes('const webSidebarSections = xDriveWorkspaceHostSections({'))
  assert.ok(web.includes("adminRoleVerified: profile?.role === 'admin'"))
  assert.ok(web.includes('includeUtilityRoutes: false'))
  assert.ok(sharedHostSections.includes("key: 'overview'"))
  assert.ok(sharedHostSections.includes("placement: 'before-core'"))
  assert.ok(routeTitles.includes("overview: '主页'"))
  assert.ok(sharedHostSections.includes("ariaLabel: '管理员功能'"))
  for (const [key, label] of [
    ['admin-users', '用户管理'], ['admin-audit', '审计日志'],
    ['admin-storage', '全局存储'], ['admin-services', '系统依赖'],
    ['admin-maintenance', '备份与系统维护'],
  ]) {
    assert.ok(sharedHostSections.includes("key: '" + key + "'"), key)
    assert.ok(routeTitles.includes("'" + key + "': '" + label + "'"), key)
  }
})

test('Backup and maintenance navigation stays identical across Web/Desktop/DSM', () => {
  assert.ok(web.includes('xDriveWorkspaceHostSections({'))
  assert.ok(routeTitles.includes("'admin-maintenance': '备份与系统维护'"))
  assert.ok(sharedHostSections.includes("key: 'admin-maintenance'"))
  assert.ok(sharedHostSections.includes("label: xDriveWorkspaceRouteTitle('admin-maintenance')"))
  assert.ok(desktop.includes('xDriveWorkspaceHostSections({'))
})

test('Host-specific admin links only render after actual Server administrator verification', () => {
  assert.equal(sharedModel.includes("key: 'global-tasks'"), false)
  assert.equal(sharedNav.includes('showGlobalTasks'), false)
  assert.equal(sharedSidebar.includes('showGlobalTasks'), false)
  const begin = web.indexOf('const webSidebarSections = xDriveWorkspaceHostSections({')
  const end = web.indexOf(String.fromCharCode(10) + '  })', begin)
  assert.ok(begin >= 0 && end > begin)
  const webSections = web.slice(begin, end)
  assert.ok(webSections.includes("adminRoleVerified: profile?.role === 'admin'"))
  assert.ok(webSections.includes('includeUtilityRoutes: false'))
  const adminIndex = sharedHostSections.indexOf("key: 'admin'")
  const globalIndex = sharedHostSections.indexOf("key: 'global-tasks'", adminIndex)
  const diagIndex = sharedHostSections.indexOf("key: 'diagnostics'")
  assert.ok(diagIndex >= 0 && adminIndex > diagIndex && globalIndex > adminIndex)
  assert.ok(sharedHostSections.includes('...(adminRoleVerified ? ['))
  assert.equal((sharedHostSections.match(/key: 'global-tasks'/g) || []).length, 1)
  assert.ok(sharedHostSections.includes("ariaLabel: '管理员功能'"))
  assert.ok(desktop.includes("adminRoleVerified: status?.role === 'admin'"))
})

test('local storage is shared across Web and Desktop while platform adapters remain local', () => {
  assert.ok(desktop.includes("type View = XDriveWorkspaceAppRoute"), 'Desktop view type must extend the shared full workspace route model')
  assert.ok(sharedRoute.includes("'local-storage'"), 'Web view type must include the shared local-storage route')
  assert.ok(sharedRoute.includes("export type XDriveRemoteWorkspaceKey = Exclude<XDriveCoreWorkspaceKey, 'local-storage'>"), 'remote-only route type may remain available for non-local clients')
  assert.ok(desktop.includes('showLocalStorage'), 'Desktop must expose the shared local-storage destination')
  assert.ok(web.includes('showLocalStorage'), 'Web must expose the shared local-storage destination')
  assert.ok(desktop.includes('localStorage: localStorageSource') &&
    sharedHostOutlet.includes('<XDriveLocalStoragePage'),
    'Desktop Host must delegate real Local Storage data to common outlet')
  assert.ok(web.includes('localStorage: localStorageSource') &&
    web.includes("<XDriveAppPageOutlet host={browserWorkspaceHost} view={appView} />"),
    'Web Host must delegate real Local Storage to the common outlet')
  assert.ok(desktop.includes('cloudStorage: cloudStorageSource') &&
    sharedHostOutlet.includes('<XDriveCloudStoragePage'),
    'Desktop Host must delegate real Cloud Storage data to common outlet')
  assert.ok(web.includes('cloudStorage: cloudStorageSource') &&
    web.includes("<XDriveAppPageOutlet host={browserWorkspaceHost} view={appView} />"),
    'Web Host must delegate real Cloud Storage to the common outlet')
})

test('Desktop Files routing uses the shared files key directly', () => {
  assert.ok(desktop.includes("type View = XDriveWorkspaceAppRoute"), 'Desktop must use the shared workspace route key directly')
  assert.equal(desktop.includes("view === 'cloud'"), false, 'legacy cloud view key must be removed')
  assert.equal(desktop.includes("setView('cloud')"), false, 'legacy cloud navigation must be removed')
  assert.ok(desktop.includes('view={view}') && sharedApp.includes('selected={view}'), 'Desktop shared app must select the real workspace view directly')
  assert.ok(desktop.includes("onNavigate={(destination) => {") && sharedApp.includes('onSelect={onNavigate}'), 'Desktop navigation must reach the shared sidebar handler')
  assert.ok(desktop.includes("setView(destination as View)"), 'Desktop shared sidebar should route directly')
  assert.ok(desktop.includes("setSystemDependenciesNavigationResetKey((value) => value + 1)"),
    'system dependencies entry must reset to overview without changing the global App Frame')
})
