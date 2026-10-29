'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Electron Desktop and authenticated DSM mount one canonical React workspace', () => {
  const desktop = read('desktop/src/renderer/App.tsx')
  const dsm = read('web/src/synology.tsx')
  const app = read('ui/shared/src/mui/XDriveApp.tsx')
  const outlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
  const routes = read('ui/shared/src/mui/WorkspaceRoute.ts')

  assert.match(desktop, /<XDriveApp\b/, 'Desktop must mount the real shared application')
  assert.match(dsm, /<XDriveApp\b/, 'DSM must mount the same shared application')
  assert.match(app, /<XDriveWorkspaceShell\b/)
  assert.match(app, /<XDriveWorkspaceSidebar\b/)
  assert.match(app, /<XDriveAppRouteContent\b/)
  assert.match(outlet, /switch \(view\)/)
  assert.match(routes, /XDRIVE_APP_WORKSPACE_ROUTES/)
  assert.match(outlet, /host\.adminRoleVerified !== true/,
    'Server administrator role must stay authoritative')
})

test('Web/PWA use the same workspace primitives and canonical route vocabulary', () => {
  const web = read('web/src/App.tsx')
  const main = read('web/src/main.tsx')
  const bridge = read('ui/shared/src/web-workspace-route.ts')

  // Forward-compatible: when Web eventually migrates to XDriveApp, replace
  // its transitional local shell rather than nesting two application frames.
  const directApp = /<XDriveApp\b/.test(web)
  const sharedShell = /<XDriveWorkspaceShell\b/.test(web) &&
    /<XDriveWorkspaceSidebar\b/.test(web)
  assert.ok(directApp || sharedShell,
    'Web must use the common application or shared MUI workspace components')
  assert.match(web, /WebFileExplorer/)
  assert.match(main, /registerXDrivePwa\(\)/)
  assert.match(bridge, /xDriveIsWorkspaceAppRoute/)
  assert.match(bridge, /global-tasks/)
})

test('unsupported DSM operations remain explicit, with no fabricated permissions', () => {
  const dsmHost = read('web/src/synologyHost.ts')
  const adapter = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')
  const outlet = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')

  assert.match(dsmHost, /platform: 'synology'/)
  assert.match(dsmHost, /ownerFilesPage:\s*\{/)
  assert.match(dsmHost, /unavailableActions:\s*\{/)
  assert.match(adapter, /readonly diagnosticsSource\?/)
  assert.match(outlet, /host\.unavailableMessage\?\./)
  assert.match(outlet, /host\.adminRoleVerified !== true/)
})

test('iOS uses a WKWebView shell; Android uses Compose and generated design tokens', () => {
  const ios = read('ios/XDriveIOS/XDriveWebAppHome.swift')
  const android = read('android/app/src/main/java/com/tfluid/xdrive/MainActivity.kt')
  const visuals = read('android/scripts/shared-ui.mjs')

  assert.match(ios, /WKWebView\(/)
  assert.match(ios, /WKWebViewConfiguration\(/)
  assert.match(android, /\bsetContent\s*\{/)
  assert.match(visuals, /ui\/shared\/src\/mui\/theme\.ts/)
  assert.match(visuals, /web\/src\/MobileFiles\.tsx/)
})

test('shared Files plans do not replace native backup or cloud-drive ownership', () => {
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const web = read('web/src/WebFileExplorer.tsx')
  const mount = read('desktop/src/renderer/DesktopVirtualDriveSettings.tsx')
  const backup = read('ui/shared/src/device-backup-local-feature-access.ts')

  for (const source of [desktop, web]) {
    assert.match(source, /xDriveFileExplorerSelectionRequest/)
    assert.match(source, /xDriveFileExplorerPreviewRequest/)
    assert.match(source, /xDriveFileExplorerReadNodeID/)
  }
  assert.match(mount, /CfAPI/)
  assert.match(mount, /FUSE/)
  assert.match(backup, /currentLocalDevice/)
  assert.doesNotMatch(backup, /window\.xdriveDesktop|fetch\s*\(/)
})

test('README, architecture and AGENTS describe actual master status, not full parity', () => {
  const readme = read('README.md')
  const architecture = read('docs/architecture/xdrive-all-platform-ui.md')
  const rules = read('AGENTS.md')

  assert.match(readme, /\]\(docs\/architecture\/xdrive-all-platform-ui\.md\)/)
  assert.match(readme, /Architecture adopted; migration in progress/)
  assert.match(architecture, /Web still has its own top-level app controller/)
  assert.match(architecture, /Native app uses the same Server\/domain contract, not React JSX/)
  assert.match(rules, /docs\/architecture\/xdrive-all-platform-ui\.md/)
  assert.match(rules, /Desktop\/DSM mount the same/)
})
