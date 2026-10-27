#!/usr/bin/env node
// Route and access-boundary regression tests for the unified Desktop/DSM UI.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (name) => fs.readFileSync(new URL(name, new URL('../../', import.meta.url)), 'utf8')
const routeSource = read('ui/shared/src/mui/WorkspaceRoute.ts')
// The route module has only a type import; use Node's built-in TS stripping so
// this test exercises its real exported predicates, not a regex simulation.
const routeCode = stripTypeScriptTypes(routeSource, { mode: 'strip' })
const routes = await import('data:text/javascript,' + encodeURIComponent(routeCode))
const expectedCore = [
  'files', 'gallery', 'device-backup', 'remote-pull', 'transfers',
  'global-tasks', 'local-storage', 'cloud-storage',
]
const expectedExtra = [
  'overview', 'conflicts', 'diagnostics',
  'admin-users', 'admin-audit', 'admin-storage',
  'admin-services', 'admin-maintenance',
]
const registered = [...routes.XDRIVE_APP_WORKSPACE_ROUTES]
assert.equal(new Set(registered).size, registered.length, 'no duplicate navigation routes')
for (const key of [...expectedCore, ...expectedExtra]) {
  assert.ok(routes.xDriveIsWorkspaceAppRoute(key), 'missing Desktop route: ' + key)
}
for (const bogus of ['', 'settings', 'legacy', '__proto__', 'admin-unrestricted', 'gallery/../admin-users']) {
  assert.equal(routes.xDriveIsWorkspaceAppRoute(bogus), false, 'unexpected application route: ' + bogus)
}
for (const key of ['global-tasks', 'admin-users', 'admin-audit', 'admin-storage', 'admin-services', 'admin-maintenance']) {
  assert.equal(routes.xDriveWorkspaceRouteRequiresAdmin(key), true, 'must require Server admin: ' + key)
}
for (const key of ['overview', ...expectedCore.filter(x => x !== 'global-tasks'), 'conflicts', 'diagnostics']) {
  assert.equal(routes.xDriveWorkspaceRouteRequiresAdmin(key), false, 'ordinary Owner route should be visible: ' + key)
}

// Verify actual exported route logic against anonymous and Server-admin roles.
for (const key of registered) {
  assert.equal(routes.xDriveWorkspaceNavigationAllowed(key, true), true,
    'Server admin must reach registered page: ' + key)
  assert.equal(routes.xDriveWorkspaceNavigationAllowed(key, false),
    !routes.xDriveWorkspaceRouteRequiresAdmin(key),
    'anonymous/non-admin must not navigate to privileged page: ' + key)
}
assert.equal(routes.xDriveWorkspaceNavigationAllowed('settings', false), true)
for (const bogus of ['', '__proto__', 'gallery/../admin-users', 'admin-typo']) {
  assert.equal(routes.xDriveWorkspaceNavigationAllowed(bogus, true), false,
    'unknown routes must fail closed: ' + bogus)
}

const sharedApp = read('ui/shared/src/mui/XDriveApp.tsx')
const sharedOutlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
const hostContract = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')
const desktop = read('desktop/src/renderer/App.tsx')
const dsm = read('web/src/synology.tsx')
assert.ok(desktop.includes('<XDriveApp') && dsm.includes('<XDriveApp'),
  'Desktop and DSM must mount the same complete app frame')
assert.ok(sharedApp.includes('onSelect={onNavigate}') &&
  sharedApp.includes('xDriveWorkspaceNavigationAllowed(destination, host.adminRoleVerified === true)'),
  'the shared sidebar must not forward unknown or unverified admin routes')
assert.ok(sharedOutlet.includes('host.adminRoleVerified !== true'),
  'shared outlet must reject unverified administrative session')
assert.ok(sharedOutlet.includes('if (!page)'),
  'unimplemented DSM host operations must fail as unavailable, not silently succeed')
assert.ok(dsm.includes('<XDriveAppPageOutlet view={selected} host={host}'),
  'DSM must use shared route dispatch')
assert.ok(!dsm.includes('pages: {') && !dsm.includes('<XDriveHomePage') &&
  !dsm.includes('<XDriveDeviceBackupPage'),
  'DSM provides domain ports and no independent page JSX')
assert.ok(dsm.includes('services: {') && hostContract.includes('XDriveWorkspaceHostServices') &&
  sharedOutlet.includes('switch (view)') && sharedOutlet.includes('services.deviceBackups'),
  'shared page outlet composes pages using authenticated host data')
assert.ok(!dsm.includes('coreKeys='),
  'DSM must not maintain a reduced alternative navigation')
for (const key of [
  'gallery', 'device-backup', 'remote-pull', 'transfers', 'global-tasks',
  'local-storage', 'cloud-storage',
  'admin-maintenance', 'admin-users', 'admin-audit',
  'admin-storage', 'admin-services',
  'conflicts', 'diagnostics',
]) {
  assert.equal(routes.xDriveIsSharedHostPageRoute(key), true,
    'Desktop common outlet must dispatch: ' + key)
}
assert.ok(desktop.includes('xDriveIsSharedHostPageRoute(view)') &&
  desktop.includes('<XDriveAppPageOutlet view={view} host={workspaceHost} />'),
  'Desktop must mount the same page outlet as DSM for migrated routes')
assert.ok(desktop.includes('galleryPage: {') &&
  desktop.includes('taskCenterPage: {') &&
  desktop.includes('deviceBackupPage: {') &&
  desktop.includes('remotePullPage:'),
  'Desktop Host must inject page props, not alternate React page factories')
assert.ok(sharedOutlet.includes('<XDriveMediaGalleryPage {...services.galleryPage} />') &&
  sharedOutlet.includes('<XDriveSourceManager {...services.remotePullPage} />') &&
  sharedOutlet.includes('<XDriveTaskCenterPage'),
  'Gallery, Pull and Tasks must render in common UI code')
for (const pair of [
  ['adminMaintenancePage', 'XDriveSystemMaintenancePage'],
  ['adminUsersPage', 'XDriveAdminUsersPage'],
  ['adminAuditPage', 'XDriveAdminAuditPage'],
  ['adminStoragePage', 'XDriveGlobalStorageStatsPage'],
  ['adminServicesPage', 'XDriveServiceDependenciesPage'],
]) {
  const [port, name] = pair
  assert.ok(desktop.includes(port + ': status?.role ===') &&
    sharedOutlet.includes('<' + name + ' {...services.' + port + '} />'),
    'Server admin route must render the shared component with an admin-scoped Host port: ' + port)
}
assert.ok(sharedOutlet.includes('host.adminRoleVerified !== true'),
  'privileged UI route must fail closed when not Server verified')
assert.equal(desktop.includes('<XDriveMediaGalleryPage'), false)
assert.equal(desktop.includes('<XDriveSourceManager'), false)
assert.equal(desktop.includes('<XDriveTaskCenterPage'), false)
assert.ok(desktop.includes('conflictsPage: {') && desktop.includes('diagnosticsPage: {') &&
  sharedOutlet.includes('<XDriveConflictsPage') && sharedOutlet.includes('<XDriveDiagnosticsPage'),
  'Conflicts and Diagnostics must use the same shared React/MUI outlet')
assert.equal(desktop.includes('<DesktopConflictsPage'), false)
assert.equal(desktop.includes('<DesktopDiagnosticsPage'), false)
assert.ok(!/window\.xdriveDesktop|ipcRenderer/.test(dsm + sharedApp + sharedOutlet),
  'DSM/static common application must not invoke Electron IPC')
console.log('Unified Desktop/DSM routes, admin boundary and host-shell invariants verified')
