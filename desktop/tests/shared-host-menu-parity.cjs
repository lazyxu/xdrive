'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('Web, DSM and Desktop share the same server-role-gated sidebar definitions', () => {
  const sections = read('ui/shared/src/mui/WorkspaceHostSections.tsx')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  const synology = read('web/src/synology.tsx')

  assert.match(sections, /export function xDriveWorkspaceHostSections/)
  assert.match(sections, /adminRoleVerified = false/)
  assert.match(sections, /includeUtilityRoutes = true/)
  assert.match(sections, /adminRoleVerified \? \[/)
  assert.match(sections, /includeUtilityRoutes \? \[/)
  assert.match(web, /xDriveWorkspaceHostSections\(\{\s*adminRoleVerified: profile\?\.role === 'admin',\s*includeUtilityRoutes: false,/)
  assert.doesNotMatch(web, /const webSidebarSections: XDriveSidebarSectionModel/)
  assert.doesNotMatch(web, /icon: <ManageAccountsRoundedIcon/)
  assert.match(desktop, /xDriveWorkspaceHostSections\(/)
  assert.match(synology, /xDriveWorkspaceHostSections\(/)
  assert.match(web, /<XDriveWorkspaceSidebar\b/)
})

test('Browser menu omission cannot grant route or native capabilities', () => {
  const sections = read('ui/shared/src/mui/WorkspaceHostSections.tsx')
  const web = read('web/src/App.tsx')
  const route = read('ui/shared/src/mui/WorkspaceRoute.ts')

  assert.match(web, /profile\?\.role === 'admin'/)
  assert.match(route, /view === 'global-tasks' \|\| view\.startsWith\('admin-'\)/)
  assert.match(route, /xDriveWorkspaceNavigationAllowed/)
  assert.match(sections, /includeUtilityRoutes = true/)
  assert.match(web, /xDriveWebAppRouteForWorkspaceKey/)
  assert.match(web, /xDriveSystemDependenciesNeedsExitConfirmation/)
})
