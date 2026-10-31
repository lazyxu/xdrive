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

test('native cloud original pages stay unique while automatic uploads shift descending offsets', () => {
  const model = src.slice(src.indexOf('final class XDriveIOSNativeCloudOriginalModel'),
    src.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'))
  const clear = model.slice(model.indexOf('func invalidate()'), model.indexOf('func reload('))
  const read = model.slice(model.indexOf('func loadNext('))
  const suspend = model.slice(model.indexOf('func suspendForViewer()'), model.indexOf('func cancel()'))
  assert.match(model, /private var seenNodeIDs = Set<UInt64>\(\)/)
  assert.match(clear, /nodes = \[\]\s*seenNodeIDs\.removeAll\(\)\s*total = 0/)
  assert.match(read, /guard self\?\.epoch == ticket,[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(read, /for node in reply\.nodes \{\s*guard model\.seenNodeIDs\.insert\(node\.id\)\.inserted else \{ continue \}\s*model\.nodes\.append\(node\)/)
  assert.match(read, /model\.scanned = min\(reply\.total, start \+ 48\)/)
  assert.doesNotMatch(suspend, /seenNodeIDs\.removeAll\(\)/)
  const pages = [Array.from({length:48}, (_, i) => 100 - i),
    [54, 53, ...Array.from({length:46}, (_, i) => 52 - i)]]
  const ids = new Set(), visible = []
  for (const page of pages) for (const id of page) {
    if (!ids.has(id)) { ids.add(id); visible.push(id) }
  }
  assert.equal(visible.length, 94)
  assert.equal(new Set(visible).size, visible.length)
})

test('native cloud originals clear revoked Owner pages and invalid Server responses', () => {
  const model = src.slice(src.indexOf('final class XDriveIOSNativeCloudOriginalModel'),
    src.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'))
  const policy = model.slice(model.indexOf('private static func canRetainPage('),
    model.indexOf('/// Drop all prior Owner rows'))
  const load = model.slice(model.indexOf('func loadNext('))
  assert.match(policy, /case \.server\(let status\):[\s\S]*?permitsRetainingPreviousPage\(httpStatus: status\)/)
  assert.match(policy, /case \.invalidScope, \.invalidResponse, \.notSupported:\s*return false/)
  assert.match(policy, /guard let network = error as\? URLError else \{ return false \}/)
  assert.match(policy, /permitsRetainingPreviousPage\(urlError: network.code\)/)
  assert.match(load, /auth = try await login\.verifiedAuthorization\(\)/)
  assert.match(load, /catch is CancellationError \{\s*throw CancellationError\(\)/)
  assert.match(load, /catch \{\s*guard self\?\.epoch == ticket else \{ return \}\s*self\?\.invalidate\(\)/)
  assert.match(load, /guard self\?\.epoch == ticket else \{ return \}\s*guard XDriveIOSNativePhotoOwnerScope\.matches\(auth.owner, expected\)/)
  assert.match(load, /XDriveIOSNativePhotoOwnerScope\.matches\(auth.owner, expected\),\s*XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, expected\)/)
  assert.match(load, /guard XDriveIOSNativeCloudOriginalModel\.canRetainPage\(after: error\) else \{\s*self\?\.invalidate\(\)/)
  assert.match(load, /旧页面已清除/)
  assert.match(load, /已保留已验证页面，可重试当前批次/)
  // Transient pagination retries the original offset, not the first page.
  assert.match(load, /let start = scanned/)
  assert.match(load, /\.page\(offset: start\)/)
  assert.match(load, /model\.scanned = min\(reply\.total, start \+ 48\)/)
})

test('read failure policy preserves only the existing native Gallery transient statuses', () => {
  const fs = require('node:fs')
  const policy = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeMediaPageRetryPolicy.swift'), 'utf8')
  assert.match(policy, /httpStatus == 408 \|\| httpStatus == 429 \|\| \(500\.\.\.599\)\.contains\(httpStatus\)/)
  assert.match(policy, /\.notConnectedToInternet, \.networkConnectionLost, \.timedOut/)
  assert.match(policy, /case \.notConnectedToInternet,[\s\S]*?default:\s*return false/)
  const original = src.slice(src.indexOf('private static func canRetainPage('),
    src.indexOf('/// Drop all prior Owner rows'))
  assert.doesNotMatch(original, /return true/)
  assert.doesNotMatch(original, /catch \{/)
})
