'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const src = file => fs.readFileSync(path.join(root, file), 'utf8')
const policy = src('ios/XDriveIOS/NativePhotoAssetViewerNeighborPolicy.swift')
const checks = src('ios/tests/NativePhotoAssetViewerNeighborPolicyChecks.swift')
const view = src('ios/XDriveIOS/NativeServerMediaGallery.swift')

test('cloud PhotoAsset neighbors never invent extra Server Range entries', () => {
  assert.match(policy, /static let maximumLoaded = 48/)
  assert.match(policy, /current\.nodeID > 0/)
  assert.match(policy, /current\.revision > 0/)
  assert.match(policy, /loaded\.count <= maximumLoaded/)
  assert.match(policy, /Set\(loaded\.map\(\\\.nodeID\)\)\.count == loaded\.count/)
  assert.match(policy, /loaded\.firstIndex\(of: current\)/)
  assert.match(policy, /direction == -1 \|\| direction == 1/)
  assert.match(policy, /loaded\[neighbor\]\.previewable/)
  for (const reason of ['start boundary', 'end boundary', 'stale revision',
    'newer revision', 'revoked Owner', 'duplicate Node ID',
    'unsupported next item', 'unsupported current item', 'overlong page'])
    assert.ok(checks.includes(reason), 'missing executable Swift test: ' + reason)
  assert.doesNotMatch(policy, /URLSession|UploadSession|UserDefaults|nextPage|\.fetch|localStorage/)
})

test('L3 Viewer retires old media then opens only accepted neighbor with a fresh ticket', () => {
  const start = view.indexOf('struct XDriveIOSNativeServerMediaPreview: View')
  const end = view.indexOf('/// Root and album-specific media wall', start)
  assert.ok(start >= 0 && end > start)
  const viewer = view.slice(start, end)
  assert.match(viewer, /var loadedItems: \[XDriveIOSNativeMediaItem\] = \[\]/)
  assert.match(viewer, /var openedOwner: XDriveNativeOwnerRoot\?/)
  assert.match(viewer, /@State private var activeItem: XDriveIOSNativeMediaItem\?/)
  assert.match(viewer, /private var viewed: XDriveIOSNativeMediaItem \{ activeItem \?\? item \}/)
  assert.match(viewer, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, \$0\)/)
  assert.match(viewer, /XDriveIOSNativePhotoAssetViewerNeighborPolicy\.neighborIndex\(/)
  assert.match(viewer, /guard let next = neighbor\(direction\), onNavigate\?\(next\) == true/)
  assert.match(viewer, /retirePreview\(\)\s*activeItem = next/)
  assert.match(viewer, /native-ios-photoasset-viewer-previous/)
  assert.match(viewer, /native-ios-photoasset-viewer-next/)
  assert.match(viewer, /（已加载）/)
  assert.match(viewer, /let requestID = previewRequestID\s*let target = viewed/)
  assert.match(viewer, /let live = try await reader\.livePreview\(target\)/)
  assert.match(viewer, /reader\.thumbnail\(target\)/)
  assert.match(viewer, /\)\.preview\(target\)/)
  assert.match(viewer, /previewRequestID == requestID/)
  assert.match(viewer, /liveResources\?\.discard\(\)/)
  assert.match(viewer, /\.onChange\(of: login\.owner\)[\s\S]*?retirePreview\(\)[\s\S]*?dismiss\(\)/)
  assert.match(viewer, /\.onDisappear \{ retirePreview\(\) \}/)
  assert.doesNotMatch(viewer, /new XDriveIOSNativeMediaGalleryReader|UploadSession|UserDefaults|WKWebView/)
})

