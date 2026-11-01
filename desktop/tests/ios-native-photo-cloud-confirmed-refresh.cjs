'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const gallery = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
const authScope = read('ios/XDriveIOS/NativePhotoOwnerScope.swift')

test('only Server-confirmed original receipts refresh the cloud wall, even after a late scan failure', () => {
  const runner = controller.slice(controller.indexOf('    private func start('))
  const backup = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const callback = runner.indexOf('self?.progress = value')
  const verified = runner.indexOf('guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),', callback)
  const finalProgress = runner.indexOf('self.progress = result')
  const persist = runner.indexOf('self.schedule = try XDriveIOSPhotoAutoScheduleStore.shared.recordResult(')
  const cancelled = runner.indexOf('} catch is CancellationError {')
  const failed = runner.indexOf('} catch {', cancelled)
  const notify = runner.indexOf('if let current = self.progress, current.uploaded > 0,')
  const refresh = runner.lastIndexOf('self.refresh(owner: login.owner)')
  assert.match(controller, /struct ConfirmedOriginalUpdate: Equatable/)
  assert.match(controller, /@Published private\(set\) var confirmedOriginalUpdate/)
  assert.ok(callback >= 0 && verified > callback && finalProgress > verified)
  // The live progress closure now has its own Owner/epoch guard. Locate the
  // independent post-await guard AFTER the closure, before committing the
  // final report; do not mistake callback checks for completed-run authority.
  assert.match(runner.slice(runner.indexOf('.run(allowICloudOriginals: cloud'), callback),
    /self\?\.displayEpoch == uiEpoch,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\)/)
  assert.match(runner.slice(verified, finalProgress),
    /guard XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\),\s*self\.displayEpoch == uiEpoch else \{\s*throw XDriveIOSNativeSessionError\.staleSession/)
  assert.ok(persist > finalProgress && cancelled > persist && failed > cancelled)
  assert.ok(notify > failed && refresh > notify,
    'a successful original must refresh even if PhotoKit scanning or schedule persistence later throws')
  assert.match(backup, /case \.uploaded:\s*report\.uploaded \+= 1/)
  assert.match(runner, /guard XDriveIOSNativePhotoOwnerScope\.matches\(self\?\.runningOwner, selected\)/)
  assert.match(runner, /XDriveIOSNativePhotoOwnerScope\.matches\(self\.runningOwner, selected\),\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\)/)
  assert.match(runner, /self\.confirmedOriginalUpdate = ConfirmedOriginalUpdate\(\s*owner: selected, id: UUID\(\)\s*\)/)
  assert.doesNotMatch(runner.slice(0, notify), /confirmedOriginalUpdate = ConfirmedOriginalUpdate\(/,
    'never publish from an unfinished write, a pending receipt or an unverified Owner')
  assert.doesNotMatch(controller, /NotificationCenter\.default\.post|document\.cookie|WKWebView/)
})

