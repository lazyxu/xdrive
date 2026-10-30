'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('canonical route catalog has exactly one title for each workspace destination', () => {
  const routes = read('ui/shared/src/mui/WorkspaceRoute.ts')
  const titles = read('ui/shared/src/mui/WorkspaceRouteTitles.ts')
  const ids = [
    'overview', 'files', 'gallery', 'device-backup', 'remote-pull',
    'transfers', 'global-tasks', 'local-storage', 'cloud-storage',
    'conflicts', 'diagnostics', 'admin-users', 'admin-audit',
    'admin-storage', 'admin-services', 'admin-maintenance',
  ]
  assert.match(routes, /XDRIVE_APP_WORKSPACE_ROUTES/)
  assert.match(titles, /satisfies Readonly<Record<XDriveWorkspaceAppRoute, string>>/)
  const matches = [...titles.matchAll(/^  (?:'([^']+)'|([a-z]+)): '([^']+)',?$/gm)]
  const labels = new Map(matches.map(([, dash, plain, label]) => [dash || plain, label]))
  assert.equal(labels.size, ids.length)
  for (const id of ids) {
    assert.ok(labels.has(id), 'Missing canonical title for ' + id)
    assert.ok(labels.get(id).length > 0)
  }
  assert.match(titles, /xDriveIsWorkspaceAppRoute\(route\)/)
  assert.match(titles, /fallback = 'xDrive'/)
})

test('Desktop/DSM and Web/PWA consume canonical titles without a duplicate mobile map', () => {
  const core = read('ui/shared/src/mui/WorkspaceNavigation.tsx')
  const host = read('ui/shared/src/mui/WorkspaceHostSections.tsx')
  const web = read('web/src/App.tsx')
  const exports = read('ui/shared/src/mui/index.tsx')
  assert.match(exports, /export \* from '\.\/WorkspaceRouteTitles'/)
  for (const id of ['diagnostics','files','gallery','device-backup','remote-pull','transfers','local-storage','cloud-storage']) {
    assert.ok(core.includes("xDriveWorkspaceRouteTitle('" + id + "')"), id)
  }
  for (const id of ['overview','conflicts','admin-users','global-tasks','admin-audit','admin-storage','admin-services','admin-maintenance']) {
    assert.ok(host.includes("xDriveWorkspaceRouteTitle('" + id + "')"), id)
  }
  assert.match(web, /title=\\{mobileRouteTitle\\}/,
    'mobile header must select the active feature-local title')
  assert.match(web, /mobileMapFocused \\? '地图' : xDriveWorkspaceRouteTitle\\(appView\\)/,
    'ordinary destinations still use the shared canonical title catalog')
  assert.doesNotMatch(web, /const mobileAppTitles:/)
  assert.match(web, /xDriveWebAppRouteForWorkspaceKey\(destination\)/)
  assert.match(web, /data-xdrive-pwa-upload-resume-picker/)
  assert.match(web, /xDriveWebAppViewer\(route\.app\)/)
})
