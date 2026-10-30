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
assert.match(album, /XDriveIOSNativeLocalPhotoDetail\(candidate: \$0\)/);
assert.match(album, /XDriveLocalPhotoAlbumPager\.readPage\(offset: requestedOffset\)/);
assert.match(album, /PHPhotoLibraryChangeObserver/);
assert.ok(album.includes('libraryMonitor.start(); reload()'));
assert.ok(album.includes('libraryMonitor.stop(); invalidate()'));
assert.match(album, /XDriveIOSPhotoImageLoader/);
assert.doesNotMatch(album, /UploadSession|\.upload\(|UserDefaults|URLSession|WebView|WKWebView/);
assert.match(dashboard, /XDriveIOSNativePhotoAlbumsScreen\(\)/);
assert.doesNotMatch(dashboard, /LocalPhotoInventoryScreen\(\)/);
console.log('native iOS PhotoKit albums: bounded, permission-scoped, linked to real Gallery');
