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
const desktop = read('desktop/src/renderer/App.tsx')
const dsm = read('web/src/synology.tsx')
assert.ok(desktop.includes('<XDriveApp') && dsm.includes('<XDriveApp'),
  'Desktop and DSM must mount the same complete app frame')
assert.ok(sharedApp.includes('onSelect={onNavigate}') &&
  sharedApp.includes('xDriveWorkspaceNavigationAllowed(destination, host.adminRoleVerified === true)'),
  'the shared sidebar must not forward unknown or unverified admin routes')
assert.ok(sharedApp.includes('host.adminRoleVerified !== true'),
  'shared outlet must reject unverified administrative session')
assert.ok(sharedApp.includes('if (!page)'),
  'unimplemented DSM host operations must fail as unavailable, not silently succeed')
assert.ok(dsm.includes('<XDriveAppPageOutlet view={selected} host={host}'),
  'DSM must use shared route dispatch')
assert.ok(!dsm.includes('coreKeys='),
  'DSM must not maintain a reduced alternative navigation')
assert.ok(!/window\.xdriveDesktop|ipcRenderer/.test(dsm + sharedApp),
  'DSM/static common application must not invoke Electron IPC')
console.log('Unified Desktop/DSM routes, admin boundary and host-shell invariants verified')
