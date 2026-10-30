'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')

test('the Web workspace background route is now retained by the shared Host-neutral hook', () => {
  const nav = read('ui/shared/src/mui/WorkspaceNavigationState.ts')
  const app = read('web/src/App.tsx')
  const route = read('ui/shared/src/mui/WorkspaceRoute.ts')
  assert.match(nav, /export function useXDriveRetainedWorkspaceRoute/)
  assert.match(nav, /useLayoutEffect\(\(\) => \{/)
  assert.match(nav, /if \(!current\) return/)
  assert.match(nav, /previous === current \? previous : current/)
  assert.match(nav, /return current \?\? retained/)
  assert.match(app, /useXDriveRetainedWorkspaceRoute\(workspaceRouteKey\)/)
  assert.doesNotMatch(app, /lastWorkspaceView|setLastWorkspaceView|XDriveWorkspaceViewKey/)
  assert.match(app, /XDriveWorkspaceAppRoute as AppView/)
  assert.match(app, /xDriveWebAppWorkspaceKey\(route\.app, route\.params\)/)
  assert.match(app, /xDriveWebAppViewer\(route\.app\)/)
  assert.match(app, /xDriveAcquireViewerForeground/)
  assert.match(route, /XDRIVE_APP_WORKSPACE_ROUTES/)
})

test('Browser route descriptors share canonical labels while preserving legacy viewers', () => {
  const apps = read('web/src/webApps.ts')
  const app = read('web/src/App.tsx')
  for (const key of ['overview','files','gallery','device-backup','remote-pull','transfers',
    'local-storage','cloud-storage','admin-users','admin-audit','admin-storage',
    'admin-services','admin-maintenance']) {
    assert.ok(apps.includes("xDriveWorkspaceRouteTitle('" + key + "')"), key)
  }
  assert.match(apps, /'sync-folders': \{ id: 'sync-folders', title: '同步文件夹'/)
  assert.match(apps, /'media-viewer': \{ id: 'media-viewer', title: '媒体查看器'/)
  assert.match(app, /title=\{mobileRouteTitle\}/,
    'mobile header must select the active feature-local title')
  assert.match(app, /mobileMapFocused \? '地图' : xDriveWorkspaceRouteTitle\(appView\)/,
    'ordinary destinations still use the shared canonical title catalog')
  assert.match(app, /!xDriveWorkspaceNavigationAllowed\(appView, profile\.role === 'admin'\)/)
  assert.match(app, /xDriveSystemDependenciesNeedsExitConfirmation/)
  assert.match(app, /data-xdrive-pwa-upload-resume-picker/)
})
