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

test('existing thumbnail and Live ZIP/cloud movie behavior is preserved', () => {
  assert.match(cloud, /kCGImageSourceThumbnailMaxPixelSize as String: 280/)
  assert.match(cloud, /if node\.isVideo \{ return \(nil, url\) \}/)
  assert.match(cloud, /Live 原件已保存为双资源 ZIP/)
  assert.match(cloud, /XDriveIOSNativeZoomablePhotoView\(image: still\)/)
  assert.match(cloud, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
})