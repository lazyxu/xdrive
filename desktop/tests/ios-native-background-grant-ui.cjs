'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ui = read('ios/XDriveIOS/NativePhotoBackupScreen.swift');
const control = read('ios/XDriveIOS/NativePhotoBackgroundControls.swift');
const manager = read('ios/XDriveIOS/PhotoBackgroundGrantManager.swift');
const task = read('ios/XDriveIOS/BackgroundPhotoTask.swift');

test('native Photos exposes explicit Owner/Root/Device BG consent and honest status', () => {
  for (const id of ['native-ios-photo-background-enable',
    'native-ios-photo-background-disable', 'native-ios-photo-background-status']) {
    assert.ok(ui.includes(id), 'missing ' + id);
  }
  assert.match(ui, /@StateObject private var background = XDriveIOSNativeBackgroundPhotoControls\(\)/);
  assert.match(ui, /Section\("可选系统后台原件备份"\)/);
  assert.match(ui, /state\.revokePending/);
  assert.match(ui, /background\.serverVerified/);
  assert.match(ui, /强制退出后不保证运行/);
  assert.match(ui, /每次最多新增 1 个原件/);
  assert.match(ui, /backgroundEnableOwner = login\.owner/);
  assert.match(ui, /backgroundDisableOwner = login\.owner/);
  assert.match(ui, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\)/);
  assert.match(ui, /background\.enable\(login: login, expectedOwner: selected\)/);
  assert.match(ui, /background\.disable\(login: login, expectedOwner: selected\)/);
  assert.match(ui, /background\.invalidateRead\(\)/);
  assert.doesNotMatch(ui, /WKWebView|document\.cookie|grantSecret|deviceToken|accessToken/);
});

test('enable never bypasses pending original receipts, old grants or Owner revocation', () => {
  const enable = control.slice(control.indexOf('func enable('), control.indexOf('func disable('));
  assert.match(enable, /status\?\.enrolled == false/);
  assert.match(enable, /UIApplication\.shared\.applicationState == \.active/);
  assert.match(enable, /PHPhotoLibrary\.authorizationStatus/);
  assert.match(enable, /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/);
  assert.match(enable, /XDriveIOSOriginalRunGate\.shared\.release\(gate\)/);
  assert.match(enable, /XDriveIOSPhotoAutoScheduleStore\.shared\.localStopGeneration/);
  assert.match(enable, /existingLocalScope\(owner: expectedOwner\)/);
  assert.match(enable, /pendingReceiptSnapshot\(scope: scope, limit: 0\)/);
  assert.match(enable, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expectedOwner\)/);
  assert.match(enable, /manager\.enableAfterNativeConfirmation\(/);
  assert.match(enable, /manager\.verifyRemote\(/);
  assert.match(enable, /remote\.enabled/);
  assert.match(manager, /guard try !localStatus\(owner: owner\)\.enrolled/);
  assert.match(manager, /guard try await XDriveIOSApprovedPhotoBGVault\.shared\.current\(\) == nil/);
  assert.doesNotMatch(enable, /XDriveIOSForegroundPhotoBackupMVP\(|UploadSessionTransport\(|WKWebView/);
});

test('stop is local-first, offline-safe and cannot silently revoke another Owner', () => {
  const disable = control.slice(control.indexOf('func disable('));
  assert.match(disable, /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/);
  assert.ok(disable.indexOf('manager.stopLocally(owner: expectedOwner)') <
    disable.indexOf('login.verifiedAuthorization()'));
  assert.ok(disable.indexOf('login.verifiedAuthorization()') <
    disable.indexOf('manager.disable('));
  assert.match(disable, /localStopped = true/);
  assert.match(disable, /本机已停止，远端撤销待网络恢复后重试/);
  const local = manager.slice(manager.indexOf('func stopLocally('),
    manager.indexOf('/// Disable immediately in the local persisted state', manager.indexOf('func stopLocally(')));
  assert.match(local, /XDriveIOSApprovedPhotoBGVault\.shared\.current\(\)/);
  assert.match(local, /XDriveIOSNativePhotoOwnerScope\.matches\(existingOwner, owner\)/);
  assert.match(local, /XDriveIOSBackgroundPhotoTask\.revokePendingRequests\(\)/);
  assert.match(local, /try await emergencyStopLocally\(\)/);
  const emergency = manager.slice(manager.indexOf('func emergencyStopLocally('),
    manager.indexOf('func stopLocally('));
  assert.match(emergency, /XDriveIOSApprovedPhotoBGVault\.shared\.cancelLocally\(owner: owner\)/);
  assert.match(emergency, /pending = IOSPhotoNativeGrant\(/);
  assert.match(emergency, /pending\.revokePending = true/);
  assert.match(emergency, /try save\(pending, owner: owner\)/);
  assert.match(local, /stored\.revokePending = true/);
  assert.match(local, /try save\(stored, owner: owner\)/);
  assert.doesNotMatch(local, /try await verifyOwner\(/);
});

test('mutable root revision is not identity; BGTask remains bounded and fail-closed', () => {
  const proof = manager.slice(manager.indexOf('private func verifyOwner('),
    manager.indexOf('private func request(', manager.indexOf('private func verifyOwner(')));
  assert.match(proof, /XDriveIOSNativePhotoOwnerScope\.matches\(current, owner\)/);
  assert.doesNotMatch(proof, /current == owner/);
  assert.match(task, /UIApplication\.shared\.isProtectedDataAvailable/);
  assert.match(task, /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/);
  assert.match(task, /XDriveIOSForegroundPhotoBackupMVP\(/);
  assert.match(task, /maximumNewOriginals: 1/);
  assert.match(task, /progress\.needsReview == 0/);
  assert.doesNotMatch(control, /document\.cookie|window\.webkit|UserDefaults|grantSecret|deviceToken/);
});
