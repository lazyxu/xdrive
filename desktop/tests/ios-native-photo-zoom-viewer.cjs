'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const zoom = read('ios/XDriveIOS/NativeZoomablePhotoView.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
const media = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const files = read('ios/XDriveIOS/NativeFilesViewer.swift')
const policy = read('ios/XDriveIOS/NativePhotoViewerReturnAnchorPolicy.swift')
const checks = read('ios/tests/NativePhotoViewerReturnAnchorPolicyChecks.swift')

test('local and cloud still detail use one native UIKit zoom viewer', () => {
  assert.match(zoom, /UIViewRepresentable/)
  assert.match(zoom, /UIScrollViewDelegate/)
  assert.match(local, /XDriveIOSNativeZoomablePhotoView\(image: image\)/)
  assert.match(cloud, /XDriveIOSNativeZoomablePhotoView\(image: still\)/)
  assert.match(local, /PHLivePhotoView/)
  assert.match(local, /XDriveIOSNativePhotoVideoSurface\(/)
  assert.match(cloud, /XDriveIOSNativePhotoVideoSurface\(/)
})

test('pinch pan and double tap are bounded and reset for new media', () => {
  assert.match(zoom, /func viewForZooming\(in scrollView: UIScrollView\)/)
  assert.match(zoom, /scroll\.minimumZoomScale = 1/)
  assert.match(zoom, /scroll\.maximumZoomScale = 5/)
  assert.match(zoom, /scroll\.bouncesZoom = true/)
  assert.match(zoom, /doubleTap\.numberOfTapsRequired = 2/)
  assert.match(zoom, /scroll\.zoom\(to: CGRect/)
  assert.match(zoom, /if photo\.image !== image \{/)
  assert.match(zoom, /scroll\.setZoomScale\(scroll\.minimumZoomScale, animated: false\)/)
})

test('zoom remains read only and preserves media ownership lifecycle', () => {
  assert.doesNotMatch(zoom, /URLSession|UploadSession|PHPhotoLibrary|accessToken|Bearer|Keychain|WKWebView/)
  assert.match(cloud, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
  assert.match(local, /\.onDisappear \{\s*changes\.stop\(\)\s*model\.cancel\(\)\s*showsStaticStill = false\s*livePlaybackRequest = nil\s*\}/)
  assert.match(local, /\.onChange\(of: changes\.generation\) \{ _ in[\s\S]*?model\.cancel\(\)\s*dismiss\(\)/)
})

test('all native still viewers offer horizontal paging through their existing authorized neighbor gate', () => {
  assert.match(zoom, /@objc func pagePan\(_ recognizer: UIPanGestureRecognizer\)/)
  assert.match(zoom, /pagingPan\.maximumNumberOfTouches = 1/)
  assert.match(zoom, /scroll\.panGestureRecognizer\.require\(toFail: pagingPan\)/)
  assert.match(zoom, /scroll\.alwaysBounceHorizontal = false/)
  assert.match(zoom, /XDriveIOSNativeViewerSwipePolicy\.direction\(/)
  assert.match(zoom, /context\.coordinator\.onSwipe = onSwipe/)
  assert.match(zoom, /func onNavigateSwipe\(_ handler: @escaping \(Int\) -> Void\) -> Self/)
  assert.match(policy, /zoom >= minimum - 0\.01, zoom <= minimum \+ 0\.01/)
  assert.match(policy, /abs\(horizontal\) >= 72/)
  assert.match(policy, /abs\(horizontal\) > abs\(vertical\) \* 1\.5/)
  assert.match(policy, /return horizontal < 0 \? 1 : -1/)
  assert.ok(local.includes('.onNavigateSwipe { showNeighbor($0) }'))
  assert.ok(cloud.includes('.onNavigateSwipe { showNeighbor($0) }'))
  assert.ok(media.includes('.onNavigateSwipe { navigateLoaded($0) }'))
  assert.ok(files.includes('.onNavigateSwipe { move($0) }'))
  for (const reason of [
    'left swipe is next', 'right swipe is previous', 'zoomed photo pan',
    'vertical scroll is not page swipe', 'short horizontal drag',
    'invalid below-minimum zoom', 'nonfinite horizontal delta'
  ]) assert.ok(checks.includes(reason), 'missing executable Swift gesture case: ' + reason)
})

test('local Live Photo can explicitly play or zoom its still, and retires playback on dismissal', () => {
  const detail = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
    local.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.'))
  const live = local.slice(local.indexOf('private struct XDriveIOSNativeLivePhotoView: UIViewRepresentable'),
    local.indexOf('/// A full-screen detail has its own observer'))
  assert.match(detail, /if showsStaticStill, let image = model\.still/)
  assert.match(detail, /playbackRequest: livePlaybackRequest/)
  assert.match(detail, /XDriveIOSNativeLivePhotoView\([\s\S]*?playbackRequest: livePlaybackRequest[\s\S]*?\)\s*\.xdriveNativeViewerPaging \{ showNeighbor\(\$0\) \}/)
  assert.match(detail, /实况照片，长按播放或左右滑动切换/)
  assert.match(local, /private extension View[\s\S]*?func xdriveNativeViewerPaging\(onSwipe: @escaping \(Int\) -> Void\)/)
  assert.match(local, /DragGesture\(minimumDistance: 72\)[\s\S]*?XDriveIOSNativeViewerSwipePolicy\.direction\(/)
  assert.match(detail, /Button\("播放实况"\)/)
  assert.match(detail, /Button\(showsStaticStill \? "返回实况照片" : "放大静态照片"\)/)
  assert.match(detail, /native-ios-local-live-static-toggle/)
  assert.match(detail, /showsStaticStill = false[\s\S]*?livePlaybackRequest = nil[\s\S]*?model\.cancel\(\)[\s\S]*?activeItem = next/)
  assert.match(live, /func updateUIView\([\s\S]*?view\.startPlayback\(with: \.full\)/)
  assert.match(live, /static func dismantleUIView\([\s\S]*?view\.stopPlayback\(\)[\s\S]*?view\.livePhoto = nil/)
  assert.doesNotMatch(live, /PHAssetCreationRequest|UploadSession|URLSession|WKWebView/)
})

test('cloud PhotoAsset first ticket uses the frozen presenting Owner rather than current login alone', () => {
  const preview = media.slice(media.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
    media.indexOf('/// Root and album-specific media wall'))
  assert.match(preview, /guard phase == \.active, let expected = openedOwner,[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(preview, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/)
  assert.match(preview, /previewRequestID == requestID/)
  assert.match(preview, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?dismiss\(\)/)
  // Current native L3 Viewer now offers explicitly initiated, Owner-verified
  // original export without bouncing to the hidden Files management panel.
  assert.match(files, /case \.unsupported:[\s\S]*?failure = "当前格式不支持原生预览。可以在本机空间足够时下载原件，再通过系统分享使用其他 App/)
  assert.match(files, /case \.tooLarge:[\s\S]*?failure = "文件超过本机预览上限。可在本机空间足够时下载原件，再通过系统分享使用其他 App/)
  assert.match(files, /case \.noThumbnail:[\s\S]*?exportFallbackEligible = true/)
  assert.match(files, /@StateObject private var exporter = XDriveIOSNativeFilesExportModel\(\)/)
  assert.match(files, /if authorized && exportFallbackEligible/)
  assert.match(files, /staged\.nodeID == viewed\.id && staged\.revision == viewed\.revision/)
  assert.match(files, /ShareLink\(item: staged\.fileURL\)/)
  assert.match(files, /exporter\.prepare\(viewed, login: login, transfers: transfers\)/)
  assert.match(files, /exporter\.invalidate\(\)[\s\S]*?exportFallbackEligible = false/)
})


test('iOS gallery still and Live Viewers use the same reversible, Owner-scoped immersive chrome', () => {
  assert.match(zoom, /func onChromeTap\(_ handler: @escaping \(\) -> Void\) -> Self/)
  assert.match(zoom, /singleTap\.require\(toFail: doubleTap\)/)
  assert.match(zoom, /singleTap\.cancelsTouchesInView = false/)
  assert.match(zoom, /context\.coordinator\.onTap = onTap/)
  assert.match(zoom, /@objc func singleTap\(_ gesture: UITapGestureRecognizer\)/)
  for (const viewer of [local, cloud, media]) {
    assert.match(viewer, /@State private var showChrome = true/)
    assert.match(viewer, /\.onChromeTap \{ toggleChrome\(\) \}/)
    assert.match(viewer, /\.simultaneousGesture\(TapGesture\(\)\.onEnded \{ toggleChrome\(\) \}\)/)
    assert.match(viewer, /\.toolbar\(showChrome \? \.visible : \.hidden, for: \.navigationBar\)/)
    assert.match(viewer, /\.statusBarHidden\(!showChrome\)/)
    assert.match(viewer, /\.background\(Color\.black\.ignoresSafeArea\(\)\)/)
    assert.match(viewer, /Label\("返回图库", systemImage: "chevron\.left"\)/)
  }
  assert.match(local, /private func toggleChrome\(\) \{\s*guard currentPageAuthorized/)
  assert.match(cloud, /private func toggleChrome\(\) \{\s*guard currentOwnerAuthorized/)
  assert.match(media, /private func toggleChrome\(\) \{\s*guard ownerAuthorized/)
  assert.match(local, /if currentPageAuthorized, let details = photoInfoDetails/)
  assert.match(cloud, /if currentOwnerAuthorized \{\s*XDriveIOSNativeViewerInfoSheet/)
  assert.match(media, /if ownerAuthorized \{\s*XDriveIOSNativeViewerInfoSheet/)
  assert.match(local, /native-ios-local-viewer-info/)
  assert.match(cloud, /native-ios-original-viewer-info/)
  assert.match(media, /native-ios-photoasset-viewer-info/)
  for (const viewer of [local, cloud, media]) {
    assert.match(viewer, /XDriveIOSNativeViewerInfoSheet\(/)
    assert.doesNotMatch(viewer, /XDriveIOSNativeViewerQualityPanel/)
  }
  assert.match(local, /\.onChange\(of: viewed\.id\) \{ _ in\s+showChrome = true\s+showingPhotoInfo = false\s+photoInfoDetails = nil\s+\}/)
  assert.match(cloud, /\.onChange\(of: error\) \{ message in/)
  assert.match(media, /\.onChange\(of: failure\) \{ message in/)
  for (const viewer of [local, cloud, media]) assert.match(viewer, /if (state|phase) != \.active \{/)
  assert.doesNotMatch(zoom, /PHImageManager|URLSession|accessToken|Bearer|WKWebView/)
})


test('local PhotoKit and cloud PhotoAsset video, including Live fallback, use the same native scrubber', () => {
  const source = read('ios/XDriveIOS/NativePhotoVideoSurface.swift')
  const localDetail = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
    local.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.'))
  const cloudDetail = media.slice(media.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
    media.indexOf('/// Root and album-specific media wall'))
  assert.equal((localDetail.match(/XDriveIOSNativePhotoVideoSurface\(/g) || []).length, 1)
  assert.equal((cloudDetail.match(/XDriveIOSNativePhotoVideoSurface\(/g) || []).length, 2)
  assert.match(localDetail, /private func videoSurface\(_ player: AVPlayer\)/)
  assert.match(localDetail, /onChromeTap: \{ toggleChrome\(\) \}/)
  assert.match(localDetail, /if currentPageAuthorized \{ player\.play\(\) \}/)
  assert.match(localDetail, /model\.player\?\.currentItem === item/)
  assert.match(localDetail, /model\.playbackFailed\(item\)/)
  assert.match(localDetail, /\.onDisappear \{ player\.pause\(\) \}/)
  assert.match(cloudDetail, /XDriveIOSNativeAVPlayerStatusObserver\(/)
  assert.match(cloudDetail, /onFailed: \{ playbackLoadFailed\(\$0\) \}/)
  assert.match(cloudDetail, /\.id\(viewed\.id\)/)
  assert.match(cloudDetail, /if ownerAuthorized \{ player\.play\(\) \}/)
  assert.match(cloudDetail, /\.onDisappear \{ player\.pause\(\) \}/)
  assert.match(cloudDetail, /private func toggleChrome\(\) \{\s*guard ownerAuthorized/)
  assert.match(source, /native-ios-photo-video-timeline/)
  assert.match(source, /native-ios-photo-video-mute/)
  assert.match(source, /native-ios-photo-video-play/)
  assert.match(source, /Slider\(/)
  assert.match(source, /player\.seek\(/)
  assert.match(source, /player\.isMuted = !player\.isMuted/)
  assert.match(source, /phase == \.active/)
  assert.doesNotMatch(source, /URLSession|Bearer|Keychain|UploadSession|UserDefaults/)
})


test('native video canvas pages through current authorized neighboring media, not the timeline Slider', () => {
  const video = read('ios/XDriveIOS/NativePhotoVideoSurface.swift')
  const localDetail = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
    local.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.'))
  const mediaDetail = media.slice(media.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
    media.indexOf('/// Root and album-specific media wall'))
  const originalDetail = cloud.slice(cloud.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    cloud.indexOf('/// SwiftUI\'s ForEach identity'))
  const canvas = video.slice(video.indexOf('XDriveIOSNativePhotoVideoLayer(player: player, onFirstFrame: onFirstFrame)'),
    video.indexOf('if showChrome {'))
  const controls = video.slice(video.indexOf('if showChrome {'))
  assert.match(video, /let onNavigateSwipe: \(\(Int\) -> Void\)\?/)
  assert.match(video, /onNavigateSwipe: \(\(Int\) -> Void\)\? = nil/)
  assert.match(canvas, /\.simultaneousGesture\(\s*DragGesture\(minimumDistance: 72, coordinateSpace: \.local\)/)
  assert.match(canvas, /guard canControl, !seeking,/)
  assert.match(canvas, /XDriveIOSNativeViewerSwipePolicy\.direction\(/)
  assert.match(canvas, /horizontal: value\.translation\.width,/)
  assert.match(canvas, /vertical: value\.translation\.height,/)
  assert.match(canvas, /onNavigateSwipe\(direction\)/)
  assert.doesNotMatch(controls, /DragGesture|onNavigateSwipe/)
  assert.match(controls, /Slider\(/)
  assert.match(controls, /player\.seek\(/)
  assert.match(controls, /native-ios-photo-video-mute/)
  assert.equal((localDetail.match(/onNavigateSwipe: \{ showNeighbor\(\$0\) \}/g) || []).length, 1)
  assert.equal((mediaDetail.match(/onNavigateSwipe: \{ navigateLoaded\(\$0\) \}/g) || []).length, 2)
  assert.equal((originalDetail.match(/onNavigateSwipe: \{ showNeighbor\(\$0\) \}/g) || []).length, 2)
  assert.match(localDetail, /guard currentPageAuthorized, !crossing, !photoActionBusy/)
  assert.match(mediaDetail, /guard ownerAuthorized, !rangeCrossing, !photosRestoreBusy/)
  assert.match(originalDetail, /private func showNeighbor\(_ direction: Int\)/)
  assert.doesNotMatch(video, /URLSession|Bearer|Keychain|UploadSession|WKWebView/)
})


test('local native Photos Viewer exposes bottom share, favorite and delete actions without bypassing PhotoKit gates', () => {
  const detail = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
    local.indexOf('/// Read-only, 64-at-a-time PhotoKit grid.'))
  assert.match(detail, /private var canUsePhotoActions: Bool \{\s*currentPageAuthorized && !crossing && !photoActionBusy &&\s*!model\.downloadingFromICloud && photoShareSession == nil/)
  assert.match(detail, /if showChrome \{[\s\S]*?if currentPageAuthorized \{\s*HStack\(spacing: 16\)/)
  assert.match(detail, /shareOriginal\(allowICloud: false\)[\s\S]*?native-ios-local-viewer-bottom-share/)
  assert.match(detail, /editFavorite\(favoriteStatus != true\)[\s\S]*?native-ios-local-viewer-bottom-favorite/)
  assert.match(detail, /favoriteStatus == true \? "heart\.fill" : "heart"/)
  assert.match(detail, /\.disabled\(!canUsePhotoActions \|\| favoriteStatus == nil\)/)
  assert.match(detail, /showDeleteConfirm = true[\s\S]*?native-ios-local-viewer-bottom-delete/)
  assert.equal((detail.match(/\.disabled\(!canUsePhotoActions\)/g) || []).length, 2)
  assert.match(detail, /native-ios-local-viewer-bottom-actions/)
  assert.match(detail, /frame\(minWidth: 44, minHeight: 44\)/)
  assert.match(detail, /Button\("从 iCloud 下载原件并分享"\)/)
  assert.match(detail, /shareOriginal\(allowICloud: true\)/)
  assert.match(detail, /native-ios-local-viewer-photo-actions/)
  assert.match(detail, /Button\("删除这张照片", role: \.destructive\) \{ deleteViewed\(\) \}/)
  assert.match(detail, /private func shareOriginal\(allowICloud: Bool\)/)
  assert.match(detail, /private func editFavorite\(_ favorite: Bool\)/)
  assert.match(detail, /private func deleteViewed\(\)/)
  assert.match(detail, /XDriveIOSNativeLocalPhotoSelectionActions\.setFavorite\(/)
  assert.match(detail, /XDriveIOSNativeLocalPhotoSelectionActions\.delete\(/)
  assert.match(detail, /\.toolbar\(showChrome \? \.visible : \.hidden, for: \.navigationBar\)/)
  assert.match(detail, /XDriveIOSNativeLocalViewerFilmstrip\(/)
  assert.doesNotMatch(detail, /URLSession|UploadSession|WKWebView|UserDefaults/)
})

test('shared native still zoom supports VoiceOver rotor without extra media access', () => {
  assert.match(zoom, /scroll\.isAccessibilityElement = true/)
  assert.match(zoom, /scroll\.accessibilityTraits\.insert\(\.image\)/)
  assert.match(zoom, /scroll\.accessibilityCustomActions = \[/)
  for (const label of ['放大照片', '缩小照片', '恢复原始大小']) {
    assert.ok(zoom.includes('name: "' + label + '"'), 'missing VoiceOver action: ' + label)
  }
  assert.match(zoom, /@objc func accessibilityZoomIn\(_ action: UIAccessibilityCustomAction\) -> Bool/)
  assert.match(zoom, /@objc func accessibilityZoomOut\(_ action: UIAccessibilityCustomAction\) -> Bool/)
  assert.match(zoom, /@objc func accessibilityResetZoom\(_ action: UIAccessibilityCustomAction\) -> Bool/)
  assert.match(zoom, /let target = min\(scroll\.maximumZoomScale,[\s\S]*?max\(scroll\.minimumZoomScale, current \* factor\)\)/)
  assert.match(zoom, /\(scroll\.contentOffset\.x \+ scroll\.bounds\.midX\) \/ current/)
  assert.match(zoom, /scroll\.zoom\(to: rect, animated: !UIAccessibility\.isReduceMotionEnabled\)/)
  assert.match(zoom, /func scrollViewDidZoom\(_ scrollView: UIScrollView\)[\s\S]*?refreshAccessibilityZoom\(scrollView\)/)
  assert.match(zoom, /if photo\.image !== image \{[\s\S]*?refreshAccessibilityZoom\(scroll\)/)
  assert.match(zoom, /func gestureRecognizerShouldBegin[\s\S]*?scroll\.zoomScale <= scroll\.minimumZoomScale \+ 0\.01/)
  assert.doesNotMatch(zoom, /URLSession|PHImageManager|PHAsset|Authorization|Bearer|\.upload\(/)
})


test('shared zoom keeps focus only on a verified same-source high resolution upgrade', () => {
  assert.match(zoom, /func onZoomHighResolution\(source: String, request: @escaping \(\) -> Void\) -> Self/)
  assert.match(zoom, /scrollView\.zoomScale >= 1\.5/)
  assert.match(zoom, /!didRequestHighResolution, onHighResolutionRequest != nil/)
  assert.match(zoom, /self\.highResolutionSource == source/)
  assert.match(zoom, /let sameSource = highResolutionSource != nil &&/)
  assert.match(zoom, /context\.coordinator\.highResolutionSource == highResolutionSource/)
  assert.match(zoom, /context\.coordinator\.didRequestHighResolution = false/)
  assert.match(zoom, /let isSameImageUpgrade = sameSource &&[\s\S]*?updatedPixels > previousPixels/)
  assert.match(zoom, /if !isSameImageUpgrade \{\s*scroll\.setZoomScale\(scroll\.minimumZoomScale, animated: false\)/)
  assert.match(zoom, /scroll\.panGestureRecognizer\.require\(toFail: pagingPan\)/)
  assert.doesNotMatch(zoom, /URLSession|accessToken|PHImageManager|UserDefaults|UploadSession/)
});
