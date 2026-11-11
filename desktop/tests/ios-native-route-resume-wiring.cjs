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
  assert.match(routes, /gallerySource: Self\.validGallery\(gallerySource\) \? gallerySource : "unified"/);
  assert.doesNotMatch(routes, /PhotoKit\.fetch|PHAsset|GPS|Authorization:|accessToken|refreshToken/);
});

test('Owner-scoped native Gallery map migrates legacy page routes without storing media identity', () => {
  assert.match(ui, /@State private var localMapScope: XDriveIOSNativeLocalMapScope = \.library/);
  assert.match(ui, /@State private var localMapPageOffset = 0/);
  assert.match(ui, /XDriveIOSNativePhotoMapsScreen\(\s*login: login,\s*localMapScope: \$localMapScope,\s*localMapPageOffset: \$localMapPageOffset/);
  assert.match(ui, /\.onChange\(of: localMapScope\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /\.onChange\(of: localMapPageOffset\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.doesNotMatch(ui, /snapshot\.mapScope \?\? "library"/);
  assert.doesNotMatch(ui, /snapshot\.mapPageOffset \?\? 0/);
  assert.match(ui, /mapScope: localMapScope\.rawValue,\s*mapPageOffset: localMapPageOffset/);
  assert.match(ui, /gallerySource = \.unified\s*localMapScope = \.library\s*localMapPageOffset = 0/);
  assert.match(routes, /let mapScope: String\?/);
  assert.match(routes, /let mapPageOffset: Int\?/);
  // Keep the route store legacy decoder compatible, while the Dashboard
  // deliberately migrates every old page-only route to the full library map.
  assert.match(routes, /Self\.validMapScope\(saved\.mapScope \?\? "page"\)/);
  assert.match(ui, /localMapScope = \.library\s+localMapPageOffset = 0/);
  assert.match(routes, /Self\.validMapPageOffset\(saved\.mapPageOffset \?\? 0\)/);
  assert.match(routes, /value >= 0 && value <= 1_000_000 && value % 64 == 0/);
  assert.doesNotMatch(routes, /assetID|latitude|longitude|photoID|previewTicket|location/);
});

test('mounted native map source picker borrows parent route hints for local MapKit and supports Owner cloud', () => {
  const wrapper = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift'), 'utf8');
  assert.match(wrapper, /@Binding var localMapScope: XDriveIOSNativeLocalMapScope/);
  assert.match(wrapper, /@Binding var localMapPageOffset: Int/);
  assert.match(wrapper, /@Binding var localMapCamera: MKCoordinateRegion\?/);
  assert.match(wrapper, /XDriveIOSNativeLocalPhotoMapScreen\(\s*mapScope: \$localMapScope,\s*offset: \$localMapPageOffset,\s*onClose: onClose,\s*cameraOnEntry: localMapCamera,\s*onLibraryCameraChange: \{ next in/);
  // Local camera admission is allowed for a stable guest session, but is
  // rejected if the user logs in or changes Owner while the map is open.
  assert.match(wrapper, /guard source == \.local else \{ return \}/);
  assert.match(wrapper, /if let expectedOwner \{\s*guard XDriveIOSNativePhotoOwnerScope\.matches\(\s*login\.owner, expectedOwner\s*\) else \{ return \}\s*\} else \{\s*guard login\.owner == nil else \{ return \}\s*\}/);
  assert.match(wrapper, /localMapCamera = next\s*\},\s*onFocusChange: onFocusChange/);
  // Cloud camera is never granted the guest-only local branch.
  assert.match(wrapper, /guard source == \.cloud, let expectedOwner,/);
  assert.match(wrapper, /case \.cloud:\s*if cloudSourceAllowed \{\s*XDriveIOSNativeOwnerPhotoMapScreen\(/);
  assert.match(wrapper, /Picker\("地图照片来源", selection: \$source\)/);
  assert.match(wrapper, /\.onChange\(of: source\) \{ _ in onFocusChange\?\(false\) \}/);
  assert.doesNotMatch(wrapper, /@State private var localMapScope|@State private var localMapPageOffset/);
});


test('native local continuous PhotoKit wall restores only an Owner-scoped numeric scroll anchor', () => {
  const wall = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeLocalContinuousGallery.swift'), 'utf8');
  const timeline = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotoTimelineBrowser.swift'), 'utf8');
  assert.match(ui, /@State private var localGalleryPageOffset = 0/);
  assert.match(ui, /case \.local:\s*XDriveIOSNativeLocalPhotoTimelineContainer\(\s*savedOffset: \$localGalleryPageOffset/);
  assert.doesNotMatch(ui, /XDriveIOSNativeLocalGalleryScreen\(/);
  assert.match(ui, /\.onChange\(of: localGalleryPageOffset\) \{ _ in saveNavigationIfReady\(\) \}/);
  assert.match(ui, /snapshot\.localGalleryPageOffset \?\? 0/);
  assert.match(ui, /localGalleryPageOffset: localGalleryPageOffset/);
  assert.match(ui, /localGalleryPageOffset = 0\s*dynamicFeature = nil/);
  assert.match(routes, /let localGalleryPageOffset: Int\?/);
  assert.match(routes, /Self\.validMapPageOffset\(saved\.localGalleryPageOffset \?\? 0\)/);
  assert.match(routes, /localGalleryPageOffset: Self\.validMapPageOffset\(localGalleryPageOffset\)/);
  assert.match(routes, /value >= 0 && value <= 1_000_000 && value % 64 == 0/);
  assert.match(wall, /@Binding var savedOffset: Int/);
  assert.doesNotMatch(wall, /@State private var savedOffset = 0/);
  assert.match(wall, /XDriveIOSNativePhotoVirtualPagePolicy\.normalizedAnchor\(/);
  assert.match(wall, /scroll\.scrollTo\("page:/);
  assert.match(wall, /reader\.start\(atOffset: 0, mediaFilter: mediaFilter\)/);
  assert.match(wall, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/);
  assert.match(wall, /\.fullScreenCover\(item: \$selected, onDismiss: restoreAfterViewer\)/);
  assert.match(wall, /onCrossedPage: \{ next, page in\s*returnPageOffset = page\.startOffset/);
  assert.match(timeline, /savedOffset = requestedOffset\s*wallRevision &\+= 1/);
  assert.doesNotMatch(routes, /PHAsset|localIdentifier|signedURL|accessToken|latitude|longitude/);
});

test('native local album directory resumes 32-slot anchor through the continuous cover grid', () => {
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
  assert.match(list, /ScrollViewReader \{ scroll in/);
  assert.match(list, /LazyVGrid\(/);
  assert.match(list, /pendingRestoreOffset = XDriveIOSNativeAlbumDirectoryCursorPolicy\.valid\(anchor\)/);
  assert.match(list, /private func restoreDirectoryIfReady\(using scroll: ScrollViewProxy\)/);
  assert.match(list, /XDriveIOSNativeAlbumDirectoryCursorPolicy\.clamp\(/);
  assert.match(list, /if page\.items\.count <= anchor && page\.hasNext \{\s*load\(offset: page\.items\.count\)/);
  assert.match(list, /scroll\.scrollTo\(target, anchor: \.top\)/);
  assert.match(list, /XDriveLocalPhotoAlbumPager\.readPage\(\s*offset: requestedOffset/);
  assert.match(list, /previous\.total == next\.total/);
  assert.match(list, /previous\.limitedAuthorization == next\.limitedAuthorization/);
  assert.match(list, /Set\(previous\.items\.map\(\\\.collectionIdentifier\)\)\.isDisjoint/);
  assert.match(list, /savedOffset = requestedOffset/);
  assert.match(list, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == permission/);
  assert.match(list, /let currentPage = page != nil && !loading && error == nil &&/)
  assert.match(list, /libraryMonitor\.start\(\)\s*if !currentPage \{ reload\(\) \}/);
  assert.match(list, /private func invalidate\(\) \{[\s\S]*?pendingRestoreOffset = nil/);
  assert.doesNotMatch(list, /Button\("上一页"\)|Button\("下一页"\)/);
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
