'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = pathInRepo => fs.readFileSync(path.join(root, pathInRepo), 'utf8');
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift').split('struct XDriveIOSNativeLocalGalleryScreen: View {')[1];
const album = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift').split('struct XDriveIOSNativeAlbumContentsScreen: View {')[1].split('struct XDriveIOSNativePhotoAlbumsScreen: View {')[0];
const policy = read('ios/XDriveIOS/NativePhotoViewerReturnAnchorPolicy.swift');

for (const [name, view, tile] of [['PhotoKit full wall', local, 'candidate'], ['PhotoKit album wall', album, 'item']]) {
  test(name + ' returns to exact authorized tile after bounded page reload', () => {
    assert.match(view, /ScrollViewReader \{ returnScroll in/);
    assert.match(view, /\.onChange\(of: pageRenderRevision\)/);
    assert.match(view, /\.id\((?:candidate|item)\.id\)/);
    assert.match(view, /viewerReturnID = (?:candidate|item)\.id\s+selected = (?:candidate|item)/);
    assert.match(view, /pageRenderRevision &\+= 1/);
    assert.match(view, /shouldRestoreViewerTile = viewerReturnID != nil && phase == \.active/);
    assert.match(view, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/);
    assert.match(view, /scroll\.scrollTo\(target, anchor: \.center\)/);
    assert.match(view, /clearViewerTileAnchor\(\)/);
    assert.match(view, /if selected != nil \{ suspendForViewer\(\) \}/);
    assert.match(view, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/);
    assert.doesNotMatch(view, /UserDefaults|@AppStorage|WKWebView/);
  });
}
test('anchor policy does not persist PhotoKit local IDs or scroll without reauthorization', () => {
  assert.match(policy, /authorized,/);
  assert.match(policy, /currentPageIDs.count <= 64/);
  assert.match(policy, /currentPageIDs.contains\(lastOpenedID\)/);
  assert.doesNotMatch(policy, /UserDefaults|Keychain|Codable|JSONEncoder|URLSession|persist/);
});
