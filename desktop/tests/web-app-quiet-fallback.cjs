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
    "appView === 'admin-users' && profile?.role === 'admin'",
    "appView === 'admin-audit' && profile?.role === 'admin'",
    "appView === 'admin-storage' && profile?.role === 'admin'"]){
    assert.ok(web.includes(t), 'existing route still exists: '+t)
  }
  assert.ok(web.includes('data-xdrive-mobile-app-frame'))
  assert.ok(web.includes('<XDriveMobileAppHeader'))
  assert.ok(routes.includes("presentation: 'workspace'"))
  assert.ok(web.includes('<XDriveMediaGalleryPage'))
  assert.ok(web.includes('<WebFileExplorer'))
})
