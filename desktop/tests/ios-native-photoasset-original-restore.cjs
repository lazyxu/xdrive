'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const transport = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const viewer = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const originalReader = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')

const start = transport.indexOf('func downloadOriginalForPhotos(_ selected: XDriveIOSNativeMediaItem)')
const end = transport.indexOf('/// Read-only native PhotoAsset Live playback.', start)
assert.ok(start > 0 && end > start)
const download = transport.slice(start, end)
const detailStart = viewer.indexOf('struct XDriveIOSNativeServerMediaPreview: View')
const detailEnd = viewer.indexOf('/// Root and album-specific media wall', detailStart)
assert.ok(detailStart > 0 && detailEnd > detailStart)
const detail = viewer.slice(detailStart, detailEnd)

test('PhotoAsset original restore uses current exact Owner Node, not a preview derivative', () => {
  assert.match(transport, /private func currentOriginal\(_ selected: XDriveIOSNativeMediaItem\)/)
  assert.match(transport, /current\.node\.revision == selected\.node\.revision/)
  assert.match(transport, /current\.node\.name == selected\.node\.name/)
  assert.match(transport, /current\.node\.size == selected\.node\.size/)
  assert.match(transport, /current\.resources == selected\.resources/)
  assert.match(download, /!selected\.isLive/)
  assert.match(download, /selected\.node\.size > 0/)
  assert.match(download, /selected\.node\.size <= 4 \* 1_073_741_824/)
  assert.match(download, /extensions\.contains\(ext\)/)
  assert.equal((download.match(/currentOriginal\(selected\)/g) || []).length, 2,
    're-read current PhotoAsset before ticket and again after original download')
  assert.match(download, /"\/api\/v1\/files\/\\\(selected\.id\)\/download-ticket"/)
  assert.match(download, /"\/api\/v1\/file-download\/\\\(selected\.id\)"/)
  assert.doesNotMatch(download, /preview-ticket|thumbnail\(|kCGImageSource/)
})

test('signed source is single-use scoped, size-checked, never a token-bearing external URL', () => {
  for (const term of [
    'parsed.scheme == nil', 'parsed.host == nil',
    'parsed.user == nil', 'parsed.password == nil',
    'parsed.fragment == nil', 'parsed.path == expectedPath',
    'query.count == 1', 'query[0].name == "ticket"',
    'secret.utf8.count <= 8192', 'resolved.scheme == "https"',
    'resolved.host == origin.host', 'resolved.port == origin.port',
    'request.httpShouldHandleCookies = false',
    'client.download(for: request)', 'http.statusCode == 200',
    'http.expectedContentLength == selected.node.size',
    'attributes[.type] as? FileAttributeType',
    'attributes[.size] as? NSNumber',
    'try Task.checkCancellation()'
  ]) assert.ok(download.includes(term), 'missing original download guard: ' + term)
  assert.match(download, /try FileManager\.default\.moveItem\(at: temporary, to: output\)/)
  assert.match(download, /try\? FileManager\.default\.removeItem\(at: folder\)/)
  assert.match(transport, /XDriveIOSNativeMediaRejectRedirect/)
  assert.match(originalReader, /func downloadOriginalForPhotos\(_ node: XDriveIOSNativeCloudOriginal\)/)
  assert.doesNotMatch(download, /Authorization|Bearer|localStorage|WKWebView|UploadSession/)
})

test('user chooses native add-only save and no Live still is mislabeled restored', () => {
  assert.match(viewer, /import Photos/)
  assert.match(detail, /native-ios-photoasset-original-save-to-photos/)
  assert.match(detail, /PHPhotoLibrary\.requestAuthorization\(for: \.addOnly\)/)
  assert.match(detail, /reader\.downloadOriginalForPhotos\(selected\)/)
  assert.match(detail, /PHPhotoLibrary\.shared\(\)\.performChanges/)
  assert.match(detail, /PHAssetCreationRequest\.forAsset\(\)/)
  assert.match(detail, /selected\.isVideo \? \.video : \.photo/)
  assert.match(detail, /asset\.addResource\(with: kind, fileURL: originalURL, options: nil\)/)
  assert.match(detail, /if viewed\.isLive \{[\s\S]*?尚未提供完整原件配对导入/)
  assert.match(detail, /!viewed\.isLive/)
  assert.doesNotMatch(download, /\.pairedVideo|\.photoLive|\.preview\(/)
})

test('native Viewer and Owner boundaries cancel stale Photos restore without touching backup', () => {
  assert.match(detail, /private func cancelPhotosRestore\(\)/)
  assert.match(detail, /photosRestoreTask\?\.cancel\(\)/)
  assert.match(detail, /photosRestoreEpoch == epoch/)
  assert.match(detail, /viewed\.id == selected\.id/)
  assert.match(detail, /viewed\.node\.revision == selected\.node\.revision/)
  assert.match(detail, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, owner\)/)
  assert.match(detail, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(detail, /defer \{[\s\S]*?removeItem\([\s\S]*?originalURL\.deletingLastPathComponent/)
  assert.match(detail, /phase == \.background \|\| !photosPermissionPrompt/)
  assert.match(detail, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?cancelPhotosRestore\(\)/)
  assert.match(detail, /\.onDisappear \{ cancelPhotosRestore\(\) \}/)
  assert.match(detail, /private func navigateLoaded\(_ direction: Int\) \{[\s\S]*?cancelPhotosRestore\(\)/)
  assert.doesNotMatch(detail, /UploadSession|markConfirmed|ledger\.write|deleteCloud/)
})
