'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
const reader = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const source = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const viewer = source.slice(source.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
  source.indexOf('/// Root and album-specific media wall'))

test('only a validated still body limit or ImageIO decode failure offers low-res recovery', () => {
  const body = reader.slice(reader.indexOf('func preview(_ item: XDriveIOSNativeMediaItem)'),
    reader.indexOf('private func validOrdinaryPhotoAssetName'))
  assert.match(reader, /enum XDriveIOSNativeMediaStillPreviewFallback: Error/)
  assert.match(body, /guard item\.supportsPreview else/)
  assert.match(body, /ticket\.url\.hasPrefix\("\/api\/v1\/file-preview\/"\)/)
  assert.match(body, /if item\.isVideo \{ return \(nil, signedURL\) \}/)
  assert.match(body, /still = try await read\(\s*signedURL, bearer: false, maximum: 32 \* 1_048_576/)
  assert.match(body, /catch XDriveIOSNativeMediaReadFailure\.tooLarge \{/)
  assert.match(body, /guard let bounded else \{[\s\S]*?throw XDriveIOSNativeMediaStillPreviewFallback\.unavailable/)
  assert.doesNotMatch(body.slice(0, body.indexOf('if item.isVideo')), /throw XDriveIOSNativeMediaStillPreviewFallback\.unavailable/)
})

test('Gallery still fallback retains exact Owner/Node/revision and an honest low-res UI', () => {
  assert.ok(viewer.length > 1000)
  assert.match(viewer, /catch XDriveIOSNativeMediaStillPreviewFallback\.unavailable \{/)
  assert.match(viewer, /guard target\.supportsPreview, !target\.isLive, !target\.isVideo/)
  assert.match(viewer, /let thumbnail = try await reader\.thumbnail\(target\)/)
  assert.match(viewer, /try Task\.checkCancellation\(\)[\s\S]*?previewRequestID == requestID/)
  assert.match(viewer, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(viewer, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/)
  assert.match(viewer, /image = thumbnail\s*imageIsThumbnailOnly = true\s*failure = nil/)
  assert.match(viewer, /source: imageIsThumbnailOnly \? "缩略图回退"/)
  assert.match(viewer, /native-ios-photoasset-still-lowres/)
  assert.match(viewer, /native-ios-photoasset-still-reload/)
  assert.match(viewer, /if ownerAuthorized && imageIsThumbnailOnly \{[\s\S]*?Button \{ retirePreview\(\) \}/)
  assert.match(viewer, /private func retirePreview\(\)[\s\S]*?imageIsThumbnailOnly = false/)
  assert.match(reader, /URLQueryItem\(name: "revision", value: String\(item\.node\.revision\)\)/)
  assert.match(reader, /allowedMIMEs|image\/jpeg|image\/png/)
  assert.doesNotMatch(viewer, /WKWebView|UploadSession|localStorage/)
})

test('Live pairing and native video failure paths remain separate from still thumbnail recovery', () => {
  assert.match(viewer, /if target\.isLive \{[\s\S]*?let live = try await reader\.livePreview\(target\)/)
  assert.match(viewer, /imageIsThumbnailOnly = true/)
  assert.match(viewer, /let media = try await XDriveIOSNativeMediaGalleryReader\([\s\S]*?\)\.preview\(target\)/)
  assert.match(viewer, /if let url = media\.videoURL \{ player = AVPlayer\(url: url\) \}/)
  assert.match(viewer, /reader\.thumbnail\(target\)/)
  assert.match(viewer, /XDriveIOSNativeAVPlayerStatusObserver\(/)
  assert.match(viewer, /native-ios-photoasset-player-reload/)
})


test('both native cloud still and video tickets stay bound to the exact selected Node', () => {
  const original = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
  const bounded = read('ios/XDriveIOS/NativeFilesViewerPolicy.swift')
  const server = read('internal/api/file_preview.go')
  const galleryPreview = reader.slice(reader.indexOf('func preview(_ item: XDriveIOSNativeMediaItem)'),
    reader.indexOf('private func validOrdinaryPhotoAssetName'))
  const originalPreview = original.slice(original.indexOf('func preview(_ node: XDriveIOSNativeCloudOriginal)'),
    original.indexOf('private func requireCurrentOriginal'))
  assert.match(galleryPreview, /XDriveIOSNativeFilesViewerPolicy\.validTicketPath\(\s*ticket\.url, nodeID: item\.id\s*\)/)
  assert.match(originalPreview, /XDriveIOSNativeFilesViewerPolicy\.validTicketPath\(\s*ticket\.url, nodeID: node\.id\s*\)/)
  assert.match(bounded, /url\.percentEncodedPath == "\/api\/v1\/file-preview\/\\\(nodeID\)"/)
  assert.match(bounded, /queries\.count == 1/)
  assert.match(bounded, /queries\[0\]\.name == "ticket"/)
  assert.match(bounded, /url\.scheme == nil, url\.host == nil, url\.port == nil/)
  assert.match(bounded, /ticket\.utf8\.count <= 8_192/)
  assert.ok(server.includes('/api/v1/file-preview/%d?ticket=%s'),
    'existing Go Server sends a matching exact Node ticket path')
  assert.match(galleryPreview, /if item\.isVideo \{ return \(nil, signedURL\) \}/)
  assert.match(originalPreview, /if node\.isVideo \{ return \(nil, url\) \}/)
})
