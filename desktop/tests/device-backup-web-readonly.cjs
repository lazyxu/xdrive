const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const view = read('ui', 'shared', 'src', 'mui', 'DeviceBackupPage.tsx')
const dto = read('ui', 'shared', 'src', 'device-backups.ts')
const api = read('web', 'src', 'api.ts')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')

test('Device Backup reads only owner-scoped redacted APIs', () => {
  assert.ok(api.includes("this.request<XDriveDeviceBackupOverview>('/api/v1/device-backups')"))
  assert.ok(api.includes('this.request<XDriveDeviceBackupRunPage>(`/api/v1/device-backups/${sourceID}/runs?'))
  assert.ok(web.includes('source={deviceBackupSource}'))
  assert.ok(web.includes("route.app === 'device-backup' ? route.params.source : undefined"))
  assert.equal(view.includes('sourceOverview('), false)
  assert.equal(view.includes('sourceItems('), false)
  assert.equal(view.includes('localRoot'), false)
  assert.equal(view.includes('rawError'), false)
})

test('Push backup presenter has only B-scope read models, no cross-device mutation controls', () => {
  for (const field of ['device_name', 'device_id', 'root_fingerprint', 'credential_hash', 'active_transfer_path', 'ignore_rules', 'checkpoint']) {
    assert.equal(dto.includes(field), false, 'device read model must not expose ' + field)
  }
  for (const action of ['triggerSource', 'cancelSourceRun', 'updateSource', 'deleteSource', 'revokeClientDevice']) {
    assert.equal(view.includes(action), false, 'backup viewer must not offer ' + action)
  }
  assert.ok(view.includes('source.runs(id, pageSize, (page - 1) * pageSize)'))
  assert.ok(view.includes('formatBytes(run.transferred_bytes)'))
  assert.ok(view.includes('snapshot.source === source'), 'old account overview must not render')
  assert.ok(view.includes('historyState.source === source'), 'old account history must not render')
  assert.ok(view.includes('if (prev.source !== source) return prev'), 'late history must not publish across accounts')
  assert.ok(view.includes('NAS 备份 · 待支持'))
  assert.ok(view.includes('连接状态未知'))
  assert.ok(desktop.includes('<XDriveDeviceBackupPage />'), 'Desktop remains a safe read-IPC placeholder')
})

test('B-scope display is independent of Pull SourceManager routing', () => {
  assert.ok(web.includes("appView === 'device-backup'"))
  assert.ok(web.includes("appView === 'remote-pull'"))
  assert.ok(web.includes('directionFilter="pull"'))
  assert.equal(view.includes('XDriveSourceManager'), false)
})
