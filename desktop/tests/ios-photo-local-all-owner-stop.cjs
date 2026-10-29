'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('offline emergency stop deletes only exact per-Owner foreground schedule keys', () => {
  const source = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const start = source.indexOf('func disableAllOnThisDevice() -> Int')
  const end = source.indexOf('/// Persist the next due time', start)
  assert.ok(start > 0 && end > start)
  const stop = source.slice(start, end)
  assert.match(stop, /xdrive\.ios\.photos\.auto\.v1\./)
  assert.match(stop, /suffix\.utf8\.count == 64/)
  assert.match(stop, /suffix\.utf8\.allSatisfy/)
  assert.match(stop, /UserDefaults\.standard\.removeObject\(forKey: key\)/)
  assert.doesNotMatch(stop, /clearLocalRecords|FileManager|PhotoKit|accessToken|URLSession|Keychain/)
  assert.match(source, /func configure\(owner: XDriveNativeOwnerRoot/)
})

test('native bootstrap and trusted bridge stop all local schedules before BG credential', () => {
  const home = read('ios/XDriveIOS/XDriveWebAppHome.swift')
  const bridge = read('ios/XDriveIOS/IOSPhotoHostBridge.swift')
  const bootstrap = home.slice(home.indexOf('private func emergencyStopBackgroundLocally()'),
    home.indexOf('private var connectionForm:'))
  assert.match(home, /offline-ios-photo-emergency-stop/)
  assert.match(bootstrap, /disableAllOnThisDevice\(\)/)
  assert.ok(bootstrap.indexOf('disableAllOnThisDevice()') <
    bootstrap.indexOf('emergencyStopLocally()'))
  const native = bridge.slice(bridge.indexOf('case "photos.background.emergencyStop":'),
    bridge.indexOf('case "photos.background.grant.status":'))
  assert.match(native, /cancelActive\(\)/)
  assert.match(native, /disableAllOnThisDevice\(\)/)
  assert.match(native, /foregroundSchedulesStopped/)
  assert.ok(native.indexOf('disableAllOnThisDevice()') <
    native.indexOf('emergencyStopLocally()'))
  assert.doesNotMatch(native, /parseOwner\(|accessToken|authorization: Bearer/)
  assert.match(bridge, /trustedMainFrame\(message\)/)
})

test('shared PWA receives only a redacted local count and never assumes older IPA stopped schedules', () => {
  const web = read('web/src/iosPhotoHostAdapter.ts')
  const shared = read('ui/shared/src/mui/IOSPhotoBackupSettings.tsx')
  assert.match(web, /foregroundSchedulesStopped\?: number/)
  assert.match(web, /this\.request\('photos\.background\.emergencyStop'\)/)
  assert.match(shared, /Number\.isSafeInteger\(count\)/)
  assert.match(shared, /本机前台自动计划停用状态未确认/)
  assert.match(shared, /data-xdrive-ios-bg-emergency-stop/)
  assert.doesNotMatch(shared, /grant_secret|deviceToken|rawSecret/)
})
