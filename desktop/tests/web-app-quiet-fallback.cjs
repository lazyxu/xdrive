const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname,'..','..')
const web = fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
const routes = fs.readFileSync(path.join(root,'web/src/webApps.ts'),'utf8')

test('unknown or not-yet-authorized Web workspace never presents an endless switching spinner', () => {
  assert.ok(web.includes('data-xdrive-workspace-unavailable'))
  assert.ok(web.includes('{profile ? ('))
  assert.ok(web.includes('该工作区不可用或没有访问权限，请从导航返回主页。'))
  assert.equal(web.includes('loading message="正在切换工作区…"'),false)
  assert.ok(web.includes('height: \'100%\', minHeight: 0'))
})

test('all valid Web/Mobile Web apps still mount shared pages with unchanged route and auth gates', () => {
  for(const t of ['appView === \'files\'','appView === \'gallery\'',
    'appView === \'device-backup\'','appView === \'remote-pull\'',
    'appView === \'local-storage\'','appView === \'cloud-storage\'',
    "appView === 'admin-users'", "appView === 'admin-audit'",
    "appView === 'admin-storage'"]){
    assert.ok(web.includes(t), 'existing route still exists: '+t)
  }
  // Admin routes share one verified Host role gate: the old duplicated
  // per-page role literals were replaced, never removed as authorization.
  assert.ok(web.includes("profile?.role === 'admin'"))
  assert.ok(web.includes('adminRoleVerified: serverAdminVerified'))
  const browserHost = fs.readFileSync(path.join(root,'web/src/browserWorkspaceHost.ts'),'utf8')
  const outlet = fs.readFileSync(path.join(root,'ui/shared/src/mui/XDriveAppPageOutlet.tsx'),'utf8')
  assert.ok(browserHost.includes('adminServicesPage: ports.adminServices'))
  assert.ok(outlet.includes('xDriveWorkspaceRouteRequiresAdmin(view) && host.adminRoleVerified !== true'))
  assert.ok(web.includes('data-xdrive-mobile-app-frame'))
  assert.ok(web.includes('<XDriveMobileAppHeader'))
  assert.ok(routes.includes("presentation: 'workspace'"))
  assert.ok(web.includes('<XDriveMediaGalleryPage'))
  assert.ok(web.includes('<WebFileExplorer'))
})
