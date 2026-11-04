'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const src = p => fs.readFileSync(path.join(root, p), 'utf8')
const gallery = src('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const policy = src('ios/XDriveIOS/NativePhotoViewerReturnAnchorPolicy.swift')
const checks = src('ios/tests/NativePhotoViewerReturnAnchorPolicyChecks.swift')

test('iOS local Viewer neighbor admission uses only an authorized bounded page', () => {
  const block = policy.slice(policy.indexOf('static func localLoadedIndex('),
    policy.indexOf('/// Cloud PhotoAsset return targets'))
  assert.match(block, /currentID: String/)
  assert.match(block, /authorized: Bool/)
  assert.match(block, /pageIDs\.count <= 64/)
  assert.match(block, /Set\(pageIDs\)\.count == pageIDs\.count/)
  assert.match(block, /currentID\.utf8\.count <= 1024/)
  assert.match(block, /pageIDs\.indices\.contains\(index \+ direction\)/)
  assert.match(block, /direction == -1 \|\| direction == 1/)
  assert.doesNotMatch(block, /PHFetchResult|UserDefaults|UploadSession|URLSession|100k|nextPage/)
  for (const phrase of [
    'first loaded edge', 'last loaded edge', 'revoked PhotoKit permission',
    'evicted source', 'duplicate local identifier', 'unbounded page',
    'malformed oversized local identifier'
  ]) assert.ok(checks.includes(phrase), 'missing real Swift policy regression: ' + phrase)
})

test('iOS native local fullscreen keeps one modal and cancels old media between neighbors', () => {
  const begin = gallery.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View')
  const end = gallery.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.', begin)
  assert.ok(begin > 0 && end > begin)
  const viewer = gallery.slice(begin, end)
  assert.match(viewer, /var loadedItems: \[XDrivePhotoKitScanCandidate\] = \[\]/)
  assert.match(viewer, /@State private var activeItem: XDrivePhotoKitScanCandidate\?/)
  assert.match(viewer, /private var viewed: XDrivePhotoKitScanCandidate \{ activeItem \?\? candidate \}/)
  assert.match(viewer, /changes\.generation == 0/)
  assert.match(viewer, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(viewer, /PHAsset\.fetchAssets\(\s*withLocalIdentifiers: \[next\.id\], options: nil/)
  assert.match(viewer, /asset\.creationDate == next\.capturedAt/)
  assert.match(viewer, /asset\.modificationDate == next\.modifiedAt/)
  assert.match(viewer, /requestedICloudForCurrentItem = false\s+model\.cancel\(\)\s+activeItem = next\s+onViewed\?\(next\)/)
  assert.match(viewer, /\.task\(id: viewed\.id\)/)
  assert.match(viewer, /model\.load\(viewed\)/)
  assert.match(viewer, /native-ios-local-viewer-previous/)
  assert.match(viewer, /native-ios-local-viewer-next/)
  assert.doesNotMatch(viewer, /（已加载）/)
  assert.match(viewer, /\.onChange\(of: changes\.generation\)[\s\S]*?model\.cancel\(\)[\s\S]*?dismiss\(\)/)
  assert.match(viewer, /\.onDisappear \{[\s\S]*?changes\.stop\(\)[\s\S]*?model\.cancel\(\)/)
  assert.doesNotMatch(viewer, /nextPage\(|requestAuthorization|UploadSession|\.upload\(/)
})

test('return anchor follows last actually viewed PhotoKit item after authenticated re-read', () => {
  assert.match(gallery, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\) \{ initial in/)
  assert.match(gallery, /loadedItems: page\?\.items\.filter \{ \$0\.kind != "unsupported" \} \?\? \[\]/)
  assert.match(gallery, /onViewed: \{ next in[\s\S]*?phase == \.active, selected\?\.id == initial\.id/)
  assert.match(gallery, /page\?\.items\.contains\(where: \{[\s\S]*?\$0\.id == next\.id[\s\S]*?\$0\.modifiedAt == next\.modifiedAt/)
  assert.match(gallery, /viewerReturnID = next\.id/)
  assert.match(gallery, /private func restoreAfterViewer\(\)[\s\S]*?refresh\(at: savedOffset\)/)
  assert.match(gallery, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/)
  assert.doesNotMatch(gallery, /UserDefaults\.standard|localStorage|CloudKit\.modifyRecords|PhotoKit.*upload/)
})


test('iOS local Viewer preserves Live playback, zoom swipes and explicit iCloud requests together', () => {
  const viewer = gallery.slice(gallery.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
    gallery.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.'));
  assert.match(viewer, /@State private var showsStaticStill = false/);
  assert.match(viewer, /@State private var requestedICloudForCurrentItem = false/);
  assert.match(viewer, /native-ios-local-live-play/);
  assert.match(viewer, /native-ios-local-live-static-toggle/);
  assert.match(viewer, /\.onNavigateSwipe \{ showNeighbor\(\$0\) \}/);
  assert.match(viewer, /native-ios-local-viewer-icloud-load/);
  assert.match(viewer, /model\.load\(viewed, allowICloud: true\)/);
  assert.match(viewer, /requestedICloudForCurrentItem = false[\s\S]*?model\.cancel\(\)[\s\S]*?activeItem = next/);
  assert.match(viewer, /showsStaticStill = false[\s\S]*?livePlaybackRequest = nil/);
});


test('native PhotoKit video initial failure and manual retry preserve explicit iCloud intent and existing Live Viewer', () => {
  const model = gallery.slice(gallery.indexOf('final class XDriveIOSLocalPhotoDetailModel'),
    gallery.indexOf('private struct XDriveIOSNativeLivePhotoView'));
  const viewer = gallery.slice(gallery.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
    gallery.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.'));
  assert.match(model, /func playbackFailed\(_ failed: AVPlayerItem\)/);
  assert.match(model, /guard let active = player\?\.currentItem, active === failed/);
  assert.match(viewer, /item\.publisher\(for: \\\.status, options: \[\.initial, \.new\]\)/);
  assert.match(viewer, /player\.publisher\(for: \\\.status, options: \[\.initial, \.new\]\)/);
  assert.match(viewer, /model\.player\?\.currentItem === item/);
  assert.match(viewer, /\.AVPlayerItemFailedToPlayToEndTime/);
  assert.match(viewer, /native-ios-local-player-reload/);
  assert.match(viewer, /model\.load\(viewed, allowICloud: requestedICloudForCurrentItem\)/);
  assert.match(viewer, /requestedICloudForCurrentItem = false/);
  assert.match(viewer, /native-ios-local-live-play/);
  assert.match(viewer, /native-ios-local-live-static-toggle/);
  assert.match(viewer, /\.onNavigateSwipe \{ showNeighbor\(\$0\) \}/);
});
 
test('local Photos fullscreen reserves its canvas for content and keeps extra actions in More', () => {
  const begin = gallery.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View')
  const end = gallery.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.', begin)
  const viewer = gallery.slice(begin, end)
  const liveStart = viewer.indexOf('} else if let live = model.live {')
  const liveEnd = viewer.indexOf('} else if let image = model.still {', liveStart)
  const canvas = viewer.slice(liveStart, liveEnd)
  const insetStart = viewer.indexOf('.safeAreaInset(edge: .bottom)')
  const toolbarStart = viewer.indexOf('            .toolbar {', insetStart)
  const bottom = viewer.slice(insetStart, toolbarStart)
  const menuStart = viewer.indexOf('                    Menu {', toolbarStart)
  const menuEnd = viewer.indexOf('                    } label: {', menuStart)
  const more = viewer.slice(menuStart, menuEnd)
  assert.ok(liveStart >= 0 && liveEnd > liveStart && insetStart > liveEnd &&
    toolbarStart > insetStart && menuStart >= toolbarStart && menuEnd > menuStart)
  assert.match(canvas, /XDriveIOSNativeLivePhotoView\(/)
  assert.match(canvas, /XDriveIOSNativeZoomablePhotoView\(/)
  assert.match(canvas, /\.xdriveNativeViewerPaging \{ showNeighbor\(\$0\) \}/)
  assert.doesNotMatch(canvas, /VStack\(spacing: 10\)|Button\("播放实况"\)/)
  assert.match(bottom, /XDriveIOSNativeLocalViewerFilmstrip\(/)
  for (const id of ['native-ios-local-viewer-bottom-share',
    'native-ios-local-viewer-bottom-favorite', 'native-ios-local-viewer-bottom-delete'])
    assert.ok(bottom.includes(id), 'missing native primary action: ' + id)
  assert.doesNotMatch(bottom, /Button\("上一项"\)|Button\("下一项"\)|（已加载）/)
  for (const id of ['native-ios-local-live-play',
    'native-ios-local-live-static-toggle', 'native-ios-local-viewer-previous',
    'native-ios-local-viewer-next'])
    assert.ok(more.includes(id), 'missing preserved More command: ' + id)
  assert.match(more, /guard currentPageAuthorized, model\.live != nil/)
  assert.match(more, /neighbor\(-1\) == nil && !canCross\(-1\)/)
  assert.match(more, /neighbor\(1\) == nil && !canCross\(1\)/)
})
