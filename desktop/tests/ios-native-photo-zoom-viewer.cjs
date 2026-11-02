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
  assert.match(local, /VideoPlayer\(player: player\)/)
  assert.match(cloud, /VideoPlayer\(player: player\)/)
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
  assert.match(files, /case \.unsupported:[\s\S]*?failure = "当前格式不支持原生预览。可以在此下载原件并使用其他 App/)
  assert.match(files, /case \.tooLarge:[\s\S]*?failure = "文件超过本机预览上限。可以在此下载原件并使用其他 App/)
  assert.match(files, /case \.noThumbnail:[\s\S]*?exportFallbackEligible = true/)
  assert.match(files, /@StateObject private var exporter = XDriveIOSNativeFilesExportModel\(\)/)
  assert.match(files, /if authorized && exportFallbackEligible/)
  assert.match(files, /staged\.nodeID == viewed\.id && staged\.revision == viewed\.revision/)
  assert.match(files, /ShareLink\(item: staged\.fileURL\)/)
  assert.match(files, /exporter\.prepare\(viewed, login: login\)/)
  assert.match(files, /exporter\.invalidate\(\)[\s\S]*?exportFallbackEligible = false/)
})
