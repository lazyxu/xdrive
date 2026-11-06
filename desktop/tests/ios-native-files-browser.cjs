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
const web = read('web/src/WebFileExplorer.tsx');
const server = read('internal/api/search.go');
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
  assert.match(view, /func belongs\(to owner: XDriveNativeOwnerRoot\?\) -> Bool[\s\S]*?matches\(owner, loadedOwner\)/);
  assert.match(view, /private var hasVerifiedSearchOptionsForOwner: Bool[\s\S]*?searchOptions\.matches\(login\.owner\)/);
  assert.match(view, /if searchOptions\.loading && hasSearchOptionsStateForOwner/);
  assert.match(view, /else if hasSearchOptionsStateForOwner, let error = searchOptions\.errorMessage/);
  assert.match(view, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/);
  assert.match(view, /\/api\/v1\/nodes\/\\\(parentID\)\/children/);
  assert.match(view, /\/api\/v1\/search/);
  assert.match(source, /listRange\([\s\S]*?children\?\$\{query\.toString\(\)\}/);
  assert.match(source, /searchRange\([\s\S]*?\/api\/v1\/search/);
  assert.match(view, /URLSessionConfiguration\.ephemeral/);
  assert.match(view, /completionHandler\(nil\)/);
  assert.match(view, /\.onDisappear \{ suspendVisibleRange\(\) \}/);
  assert.match(view, /private func suspendVisibleRange\(\) \{[\s\S]*?model\.suspendForNavigation\(\)/);
  const suspension = view.slice(view.indexOf('private func suspendVisibleRange()'), view.indexOf('var body: some View', view.indexOf('private func suspendVisibleRange()')));
  assert.doesNotMatch(suspension, /model\.invalidate\(\)/);
  assert.match(view, /model\.canResume\(/);
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
  assert.match(view, /private var isHome: Bool \{ folder == nil && !isGlobalSearch \}/)
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
  assert.match(view, /if isHome \{\s*model\.invalidate\(\)\s*loadFavoriteShortcuts\(\)\s*quickAccess\.load\(login: login\)\s*return\s*\}/)
  assert.match(view, /queryDraft = ""\s*activeQuery = ""\s*searchReturnOffset = nil/)
});

test('native SwiftUI search collapses in the toolbar and restores directory on clear', () => {
  assert.match(view, /\.searchable\(\s*text: \$queryDraft,/)
  assert.match(view, /placement: \.navigationBarDrawer\(displayMode: \.automatic\)/)
  assert.match(view, /prompt: "搜索全部文件"/)
  assert.match(view, /\.onSubmit\(of: \.search\) \{ submitSearch\(\) \}/)
  assert.match(view, /private func submitSearch\(\)/)
  assert.match(view, /XDriveIOSNativeFilesPagePolicy\.validSearch\(query\)/)
  assert.match(view, /if searchReturnOffset == nil \{\s*let saved = rememberedPosition\(\)\s*searchReturnOffset = saved\?\.pageOffset \?\? offset\s*searchReturnNodeID = saved\?\.nodeID/)
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
  assert.match(view, /favoriteShortcuts\.load\(\s*\.favorites, login: login, preserveVerifiedRows: sameOwner\s*\)/)
  assert.match(view, /favoriteShortcuts\.suspendForNavigation\(\)/)
  assert.match(view, /\.onDisappear \{ suspendVisibleRange\(\) \}[\s\S]*?if isHome, let current = login\.owner,[\s\S]*?favoriteShortcuts\.suspendForNavigation\(\)/)
  assert.match(view, /if !sameOwner \{\s*favoriteShortcuts\.invalidate\(\)\s*favoriteShortcutsOwner = owner/)
  assert.match(view, /else \{\s*favoriteShortcuts\.invalidate\(\)\s*favoriteShortcutsOwner = nil/)
  assert.match(view, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?favoriteShortcuts\.invalidate\(\)\s*favoriteShortcutsOwner = nil\s*if isHome \{ loadFavoriteShortcuts\(\) \}/)
  assert.match(view, /if isHome \{\s*model\.invalidate\(\)\s*loadFavoriteShortcuts\(\)\s*quickAccess\.load\(login: login\)\s*return/)
  assert.doesNotMatch(home, /XDriveIOSNativeFilesCollectionsTransport\(|URLSession|\/api\/v1\/file-favorites/)
})


test('native Files full-library search debounces valid keyboard drafts and cancels superseded searches', () => {
  const chrome = view.slice(view.indexOf('private var filesChrome:'), view.indexOf('private var filesModals:'))
  assert.match(chrome, /\.searchable\(\s*text: \$queryDraft,/)
  assert.match(chrome, /\.onSubmit\(of: \.search\) \{ submitSearch\(\) \}/)
  assert.match(chrome, /\.task\(id: queryDraft\) \{/)
  assert.match(chrome, /let query = queryDraft\.trimmingCharacters\(in: \.whitespacesAndNewlines\)/)
  assert.match(chrome, /XDriveIOSNativeFilesPagePolicy\.validSearch\(query\)/)
  assert.match(chrome, /query != activeQuery/)
  assert.match(chrome, /Task\.sleep\(nanoseconds: 400_000_000\)/)
  assert.match(chrome, /try Task\.checkCancellation\(\)/)
  assert.match(chrome, /guard !Task\.isCancelled, phase == \.active,/)
  assert.match(chrome, /login\.owner != nil, !selecting,/)
  assert.match(chrome, /query == queryDraft\.trimmingCharacters\(in: \.whitespacesAndNewlines\)/)
  assert.match(chrome, /submitSearch\(\)\s*\}\s*\.onChange\(of: queryDraft\)/)
  // Enter and debounce use exactly the one existing validated Server search path.
  assert.equal((view.match(/private func submitSearch\(\)/g) || []).length, 1)
  assert.match(view, /reader\.search\(/)
  assert.match(view, /private func clearSearch\(\)[\s\S]*?pendingNavigationReturnNodeID = restoreNodeID\s*reload\(\)/)
  assert.doesNotMatch(chrome, /URLSession|\/api\/v1\/search|XDriveIOSNativeFilesReader\(/)
})


test('native Files kind filter matches PWA Server semantics on all 64-item windows', () => {
  assert.match(page, /static func validSearchKind\(_ kind: String\) -> Bool/);
  assert.match(page, /"folder": "文件夹", "file": "全部文件"/);
  assert.match(view, /XDriveIOSNativeFilesPagePolicy\.validSearchRequest\(query: query, filters: filters\)/);
  assert.match(view, /if filters\.kind != "all" \{\s*queryItems\.append\(URLQueryItem\(name: "kind", value: filters\.kind\)\)/);
  assert.match(source, /if \(filters\.kind\) params\.set\('kind', filters\.kind\)/);
  assert.match(view, /query: activeQuery, filters: searchFilters, sort: sort, order: order/g);
  assert.match(view, /query, offset: requestOffset, sort: sort, order: order, filters: filters/);
  assert.match(view, /native-ios-files-search-kind-filter/);
  assert.match(view, /\.onChange\(of: searchFilters\)[\s\S]*?reload\(resetOffset: true\)/);
  assert.match(view, /activeQuery = ""\s*queryDraft = ""\s*searchFilters = XDriveIOSNativeFilesSearchFilterState\(\)/);
});

test('native Files date and size filters use the complete Server search index on every range', () => {
  assert.match(page, /struct XDriveIOSNativeFilesSearchFilterState: Equatable/);
  assert.match(page, /static func validSearchFilters\(_ filters: XDriveIOSNativeFilesSearchFilterState\) -> Bool/);
  assert.match(view, /URLQueryItem\(name: "modified_from", value: modifiedFrom\)/);
  assert.match(view, /URLQueryItem\(name: "modified_to", value: modifiedTo\)/);
  assert.match(view, /URLQueryItem\(name: "min_size", value: String\(minSize\)\)/);
  assert.match(view, /URLQueryItem\(name: "max_size", value: String\(maxSize\)\)/);
  assert.match(view, /query: activeQuery, filters: searchFilters, sort: sort, order: order/g);
  assert.match(view, /query, offset: requestOffset, sort: sort, order: order, filters: filters/);
  assert.match(view, /Button\("最近 7 天"\)/);
  assert.match(view, /Button\("最近 30 天"\)/);
  assert.match(view, /Button\("1–100 MiB"\)/);
  assert.match(view, /Button\("100 MiB–1 GiB"\)/);
  assert.match(view, /\.onChange\(of: searchFilters\)[\s\S]*?reload\(resetOffset: true\)/);
  assert.match(view, /native-ios-files-search-date-filter/);
  assert.match(view, /native-ios-files-search-size-filter/);
});

test('native Files search matches PWA source and tag filters, including filter-only queries', () => {
  assert.match(page, /var sourceID: UInt64\?/);
  assert.match(page, /var tagID: UInt64\?/);
  assert.match(page, /static func validSearchRequest\(query: String,[\s\S]*?trimmed\.isEmpty \? filters\.hasActiveFilters : validSearch\(trimmed\)/);
  assert.match(page, /static func validSearchSources\(_ items: \[XDriveIOSNativeFilesSearchSourceOption\]\)/);
  assert.match(page, /static func validSearchTags\(_ items: \[XDriveIOSNativeFilesSearchTagOption\]\)/);
  assert.match(view, /endpoint\("\/api\/v1\/sources", query: \[\]\)/);
  assert.match(view, /endpoint\("\/api\/v1\/file-tags", query: \[\]\)/);
  assert.match(view, /validSearchRequest\(query: query, filters: filters\)/);
  assert.match(view, /URLQueryItem\(name: "source_id", value: String\(sourceID\)\)/);
  assert.match(view, /URLQueryItem\(name: "tag_id", value: String\(tagID\)\)/);
  assert.match(view, /if query\.isEmpty && !filters\.hasActiveFilters/);
  assert.match(view, /private final class XDriveIOSNativeFilesSearchOptionsModel/);
  assert.match(view, /async let sourceRead = reader\.searchSources\(\)/);
  assert.match(view, /async let tagRead = reader\.searchTags\(\)/);
  assert.match(view, /func belongs\(to owner: XDriveNativeOwnerRoot\?\) -> Bool[\s\S]*?matches\(owner, loadedOwner\)/);
  assert.match(view, /private var hasVerifiedSearchOptionsForOwner: Bool[\s\S]*?searchOptions\.matches\(login\.owner\)/);
  assert.match(view, /if searchOptions\.loading && hasSearchOptionsStateForOwner/);
  assert.match(view, /else if hasSearchOptionsStateForOwner, let error = searchOptions\.errorMessage/);
  assert.match(view, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/);
  assert.match(view, /native-ios-files-search-source-filter/);
  assert.match(view, /native-ios-files-search-tag-filter/);
  assert.match(view, /Section\("全库筛选"\)/);
  assert.match(view, /private var isGlobalSearch: Bool/);
  assert.match(view, /private var isHome: Bool \{ folder == nil && !isGlobalSearch \}/);
  assert.match(view, /searchOptions\.load\(login: login\)/);
  assert.match(view, /searchOptions\.invalidate\(\)/);
  assert.match(view, /if searchFilters\.hasActiveFilters \{[\s\S]*?reload\(resetOffset: true\)/);
  // An inline child is managed in its actual verified parent, not in the outer
  // Browse folder; root is only a fallback when no selected Node exists.
  assert.match(view, /folderID: intent\.file\?\.parent_id \?\? intent\.directory\?\.parent_id \?\?[\s\S]*?folder\?\.id \?\? intent\.owner\.rootNodeID/);
  assert.match(source, /if \(filters\.sourceID\) params\.set\('source_id', String\(Math\.max\(1, Math\.trunc\(filters\.sourceID\)\)\)\)/);
  assert.match(source, /if \(filters\.tagID\) params\.set\('tag_id', String\(Math\.max\(1, Math\.trunc\(filters\.tagID\)\)\)\)/);
  assert.match(source, /sources\(\) \{\s*return this\.request<ExternalSource\[]>\('\/api\/v1\/sources'\)/);
  assert.match(source, /fileTags\(\) \{\s*return this\.request<XDriveFileTag\[]>\('\/api\/v1\/file-tags'\)/);
  assert.match(server, /filters\.SourceID = sourceID/);
  assert.match(server, /filters\.TagID = tagID/);
  assert.match(web, /useXDriveFileExplorerOwnerSourceOptions/);
  assert.match(web, /tagOptions=\{organization\.tagOptions\}/);
});
