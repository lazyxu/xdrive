'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const exists = p => fs.existsSync(path.join(root, p));

test('native iPhone IPA has no fallback WebKit/PWA UI or JavaScript Photo Host', () => {
  for (const p of [
    'ios/XDriveIOS/XDriveWebAppHome.swift',
    'ios/XDriveIOS/IOSPhotoHostBridge.swift',
    'ios/XDriveIOS/WebDownloadCoordinator.swift',
    'web/src/iosPhotoHostAdapter.ts',
    'web/src/iosForegroundAutoScheduler.ts',
    'ui/shared/src/mui/IOSPhotoBackupSettings.tsx',
  ]) assert.equal(exists(p), false, 'retired fallback still present: ' + p);
  const app = read('ios/XDriveIOS/XDriveIOSApp.swift');
  const native = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift');
  const model = read('ios/XDriveIOS/NativeOwnerLoginModel.swift');
  const project = read('ios/project.yml');
  assert.match(app, /XDriveIOSNativeOwnerLoginScreen\(\)/);
  assert.match(native, /XDriveIOSNativePhotosDashboard\(/);
  assert.doesNotMatch(app + native + model, /import WebKit|WKWebView|XDriveWebAppHome|ios\.web\.origin/);
  assert.match(model, /xdrive\.ios\.native\.last-server/);
  assert.match(project, /- path: XDriveIOS/);
});

test('browser Web/PWA has no native WebKit-only iOS handler or photo schedule bridge', () => {
  const app = read('web/src/App.tsx');
  const mui = read('ui/shared/src/mui/index.tsx');
  assert.doesNotMatch(app + mui, /iosPhotoHostAdapter|iosForegroundAutoScheduler|IOSPhotoBackupSettings|iosPhotoHost|iosPhotoSession|iosNativeHost/);
  assert.match(app, /PwaOfflineDirectorySection/);
});

test('retired refresh credential purge remains narrowly scoped; original backup security remains', () => {
  const retired = read('ios/XDriveIOS/IOSRetiredNativeLogin.swift');
  const native = read('ios/XDriveIOS/NativeOwnerSessionStore.swift');
  const auto = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift');
  const bg = read('ios/XDriveIOS/PhotoBackgroundGrantManager.swift');
  assert.match(retired, /com\.lazyxu\.xdrive\.ios\.session/);
  assert.match(retired, /xdrive\.refresh/);
  assert.match(retired, /SecItemDelete\(exactLegacyQuery/);
  assert.match(native, /com\.lazyxu\.xdrive\.ios\.native-owner-session\.v2/);
  assert.match(auto, /disableAllOnThisDevice/);
  assert.match(bg, /emergencyStopLocally/);
  assert.doesNotMatch(retired, /WKWebView|import WebKit|URLSession|setCookie/);
});
