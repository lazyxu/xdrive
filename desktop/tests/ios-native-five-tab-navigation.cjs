'use strict'
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ui = read('ios/XDriveIOS/NativePhotosDashboard.swift');
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift');
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
  assert.match(ui, /dynamicFeature\?\.title \?\? "最近"/);
  assert.match(ui, /recentDynamic\.removeAll \{ \$0 == feature \}/);
  assert.match(ui, /recentDynamic\.insert\(feature, at: 0\)/);
  assert.match(ui, /if recentDynamic\.count > 6/);
  assert.match(ui, /openGallery\(\.map\)/);
  assert.doesNotMatch(ui, /WebView|WKWebView|document\.cookie/);
});
test('Gallery owns local, albums, cloud and map subroutes; media uses native fullscreen', () => {
  assert.match(ui, /XDriveIOSNativeLocalGalleryScreen\(\)/);
  assert.match(ui, /XDriveIOSNativePhotoAlbumsScreen\(\)/);
  assert.match(ui, /XDriveIOSNativeCloudOriginalGallery\(login: login\)/);
  assert.match(ui, /gallerySource = source\s+tab = \.gallery/);
  assert.match(ui, /case \.map:/);
  assert.match(local, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/);
  assert.match(albums, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/);
  const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift');
  assert.match(cloud, /\.fullScreenCover\(item: \$selected\)/);
  assert.match(cloud, /if selected == nil \{ model\.invalidate\(\) \}/);
  assert.match(cloud, /\.onChange\(of: login.owner\)/);
  assert.match(local, /if selected != nil \{ suspendForViewer\(\) \}/);
  assert.match(albums, /if selected != nil \{ suspendForViewer\(\) \}/);
  assert.match(albums, /libraryMonitor.stop\(\); invalidate\(\)/);
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
  assert.match(ui, /XDriveIOSNativePhotoBackupScreen\(login: login, controller: backup\)/);
});
