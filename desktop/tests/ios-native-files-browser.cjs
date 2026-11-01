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
  assert.match(view, /\.onDisappear \{ model\.invalidate\(\) \}/);
  assert.match(view, /job\?\.cancel\(\)/);
  assert.match(page, /static let pageSize = 64/);
  assert.match(page, /Set\(items\.map\(\\\.id\)\)\.count/);
});

test('unimplemented file mutations, previews and downloads remain explicit', () => {
  assert.match(view, /目录批量操作、复制和跨目录移动仍未接通/);
  assert.doesNotMatch(view, /\/api\/v1\/uploads|\/api\/v1\/file-operations|POST.*nodes|DELETE.*nodes/);
});
