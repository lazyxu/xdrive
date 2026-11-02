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

test('file mutations and downloads remain unavailable; Viewer uses one native modal', () => {
  assert.match(view, /\.fullScreenCover\(item: \$selectedFile/);
  assert.match(view, /XDriveIOSNativeFilesViewer\(/);
  assert.doesNotMatch(view, /\/api\/v1\/uploads|\/api\/v1\/file-operations|POST.*nodes|DELETE.*nodes/);
});