test('L2 retains the original modal and restores the last accepted Node+revision only', () => {
  const start = view.indexOf('struct XDriveIOSNativeServerMediaWall: View')
  const end = view.indexOf('struct XDriveIOSNativeServerMediaAlbums: View', start)
  assert.ok(start >= 0 && end > start)
  const wall = view.slice(start, end)
  assert.match(wall, /@State private var viewerLoadedItems: \[XDriveIOSNativeMediaItem\] = \[\]/)
  assert.match(wall, /@State private var viewerOpenedOwner: XDriveNativeOwnerRoot\?/)
  assert.match(wall, /viewerLoadedItems = model\.page\?\.items \?\? \[\]/)
  assert.match(wall, /viewerOpenedOwner = login\.owner/)
  assert.match(wall, /\.fullScreenCover\(item: \$selected\) \{ initial in/)
  assert.match(wall, /openedOwner: viewerOpenedOwner/)
  assert.match(wall, /onNavigate: \{ next in[\s\S]*?selected\?\.id == initial\.id/)
  assert.match(wall, /zip\(current\.items, viewerLoadedItems\)\.allSatisfy/)
  assert.match(wall, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, opened\)/)
  assert.match(wall, /lastOpenedMediaID = next\.id\s*lastOpenedRevision = next\.node\.revision\s*lastOpenedOwner = opened/)
  assert.match(wall, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.cloudTarget\(/)
  assert.match(wall, /ownerAuthorized: ownerAuthorized && phase == \.active/)
  assert.match(wall, /viewerLoadedItems = \[\]/)
  assert.match(wall, /viewerOpenedOwner = nil/)
  assert.doesNotMatch(wall, /nextPage\(|UploadSession|\.upload\(|new FullScreenCover/)
})

test('cloud Viewers fence playback failure to the active Owner and AVPlayer item', () => {
  const detail = view.slice(view.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
    view.indexOf('/// Root and album-specific media wall'));
  const originals = src('ios/XDriveIOS/NativeCloudOriginalGallery.swift');
  const original = originals.slice(originals.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    originals.indexOf('/// SwiftUI\'s ForEach identity', originals.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View')));
  assert.match(detail, /guard phase == \.active, let expected = openedOwner,[\s\S]*?ownerAuthorized/);
  assert.match(detail, /matches\(login\.owner, expected\)/);
  assert.match(detail, /matches\(auth\.owner, expected\)/);
  for (const scoped of [detail, original]) {
    assert.match(scoped, /\.AVPlayerItemFailedToPlayToEndTime/);
    assert.match(scoped, /let failed = notification\.object as\? AVPlayerItem/);
    assert.match(scoped, /let playing = player\?\.currentItem, failed === playing/);
    assert.match(scoped, /player\?\.pause\(\)[\s\S]*?player\?\.replaceCurrentItem\(with: nil\)[\s\S]*?player = nil/);
    assert.match(scoped, /showingLiveMotion = false/);
  }
  assert.match(detail, /guard ownerAuthorized,[\s\S]*?failed === playing/);
  assert.match(detail, /failure = "媒体播放失败/);
  assert.match(detail, /if ownerAuthorized \{\s*retirePreview\(\)/);
  assert.match(original, /guard currentOwnerAuthorized,[\s\S]*?failed === playing/);
  assert.match(original, /error = "媒体播放失败/);
  assert.match(original, /native-ios-original-live-retry/);
  assert.match(original, /guard currentOwnerAuthorized, player != nil else \{ return \}/);
  assert.doesNotMatch(detail + original, /WKWebView|UploadSession|AVPlayerItemPlaybackStalled/);
});

test('cloud player KVO failures are bound to the current Owner and item with manual landscape reload', () => {
  const monitor = src('ios/XDriveIOS/NativeAVPlayerStatusObserver.swift');
  const detail = view.slice(view.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
    view.indexOf('/// Root and album-specific media wall'));
  const originalSource = src('ios/XDriveIOS/NativeCloudOriginalGallery.swift');
  const original = originalSource.slice(originalSource.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    originalSource.indexOf('/// SwiftUI\'s ForEach identity'));
  assert.match(monitor, /struct XDriveIOSNativeAVPlayerStatusObserver<Content: View>: View/);
  assert.match(monitor, /item\.publisher\(for: \\\.status, options: \[\.initial, \.new\]\)/);
  assert.match(monitor, /player\.publisher\(for: \\\.status, options: \[\.initial, \.new\]\)/);
  assert.match(monitor, /\.receive\(on: RunLoop\.main\)/);
  assert.equal((detail.match(/XDriveIOSNativeAVPlayerStatusObserver\(/g) || []).length, 2);
  assert.equal((original.match(/XDriveIOSNativeAVPlayerStatusObserver\(/g) || []).length, 2);
  assert.match(detail, /onFailed: \{ playbackLoadFailed\(\$0\) \}/);
  assert.match(detail, /private func playbackLoadFailed\(_ failed: AVPlayerItem\)[\s\S]*?guard ownerAuthorized,[\s\S]*?failed === playing/);
  assert.match(original, /private func playbackLoadFailed\(_ failed: AVPlayerItem\)[\s\S]*?guard currentOwnerAuthorized,[\s\S]*?failed === playing/);
  assert.match(detail, /\.disabled\(!ownerAuthorized \|\| player == nil\)[\s\S]*?native-ios-photoasset-live-motion/);
  assert.match(detail, /native-ios-photoasset-player-reload/);
  assert.match(original, /native-ios-original-player-reload/);
  assert.match(detail, /\.AVPlayerItemFailedToPlayToEndTime/);
  assert.match(original, /\.AVPlayerItemFailedToPlayToEndTime/);
});


test('cloud initial player status recovery coexists with exported original actions', () => {
  const cloud = src('ios/XDriveIOS/NativeCloudOriginalGallery.swift');
  const viewer = cloud.slice(cloud.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    cloud.indexOf('/// SwiftUI\'s ForEach identity'));
  assert.match(viewer, /native-ios-original-export/);
  assert.match(viewer, /native-ios-original-share/);
  assert.match(viewer, /native-ios-original-player-reload/);
  assert.match(viewer, /XDriveIOSNativeAVPlayerStatusObserver\(/);
  assert.match(viewer, /@StateObject private var exporter = XDriveIOSNativeFilesExportModel\(\)/);
});
