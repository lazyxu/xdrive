'use strict'
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ui = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeNavigationRouteStore.swift'), 'utf8');
const focusPolicy = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeFocusVisibilityPolicy.swift'), 'utf8');

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
  assert.match(ui, /\.onChange\(of: login\.owner\) \{ owner in[\s\S]*?navigationRouteStore\.clear\(\)[\s\S]*?resetNavigation\(\)/);
  assert.doesNotMatch(ui, /dismiss\(\)|showingNativeWorkspace/);
  assert.match(ui, /activeDynamic: dynamicFeature\?\.implemented == true \? dynamicFeature\?\.rawValue : nil/);
  assert.match(routes, /saved\.scopeHash == scopeHash/);
  assert.match(routes, /recentDynamic\.filter \{ \$0 == "backup" \}/);
  assert.match(routes, /data\.count <= 2048/);
  assert.doesNotMatch(routes, /accessToken|refreshToken|PhotoKitID|signedURL|backupReceipt/);
  assert.doesNotMatch(ui, /WKWebView|document\.cookie/);
});

test('native Gallery MapKit route restores only under its verified Owner-scoped navigation hint', () => {
  assert.match(ui, /case \.map:\s*XDriveIOSNativePhotoMapsScreen\(/);
  assert.match(ui, /case \.map:\s*openGallery\(\.map\)/);
  const galleryAllowlist = routes.match(/private static func validGallery\(_ source: String\) -> Bool \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(galleryAllowlist, 'exact Gallery navigation allowlist missing');
  assert.match(galleryAllowlist, /\["local", "albums", "cloud", "originals", "map"\]\.contains\(source\)/);
  assert.match(routes, /saved\.scopeHash == scopeHash/);
  assert.match(routes, /Self\.validGallery\(saved\.gallerySource\)/);
  assert.match(routes, /gallerySource: Self\.validGallery\(gallerySource\) \? gallerySource : "local"/);
  assert.doesNotMatch(routes, /PhotoKit\.fetch|PHAsset|GPS|Authorization:|accessToken|refreshToken/);
});

test('Owner-scoped native Gallery map resumes mode/page without storing media identity', () => {
  assert.match(ui, /@State private var localMapScope: XDriveIOSNativeLocalMapScope = \.page/);
  assert.match(ui, /@State private var localMapPageOffset = 0/);
  assert.match(ui, /XDriveIOSNativePhotoMapsScreen\(\s*login: login,\s*localMapScope: \$localMapScope,\s*localMapPageOffset: \$localMapPageOffset/);
  assert.match(ui, /\.onChange\(of: localMapScope\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /\.onChange\(of: localMapPageOffset\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /snapshot\.mapScope \?\? "page"/);
  assert.match(ui, /snapshot\.mapPageOffset \?\? 0/);
  assert.match(ui, /mapScope: localMapScope\.rawValue,\s*mapPageOffset: localMapPageOffset/);
  assert.match(ui, /gallerySource = \.local\s*localMapScope = \.page\s*localMapPageOffset = 0/);
  assert.match(routes, /let mapScope: String\?/);
  assert.match(routes, /let mapPageOffset: Int\?/);
  assert.match(routes, /Self\.validMapScope\(saved\.mapScope \?\? "page"\)/);
  assert.match(routes, /Self\.validMapPageOffset\(saved\.mapPageOffset \?\? 0\)/);
  assert.match(routes, /value >= 0 && value <= 1_000_000 && value % 64 == 0/);
  assert.doesNotMatch(routes, /assetID|latitude|longitude|photoID|previewTicket|location/);
});

test('mounted native map source picker borrows parent route hints for local MapKit and supports Owner cloud', () => {
  const wrapper = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift'), 'utf8');
  assert.match(wrapper, /@Binding var localMapScope: XDriveIOSNativeLocalMapScope/);
  assert.match(wrapper, /@Binding var localMapPageOffset: Int/);
  assert.match(wrapper, /XDriveIOSNativeLocalPhotoMapScreen\(\s*mapScope: \$localMapScope,\s*offset: \$localMapPageOffset,\s*onFocusChange: onFocusChange/);
  assert.match(wrapper, /case \.cloud:\s*XDriveIOSNativeOwnerPhotoMapScreen\(/);
  assert.match(wrapper, /Picker\("地图照片来源", selection: \$source\)/);
  assert.match(wrapper, /\.onChange\(of: source\) \{ _ in onFocusChange\?\(false\) \}/);
  assert.doesNotMatch(wrapper, /@State private var localMapScope|@State private var localMapPageOffset/);
});


test('native local PhotoKit Gallery retains only a bounded owner-scoped page cursor', () => {
  const local = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeLocalPhotoGallery.swift'), 'utf8');
  assert.match(ui, /@State private var localGalleryPageOffset = 0/);
  assert.match(ui, /XDriveIOSNativeLocalGalleryScreen\(\s*savedOffset: \$localGalleryPageOffset/);
  assert.match(ui, /\.onChange\(of: localGalleryPageOffset\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /snapshot\.localGalleryPageOffset \?\? 0/);
  assert.match(ui, /localGalleryPageOffset: localGalleryPageOffset/);
  assert.match(ui, /localGalleryPageOffset = 0\s*dynamicFeature = nil/);
  assert.match(routes, /let localGalleryPageOffset: Int\?/);
  assert.match(routes, /Self\.validMapPageOffset\(saved\.localGalleryPageOffset \?\? 0\)/);
  assert.match(routes, /localGalleryPageOffset: Self\.validMapPageOffset\(localGalleryPageOffset\)/);
  assert.match(routes, /enum XDriveIOSNativeLocalGalleryPageCursorPolicy \{/);
  assert.match(local, /@Binding var savedOffset: Int/);
  assert.doesNotMatch(local, /@State private var savedOffset = 0/);
  assert.match(local, /XDriveIOSNativeLocalGalleryPageCursorPolicy\.clamp\(/);
  assert.match(local, /let total = try await current\.start\(atOffset: offset\)/);
  assert.match(local, /if bounded != offset \{[\s\S]*?current\.start\(atOffset: bounded\)/);
  assert.match(local, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/);
  assert.match(local, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/);
  assert.doesNotMatch(routes, /PHAsset|localIdentifier|signedURL|accessToken|latitude|longitude/);
});


test('native local albums directory restores only Owner-scoped 32-slot page position', () => {
  const album = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotoAlbumBrowser.swift'), 'utf8');
  const list = album.split('struct XDriveIOSNativePhotoAlbumsScreen: View {')[1];
  assert.match(ui, /@State private var localAlbumDirectoryOffset = 0/);
  assert.match(ui, /XDriveIOSNativePhotoAlbumsScreen\(\s*savedOffset: \$localAlbumDirectoryOffset\s*\)/);
  assert.match(ui, /\.onChange\(of: localAlbumDirectoryOffset\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /snapshot\.localAlbumDirectoryOffset \?\? 0/);
  assert.match(ui, /localAlbumDirectoryOffset: localAlbumDirectoryOffset/);
  assert.match(ui, /localAlbumDirectoryOffset = 0\s*localGalleryPageOffset = 0/);
  assert.match(routes, /let localAlbumDirectoryOffset: Int\?/);
  assert.match(routes, /XDriveIOSNativeAlbumDirectoryCursorPolicy\.valid\(\s*saved\.localAlbumDirectoryOffset \?\? 0/);
  assert.match(routes, /XDriveIOSNativeAlbumDirectoryCursorPolicy\.valid\(\s*localAlbumDirectoryOffset/);
  assert.match(routes, /enum XDriveIOSNativeAlbumDirectoryCursorPolicy \{/);
  assert.match(routes, /value >= 0 && value <= maximumOffset && value % pageSize == 0/);
  assert.match(list, /@Binding var savedOffset: Int/);
  assert.doesNotMatch(list, /@State private var offset = 0/);
  assert.match(list, /XDriveLocalPhotoAlbumPager\.readPage\(\s*offset: requestedOffset/);
  assert.match(list, /catch XDriveLocalPhotoAlbumFailure\.invalidRange \{/);
  assert.match(list, /XDriveIOSNativeAlbumDirectoryCursorPolicy\.clamp\(/);
  assert.match(list, /requestedOffset > 0 && page\.total > 0 && page\.items\.isEmpty/);
  assert.match(list, /savedOffset = page\.offset/);
  assert.match(list, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == permission/);
  assert.match(list, /libraryMonitor\.start\(\); reload\(\)/);
  assert.doesNotMatch(routes, /localIdentifier|collectionIdentifier|PHAsset|accessToken|latitude|longitude/);
});

test('outgoing cloud/map focus events cannot overwrite a different native Gallery source or tab', () => {
  assert.match(ui, /let focusOwnerKey = ownerScopeKey/);
  assert.match(ui, /let focusGeneration = galleryFocusGeneration/);
  assert.match(ui, /@State private var galleryFocusGeneration = UUID\(\)/);
  assert.match(ui, /expectedGeneration == galleryFocusGeneration/);
  assert.match(ui, /expectedGeneration: focusGeneration/g);
  assert.match(ui, /\.onChange\(of: tab\) \{ next in\s*galleryFocusGeneration = UUID\(\)/);
  assert.match(ui, /\.onChange\(of: phase\) \{ state in[\s\S]*?galleryFocusGeneration = UUID\(\)/);
  assert.match(ui, /private func updateGalleryFocus\(/);
  assert.match(ui, /guard phase == \.active, expectedOwnerKey == ownerScopeKey,/);
  assert.match(ui, /XDriveIOSNativeFocusVisibilityPolicy\.acceptsFocusUpdate\(/);
  assert.match(ui, /galleryFocused = focused/);
  assert.match(ui, /case \.cloud:[\s\S]*?onFocusChange: \{\s*updateGalleryFocus\(\s*\$0, from: \.cloud, expectedOwnerKey: focusOwnerKey/);
  assert.match(ui, /case \.map:[\s\S]*?onFocusChange: \{\s*updateGalleryFocus\(\s*\$0, from: \.map, expectedOwnerKey: focusOwnerKey/);
  assert.doesNotMatch(ui, /onFocusChange: \{ galleryFocused = \$0 \}/);
  assert.match(focusPolicy, /gallerySource == callbackSource/);
  assert.match(focusPolicy, /ownerVerified && tab == "gallery"/);
  assert.match(ui, /\.onChange\(of: gallerySource\) \{ _ in\s*galleryFocusGeneration = UUID\(\)\s*galleryFocused = false/);
  assert.match(ui, /private func resetNavigation\(\) \{\s*galleryFocusGeneration = UUID\(\)/);
});
