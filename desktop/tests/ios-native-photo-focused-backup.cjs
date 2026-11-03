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
