const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8')

const app = read('web', 'src', 'App.tsx')
const routes = read('ui', 'shared', 'src', 'web-app.ts')
const registry = read('web', 'src', 'webApps.ts')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const page = read('ui', 'shared', 'src', 'mui', 'ServiceDependenciesPage.tsx')
const api = read('internal', 'api', 'router.go')
const backend = read('internal', 'api', 'admin_service_dependencies.go')
const bridge = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const preload = read('desktop', 'src', 'preload', 'index.cts')

test('Admin services is a Web workspace app behind the existing admin role', () => {
  assert.ok(routes.includes("'admin-services'"), 'Web hash routing must recognize admin services')
  assert.ok(registry.includes("'admin-services': { id: 'admin-services'"))
  assert.ok(app.includes("key: 'admin-services'"))
  assert.ok(app.includes("appView === 'admin-services' && profile?.role === 'admin'"))
  assert.ok(app.includes("appView.startsWith('admin-')"), 'demoted admins should leave admin pages')
  assert.ok(api.includes('admin.Use(s.requireAdmin())'))
  assert.ok(api.includes('admin.GET("/services", s.adminServiceDependencies)'))
})

test('Desktop services uses authenticated Agent IPC, never a renderer bearer or Docker socket', () => {
  assert.ok(desktop.includes("status?.role === 'admin'"))
  assert.ok(desktop.includes("view === 'admin-services' && status?.role === 'admin'"))
  assert.ok(desktop.includes('cloudAdminServices()'))
  assert.ok(preload.includes("ipcRenderer.invoke('agent:cloud-admin-services')"))
  assert.ok(bridge.includes('"GET /v1/cloud/admin-services"'))
  assert.ok(bridge.includes('CloudAdminServices(r.Context())'))
  assert.equal(page.includes('docker.sock'), false)
  assert.equal(page.includes('Authorization'), false)
})

test('Shared page differentiates actual health, disabled state, and not-yet-integrated services', () => {
  for (const state of ["'ready'", "'unavailable'", "'disabled'", "'unknown'", "'planned'"]) {
    assert.ok(page.includes(state.slice(1, -1) + ': {'), 'missing state: ' + state)
  }
  assert.ok(page.includes('data-xdrive-admin-service-dependencies'))
  assert.ok(page.includes('presentation="page"'))
  assert.ok(page.includes('source.load()'))
  assert.ok(page.includes('active = false'), 'stale responses must be ignored after unmount')
  assert.ok(backend.includes('c.Header("Cache-Control", "no-store")'))
  assert.ok(backend.includes('context.WithTimeout'))
  assert.ok(backend.includes('Status: "planned"'), 'future Media Worker and map tiles must not be reported healthy')
})
