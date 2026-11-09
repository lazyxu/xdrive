'use strict'
// Exact-source regression gates for Native Files/Gallery P0/P1/P2 closeout.
// This does NOT substitute for signed iPhone or real cloud-video performance.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const layer = read('ios/XDriveIOS/NativePhotoVideoSurface.swift')
const viewer = read('ios/XDriveIOS/NativeFilesViewer.swift')
const gallery = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const album = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const collections = read('ios/XDriveIOS/NativeFilesCollections.swift')
const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const window = read('ios/XDriveIOS/NativeFilesContinuousWindowPolicy.swift')
const windowChecks = read('ios/tests/NativeFilesContinuousWindowChecks.swift')
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
const script = read('ios/scripts/summarize-navigation-latency.py')
const web = read('web/src/MobileFiles.tsx')

test('P0 first video frame uses visible AVPlayerLayer KVO, never proxy-ready AVPlayerItem', () => {
  assert.ok(layer.includes('layer.observe(\\.isReadyForDisplay'))
  assert.ok(layer.includes('layer.isReadyForDisplay'))
  assert.ok(layer.includes('onFirstFrame: (() -> Void)? = nil'))
  assert.ok(viewer.includes('onFirstFrame: { recordVideoFirstFrame(player) }'))
  assert.ok(viewer.includes('IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready'))
  // Device Console must contain the same privacy-safe metric even without
  // the synthetic XCUITest smoke argument.
  assert.ok(viewer.includes('import OSLog'))
  assert.ok(viewer.includes('Logger(subsystem: "com.xdrive.ios", category: "FilesVideoFirstFrame")'))
  assert.ok(viewer.includes('privacy: .public'))
})

test('P0 first-frame callback belongs to one current player and is cancelled on reuse/exit', () => {
  assert.ok(layer.includes('observedPlayer === player'))
  assert.ok(layer.includes('layer.player === player'))
  assert.ok(layer.includes('!self.delivered'))
  assert.ok(layer.includes('readyObservation?.invalidate()'))
  assert.ok(layer.includes('coordinator.retire()'))
  assert.match(viewer, /current === renderedPlayer/)
  assert.match(viewer, /authorized, !isClosing, isNativeVideo/)
  assert.ok(viewer.includes('videoFirstFrameRecorded = false'))
  assert.ok(viewer.includes('player?.replaceCurrentItem(with: nil)'))
})

test('P0 video stays black while signed ticket is loading; first-frame overlay never steals swipes', () => {
  assert.ok(viewer.includes('loading && expectsVideoCanvas'))
  assert.ok(viewer.includes('native-ios-files-video-first-frame-pending'))
  assert.ok(viewer.includes('allowsHitTesting(false)'))
  assert.ok(layer.includes('XDriveIOSNativePhotoVideoLayer(player: player, onFirstFrame: onFirstFrame)'))
  assert.ok(layer.includes('onNavigateSwipe(direction)'))
  assert.ok(viewer.includes('Label("上一项", systemImage: "chevron.left")'))
  assert.ok(viewer.includes('Label("下一项", systemImage: "chevron.right")'))
  assert.match(viewer, /\.toolbar\(isNativeVideo \? \.visible :[\s\S]*?for: \.bottomBar\)/)
})

test('P0 first-frame timing includes authentication and ticket, not a preplay-only synthetic metric', () => {
  const start = viewer.indexOf('private func openCurrent() async {')
  const authentication = viewer.indexOf('login.verifiedAuthorization()', start)
  const preview = viewer.indexOf('reader.preview(current)', authentication)
  const player = viewer.indexOf('case .video(let url):', preview)
  assert.ok(start >= 0 && authentication > start && preview > authentication && player > preview)
  assert.ok(viewer.slice(start, authentication).includes('previewRequestedAt = ProcessInfo.processInfo.systemUptime'))
  assert.ok(viewer.includes('candidate.automaticallyWaitsToMinimizeStalling = false'))
  assert.ok(viewer.includes('item.preferredForwardBufferDuration = 2'))
  assert.ok(layer.includes('buffering = canControl'))
  assert.ok(viewer.includes('ProcessInfo.processInfo.arguments.contains("-xdrive-ui-navigation-smoke")'))
  const metricBody = viewer.slice(viewer.indexOf('private func recordVideoFirstFrame('),
                                  viewer.indexOf('private func reloadCurrent()', viewer.indexOf('private func recordVideoFirstFrame(')))
  assert.doesNotMatch(metricBody, /accessToken|login\.token|fileURL|viewed\.name|URLSession/)
})

