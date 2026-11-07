'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const map = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const viewer = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const viewerInfo = read('ios/XDriveIOS/NativeViewerQualityPanel.swift')
const albumBrowser = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const localWall = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const mapGallery = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const scanner = read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift')
const focus = read('ios/XDriveIOS/NativeFocusVisibilityPolicy.swift')
const policy = read('ios/XDriveIOS/NativePhotoMapPolicy.swift')
const spatial = read('ios/XDriveIOS/NativeLocalPhotoMapSpatialPolicy.swift')

test('real native Gallery map uses MapKit and existing local Viewer, no WebView', () => {
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativePhotoMapsScreen\(/)
  assert.match(map, /MKMapView\(\)/)
  assert.match(map, /MKClusterAnnotation/)
  assert.match(map, /clusteringIdentifier = identifier == "photo"/)
  assert.match(map, /XDriveIOSNativeLocalPhotoDetail\(\s*candidate: initial, loadedItems: previewItems,/)
  assert.match(focus, /gallerySource == "map"/)
  assert.doesNotMatch(map, /WKWebView|URLSession|UploadSession|Keychain|UserDefaults/)
})

test('only a fresh authorized PhotoKit 64-slot scan supplies local map pins', () => {
  assert.match(scanner, /func nextLocatedPage\(\) throws -> XDrivePhotoKitLocatedPage/)
  assert.match(scanner, /let page = try nextPage\(\)/)
  assert.match(scanner, /let logicalIndex = page\.startOffset \+ offset/)
  assert.match(scanner, /snapshot\.object\(\s*at: stableBoundaryPhysicalIndices\[logicalIndex\] \?\? logicalIndex\s*\)/)
  assert.match(scanner, /asset\.location/)
  assert.match(scanner, /try ensureCurrent\(expected\)/)
  assert.match(map, /显示已授权图库中具有位置数据的照片和视频/)
  assert.match(map, /items\.prefix\(XDriveIOSNativePhotoMapPolicy\.pageSize\)/)
  assert.match(map, /options\.isNetworkAccessAllowed = true/)
  assert.match(map, /targetSize: CGSize\(width: 128, height: 128\)/)
  assert.match(map, /cancelImageRequest\(request\)/)
  assert.match(map, /onChange\(of: changes\.revision\)/)
  assert.match(map, /if state == \.active \{[\s\S]*?changes\.start\(\)[\s\S]*?if mapScope == \.page \{ refresh\(at: offset\) \}/)
  assert.match(policy, /static let pageSize = 64/)
  assert.match(policy, /latitude\.isFinite && longitude\.isFinite/)
  assert.doesNotMatch(map, /localStorage|\.write\(|Authorization:|postMessage\(/)
})

test('a presented cluster keeps PhotoKit change observation until dismissal', () => {
  assert.match(map, /\.onDisappear \{\s*currentLocation\.cancel\(\)\s*\/\/ A presented cluster sheet/)
  assert.match(map, /if selection == nil && globalSelection == nil &&\s*pendingNearbySelection == nil && nearbySelection == nil && singleViewer == nil \{\s*changes\.stop\(\)/)
  assert.match(map, /\} else \{ suspendForSheet\(\) \}/)
  assert.match(map, /onChange\(of: changes\.revision\) \{ _ in[\s\S]*?let returningCamera = globalCamera[\s\S]*?onLibraryCameraChange\?\(nil\)\s*clearReturnCamera\(\)\s*invalidate\(\)[\s\S]*?authorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)[\s\S]*?guard phase == \.active, authorization == \.authorized else \{ return \}/)
})

test('Swift catch does not shadow the map screen state error value', () => {
  assert.match(map, /if generation == ticket \{\s*clearReturnCamera\(\)\s*self\.error = "照片权限或位置已变化，请刷新重试。"/)
})

test('native Launcher marks the real local map available, not as an unavailable placeholder', () => {
  const available = dashboard.match(/var available: Bool \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(available, 'native launcher route availability must remain explicit')
  assert.match(available, /case \.local, \.albums, \.cloud, \.originals, \.map, \.files, \.notes, \.clipboard, \.backup: return true/)
  assert.match(dashboard, /case \.map:\s*openGallery\(\.map\)/)
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativePhotoMapsScreen\(/)
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
  assert.match(map, /onChange\(of: changes\.revision\) \{ _ in[\s\S]*?let returningCamera = globalCamera[\s\S]*?onLibraryCameraChange\?\(nil\)\s*clearReturnCamera\(\)\s*invalidate\(\)[\s\S]*?authorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)[\s\S]*?guard phase == \.active, authorization == \.authorized else \{ return \}/)
  assert.match(map, /changes\.stop\(\)\s*onLibraryCameraChange\?\(nil\)\s*clearReturnCamera\(\)\s*invalidate\(\)/)
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
  assert.doesNotMatch(map, /UserDefaults|POST|UploadSession/)
})


test('full-library GPS map opts in to a transient bounded PhotoKit snapshot', () => {
  assert.doesNotMatch(map, /Picker\("本机地图扫描范围"/)
  assert.match(map, /case page, library/)
  assert.match(map, /if !globalComplete && !busy \{[\s\S]*?Button\(album == nil \? "扫描已授权图库位置" : "扫描此相册位置"\) \{\s*scanFullLibrary\(\)\s*\}/)
  assert.match(map, /private func scanFullLibrary\([\s\S]*?viewport: XDriveIOSNativeLocalMapViewport\? = nil[\s\S]*?worker\.startMap\(\s*atOffset: 0, album: album, mediaFilter: mediaFilter\s*\)/)
  assert.match(map, /while scanned < total \{[\s\S]*?worker\.nextLocatedPage\(\)/)
  assert.match(map, /XDriveIOSNativePhotoMapPolicy\.validPage\([\s\S]*?next\.page\.startOffset == scanned/)
  assert.match(map, /index\.add\(latitude: located\.latitude,[\s\S]*?representative: located\)/)
  assert.match(map, /pages % 16 == 0 \|\| next\.page\.finished/)
  assert.match(map, /globalCells = index\.cells[\s\S]*?globalComplete = true/)
  assert.match(map, /await worker\.reset\(\)/)
  assert.match(map, /if selection == nil && globalSelection == nil &&\s*pendingNearbySelection == nil && nearbySelection == nil && singleViewer == nil \{\s*changes\.stop\(\)/)
  assert.match(map, /globalCells = \[\][\s\S]*?globalComplete = false/)
  assert.doesNotMatch(map, /UserDefaults|CoreData|URLSession|UploadSession/)
})

test('global map aggregates 100k GPS with only 64 representatives and on-demand cell albums', () => {
  assert.match(spatial, /static let maximumCells = 64/)
  assert.match(spatial, /static let maximumLevel = 16/)
  assert.match(spatial, /mutating func add\(latitude: Double, longitude: Double, representative: Payload\)/)
  assert.match(spatial, /while buckets\.count > Policy\.maximumCells/)
  assert.match(spatial, /old\.firstSeen < current\.firstSeen/)
  assert.match(map, /globalCells\.prefix\(XDriveIOSNativeLocalMapSpatialPolicy\.maximumCells\)/)
  assert.match(map, /items\.reduce\(0\) \{ \$0 \+ \$1\.displayCount \}/)
  assert.match(map, /onCells\?\(cells\.sorted \{ \$0\.id < \$1\.id \}, mapView\.region\)/)
  assert.match(map, /let trusted = globalCells\.first\(where: \{[\s\S]*?\$0\.id == cell\.id/)
  assert.match(map, /trusted\.count == cell\.count/)
  assert.match(map, /XDriveIOSMapSpatialAlbum\(\s*selection: chosen, album: album,/)
  assert.match(map, /while rows\.count < 48/)
  assert.match(map, /Policy\.key\([\s\S]*?level: level[\s\S]*?selectedKeys\.contains\(key\)/)
  assert.match(map, /pending\[cursor\]\.candidate/)
  assert.match(scanner, /slotOffset: page\.startOffset \+ offset/)
  assert.match(map, /changes\.revision\) \{ _ in[\s\S]*?retire\(\)[\s\S]*?dismiss\(\)/)
  assert.match(map, /if state != \.active \{[\s\S]*?retire\(\)/)
  assert.match(map, /placeholder\.isHidden = true[\s\S]*?loading\.startAnimating\(\)[\s\S]*?loading\.stopAnimating\(\)/)
})


test('full-library clustered covers open all verified cells with bounded PhotoKit paging', () => {
  assert.match(map, /let cells = items\.compactMap\(\\\.cell\)/)
  assert.match(map, /cells\.count == items\.count/)
  assert.match(map, /Set\(cells\.map\(\\\.id\)\)\.count == cells\.count/)
  assert.match(map, /onCells\?\(cells\.sorted/)
  assert.match(map, /XDriveIOSNativeLocalMapSpatialPolicy\.acceptsCellSelection\(/)
  assert.match(map, /selectedIDs: cells\.map\(\\\.id\)/)
  assert.match(map, /currentCellIDs: globalCells\.map\(\\\.id\)/)
  assert.match(map, /trusted\.representative\.id == cell\.representative\.id/)
  assert.match(map, /selection\.cells\.reduce\(0\) \{ \$0 \+ \$1\.count \}/)
  assert.match(map, /let selectedKeys = Set\(selection\.cells\.map\(\\\.key\)\)/)
  assert.match(map, /selectedKeys\.contains\(key\)/)
  assert.match(spatial, /static func acceptsCellSelection\(/)
  assert.match(spatial, /selected\.isSubset\(of: current\)/)
  assert.doesNotMatch(map, /if let cluster = view\.annotation as\? MKClusterAnnotation \{\s*mapView\.showAnnotations/)
})

test('full-authorized PhotoKit map automatically refines live WGS84 viewport without repeated 100k rescans', () => {
  assert.match(map, /var onCamera: \(\(MKCoordinateRegion\) -> Void\)\? = nil/)
  assert.match(map, /func mapView\(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool\) \{[\s\S]*?onCamera\?\(mapView\.region\)/)
  assert.match(map, /@State private var globalCamera: MKCoordinateRegion\?/)
  assert.match(map, /@State private var globalViewport: XDriveIOSNativeLocalMapViewport\?/)
  assert.match(map, /cameraReturn: globalCamera/)
  assert.match(map, /onCamera: \{ current in[\s\S]*?globalCamera = current/)
  assert.match(map, /XDriveIOSNativeLocalMapSpatialPolicy\.viewportBounds\([\s\S]*?latitude: current\.center\.latitude,[\s\S]*?longitude: current\.center\.longitude/)
  assert.match(map, /scanFullLibrary\(viewport: padded, preserveCurrentMap: true\)/)
  assert.match(map, /let restoreCamera = viewport == nil \? nil : globalCamera[\s\S]*?invalidate\(\)[\s\S]*?globalCamera = restoreCamera/)
  assert.match(map, /globalViewport = viewport/)
  assert.match(map, /globalCamera = nil[\s\S]*?globalViewport = nil/)
  assert.doesNotMatch(map, /Timer\.scheduledTimer|DispatchQueue\.main\.asyncAfter|UserDefaults\.|URLSession\(/)
})

test('map filtered overview and 48-photo cell wall share exact short-lived viewport', () => {
  assert.match(spatial, /struct XDriveIOSNativeLocalMapViewport: Equatable/)
  assert.match(spatial, /static func viewportBounds\(/)
  assert.match(spatial, /static func includes\(/)
  assert.match(spatial, /if viewport\.west <= viewport\.east \{/)
  assert.match(spatial, /if longitudeSpan >= 360 \{/)
  assert.match(spatial, /let boundaryLongitude = longitude == -180 && viewport\.east == 180/)
  assert.match(spatial, /longitude == 180 && viewport\.west == -180/)
  assert.match(spatial, /return boundaryLongitude >= viewport\.west \|\| boundaryLongitude <= viewport\.east/)
  assert.match(map, /guard XDriveIOSNativeLocalMapSpatialPolicy\.includes\([\s\S]*?viewport, latitude: located\.latitude,[\s\S]*?longitude: located\.longitude/)
  assert.match(map, /globalSelection = XDriveIOSMapSpatialSelection\([\s\S]*?cells: cells, viewport: globalViewport/)
  assert.match(map, /let viewport: XDriveIOSNativeLocalMapViewport\?/)
  assert.match(map, /guard Policy\.includes\([\s\S]*?selection\.viewport,[\s\S]*?latitude: asset\.latitude, longitude: asset\.longitude[\s\S]*?Policy\.key\(/)
  assert.match(map, /pending = next\.items\.filter \{ asset in/)
  assert.match(map, /guard generation == ticket, mapScope == \.library, phase == \.active/)
  assert.match(map, /globalCells = index\.cells/)
  assert.doesNotMatch(map, /CoreData|localStorage|GPSUpload/)
})


test('refined PhotoKit map revokes old region cluster actions during and after pan or zoom', () => {
  assert.match(spatial, /static func matchesViewport\(/)
  assert.match(spatial, /longitudeDistance\(scanned\.west, current\.west\)/)
  assert.match(map, /private var refinedViewportIsCurrent: Bool \{/)
  assert.match(map, /guard !globalCameraMoving, let current = globalCamera/)
  assert.match(map, /canSelectCells: refinedViewportIsCurrent/)
  assert.match(map, /globalComplete,\s*refinedViewportIsCurrent,/)
  assert.match(map, /context\.coordinator\.canSelectCells = canSelectCells/)
  assert.match(map, /cover\.isEnabled = canSelectCells/)
  assert.match(map, /cover\.accessibilityElementsHidden = !canSelectCells/)
  assert.match(map, /guard canSelectCells else \{ return \}/)
  assert.match(map, /func mapView\(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool\)/)
  assert.match(map, /globalCameraMoving = true/)
  assert.match(map, /globalCameraMoving = false/)
  assert.doesNotMatch(map, /native-ios-map-stale-viewport|上次细化的视窗没有可显示的 GPS 照片/)
})

test('local map requires Full Photo Library access and never scans a Limited subset', () => {
  assert.match(map, /PHPhotoLibrary\.requestAuthorization\(for: \.readWrite\)[\s\S]*?authorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(map, /if authorization == \.authorized \{[\s\S]*?scanFullLibrary\(\)[\s\S]*?else \{[\s\S]*?invalidate\(\)/)
  assert.match(map, /else if authorization == \.limited \{[\s\S]*?本机照片地图需要完整照片访问权限[\s\S]*?openPhotoSettings\(\)/)
  assert.match(map, /native-ios-map-open-photo-settings/)
  assert.doesNotMatch(map, /\[\.authorized, \.limited\]\.contains|authorization == \.authorized \|\| authorization == \.limited|permission == \.authorized \|\| permission == \.limited/)
  assert.match(map, /guard sceneActive, permission == \.authorized,/)
  assert.match(map, /guard mapScope == \.library, phase == \.active,[\s\S]*?authorization == \.authorized else/)
  assert.match(map, /onChange\(of: phase\)[\s\S]*?guard authorization == \.authorized else/)
  assert.match(map, /onChange\(of: changes\.revision\)[\s\S]*?authorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)[\s\S]*?guard phase == \.active, authorization == \.authorized else/)
  assert.match(map, /if mapScope == \.library \{\s*scanFullLibrary\(returningCamera: returningCamera\)/)
  assert.match(map, /private func loadInitial\(\)[\s\S]*?guard phase == \.active,[\s\S]*?\[\.authorized\]\.contains/)
  assert.match(map, /private func loadNext\(\)[\s\S]*?guard phase == \.active/)
  assert.match(map, /trusted\.representative\.id == cell\.representative\.id/)
  assert.match(viewer, /private func openPhotoLocationInMap\(\) \{\s*guard PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized else/)
  assert.match(viewer, /onOpenLocation: openNativeLocalMap == nil \|\|[\s\S]*?authorizationStatus\(for: \.readWrite\) != \.authorized[\s\S]*?\? nil : \{ openPhotoLocationInMap\(\) \}/)
  assert.match(viewer, /本机照片地图需要完整照片访问权限/)
})


test('empty refined viewport keeps its prior MapKit camera without fitting world or stale pins', () => {
  const start = map.indexOf('func updateUIView(_ map: MKMapView, context: Context)')
  const end = map.indexOf('static func dismantleUIView(_ map: MKMapView, coordinator: Coordinator)', start)
  assert.ok(start > 0 && end > start)
  const update = map.slice(start, end)
  assert.match(update, /map\.addAnnotations\(pins\)[\s\S]*?if let cameraReturn \{[\s\S]*?map\.setRegion\(cameraReturn, animated: false\)[\s\S]*?\} else if !pins\.isEmpty \{[\s\S]*?map\.showAnnotations\(pins, animated: false\)/)
})


test('short landscape local map preserves controls and PhotoKit authority while recovering map height', () => {
  assert.match(map, /@Environment\(\\\.dynamicTypeSize\) private var dynamicTypeSize/);
  assert.match(map, /GeometryReader \{ viewport in[\s\S]*?XDriveIOSNativePhotoMapPolicy\.compactViewport\(/);
  assert.match(map, /accessibilityText: dynamicTypeSize\.isAccessibilitySize/);
  assert.match(map, /VStack\(spacing: compactMap \? 4 : 8\)/);
  assert.doesNotMatch(map, /Text\(mapScope == \.page/);
  assert.doesNotMatch(map, /地图稳定后按需细化|最多保留64个区域|点击位置后按 48 张逐批查找/);
  assert.doesNotMatch(map, /showingMapHelp|native-ios-map-layout-help/);
  assert.match(map, /Button\("查找下一批有定位照片"\)/);
  assert.match(map, /Button\("刷新当前页"\)/);
  assert.match(map, /Button\(focused \? "显示底部导航" : "专注地图"\)/);
  assert.doesNotMatch(map, /onChange\(of: compactMap\)|\.id\(compactMap\)/);
});

test('local Gallery map retains parent-owned mode and page only, but revalidates PhotoKit on entry', () => {
  assert.match(map, /enum XDriveIOSNativeLocalMapScope: String, CaseIterable/);
  assert.match(map, /@Binding var mapScope: XDriveIOSNativeLocalMapScope/);
  assert.match(map, /@Binding var offset: Int/);
  assert.doesNotMatch(map, /@State private var offset = 0/);
  assert.doesNotMatch(map, /@State private var mapScope: XDriveIOSNativeLocalMapScope = \.page/);
  assert.match(map, /if next == \.page && phase == \.active \{ refresh\(at: offset\) \}/);
  assert.match(map, /if mapScope == \.page, page == nil, !busy, phase == \.active \{\s*refresh\(at: offset\)/);
  assert.match(map, /XDriveIOSNativePhotoMapPolicy\.validPage\(/);
  assert.match(map, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/);
  assert.doesNotMatch(map, /UserDefaults|WKWebView|UploadSession/);
});


test('both local MapKit album sheets browse a frozen authorized slice and restore last viewed tile', () => {
  const bounded = map.slice(map.indexOf('private struct XDriveIOSMapPhotoAlbum: View'),
    map.indexOf('enum XDriveIOSNativeLocalMapScope'));
  const spatialAlbum = map.slice(map.indexOf('private struct XDriveIOSMapSpatialAlbum: View'),
    map.indexOf('/// One native map route'));
  const admission = map.slice(map.indexOf('private enum XDriveIOSNativeMapViewerAdmission'),
    map.indexOf('private struct XDriveIOSMapPhotoAlbum: View'));
  assert.match(admission, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.localLoadedIndex\(/);
  assert.match(admission, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/);
  assert.match(admission, /PHAsset\.fetchAssets\(\s*withLocalIdentifiers: \[item\.id\]/);
  assert.match(admission, /asset\.creationDate == item\.capturedAt/);
  assert.match(admission, /asset\.modificationDate == item\.modifiedAt/);
  assert.match(admission, /item\.isLive == asset\.mediaSubtypes\.contains\(\.photoLive\)/);
  assert.doesNotMatch(admission, /isNetworkAccessAllowed|URLSession|UserDefaults|UploadSession/);
  for (const [name, screen] of [['bounded map pins', bounded], ['48-row GPS cell', spatialAlbum]]) {
    assert.match(screen, /ScrollViewReader \{ returnScroll in/, name);
    assert.match(screen, /XDriveIOSNativeLocalPhotoDetail\(\s*candidate: initial, loadedItems: (previewItems|viewerItems),/,
      name + ' must provide neighbors to the native Viewer');
    assert.match(screen, /onViewed: \{ next in[\s\S]*?viewerReturnID = next\.id/,
      name + ' must track the actual last viewed member');
    assert.match(screen, /XDriveIOSNativeMapViewerAdmission\.allows\(/,
      name + ' must revalidate the currently authorized member');
    assert.match(screen, /\.fullScreenCover\(item: \$(selected|viewer), onDismiss: \{\s*restoreViewerTile\(using: returnScroll\)/,
      name + ' must restore after modal dismissal');
    assert.match(screen, /scroll\.scrollTo\(id, anchor: \.center\)/, name);
    assert.match(screen, /\.id\(item\.id\)/, name);
    assert.match(screen, /\.accessibilityFocused\(\$focusedTileID, equals: item\.id\)/, name);
    assert.match(screen, /defer \{ viewerReturnID = nil \}/, name);
  }
  assert.match(bounded, /items\.prefix\(XDriveIOSNativePhotoMapPolicy\.pageSize\)/);
  assert.match(spatialAlbum, /private func loadedWindow\(containing id: String\)/);
  assert.match(spatialAlbum, /loadedItems: viewerItems/);
  assert.match(spatialAlbum, /guard !busy,[\s\S]*?XDriveIOSNativeMapViewerAdmission\.allows\(/);
  assert.match(spatialAlbum, /viewerReturnID = nil[\s\S]*?viewer = nil[\s\S]*?priorWindow = \[\][\s\S]*?items = \[\][\s\S]*?dismiss\(\)/);
});


test('iOS Places defaults to the full authorized PhotoKit map without exposing a page mode',()=>{
  assert.match(dashboard, /@State private var localMapScope: XDriveIOSNativeLocalMapScope = \.library/)
  assert.match(dashboard, /localMapScope = \.library/)
  assert.match(dashboard, /localMapScope = \.library\s+localMapPageOffset = 0/)
  assert.doesNotMatch(map, /Picker\("本机地图扫描范围"/)
  assert.match(map, /case page, library/)
  assert.match(map, /authorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)\s+changes\.start\(\)/)
  assert.match(map, /else if mapScope == \.library && !globalComplete && !busy &&\s*phase == \.active \{[\s\S]*?scanFullLibrary\(\)/)
  assert.match(map, /if next == \.library && phase == \.active \{ scanFullLibrary\(\) \}/)
  assert.match(map, /if mapScope == \.page \{ refresh\(at: offset\) \}\s*else \{ scanFullLibrary\(\) \}/)
  assert.match(map, /guard mapScope == \.library, phase == \.active,\s*authorization == \.authorized else \{/ )
  assert.match(map, /while scanned < total \{/)
  assert.match(spatial, /static let maximumCells = 64/)
  assert.match(map, /pages % 16 == 0 \|\| next\.page\.finished/)
  assert.match(map, /\.onDisappear \{[\s\S]*?if selection == nil && globalSelection == nil &&\s*pendingNearbySelection == nil && nearbySelection == nil && singleViewer == nil \{[\s\S]*?invalidate\(\)/)
  assert.doesNotMatch(map, /URLSession\(|UploadSession|UserDefaults/)
})


test('verified single-photo MapKit cover opens L3 native Viewer without location sheet', () => {
  assert.match(map, /@State private var singleViewer: XDrivePhotoKitScanCandidate\?/)
  assert.match(map, /if cells\.count == 1, let only = cells\.first,\s*only\.count == 1/)
  assert.match(map, /only\.representative\.candidate[\s\S]*?XDriveIOSNativeMapViewerAdmission\.allows\([\s\S]*?singleViewer = candidate/)
  assert.match(map, /else \{\s*globalSelection = XDriveIOSMapSpatialSelection\(\s*cells: cells, viewport: globalViewport,\s*mediaFilter: mediaFilter\)/)
  assert.match(map, /if selected\.count == 1, let only = selected\.first,[\s\S]*?singleViewer = only/)
  assert.match(map, /in: currentPage\.items\.map\(\\\.candidate\)/)
  assert.match(map, /\.fullScreenCover\(item: \$singleViewer, onDismiss:/)
  assert.match(map, /XDriveIOSNativeLocalPhotoDetail\(\s*candidate: initial, loadedItems: \[initial\]/)
  assert.match(map, /if mapScope == \.page \{[\s\S]*?refresh\(at: offset\)/)
  assert.match(map, /if selection == nil && globalSelection == nil &&\s*pendingNearbySelection == nil && nearbySelection == nil && singleViewer == nil/)
  assert.match(map, /selection = nil\s*globalSelection = nil\s*pendingNearbySelection = nil\s*nearbySelection = nil\s*singleViewer = nil/)
  assert.match(map, /onChange\(of: changes\.revision\) \{ _ in[\s\S]*?let returningCamera = globalCamera[\s\S]*?onLibraryCameraChange\?\(nil\)\s*clearReturnCamera\(\)\s*invalidate\(\)[\s\S]*?authorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)[\s\S]*?guard phase == \.active, authorization == \.authorized else \{ return \}/)
  assert.doesNotMatch(map, /localStorage|UploadSession/)
})


test('verified native Viewer GPS opens the existing Gallery local map and nearby PhotoKit viewport', () => {
  assert.match(viewer, /import MapKit/)
  assert.match(viewer, /private func verifiedLocation\(\) -> CLLocationCoordinate2D\? \{[\s\S]*?verified\(viewed\)[\s\S]*?PHAsset\.fetchAssets\([\s\S]*?asset\.location\?\.coordinate[\s\S]*?validCoordinate/)
  assert.match(viewer, /private func openPhotoLocationInMap\(\) \{[\s\S]*?verifiedLocation\(\)[\s\S]*?XDriveIOSNativeLocalMapJump\([\s\S]*?dismiss\(\)[\s\S]*?openNativeLocalMap\(jump\)/)
  assert.match(viewer, /Button\("照片信息"\) \{ showPhotoInfo\(\) \}/)
  assert.match(viewer, /private func verifiedPhotoInfo\(\)[\s\S]*?asset\.location\?\.coordinate[\s\S]*?location: validLocation/)
  assert.match(viewer, /XDriveIOSNativeViewerInfoSheet\([\s\S]*?onOpenLocation:/)
  assert.match(viewerInfo, /XDriveIOSNativeViewerInfoMapPreview\(coordinate: coordinate\)/)
  assert.match(viewerInfo, /Label\("在地图中显示附近照片", systemImage: "map"\)/)
  assert.match(viewerInfo, /if let onOpenLocation \{[\s\S]*?onOpenLocation\(\)/)
  assert.match(map, /struct XDriveIOSNativeLocalMapJump: Equatable \{[\s\S]*?validCoordinate\([\s\S]*?var nearbyViewport:/)
  assert.match(map, /private func focusOnRequestedPhotoLocation\(\) -> Bool \{[\s\S]*?handledMapJumpID = jump\.id[\s\S]*?globalCamera = jump\.camera[\s\S]*?scanFullLibrary\(viewport: viewport\)/)
  assert.match(map, /if focusOnRequestedPhotoLocation\(\) \{ return \}/)
  assert.match(map, /onChange\(of: incomingMapJump\?\.id\)/)
  assert.match(dashboard, /@State private var localMapJump: XDriveIOSNativeLocalMapJump\?/)
  assert.match(dashboard, /ownerScopeKey == expectedRouteOwnerKey[\s\S]*?PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)[\s\S]*?openGallery\(\.map\)\s+localMapJump = jump\s+localMapCamera = jump\.camera\s+localMapScope = \.library\s+mapSource = \.local/)
  assert.match(dashboard, /localMapJump = nil\s+mapSource = \.local/)
  assert.doesNotMatch(map, /WKWebView|URLSession\(|UploadSession|UserDefaults/)
})


test('PhotoKit full-library map is photo-first after scan, with only recovery rescan in the toolbar', () => {
  const localMap = map.slice(map.indexOf('struct XDriveIOSNativeLocalPhotoMapScreen: View'))
  const onScreen = localMap.slice(localMap.indexOf('var body: some View {'),
                                 localMap.indexOf('.toolbar {'))
  const fullLibrary = onScreen.slice(onScreen.indexOf('} else if mapScope == .library {'),
                                     onScreen.indexOf('} else if let page {'))
  assert.match(fullLibrary, /XDriveIOSMapKitPhotoPage\([\s\S]*?\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/)
  assert.match(fullLibrary, /if !globalComplete && !busy \{\s*Button\(album == nil \? "扫描已授权图库位置" : "扫描此相册位置"\)/)
  assert.doesNotMatch(fullLibrary, /Button\("重新扫描已授权图库位置"\)|Button\("细化当前视窗的定位照片"\)|Button\("还原已授权全库概览"\)/)
  assert.match(localMap, /\.toolbar \{[\s\S]*?if mapScope == \.library && globalComplete \{\s*ToolbarItem\(placement: \.navigationBarTrailing\) \{\s*Menu \{/)
  assert.match(localMap, /Button\(album == nil \? "重新扫描已授权图库位置" : "重新扫描此相册位置"\) \{\s*scanFullLibrary\(\)\s*\}[\s\S]*?\.disabled\(busy\)/)
  assert.doesNotMatch(localMap, /细化当前视窗的定位照片|还原已授权全库概览/)
  assert.match(localMap, /Label\("地图操作", systemImage: "ellipsis.circle"\)/)
  assert.match(localMap, /accessibilityIdentifier\("native-ios-local-map-actions"\)/)
  assert.doesNotMatch(localMap, /Text\(mapScope == \.page/)
  assert.doesNotMatch(localMap, /native-ios-map-full-library-summary|native-ios-map-stale-viewport/)
  assert.match(localMap, /Button\(focused \? "显示底部导航" : "专注地图"\)/)
  assert.match(localMap, /onChange\(of: changes\.revision\) \{ _ in[\s\S]*?clearReturnCamera\(\)\s*invalidate\(\)/)
})


test('first full-library GPS scan displays inert native MapKit while PhotoKit progress advances', () => {
  const localMap = map.slice(map.indexOf('struct XDriveIOSNativeLocalPhotoMapScreen: View'))
  const body = localMap.slice(localMap.indexOf('var body: some View {'),
                               localMap.indexOf('.navigationTitle(album.map'))
  const library = body.slice(body.indexOf('} else if mapScope == .library {'),
                             body.indexOf('} else if let page {'))
  const mapIndex = library.indexOf('XDriveIOSMapKitPhotoPage(')
  const progressIndex = library.indexOf('ProgressView(album == nil ? "正在读取照片位置…" : "正在读取相册位置…")')
  assert.ok(mapIndex >= 0 && progressIndex > mapIndex,
    'MapKit must stay on-screen during initial scan, with progress beside it')
  assert.match(library, /if globalComplete && globalCells\.isEmpty \{[\s\S]*?\}\s*\/\/ Keep MapKit mounted/)
  assert.match(library, /items: \[\], globalCells: globalComplete \? globalCells : provisionalCells,\s*revision: mapRevision, mapType: mapType, cameraReturn: globalCamera,\s*focusRequestID: currentLocation\.requestID,\s*focusCamera: currentLocation\.camera,\s*showsUserDot: currentLocation\.showsUserDot,\s*provisional: !globalComplete && !provisionalCells\.isEmpty/)
  assert.match(localMap, /private var refinedViewportIsCurrent: Bool \{\s*\/\/ Scanned-incomplete cells[\s\S]*?guard globalComplete, !busy else \{ return false \}/)
  assert.match(library, /canSelectCells: refinedViewportIsCurrent/)
  assert.match(library, /guard phase == \.active, !busy, globalComplete,\s*refinedViewportIsCurrent/)
  assert.doesNotMatch(library, /native-ios-map-stale-viewport|上次细化的视窗/)
  assert.match(library, /if busy \{[\s\S]*?ProgressView\(album == nil \? "正在读取照片位置…" : "正在读取相册位置…"\)/)
  assert.match(library, /accessibilityIdentifier\(album == nil \? "native-ios-map-full-library-scan-progress" : "native-ios-map-album-scan-progress"\)/)
  assert.doesNotMatch(library, /扫描完整授权范围中的位置元数据|已检查 .*个槽位/)
  assert.match(library, /if !globalComplete && !busy \{\s*Button\(album == nil \? "扫描已授权图库位置" : "扫描此相册位置"\)/)
  assert.match(localMap, /globalCells = index\.cells[\s\S]*?globalComplete = true[\s\S]*?mapRevision = UUID\(\)/)
  assert.match(localMap, /if next\.page\.finished \{ break \}[\s\S]*?try Task\.checkCancellation\(\)[\s\S]*?scanned == total/)
  assert.doesNotMatch(library, /globalCells = index\.cells|URLSession\(|UploadSession/)
})

test('GPS cell album automatically advances as its lazy-grid sentinel enters the viewport', () => {
  const spatialAlbum = map.slice(map.indexOf('private struct XDriveIOSMapSpatialAlbum: View'),
    map.indexOf('/// One native map route'));
  assert.match(spatialAlbum, /@State private var priorWindow: \[XDrivePhotoKitScanCandidate\] = \[\]/);
  assert.match(spatialAlbum, /@State private var pendingLocated: \[XDrivePhotoKitLocatedCandidate\] = \[\]/);
  assert.match(spatialAlbum, /private var visibleItems: \[XDrivePhotoKitScanCandidate\] \{\s*priorWindow \+ items\s*\}/);
  assert.match(spatialAlbum, /private func readWindow\(/);
  assert.match(spatialAlbum, /while rows\.count < 48/);
  assert.match(spatialAlbum, /scanner\.nextLocatedPage\(\)/);
  assert.match(spatialAlbum, /pending\[cursor\]\.candidate/);
  assert.match(spatialAlbum, /XDriveIOSNativePhotoWallGrid\(density: wallDensity\)[\s\S]*?ForEach\(priorWindow\)[\s\S]*?ForEach\(items\)[\s\S]*?if hasNext \{\s*Color\.clear/);
  assert.match(spatialAlbum, /\.onAppear \{\s*scrollFootVisible = true\s*advanceIfVisible\(\)/);
  assert.match(spatialAlbum, /\.onChange\(of: busy\) \{ isBusy in[\s\S]*?if !isBusy \{ advanceIfVisible\(\) \}/);
  assert.match(spatialAlbum, /private func advanceIfVisible\(\)[\s\S]*?guard XDriveIOSNativePhotoWallWindowPolicy\.shouldAdvance\(\s*footVisible: scrollFootVisible, hasNext: hasNext, busy: busy,[\s\S]*?failed: error != nil, viewerOpen: viewer != nil,[\s\S]*?scopeActive: phase == \.active/);
  assert.doesNotMatch(spatialAlbum, /DragGesture\(minimumDistance: 12\)|Button\("继续浏览下一批照片"\)/);
  assert.match(spatialAlbum, /priorWindow = departingItems\s*autoScrollReturnID = departingItems\.last\?\.id\s*items = result\.items/);
  assert.match(spatialAlbum, /returnScroll\.scrollTo\(anchor, anchor: \.bottom\)/);
  assert.match(spatialAlbum, /loadedItems: viewerItems/);
  assert.match(spatialAlbum, /loadedWindow\(containing: item\.id\)/);
  assert.match(spatialAlbum, /if result\.scannerFinished[\s\S]*?result\.pendingIndex >= result\.pending\.count[\s\S]*?scanner\.reset\(\)/);
  assert.match(spatialAlbum, /changes\.revision[\s\S]*?retire\(\)[\s\S]*?dismiss\(\)/);
  assert.match(spatialAlbum, /\.onDisappear \{\s*if viewer == nil \{\s*retire\(\)[\s\S]*?changes\.stop\(\)[\s\S]*?Keep its PhotoKit cursor/);
  const loadNext = spatialAlbum.slice(spatialAlbum.indexOf('private func loadNext()'),
    spatialAlbum.indexOf('private func retire()'));
  assert.match(loadNext, /readWindow\(\s*scanner: scanner,\s*pending: pendingLocated/);
  assert.doesNotMatch(loadNext, /scanner\.start\(atOffset:/);
  assert.doesNotMatch(spatialAlbum, /上一批|继续查找下一批|第 \d+ 批/);
  assert.doesNotMatch(spatialAlbum, /UserDefaults|URLSession|UploadSession/);
});



test('native Photos album exposes Show Map only with Full Photo Library access', () => {
  assert.match(albumBrowser, /Menu \{[\s\S]*?if permission == \.authorized && selected == nil && !selectionMode[\s\S]*?native-ios-local-album-show-map/)
  assert.match(albumBrowser, /Button \{\s*mapAlbumScope = album\s*albumMapJump = nil\s*showingAlbumMap = true\s*\} label: \{\s*Label\("显示地图", systemImage: "map"\)/)
  assert.match(albumBrowser, /Label\("更多", systemImage: "ellipsis.circle"\)/)
  assert.match(albumBrowser, /fullScreenCover\(isPresented: \$showingAlbumMap\)[\s\S]*?XDriveIOSNativeLocalPhotoMapScreen\(\s*album: mapAlbumScope,[\s\S]*?mapScope: \.constant\(\.library\)[\s\S]*?onClose:[\s\S]*?cameraOnEntry: albumMapCamera[\s\S]*?onLibraryCameraChange: \{ next in albumMapCamera = next \}/)
  assert.match(albumBrowser, /@State private var albumMapCamera: MKCoordinateRegion\?/)
  assert.match(albumBrowser, /\.environment\(\\\.xdriveNativeLocalMapJump, albumMapJump\)/)
  assert.match(albumBrowser, /\.environment\(\\\.xdriveOpenNativeLocalMap, \{ jump in\s*pendingAlbumMapJump = jump/)
  assert.match(albumBrowser, /private func restoreAfterViewer\(\)[\s\S]*?pendingAlbumMapJump[\s\S]*?mapAlbumScope = nil[\s\S]*?albumMapJump = jump[\s\S]*?showingAlbumMap = true/)
  assert.match(map, /var album: XDriveLocalPhotoAlbumSummary\? = nil/)
  assert.match(map, /if album == nil && onFocusChange != nil \{\s*ToolbarItem\(placement: \.navigationBarTrailing\)[\s\S]*?native-ios-map-focus-toggle/)
  assert.match(map, /worker\.startMap\(\s*atOffset: 0, album: album, mediaFilter: mediaFilter\s*\)/)
  assert.match(map, /\.sheet\(item: \$globalSelection, onDismiss: \{[\s\S]*?\}\) \{ chosen in[\s\S]*?XDriveIOSMapSpatialAlbum\(\s*selection: chosen, album: album,/)
  assert.match(map, /scanner\.startMap\(\s*atOffset: 0, album: album, mediaFilter: selection\.mediaFilter\s*\)/)
  assert.match(map, /album == nil \?\s*"此授权图库没有可显示位置的照片或视频。" :\s*"此相册没有可显示位置的照片或视频。"/)
})

test('album map scans the current PhotoKit collection snapshot, not the whole library or Server', () => {
  assert.match(scanner, /func start\(atOffset requestedOffset: Int = 0,[\s\S]*?album: XDriveLocalPhotoAlbumSummary\? = nil\)/)
  assert.match(scanner, /status == \.authorized \|\| \(!requireStableResume && album == nil && status == \.limited\)/)
  // Backup passes requireStableResume=true; read-only Gallery keeps Limited scope.
  assert.match(scanner, /if requireStableResume \{/)
  assert.match(read("ios/XDriveIOS/ForegroundPhotoBackupMVP.swift"), /requireStableResume: true/)
  assert.match(scanner, /PHAssetCollection\.fetchAssetCollections\(\s*withLocalIdentifiers: \[album\.collectionIdentifier\]/)
  assert.match(scanner, /currentName == album\.name, currentKind == album\.kind/)
  assert.match(scanner, /PHAsset\.fetchAssets\(in: collection, options: options\)/)
  assert.match(scanner, /PHAsset\.fetchAssets\(with: options\)/)
  assert.doesNotMatch(scanner, /UserDefaults|URLSession|UploadSession|localStorage/)
  assert.match(map, /guard mapScope == \.library, phase == \.active,[\s\S]*?authorization == \.authorized else/)
  assert.match(map, /guard album == nil, mapScope == \.library, phase == \.active/)
})


test('native local Gallery opens the full-library map from its filter menu without destroying the wall', () => {
  assert.match(localWall, /Section\("地图"\)[\s\S]*?Button \{\s*showingMap = true\s*\}[\s\S]*?Label\("显示地图", systemImage: "map"\)/)
  assert.match(localWall, /permission != \.authorized[\s\S]*?native-ios-local-wall-show-map/)
  assert.match(localWall, /\.fullScreenCover\(isPresented: \$showingMap\)[\s\S]*?XDriveIOSNativeLocalPhotoMapScreen\([\s\S]*?mapScope: \.constant\(\.library\)[\s\S]*?onClose:[\s\S]*?cameraOnEntry: mapCamera[\s\S]*?onLibraryCameraChange: \{ next in mapCamera = next \}/)
  assert.match(localWall, /@State private var mapCamera: MKCoordinateRegion\?/)
  assert.match(localWall, /\.environment\(\\\.xdriveNativeLocalMapJump, mapJump\)/)
  assert.match(map, /if album != nil \|\| onClose != nil[\s\S]*?if onClose != nil \{ onClose\?\(\) \}/)
  assert.match(map, /if album == nil && onFocusChange != nil/)
  assert.match(localWall, /Toggle\("照片", isOn: mediaFilterBinding\(for: \.photos\)\)/)
  assert.match(localWall, /Button\("重置筛选"\) \{ mediaFilter = \.all \}/)
  assert.match(localWall, /\.environment\(\\\.xdriveOpenNativeLocalMap, \{ jump in\s*pendingViewerMapJump = jump/)
  assert.match(localWall, /private func restoreAfterViewer\(\)[\s\S]*?pendingViewerMapJump[\s\S]*?mapJump = jump[\s\S]*?showingMap = true/)
  assert.match(dashboard, /ForEach\(XDriveIOSNativeGallerySource\.allCases\.filter \{\s*\$0 != \.map &&/)
  assert.match(dashboard, /onClose: \{ closeGalleryMap\(\) \}/)
  assert.match(mapGallery, /var onClose: \(\(\) -> Void\)\? = nil/)
  assert.match(mapGallery, /if source == \.cloud[\s\S]*?Button\("完成"\) \{ onClose\?\(\) \}/)
  assert.match(mapGallery, /ToolbarItem\(placement: \.navigationBarTrailing\)[\s\S]*?native-ios-map-source-selector/)
})


test('album-scoped place wall exposes Show Nearby Photos into the full-library slice', () => {
  assert.match(map, /if album != nil, onShowNearby != nil[\s\S]*?Button\("显示附近照片"\)/)
  assert.match(map, /Button\("显示附近照片"\) \{\s*onShowNearby\?\(\)\s*dismiss\(\)/)
  assert.match(map, /@State private var pendingNearbySelection: XDriveIOSMapSpatialSelection\?/)
  assert.match(map, /@State private var nearbySelection: XDriveIOSMapSpatialSelection\?/)
  assert.match(map, /sheet\(item: \$globalSelection, onDismiss: \{[\s\S]*?pendingNearbySelection[\s\S]*?nearbySelection = pending/)
  assert.match(map, /pendingNearbySelection = chosen/)
  assert.match(map, /authorizationStatus\(for: \.readWrite\) == \.authorized[\s\S]*?onLibraryCameraChange\?\(nil\)[\s\S]*?clearReturnCamera\(\)[\s\S]*?invalidate\(\)/)
  assert.match(map, /XDriveIOSMapSpatialAlbum\(\s*selection: chosen, album: nil, isNearbyExpansion: true\s*\)/)
  assert.match(map, /Text\(isNearbyExpansion \?[\s\S]*?"附近照片 · 已加载/)
  assert.match(map, /onShowNearby: album == nil \? nil : \{[\s\S]*?phase == \.active[\s\S]*?authorizationStatus\(for: \.readWrite\) == \.authorized[\s\S]*?pendingNearbySelection = chosen/)
  assert.match(map, /globalSelection = nil\s*pendingNearbySelection = nil\s*nearbySelection = nil\s*singleViewer = nil/)
  assert.match(map, /selection == nil && globalSelection == nil &&\s*pendingNearbySelection == nil && nearbySelection == nil && singleViewer == nil/)
})


test('PhotoKit map pages always advance until the real terminal cursor and reject blank page identities', () => {
  const mapPolicy = policy
  assert.match(mapPolicy, /\(start == total \|\| next > start\)/)
  assert.match(mapPolicy, /next - start <= pageSize && rows == next - start/)
  assert.match(mapPolicy, /pins >= 0 && pins <= rows/)
  assert.match(mapPolicy, /!selectedSet\.contains\(""\) && !pageSet\.contains\(""\)/)
  assert.match(mapPolicy, /selectedSet\.isSubset\(of: pageSet\)/)
  // The native map must still verify its snapshot scan before publishing GPS.
  assert.match(map, /while scanned < total \{[\s\S]*?XDriveIOSNativePhotoMapPolicy\.validPage\(/)
  assert.match(map, /scanned = next\.page\.nextOffset/)
  assert.match(map, /guard PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized/)
})


test('native Map Done restores the current Owner Gallery source and rejects a stale one', () => {
  assert.match(dashboard, /@State private var mapReturnGallerySource: XDriveIOSNativeGallerySource\?/)
  assert.match(dashboard, /@State private var mapReturnOwnerScopeKey: String\?/)
  const start = dashboard.indexOf('private func openGallery(')
  const end = dashboard.indexOf('private func openDynamic(', start)
  assert.ok(start >= 0 && end > start)
  const routing = dashboard.slice(start, end)
  assert.match(routing, /if source == \.map \{[\s\S]*?if gallerySource != \.map \{/)
  assert.match(routing, /mapReturnGallerySource = tab == \.gallery && login\.owner != nil[\s\S]*?\? gallerySource : nil/)
  assert.match(routing, /mapReturnOwnerScopeKey = mapReturnGallerySource != nil[\s\S]*?\? ownerScopeKey : nil/)
  assert.match(routing, /else \{\s*mapReturnGallerySource = nil\s*mapReturnOwnerScopeKey = nil/)
  assert.match(routing, /private func closeGalleryMap\(\) \{[\s\S]*?guard gallerySource == \.map, login\.owner != nil else \{ return \}/)
  assert.match(routing, /let fallback = XDriveIOSNativeGallerySource\(rawValue: "unified"\) \?\? \.local/)
  assert.match(routing, /mapReturnOwnerScopeKey == ownerScopeKey[\s\S]*?\? mapReturnGallerySource : nil[\s\S]*?openGallery\(prior \?\? fallback\)/)
  assert.match(dashboard, /onClose: \{ closeGalleryMap\(\) \}/)
  assert.doesNotMatch(dashboard, /onClose: \{ openGallery\(\.local\) \}/)
  assert.match(dashboard, /\.onChange\(of: login\.owner\) \{ owner in[\s\S]*?mapReturnGallerySource = nil\s*mapReturnOwnerScopeKey = nil/)
  assert.match(dashboard, /private func resetNavigation\(\) \{[\s\S]*?mapReturnGallerySource = nil\s*mapReturnOwnerScopeKey = nil/)
  assert.match(dashboard, /\.environment\(\\\.xdriveOpenNativeLocalMap, \{ jump in[\s\S]*?openGallery\(\.map\)\s*localMapJump = jump/)
  assert.match(routing, /if source == \.map \|\| source == \.local \{ localMapJump = nil \}/)
})
