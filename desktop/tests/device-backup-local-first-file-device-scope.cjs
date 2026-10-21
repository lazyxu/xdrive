const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')

test('owning first-file job and redacted status are fenced by current registered device', () => {
  const job = read('cmd', 'xdrive-agent', 'device_backup_local_first_file_job.go')
  const scoped = read('cmd', 'xdrive-agent', 'device_backup_local_first_file_device_key.go')
  const status = read('cmd', 'xdrive-agent', 'device_backup_local_first_file_status.go')
  const keyTest = read('cmd', 'xdrive-agent', 'device_backup_local_first_file_job_test.go')
  const statusTest = read('cmd', 'xdrive-agent', 'device_backup_local_first_file_status_test.go')
  for (const expected of ['deviceID string', 'validLocalPushRequestUUID(key.deviceID)',
    'currentLocalFirstFileDeviceKey(account, sourceID)',
    'currentLocalFirstFileDeviceKey(current, sourceID)', 'currentKey != key']) {
    assert.ok((job + status).includes(expected), 'missing native device identity fence: ' + expected)
  }
  assert.ok(scoped.includes('localpush.LoadDeviceRegistration(dir, server, username)'))
  assert.ok(scoped.includes('account.SessionInvalid'))
  assert.ok(scoped.includes('validLocalPushRequestUUID(deviceID)'))
  assert.ok(job.includes('previous.sourceID == key.sourceID'), 'different registration must not create second upload')
  assert.ok(keyTest.includes('TestLocalFirstFileJobRegistrationBindsExactDeviceID'))
  assert.ok(statusTest.includes('deviceID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"'))
  assert.ok(statusTest.includes('"device_id"'), 'device id must not enter status JSON')
  for (const banned of ['.Stage(', '.Prepare(', '.Commit(', 'RunFirstLeaf(', 'Begin(']) {
    assert.equal(scoped.includes(banned), false, 'device scope helper gained write authority: ' + banned)
  }
})
