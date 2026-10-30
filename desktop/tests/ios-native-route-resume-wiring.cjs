'use strict'
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ui = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeNavigationRouteStore.swift'), 'utf8');

test('native shell restores route hints only after verified Owner', () => {
  assert.match(ui, /import CryptoKit/);
  assert.match(ui, /private var navigationScopeHash: String\?/);
  assert.match(ui, /guard login\.owner != nil else \{ return nil \}/);
  assert.match(ui, /SHA256\.hash\(data: Data\(ownerScopeKey\.utf8\)\)/);
  assert.match(ui, /private func restoreNavigationIfNeeded\(\)/);
  assert.match(ui, /navigationRouteStore\.restore\(scopeHash: scopeHash\)/);
  assert.match(ui, /\.onAppear \{\s*restoreNavigationIfNeeded\(\)/);
  assert.match(ui, /private func saveNavigationIfReady\(\)/);
  assert.match(ui, /\.onChange\(of: tab\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /\.onChange\(of: gallerySource\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /\.onChange\(of: dynamicFeature\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /\.onChange\(of: recentDynamic\) \{ _ in saveNavigationIfReady\(\) \}/);
});

test('switching Owner/Root/Server invalidates previous navigation and avoids backup cancellation', () => {
  assert.match(ui, /\.onChange\(of: ownerScopeKey\) \{ _ in[\s\S]*?navigationRouteStore\.clear\(\)[\s\S]*?resetNavigation\(\)/);
  // The verified workspace is now the root, not a NavigationStack push.
  // The root owns logout and clears persisted hints even when the dashboard
  // unmounts before its Owner-change callback can run.
  const login = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8'
  );
  assert.match(ui, /\.onChange\(of: login\.owner\) \{ owner in\s*if owner == nil \{\s*navigationRouteStore\.clear\(\)\s*resetNavigation\(\)/);
  assert.doesNotMatch(ui, /dismiss\(\)/);
  assert.match(login, /await model\.signOut\(\)[\s\S]*?XDriveIOSNativeNavigationRouteStore\(\)\.clear\(\)/);
  assert.match(login, /guard let gate = XDriveIOSOriginalRunGate\.shared\.acquire\(\)/);
  assert.match(ui, /activeDynamic: dynamicFeature\?\.implemented == true \? dynamicFeature\?\.rawValue : nil/);
  assert.match(routes, /saved\.scopeHash == scopeHash/);
  assert.match(routes, /recentDynamic\.filter \{ \$0 == "backup" \}/);
  assert.match(routes, /data\.count <= 2048/);
  assert.doesNotMatch(routes, /accessToken|refreshToken|PhotoKitID|signedURL|backupReceipt/);
  assert.doesNotMatch(ui, /WKWebView|document\.cookie/);
});
