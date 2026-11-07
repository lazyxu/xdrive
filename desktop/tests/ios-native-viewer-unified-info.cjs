'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const component = read('ios/XDriveIOS/NativeViewerQualityPanel.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const photoAsset = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const originals = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')

function viewerSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, 'Viewer source boundaries must exist')
  return source.slice(start, end)
}

test('one native information sheet displays only source-backed media metadata', () => {
  assert.match(component, /struct XDriveIOSNativeViewerMediaDetails/)
  assert.match(component, /struct XDriveIOSNativeViewerResourceDetail/)
  assert.match(component, /struct XDriveIOSNativeViewerInfoSheet: View/)
  for (const field of [
    'fileName', 'mediaKind', 'capturedAt', 'originalBytes', 'format',
    'pixelWidth', 'pixelHeight', 'duration', 'location', 'locationStatus',
    'resources', 'liveFiles'
  ]) assert.ok(component.includes(field), 'missing shared media detail: ' + field)
  assert.match(component, /LabeledContent\(\s*"拍摄时间"/)
  assert.match(component, /LabeledContent\("原件大小"/)
  assert.match(component, /LabeledContent\("当前解码分辨率"/)
  assert.match(component, /XDriveIOSNativeViewerInfoMapPreview/)
  assert.match(component, /在地图中显示附近照片/)
  assert.match(component, /stagedSize\(liveFiles\.stillURL\)/)
  assert.doesNotMatch(component, /struct XDriveIOSNativeViewerQualityPanel/)
})

test('local PhotoKit info is revalidated and includes date, dimensions, duration and GPS', () => {
  const viewer = viewerSection(
    local,
    'struct XDriveIOSNativeLocalPhotoDetail: View',
    '/// Read-only, 64-at-a-time PhotoKit grid.'
  )
  assert.match(viewer, /private func verifiedPhotoInfo\(\)/)
  assert.match(viewer, /guard verified\(viewed\)/)
  assert.match(viewer, /XDrivePhotoKitResourceInspector\.inspect\(/)
  assert.match(viewer, /capturedAt: asset\.creationDate/)
  assert.match(viewer, /pixelWidth: asset\.pixelWidth/)
  assert.match(viewer, /pixelHeight: asset\.pixelHeight/)
  assert.match(viewer, /duration: asset\.mediaType == \.video \? asset\.duration : nil/)
  assert.match(viewer, /location: validLocation/)
  assert.match(viewer, /native-ios-local-viewer-info/)
  assert.match(viewer, /XDriveIOSNativeViewerInfoSheet\(/)
  assert.match(viewer, /if currentPageAuthorized, let details = photoInfoDetails/)
  assert.doesNotMatch(viewer, /XDriveIOSNativeViewerQualityPanel/)
})

test('cloud PhotoAsset info uses verified Node and resource metadata without invented EXIF', () => {
  const viewer = viewerSection(
    photoAsset,
    'struct XDriveIOSNativeServerMediaPreview: View',
    '/// Root and album-specific media wall'
  )
  assert.match(viewer, /private var mediaInfoDetails: XDriveIOSNativeViewerMediaDetails/)
  assert.match(viewer, /fileName: viewed\.node\.name/)
  assert.match(viewer, /originalBytes: viewed\.node\.size/)
  assert.match(viewer, /private var mediaInfoResources: \[XDriveIOSNativeViewerResourceDetail\]/)
  assert.match(viewer, /guard let resources = viewed\.resources else \{ return details \}/)
  assert.match(viewer, /resources: mediaInfoResources/)
  assert.match(viewer, /mimeType: resource\.mime_type/)
  assert.match(viewer, /locationStatus: verifiedPhotoCoordinate\.map/)
  assert.match(viewer, /XDriveIOSNativePhotoMapPolicy\.validCoordinate\(/)
  assert.match(viewer, /native-ios-photoasset-viewer-location-map/)
  assert.match(viewer, /XDriveIOSNativeOwnerPhotoMapScreen\(/)
  assert.match(viewer, /showingPhotoLocation = false/)
  assert.match(transport, /let latitude: Double\?/)
  assert.match(transport, /let longitude: Double\?/)
  assert.match(viewer, /previewStatus: imageIsThumbnailOnly \? "缩略图回退"/)
  assert.doesNotMatch(viewer, /capturedAt: .*creationDate/)
  assert.match(viewer, /native-ios-photoasset-viewer-info/)
  assert.match(viewer, /if ownerAuthorized \{\s*XDriveIOSNativeViewerInfoSheet/)
  assert.match(viewer, /showingMediaInfo = false/)
  assert.doesNotMatch(viewer, /XDriveIOSNativeViewerQualityPanel/)
})

test('cloud Originals info uses exact Node revision metadata and verified temporary Live resources', () => {
  const viewer = viewerSection(
    originals,
    'struct XDriveIOSNativeCloudOriginalPreview: View',
    "/// SwiftUI's ForEach identity"
  )
  assert.match(viewer, /private var mediaInfoDetails: XDriveIOSNativeViewerMediaDetails/)
  assert.match(viewer, /fileName: viewed\.name/)
  assert.match(viewer, /originalBytes: viewed\.size/)
  assert.match(viewer, /liveFiles: liveResources/)
  assert.match(viewer, /locationStatus: "云端 Originals 当前未提供拍摄位置元数据。"/)
  assert.match(viewer, /previewStatus: stillIsThumbnailOnly \? "缩略图回退"/)
  assert.match(viewer, /native-ios-original-viewer-info/)
  assert.match(viewer, /if currentOwnerAuthorized \{\s*XDriveIOSNativeViewerInfoSheet/)
  assert.match(viewer, /showingMediaInfo = false/)
  assert.doesNotMatch(viewer, /XDriveIOSNativeViewerQualityPanel/)
})
