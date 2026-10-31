'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const map = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const scanner = read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift')
const focus = read('ios/XDriveIOS/NativeFocusVisibilityPolicy.swift')
const policy = read('ios/XDriveIOS/NativePhotoMapPolicy.swift')
const spatial = read('ios/XDriveIOS/NativeLocalPhotoMapSpatialPolicy.swift')

test('real native Gallery map uses MapKit and existing local Viewer, no WebView', () => {
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativeLocalPhotoMapScreen\(/)
  assert.match(map, /MKMapView\(\)/)
  assert.match(map, /MKClusterAnnotation/)
  assert.match(map, /clusteringIdentifier = identifier == "photo"/)
  assert.match(map, /XDriveIOSNativeLocalPhotoDetail\(candidate: \$0\)/)
  assert.match(focus, /gallerySource == "map"/)
  assert.doesNotMatch(map, /WKWebView|URLSession|UploadSession|Keychain|UserDefaults/)
})

test('only a fresh authorized PhotoKit 64-slot scan supplies local map pins', () => {
  assert.match(scanner, /func nextLocatedPage\(\) throws -> XDrivePhotoKitLocatedPage/)
  assert.match(scanner, /let page = try nextPage\(\)/)
  assert.match(scanner, /snapshot\.object\(at: page\.startOffset \+ offset\)/)
  assert.match(scanner, /asset\.location/)
  assert.match(scanner, /try ensureCurrent\(expected\)/)
  assert.match(map, /仅当前64条范围，不是完整云端地图/)
  assert.match(map, /items\.prefix\(XDriveIOSNativePhotoMapPolicy\.pageSize\)/)
  assert.match(map, /isNetworkAccessAllowed = false/)
  assert.match(map, /cancelImageRequest\(request\)/)
  assert.match(map, /onChange\(of: changes\.revision\)/)
  assert.match(map, /if state == \.active \{[\s\S]*?changes\.start\(\)[\s\S]*?if mapScope == \.page \{ refresh\(at: offset\) \}/)
  assert.match(policy, /static let pageSize = 64/)
  assert.match(policy, /latitude\.isFinite && longitude\.isFinite/)
  assert.doesNotMatch(map, /localStorage|\.write\(|Authorization:|postMessage\(/)
})

test('a presented cluster keeps PhotoKit change observation until dismissal', () => {
  assert.match(map, /\.onDisappear \{\s*\/\/ A presented cluster sheet/)
  assert.match(map, /if selection == nil && globalSelection == nil \{\s*changes\.stop\(\)/)
  assert.match(map, /\} else \{ suspendForSheet\(\) \}/)
  assert.match(map, /onChange\(of: changes\.revision\) \{ _ in\s*clearReturnCamera\(\)\s*invalidate\(\)/)
})

test('Swift catch does not shadow the map screen state error value', () => {
  assert.match(map, /if generation == ticket \{\s*clearReturnCamera\(\)\s*self\.error = "照片权限或位置已变化，请刷新重试。"/)
})

test('native Launcher marks the real local map available, not as an unavailable placeholder', () => {
  const available = dashboard.match(/var available: Bool \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(available, 'native launcher route availability must remain explicit')
  assert.match(available, /case \.local, \.albums, \.cloud, \.originals, \.map, \.backup: return true/)
  assert.match(dashboard, /case \.map:\s*openGallery\(\.map\)/)
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativeLocalPhotoMapScreen\(/)
  assert.match(dashboard, /if !route\.available \{\s*Text\("未接入"\)/)
})

test('late map annotation selection cannot reopen a photo from the previous page', () => {
  assert.match(map, /let currentPage = self\.page/)
  assert.match(map, /XDriveIOSNativePhotoMapPolicy\.acceptsSelection\(/)
  assert.match(map, /selectedIDs: selected\.map\(\\\.id\)/)
  assert.match(map, /currentPageIDs: currentPage\.items\.map\(\\\.id\)/)
  assert.match(policy, /static func acceptsSelection\(/)
  assert.match(policy, /selectedSet\.isSubset\(of: pageSet\)/)
  assert.match(policy, /selectedSet\.count == selectedIDs\.count/)
  assert.match(policy, /pageSet\.count == currentPageIDs\.count/)
  assert.match(map, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})

test('native map restores exact camera after Viewer return only for the same current PhotoKit page', () => {
  assert.match(map, /let cameraReturn: MKCoordinateRegion\?/)
  assert.match(map, /onOpen\(members, mapView\.region\)/)
  assert.match(map, /cameraReturn: cameraReturn/)
  assert.match(map, /cameraReturn = region/)
  assert.match(map, /cameraReturnOffset = currentPage\.page\.startOffset/)
  assert.match(map, /map\.setRegion\(cameraReturn, animated: false\)/)
  assert.match(map, /map\.showAnnotations\(pins, animated: false\)/)
  assert.match(map, /XDriveIOSNativePhotoMapPolicy\.shouldRestoreCamera\(/)
  assert.match(map, /requestedPageOffset: max\(0, requested\)/)
  assert.match(policy, /savedPageOffset == requestedPageOffset/)
  assert.match(policy, /permissionGranted && sceneActive/)
  assert.match(map, /onChange\(of: changes\.revision\) \{ _ in\s*clearReturnCamera\(\)/)
  assert.match(map, /changes\.stop\(\)\s*clearReturnCamera\(\)\s*invalidate\(\)/)
  assert.match(map, /private func clearReturnCamera\(\)/)
  assert.doesNotMatch(map, /UserDefaults|localStorage|URLSession|WKWebView/)
})

test('native GPS find-next skips only a bounded PhotoKit snapshot, not 100k assets', () => {
  assert.match(map, /Button\("查找下一批有定位照片"\)/)
  assert.match(map, /refresh\(at: page\.page\.nextOffset, findNextGPS: true\)/)
  assert.match(map, /\.disabled\(busy \|\| page\.page\.finished\)/)
  assert.match(map, /refresh\(at: page\.page\.nextOffset, findNextGPS: true\)\s*\}\s*\.disabled\(busy \|\| page\.page\.finished\)\s*\.frame\(minHeight: 44\)/)
  assert.match(map, /var next = try await worker\.nextLocatedPage\(\)/)
  assert.match(map, /var pagesRead = 1/)
  assert.match(map, /while findNextGPS && XDriveIOSNativePhotoMapPolicy\.shouldSeekNextGPSPage\(/)
  assert.match(map, /try Task\.checkCancellation\(\)\s*next = try await worker\.nextLocatedPage\(\)\s*pagesRead \+= 1/)
  assert.match(map, /gpsFindPagesScanned = findNextGPS \? pagesRead : 0/)
  assert.match(map, /gpsFindPagesScanned = 0\s*page = nil/)
  assert.match(map, /guard generation == ticket, phase == \.active/)
  assert.match(policy, /static let maxSeekGPSPages = 16/)
  assert.match(policy, /pagesRead >= 1 && pagesRead < maxSeekGPSPages/)
  assert.match(map, /不代表全库已完成扫描/)
  assert.match(scanner, /func nextLocatedPage\(\) throws -> XDrivePhotoKitLocatedPage/)
  // Existing PhotoKit thumbnail fetch by localIdentifier remains necessary;
  // find-next itself cannot introduce iCloud original download or upload.
  assert.match(map, /PHAsset\.fetchAssets\(/)
  assert.doesNotMatch(map, /isNetworkAccessAllowed = true|UserDefaults|POST|UploadSession/)
})


test('full-library GPS map opts in to a transient bounded PhotoKit snapshot', () => {
  assert.match(map, /Picker\("本机地图扫描范围", selection: \$mapScope\)/)
  assert.match(map, /case page, library/)
  assert.match(map, /Button\(globalComplete \? "重新扫描已授权图库位置" : "扫描已授权图库位置"\)/)
  assert.match(map, /private func scanFullLibrary\(\) \{[\s\S]*?worker\.start\(atOffset: 0\)/)
  assert.match(map, /while scanned < total \{[\s\S]*?worker\.nextLocatedPage\(\)/)
  assert.match(map, /XDriveIOSNativePhotoMapPolicy\.validPage\([\s\S]*?next\.page\.startOffset == scanned/)
  assert.match(map, /index\.add\(latitude: located\.latitude,[\s\S]*?representative: located\)/)
  assert.match(map, /pages % 16 == 0 \|\| next\.page\.finished/)
  assert.match(map, /globalCells = index\.cells[\s\S]*?globalComplete = true/)
  assert.match(map, /await worker\.reset\(\)/)
  assert.match(map, /if selection == nil && globalSelection == nil \{\s*changes\.stop\(\)/)
  assert.match(map, /globalCells = \[\][\s\S]*?globalComplete = false/)
  assert.doesNotMatch(map, /UserDefaults|CoreData|URLSession|UploadSession|isNetworkAccessAllowed = true/)
})

test('global map aggregates 100k GPS with only 64 representatives and on-demand cell albums', () => {
  assert.match(spatial, /static let maximumCells = 64/)
  assert.match(spatial, /static let maximumLevel = 16/)
  assert.match(spatial, /mutating func add\(latitude: Double, longitude: Double, representative: Payload\)/)
  assert.match(spatial, /while buckets\.count > Policy\.maximumCells/)
  assert.match(spatial, /old\.firstSeen < current\.firstSeen/)
  assert.match(map, /globalCells\.prefix\(XDriveIOSNativeLocalMapSpatialPolicy\.maximumCells\)/)
  assert.match(map, /items\.reduce\(0\) \{ \$0 \+ \$1\.displayCount \}/)
  assert.match(map, /mapView\.showAnnotations\(cluster\.memberAnnotations, animated: true\)/)
  assert.match(map, /let trusted = globalCells\.first\(where: \{ \$0\.id == cell\.id \}\)/)
  assert.match(map, /trusted\.count == cell\.count/)
  assert.match(map, /XDriveIOSMapSpatialAlbum\(selection: chosen\)/)
  assert.match(map, /while cursor < total && rows\.count < 48/)
  assert.match(map, /Policy\.key\([\s\S]*?level: selection\.cell\.key\.level/)
  assert.match(map, /cursor = asset\.slotOffset \+ 1/)
  assert.match(scanner, /slotOffset: page\.startOffset \+ offset/)
  assert.match(map, /changes\.revision\) \{ _ in[\s\S]*?retire\(\)[\s\S]*?dismiss\(\)/)
  assert.match(map, /if state != \.active \{[\s\S]*?retire\(\)/)
  assert.doesNotMatch(map, /PHImageRequestOptions\(\)[\s\S]*?isNetworkAccessAllowed = true/)
})

test('short landscape local map preserves controls and PhotoKit authority while recovering map height', () => {
  assert.match(map, /@Environment\(\\\.dynamicTypeSize\) private var dynamicTypeSize/);
  assert.match(map, /GeometryReader \{ viewport in[\s\S]*?XDriveIOSNativePhotoMapPolicy\.compactViewport\(/);
  assert.match(map, /accessibilityText: dynamicTypeSize\.isAccessibilitySize/);
  assert.match(map, /VStack\(spacing: compactMap \? 4 : 8\)/);
  assert.match(map, /if !compactMap \{\s*Text\(mapScope == \.page/);
  assert.match(map, /if !compactMap \{\s*Text\("地图只使用本机授权照片/);
  assert.match(map, /\.alert\("本机照片地图说明", isPresented: \$showingMapHelp\)/);
  assert.match(map, /\.accessibilityIdentifier\("native-ios-map-layout-help"\)/);
  assert.match(map, /Button\("查找下一批有定位照片"\)/);
  assert.match(map, /Button\("刷新当前页"\)/);
  assert.match(map, /Button\(focused \? "显示底部导航" : "专注地图"\)/);
  assert.doesNotMatch(map, /onChange\(of: compactMap\)|\.id\(compactMap\)/);
});
