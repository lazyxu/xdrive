const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')
const web = read('web', 'src', 'AdminUsers.tsx')
const ui = read('ui', 'shared', 'src', 'mui', 'AdminUsersPage.tsx')
const uiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const webApp = read('web', 'src', 'App.tsx')
const port = read('ui', 'shared', 'src', 'admin-management.ts')
const main = read('desktop', 'src', 'main', 'index.cts')
const agent = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const handler = read('cmd', 'xdrive-agent', 'desktop_ipc_admin_users.go')
const cloud = read('cmd', 'xdrive-agent', 'cloud_admin_users.go')
const client = read('internal', 'client', 'admin_users.go')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const globals = read('desktop', 'src', 'renderer', 'global.d.ts')
const router = read('internal', 'api', 'router.go')

test('Web and Desktop use the same full-write shared MUI administrator user page', () => {
  assert.ok(web.includes("export { XDriveAdminUsersPage as default } from '@xdrive/ui/mui'"))
  assert.ok(uiIndex.includes("export { default as XDriveAdminUsersPage } from './AdminUsersPage'"))
  assert.ok(desktop.includes('<XDriveAdminUsersPage'))
  assert.ok(webApp.includes('<AdminUsersPanel'))
  assert.ok(ui.includes('data-xdrive-admin-users-responsive'))
  for (const method of ['adminUsers', 'adminCreateUser', 'adminUpdateUser', 'adminResetPassword',
    'adminRevokeSessions', 'adminDeleteUser']) {
    assert.ok(ui.includes('api.' + method + '('), 'shared full management page missing: ' + method)
    assert.ok(port.includes(method + '('), 'typed port missing: ' + method)
  }
  assert.ok(ui.includes('const ownerID = currentUserID ??'))
  assert.ok(ui.includes('user.id === ownerID'))
  assert.ok(ui.includes('user.id !== ownerID'))
  assert.ok(ui.includes('currentUsername'))
})

test('Desktop administrator route and Agent capability gate are not Server authorization', () => {
  assert.ok(desktop.includes("view === 'admin-users' && status?.role === 'admin'"))
  assert.ok(desktop.includes("capabilities.includes('admin-users')"))
  assert.ok(desktop.includes("key: 'admin-users', label: '用户管理'"))
  assert.ok(desktop.includes("view === 'global-tasks' || view === 'admin-users'"))
  assert.ok(agent.includes('"admin-users"'))
  assert.ok(handler.includes('snapshot.Role != "admin"'))
  assert.ok(handler.includes('snapshot.MustChangePassword'))
  assert.ok(router.includes('admin.Use(s.requireAdmin())'))
  for (const route of [
    'admin.GET("/users", s.adminListUsers)', 'admin.POST("/users", s.adminCreateUser)',
    'admin.PATCH("/users/:id", s.adminUpdateUser)', 'admin.DELETE("/users/:id", s.adminDeleteUser)',
    'admin.POST("/users/:id/reset-password", s.adminResetPassword)',
    'admin.POST("/users/:id/revoke-sessions", s.adminRevokeSessions)',
  ]) assert.ok(router.includes(route), 'Server admin gate missing: ' + route)
})

test('all six write/read operations traverse a bounded typed IPC and Go Client path', () => {
  for (const method of ['cloudAdminUsers', 'cloudAdminCreateUser', 'cloudAdminUpdateUser',
    'cloudAdminResetUserPassword', 'cloudAdminRevokeUserSessions', 'cloudAdminDeleteUser']) {
    assert.ok(desktop.includes('agent.' + method + '('), 'Desktop missing '+method)
    assert.ok(preload.includes(method + ':'), 'preload missing '+method)
    assert.ok(globals.includes(method + ':'), 'renderer type missing '+method)
    assert.ok(cloud.includes(') ' + method.replace(/^cloud/, 'Cloud') + '('), 'Go controller missing '+method)
  }
  for (const route of ['GET /v1/cloud/admin-users', 'POST /v1/cloud/admin-users',
    'PATCH /v1/cloud/admin-users/{id}', 'DELETE /v1/cloud/admin-users/{id}',
    'POST /v1/cloud/admin-users/{id}/reset-password', 'POST /v1/cloud/admin-users/{id}/revoke-sessions']) {
    assert.ok(agent.includes(route), 'Agent explicit endpoint missing: '+route)
  }
  assert.ok(main.includes("requireAgentCapability(hello, 'admin-users')"))
  assert.ok(main.includes('checkedAdminUserID'))
  assert.ok(handler.includes('decodeDesktopIPCJSON(w, r, &input)'))
  assert.ok(handler.includes('writeDesktopIPCControllerError'))
  assert.ok(client.includes('/api/v1/admin/users'))
  assert.equal(preload.includes('Bearer '), false)
  assert.equal(handler.includes('docker.sock'), false)
})
