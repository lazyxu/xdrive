'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const page = read('ios/XDriveIOS/NativeCloudFilesPolicy.swift');
const view = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift');
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift');
const source = read('web/src/api.ts');
const management = read('ios/XDriveIOS/NativeFilesManagementPanel.swift');

test('native Files replaces its fixed-tab placeholder without returning to WebView', () => {
  assert.match(dashboard, /private var files: some View \{\s*XDriveIOSNativeFilesBrowser\(login: login\)/);
  assert.match(dashboard, /\.tag\(XDriveIOSNativeBottomTab\.files\)/);
  assert.match(dashboard, /case \.local, \.albums, \.cloud, \.originals, \.map, \.files, \.backup: return true/);
  assert.doesNotMatch(view, /import WebKit|WKWebView\s*\(|document\.cookie|evaluateJavaScript\s*\(/);
  assert.match(view, /NavigationLink\(value: XDriveIOSNativeFilesFolder/);
  assert.match(view, /\.navigationDestination\(for: XDriveIOSNativeFilesFolder\.self\)/);
});

test('directory and full-library search use canonical counted Owner Range', () => {
  assert.match(view, /login\.verifiedAuthorization\(\)/);
  assert.match(view, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/);
  assert.match(view, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/);
  assert.match(view, /\/api\/v1\/nodes\/\\\(parentID\)\/children/);
  assert.match(view, /\/api\/v1\/search/);
  assert.match(source, /listRange\([\s\S]*?children\?\$\{query\.toString\(\)\}/);
  assert.match(source, /searchRange\([\s\S]*?\/api\/v1\/search/);
  assert.match(view, /URLSessionConfiguration\.ephemeral/);
  assert.match(view, /completionHandler\(nil\)/);
  assert.match(view, /\.onDisappear \{ if selectedFile == nil \{ model\.invalidate\(\) \} \}/);
  assert.match(view, /job\?\.cancel\(\)/);
  assert.match(page, /static let pageSize = 64/);
  assert.match(page, /Set\(items\.map\(\\\.id\)\)\.count/);
});

test('native Files decodes and displays Server modification timestamps in list and grid', () => {
  assert.match(page, /var created_at: String\? = nil/)
  assert.match(page, /var updated_at: String\? = nil/)
  assert.match(page, /enum XDriveIOSNativeFilesDatePolicy/)
  assert.match(page, /fractionDigits\.utf8\.count <= 9/)
  assert.equal((view.match(/XDriveIOSNativeFilesDatePolicy\.display\(modifiedDate\)/g) || []).length, 2)
  assert.match(management, /file\.modifiedDate/)
  assert.match(management, /directory\.modifiedDate/)
})

test('native Files search input matches the Server character and UTF-8 byte contract', () => {
  assert.match(page, /static let minimumQueryCharacters = 2/)
  assert.match(page, /static let maximumQueryUTF8Bytes = 256/)
  assert.match(page, /value\.utf8\.count <= maximumQueryUTF8Bytes/)
  assert.match(view, /searchError = "搜索词至少需要 2 个字符，最多 200 个字符且不超过 256 UTF-8 字节。"/)
})

test('file mutations and downloads remain unavailable; Viewer uses one native modal', () => {
  assert.match(view, /\.fullScreenCover\(item: \$selectedFile/);
  assert.match(view, /XDriveIOSNativeFilesViewer\(/);
  assert.doesNotMatch(view, /\/api\/v1\/uploads|\/api\/v1\/file-operations|POST.*nodes|DELETE.*nodes/);
});


test('native directory and whole-library search have no manual pager', () => {
  assert.doesNotMatch(view, /private var filesPager:|Button\("上一页"\)|Button\("下一页"\)/)
  assert.match(view, /private var filesContinuationStatus: some View/)
  assert.match(view, /Menu \{[\s\S]*?Picker\("显示方式", selection: \$viewMode\)/)
  assert.match(view, /Picker\("排序", selection: \$sort\)/)
  assert.match(view, /Picker\("顺序", selection: \$order\)/)
  assert.match(view, /native-ios-files-more-options/)
  assert.match(view, /native-ios-files-folder-actions/)
  assert.match(view, /native-ios-files-refresh/)
  assert.match(view, /ForEach\(model\.entries\) \{ entry in[\s\S]*?requestContinuationIfNeeded\(entry\)/)
  assert.match(view, /private func requestContinuationIfNeeded\(/)
  assert.match(view, /model\.entries\.first\?\.id == entry\.id && model\.canLoadEarlier/)
  assert.match(view, /model\.entries\.last\?\.id == entry\.id && model\.canLoadMore/)
  assert.match(view, /model\.loadEarlier\(/)
  assert.match(view, /model\.loadMore\(/)
  assert.match(view, /model\.retryContinuation\(/)
  assert.match(view, /native-ios-files-retry-continuation/)
  assert.match(view, /let ticket = epoch/)
  assert.match(view, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/)
  assert.match(view, /XDriveIOSNativeFilesContinuousPolicy\.validJoin\(/)
  assert.match(view, /self\.loadedIDs\.formUnion\(found\.map\(\\\.id\)\)/)
  assert.match(view, /self\.verifiedPage = false/)
  assert.match(page, /enum XDriveIOSNativeFilesContinuousPolicy/)
  assert.match(page, /pageTotal == total/)
  assert.match(page, /Set\(pageIDs\)\.isDisjoint\(with: loadedIDs\)/)
})

test('continuous presentation preserves bounded native Viewer and batch operations', () => {
  assert.match(view, /private func viewerWindow\(for selected:/)
  assert.match(view, /XDriveIOSNativeFilesViewerPolicy\.maximumLoadedRows/)
  assert.match(view, /loadedItems: viewerWindow\(for: initial\.node\)/)
  assert.match(view, /offset = model\.pageOffset\(for: next\) \?\? offset/)
  assert.match(view, /offset = model\.pageOffset\(for: entry\.node\) \?\? offset/)
  assert.match(view, /selectedIDs\.count < XDriveIOSNativeFilesPagePolicy\.pageSize/)
  assert.match(view, /model\.entries\.prefix\(\s*XDriveIOSNativeFilesPagePolicy\.pageSize/)
  assert.match(view, /XDriveIOSNativeFilesBatchTrashPolicy\.validSelection/)
  assert.match(view, /XDriveIOSNativeFilesBatchExportPolicy\.validSelection/)
  assert.match(view, /batchTarget\.perform\(/)
})
