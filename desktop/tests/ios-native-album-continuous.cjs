'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const albums = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const timeline = read('ios/XDriveIOS/NativePhotoTimelineBrowser.swift')
const local = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')

test('native PhotoKit album directory is a continuous cover grid with automatic bounded reads', () => {
  assert.match(albums, /LazyVGrid\(\s*columns: \[GridItem\(\.adaptive\(minimum: 145, maximum: 220\)/)
  assert.match(albums, /XDriveIOSNativeAlbumCover\(album: album\)/)
  assert.match(albums, /PHAsset\.fetchAssets\(in: collection, options: options\)\.firstObject/)
  assert.match(albums, /if album\.id == page\.items\.last\?\.id \{\s*visibleTailAlbumID = album\.id\s*continueDirectoryIfReady\(\)/)
  assert.match(albums, /\.disabled\(albumMutationBusy\)/)
  assert.match(albums, /previous\.items \+ next\.items/)
  assert.match(albums, /previous\.total == next\.total/)
  assert.match(albums, /previous\.limitedAuthorization == next\.limitedAuthorization/)
  assert.match(albums, /Set\(previous\.items\.map\(\\\.collectionIdentifier\)\)\.isDisjoint/)
  assert.doesNotMatch(albums, /Button\("上一页"\)|Button\("下一页"\)|从第一页重试/)
})

test('local album member wall renders virtual 64-slot photo tiles without page controls', () => {
  assert.match(albums, /private struct XDriveIOSNativeAlbumVirtualPage: View/)
  assert.match(albums, /ForEach\(0\.\.<XDriveIOSNativePhotoVirtualPagePolicy\.pageCount\(total: total\)/)
  assert.match(albums, /let offset = number \* 64/)
  // Rendering moved to the shared Section List; the authorized album still
  // owns selection, exact 64-slot membership and the PhotoKit tile callback.
  assert.match(albums, /XDriveIOSNativePhotoWallSectionList\(\s*sections: sections\(for: page\), density: density/)
  assert.match(albums, /Button \{ onSelect\(item, page\) \} label:/)
  assert.match(albums, /XDriveIOSNativeSquarePhotoTile\(\s*candidate: item, framing: framing/)
  assert.match(albums, /ForEach\(0\.\.<min\(64, max\(0, expectedTotal - offset\)\)/)
  assert.match(albums, /\.task\(id: "\\\(generation\)-\\\(album\.collectionIdentifier\)-\\\(offset\)-\\\(sortOrder\.rawValue\)"\)/)
  assert.match(albums, /let count = try await next\.open\(album, sortOrder: sortOrder\)/)
  assert.match(albums, /let result = try await next\.page\(offset: offset\)/)
  assert.match(albums, /result\.totalAccessibleAssets == expectedTotal/)
  assert.match(albums, /result\.startOffset == offset/)
  assert.match(albums, /\.onDisappear \{\s*if !retainWhileCovered \{\s*page = nil[\s\S]*?retainedGeneration = nil[\s\S]*?if let reader/)
  assert.doesNotMatch(albums, /Text\("已显示|本页已选择|Button\("上一页"\)|Button\("下一页"\)/)
})

test('album writes, Viewer neighbors and scene invalidation remain scoped to current verified page', () => {
  assert.match(albums, /selectedCandidates\.removeAll\(\)\s*\}\s*page = loadedPage/)
  assert.match(albums, /savedOffset = loadedPage\.startOffset/)
  assert.match(albums, /viewerPage = loadedPage/)
  assert.match(albums, /onRead: \{ loadedPage in[\s\S]*?pageRenderRevision &\+= 1/)
  assert.match(albums, /returnScroll\.scrollTo\("album-page:/)
  assert.match(albums, /onCrossPage: \{ oldPage, anchor, direction in/)
  assert.match(albums, /onCrossedPage: \{ next, verifiedPage in/)
  assert.match(albums, /try await revalidateAlbumSelection\(batch, expected: sourcePage\)/)
  assert.match(albums, /guard epoch == ticket, phase == \.active/)
  assert.match(albums, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == permission/)
  assert.match(albums, /libraryMonitor\.revision/)
  assert.match(albums, /private func invalidate\(\) \{\s*cancelAlbumOperations\(\)/)
  assert.doesNotMatch(albums, /UserDefaults|\.upload\(|WKWebView/)
})

test('only the original virtual local wall remains reachable from Gallery tab', () => {
  assert.match(dashboard, /case \.local:\s*XDriveIOSNativeLocalPhotoTimelineContainer\(/)
  assert.match(timeline, /XDriveIOSNativeLocalContinuousGalleryScreen\(/)
  assert.doesNotMatch(timeline, /Button\("按页查看"\)|useContinuousWall/)
  assert.doesNotMatch(dashboard, /XDriveIOSNativeLocalGalleryScreen\(/)
  assert.match(albums, /XDriveIOSNativeLocalPhotoTimelineContainer\(/)
  assert.doesNotMatch(albums, /XDriveIOSNativeLocalPhotoTimelineScreen\(/)
  assert.doesNotMatch(local, /Text\("当前照片页"\)|正在读取第/)
})


test('a tail that appeared during an in-flight album read resumes after completion', () => {
  const directory = albums.slice(albums.indexOf('struct XDriveIOSNativePhotoAlbumsScreen: View'))
  assert.match(directory, /@State private var visibleTailAlbumID: String\?/)
  assert.match(directory, /if album\.id == page\.items\.last\?\.id \{\s*visibleTailAlbumID = album\.id\s*continueDirectoryIfReady\(\)/)
  assert.match(directory, /\.onDisappear \{[\s\S]*?if visibleTailAlbumID == album\.id \{\s*visibleTailAlbumID = nil/)
  assert.match(directory, /\.onChange\(of: loading\) \{ active in\s*if !active \{\s*restoreDirectoryIfReady\(using: scroll\)\s*continueDirectoryIfReady\(\)/)
  assert.match(directory, /private func continueDirectoryIfReady\(\)/)
  assert.match(directory, /guard isVisible, phase == \.active, !loading, !albumMutationBusy,/)
  assert.match(directory, /error == nil, pendingRestoreOffset == nil,/)
  assert.match(directory, /let page, page\.offset == 0, page\.hasNext,/)
  assert.match(directory, /visibleTailAlbumID == page\.items\.last\?\.id else \{ return \}/)
  assert.match(directory, /load\(offset: page\.items\.count\)/)
  assert.match(directory, /private func invalidate\(\) \{[\s\S]*?pendingRestoreOffset = nil\s*visibleTailAlbumID = nil/)
  assert.match(directory, /isVisible = false\s*visibleTailAlbumID = nil[\s\S]*?suspendForNavigation\(\)/)
  // A pushed album keeps change notifications so returning cannot reuse a
  // stale PhotoKit snapshot; the inactive scene still revokes the observer.
  assert.match(directory, /if state == \.active \{[\s\S]*?\} else \{\s*libraryMonitor\.stop\(\)\s*invalidate\(\)/)
  assert.doesNotMatch(directory, /Button\("上一页"\)|Button\("下一页"\)/)
})

test('native album directory groups user and smart collections without changing cursor order', () => {
  const directory = albums.slice(albums.indexOf('struct XDriveIOSNativePhotoAlbumsScreen: View'))
  assert.match(directory, /let userAlbums = page\.items\.filter \{ \$0\.kind == "用户相册" \}/)
  assert.match(directory, /let systemAlbums = page\.items\.filter \{ \$0\.kind == "系统智能相册" \}/)
  assert.match(directory, /Text\("我的相簿"\)/)
  assert.match(directory, /Text\("系统相簿"\)/)
  assert.match(directory, /albumGrid\(userAlbums, page: page\)/)
  assert.match(directory, /albumGrid\(systemAlbums, page: page\)/)
  assert.match(directory, /ForEach\(albums\) \{ album in\s*albumCoverCell\(album, page: page\)/)
  assert.match(directory, /if album\.id == page\.items\.last\?\.id \{\s*visibleTailAlbumID = album\.id\s*continueDirectoryIfReady\(\)/)
  assert.match(directory, /if album\.kind == "用户相册" \{/)
  assert.match(directory, /\.id\(album\.id\)/)
  assert.match(directory, /scroll\.scrollTo\(target, anchor: \.top\)/)
  assert.match(directory, /previous\.items \+ next\.items/)
  assert.doesNotMatch(directory, /Button\("上一页"\)|Button\("下一页"\)/)
})


test('album capture-date sort keeps all 64-slot reads, Viewer and writes on the same snapshot order', () => {
  const reader = albums.slice(
    albums.indexOf('actor XDriveIOSNativeAlbumPageReader'),
    albums.indexOf('/// Visible album-cover cells')
  )
  const wall = albums.slice(
    albums.indexOf('struct XDriveIOSNativeAlbumContentsScreen: View'),
    albums.indexOf('/// Photos-first list of local smart/user albums.')
  )
  assert.match(albums, /enum XDriveIOSNativeAlbumSortOrder: String, CaseIterable, Identifiable/)
  assert.match(albums, /case newest, oldest/)
  assert.match(albums, /var ascending: Bool \{ self == \.oldest \}/)
  assert.match(reader, /sortOrder: XDriveIOSNativeAlbumSortOrder = \.newest/)
  assert.match(reader, /NSSortDescriptor\(key: "creationDate", ascending: sortOrder\.ascending\)/)
  assert.doesNotMatch(reader, /NSSortDescriptor\(key: "modificationDate"/)
  assert.match(wall, /@State private var sortOrder: XDriveIOSNativeAlbumSortOrder = \.newest/)
  assert.match(wall, /Section\("拍摄时间顺序"\)/)
  assert.match(wall, /ForEach\(XDriveIOSNativeAlbumSortOrder\.allCases\)/)
  assert.match(wall, /native-ios-album-sort-order/)
  assert.match(wall, /sortOrder: sortOrder, selectionMode: selectionMode/)
  assert.match(wall, /onCrossPage: \{ oldPage, anchor, direction in[\s\S]*?adjacentReader\.open\(album, sortOrder: sortOrder\)/)
  assert.match(wall, /let verifier = XDriveIOSNativeAlbumPageReader\(\)[\s\S]*verifier\.open\(album, sortOrder: sortOrder\)/)
  assert.match(wall, /let count = try await next\.open\(album, sortOrder: sortOrder\)/)
  assert.match(wall, /\.onChange\(of: sortOrder\) \{ _ in[\s\S]*selectionMode = false\s*selectedCandidates\.removeAll\(\)\s*clearViewerTileAnchor\(\)\s*savedOffset = 0\s*reload\(\)/)
  assert.match(albums, /XDriveIOSNativeAlbumVirtualPage: View \{[\s\S]*?let sortOrder: XDriveIOSNativeAlbumSortOrder/)
  assert.match(albums, /\.task\(id: "\\\(generation\)-\\\(album\.collectionIdentifier\)-\\\(offset\)-\\\(sortOrder\.rawValue\)"\)/)
  assert.doesNotMatch(wall, /Button\("上一页"\)|Button\("下一页"\)/)
})


test('album contents share native capture-day headers with exact 64-slot PhotoKit boundaries', () => {
  const reader = albums.slice(
    albums.indexOf('actor XDriveIOSNativeAlbumPageReader'),
    albums.indexOf('/// Visible album-cover cells')
  )
  const page = albums.slice(
    albums.indexOf('private struct XDriveIOSNativeAlbumVirtualPage: View'),
    albums.indexOf('/// Continuous album media wall')
  )
  const day = read('ios/XDriveIOS/NativePhotoDayGroupingPolicy.swift')
  assert.match(page, /@State private var precedingCapturedAt: Date\?/)
  assert.match(page, /XDriveIOSNativePhotoDayGroupingPolicy\.sections\(/)
  assert.match(page, /dates: page\.items\.map\(\\\.capturedAt\)/)
  assert.match(page, /previousCapturedAt: precedingCapturedAt/)
  assert.match(page, /hasPreviousPage: offset > 0/)
  // The source converts each verified PhotoKit day section into shared
  // presentation rows; a same-day boundary must not emit a duplicate header.
  assert.match(page, /heading: section\.continuesPreviousPage \? nil : section\.title/)
  assert.match(page, /XDriveIOSNativePhotoWallSectionList\(\s*sections: sections\(for: page\), density: density/)
  assert.match(page, /title: \{ \$0\.heading \}/)
  assert.match(page, /items: \{ \$0\.items \}/)
  const shared = read('ios/XDriveIOS/NativePhotoWallComponents.swift')
  assert.match(shared, /struct XDriveIOSNativePhotoWallDayHeader: View/)
  assert.match(shared, /\.accessibilityAddTraits\(\.isHeader\)/)
  assert.match(page, /items: Array\(page\.items\[section\.startIndex\.\.<section\.endIndex\]\)/)
  assert.match(page, /XDriveIOSNativeSquarePhotoTile\(\s*candidate: item, framing: framing/)
  // The shared section container, not the data-source view, renders header and
  // tile loops; it must not read PhotoKit or carry authorization decisions.
  assert.match(shared, /ForEach\(sections\) \{ section in/)
  assert.match(shared, /XDriveIOSNativePhotoWallDayHeader\(title: heading\)/)
  assert.match(shared, /ForEach\(items\(section\)\) \{ item in tile\(item\) \}/)
  assert.doesNotMatch(shared, /PHAsset\.fetchAssets|verifiedAuthorization|URLSession/)
  assert.match(page, /ForEach\(0\.\.<min\(64, max\(0, expectedTotal - offset\)\)/)
  assert.match(reader, /func precedingCaptureDate\(beforeOffset offset: Int\) throws -> Date\?/)
  assert.match(reader, /offset > 0, offset <= result\.count, offset % 64 == 0/)
  assert.match(reader, /try verify\(permission\)\s*return capture/)
  assert.match(page, /preceding = try await next\.precedingCaptureDate\(beforeOffset: offset\)/)
  assert.match(page, /precedingCapturedAt = preceding\s*page = result\s*retainedGeneration = generation\s*onRead\(result\)/)
  assert.match(page, /\.onDisappear \{\s*if !retainWhileCovered \{\s*page = nil\s*precedingCapturedAt = nil\s*retainedGeneration = nil/)
  assert.match(page, /sortOrder\.rawValue/)
  assert.match(day, /hasPreviousPage: Bool = false, calendar: Calendar = \.current/)
  assert.doesNotMatch(page, /Button\("上一页"\)|Button\("下一页"\)|fetchAssets\(withLocalIdentifiers/)
})
