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
  // Preserve bounded-memory previews; oversized originals take the existing
  // Files management export route rather than an unbounded UIKit decode.
  assert.match(reader, /selected.size > XDriveIOSNativeFilesViewerPolicy.maximumImageBytes/);
  assert.match(reader, /selected.size > XDriveIOSNativeFilesViewerPolicy.maximumPDFBytes/);
  assert.match(reader, /throw XDriveIOSNativeFilesPreviewError.tooLarge/);
  assert.match(view, /导出上限 512 MiB/);
  assert.match(reader, /PDFDocument\(data: bytes\), document\.pageCount > 0/);
  assert.match(policy, /static let maximumLoadedRows = 64/);
  assert.match(policy, /Set\(loaded\.map\(\\\.id\)\)\.count == loaded\.count/);
  assert.match(policy, /return files\[fileIndex \+ direction\]/);
  assert.doesNotMatch(reader, /POST.*UploadSession|FileManager\.default\.createFile|WKWebView/);
});

test('Files audio and video expose initial KVO loading failure, scoped retry and landscape recovery', () => {
  const modal = view.slice(view.indexOf('struct XDriveIOSNativeFilesViewer: View'));
  assert.match(modal, /case \.video:[\s\S]*?observingPlayer\(/);
  assert.match(modal, /case \.audio:[\s\S]*?observingPlayer\(/);
  assert.equal((modal.match(/\.publisher\(for: \\\.status, options: \[\.initial, \.new\]\)/g) || []).length, 2);
  assert.match(modal, /if status == \.failed \{ playbackFailed\(item\) \}/);
  assert.match(modal, /guard authorized, let current = player\?\.currentItem,\s*failed === current/);
  assert.match(modal, /ToolbarItem\(placement: \.navigationBarTrailing\)[\s\S]*?Button\("重新加载媒体"\) \{ reloadCurrent\(\) \}/);
  assert.match(modal, /accessibilityIdentifier\("native-ios-files-player-reload"\)/);
  assert.match(modal, /Button\("重试"\) \{ reloadCurrent\(\) \}/);
  assert.match(modal, /private func reloadCurrent\(\)[\s\S]*?guard authorized else \{ return \}[\s\S]*?retire\(\)[\s\S]*?failure = nil[\s\S]*?loading = true[\s\S]*?attempt = UUID\(\)/);
  assert.match(modal, /private func openCurrent\(\) async[\s\S]*?retire\(\)\s*failure = nil\s*loading = true/);
  assert.match(modal, /\.onChange\(of: phase\)[\s\S]*?retire\(\)/);
});

test('unsupported, oversized, undecodable and failed-player Files previews expose current-original export', () => {
  const exportModel = read('ios/XDriveIOS/NativeFilesDownloadExport.swift');
  const modal = view.slice(view.indexOf('struct XDriveIOSNativeFilesViewer: View'));
  assert.match(modal, /@StateObject private var exporter = XDriveIOSNativeFilesExportModel\(\)/);
  assert.match(modal, /if authorized && exportFallbackEligible/);
  assert.match(modal, /case \.unsupported:[\s\S]*?exportFallbackEligible = true/);
  assert.match(modal, /case \.tooLarge:[\s\S]*?exportFallbackEligible = true/);
  assert.match(modal, /case \.malformed:[\s\S]*?exportFallbackEligible = true/);
  assert.match(modal, /failure = "媒体播放失败，请重试当前文件。"\s*exportFallbackEligible = true/);
  assert.match(modal, /staged\.nodeID == viewed\.id && staged\.revision == viewed\.revision/);
  assert.match(modal, /exporter\.prepare\(viewed, login: login\)/);
  assert.match(modal, /ShareLink\(item: staged\.fileURL\)/);
  assert.match(modal, /exporter\.invalidate\(\)[\s\S]*?exportFallbackEligible = false/);
  assert.match(modal, /accessibilityIdentifier\("native-ios-files-viewer-error-scroll"\)/);
  assert.match(modal, /accessibilityIdentifier\("native-ios-files-viewer-export-cancel"\)/);
  assert.match(exportModel, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/);
  assert.match(exportModel, /let stillCurrent: XDriveIOSNativeFilesNode = try await read\(/);
  assert.match(exportModel, /guard stillCurrent == node/);
  assert.match(exportModel, /prepared\?\.discard\(\)/);
  assert.doesNotMatch(modal, /URLSessionConfiguration|download-ticket|FileManager\.default\.moveItem/);
});
