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
  assert.match(cloud, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.cloudTarget\(/);
  assert.match(cloud, /lastOpenedRevision = selected\?\.node\.revision/);
  assert.match(cloud, /lastOpenedOwner = login\.owner/);
  assert.match(cloud, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, \$0\)/);
  assert.match(cloud, /ownerAuthorized: ownerAuthorized && phase == \.active/);
  assert.match(policy, /\$0\.id == lastOpenedID && \$0\.revision == lastOpenedRevision/);
  assert.doesNotMatch(cloud, /model\.page\?\.items\.contains\(where: \{ \$0\.id == anchor \}\) == true/);
  assert.match(cloud, /returnScroll\.scrollTo\(anchor, anchor: \.center\)\s*accessibilityFocusedMediaID = anchor/);
  assert.match(cloud, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?accessibilityFocusedMediaID = nil/);
  assert.match(cloud, /if state != \.active \{[\s\S]*?accessibilityFocusedMediaID = nil/);
  assert.match(cloud, /private func applySearch\(\) \{[\s\S]*?lastOpenedMediaID = nil\s*lastOpenedRevision = nil\s*lastOpenedOwner = nil\s*accessibilityFocusedMediaID = nil/);
  assert.doesNotMatch(cloud, /UserDefaults|@AppStorage|Keychain/);
});



for (const [name, view, permission] of [
  ['PhotoKit full wall', local, 'authorization'],
  ['PhotoKit album wall', album, 'permission']
]) {
  test(name + ' preserves L3 Viewer while redacting its hidden wall on inactivity', () => {
    const phaseStart = view.indexOf('.onChange(of: phase)');
    const phaseEnd = view.indexOf('.onDisappear', phaseStart);
    assert.ok(phaseStart >= 0 && phaseEnd > phaseStart);
    const phase = view.slice(phaseStart, phaseEnd);
    assert.ok(phase.includes(permission + ' = PHPhotoLibrary.authorizationStatus(for: .readWrite)'));
    assert.match(phase, /if (?:new|state) != \.active \{\s*if selected != nil \{[\s\S]*?accessibilityFocusedTileID = nil[\s\S]*?suspendForViewer\(\)\s*page = nil\s*(?:errorMessage|error) = nil/);
    assert.match(phase, /\} else \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)\s*\}\s*\} else if selected != nil \{/);
    assert.match(phase, /if (?:authorization|permission) != \.authorized && (?:authorization|permission) != \.limited \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)/);
    assert.match(phase, /\} else \{\s*(?:refresh\(at: savedOffset\)|reload\(\))\s*\}/);
    // The Viewer revalidates its own PhotoKit asset on foreground return.
    // The source wall must not re-scan or dismiss the modal while covered.
    const inactiveViewer = phase.slice(phase.indexOf('if selected != nil {'),
      phase.indexOf('} else {', phase.indexOf('if selected != nil {')));
    const foregroundViewer = phase.slice(phase.indexOf('} else if selected != nil {'),
      phase.lastIndexOf('} else {'));
    assert.doesNotMatch(inactiveViewer, /selected = nil|viewerReturnID = nil|clearViewerTileAnchor\(\)|invalidate\(\)|load\(offset:/);
    assert.doesNotMatch(foregroundViewer, /refresh\(at: savedOffset\)|reload\(\)|load\(offset:/);
    assert.match(view, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/);
  });
}


test('PhotoKit album L3 Viewer navigates only its loaded authorized 64-item page and restores last tile', () => {
  const source = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
  const contents = source.split('struct XDriveIOSNativeAlbumContentsScreen: View {')[1]
    .split('struct XDriveIOSNativePhotoAlbumsScreen: View {')[0]
  assert.match(contents, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\) \{ initial in/)
  assert.match(contents, /XDriveIOSNativeLocalPhotoDetail\(\s*candidate: initial/)
  assert.match(contents, /loadedItems: page\?\.items\.filter \{ \$0\.kind != "unsupported" \} \?\? \[\]/)
  assert.match(contents, /onViewed: \{ next in[\s\S]*?phase == \.active, selected\?\.id == initial\.id/)
  assert.match(contents, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(contents, /page\?\.items\.contains\(where: \{[\s\S]*?\$0\.id == next\.id[\s\S]*?\$0\.kind == next\.kind[\s\S]*?\$0\.isLive == next\.isLive[\s\S]*?\$0\.capturedAt == next\.capturedAt[\s\S]*?\$0\.modifiedAt == next\.modifiedAt/)
  assert.match(contents, /viewerReturnID = next\.id\s+accessibilityFocusedTileID = nil/)
  assert.match(contents, /private func restoreAfterViewer\(\)[\s\S]*?if phase == \.active \{ reload\(\) \}/)
  assert.match(contents, /private func restoreViewerTile\(using scroll: ScrollViewProxy\)[\s\S]*?XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/)
  assert.match(contents, /onChange\(of: libraryMonitor\.revision\) \{ _ in[\s\S]*?clearViewerTileAnchor\(\)[\s\S]*?invalidate\(\)/)
  assert.match(contents, /if selected != nil \{ suspendForViewer\(\) \}/)
  assert.doesNotMatch(contents, /UserDefaults|@AppStorage|CloudKit|UploadSession|isNetworkAccessAllowed = true/)
});
