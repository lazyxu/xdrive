'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const reader = read('ios/XDriveIOS/NativePhotoMetadataSearch.swift')
const policy = read('ios/XDriveIOS/NativePhotoSearchQueryPolicy.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const scanner = reader.slice(
  reader.indexOf('private actor XDriveIOSNativePhotoMetadataSearchReader'),
  reader.indexOf('@MainActor\nprivate final class XDriveIOSNativePhotoMetadataSearchModel')
)
const view = reader.slice(reader.indexOf('struct XDriveIOSNativePhotoSearchScreen: View'))

test('only current authorized PhotoKit metadata can enter the bounded search', () => {
  assert.match(scanner, /maximumScanned = 2048/)
  assert.match(scanner, /maximumMatches = 64/)
  assert.match(scanner, /requested >= 0 && requested <= assets.count/)
  assert.match(scanner, /min\(assets\.count, requested \+ Self\.maximumScanned\)/)
  assert.match(scanner, /if matches\.count == Self\.maximumMatches \{ break \}/)
  assert.match(scanner, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(scanner, /permission == \.authorized \|\| permission == \.limited/)
  assert.match(scanner, /PHPhotoLibrary\.shared\(\)\.register\(observer\)/)
  assert.match(scanner, /defer \{ PHPhotoLibrary\.shared\(\)\.unregisterChangeObserver\(observer\) \}/)
  assert.match(scanner, /observer\.generation\(\) == revision/)
  assert.match(scanner, /try Task\.checkCancellation\(\)/)
  assert.match(scanner, /await Task\.yield\(\)/)
  assert.match(scanner, /items: matches, startSlot: requested, nextSlot: nextSlot/)
  assert.doesNotMatch(scanner, /URLSession|requestImageData|requestAVAsset|isNetworkAccessAllowed|UploadSession/)
})

test('search matches filenames, dates and media categories, without fake semantic results', () => {
  assert.match(scanner, /PHAssetResource\.assetResources\(for: asset\)/)
  assert.match(scanner, /originalFilename\.localizedStandardContains\(term\)/)
  assert.match(scanner, /XDriveIOSNativePhotoSearchQueryPolicy\.matchesKind\(/)
  assert.match(scanner, /XDriveIOSNativePhotoSearchQueryPolicy\.matchesDate\(/)
  assert.match(scanner, /asset\.creationDate, modifiedAt: asset\.modificationDate/)
  assert.match(policy, /static func normalized\(_ text: String\) -> String\?/)
  assert.match(policy, /query\.count <= 80, query\.utf8\.count <= 256/)
  assert.match(policy, /CharacterSet\.controlCharacters/)
  assert.match(policy, /iso\.hasPrefix\(query\)/)
  assert.match(policy, /query == "视频"/)
  assert.match(policy, /query == "实况"/)
  assert.match(policy, /query == "截屏"/)
  assert.match(view, /不是人物、内容识别或云端搜索/)
})

test('search results are one continuous grid with automatic bounded continuation', () => {
  assert.match(view, /native-ios-photo-search-input/)
  assert.match(view, /native-ios-photo-search-submit/)
  assert.match(view, /LazyVStack\(alignment: \.leading/)
  assert.match(view, /ForEach\(model\.windows\) \{ window in/)
  assert.match(view, /XDriveIOSNativePhotoSearchWindowView\(/)
  assert.match(view, /model\.scanMore\(after: visibleID\)/)
  assert.match(view, /\.onChange\(of: model\.busy\) \{ busy in/)
  assert.match(view, /model\.scanMore\(after: visibleTailWindowID\)/)
  assert.match(view, /model\.scannedThrough/)
  assert.match(view, /model\.matchCount/)
  // Result tiles now live in a lazily mounted, independently revalidated window.
  assert.match(reader, /private struct XDriveIOSNativePhotoSearchWindowView: View/)
  assert.match(reader, /\.accessibilityIdentifier\("native-ios-photo-search-result"\)/)
  assert.match(view, /XDriveIOSNativeLocalPhotoDetail\(/)
  assert.doesNotMatch(view, /Button\("继续搜索后续照片"\)|native-ios-photo-search-more/)
})

test('Gallery opens a native local search in portrait and compact landscape', () => {
  assert.match(dashboard, /@State private var showingLocalPhotoSearch = false/)
  assert.match(dashboard, /\.sheet\(isPresented: \$showingLocalPhotoSearch\)/)
  assert.match(dashboard, /XDriveIOSNativePhotoSearchScreen\(\)/)
  assert.match(dashboard, /native-ios-gallery-local-photo-search/)
  assert.match(dashboard, /if gallerySource == \.local \|\| gallerySource == \.albums \{\s*gallerySearchAction/)
  assert.match(dashboard, /private var galleryCompactBackupAction/)
  assert.match(dashboard, /showingLocalPhotoSearch = false/)
  assert.doesNotMatch(dashboard, /WKWebView/)
})

test('photo searches are canceled on scene/library changes; old queries cannot fill new views', () => {
  assert.match(reader, /generation = UUID\(\)/)
  assert.match(reader, /task\?\.cancel\(\)/)
  assert.match(reader, /self\.generation == request/)
  assert.match(reader, /UIApplication\.shared\.applicationState == \.active/)
  assert.match(view, /\.onChange\(of: monitor\.revision\)/)
  assert.match(view, /model\.invalidate\(\)/)
  assert.match(view, /\.onChange\(of: phase\)/)
  assert.match(view, /model\.cancel\(\)/)
  assert.doesNotMatch(scanner, /UserDefaults|@AppStorage|NodeReceipt|XDrivePhotoSyncLedger/)
})

test('only numeric ranges persist while every visible search window rereads and releases PhotoKit IDs', () => {
  const windowView = reader.slice(
    reader.indexOf('private struct XDriveIOSNativePhotoSearchWindowView: View'),
    reader.indexOf('private struct XDriveIOSNativePhotoSearchSelection: Identifiable')
  )
  const model = reader.slice(
    reader.indexOf('@MainActor\nprivate final class XDriveIOSNativePhotoMetadataSearchModel'),
    reader.indexOf('private final class XDriveIOSNativePhotoSearchChangeMonitor:')
  )
  assert.match(reader, /private struct XDriveIOSNativePhotoSearchWindow: Identifiable, Equatable/)
  assert.match(model, /@Published private\(set\) var windows: \[XDriveIOSNativePhotoSearchWindow\]/)
  assert.match(model, /matchCount: page\.items\.count/)
  assert.match(model, /page\.nextSlot > offset \|\| offset == page\.totalAuthorizedSlots/)
  assert.match(model, /expectedTotal == nil \|\| expectedTotal == page\.totalAuthorizedSlots/)
  assert.match(model, /if !page\.hasMore \|\| !page\.items\.isEmpty \{ break \}/)
  assert.match(model, /await Task\.yield\(\)/)
  assert.match(model, /let request = generation/)
  assert.match(model, /task\?\.cancel\(\)/)
  assert.doesNotMatch(model, /@Published.*\[XDrivePhotoKitScanCandidate\]/)
  assert.match(windowView, /\.task\(id: "\\\(generation\)-\\\(window\.startSlot\)-\\\(query\)-\\\(sortOrder\.rawValue\)"\)/)
  assert.match(windowView, /\.read\(query: query, startingAt: window\.startSlot, sortOrder: sortOrder\)/)
  assert.match(windowView, /fresh\.nextSlot == window\.nextSlot/)
  assert.match(windowView, /fresh\.totalAuthorizedSlots == window\.totalAuthorizedSlots/)
  assert.match(windowView, /fresh\.items\.count == window\.matchCount/)
  assert.match(windowView, /\.onDisappear \{\s*page = nil\s*onVisibility\(window\.id, false\)/)
  assert.match(windowView, /ForEach\(0\.\.<window\.matchCount/)
  assert.match(view, /model\.invalidate\(\)/)
  assert.doesNotMatch(model + windowView, /URLSession|UploadSession|requestImageData|UserDefaults/)
})


test('capture-date order changes the same bounded PhotoKit reader and invalidates prior search windows', () => {
  const model = reader.slice(
    reader.indexOf('@MainActor\nprivate final class XDriveIOSNativePhotoMetadataSearchModel'),
    reader.indexOf('private final class XDriveIOSNativePhotoSearchChangeMonitor:')
  )
  const windowView = reader.slice(
    reader.indexOf('private struct XDriveIOSNativePhotoSearchWindowView: View'),
    reader.indexOf('private struct XDriveIOSNativePhotoSearchSelection: Identifiable')
  )
  assert.match(reader, /enum XDriveIOSNativePhotoSearchSortOrder: String, CaseIterable, Identifiable/)
  assert.match(reader, /case newest, oldest/)
  assert.match(reader, /var ascending: Bool \{ self == \.oldest \}/)
  assert.match(scanner, /sortOrder: XDriveIOSNativePhotoSearchSortOrder = \.newest/)
  assert.match(scanner, /NSSortDescriptor\(key: "creationDate", ascending: sortOrder\.ascending\)/)
  assert.match(scanner, /NSSortDescriptor\(key: "modificationDate", ascending: sortOrder\.ascending\)/)
  assert.match(model, /currentSortOrder: XDriveIOSNativePhotoSearchSortOrder = \.newest/)
  assert.match(model, /let order = currentSortOrder/)
  assert.match(model, /\.read\(query: term, startingAt: offset, sortOrder: order\)/)
  assert.match(model, /self\.currentSortOrder == order/)
  assert.match(windowView, /let sortOrder: XDriveIOSNativePhotoSearchSortOrder/)
  assert.match(windowView, /\.read\(query: query, startingAt: window\.startSlot, sortOrder: sortOrder\)/)
  assert.match(windowView, /\.task\(id: "\\\(generation\)-\\\(window\.startSlot\)-\\\(query\)-\\\(sortOrder\.rawValue\)"\)/)
  assert.match(view, /Picker\("按拍摄时间排序", selection: \$sortOrder\)/)
  assert.match(view, /ForEach\(XDriveIOSNativePhotoSearchSortOrder\.allCases\)/)
  assert.match(view, /native-ios-photo-search-capture-order/)
  assert.match(view, /\.onChange\(of: sortOrder\) \{ _ in/)
  assert.match(view, /visibleTailWindowID = nil\s*guard selected == nil, phase == \.active/)
  assert.match(view, /model\.search\(acceptedQuery, sortOrder: sortOrder\)/)
  assert.match(view, /sortOrder: sortOrder, framing: framing,\s*generation: model\.generation/)
  assert.match(view, /model\.search\(normalized, sortOrder: sortOrder\)/)
  assert.match(model, /windows = \[\]/)
  assert.doesNotMatch(scanner, /URLSession|UploadSession|requestAVAsset|UserDefaults/)
});


test('search thumbnails offer uncropped full composition without invalidating results or rescanning', () => {
  const tile = reader.slice(
    reader.indexOf('private struct XDriveIOSNativePhotoSearchTile: View'),
    reader.indexOf('/// One visible result range.')
  )
  const windows = reader.slice(
    reader.indexOf('private struct XDriveIOSNativePhotoSearchWindowView: View'),
    reader.indexOf('private struct XDriveIOSNativePhotoSearchSelection: Identifiable')
  )
  const density = read('ios/XDriveIOS/NativePhotoWallDensityPolicy.swift')
  const photoLoader = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
  const thumbnailLoader = photoLoader.slice(
    photoLoader.indexOf('final class XDriveIOSPhotoImageLoader'),
    photoLoader.indexOf('struct XDriveIOSLocalPhotoTile')
  )
  assert.match(density, /enum XDriveIOSNativePhotoWallFraming: String, CaseIterable, Identifiable/)
  assert.match(density, /case square, complete/)
  assert.match(view, /@State private var framing: XDriveIOSNativePhotoWallFraming = \.square/)
  assert.match(view, /Picker\("预览构图", selection: \$framing\)/)
  assert.match(view, /ForEach\(XDriveIOSNativePhotoWallFraming\.allCases\)/)
  assert.match(view, /native-ios-photo-search-framing/)
  assert.match(view, /sortOrder: sortOrder, framing: framing,\s*generation: model\.generation/)
  assert.match(windows, /let framing: XDriveIOSNativePhotoWallFraming/)
  assert.match(windows, /XDriveIOSNativePhotoSearchTile\(candidate: item, framing: framing\)/)
  assert.match(tile, /let framing: XDriveIOSNativePhotoWallFraming/)
  assert.match(tile, /if framing == \.complete \{\s*Image\(uiImage: image\)\.resizable\(\)\.scaledToFit\(\)/)
  assert.match(tile, /Image\(uiImage: image\)\.resizable\(\)\.scaledToFill\(\)/)
  assert.match(tile, /contentMode: framing == \.complete \? \.aspectFit : \.aspectFill/)
  assert.match(tile, /\.task\(id: "\\\(candidate\.id\)-\\\(framing\.rawValue\)"\)/)
  assert.match(tile, /\.frame\(width: geometry\.size\.width, height: geometry\.size\.height\)/)
  assert.match(tile, /\.aspectRatio\(1, contentMode: \.fit\)/)
  assert.match(thumbnailLoader, /settings\.isNetworkAccessAllowed = true/)
  assert.match(thumbnailLoader, /PHImageManager\.default\(\)\.requestImage/)
  assert.doesNotMatch(thumbnailLoader, /allowICloudThumbnail/)
  assert.match(photoLoader, /contentMode: PHImageContentMode = \.aspectFill/)
  // Changing the presentation mode reissues only the visible derivative.
  assert.match(windows, /\.task\(id: "\\\(generation\)-\\\(window\.startSlot\)-\\\(query\)-\\\(sortOrder\.rawValue\)"\)/)
  assert.doesNotMatch(windows, /task\(id:.*framing/)
  assert.doesNotMatch(view, /\.onChange\(of: framing\) \{ _ in[\s\S]*?model\.(?:cancel|search|invalidate)/)
  assert.doesNotMatch(tile, /requestImageData|URLSession|UploadSession|requestAVAsset/)
});
