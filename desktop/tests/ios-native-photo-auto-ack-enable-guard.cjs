'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift')
const receipt = read('ios/XDriveIOS/NativePhotoReceiptReviewController.swift')
const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
const flow = read('.github/workflows/ios-unsigned-ipa.yml')
const configure = controller.slice(controller.indexOf('    func configure('),
  controller.indexOf('    /// Local stop', controller.indexOf('    func configure(')))

test('auto enable serializes verified ledger inspection with original writers', () => {
  const auth = configure.indexOf('let first = try await login.verifiedAuthorization()')
  const gate = configure.indexOf('XDriveIOSOriginalRunGate.shared.acquire()')
  const scope = configure.indexOf('.existingLocalScope(owner: selected)')
  const pending = configure.indexOf('.pendingReceiptSnapshot(scope: scope, limit: 0)')
  const fresh = configure.indexOf('let second = try await login.verifiedAuthorization()')
  const schedule = configure.indexOf('schedule = try store.configure(')
  assert.ok(auth >= 0 && auth < gate && gate < scope && scope < pending &&
    pending < fresh && fresh < schedule)
  assert.match(configure, /defer \{ XDriveIOSOriginalRunGate\.shared\.release\(gate\) \}/)
  assert.match(configure, /guard pending == 0 else \{/)
  assert.match(configure, /if store\.status\(owner: selected\)\?\.pausedForReview == true/)
  assert.match(configure, /else if store\.hasSavedRecord\(owner: selected\)/)
  assert.doesNotMatch(configure, /\.localScopeAndTag\(|\.installationKey\(|\.uploadPrepared\(/)
})

test('Owner, PhotoKit, stop generation and foreground remain required after await', () => {
  assert.match(configure, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\)/)
  assert.match(configure, /XDriveIOSNativePhotoOwnerScope\.matches\(second\.owner, selected\)/)
  assert.match(configure, /store\.localStopGeneration == stopVersion/)
  assert.match(configure, /UIApplication\.shared\.applicationState == \.active/)
  assert.match(configure, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(configure, /var configured = false/)
  assert.match(configure, /if configured \{ tickIfDue\(login: login\) \}/)
  assert.match(store, /UserDefaults\.standard\.removeObject\(forKey: key\(for: owner\)\)/)
  assert.match(receipt, /count == 0/)
  assert.match(receipt, /current\.enabled, current\.pausedForReview/)
})

test('no silent pending-receipt deletion or new uploader introduced', () => {
  assert.match(configure, /请先核对；自动备份未开启/)
  assert.match(configure, /不会清除不确定收据/)
  assert.doesNotMatch(configure, /delete|clearLedger|resetLedger|UploadSessionTransport|URLSession\(/)
  assert.match(flow, /desktop\/tests\/ios-native-photo-auto-ack-enable-guard\.cjs/)
  assert.match(flow, /desktop\/tests\/ios-native-photo-receipt-review\.cjs/)
})

test('runtime manual and automatic original runs consult global existing Owner pending receipts', () => {
  const identity = read('ios/XDriveIOS/ForegroundPhotoBackupIdentity.swift')
  const preflight = identity.slice(identity.indexOf('enum XDriveIOSOriginalPendingReceiptPreflight'))
  const runner = controller.slice(controller.indexOf('    private func start('))
  const pendingRead = runner.indexOf('XDriveIOSOriginalPendingReceiptPreflight')
  const reserve = runner.indexOf('.reserveDue(owner: selected,')
  const writer = runner.indexOf('XDriveIOSForegroundPhotoBackupMVP(', reserve)
  assert.match(preflight, /existingLocalScope\(owner: owner\)/)
  assert.match(preflight, /pendingReceiptSnapshot\(scope: scope, limit: 0\)\.pending/)
  assert.match(preflight, /else \{ return 0 \}/)
  assert.doesNotMatch(preflight, /localScopeAndTag|installationKey\(|uploadPrepared|createUploadSession/)
  assert.ok(pendingRead > runner.indexOf('XDriveIOSOriginalRunGate.shared.acquire()'),
    'global original gate must be acquired before reading pending receipts')
  assert.ok(reserve > pendingRead && writer > reserve,
    'never consume a due window or create UploadSession before the global pending ACK gate')
  assert.match(runner, /try Task\.checkCancellation\(\)[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\)/)
  assert.match(runner, /if olderPending > 0 \{[\s\S]*?\.pauseForPendingReceipts\(owner: selected\)/)
  assert.match(runner, /当前账户已有 \\?\(olderPending\) 项不确定原件收据/)
  // Scope only the receipt-pause method. The subsequent explicit trusted
  // review/resume method legitimately updates nextDueAt after consent.
  const pause = store.slice(store.indexOf('func pauseForPendingReceipts('),
    store.indexOf('func resumeAfterTrustedReview('))
  assert.match(pause, /guard var state = status\(owner: owner\), state\.enabled else \{ return nil \}/)
  assert.match(pause, /state\.pausedForReview = true/)
  assert.match(pause, /try persist\(state, owner: owner\)/)
  assert.doesNotMatch(pause, /windowIndex =|nextDueAt =|libraryChangeEpoch =|libraryAuthorizationRaw =|disable\(/)
})


test('only-new consent epoch is persisted after verified managed target without skipping in-flight PhotoKit edits', () => {
  const queue = read('ios/XDriveIOS/PhotoKitPersistentBackupQueue.swift')
  const capture = configure.indexOf('consentEpoch = try XDriveIOSPhotoKitLibraryEpoch.capture()')
  const firstAuth = configure.indexOf('let first = try await login.verifiedAuthorization()')
  const managed = configure.indexOf('.readExistingForUpload(owner: selected')
  const target = configure.indexOf('managed.destination == expectedDestination')
  const install = configure.indexOf('.installNewOnlyBaseline(')
  const persistPlan = configure.indexOf('schedule = try store.configure(')
  assert.ok(capture >= 0 && capture < firstAuth)
  assert.ok(firstAuth < managed && managed < target && target < install &&
    install < persistPlan, 'a failed managed target may never advance the baseline')
  assert.equal(configure.split('.installNewOnlyBaseline(').length - 1, 1)
  assert.match(configure, /consentToken: consentEpoch\.serialized/)
  assert.match(configure, /consentAuthorization: consentEpoch\.authorization/)
  const overload = queue.slice(queue.indexOf('    func installNewOnlyBaseline(\n'),
    queue.indexOf('    /// Read only, bounded'))
  assert.match(overload, /NSKeyedUnarchiver\.unarchivedObject/)
  assert.match(overload, /store\.replaceBaselineForFreshOnlyNewConsent\(/)
  assert.match(overload, /token: consentToken, authorization: consentAuthorization/)
  // The fresh-plan scope is distinct from paused-plan resume: old SQLite
  // discovery rows never become newly authorized uploads.
  const livePlanGuard = configure.indexOf('store.status(owner: selected)?.enabled == true')
  assert.ok(livePlanGuard > configure.indexOf('XDriveIOSOriginalRunGate.shared.acquire()') &&
    livePlanGuard < configure.indexOf('.installNewOnlyBaseline('),
    'a running plan must never have its PhotoKit history reset')
  const reset = read('ios/XDriveIOS/PhotoBackupChangeQueueStore.swift')
  const fresh = reset.slice(reset.indexOf('func replaceBaselineForFreshOnlyNewConsent('),
    reset.indexOf('func completeFullReconciliation('))
  assert.match(fresh, /BEGIN IMMEDIATE/)
  for (const table of ['entries', 'failure_reasons', 'automatic_retries', 'reconciliation']) {
    assert.ok(fresh.includes(`DELETE FROM ${table}`))
  }
  assert.match(fresh, /COMMIT/)
  assert.doesNotMatch(fresh, /XDrivePhotoSyncLedger|UploadSession|deleteOriginal|deleteNode/)
  assert.match(overload, /after\.authorization == consentAuthorization/)
  assert.doesNotMatch(overload, /token: before\.serialized/)
  assert.doesNotMatch(configure, /existing.*reset.*baseline/i)
})

test('paused plan cannot bypass a missing Owner ledger by resuming or changing backup scope', () => {
  const scope = configure.indexOf('.existingLocalScope(owner: selected)')
  const checkPending = configure.indexOf('guard pending == 0 else')
  const missingLedger = configure.indexOf('else if store.hasSavedRecord(owner: selected)')
  const authority = configure.indexOf('let second = try await login.verifiedAuthorization()')
  assert.ok(scope >= 0 && checkPending > scope &&
    missingLedger > checkPending && authority > missingLedger,
    'both paused and running saved plans must prove old receipts before new consent')
  const guard = configure.slice(missingLedger, authority)
  assert.match(guard, /旧任务保持暂停/)
  assert.match(guard, /return/)
  assert.doesNotMatch(guard, /\?\.enabled == true/)
  assert.match(configure, /if startRule == \.resumePrevious/)
  assert.match(configure, /previous\.enabled == false/)
  assert.doesNotMatch(configure, /clearLedger|resetLedger|deleteReceipt/)
})

test('unreadable persisted Owner schedule cannot pose as first-time consent', () => {
  const state = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const present = state.slice(state.indexOf('func hasSavedRecord(owner:'),
    state.indexOf('func status(owner:'))
  assert.match(present, /UserDefaults\.standard\.object\(forKey: key\(for: owner\)\) != nil/)
  assert.doesNotMatch(present, /JSONDecoder|removeObject|installationKey|localScopeAndTag/)
  const setup = state.slice(state.indexOf('func configure(owner:'),
    state.indexOf('func pauseForPendingReceipts('))
  const readExisting = setup.indexOf('let existing = status(owner: owner)')
  const refuseCorrupt = setup.indexOf('guard existing != nil || !hasSavedRecord(owner: owner)')
  const save = setup.indexOf('try persist(state, owner: owner)')
  assert.ok(readExisting >= 0 && refuseCorrupt > readExisting && save > refuseCorrupt)
  assert.match(setup, /throw XDriveIOSPhotoAutoScheduleError\.persistenceUnavailable/)
  const proof = configure.slice(configure.indexOf('.existingLocalScope(owner: selected)'),
    configure.indexOf('let second = try await login.verifiedAuthorization()'))
  assert.match(proof, /else if store\.hasSavedRecord\(owner: selected\)/)
  assert.doesNotMatch(proof, /resetLedger|deleteReceipt|disable\(owner:/)
})

test('a corrupt stored plan with a readable ledger cannot mutate the PhotoKit baseline', () => {
  const verifiedTarget = configure.indexOf('managed.destination == expectedDestination')
  const corruptGuard = configure.indexOf('if store.hasSavedRecord(owner: selected),')
  const decodeGuard = configure.indexOf('store.status(owner: selected) == nil', corruptGuard)
  const installBaseline = configure.indexOf('.installNewOnlyBaseline(')
  const saveSchedule = configure.indexOf('schedule = try store.configure(')
  assert.ok(verifiedTarget >= 0 && corruptGuard > verifiedTarget &&
    decodeGuard > corruptGuard && installBaseline > decodeGuard &&
    saveSchedule > installBaseline,
  'reject an unreadable saved plan even when an encrypted ledger exists, before writing the PhotoKit token')
  const refusal = configure.slice(corruptGuard, installBaseline)
  assert.match(refusal, /未写入新的照片增量基准/)
  assert.match(refusal, /return/)
  assert.doesNotMatch(refusal, /resetLedger|deleteReceipt|removeObject|installNewOnlyBaseline/)
})

test('paused old only-new plan cannot lose queued edits during a fresh-consent crash window', () => {
  // The isolated SQLite reset occurs BEFORE the UserDefaults plan save.
  // Keeping a resumable old plan through that reset would let a crash
  // resurrect the old start date with a newer, truncated change queue.
  const tokenReset = configure.indexOf('.installNewOnlyBaseline(')
  const pausedGuard = configure.indexOf('store.status(owner: selected)?.enabled == false')
  const activeGuard = configure.indexOf('store.status(owner: selected)?.enabled == true')
  const writerGate = configure.indexOf('XDriveIOSOriginalRunGate.shared.acquire()')
  assert.ok(writerGate >= 0 && activeGuard > writerGate &&
    pausedGuard > activeGuard && pausedGuard < tokenReset)
  assert.match(configure.slice(pausedGuard, tokenReset),
    /旧自动备份任务仍已暂停保留/)
  const storeSetup = store.slice(store.indexOf('func configure(owner:'),
    store.indexOf('func pauseForPendingReceipts('))
  const savedRead = storeSetup.indexOf('let existing = status(owner: owner)')
  const boundaryGuard = storeSetup.indexOf('guard startRule != .onlyNew || existing == nil else')
  const commitPlan = storeSetup.indexOf('try persist(state, owner: owner)')
  assert.ok(savedRead >= 0 && boundaryGuard > savedRead &&
    commitPlan > boundaryGuard, 'the store must reject old plans independently')
  assert.match(storeSetup.slice(boundaryGuard, commitPlan),
    /throw XDriveIOSPhotoAutoScheduleError\.invalidStartRule/)
  const screen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
  assert.match(screen, /private var discardPausedAutoPlanButton: some View/)
  assert.match(screen, /native-ios-photos-auto-discard-paused/)
  assert.match(screen, /controller\.schedule\?\.enabled == false/)
  assert.match(screen, /autoStartRule != \.onlyNew \|\| controller\.schedule == nil/)
  assert.match(screen, /controller\.disable\(owner: owner\)/)
  // Explicit disable removes ONLY the schedule, not the sealed receipts,
  // previously uploaded CAS originals or the user's PhotoKit source.
  const disable = store.slice(store.indexOf('func disable(owner:'),
    store.indexOf('func setCatchUp('))
  assert.match(disable, /UserDefaults\.standard\.removeObject/)
  assert.doesNotMatch(disable, /XDrivePhotoSyncLedger|DELETE FROM|eraseOriginal|deleteNode/)
  assert.doesNotMatch(configure.slice(pausedGuard, tokenReset), /resetLedger|deleteReceipt/)
})
