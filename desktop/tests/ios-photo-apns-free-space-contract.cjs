const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8')

test('remote Photo wake never starts a writer or accepts Owner credentials from a push payload', () => {
  const app = read('ios/XDriveIOS/XDriveIOSApp.swift')
  const remote = read('ios/XDriveIOS/PhotoBackupRemoteHintDelegate.swift')
  const policy = read('ios/XDriveIOS/PhotoBackupResiliencePolicy.swift')
  const project = read('ios/project.yml')
  assert.match(app, /UIApplicationDelegateAdaptor\(XDriveIOSPhotoBackupRemoteHintDelegate\.self\)/)
  assert.match(remote, /isSilentPhotoWakeHint\(userInfo\)/)
  assert.match(remote, /rearmAfterRemoteWakeHint\(\)/)
  assert.doesNotMatch(remote, /PHAsset|performChanges|UploadSession|\.run\(/)
  assert.match(policy, /aps\["content-available"\][\s\S]*?xdrive_kind[\s\S]*?photos-backup-wake/)
  assert.match(policy, /payload\.keys\.allSatisfy/)
  assert.match(project, /UIBackgroundModes:[\s\S]*?- processing[\s\S]*?- remote-notification/)
})

test('APNs re-arm enforces existing Owner authorization, stop generation, PhotoKit and pending receipt checks', () => {
  const task = read('ios/XDriveIOS/BackgroundPhotoTask.swift')
  const part = task.slice(task.indexOf('static func rearmAfterRemoteWakeHint()'))
  assert.ok(part.startsWith('static func rearmAfterRemoteWakeHint()'))
  assert.match(part, /isProtectedDataAvailable/)
  assert.match(part, /authorizationStatus\(for: \.readWrite\) == \.authorized/)
  assert.match(part, /grant\.matches\(owner\), grant\.hasManagedDestination/)
  assert.match(part, /plan\.enabled, plan\.historyRecoveryRequired != true/)
  assert.match(part, /olderPending = try await XDriveIOSOriginalPendingReceiptPreflight/)
  assert.match(part, /noPendingReceipts: olderPending == 0/)
  assert.match(part, /lastAcceptedWake: XDriveIOSBGAttemptStatus\.lastRemoteWake/)
  assert.match(part, /localStopVersion == stop/)
  assert.match(part, /getPendingTaskRequests/)
  assert.match(part, /scheduleApprovedProbe\(afterMinutes: grant\.intervalMinutes\)/)
})

test('iPhone original deletion remains disabled until a durable independent Server retention proof exists', () => {
  const policy = read('ios/XDriveIOS/PhotoBackupResiliencePolicy.swift')
  const bg = read('ios/XDriveIOS/BackgroundPhotoTask.swift')
  const screen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
  assert.match(policy, /canDeleteApplePhotosOriginal\(/)
  for (const x of ['currentOwnerAndSource', 'originalRevisionAndSHAReverified',
      'allLiveResourcesProtected', 'noUncertainUploadReceipt',
      'durableServerRetentionLease', 'leaseStillValidAtDeletion',
      'inForegroundWithFullPhotoAccess', 'explicitUserConfirmation']) {
    assert.match(policy, new RegExp(x))
  }
  assert.doesNotMatch(bg, /PHAssetChangeRequest\.deleteAssets/)
  assert.doesNotMatch(screen, /PHAssetChangeRequest\.deleteAssets/)
  assert.match(screen, /thumbnail|缩略图/i)
})
