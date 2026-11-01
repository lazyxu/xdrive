'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift');
const view = read('ios/XDriveIOS/NativeFilesViewer.swift');
const reader = read('ios/XDriveIOS/NativeFilesPreviewTransport.swift');
const policy = read('ios/XDriveIOS/NativeFilesViewerPolicy.swift');

test('one native Files modal opens from the current real page and reanchors after verification', () => {
  assert.match(browser, /ScrollViewReader \{ returnScroll in/);
  assert.match(browser, /selectedOwner = owner[\s\S]*?lastViewedFile = entry\.node[\s\S]*?selectedFile = entry/);
  assert.match(browser, /\.fullScreenCover\(item: \$selectedFile, onDismiss:/);
  assert.match(browser, /XDriveIOSNativeFilesViewer\(\s*initial: initial\.node,/);
  assert.match(browser, /loadedItems: model\.entries\.map\(\\\.node\)\.filter/);
  assert.match(browser, /\$0\.parent_id == initial\.node\.parent_id/);
  assert.match(browser, /onNavigate: \{ next in[\s\S]*?selectedFile\?\.id == initial\.id/);
  assert.match(browser, /model\.entries\.contains\(where: \{ \$0\.node == next \}\)/);
  assert.match(browser, /lastViewedFile = next/);
  assert.match(browser, /returnScroll\.scrollTo\(target\.id, anchor: \.center\)/);
  assert.match(browser, /if selectedFile == nil \{ model\.invalidate\(\) \}/);
});

test('native image/video/PDF/audio/text viewers share one read-only lifecycle', () => {
  assert.match(view, /struct XDriveIOSNativeFilesViewer: View/);
  assert.match(view, /XDriveIOSNativeZoomablePhotoView\(image: image\)/);
  assert.match(view, /VideoPlayer\(player: player\)/);
  assert.match(view, /XDriveIOSNativePDFDocumentSurface\(document: document\)/);
  assert.match(view, /private struct XDriveIOSNativeFileAudioSurface: View/);
  assert.match(view, /Slider\(/);
  assert.match(view, /case \.text\(let content, let truncated\)/);
  assert.match(view, /Text\(content\.isEmpty \? "空文本文件" : content\)/);
  assert.match(view, /Button\("重试"\)/);
  assert.match(view, /XDriveIOSNativeFilesViewerPolicy\.neighbor\(/);
  assert.match(view, /let credentials = try await login\.verifiedAuthorization\(\)/);
  assert.match(view, /try Task\.checkCancellation\(\)/);
  assert.match(view, /generation == attempt, viewed == current, authorized/);
  assert.match(view, /player\?\.pause\(\)[\s\S]*?player\?\.replaceCurrentItem\(with: nil\)/);
  assert.match(view, /\.onChange\(of: login\.owner\) \{ _ in close\(\) \}/);
  assert.match(view, /\.AVPlayerItemFailedToPlayToEndTime/);
  assert.match(view, /failed === current/);
  assert.match(view, /failure = "媒体播放失败，请重试当前文件。"/);
  assert.match(view, /if let reason = error as\? XDriveIOSNativeFilesPreviewError/);
  assert.match(view, /\.onDisappear \{ retire\(\) \}/);
  assert.doesNotMatch(view, /import WebKit|WKWebView\s*\(|UploadSession|document\.cookie/);
});

test('Owner, Node revision, exact MIME and ticket are checked before payload use', () => {
  assert.match(reader, /private func verifyNode\(_ selected: XDriveIOSNativeFilesNode\)/);
  assert.match(reader, /endpoint\("\/api\/v1\/nodes\/\\\(selected\.id\)"\)/);
  assert.match(reader, /guard actual == selected/);
  assert.match(reader, /endpoint\("\/api\/v1\/files\/\\\(selected\.id\)\/preview\/text"\)/);
  assert.match(reader, /endpoint\("\/api\/v1\/files\/\\\(selected\.id\)\/preview-ticket"\)/);
  assert.match(reader, /method: "POST", maximum: 32_768/);
  assert.match(reader, /validTicketType\(/);
  assert.match(reader, /validTicketPath\(value, nodeID: nodeID\)/);
  assert.match(reader, /URLSessionConfiguration\.ephemeral/);
  assert.match(reader, /completionHandler\(nil\)/);
  assert.match(reader, /expectedMIME: ticket\.mime_type/);
  assert.match(reader, /kCGImageSourceThumbnailMaxPixelSize as String: 4096/);
  assert.match(reader, /PDFDocument\(data: bytes\), document\.pageCount > 0/);
  assert.match(policy, /static let maximumLoadedRows = 64/);
  assert.match(policy, /Set\(loaded\.map\(\\\.id\)\)\.count == loaded\.count/);
  assert.match(policy, /return files\[fileIndex \+ direction\]/);
  assert.doesNotMatch(reader, /POST.*UploadSession|FileManager\.default\.createFile|WKWebView/);
});

test('large and incompatible stills use revision-bound indexed derivatives only', () => {
  assert.match(policy, /"avif", "bmp"/);
  assert.match(policy, /case \.image: return node\.size > 0/);
  assert.match(reader, /if kind == \.image && selected\.size > XDriveIOSNativeFilesViewerPolicy\.maximumImageBytes \{[\s\S]*?return try await fallbackThumbnail\(selected\)/);
  assert.match(reader, /endpoint\("\/api\/v1\/media\/items\/\\\(selected\.id\)\/thumbnail"\)/);
  assert.match(reader, /URLQueryItem\(name: "revision", value: String\(selected\.revision\)\)/);
  assert.match(reader, /allowedMIMEs: \["image\/jpeg", "image\/png", "image\/heic", "image\/webp"\]/);
  assert.match(reader, /kCGImageSourceThumbnailMaxPixelSize as String: 1024/);
  assert.match(reader, /try await verifyNode\(selected\)[\s\S]*?return UIImage\(cgImage: image\)/);
  assert.match(reader, /case \.changed, \.invalidOwner, \.response\(401\), \.response\(403\)/);
  assert.match(view, /case \.imageThumbnail\(let image\):/);
  assert.match(view, /case \.noThumbnail:/);
  assert.doesNotMatch(reader, /URLSessionConfiguration\.default|URLSession\.shared/);
});
