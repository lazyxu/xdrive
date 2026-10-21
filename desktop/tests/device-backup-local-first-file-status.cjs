const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (...segments) => fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8')
const controller = read('cmd', 'xdrive-agent', 'device_backup_local_first_file_status.go')
const handler = read('cmd', 'xdrive-agent', 'desktop_ipc_device_backup_first_file_status.go')
const ipc = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const agent = read('desktop', 'src', 'main', 'agent_client.cts')
const main = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const types = read('ui', 'shared', 'src', 'device-backups.ts')
const dialog = read('ui', 'shared', 'src', 'mui', 'DeviceBackupLocalFirstFileDialog.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const web = read('web', 'src', 'App.tsx')

test('status is a narrow owning-Agent read, never new physical upload authority', () => {
  for (const expected of [
    'c.localFirstFileJobs[key]', 'case <-job.done:', 'key.valid()',
    'current.Server != account.Server', 'current.Username != account.Username',
    'current.SessionID != account.SessionID', 'view.Phase = "uncertain"',
    'view.Phase = "running"', 'view.Phase = "observed"',
  ]) assert.ok(controller.includes(expected), 'missing safe Agent observation: ' + expected)
  for (const banned of ['.Stage(', '.Prepare(', '.Commit(', 'Begin(', 'RunFirstLeaf(', 'Delete(', 'Remove(']) {
    assert.equal(controller.includes(banned), false, 'status read initiated mutation: ' + banned)
  }
  assert.ok(handler.includes('CloudReadLocalBoundBackupFirstFileStatus(r.Context(), sourceID)'))
  assert.ok(handler.includes('Cache-Control'))
  assert.ok(handler.includes('private, no-store'))
  assert.ok(handler.includes('view.PhysicalObserved'))
  assert.ok(ipc.includes('mux.HandleFunc("GET /v1/device-backups/local-first-file-status", h.readLocalBoundBackupFirstFileStatus)'))
  assert.ok(ipc.includes('"device-backup-local-first-file-status"'))
})

test('Desktop explicit read-only bridge and identity-scoped UI; Web remains read-only without Agent job query', () => {
  assert.ok(agent.includes("'GET', \`/v1/device-backups/local-first-file-status?"))
  assert.ok(main.includes("requireAgentCapability(hello, 'device-backup-local-first-file-status')"))
  assert.ok(preload.includes("'agent:get-device-backup-local-first-file-status'"))
  assert.ok(desktop.includes("agent.hello?.capabilities.includes('device-backup-local-first-file-status')"))
  assert.ok(types.includes("'not-recorded' | 'running' | 'observed' | 'uncertain'"))
  assert.ok(dialog.includes('scopeEpoch.current !== epoch'))
  assert.ok(dialog.includes("status?.phase === 'uncertain' || Boolean(statusError)"), 'failed Agent status read must not permit another start')
  assert.ok(dialog.includes('statusTicket.current !== request'))
  assert.ok(dialog.includes('刷新本机任务状态（只读）'))
  assert.ok(dialog.includes('onClose={onClose}'))
  assert.ok(dialog.includes('attempted ||'))
  assert.ok(dialog.includes('next.backup_complete !== false'))
  assert.ok(dialog.includes('请勿重复'))
  for (const forbidden of ['getDeviceBackupLocalFirstFileStatus', 'startDeviceBackupLocalFirstFile']) {
    assert.equal(web.includes(forbidden), false, 'Web gained owning-Agent capability: ' + forbidden)
  }
})
