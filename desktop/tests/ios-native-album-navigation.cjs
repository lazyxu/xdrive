// Source safety regression for the native PhotoKit album browser.
// Requires real macOS iOS IPA compilation separately; no on-device claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const pager = read('ios/XDriveIOS/PhotoKitAlbumPager.swift');
const album = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift');
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift');
assert.match(pager, /collectionIdentifier:\s*album\.localIdentifier/);
assert.match(album, /actor XDriveIOSNativeAlbumPageReader/);
assert.match(album, /PHPhotoLibrary\.shared\(\)\.register/);
assert.match(album, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/);
assert.match(album, /PHAsset\.fetchAssets\(in: collection, options: options\)/);
assert.match(album, /offset \+ 64/);
assert.match(album, /XDriveIOSNativeSquarePhotoTile\(candidate: item\)/);
assert.match(album, /XDriveIOSNativeLocalPhotoDetail\(\s*candidate: initial,/);
// The active Viewer may cross a 64-item album boundary; its single verified
// current page replaces the initially mounted wall page, without a full album
// array or a stale media snapshot.
assert.match(album, /loadedItems: \(viewerPage \?\? page\)\?\.items\.filter \{\s*\$0\.kind != "unsupported"\s*\} \?\? \[\]/);
assert.match(album, /loadedPage: viewerPage \?\? page/);
assert.match(album, /onCrossPage: \{ oldPage, anchor, direction in/);
assert.match(album, /onCrossedPage: \{ next, verifiedPage in/);
assert.match(album, /onViewed: \{ next in[\s\S]*?viewerReturnID = next\.id/);
assert.match(album, /XDriveLocalPhotoAlbumPager\.readPage\(\s*offset: requestedOffset/);
assert.match(album, /PHPhotoLibraryChangeObserver/);
assert.match(album, /isVisible = true\s*libraryMonitor\.start\(\)\s*reload\(\)/);
assert.ok(album.includes('libraryMonitor.stop()'));
assert.ok(album.includes('suspendForNavigation()'));
assert.match(album, /XDriveIOSPhotoImageLoader/);
assert.doesNotMatch(album, /UploadSession|\.upload\(|UserDefaults|URLSession|WebView|WKWebView/);
assert.match(dashboard, /XDriveIOSNativePhotoAlbumsScreen\(\s*savedOffset: \$localAlbumDirectoryOffset\s*\)/);
assert.doesNotMatch(dashboard, /LocalPhotoInventoryScreen\(\)/);
console.log('native iOS PhotoKit albums: bounded, permission-scoped, linked to real Gallery');

assert.match(dashboard, /@State private var localAlbumDirectoryOffset = 0/);
assert.match(album, /@Binding var savedOffset: Int/);
assert.match(album, /XDriveLocalPhotoAlbumPage\(/);
assert.match(album, /if album\.id == page\.items\.last\?\.id/);
assert.match(album, /ForEach\(0\.\.<XDriveIOSNativePhotoVirtualPagePolicy\.pageCount\(total: total\)/);
assert.doesNotMatch(album, /Button\("上一页"\)|Button\("下一页"\)/);


const timeline = read('ios/XDriveIOS/NativeLocalPhotoTimeline.swift');
const navigator = read('ios/XDriveIOS/NativePhotoTimelineBrowser.swift');
const policy = read('ios/XDriveIOS/NativePhotoTimelinePolicy.swift');
const wall = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift');

// The retired independent date pager must not reappear. Calendar indexing
// remains whole-authorized-library scoped while the viewer uses the one
// continuous 64-slot wall and its verified return anchor.
assert.match(timeline, /struct XDriveIOSNativeLocalPhotoTimelineScreen: View/);
assert.match(timeline, /XDriveIOSNativeLocalPhotoTimelineContainer\(\s*savedOffset: \$savedOffset,\s*mediaFilter: \$mediaFilter\s*\)/);
assert.doesNotMatch(timeline, /Button\("上一页"\)|Button\("下一页"\)|XDriveIOSNativeTimelineReader/);
assert.match(policy, /case year, month, day/);
assert.match(policy, /var firstPageOffset: Int \{ \(firstSlot \/ 64\) \* 64 \}/);
assert.match(navigator, /PHAsset\.fetchAssets\(with: options\)/);
assert.match(navigator, /PHPhotoLibrary\.shared\(\)\.register\(observer\)/);
assert.match(navigator, /try verify\(status: status, observer: observer, revision: revision\)/);
assert.match(navigator, /for slot in 0\.\.<snapshot\.count/);
assert.match(navigator, /index\.append\(capturedAt: asset\.creationDate, slot: slot\)/);
assert.match(navigator, /ForEach\(XDriveIOSNativePhotoTimelineScale\.allCases\)/);
assert.match(navigator, /ForEach\(index\.groups\(for: scale\)\)/);
assert.match(navigator, /savedOffset = requestedOffset\s*wallRevision &\+= 1/);
assert.match(navigator, /XDriveIOSNativeLocalContinuousGalleryScreen\(/);
assert.match(navigator, /\.onChange\(of: changes\.revision\) \{ _ in\s*exactDateTarget = nil\s*model\.invalidate\(\)\s*\}/);
assert.match(navigator, /\.onChange\(of: phase\)/);
assert.match(wall, /ForEach\(0\.\.<XDriveIOSNativePhotoVirtualPagePolicy\.pageCount\(total: total\)/);
assert.match(wall, /scroll\.scrollTo\("photo:/);
assert.match(wall, /XDriveIOSNativeLocalPhotoDetail\(/);
for (const source of [timeline, navigator, policy]) {
  assert.doesNotMatch(source,
    /UploadSession|\.upload\(|URLSession|UserDefaults|WKWebView|PHAssetCreationRequest|PHPhotoLibrary\.shared\(\)\.performChanges/);
}
console.log('native iOS date navigator: authorized calendar index plus continuous PhotoKit Viewer-return wall');
