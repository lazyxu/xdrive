'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const src = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeCloudOriginalGallery.swift'), 'utf8')

test('cloud originals render a bounded adaptive native thumbnail grid', () => {
  assert.match(src, /private struct XDriveIOSNativeCloudOriginalTile: View/)
  assert.match(src, /LazyVGrid\(/)
  assert.match(src, /ForEach\(model.nodes\)/)
  assert.match(src, /node: node, viewerActive: selected != nil,\s*model: model, login: login/)
  assert.match(src, /\.task\(id: "\\\(node.id\)-\\\(node.revision\)-\\\(viewerActive\)"\)/)
  assert.match(src, /\.onDisappear \{[\s\S]*?if !viewerActive \{ thumb = nil \}/)
  assert.match(src, /node.isLiveArchive \|\| node.isVideo/)
})

test('every thumbnail uses same Owner bearer and node revision, never the full original', () => {
  const t = src.slice(src.indexOf('    func thumbnail(_ node:'), src.indexOf('    func preview(_ node:'))
  assert.match(t, /XDriveIOSBackgroundOriginalNamePolicy\.valid\(node.name\)/)
  assert.match(t, /node.isImage \|\| node.isVideo/)
  assert.match(t, /"\/api\/v1\/media\/items\/\\\(node.id\)\/thumbnail"/)
  assert.match(t, /URLQueryItem\(name: "revision", value: String\(node.revision\)\)/)
  assert.match(t, /client.data\(for: request\(url\)\)/)
  assert.match(t, /maximum: 2 \* 1_048_576/)
  assert.match(t, /UIImage\(cgImage: image\)/)
  assert.doesNotMatch(t, /\/files\/.*\/content|preview-ticket|Bearer .*url|XDriveIOSOriginalRunGate|upload/)
})

test('untrusted image is downsampled off the main actor within a bounded memory envelope', () => {
  const t = src.slice(src.indexOf('    func thumbnail(_ node:'), src.indexOf('    func preview(_ node:'))
  assert.match(t, /Task.detached\(priority: \.utility\)/)
  assert.match(t, /CGImageSourceCreateWithData/)
  assert.match(t, /kCGImageSourceCreateThumbnailFromImageAlways as String: true/)
  assert.match(t, /kCGImageSourceThumbnailMaxPixelSize as String: 280/)
  assert.match(t, /CGImageSourceCreateThumbnailAtIndex/)
  assert.match(t, /try Task.checkCancellation\(\)/)
})

test('thumbnail authority is reused only inside one verified Owner page generation', () => {
  assert.match(src, /private var currentReader: XDriveIOSNativeCloudOriginalReader\?/)
  assert.match(src, /currentReader = nil/)
  assert.match(src, /login\.verifiedAuthorization\(\)/)
  assert.match(src, /owner: expected, accessToken: auth.accessToken/)
  assert.match(src, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, reader.owner\)/)
  assert.match(src, /guard epoch == token/)
  assert.match(src, /XDriveIOSNativeCloudOriginalGallery: View/)
  assert.doesNotMatch(src, /WKWebView|document\.cookie|localStorage|UserDefaults\.standard/)
})


test('foreground native Viewer preempts every queued cloud-original tile without dropping its 48-item page', () => {
  const model = src.slice(src.indexOf('final class XDriveIOSNativeCloudOriginalModel'),
    src.indexOf('private struct XDriveIOSNativeCloudOriginalTile'))
  const tile = src.slice(src.indexOf('private struct XDriveIOSNativeCloudOriginalTile'),
    src.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'))
  const wall = src.slice(src.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'))
  assert.match(tile, /let viewerActive: Bool/)
  assert.match(tile, /guard !viewerActive, thumb == nil/)
  assert.match(tile, /model\.thumbnail\(node, login: login\)/)
  assert.match(tile, /try Task\.checkCancellation\(\)/)
  assert.match(tile, /if !viewerActive \{ thumb = nil \}/)
  assert.match(wall, /viewerActive: selected != nil/)
  assert.match(wall, /\.onChange\(of: selected\?\.id\) \{ selectedID in[\s\S]*?model\.suspendForViewer\(\)/)
  const suspend = model.slice(model.indexOf('func suspendForViewer()'), model.indexOf('func cancel()'))
  assert.match(suspend, /epoch = UUID\(\)/)
  assert.match(suspend, /work\?\.cancel\(\)/)
  assert.match(suspend, /busy = false/)
  assert.doesNotMatch(suspend, /nodes = \[\]|currentReader = nil|total = 0|scanned = 0/)
  assert.match(wall, /onDismiss: \{[\s\S]*?if refreshAfterViewer \{[\s\S]*?model\.reload\(login: login\)/)
  assert.match(wall, /\.onChange\(of: login\.owner\)[\s\S]*?model\.invalidate\(\)/)
})
