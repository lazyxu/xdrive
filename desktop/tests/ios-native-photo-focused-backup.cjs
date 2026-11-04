'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const policy = read('ios/XDriveIOS/PhotoFocusedBackupPolicy.swift');
const checks = read('ios/tests/PhotoFocusedBackupPolicyChecks.swift');
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift');
const ui = read('ios/XDriveIOS/NativePhotoBackupScreen.swift');
const rootScreen = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift');
const writer = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift');

test('focused window algorithm cannot skip a partial capped 256-item window', () => {
  assert.match(policy, /XDrivePhotoBackupScanWindow\.offset\(for: index\)/);
  assert.match(policy, /XDrivePhotoBackupScanWindow\.capacity\(/);
  assert.match(policy, /case repeatWindow\(Int\)/);
  assert.match(policy, /case nextWindow\(Int\)/);
  assert.match(policy, /case pausedForReview/);
  assert.match(policy, /case invalidProgress/);
  assert.match(policy, /uploaded == XDriveIOSPhotoAutoSchedulePolicy\.maxNewFiles/);
  assert.match(policy, /if needsReview \{ return \.pausedForReview \}/);
  assert.match(checks, /100_000/);
  assert.match(checks, /repeatWindow\(0\)/);
  assert.match(checks, /\.pausedForReview/);
  assert.doesNotMatch(policy, /UserDefaults|Keychain|URLSession|PHAsset|UploadSession|SecItem/);
});

test('focused backup is explicit, native, Owner-bound and not a hidden BG grant', () => {
  assert.match(ui, /showFocusedConsent/);
  assert.match(ui, /focusedConsentOwner = login\.owner/);
  assert.match(ui, /focusedConsentAllowICloud = allowICloud/);
  assert.match(ui, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/);
  assert.match(ui, /controller\.startFocused\(/);
  for (const id of ['native-ios-photos-focused-start',
    'native-ios-photos-focused-confirm', 'native-ios-photos-focused-progress']) {
    assert.ok(ui.includes(id), 'missing ' + id);
  }
  const focusEntry = controller.slice(controller.indexOf('func startFocused('),
    controller.indexOf('func tickIfDue('));
  assert.match(focusEntry, /expectedOwner: XDriveNativeOwnerRoot/);
  assert.match(focusEntry, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\)/);
  assert.match(focusEntry, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/);
  assert.match(focusEntry, /kind: \.focused/);
  assert.doesNotMatch(focusEntry, /URLSession|Keychain|BGTask|UserDefaults/);
  assert.match(rootScreen, /else \{ backup\.cancel\(\) \}/);
  const lifecycle = ui.slice(ui.indexOf('.onDisappear'), ui.indexOf('    // Native Form Sections'));
  assert.match(lifecycle, /showFocusedConsent = false/);
  assert.match(lifecycle, /focusedConsentOwner = nil/);
});

test('focused work holds the established serial gate and global uncertain-receipt preflight', () => {
  const start = controller.slice(controller.indexOf('private func start('),
    controller.indexOf('private func runFocused('));
  assert.match(start, /guard !busy, running == nil/);
  assert.match(start, /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/);
  assert.match(start, /XDriveIOSOriginalRunGate\.shared\.release\(gate\)/);
  assert.ok(start.indexOf('pendingCount(owner: selected)') <
    start.indexOf('if kind == .focused'), 'global pending ACK gate before focused batches');
  assert.match(start, /runFocused\(/);
  assert.match(start, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\)/);
  assert.match(start, /focusedSummary\?\.confirmedNew/);
  const focus = controller.slice(controller.indexOf('private func runFocused('));
  assert.match(focus, /while true/);
  assert.match(focus, /Task\.checkCancellation\(\)/);
  assert.match(focus, /UIApplication\.shared\.applicationState == \.active/);
  assert.match(focus, /login\.verifiedAuthorization\(\)/);
  assert.match(focus, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, owner\)/);
  assert.match(focus, /XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/);
  assert.match(focus, /XDriveIOSPhotoKitLibraryEpoch\.matches\(/);
  assert.match(focus, /XDriveIOSPhotoFocusedBackupPolicy\.afterWindow\(/);
  assert.match(focus, /case \.pausedForReview:/);
  assert.match(focus, /case \.invalidProgress:/);
  assert.match(focus, /\.run\(allowICloudOriginals: allowICloud, startOffset: offset\)/);
  assert.doesNotMatch(focus, /reserveDue\(|recordResult\(|scheduleApprovedProbe\(|UploadSessionTransport\(|BGProcessingTask|UserDefaults|SecItem/);
  assert.match(writer, /static let maxScannedAssets = XDrivePhotoBackupScanWindow\.maxItems/);
  assert.match(writer, /static let maxNewOriginalsPerRun = 20/);
});

test('status reports source scan, verified new bytes and interrupted/limited states truthfully', () => {
  assert.match(controller, /focusedSummary\?\.confirmedNew/);
  assert.match(controller, /state\.completedWindows = state\.totalWindows/);
  assert.match(controller, /state\.finishedScan = true/);
  assert.match(controller, /state\.pausedForReview = true/);
  assert.match(controller, /hadUnavailable = hadUnavailable \|\| result\.unavailable/);
  assert.match(controller, /XDriveIOSFocusedBackupFailure\.libraryChanged/);
  assert.match(ui, /不代表远端全部原件已逐张核验/);
  assert.match(ui, /不计作备份成功/);
  assert.match(ui, /仅扫描当前 iOS 授权的照片/);
  assert.match(ui, /停止集中备份/);
  assert.doesNotMatch(ui, /100%.*备份成功|所有照片均已备份/);
});

test('focused restart checkpoint is scoped, verified and never interpreted as upload success', () => {
  const checkpoint = read('ios/XDriveIOS/PhotoFocusedResumeStore.swift');
  const focus = controller.slice(controller.indexOf('private func runFocused('));
  const start = controller.slice(controller.indexOf('private func start('),
    controller.indexOf('private func runFocused('));
  const resumeTests = read('ios/tests/PhotoFocusedBackupPolicyChecks.swift');

  assert.match(policy, /static func validCheckpoint\(/);
  assert.match(policy, /static func trustedResumeWindow\(/);
  assert.match(policy, /currentVisible == previousVisible/);
  assert.match(policy, /priorAuthorization == currentAuthorization/);
  assert.match(policy, /previousAllowICloud == allowICloud/);
  assert.match(policy, /tokenUnchanged/);
  assert.match(resumeTests, /resume\(390, 100_000, 100_000\) == 390/);
  assert.match(resumeTests, /resume\(1, 600, 601\) == 0/);
  assert.match(resumeTests, /resume\(1, 600, 600, 3, 3, false\) == 0/);
  assert.match(resumeTests, /resume\(1, 600, 600, 3, 3, true, false, true\) == 0/);

  // The persisted position has no bearer, grant, filename, asset identifier
  // or per-asset uploaded state; real receipts remain in the sealed ledger.
  assert.match(checkpoint, /owner\.origin\.absoluteString/);
  assert.match(checkpoint, /owner\.instanceID/);
  assert.match(checkpoint, /owner\.ownerID/);
  assert.match(checkpoint, /owner\.rootNodeID/);
  assert.match(checkpoint, /XDriveIOSPhotoFocusedBackupPolicy\.trustedResumeWindow\(/);
  assert.match(checkpoint, /XDriveIOSPhotoKitLibraryEpoch\.matches\(/);
  assert.match(checkpoint, /func saveCompletedWindow\(/);
  assert.match(checkpoint, /XDriveIOSPhotoFocusedBackupPolicy\.canSaveCheckpoint\(/);
  assert.match(checkpoint, /!state\.hadUnavailable/);
  assert.match(policy, /static func canSaveCheckpoint\(/);
  assert.match(policy, /!hadUnavailable && validCheckpoint\(/);
  assert.match(resumeTests, /unresolvedInEarlierWindow/);
  assert.match(checkpoint, /func clear\(owner: XDriveNativeOwnerRoot\)/);
  assert.doesNotMatch(checkpoint, /localIdentifier|accessToken|grantSecret|deviceToken|uploadPrepared|UploadSessionTransport|URLSession|PHAsset|SecItem/);

  // The caller must verify current Owner + unresolved ACKs under the gate
  // BEFORE it can read or use a saved cursor.
  const gate = start.indexOf('XDriveIOSOriginalRunGate.shared.acquire()');
  const pending = start.indexOf('pendingCount(owner: selected)');
  const focused = start.indexOf('try await self.runFocused(');
  assert.ok(gate >= 0 && pending > gate && focused > pending);
  assert.match(focus, /let visibleNow = PHAsset\.fetchAssets\(with: nil\)\.count/);
  assert.match(focus, /let afterCount = try XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/);
  assert.ok(focus.indexOf('let afterCount =') < focus.indexOf('.resume('));
  assert.match(focus, /var window = resume\.nextWindow/);
  assert.match(focus, /var hadUnavailable = resume\.hadUnavailable/);
  assert.match(focus, /var expectedTotal: Int\? = visibleNow/);
  assert.match(focus, /case \.nextWindow\(let next\):[\s\S]*?if !hadUnavailable \{[\s\S]*?saveCompletedWindow\([\s\S]*?state\.completedWindows \+= 1/);
  assert.match(focus, /case \.finished:\s*XDriveIOSPhotoFocusedResumeStore\.shared\.clear\(owner: owner\)/);
  assert.match(focus, /case \.pausedForReview:[\s\S]*?state\.pausedForReview = true/);
  assert.match(ui, /native-ios-photos-focused-resumed-window/);
  assert.match(ui, /本次确认新增/);
  assert.match(ui, /不代表全部云端原件已备份/);
});


test('focused display dims after ten seconds only while foreground focused backup runs', () => {
  assert.match(ui, /private var focusedPresentationActive: Bool/);
  assert.match(ui, /controller\.busy && \(controller\.focusedSummary\?\.totalWindows \?\? 0\) > 0/);
  assert.match(ui, /phase == \.active && login\.owner != nil/);
  assert.match(ui, /\.task\(id: /);
  assert.match(ui, /Task\.sleep\(nanoseconds: 10_000_000_000\)/);
  assert.match(ui, /guard !Task\.isCancelled && focusedPresentationActive else \{ return \}/);
  assert.match(ui, /if focusedPresentationActive && focusedDimmed/);
  assert.match(ui, /focusedWakeCounter &\+= 1/);
  assert.match(ui, /native-ios-photos-focused-dim-overlay/);
  assert.match(ui, /已扫描.*completedWindows.*totalWindows.*段/);
  assert.match(ui, /本次确认新增.*confirmedNew.*个原件/);
});

test('focused screen scoped keep-awake restores prior device setting on every exit', () => {
  const lease = ui.slice(ui.indexOf('private func updateFocusedIdleTimer('),
    ui.indexOf('    var body: some View'));
  assert.match(lease, /previousIdleTimerDisabled = UIApplication\.shared\.isIdleTimerDisabled/);
  assert.match(lease, /UIApplication\.shared\.isIdleTimerDisabled = true/);
  assert.match(lease, /UIApplication\.shared\.isIdleTimerDisabled = previousIdleTimerDisabled/);
  assert.match(lease, /self\.previousIdleTimerDisabled = nil/);
  assert.match(ui, /\.onChange\(of: focusedPresentationActive\)/);
  assert.match(ui, /\.onDisappear \{[\s\S]*?updateFocusedIdleTimer\(active: false\)/);
  assert.match(ui, /\.onAppear \{[\s\S]*?updateFocusedIdleTimer\(active: focusedPresentationActive\)/);
  assert.match(ui, /phase == \.active/);
  const presentation = ui.slice(ui.indexOf('// Synology-style focused display:'),
    ui.indexOf('        .navigationTitle("相册备份")'));
  assert.doesNotMatch(presentation, /UploadSession|ledger\.prepare|reserveDue|runFocused|BGTaskScheduler/);
});
