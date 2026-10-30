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
  assert.match(source, /localStopGeneration &\+= 1/)
  assert.match(source, /private\(set\) var localStopGeneration: UInt64 = 0/)
})

test('native bootstrap and trusted bridge stop all local schedules before BG credential', () => {
  const home = read('ios/XDriveIOS/XDriveWebAppHome.swift')
  const bridge = read('ios/XDriveIOS/IOSPhotoHostBridge.swift')
  const bootstrap = home.slice(home.indexOf('private func emergencyStopBackgroundLocally()'),
    home.indexOf('private var connectionForm:'))
  assert.match(home, /offline-ios-photo-emergency-stop/)
  assert.match(bootstrap, /disableAllOnThisDevice\(\)/)
  assert.match(bootstrap, /if pageError != nil/)
  assert.match(bootstrap, /openedOrigin = nil/)
  assert.match(home, /func stopDownloads\(\) \{[\s\S]*?photoHost\.cancelActive\(\)/)
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
  assert.match(bridge, /let stopGeneration = store\.localStopGeneration/)
  assert.match(bridge, /guard store\.localStopGeneration == stopGeneration/)
  const consent = bridge.indexOf('let confirmed = await confirmAutoSchedule(')
  const fence = bridge.indexOf('guard store.localStopGeneration == stopGeneration')
  const configure = bridge.indexOf('let state = try store.configure(')
  assert.ok(consent >= 0 && consent < fence && fence < configure,
    'late UIKit consent cannot re-enable auto upload after emergency stop')
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


test('automatic PhotoKit timer acquires the same native original gate as manual and BG runs before reserving a window', () => {
  const bridge = read('ios/XDriveIOS/IOSPhotoHostBridge.swift')
  const tick = bridge.slice(bridge.indexOf('case "photos.auto.tick":'),
    bridge.indexOf('case "photos.reconcile.status":'))
  const gate = tick.indexOf('let gate = XDriveIOSOriginalRunGate.shared.acquire()')
  const reserve = tick.indexOf('reserved = try store.reserveDue(owner: owner)')
  const task = tick.indexOf('activeBackup = Task { @MainActor [weak self] in')
  assert.ok(gate >= 0 && gate < reserve && reserve < task,
    'busy foreground and BG originals must not reserve an automatic due slot')
  assert.match(tick, /guard let gate = XDriveIOSOriginalRunGate\.shared\.acquire\(\) else \{[\s\S]*?"reason": "busy"/)
  assert.match(tick, /catch \{\s*XDriveIOSOriginalRunGate\.shared\.release\(gate\)\s*throw error\s*\}/)
  assert.match(tick, /else \{\s*XDriveIOSOriginalRunGate\.shared\.release\(gate\)\s*sendResult\(id, \["ran": false, "reason": "notDue"\]\)/)
  assert.match(tick, /activeBackup = Task \{ @MainActor \[weak self\] in\s*defer \{ XDriveIOSOriginalRunGate\.shared\.release\(gate\) \}/)
  assert.match(read('ios/XDriveIOS/BackgroundPhotoTask.swift'),
    /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/)
})

test('automatic backup consent re-verifies exact authenticated Owner and active Host after UIKit awaits', () => {
  const bridge = read('ios/XDriveIOS/IOSPhotoHostBridge.swift')
  const configure = bridge.slice(bridge.indexOf('case "photos.auto.configure":'),
    bridge.indexOf('case "photos.auto.tick":'))
  const consent = configure.indexOf('let confirmed = await confirmAutoSchedule(')
  const reverify = configure.indexOf('let currentOwner = try await verifiedOwner(source)')
  const persist = configure.indexOf('let state = try store.configure(')
  assert.ok(consent >= 0 && consent < reverify && reverify < persist,
    'an old consent cannot enable a schedule for an owner or server that has switched')
  for (const field of ['origin', 'instanceID', 'ownerID', 'username', 'rootNodeID']) {
    assert.ok(configure.includes('currentOwner.' + field + ' == owner.' + field),
      'must revalidate ' + field + ' after the consent await')
  }
  assert.match(configure, /store\.localStopGeneration == stopGeneration,[\s\S]*?let currentURL = webView\?\.url/)
  assert.match(configure, /sameOrigin\(currentURL\)/)
  assert.match(configure, /UIApplication\.shared\.applicationState == \.active/)
  assert.match(configure, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})
