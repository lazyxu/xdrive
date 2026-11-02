'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const cloud = fs.readFileSync(
  path.join(root, 'ios/XDriveIOS/NativeCloudOriginalGallery.swift'), 'utf8'
)
const preview = cloud.slice(cloud.indexOf('    func preview(_ node:'),
                            cloud.indexOf('\n}\n\n@MainActor', cloud.indexOf('    func preview(_ node:')))
const still = preview.slice(preview.indexOf('if node.isVideo { return (nil, url) }'))

test('signed still preview rejects unsafe ticket and keeps original request bound', () => {
  assert.match(preview, /ticket\.url\.hasPrefix\("\/api\/v1\/file-preview\/"\)/)
  assert.match(preview, /parsed\.scheme == nil, parsed\.host == nil/)
  assert.match(preview, /final\.scheme == "https"/)
  assert.match(still, /request\(url, bearer: false\)/)
  assert.match(still, /maximum: 32 \* 1_048_576/)
  assert.doesNotMatch(preview, /Bearer .*url|WKWebView|UploadSession/)
})

test('compressed original is decoded off main at bounded pixel dimensions', () => {
  assert.match(still, /Task\.detached\(priority: \.utility\)/)
  assert.match(still, /CGImageSourceCreateWithData/)
  assert.match(still, /kCGImageSourceShouldCache: false/)
  assert.match(still, /CGImageSourceGetCount\(source\) > 0/)
  assert.match(still, /kCGImageSourceCreateThumbnailFromImageAlways as String: true/)
  assert.match(still, /kCGImageSourceCreateThumbnailWithTransform as String: true/)
  assert.match(still, /kCGImageSourceThumbnailMaxPixelSize as String: 4096/)
  assert.match(still, /CGImageSourceCreateThumbnailAtIndex\(source, 0/)
  assert.match(still, /try Task\.checkCancellation\(\)/)
  assert.match(still, /UIImage\(cgImage: decoded\)/)
  assert.doesNotMatch(still, /UIImage\(data: bytes\)|UIImage\.init\(data:/)
})

test('existing thumbnails and verified Live ZIP/cloud movies preserve Owner teardown', () => {
  assert.match(cloud, /kCGImageSourceThumbnailMaxPixelSize as String: 280/)
  assert.match(cloud, /if node\.isVideo \{ return \(nil, url\) \}/)
  assert.match(cloud, /func livePreview\(_ node:/)
  assert.match(cloud, /XDriveIOSLivePreviewArchive.extract\(temporary\)/)
  assert.match(cloud, /player = AVPlayer\(url: live.files.motionURL\)/)
  assert.match(cloud, /liveResources\?\.discard\(\)/)
  assert.match(cloud, /XDriveIOSNativeZoomablePhotoView\(image: still\)/)
  assert.match(cloud, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
})

test('native PhotoAsset Viewer foreground cancellation reaches both detached ImageIO decoders', () => {
  const media = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/NativeServerMediaGalleryTransport.swift'), 'utf8'
  )
  const start = media.indexOf('    func thumbnail(_ item:')
  const end = media.indexOf('    func preview(_ item:', start)
  assert.ok(start >= 0 && end > start)
  const tile = media.slice(start, end)
  const viewer = media.slice(end)
  for (const source of [tile, viewer]) {
    assert.match(source, /let decodeWork = Task\.detached\(priority: \.utility\)/)
    assert.match(source, /guard !Task\.isCancelled/)
    assert.match(source, /let decoded = CGImageSourceCreateThumbnailAtIndex\(source, 0/)
    assert.match(source, /return Task\.isCancelled \? nil : decoded/)
    assert.match(source, /await withTaskCancellationHandler \{\s*await decodeWork\.value\s*\} onCancel: \{\s*decodeWork\.cancel\(\)\s*\}/)
    assert.match(source, /try Task\.checkCancellation\(\)/)
    assert.doesNotMatch(source, /let (image|bounded) = await Task\.detached/)
  }
  assert.match(tile, /URLQueryItem\(name: "revision", value: String\(item\.node\.revision\)\)/)
  assert.match(tile, /kCGImageSourceThumbnailMaxPixelSize as String: 280/)
  assert.match(tile, /client\.invalidateAndCancel\(\)/)
  assert.match(viewer, /endpoint\("\/api\/v1\/files\/\\\(item\.id\)\/preview-ticket"\)/)
  assert.match(viewer, /read\(signedURL, bearer: false, maximum: 32 \* 1_048_576\)/)
  assert.match(viewer, /kCGImageSourceThumbnailMaxPixelSize as String: 4096/)
  assert.doesNotMatch(media, /UploadSessionTransport|PHAssetCreationRequest/)
})


test('backed-up original thumbnail and still decoders inherit foreground cancellation', () => {
  const thumb = cloud.slice(cloud.indexOf('    func thumbnail(_ node:'),
                            cloud.indexOf('    func preview(_ node:'))
  const previewStill = cloud.slice(cloud.indexOf('    func preview(_ node:'),
                                   cloud.indexOf('    private func requireCurrentOriginal'))
  for (const [name, part, pixelLimit] of [
    ['Owner grid thumbnail', thumb, 280],
    ['Owner fullscreen still', previewStill, 4096]
  ]) {
    assert.match(part, /let decodeWork = Task\.detached\(priority: \.utility\)/, name)
    assert.match(part, /guard !Task\.isCancelled/, name)
    assert.match(part, /return Task\.isCancelled \? nil : decoded/, name)
    assert.match(part, /await withTaskCancellationHandler \{\s*await decodeWork\.value\s*\} onCancel: \{\s*decodeWork\.cancel\(\)\s*\}/, name)
    assert.match(part, /try Task\.checkCancellation\(\)/, name)
    assert.ok(part.includes('kCGImageSourceThumbnailMaxPixelSize as String: ' + pixelLimit), name)
    assert.doesNotMatch(part, /let (image|decoded) = await Task\.detached/, name)
  }
  assert.match(previewStill, /if node\.isVideo \{ return \(nil, url\) \}/)
  assert.match(previewStill, /XDriveIOSNativeFilesViewerPolicy\.validTicketPath\(/)
  assert.doesNotMatch(thumb + previewStill, /URLSession\.shared|UploadSession|WKWebView/)
})


test('backed-up original still oversized/decode-only fallback is bounded, Owner-fenced, and labeled', () => {
  const reader = cloud.slice(cloud.indexOf('    func preview(_ node:'),
    cloud.indexOf('    private func requireCurrentOriginal'));
  const viewer = cloud.slice(cloud.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    cloud.indexOf('private struct XDriveIOSNativeCloudOriginalTileIdentity'));
  assert.match(cloud, /enum XDriveIOSNativeCloudStillFallback: Error/);
  assert.match(reader, /if node\.isVideo \{ return \(nil, url\) \}/);
  assert.match(reader, /readBoundedResponse\(\s*client, request: request\(url, bearer: false\),\s*maximum: 32 \* 1_048_576/);
  assert.match(reader, /catch XDriveIOSNativeCloudReadError\.tooLarge/);
  assert.match(reader, /try Task\.checkCancellation\(\)\s*guard let decoded else \{\s*throw XDriveIOSNativeCloudStillFallback\.unavailable/);
  assert.match(viewer, /catch XDriveIOSNativeCloudStillFallback\.unavailable/);
  assert.match(viewer, /guard target\.isImage, !target\.isVideo, !target\.isLiveArchive/);
  assert.match(viewer, /let thumbnail = try await reader\.thumbnail\(target\)/);
  assert.match(viewer, /try Task\.checkCancellation\(\)\s*guard phase == \.active, previewRequestID == requestID/);
  assert.match(viewer, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, before\)/);
  assert.match(viewer, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, before\)/);
  assert.match(viewer, /still = thumbnail\s*stillIsThumbnailOnly = true\s*error = nil/);
  assert.match(viewer, /stillIsThumbnailOnly \? "缩略图回退"/);
  assert.match(viewer, /native-ios-original-still-lowres/);
  assert.match(viewer, /native-ios-original-still-reload/);
  assert.match(viewer, /private func retryPreview\(\)[\s\S]*?still = nil\s*stillIsThumbnailOnly = false/);
  assert.match(reader, /XDriveIOSNativeFilesViewerPolicy\.validTicketPath\(/);
  assert.doesNotMatch(viewer, /UploadSessionTransport|WKWebView/);
})


test('cloud original still and thumbnail bodies are streamed within their byte limits', () => {
  const helper = cloud.slice(cloud.indexOf('private func readBoundedResponse'),
    cloud.indexOf('func page(offset: Int)'));
  const thumbnail = cloud.slice(cloud.indexOf('func thumbnail(_ node:'),
    cloud.indexOf('func preview(_ node:'));
  const reader = cloud.slice(cloud.indexOf('func preview(_ node:'),
    cloud.indexOf('private func requireCurrentOriginal'));
  const still = reader.slice(reader.indexOf('if node.isVideo { return (nil, url) }'));
  assert.match(helper, /client\.bytes\(for: request\)/);
  assert.match(helper, /for try await byte in stream/);
  assert.match(helper, /data\.count \+ chunk\.count < maximum/);
  assert.match(helper, /throw XDriveIOSNativeCloudReadError\.tooLarge/);
  assert.match(helper, /http\.statusCode == 200/);
  assert.match(thumbnail, /readBoundedResponse\(\s*client, request: request\(url\), maximum: 2 \* 1_048_576/);
  assert.match(still, /readBoundedResponse\(\s*client, request: request\(url, bearer: false\),\s*maximum: 32 \* 1_048_576/);
  assert.doesNotMatch(still, /client\.data\(for:/);
  assert.doesNotMatch(helper, /client\.data\(for:/);
});
