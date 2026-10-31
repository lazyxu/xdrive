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
const cloud = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
  .split('struct XDriveIOSNativeServerMediaWall: View {')[1]
  .split('struct XDriveIOSNativeServerMediaAlbums: View {')[0];

for (const [name, view, tile] of [['PhotoKit full wall', local, 'candidate'], ['PhotoKit album wall', album, 'item']]) {
  test(name + ' returns to exact authorized tile after bounded page reload', () => {
    assert.match(view, /ScrollViewReader \{ returnScroll in/);
    assert.match(view, /\.onChange\(of: pageRenderRevision\)/);
    assert.match(view, /\.id\((?:candidate|item)\.id\)/);
    assert.match(view, /viewerReturnID = (?:candidate|item)\.id\s+accessibilityFocusedTileID = nil\s+selected = (?:candidate|item)/);
    assert.match(view, /pageRenderRevision &\+= 1/);
    assert.match(view, /shouldRestoreViewerTile = viewerReturnID != nil && phase == \.active/);
    assert.match(view, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/);
    assert.match(view, /scroll\.scrollTo\(target, anchor: \.center\)/);
    assert.match(view, /@AccessibilityFocusState private var accessibilityFocusedTileID: String\?/);
    assert.match(view, /\.accessibilityFocused\(\$accessibilityFocusedTileID, equals: (?:candidate|item)\.id\)/);
    assert.match(view, /scroll\.scrollTo\(target, anchor: \.center\)[\s\S]*?accessibilityFocusedTileID = target/);
    assert.match(view, /private func clearViewerTileAnchor\(\) \{[\s\S]*?accessibilityFocusedTileID = nil/);
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
  assert.doesNotMatch(policy, /UserDefaults|Keychain|Codable|JSONEncoder|URLSession/);
});

// Cloud Viewer dismissal returns VoiceOver to the same Owner-authorized tile;
// invalidation cannot focus stale/unauthorized content from a previous scope.
test('Owner PhotoAsset Viewer restores bounded cloud VoiceOver focus only to its live source', () => {
  assert.match(cloud, /@AccessibilityFocusState private var accessibilityFocusedMediaID: UInt64\?/);
  assert.match(cloud, /\.accessibilityFocused\(\$accessibilityFocusedMediaID, equals: item\.id\)/);
  assert.match(cloud, /model\.page\?\.items\.contains\(where: \{ \$0\.id == anchor \}\) == true/);
  assert.match(cloud, /returnScroll\.scrollTo\(anchor, anchor: \.center\)\s*accessibilityFocusedMediaID = anchor/);
  assert.match(cloud, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?accessibilityFocusedMediaID = nil/);
  assert.match(cloud, /if state != \.active \{[\s\S]*?accessibilityFocusedMediaID = nil/);
  assert.match(cloud, /private func applySearch\(\) \{[\s\S]*?lastOpenedMediaID = nil\s*accessibilityFocusedMediaID = nil/);
  assert.doesNotMatch(cloud, /UserDefaults|@AppStorage|Keychain/);
});

