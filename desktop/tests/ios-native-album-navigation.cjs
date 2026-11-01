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
assert.match(album, /XDriveIOSLocalPhotoTile\(candidate: item\)/);
assert.match(album, /XDriveIOSNativeLocalPhotoDetail\(\s*candidate: initial,/);
assert.match(album, /loadedItems: page\?\.items\.filter \{ \$0\.kind != "unsupported" \} \?\? \[\]/);
assert.match(album, /onViewed: \{ next in[\s\S]*?viewerReturnID = next\.id/);
assert.match(album, /XDriveLocalPhotoAlbumPager\.readPage\(\s*offset: requestedOffset/);
assert.match(album, /PHPhotoLibraryChangeObserver/);
assert.ok(album.includes('libraryMonitor.start(); reload()'));
assert.ok(album.includes('libraryMonitor.stop()'));
assert.ok(album.includes('suspendForNavigation()'));
assert.match(album, /XDriveIOSPhotoImageLoader/);
assert.doesNotMatch(album, /UploadSession|\.upload\(|UserDefaults|URLSession|WebView|WKWebView/);
assert.match(dashboard, /XDriveIOSNativePhotoAlbumsScreen\(\s*savedOffset: \$localAlbumDirectoryOffset\s*\)/);
assert.doesNotMatch(dashboard, /LocalPhotoInventoryScreen\(\)/);
console.log('native iOS PhotoKit albums: bounded, permission-scoped, linked to real Gallery');

assert.match(dashboard, /@State private var localAlbumDirectoryOffset = 0/);
assert.match(album, /@Binding var savedOffset: Int/);
assert.match(album, /XDriveIOSNativeAlbumDirectoryCursorPolicy\.clamp\(/);
assert.match(album, /catch XDriveLocalPhotoAlbumFailure\.invalidRange \{/);


const timeline = read('ios/XDriveIOS/NativeLocalPhotoTimeline.swift');
const timelineView = timeline.slice(
  timeline.indexOf('struct XDriveIOSNativeLocalPhotoTimelineScreen: View')
);
assert.match(album, /XDriveIOSNativeLocalPhotoTimelineScreen\(\)/);
assert.match(album, /native-ios-gallery-timeline-entry/);
assert.match(timeline, /case year, month, day, all/);
assert.match(timeline, /calendar\.dateInterval\(of: component, for: date\)/);
assert.match(timeline, /creationDate >= %@ AND creationDate < %@/);
assert.match(timeline, /opts\.fetchLimit = 1/);
assert.match(timeline, /creationDate < %@/);
assert.match(timeline, /creationDate >= %@/);
assert.match(timeline, /PHAsset\.fetchAssets\(with: options\)/);
assert.match(timeline, /PHAsset\.fetchAssets\(with: opts\)\.firstObject/);
assert.match(timeline, /static let pageSize = 64/);
assert.match(timeline, /boundedOffset\(\s*requested, total: snapshot\.count/);
assert.match(timeline, /let end = min\(snapshot\.count, offset \+ XDriveIOSNativeTimelinePolicy\.pageSize\)/);
assert.match(timeline, /for index in offset\.\.<end/);
assert.match(timeline, /PHPhotoLibrary\.shared\(\)\.register\(changes\)/);
assert.match(timeline, /defer \{ PHPhotoLibrary\.shared\(\)\.unregisterChangeObserver\(changes\) \}/);
assert.match(timeline, /changes\.generation\(\) == generation/);
assert.match(timeline, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == permission/);
assert.match(timeline, /try Task\.checkCancellation\(\)/);
assert.match(timeline, /XDrivePhotoKitScanCandidate\(/);
assert.match(timelineView, /Picker\("时间范围", selection: \$scale\)/);
assert.match(timelineView, /DatePicker\("选择日期", selection: \$anchorDate/);
assert.match(timelineView, /XDriveIOSLocalPhotoTile\(candidate: candidate\)/);
assert.match(timelineView, /XDriveIOSNativeLocalPhotoDetail\(\s*candidate: first,\s*loadedItems: frozenViewerItems/);
assert.match(timelineView, /onViewed: \{ next in[\s\S]*?viewerReturnID = next\.id/);
assert.match(timelineView, /scroll\.scrollTo\(id, anchor: \.center\)/);
assert.match(timelineView, /\.onChange\(of: changes\.revision\)/);
assert.match(timelineView, /\.onChange\(of: phase\)/);
assert.match(timelineView, /onDisappear \{[\s\S]*?stopReading\(\)[\s\S]*?changes\.stop\(\)/);
assert.doesNotMatch(timeline,
  /UploadSession|\.upload\(|URLSession|UserDefaults|WKWebView|PHAssetCreationRequest|PHPhotoLibrary\.shared\(\)\.performChanges/);
console.log('native iOS date navigator: full-library calendar query, bounded PhotoKit paging and Viewer return');
