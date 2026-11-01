'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const transport = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const view = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const paired = read('ios/XDriveIOS/NativeCloudPairedLivePhotoView.swift')
const api = read('internal/api/media.go')

test('PhotoAsset live uses the authoritative Server Live resource tickets, no extra writer', () => {
  assert.match(transport, /let container_kind: String\?/)
  assert.match(transport, /let resources: \[Resource\]\?/)
  assert.match(transport, /func livePreview\(_ selected: XDriveIOSNativeMediaItem\)/)
  assert.match(transport, /currentLiveItem\(selected\.id\)/)
  assert.match(transport, /sameLiveSource\(before, selected\)/)
  assert.match(transport, /sameLiveSource\(before, after\)/)
  assert.match(transport, /item\.node\.revision > 0/)
  assert.match(transport, /item\.metadata\.container_kind\?\.lowercased\(\) == "livp"/)
  assert.match(transport, /resources\.count == 2/)
  for (const guard of [
    'still.node_id == item.id',
    'motion.node_id != item.id',
    'still.kind == "node"',
    'motion.kind == "node"',
    'still.size <= Self.maximumStillBytes',
    'motion.size <= Self.maximumPairBytes - still.size'
  ]) assert.ok(transport.includes(guard), 'missing Live pair admission: ' + guard)
  assert.match(transport, /\/api\/v1\/media\/items\/\\\(selected\.id\)\/live-photo-still-ticket/)
  assert.match(transport, /\/api\/v1\/media\/items\/\\\(selected\.id\)\/live-photo-motion-ticket/)
  assert.match(transport, /\/api\/v1\/files\/\\\(selected\.id\)\/preview-ticket/)
  assert.match(api, /mediaLivePhotoMotionTicket\(c \*gin\.Context\)/)
  assert.match(api, /mediaLivePhotoStillTicket\(c \*gin\.Context\)/)
  assert.doesNotMatch(transport, /UploadSession|\.upload\(|CASWriter|httpShouldSetCookies = true|WKWebView|localStorage/)
})

test('Live ticket transport is same-origin, one ticket, redirect-denied and bounded', () => {
  const signed = transport.slice(transport.indexOf('private func signedLiveURL('),
    transport.indexOf('private func liveTicket('))
  for (const guard of [
    'ticket.url.hasPrefix(path + "?")',
    'parsed.scheme == nil', 'parsed.host == nil',
    'parsed.user == nil', 'parsed.password == nil',
    'parsed.fragment == nil', 'parsed.path == path',
    'query.count == 1', 'query[0].name == "ticket"',
    'secret.utf8.count <= 8192', 'result.scheme == "https"',
    'result.host == base.host', 'result.port == base.port'
  ]) assert.ok(signed.includes(guard), 'missing signed ticket restriction: ' + guard)
  const downloaded = transport.slice(transport.indexOf('private func downloadLiveResource('),
    transport.indexOf('func livePreview(_ selected:'))
  for (const guard of [
    'let client = session()',
    'client.invalidateAndCancel()',
    'client.download(for: request)',
    'try Task.checkCancellation()',
    'http.statusCode == 200',
    'http.expectedContentLength <= limit',
    'String(actualType) == ticket.mime',
    'length > 0, length <= limit',
    'FileProtectionType.complete'
  ]) assert.ok(downloaded.includes(guard), 'missing download bound: ' + guard)
  assert.doesNotMatch(downloaded, /Authorization|Bearer|followRedirect|httpShouldHandleCookies = true/)
  assert.match(transport, /XDriveIOSNativeMediaRejectRedirect/)
  assert.match(transport, /func urlSession\([\s\S]*?completionHandler\(nil\)/)
  assert.match(transport, /try\? manager\.removeItem\(at: directory\)/)
  assert.match(transport, /withTaskCancellationHandler[\s\S]*?decoder\.cancel\(\)/)
})

test('Viewer reuses native Photos pairing and keeps an honest still/video fallback', () => {
  const start = view.indexOf('struct XDriveIOSNativeServerMediaPreview: View')
  const end = view.indexOf('/// Root and album-specific media wall', start)
  assert.ok(start > 0 && end > start)
  const detail = view.slice(start, end)
  assert.match(detail, /if item\.isLive, let still = image/)
  assert.match(detail, /XDriveIOSNativeCloudPairedLivePhotoView\(/)
  assert.match(detail, /let live = try await reader\.livePreview\(item\)/)
  assert.match(detail, /live\.files\.discard\(\)/)
  assert.match(detail, /liveResources\?\.discard\(\)/)
  assert.match(detail, /nativeLiveUnavailable = true/)
  assert.match(detail, /Button\("播放原生实况"\)/)
  assert.match(detail, /Button\(showingLiveMotion \? "返回静态照片" : "播放原始动态视频"\)/)
  assert.match(detail, /reader\.thumbnail\(item\)/)
  assert.match(detail, /"Live 动态资源暂不可用；可重试配对，静态封面将独立读取。"/)
  assert.match(detail, /XDriveIOSNativePhotoOwnerScope\.matches\(\s*login\.owner, currentOwner\s*\)/)
  assert.match(detail, /previewRequestID == requestID/)
  assert.match(detail, /\.onChange\(of: phase\) \{ _ in[\s\S]*?retirePreview\(\)/)
  assert.match(detail, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?retirePreview\(\)[\s\S]*?dismiss\(\)/)
  assert.match(detail, /\.onDisappear \{ retirePreview\(\) \}/)
  assert.match(paired, /PHLivePhoto\.request\(/)
  assert.match(paired, /PHLivePhoto\.cancelRequest\(/)
  assert.match(paired, /static func dismantleUIView[\s\S]*?coordinator\.retire\(\)/)
  assert.doesNotMatch(detail, /目前只支持静态预览|WKWebView|UploadSession|UserDefaults/)
})
