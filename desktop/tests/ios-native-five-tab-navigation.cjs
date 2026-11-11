'use strict'
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ui = read('ios/XDriveIOS/NativePhotosDashboard.swift');
const local = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift');
const albums = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift');
test('native bottom destinations have fixed order and only one dynamic slot', () => {
  const order = [
    '.tag(XDriveIOSNativeBottomTab.launcher)',
    '.tag(XDriveIOSNativeBottomTab.dynamic)',
    '.tag(XDriveIOSNativeBottomTab.gallery)',
    '.tag(XDriveIOSNativeBottomTab.files)',
    '.tag(XDriveIOSNativeBottomTab.mine)'
  ].map(x => ui.indexOf(x));
  assert.ok(order.every(x => x >= 0) && order.every((x,i)=>i===0||x>order[i-1]));
  assert.match(ui, /dynamicFeature\?\.title \?\? \(emptyDynamicMapFallback \? "地图" : "最近"\)/);
  assert.match(ui, /recentDynamic\.removeAll \{ \$0 == feature \}/);
  assert.match(ui, /recentDynamic\.insert\(feature, at: 0\)/);
  assert.match(ui, /if recentDynamic\.count > 6/);
  assert.match(ui, /openGallery\(\.map\)/);
  assert.doesNotMatch(ui, /WebView|WKWebView|document\.cookie/);
});
test('Gallery owns local, albums, cloud and map subroutes; media uses native fullscreen', () => {
  assert.match(ui, /@State private var localGalleryPageOffset = 0/);
  assert.match(ui, /XDriveIOSNativeLocalPhotoTimelineContainer\(\s*savedOffset: \$localGalleryPageOffset,\s*mediaFilter: \$localGalleryMediaFilter,\s*onMapDateScope: \{ galleryMapCaptureRange = \$0 \}\s*\)/);
  assert.doesNotMatch(ui, /XDriveIOSNativeLocalGalleryScreen\(/);
  assert.match(ui, /\.onChange\(of: localGalleryPageOffset\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /localGalleryPageOffset = 0\s*dynamicFeature = nil/);
  assert.doesNotMatch(ui, /XDriveIOSNativeLocalGalleryScreen\(\s*\)/);
  assert.match(ui, /XDriveIOSNativePhotoAlbumsScreen\(\s*savedOffset: \$localAlbumDirectoryOffset\s*\)/);
  assert.match(ui, /XDriveIOSNativeCloudOriginalGallery\([\s\S]*?login: login,[\s\S]*?confirmedOriginalUpdate: backup\.confirmedOriginalUpdate/);
  assert.match(ui, /gallerySource = source\s+tab = \.gallery/);
  assert.match(ui, /case \.map:/);
  assert.match(local, /\.fullScreenCover\(item: \$selected, onDismiss: restoreAfterViewer\)/);
  assert.match(local, /onCrossPage: \{ page, anchor, direction in/);
  assert.match(albums, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/);
  const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift');
  assert.match(cloud, /\.fullScreenCover\(item: \$selected, onDismiss:/);
  // An inactive Gallery tab preserves verified same-Owner Originals only.
  // Switching sources or losing Owner still discards them, not just a blank shell.
  assert.match(cloud, /if selected == nil \{\s*refreshAfterViewer = false\s*if phase == \.active, !isTabActive,[\s\S]*?model\.matchesOwner\(login\.owner\) \{\s*needsTabRevalidation = true\s*model\.cancel\(\)\s*\} else \{[\s\S]*?hasActivated = false\s*model\.invalidate\(\)/);
  assert.match(cloud, /\.onChange\(of: login.owner\)/);
  assert.match(local, /if value != \.active \{[\s\S]*?invalidate\(with: nil\)/);
  assert.match(albums, /if selected != nil \|\| showingAlbumMap \|\|\s*\(phase == \.active && albumAuthorized\) \{\s*suspendForViewer\(\)/);
  assert.match(albums, /isContentVisible = false/);
  assert.match(albums, /freshGrant == permission/);
  assert.match(albums, /libraryMonitor\.stop\(\)\s*invalidate\(\)/);
});
test('Owner scope and unsupported native routes never claim production parity', () => {
  assert.match(ui, /\.onChange\(of: login.owner\)/);
  assert.match(ui, /resetNavigation\(\)/);
  assert.ok(ui.includes('.id(ownerScopeKey)'));
  assert.match(ui, /\.navigationBarBackButtonHidden\(true\)/);
  assert.match(ui, /func openDynamic/);
  assert.match(ui, /func openGallery/);
  assert.match(ui, /该功能在其他平台存在，但 iOS 原生数据与权限接口尚未实现/);
  assert.match(ui, /服务器管理员入口只在真实验证 Server 管理员角色后开放/);
  assert.match(ui, /XDriveIOSNativePhotoBackupScreen\(\s*login: login, controller: backup,[\s\S]*?launchAction: backupLaunchAction/);
});

test('empty recent Dynamic slot opens the existing Gallery map instead of a blank page', () => {
  assert.match(ui, /private var emptyDynamicMapFallback: Bool/);
  assert.match(ui, /dynamicFeature == nil && recentDynamic\.isEmpty/);
  assert.match(ui, /dynamicSlotTitle/);
  assert.match(ui, /dynamicSlotSymbol/);
  assert.match(ui, /if destination == \.dynamic && emptyDynamicMapFallback \{\s*openGallery\(\.map\)/);
  assert.match(ui, /if next == \.dynamic && emptyDynamicMapFallback \{\s*openGallery\(\.map\)/);
  assert.match(ui, /Label\("地图（默认）", systemImage: "map"\)/);
  assert.match(ui, /Button\("打开地图"\) \{ openGallery\(\.map\) \}/);
  assert.match(ui, /gallerySource = source\s+tab = \.gallery/);
  assert.match(ui, /recentDynamic\.insert\(feature, at: 0\)/);
  assert.doesNotMatch(ui, /recentDynamic\.insert\(\.map/);
});
