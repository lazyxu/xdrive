'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const login = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift');
const dash = read('ios/XDriveIOS/NativePhotosDashboard.swift');

test('verified native Owner is a root state, not an extra push or confirmation page', () => {
  assert.match(login, /if !restoreFinished/);
  assert.match(login, /await model\.restore\(\)\s*restoreFinished = true/);
  assert.match(login, /else if model\.owner != nil\s*\{[\s\S]*?XDriveIOSNativePhotosDashboard\(/);
  assert.match(login, /else \{\s*NavigationStack \{\s*loginPage/);
  assert.doesNotMatch(login, /showingNativeWorkspace|verifiedAccount\(|navigationDestination\(|已验证的原生账户|native-ios-photos-open/);
  assert.doesNotMatch(login, /WebView|document\.cookie/);
});

test('Mine owns the actual sign-out/server switch; old account interstitial is unreachable', () => {
  assert.match(dash, /private var mine: some View/);
  assert.match(dash, /LabeledContent\("Owner"/);
  assert.match(dash, /onSignOut\(\)/);
  assert.match(dash, /native-ios-login-signout/);
  assert.match(dash, /\.disabled\(signingOut\)/);
  assert.doesNotMatch(dash, /返回服务器与账号管理|native-ios-mine-server-account|dismiss\(\)/);
});

test('security-first logout and durable runner survive the direct-root cutover', () => {
  const signOut = login.slice(login.indexOf('private func signOutSafely() async'));
  const steps = [
    'guard !signOutBusy else { return }',
    'XDriveIOSOriginalRunGate.shared.acquire()',
    'XDriveIOSPhotoAutoScheduleStore.shared.disableAllOnThisDevice()',
    'XDriveIOSBackgroundPhotoTask.revokePendingRequests()',
    '.emergencyStopLocally()',
    'await model.signOut()',
    'XDriveIOSNativeNavigationRouteStore().clear()'
  ].map(x => signOut.indexOf(x));
  assert.ok(steps.every(x => x >= 0) && steps.every((x, i) => i === 0 || x > steps[i-1]));
  assert.match(login, /@StateObject private var backup = XDriveIOSNativePhotoBackupController/);
  assert.match(login, /backup\.cancel\(\)/);
  assert.match(login, /backup\.tickIfDue\(login: model\)/);
  assert.match(login, /logoutWarning = "无法确认旧账户后台凭据已清除/);
  assert.match(login, /guard await model\.signOut\(\) else \{/);
  assert.match(login, /本机登录凭据未能从 Keychain 清除/);
  assert.ok(signOut.indexOf('guard await model.signOut() else') <
    signOut.indexOf('XDriveIOSNativeNavigationRouteStore().clear()'));
});
