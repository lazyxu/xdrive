const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const page = read('ui', 'shared', 'src', 'mui', 'GlobalStorageStatsPage.tsx')
const web = read('web', 'src', 'StorageStatsPanel.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const main = read('desktop', 'src', 'main', 'index.cts')
const client = read('internal', 'client', 'admin_storage.go')
const ipc = read('cmd', 'xdrive-agent', 'desktop_ipc_admin_storage.go')
const router = read('internal', 'api', 'router.go')
const port = read('ui', 'shared', 'src', 'admin-management.ts')

test('full Web and Desktop global storage shares the entire MUI page', () => {
  assert.ok(web.includes("export { XDriveGlobalStorageStatsPage as default } from '@xdrive/ui/mui'"))
  assert.ok(desktop.includes('<XDriveGlobalStorageStatsPage'))
  assert.ok(desktop.includes("key: 'admin-storage', label: '全局存储'"))
  assert.ok(desktop.includes("view === 'admin-storage' && status?.role === 'admin'"))
  assert.ok(desktop.includes("capabilities.includes('admin-storage')"))
  for (const key of [
    'api.adminStorageHistory(', 'api.adminStorageLegacyObjects(',
    'api.adminStorageUnreferencedBlobs(', 'api.adminCleanupUploadStaging(',
    'api.adminCleanupStorageCache(', 'onRunStorageMaintenance(',
  ]) {
    assert.ok(page.includes(key), 'missing shared storage operation: ' + key)
  }
  assert.ok(port.includes('export type XDriveAdminStoragePort'))
})

test('mutations preserve user confirmation and Server admin authorization', () => {
  assert.ok(page.includes('confirmIntent="danger"'))
  assert.ok(page.includes('loading={cleanupLoading}'))
  assert.ok(ipc.includes('snapshot.Role != "admin"'))
  assert.ok(main.includes("requireAgentCapability(hello, 'admin-storage')"))
  assert.ok(main.includes("key => !['operation', 'limit', 'offset', 'cursor', 'days', 'run_id', 'fresh', 'kind'].includes(key)"))
  assert.ok(client.includes('switch input.Operation'))
  assert.ok(client.includes('"/api/v1/admin/storage/cache/cleanup"'))
  assert.ok(client.includes('"/api/v1/admin/storage/staging/cleanup"'))
  assert.ok(router.includes('admin.Use(s.requireAdmin())'))
  assert.ok(desktop.includes('system-maintenance:${kind}'))
  assert.equal(main.includes('agent:cloud-admin-storage-url'), false)
})
