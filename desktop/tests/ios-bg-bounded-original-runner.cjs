'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root,'ios/XDriveIOS',name),'utf8')

test('BG task performs a bounded real original run only after current native grant proof',()=>{
  const task=read('BackgroundPhotoTask.swift')
  assert.match(task,/\.proveInBackground\(\)/)
  assert.match(task,/UIApplication\.shared\.isProtectedDataAvailable/)
  assert.match(task,/XDriveIOSOriginalRunGate\.shared\.acquire\(\)/)
  assert.match(task,/\.reserveDue\(owner: owner, approved: approved\)/)
  assert.match(task,/XDriveIOSForegroundPhotoBackupMVP\(/)
  assert.match(task,/approvedBackgroundGrant: approved/)
  assert.match(task,/maximumNewOriginals: 1/)
  assert.match(task,/\.record\(\s*owner: owner, approved: approved, report: progress/)
  assert.match(task,/!progress\.stoppedForReview/)
  assert.match(task,/task\.expirationHandler = \{[\s\S]*?expiration\.systemExpired = true[\s\S]*?operation\.cancel\(\)/)
  assert.doesNotMatch(task,/Bearer |refreshToken|localStorage|createUploadSession|\.setValue\("Authorization"/)
  assert.ok(task.indexOf('.proveInBackground()') < task.indexOf('isProtectedDataAvailable'),
    'no PhotoKit work before current Server grant proof')
  assert.ok(task.indexOf('reserveDue(') < task.indexOf('XDriveIOSForegroundPhotoBackupMVP('),
    'persist due reservation before possible network writes')
})

test('same foreground/Background source scanner and sealed intent, not a second uploader',()=>{
  const runner=read('ForegroundPhotoBackupMVP.swift')
  const prep=read('PhotoKitStagedIntentPreparer.swift')
  const write=read('IOSJournaledOriginalUpload.swift')
  const auth=read('OriginalOwnerAuthorization.swift')
  assert.match(runner,/case \.background = authorization/)
  assert.match(runner,/try await authorization\.verify\(owner: owner\)/)
  assert.match(runner,/XDrivePhotoKitOriginalExporter\.stage/)
  assert.match(runner,/preparer\.prepareVideo/)
  assert.match(runner,/preparer\.prepareLiveBundle/)
  assert.match(runner,/XDriveIOSJournaledOriginalUpload/)
  assert.match(prep,/func prepareLiveBundle\(/)
  assert.match(prep,/func prepareVideo\(/)
  assert.match(prep,/try await authorization\.verify\(owner: owner\)/)
  assert.match(write,/let transport = try authorization\.transport/)
  assert.match(write,/beforeCreate:|beginCreate\(/)
  assert.match(write,/beforeFinalize:|beginFinalize\(/)
  assert.match(write,/try await authorization\.verifyNodeReceipt/)
  assert.match(auth,/XDriveIOSApprovedPhotoBGVault\.shared/)
  assert.match(auth,/XDriveIOSNodeReceiptReadbackVerifier/)
  assert.match(auth,/XDriveIOSBGOriginalNodeReceiptVerifier/)
  assert.doesNotMatch(auth,/URLSessionConfiguration\.background/)
})

test('local revoke and OS expiration fence each subsequent chunk without credential downgrade',()=>{
  const transport=read('NativeUploadSessionTransport.swift')
  const schedule=read('BGOriginalWindowStore.swift')
  const grant=read('ApprovedBackgroundPhotoVault.swift')
  const login=read('NativeOwnerLoginScreen.swift')
  assert.match(transport,/XDriveIOSApprovedPhotoBGVault\.shared\.current\(\)/)
  assert.match(transport,/local\.grantID == approved\.grantID/)
  assert.match(transport,/URLSessionConfiguration\.ephemeral/)
  assert.match(transport,/NativePhotoDenyRedirects/)
  assert.match(login,/XDriveIOSOriginalRunGate\.shared\.acquire\(\)/)
  assert.match(schedule,/pausedForReview/)
  assert.match(schedule,/record\(owner: XDriveNativeOwnerRoot/)
  assert.match(schedule,/needsReview: unresolved/)
  assert.match(grant,/kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/)
  const legacy=read('PhotoSyncEncryptedLedger.swift')
  assert.match(legacy,/kSecAttrAccessibleWhenUnlockedThisDeviceOnly/)
  assert.match(legacy,/FileProtectionType\.complete/)
  assert.doesNotMatch(transport,/URLSessionConfiguration\.background/)
  // Reject secret-bearing fields/properties, not human-readable comments
  // documenting that raw PhotoKit identifiers are intentionally absent.
  assert.doesNotMatch(schedule,/\.localIdentifier\b|\b(?:var|let) (?:accessToken|grantSecret|deviceToken)\b/)
})

test('offline stop remains native, stop-only and preserves remote revoke evidence',()=>{
  const manager=read('PhotoBackgroundGrantManager.swift')
  const root=read('NativeOwnerLoginScreen.swift')
  const schedule=read('PhotoAutoScheduleStore.swift')
  const localStop=manager.match(/func emergencyStopLocally\(\) async throws -> Bool \{[\s\S]*?\n    \}/)?.[0]
  assert.ok(localStop)
  assert.ok(localStop.indexOf('revokePendingRequests()') <
            localStop.indexOf('XDriveIOSApprovedPhotoBGVault.shared.current()'))
  assert.ok(localStop.indexOf('.cancelLocally(owner: owner)') <
            localStop.indexOf('try read(owner: owner)'))
  assert.match(localStop,/pending.revokePending = true/)
  assert.match(localStop,/try save\(pending, owner: owner\)/)
  assert.doesNotMatch(localStop,/accessToken|Bearer |URLSession|\.request\(/)
  const emergency=root.slice(root.indexOf('private func emergencyStopWithoutAccount()'),
    root.indexOf('/// No new account may reuse'))
  assert.match(root,/native-ios-offline-emergency-stop/)
  assert.match(emergency,/backup.cancel\(\)/)
  assert.match(emergency,/disableAllOnThisDevice\(\)/)
  assert.match(emergency,/\.emergencyStopLocally\(\)/)
  assert.match(emergency,/XDriveIOSBackgroundPhotoTask.revokePendingRequests\(\)/)
  assert.ok(emergency.indexOf('disableAllOnThisDevice()') <
    emergency.indexOf('emergencyStopLocally()'))
  assert.match(schedule,/localStopGeneration &\+= 1/)
})

test('PhotoKit 256-slot window counts unsupported assets instead of silently skipping their offsets',()=>{
  const scanner=read('PhotoKitBoundedSnapshotScanner.swift')
  const runner=read('ForegroundPhotoBackupMVP.swift')
  const scannedSlots=scanner.split('for index in offset..<end {')[1]?.split('rows.append(XDrivePhotoKitScanCandidate(')[0]
  assert.ok(scannedSlots, 'missing bounded PhotoKit page loop')
  assert.doesNotMatch(scannedSlots,/\bcontinue\b/, 'no asset can disappear from the page before scanned accounting')
  assert.match(scannedSlots,/default: kind = "unsupported"/)
  assert.match(scanner,/nextOffset: end/)
  assert.match(runner,/report.scanned \+= 1/)
  assert.match(runner,/windowCapacity = XDrivePhotoBackupScanWindow.capacity/)
})

test('transient prewrite BG failure retains a future approval without retrying a possible lost ACK', () => {
  const task = read('BackgroundPhotoTask.swift');
  assert.match(task, /var beganOriginalWrite = false/);
  // The real writer advertises potential mutation only at the prepared
  // journaled upload boundary; scanning alone must not arm a BG pause.
  assert.match(task, /let progress = try await XDriveIOSForegroundPhotoBackupMVP\([\s\S]*?onPotentialWrite: \{ beganOriginalWrite = true \}/);
  const pending = task.slice(task.indexOf('} catch is CancellationError {'),
    task.indexOf('private static func retryablePreflightNetworkFailure('));
  assert.match(pending, /if beganOriginalWrite, let attemptedOwner \{[\s\S]*?BGOriginalWindowStore\.shared\.pause\([\s\S]*?\} else if retryablePreflightNetworkFailure\(error\) \{[\s\S]*?await resubmitOnlyIfStillApproved\(\)/);
  assert.doesNotMatch(task, /beganOriginalWrite = true\s*let progress = try await XDriveIOSForegroundPhotoBackupMVP/);
  assert.match(task, /guard let network = error as\? URLError else \{ return false \}/);
  assert.match(task, /case \.timedOut, \.networkConnectionLost, \.notConnectedToInternet/);
  assert.match(task, /\.cannotFindHost, \.cannotConnectToHost, \.dnsLookupFailed/);
  assert.match(task, /guard let grant = try await XDriveIOSApprovedPhotoBGVault\.shared\.current\(\)/);
  assert.match(task, /grant\.matches\(owner\)/);
  assert.match(task, /try Task\.checkCancellation\(\)[\s\S]*?try scheduleApprovedProbe\(afterMinutes: grant\.intervalMinutes\)/);
  assert.match(task, /guard let gate = XDriveIOSOriginalRunGate\.shared\.acquire\(\) else \{[\s\S]*?await resubmitOnlyIfStillApproved\(\)/);
  const resubmit = task.slice(task.indexOf('private static func resubmitOnlyIfStillApproved()'),
    task.indexOf('/// A background run must not continue', task.indexOf('private static func resubmitOnlyIfStillApproved()')));
  assert.doesNotMatch(resubmit, /XDriveIOSForegroundPhotoBackupMVP|UploadSessionTransport|reserveDue|beginFinalize|Bearer /);
  assert.match(task, /catch is CancellationError \{/);
  assert.match(task, /successful = !progress\.stoppedForReview/);
});

test('lost or cancelled BG writer preserves durable pause until explicit receipt review', () => {
  const task = read('BackgroundPhotoTask.swift')
  const store = read('BGOriginalWindowStore.swift')
  assert.match(task, /var beganOriginalWrite = false/)
  assert.match(task, /var attemptedOwner: XDriveNativeOwnerRoot\?/)
  assert.match(task, /attemptedOwner = owner[\s\S]*?onPotentialWrite: \{ beganOriginalWrite = true \}/)
  assert.doesNotMatch(task, /attemptedOwner = owner\s*beganOriginalWrite = true/)
  const runner = read('ForegroundPhotoBackupMVP.swift')
  assert.match(runner, /onPotentialWrite: @MainActor @escaping \(\) -> Void = \{\}/)
  assert.match(runner, /onPotentialWrite: onPotentialWrite/)
  const writing = runner.slice(runner.indexOf('case .prepared:'),
    runner.indexOf('case .creating, .uploading, .finalizing'))
  assert.match(writing, /await onPotentialWrite\(\)\s*try Task.checkCancellation\(\)\s*_ = try await writer.uploadPrepared/)
  assert.doesNotMatch(runner.slice(0, runner.indexOf('case .prepared:')), /await onPotentialWrite\(\)/)
  const cancelled = task.slice(task.indexOf('} catch is CancellationError {'),
    task.indexOf('private static func retryablePreflightNetworkFailure('))
  assert.match(cancelled, /if beganOriginalWrite, let attemptedOwner \{[\s\S]*?BGOriginalWindowStore\.shared\.pause\(/)
  assert.match(cancelled, /else if retryablePreflightNetworkFailure\(error\) \{[\s\S]*?await resubmitOnlyIfStillApproved\(\)/)
  assert.match(store, /func pause\(owner: XDriveNativeOwnerRoot\) throws/)
  assert.match(store, /state\.pausedForReview = true/)
  assert.match(store, /guard !state\.pausedForReview, state\.dueAt <= now else \{ return nil \}/)
  assert.doesNotMatch(cancelled, /uploadPrepared\(|confirmReceipt\(|beginFinalize\(/)
})

test('system-expired prewrite BGTask re-arms only after unchanged Owner-approved stop epoch', () => {
  const task = read('BackgroundPhotoTask.swift')
  assert.match(task, /private final class XDriveIOSBGExpirationSignal/)
  assert.match(task, /var systemExpired = false/)
  assert.match(task, /let stopVersionAtStart = localStopVersion/)
  assert.match(task, /let runID = UUID\(\)/)
  assert.match(task, /activeRunID = runID/)
  assert.match(task, /task\.expirationHandler = \{[\s\S]*?Task \{ @MainActor in[\s\S]*?guard activeRunID == runID else \{ return \}[\s\S]*?expiration\.systemExpired = true[\s\S]*?operation\.cancel\(\)/)
  const cancel = task.slice(task.indexOf('} catch is CancellationError {'),
    task.indexOf('} catch {', task.indexOf('} catch is CancellationError {')))
  assert.match(cancel, /if beganOriginalWrite, let attemptedOwner \{[\s\S]*?BGOriginalWindowStore\.shared\.pause\(/)
  assert.match(cancel, /else if expiration\.systemExpired &&[\s\S]*?localStopVersion == stopVersionAtStart/)
  assert.match(cancel, /await resubmitOnlyIfStillApproved\([\s\S]*?afterSystemExpirationAt: stopVersionAtStart/)
  assert.doesNotMatch(cancel, /uploadPrepared\(|beginFinalize\(|confirmReceipt\(/)
  const helper = task.slice(task.indexOf('private static func resubmitOnlyIfStillApproved('),
    task.indexOf('/// A background run must not continue', task.indexOf('private static func resubmitOnlyIfStillApproved(')))
  assert.match(helper, /afterSystemExpirationAt expectedStopVersion: UInt64\? = nil/)
  assert.ok((helper.match(/guard localStopVersion == expectedStopVersion else \{ return \}/g)||[]).length === 2,
    'must fence local stop before and after async Keychain lookup')
  assert.match(helper, /XDriveIOSApprovedPhotoBGVault\.shared\.current\(\)/)
  assert.match(helper, /grant\.matches\(owner\)/)
  assert.match(helper, /try scheduleApprovedProbe\(afterMinutes: grant\.intervalMinutes\)/)
  assert.doesNotMatch(helper, /UploadSession|Bearer|writeResource|uploadPrepared|maximumNewOriginals/)
  assert.match(task, /func revokePendingRequests\(\) \{[\s\S]*?BGTaskScheduler\.shared\.cancel[\s\S]*?localStopVersion &\+= 1[\s\S]*?active\?\.cancel\(\)/)
  const revoke = task.slice(task.indexOf('static func revokePendingRequests()'),
    task.indexOf('static func scheduleApprovedProbe('))
  assert.ok((revoke.match(/BGTaskScheduler\.shared\.cancel\(/g) || []).length === 2,
    'local stop must cancel again after its actor fence to defeat an expiring rearm')
  assert.ok(revoke.lastIndexOf('BGTaskScheduler.shared.cancel(') >
    revoke.indexOf('localStopVersion &+= 1'))
  assert.match(task, /beganOriginalWrite = true/)
  assert.match(task, /onPotentialWrite: \{ beganOriginalWrite = true \}/)
})