test('Gallery refresh is exact Owner scoped and deferred during full-screen preview', () => {
  assert.match(dashboard, /XDriveIOSNativeCloudOriginalGallery\([\s\S]*login: login,[\s\S]*confirmedOriginalUpdate: backup\.confirmedOriginalUpdate/)
  assert.match(gallery, /\.onChange\(of: confirmedOriginalUpdate\) \{ update in/)
  assert.match(gallery, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, update.owner\)/)
  assert.match(gallery, /if selected != nil \{\s*refreshAfterViewer = true\s*\} else \{\s*model\.reload\(login: login\)/)
  assert.match(gallery, /\.fullScreenCover\(item: \$selected, onDismiss: \{[\s\S]*if refreshAfterViewer \{[\s\S]*model\.reload\(login: login\)/)
  assert.match(gallery, /\.onChange\(of: login.owner\) \{ _ in[\s\S]*?refreshAfterViewer = false[\s\S]*?selected = nil\s*model\.invalidate\(\)/)
  assert.match(controller, /!XDriveIOSNativePhotoOwnerScope\.matches\(owner, last.owner\) \{\s*confirmedOriginalUpdate = nil/)
  assert.match(authScope, /current\.instanceID == expected\.instanceID/)
  assert.doesNotMatch(gallery, /UploadSessionTransport|window\.webkit|localStorage/)
})

test('no backup uploader or signed Viewer URL is changed by a read-only refresh event', () => {
  assert.match(controller, /XDriveIOSForegroundPhotoBackupMVP\(/)
  assert.match(controller, /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/)
  assert.match(controller, /XDriveIOSPhotoAutoScheduleStore\.shared\.recordResult/)
  assert.match(gallery, /request\(url, bearer: false\)/)
  assert.match(gallery, /player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
})

test('native cloud originals recheck after scene return without treating BG writes as receipts', () => {
  const wall = gallery.slice(gallery.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'));
  const model = gallery.slice(gallery.indexOf('final class XDriveIOSNativeCloudOriginalModel'),
    gallery.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'));
  assert.match(wall, /@Environment\(\\\.scenePhase\) private var phase/);
  assert.match(wall, /@State private var needsForegroundReload = false/);
  assert.match(wall, /\.task \{[\s\S]*?guard phase == \.active else \{[\s\S]*?needsForegroundReload = true/);
  assert.match(wall, /\.onChange\(of: phase\) \{ state in/);
  assert.match(wall, /if state != \.active \{[\s\S]*?needsForegroundReload = true[\s\S]*?model\.cancel\(\)/);
  assert.match(wall, /guard needsForegroundReload else \{ return \}/);
  assert.match(wall, /guard login\.owner != nil else \{[\s\S]*?model\.invalidate\(\)/);
  assert.match(wall, /if selected != nil \{[\s\S]*?refreshAfterViewer = true[\s\S]*?\} else \{[\s\S]*?model\.reload\(login: login\)/);
  assert.match(wall, /if phase != \.active \{[\s\S]*?needsForegroundReload = true[\s\S]*?return/);
  assert.match(wall, /if login\.owner != nil \{[\s\S]*?if phase == \.active \{[\s\S]*?model\.reload\(login: login\)/);
  // A failed login/root re-verification must drop the prior page immediately:
  // requiring a bare `let auth = try` would forbid that stronger fail-closed path.
  assert.match(model, /let auth: \(owner: XDriveNativeOwnerRoot, accessToken: String\)/);
  assert.match(model, /auth = try await login\.verifiedAuthorization\(\)/);
  assert.match(model, /catch is CancellationError \{\s*throw CancellationError\(\)/);
  assert.match(model, /catch \{\s*guard self\?\.epoch == ticket else \{ return \}\s*self\?\.invalidate\(\)/);
  assert.match(model, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\),\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/);
  assert.doesNotMatch(wall, /UploadSessionTransport|markUploaded|recordResult\(/);
});

test('read-only confirmed receipt reconciliation refreshes the exact Owner cloud wall once', () => {
  const receiptReview = read('ios/XDriveIOS/NativePhotoReceiptReviewController.swift')
  const backupScreen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
  const recovery = read('ios/XDriveIOS/PhotoBackupUncertainReceiptRecovery.swift')
  const review = receiptReview.slice(receiptReview.indexOf('    func reconcile('),
    receiptReview.indexOf('    func resumePausedBackground('))
  const tally = review.indexOf('var tally = Summary()')
  const signal = review.indexOf('self.confirmedReadback = ConfirmedReadback(')
  const loop = review.indexOf('for record in snapshot.batch {')
  const confirmed = review.indexOf('case .confirmed:')
  const pending = review.indexOf('self.pending = latest.pending')
  assert.ok(tally > 0 && signal > tally && signal < loop &&
    confirmed > loop && pending > confirmed,
    'signal from deferred, previously verified receipts, including a partial read-only review')
  assert.match(review, /defer \{\s*if tally\.confirmed > 0, self\.generation == epoch,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(review, /case \.confirmed:\s*tally\.confirmed \+= 1/)
  assert.match(receiptReview, /struct ConfirmedReadback: Equatable \{\s*let owner: XDriveNativeOwnerRoot\s*let id: UUID/)
  assert.match(receiptReview, /func cancel\(\) \{[\s\S]*?generation = UUID\(\)[\s\S]*?confirmedReadback = nil/)
  assert.match(review, /confirmedReadback = nil[\s\S]*?mode = \.reviewing/)
  assert.match(recovery, /XDriveIOSNodeReceiptReadbackVerifier\(/)
  assert.match(recovery, /let updated = try await ledger\.confirmReceipt\(/)
  assert.match(recovery, /guard updated\.state == \.confirmed/)
  assert.match(backupScreen, /\.onChange\(of: receipts\.confirmedReadback\) \{ readback in\s*guard let readback else \{ return \}[\s\S]*?controller\.signalConfirmedReceiptReadback\(\s*owner: readback\.owner, login: login\s*\)/)
  const forward = controller.slice(controller.indexOf('    func signalConfirmedReceiptReadback('),
    controller.indexOf('    func cancel()'))
  assert.match(forward, /guard XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\) else \{ return \}/)
  assert.match(forward, /confirmedOriginalUpdate = ConfirmedOriginalUpdate\(owner: owner, id: UUID\(\)\)/)
  assert.doesNotMatch(forward, /uploadPrepared|recordResult|reserveDue|UploadSession|URLSession/)
  assert.match(gallery, /\.onChange\(of: confirmedOriginalUpdate\) \{ update in[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, update\.owner\)/)
  assert.match(gallery, /if selected != nil \{\s*refreshAfterViewer = true\s*\} else \{\s*model\.reload\(login: login\)/)
  assert.doesNotMatch(review, /uploadPrepared\(|uploadOnce\(|\.finalize\(|\.beginCreate\(/)
})
test('confirmed original temporary readback outage retains cursor instead of an uncertain-write pause', () => {
  const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const original = read('ios/XDriveIOS/OriginalOwnerAuthorization.swift')
  const background = read('ios/XDriveIOS/BackgroundPhotoTask.swift')
  const confirmed = runner.slice(runner.indexOf('case .confirmed:'),
    runner.indexOf('case .prepared:', runner.indexOf('case .confirmed:')))
  const classification = runner.slice(
    runner.indexOf('private static func isTransientConfirmedReadbackFailure('),
    runner.indexOf('private enum StillOutcome'))
  const scanning = runner.slice(runner.indexOf('scanning: while'),
    runner.indexOf('private static func mustAbortRun('))
  assert.match(confirmed, /return \.alreadyConfirmed/)
  assert.match(confirmed, /if Self\.isTransientConfirmedReadbackFailure\(error\) \{ throw error \}/)
  assert.match(confirmed, /return \.requiresReview/)
  assert.ok(confirmed.indexOf('isTransientConfirmedReadbackFailure(error)') <
    confirmed.lastIndexOf('return .requiresReview'))
  assert.match(scanning, /if Self\.isTransientConfirmedReadbackFailure\(error\) \|\|\s*Self\.mustAbortRun\(after: error\) \{ throw error \}/)
  assert.match(scanning, /await scanner\.reset\(\)\s*throw error/)
  assert.match(scanning, /case \.requiresReview:\s*report\.needsReview \+= 1\s*report\.stoppedForReview = true/)
  assert.match(classification, /error is URLError/)
  assert.match(classification, /case \.serverRejected\(let code\) = readback/)
  assert.match(classification, /case \.serverStatus\(let code\) = owner/)
  assert.match(classification, /code == 408 \|\| code == 429 \|\| \(500\.\.\.599\)\.contains\(code\)/)
  assert.doesNotMatch(classification, /code == 401|code == 403|code == 404|confirmReceipt|UploadSession/)
  const verify = original.slice(original.indexOf('private struct XDriveIOSBGOriginalNodeReceiptVerifier'),
    original.length)
  const status = verify.indexOf('throw XDriveIOSNodeReceiptReadbackError.serverRejected(http.statusCode)')
  const mismatch = verify.lastIndexOf('throw XDriveIOSNodeReceiptReadbackError.missingOrInconsistentNode')
  assert.ok(status > 0 && mismatch > status,
    'read-only transient HTTP status must be distinguished from file mismatch')
  const helper = background.slice(background.indexOf('private static func retryablePreflightNetworkFailure('),
    background.indexOf('private static func resubmitOnlyIfStillApproved('))
  assert.match(helper, /case \.serverRejected\(let code\) = readback/)
  assert.match(helper, /case \.serverStatus\(let code\) = owner/)
  assert.match(helper, /guard let network = error as\? URLError else \{ return false \}/)
  const failed = background.slice(background.indexOf('} catch is CancellationError {'),
    background.indexOf('task.expirationHandler ='))
  assert.match(failed, /if beganOriginalWrite, let attemptedOwner \{[\s\S]*?BGOriginalWindowStore\.shared\.pause/)
  assert.match(failed, /else if retryablePreflightNetworkFailure\(error\) \{[\s\S]*?await resubmitOnlyIfStillApproved/)
  assert.doesNotMatch(confirmed + classification, /ledger\.confirmReceipt|writer\.uploadPrepared|recordResult\(/)
})


test('temporary background grant proof does not masquerade as revoked Owner or pending receipt', () => {
  const vault = read('ios/XDriveIOS/ApprovedBackgroundPhotoVault.swift')
  const auth = read('ios/XDriveIOS/OriginalOwnerAuthorization.swift')
  const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const task = read('ios/XDriveIOS/BackgroundPhotoTask.swift')
  const proof = vault.slice(vault.indexOf('func proveInBackground()'),
    vault.indexOf('private func base()', vault.indexOf('func proveInBackground()')))
  const bgVerify = auth.slice(auth.indexOf('case .background(let approved):'),
    auth.indexOf('func transport('))
  const transient = runner.slice(runner.indexOf('private static func isTransientConfirmedReadbackFailure('),
    runner.indexOf('private enum StillOutcome'))
  const retry = task.slice(task.indexOf('private static func retryablePreflightNetworkFailure('),
    task.indexOf('private static func resubmitOnlyIfStillApproved('))
  const confirmed = runner.slice(runner.indexOf('case .confirmed:'),
    runner.indexOf('case .prepared:', runner.indexOf('case .confirmed:')))
  assert.match(vault, /case transientServerStatus\(Int\)/)
  assert.match(proof, /guard http\.statusCode == 200 else \{/)
  assert.match(proof, /http\.statusCode == 408 \|\| http\.statusCode == 429 \|\|\s*\(500\.\.\.599\)\.contains\(http\.statusCode\)/)
  assert.match(proof, /throw XDriveIOSPhotoBGVaultFailure\.transientServerStatus\(http\.statusCode\)/)
  assert.match(proof, /throw XDriveIOSPhotoBGVaultFailure\.serverRejected/)
  assert.ok(proof.indexOf('throw XDriveIOSPhotoBGVaultFailure.transientServerStatus') <
    proof.indexOf('throw XDriveIOSPhotoBGVaultFailure.serverRejected'))
  assert.match(bgVerify, /guard approved\.matches\(owner\) else \{\s*throw XDrivePhotoSyncLedgerError\.identityMismatch/)
  assert.match(bgVerify, /let verified = try await XDriveIOSApprovedPhotoBGVault\.shared\s*\.proveInBackground\(\)/)
  assert.doesNotMatch(bgVerify, /let verified = try\? await/)
  assert.match(bgVerify, /verified\.grantID == approved\.grantID/)
  assert.match(bgVerify, /verified\.deviceID == approved\.deviceID/)
  assert.match(bgVerify, /verified\.instanceID == owner\.instanceID/)
  const wholeRun = runner.slice(runner.indexOf('private static func mustAbortRun('),
    runner.indexOf('private static func isTransientConfirmedReadbackFailure('))
  assert.match(wholeRun, /error is XDriveIOSPhotoBGVaultFailure/)
  assert.match(transient, /case \.transientServerStatus\(let code\) = grant/)
  assert.match(retry, /case \.transientServerStatus\(let code\) = grant/)
  assert.match(confirmed, /if Self\.isTransientConfirmedReadbackFailure\(error\) \{ throw error \}/)
  assert.match(confirmed, /return \.requiresReview/)
  assert.match(task, /if beganOriginalWrite, let attemptedOwner \{[\s\S]*?BGOriginalWindowStore\.shared\.pause/)
  assert.doesNotMatch(proof + bgVerify + retry,
    /URLSessionConfiguration\.background|createUploadSession|confirmReceipt|window\.webkit|localStorage/)
})
