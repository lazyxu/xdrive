const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const albums = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')

test('local PhotoKit thumbnails never request iCloud originals implicitly', () => {
  assert.match(local, /settings\.isNetworkAccessAllowed = false/)
  assert.match(local, /func load\(_ candidate: XDrivePhotoKitScanCandidate, allowICloud: Bool = false\)/)
  assert.doesNotMatch(local, /(?:options|liveOptions)\.isNetworkAccessAllowed = true/)
})

test('only the foreground Viewer explicit action admits current iCloud media', () => {
  assert.match(local, /private func loadCurrentFromICloud\(\) \{[\s\S]*?guard currentPageAuthorized,[\s\S]*?asset\.creationDate == viewed\.capturedAt,[\s\S]*?asset\.modificationDate == viewed\.modifiedAt,[\s\S]*?model\.load\(viewed, allowICloud: true\)/)
  assert.match(local, /Button\(requestedICloudForCurrentItem \?[\s\S]*?"从 iCloud 加载当前原件"\) \{\s*loadCurrentFromICloud\(\)/)
  assert.match(local, /\.accessibilityIdentifier\("native-ios-local-viewer-icloud-load"\)/)
  assert.match(local, /options\.isNetworkAccessAllowed = allowICloud/)
  assert.match(local, /liveOptions\.isNetworkAccessAllowed = allowICloud/)
  assert.match(local, /needsICloudFetch = true/)
  assert.match(local, /downloadingFromICloud = true/)
})

test('remote PhotoKit requests are cancellable on item, scene and library changes', () => {
  assert.match(local, /private var epoch = UUID\(\)/)
  assert.match(local, /private func finishICloudPart\(_ part: String, token: UUID\)/)
  assert.match(local, /func cancel\(\) \{[\s\S]*?pendingICloudParts\.removeAll\(\)[\s\S]*?downloadingFromICloud = false[\s\S]*?needsICloudFetch = false/)
  assert.match(local, /requestedICloudForCurrentItem = false\s*model\.cancel\(\)\s*activeItem = next/)
  assert.match(local, /if state != \.active \{[\s\S]*?requestedICloudForCurrentItem = false[\s\S]*?model\.cancel\(\)/)
  assert.match(local, /\.onChange\(of: changes\.generation\) \{ _ in[\s\S]*?model\.cancel\(\)[\s\S]*?dismiss\(\)/)
  assert.match(local, /guard let self, self\.epoch == token/)
  assert.match(albums, /XDriveIOSNativeLocalPhotoDetail\(/)
})

test('viewing an iCloud-only item is not an upload or a backup-success receipt', () => {
  const viewer = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'), local.indexOf('struct XDriveIOSNativeLocalGalleryScreen: View'))
  assert.doesNotMatch(viewer, /ForegroundPhotoBackupMVP|JournaledOriginalUpload|upload-session|receipt.*confirm/i)
  assert.match(viewer, /ProgressView\("正在从 iCloud 获取当前原件…"\)/)
  assert.match(viewer, /native-ios-local-viewer-retry/)
})


test('local native Live Photo hints only after the full PhotoKit pair is ready', () => {
  const model = local.slice(
    local.indexOf('final class XDriveIOSLocalPhotoDetailModel'),
    local.indexOf('private struct XDriveIOSNativeLivePhotoView'))
  const wrapped = local.slice(
    local.indexOf('private struct XDriveIOSNativeLivePhotoView'),
    local.indexOf('/// A long horizontal drag pages'))
  assert.match(model, /@Published private\(set\) var liveIsFinal = false/)
  assert.match(model, /if !degraded \{ self\.liveIsFinal = true \}/)
  assert.match(model, /if !degraded \|\| !self\.liveIsFinal \{/)
  assert.match(model, /live = nil\s*still = nil\s*liveIsFinal = false/)
  assert.match(local, /hintReady: model\.liveIsFinal && currentPageAuthorized &&\s*!model\.downloadingFromICloud/)
  assert.match(wrapped, /let hintReady: Bool/)
  assert.match(wrapped, /var didHint = false/)
  assert.match(wrapped, /context\.coordinator\.didHint = false/)
  assert.match(wrapped, /if let request = playbackRequest,[\s\S]*?view\.startPlayback\(with: \.full\)/)
  assert.match(wrapped, /else if hintReady, playbackRequest == nil,[\s\S]*?!context\.coordinator\.didHint/)
  assert.match(wrapped, /UIApplication\.shared\.applicationState == \.active &&\s*!UIAccessibility\.isReduceMotionEnabled/)
  assert.match(wrapped, /view\.startPlayback\(with: \.hint\)/)
  assert.match(wrapped, /static func dismantleUIView[\s\S]*?view\.stopPlayback\(\)[\s\S]*?view\.livePhoto = nil/)
  assert.doesNotMatch(wrapped, /URLSession|UploadSession|PHAssetCreationRequest|UserDefaults/)
});
