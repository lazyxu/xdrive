const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')

const agent = read('cmd', 'xdrive-agent', 'device_backup_local_first_file_activation.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const handler = read('cmd', 'xdrive-agent', 'desktop_ipc_device_backup_first_file.go')
const main = read('desktop', 'src', 'main', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const types = read('ui', 'shared', 'src', 'device-backups.ts')
const view = read('ui', 'shared', 'src', 'mui', 'DeviceBackupPage.tsx')
const dialog = read('ui', 'shared', 'src', 'mui', 'DeviceBackupLocalFirstFileDialog.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const web = read('web', 'src', 'App.tsx')

test('true first-file upload is gated by the owning Desktop and dedicated authenticated Agent IPC', () => {
  assert.ok(agentIPC.includes('"device-backup-local-first-file"'))
  assert.ok(agentIPC.includes('mux.HandleFunc("POST /v1/device-backups/local-first-file", h.startLocalBoundBackupFirstFile)'))
  assert.ok(handler.includes('runtime.GOOS != "linux" && runtime.GOOS != "windows"'))
  assert.ok(handler.includes('CloudStartLocalBoundBackupFirstFile(r.Context(), sourceID)'))
  assert.ok(main.includes("requireAgentCapability(hello, 'device-backup-local-first-file')"))
  assert.ok(agentClient.includes('/v1/device-backups/local-first-file'))
  assert.ok(preload.includes("'agent:start-device-backup-local-first-file'"))
  assert.ok(desktop.includes("agent.hello?.capabilities.includes('device-backup-local-first-file')"))
  assert.ok(desktop.includes('localFirstFile={localBackupFirstFile}'))
  assert.ok(view.includes("folder.sync_mode === 'backup' && verifiedLocalDeviceID === device.id && !device.revoked"))
  assert.ok(view.includes('localOwnsFolder(firstFileTarget.id)'))
  assert.equal(web.includes('localFirstFile='), false, 'Web and Mobile Web must not get the writer')
  assert.equal(web.includes('startDeviceBackupLocalFirstFile'), false)
})

test('only Agent-selected strong journal leaf enters existing real native/CAS/SQL runner', () => {
  for (const expected of [
    'StreamVerifiedInventoryJournal(', 'eligibleLocalBackupFirstLeaf(item)',
    'HashVerifiedInventoryFile(', 'matcher.Ignored(item.Path, false)',
    'CloudStartLocalBoundBackupFirstFile', 'newLocalPushFirstLeafDriverPrivate(',
    'localFolderGrantMu.TryLock()', 'RunFirstLeaf(workCtx, driver.scope, driver)',
    'latestRules.IgnoreRules != rules.IgnoreRules',
  ]) {
    assert.ok(agent.includes(expected), 'missing security binding: ' + expected)
  }
  for (const forbidden of ['RunSource', 'TriggerSource', 'SourceRun', 'RemoveRootGrant', 'DeleteLocal', 'MirrorDelete']) {
    assert.equal(agent.includes(forbidden + '('), false)
  }
  assert.ok(types.includes('backup_complete: false'))
  assert.ok(types.includes('retirement_safe: false'))
  assert.ok(dialog.includes('next.backup_complete !== false'))
  assert.ok(dialog.includes('确认并上传首文件'))
  assert.ok(dialog.includes('请勿重复'))
  assert.ok(handler.includes('!result.PhysicalObserved || result.BackupComplete || result.RetirementSafe'))
})
