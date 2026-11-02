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
  assert.match(browser, /loadedItems: viewerWindow\(for: initial\.node\)/);
  assert.match(browser, /private func viewerWindow\(for selected: XDriveIOSNativeFilesNode\)/);
  assert.match(browser, /\$0\.parent_id == selected\.parent_id/);
  assert.match(browser, /XDriveIOSNativeFilesViewerPolicy\.maximumLoadedRows/);
  assert.match(browser, /Array\(siblings\[start\.\.<min\(start \+ maximum, siblings\.count\)\]\)/);
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
  assert.match(view, /导出上限 1 GiB/);
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


test('indexed low-res Files still keeps the native zoom swipe navigation and original recovery copy', () => {
  const lowRes = view.slice(view.indexOf('case .imageThumbnail(let image):'), view.indexOf('case .video:'));
  assert.match(lowRes, /XDriveIOSNativeZoomablePhotoView\(image: image\)/);
  assert.match(lowRes, /\.onNavigateSwipe \{ move\(\$0\) \}/);
  assert.match(lowRes, /低清缩略图/);
  assert.match(lowRes, /XDriveIOSNativeViewerQualityPanel\(/);
  assert.match(lowRes, /source: "缩略图回退"/);
  assert.match(lowRes, /originalExportFallback/);
  assert.match(lowRes, /native-ios-files-viewer-thumbnail-recovery/);
  assert.match(view, /if case \.imageThumbnail = result \{\s*exportFallbackEligible = true/);
  assert.match(view, /viewed\.size > XDriveIOSNativeFilesExportCapacityPolicy\.maximumSingleFileBytes/);
  assert.match(view, /native-ios-files-viewer-export-over-limit/);
  assert.match(view, /case \.noThumbnail:/);
  assert.match(view, /导出上限 1 GiB/);
  assert.match(reader, /fallbackThumbnail\(selected\)/);
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

test('L3 navigation can escape an unsupported or oversize file within the verified 64-row page', () => {
  assert.match(policy, /private static func validFileRow\(_ node: XDriveIOSNativeFilesNode\)/);
  assert.match(policy, /guard validFileRow\(node\) else \{ return false \}/);
  assert.match(policy, /guard authorized, validFileRow\(current\),/);
  assert.match(policy, /if let fileIndex = files\.firstIndex\(of: loaded\[index\]\)/);
  assert.match(policy, /return loaded\[\.\.<index\]\.reversed\(\)\.first\(where: canPreview\)/);
  assert.match(policy, /return loaded\[\(index \+ 1\)\.\.\.\]\.first\(where: canPreview\)/);
  assert.match(view, /Button\("上一项"|Label\("上一项"/);
  assert.match(view, /Button\("下一项"|Label\("下一项"/);
});


test('iOS indexed still fallback coexists with L3 original export and scoped AVPlayer retry', () => {
  const image = view.slice(view.indexOf('case .imageThumbnail(let image):'),
    view.indexOf('case .video:', view.indexOf('case .imageThumbnail(let image):')));
  assert.match(image, /XDriveIOSNativeZoomablePhotoView\(image: image\)/);
  assert.match(image, /\.onNavigateSwipe \{ move\(\$0\) \}/);
  assert.match(view, /case \.noThumbnail:[\s\S]*?exportFallbackEligible = true/);
  assert.match(view, /@StateObject private var exporter = XDriveIOSNativeFilesExportModel\(\)/);
  assert.match(view, /ShareLink\(item: staged\.fileURL\)/);
  assert.match(view, /player\.publisher\(for: \\\.status, options: \[\.initial, \.new\]\)/);
  assert.match(policy, /case \.image: return node\.size > 0/);
  assert.match(policy, /return loaded\[\(index \+ 1\)\.\.\.\]\.first\(where: canPreview\)/);
});


test('native Files UTF-8 preview types cover the actual Server allowlist', () => {
  const go = read('internal/api/file_text_preview.go');
  const goExt = go.slice(go.indexOf('var fileTextPreviewExtensions'), go.indexOf('var fileTextPreviewBasenames'));
  const goBase = go.slice(go.indexOf('var fileTextPreviewBasenames'), go.indexOf('type fileTextPreviewDTO'));
  const nativeExt = policy.slice(policy.indexOf('private static let texts: Set<String>'),
    policy.indexOf('private static let textBasenames: Set<String>'));
  const nativeBase = policy.slice(policy.indexOf('private static let textBasenames: Set<String>'),
    policy.indexOf('private static let textDotPrefixes'));
  const goExtensions = [...goExt.matchAll(/"(\.[a-z0-9]+)"\s*:\s*\{\}/g)].map(m => m[1].slice(1));
  const goBasenames = [...goBase.matchAll(/"([^"]+)"\s*:\s*\{\}/g)].map(m => m[1]);
  assert.ok(goExtensions.length >= 90 && goBasenames.length >= 25);
  const nativeExtensions = new Set([...nativeExt.matchAll(/"([^"]+)"/g)].map(m => m[1]));
  const nativeBasenames = new Set([...nativeBase.matchAll(/"([^"]+)"/g)].map(m => m[1]));
  for (const ext of goExtensions) {
    assert.ok(nativeExtensions.has(ext), 'missing Server text extension: ' + ext);
  }
  for (const name of goBasenames) {
    assert.ok(nativeBasenames.has(name), 'missing Server text basename: ' + name);
  }
  for (const prefix of ['.env.', '.eslintrc.', '.prettierrc.', '.stylelintrc.']) {
    assert.ok(policy.includes('"' + prefix + '"'), 'missing text dot-prefix: ' + prefix);
  }
  assert.match(policy, /textDotPrefixes\.contains\(where: \{ base\.hasPrefix\(\$0\) \}\)/);
  assert.match(reader, /if kind == \.text \{/);
  assert.ok(reader.includes('/preview/text'), 'text uses native Owner-scoped Server preview');
  assert.match(reader, /return \.text\(preview\.text, preview\.truncated\)/);
  assert.ok(go.includes('func (s *Server) fileTextPreview('));
});
