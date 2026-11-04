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
  assert.match(dashboard, /case \.local, \.albums, \.cloud, \.originals, \.map, \.files, \.notes, \.backup: return true/);
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
  assert.match(view, /\.onDisappear \{ suspendVisibleRange\(\) \}/);
  assert.match(view, /private func suspendVisibleRange\(\) \{[\s\S]*?model\.invalidate\(\)/);
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

test('native Browse home uses a verified cloud location rather than automatically opening root children', () => {
  assert.match(view, /private var isHome: Bool \{ folder == nil && activeQuery\.isEmpty \}/)
  assert.match(view, /private var filesHome: some View/)
  assert.match(view, /Section\("位置"\)/)
  assert.match(view, /folderID: owner\.rootNodeID,\s*folderName: "xDrive 云端"/)
  assert.match(view, /native-ios-files-open-root-location/)
  assert.match(view, /Section\("个人收藏"\)/)
  assert.match(view, /Section\("快捷访问"\)/)
  assert.match(view, /XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.favorites\)/)
  assert.match(view, /XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.recent\)/)
  assert.match(view, /XDriveIOSNativeFilesTrashScreen\(login: login\)/)
  assert.match(view, /List \{\s*filesHeader\s*if isHome \{\s*filesHome\s*\} else \{/)
  assert.match(view, /if isHome \{\s*model\.invalidate\(\)\s*loadFavoriteShortcuts\(\)\s*return\s*\}/)
  assert.match(view, /queryDraft = ""\s*activeQuery = ""\s*searchReturnOffset = nil/)
});

test('native SwiftUI search collapses in the toolbar and restores directory on clear', () => {
  assert.match(view, /\.searchable\(\s*text: \$queryDraft,/)
  assert.match(view, /placement: \.navigationBarDrawer\(displayMode: \.automatic\)/)
  assert.match(view, /prompt: "搜索全部文件"/)
  assert.match(view, /\.onSubmit\(of: \.search\) \{ submitSearch\(\) \}/)
  assert.match(view, /private func submitSearch\(\)/)
  assert.match(view, /XDriveIOSNativeFilesPagePolicy\.validSearch\(query\)/)
  assert.match(view, /if activeQuery\.isEmpty \{\s*let saved = rememberedPosition\(\)\s*searchReturnOffset = saved\?\.pageOffset \?\? offset\s*searchReturnNodeID = saved\?\.nodeID/)
  assert.match(view, /activeQuery = query\s*reload\(resetOffset: true\)/)
  assert.match(view, /private func clearSearch\(\)/)
  assert.match(view, /let restoredOffset = searchReturnOffset \?\? 0/)
  assert.match(view, /searchReturnOffset = nil\s*searchReturnNodeID = nil\s*lastAppearedNodeID = nil\s*offset = restoredOffset\s*pendingNavigationReturnNodeID = restoreNodeID\s*reload\(\)/)
  assert.match(view, /if value\.trimmingCharacters\(in: \.whitespacesAndNewlines\)\.isEmpty &&/)
  assert.match(view, /native-ios-files-clear-search/)
  assert.doesNotMatch(view, /TextField\("搜索全部文件", text: \$queryDraft\)/)
});


test('native Files More menu keeps real sort, view and upload actions with bounded list model', () => {
  assert.match(view, /Menu \{[\s\S]*?Picker\("显示方式", selection: \$viewMode\)/)
  assert.match(view, /Picker\("排序", selection: \$sort\)/)
  assert.match(view, /Picker\("顺序", selection: \$order\)/)
  assert.match(view, /native-ios-files-more-options/)
  assert.match(view, /native-ios-files-folder-actions/)
  assert.match(view, /native-ios-files-refresh/)
  assert.match(view, /XDriveIOSNativeFilesContinuousWindowPolicy\.mergePlan\(/)
  assert.match(view, /requestContinuousNeighbor\(for: entry\.id\)/)
  assert.doesNotMatch(view, /requestContinuationIfNeeded\(/)
})


test('Browse home displays only verified favorite folders as native direct navigation links', () => {
  assert.match(view, /@StateObject private var favoriteShortcuts = XDriveIOSNativeFilesCollectionPageModel\(\)/)
  assert.match(view, /@State private var favoriteShortcutsOwner: XDriveNativeOwnerRoot\?/)
  assert.match(view, /private var verifiedFavoriteFolders: \[XDriveIOSNativeFilesCollectionItem\]/)
  assert.match(view, /guard isHome, favoriteShortcuts\.verified,/)
  assert.match(view, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(view, /\$0\.node\.isDirectory &&\s*XDriveIOSNativeFilesCollectionsPolicy\.validItem\(\$0, kind: \.favorites\)/)
  assert.match(view, /\.prefix\(8\)/)
  const home = view.slice(view.indexOf('@ViewBuilder private var filesHome:'), view.indexOf('@ViewBuilder private var filesHeader:'))
  assert.match(home, /Section\("个人收藏"\)/)
  assert.match(home, /XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.favorites\)/)
  assert.match(home, /ForEach\(verifiedFavoriteFolders\) \{ item in/)
  assert.match(home, /XDriveIOSNativeFilesBrowser\(\s*login: login, folderID: item\.node\.id,\s*folderName: item\.node\.name/)
  assert.match(home, /native-ios-files-favorite-folder-/)
  assert.match(home, /if favoriteShortcuts\.loading \{/)
  assert.match(home, /Button\("重试"\) \{ loadFavoriteShortcuts\(\) \}/)
  assert.match(view, /favoriteShortcuts\.load\(\.favorites, login: login\)/)
  assert.match(view, /\.onDisappear \{ suspendVisibleRange\(\) \}[\s\S]*?favoriteShortcuts\.invalidate\(\)\s*favoriteShortcutsOwner = nil/)
  assert.match(view, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?favoriteShortcuts\.invalidate\(\)\s*favoriteShortcutsOwner = nil\s*if isHome \{ loadFavoriteShortcuts\(\) \}/)
  assert.match(view, /if isHome \{\s*model\.invalidate\(\)\s*loadFavoriteShortcuts\(\)\s*return/)
  assert.doesNotMatch(home, /XDriveIOSNativeFilesCollectionsTransport\(|URLSession|\/api\/v1\/file-favorites/)
})