test('P0 integration checks run candidate real Simulator suites on exact HEAD, preserving evidence', () => {
  assert.ok(workflow.includes('github.event.pull_request.head.sha || github.sha'))
  assert.ok(workflow.includes('candidate-navigation'))
  assert.ok(workflow.includes('candidate-gallery-files'))
  assert.ok(workflow.includes('XDriveIOSNavigationRuntimeUITests'))
  assert.ok(workflow.includes('XDriveIOSGalleryFilesStabilityUITests'))
  assert.ok(workflow.includes('capture-navigation-smoke-frames.py'))
  assert.ok(workflow.includes('summarize-navigation-latency.py'))
  assert.ok(workflow.includes('diagnostics/live-frames'))
  assert.doesNotMatch(workflow, /"-only-testing:\$native_test_target" test/)
})

test('P0 video result is separately summarized, with missing first frame never called a pass', () => {
  assert.ok(script.includes('VIDEO_FIRST_FRAME_PATTERN'))
  assert.ok(script.includes('video_first_displayed_frame'))
  assert.ok(script.includes('zero_samples_means_not_measured'))
  assert.ok(script.includes('is_physical_device_measurement'))
  assert.ok(script.includes('proves_zero_transient_flicker'))
})

test('P1 Native/PWA share Home information architecture without duplicating long Sections', () => {
  assert.ok(files.includes('Section("位置")'))
  assert.ok(files.includes('Section("个人收藏文件夹")'))
  assert.ok(files.includes('Section("整理")'))
  assert.ok(!files.includes('Section("快捷目录")'))
  assert.ok(files.includes('native-ios-files-home-edit-inline'))
  assert.ok(files.includes('native-ios-files-path-dropdown'))
  assert.ok(web.includes('data-mobile-files-home-section="quick"'))
  assert.ok(web.includes('data-mobile-files-home-section="organization"'))
  assert.ok(web.includes('data-mobile-files-location-trigger'))
})

test('P0 Gallery and album keep only a valid bounded page during tab return', () => {
  assert.ok(gallery.includes('XDriveIOSNativeLocalPageChanges'))
  assert.ok(gallery.includes('retainedLibraryRevision != libraryChanges.revision'))
  assert.ok(gallery.includes('isVisible = false'))
  assert.ok(gallery.includes('libraryChanges.start()'))
  assert.ok(album.includes('sameVerifiedPage'))
  assert.ok(album.includes('isContentVisible = false'))
  assert.ok(album.includes('if selected == nil && !sameVerifiedPage && !loading'))
})

test('P0 Recent/Favorites keep verified rows and do not auto-retry denied reads', () => {
  assert.ok(collections.includes('if !model.loading && model.error == nil { reload() }'))
  assert.ok(collections.includes('reload(preserveVerifiedRows: true)'))
  assert.ok(collections.includes('if isVisible && phase == .active && login.owner != nil'))
})

test('P1 100k files use at most four verified 64-row pages and O(1) ordinal jump', () => {
  assert.ok(window.includes('static let pageSize = 64'))
  assert.ok(window.includes('static let maximumVisibleItems = 4 * pageSize'))
  assert.ok(window.includes('static func pageContaining(itemNumber: Int, total: Int)'))
  assert.ok(windowChecks.includes('100_000'))
  assert.ok(files.includes('pendingJumpIndex = number - 1'))
  assert.ok(files.includes('IOS_NATIVE_FILES_JUMP_VERIFIED_MS'))
  assert.ok(script.includes('file_jump_verified'))
  assert.ok(files.includes('returnScroll.scrollTo(node.id, anchor: .center)'))
  assert.ok(window.includes('total <= maximumTotal'))
})

test('P2 existing Native buttons keep dynamic size/touch safety with consistent PWA grouping', () => {
  assert.ok(files.includes('.frame(minHeight: 52)'))
  assert.ok(files.includes('native-ios-files-quick-rail'))
  assert.ok(files.includes('native-ios-files-batch-direct-download'))
  assert.ok(files.includes('native-ios-files-batch-direct-trash'))
  assert.ok(files.includes('native-ios-files-batch-properties-sheet'))
})
