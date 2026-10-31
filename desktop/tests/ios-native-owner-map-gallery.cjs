'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const map = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const policy = read('ios/XDriveIOS/NativeOwnerMapSelectionPolicy.swift')
const reader = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const wall = read('ios/XDriveIOS/NativeServerMediaGallery.swift')

test('cloud Gallery navigates to WGS84 native MapKit under fresh verified Owner', () => {
  assert.match(wall, /NavigationLink \{\s*XDriveIOSNativeOwnerPhotoMapScreen\(/)
  assert.match(wall, /native-ios-server-gallery-map/)
  assert.match(map, /MKMapView\(\)/)
  assert.match(map, /login\.verifiedAuthorization\(\)/)
  assert.match(map, /reader\.mapOverview\(bounds: bounds, detail: true\)/)
  assert.match(map, /self\.error = "当前 Owner 地图范围或权限已失效/)
  assert.match(map, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/)
  assert.match(map, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(map, /map\.removeAnnotations\(map\.annotations\.filter/)
  assert.match(map, /map\.addAnnotations\(overview\.items\.prefix\(64\)/)
  assert.doesNotMatch(map, /WKWebView|URLSession|localStorage|UserDefaults|BaiduMap|UploadSession/)
})
test('only real canonical GPS places in the currently trusted map page open a fresh filtered cloud Range and Viewer', () => {
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy\.canOpenPhotoRange\(point\.facet\)/)
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedPlace\(/)
  assert.match(map, /overview\.items\.contains\(where: \{/)
  assert.match(map, /XDriveIOSNativeServerMediaWall\(\s*login: login, album: nil, placeID: place\.id\)/)
  assert.match(wall, /XDriveIOSNativeServerMediaPreview\(item: \$0, login: login\)/)
  assert.match(wall, /pagePlaceID == placeID/)
  assert.match(wall, /self\?\.pagePlaceID = placeID/)
  assert.match(wall, /model\.load\(login: login, albumID: album\?\.id, placeID: placeID/)
  assert.match(wall, /guard placeID == nil \|\| \(/)
  assert.match(reader, /func page\(offset: Int, albumID: String\? = nil,\s*placeID: String\? = nil/)
  assert.match(reader, /XDriveIOSNativeOwnerMapSelectionPolicy\.canonicalPlaceID\(placeID!\)/)
  assert.match(reader, /URLQueryItem\(name: "place", value: placeID\)/)
  assert.match(reader, /URLQueryItem\(name: "has_location", value: "true"\)/)
  assert.match(reader, /URLQueryItem\(name: "range", value: "true"\)/)
  assert.match(reader, /URLQueryItem\(name: "limit", value: String\(Self\.pageSize\)\)/)
  assert.match(policy, /facet\.coordinate_kind != "map_region_sample"/)
  assert.match(map, /mapView\.setRegion\(MKCoordinateRegion\(/)
})

test('MapKit gesture revokes previous Owner camera before repaint but keeps inert photo markers', () => {
  assert.match(map, /func mapView\(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool\)/)
  assert.match(map, /onCameraWillChange\(\)/)
  assert.match(map, /onCameraWillChange: \{ revokeCameraAuthorization\(\) \}/)
  assert.match(map, /private func revokeCameraAuthorization\(\) \{[\s\S]*?epoch = UUID\(\)[\s\S]*?task\?\.cancel\(\)[\s\S]*?verifiedBounds = nil/)
  assert.match(map, /let overview, let verifiedBounds,[\s\S]*?isSameViewport\([\s\S]*?currentlyVisibleIDs/)
  assert.match(map, /isSameViewport\(\s*bounds, current: currentBounds\(\)\)/)
  assert.match(map, /verifiedBounds = bounds/)
  assert.match(map, /上次验证视窗有/)
  assert.match(policy, /return authorized == current/)
})

test('native map first world camera setup never invalidates before its initial Owner load', () => {
  const make = map.slice(map.indexOf('func makeUIView('), map.indexOf('func updateUIView('))
  assert.ok(make.indexOf('map.setRegion(') > 0)
  assert.ok(make.indexOf('map.delegate = context.coordinator') > make.indexOf('map.setRegion('))
})

test('MapKit refreshes settled current WGS84 camera with one fenced Owner request', () => {
  assert.match(map, /@State private var cameraSettleTask: Task<Void, Never>\?/)
  assert.match(map, /@State private var requestedBounds: XDriveIOSNativeOwnerMapBounds\?/)
  assert.match(map, /onCameraWillChange: \{ revokeCameraAuthorization\(\) \}/)
  assert.match(map, /onCamera: \{ next in[\s\S]*?verifiedBounds \?\? requestedBounds[\s\S]*?scheduleCameraRefresh\(\)/)
  assert.match(map, /private func scheduleCameraRefresh\(\) \{[\s\S]*?cameraSettleTask\?\.cancel\(\)[\s\S]*?Task\.sleep\(nanoseconds: 500_000_000\)[\s\S]*?epoch == ticket[\s\S]*?reload\(\)/)
  assert.match(map, /private func revokeCameraAuthorization\(\) \{[\s\S]*?cameraGesturePending = true[\s\S]*?requestedBounds = nil/)
  assert.match(map, /private func invalidate\(\) \{[\s\S]*?cameraSettleTask\?\.cancel\(\)/)
  assert.match(map, /private func reload\(\) \{[\s\S]*?requestedBounds = bounds[\s\S]*?reader\.mapOverview\(bounds: bounds, detail: true\)/)
  assert.doesNotMatch(map, /BMap\.|URLSession\(|UserDefaults\.|UploadSession/)
})

test('Owner cloud MapKit uses native 64px photo covers from current place-filtered signed Reader only', () => {
  assert.match(map, /class XDriveIOSOwnerMapPhotoCover: MKAnnotationView/)
  assert.match(map, /imageView\.frame = CGRect\(x: 2, y: 2, width: 64, height: 64\)/)
  assert.match(map, /map\.register\(XDriveIOSOwnerMapPhotoCover\.self,/)
  assert.match(map, /coverImages: \[String: UIImage\]/)
  assert.match(map, /context\.coordinator\.refreshVisibleCovers\(map\)/)
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy[\s\S]*?\.prioritizedPhotoCovers\(result\.items\)/)
  assert.match(policy, /\.prefix\(maximumPhotoCovers\)/)
  assert.match(map, /reader\.page\(offset: 0, placeID: facet\.id\)/)
  assert.match(map, /reader\.thumbnail\(first\)/)
  assert.match(map, /coverImages\[facet\.id\] = cover/)
  assert.match(map, /epoch == ticket[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(map, /coverTask\?\.cancel\(\)/)
  assert.match(map, /coverImages = \[:\]/)
  assert.doesNotMatch(map, /PHPhotoLibrary|BaiduMap|URLSession\(|UserDefaults\.|UploadSession/)
})

test('cloud photo cover revalidates Owner after Range before thumbnail and stops on revocation', () => {
  assert.match(map, /reader\.page\(offset: 0, placeID: facet\.id\)[\s\S]*?Task\.checkCancellation\(\)[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)[\s\S]*?reader\.thumbnail\(first\)/)
  assert.match(map, /catch let failure as XDriveIOSNativeMediaReadFailure \{[\s\S]*?case \.response\(let status\)[\s\S]*?status == 401 \|\| status == 403[\s\S]*?invalidate\(\)/)
})

test('current exact Owner map place opens one draggable native Gallery album sheet, not a fixed photo strip', () => {
  assert.match(map, /\.sheet\(item: \$selected, onDismiss:/)
  assert.match(map, /XDriveIOSNativeServerMediaWall\([\s\S]*?placeID: place\.id\)[\s\S]*?\.presentationDetents\(\[\.medium, \.large\]\)/)
  assert.match(map, /\.presentationDragIndicator\(\.visible\)/)
  assert.doesNotMatch(map, /fixedBottomPhotoStrip|WKWebView/)
})

test('previous Owner map photo pins are inert for VoiceOver and touch until current camera authorization', () => {
  assert.match(map, /let markersEnabled: Bool/)
  assert.match(map, /private var mapMarkersEnabled: Bool \{[\s\S]*?let verifiedBounds else \{ return false \}/)
  assert.match(map, /markersEnabled: mapMarkersEnabled/)
  assert.match(map, /context\.coordinator\.markersEnabled = markersEnabled/)
  assert.match(map, /isEnabled = enabled/)
  assert.match(map, /isAccessibilityElement = enabled/)
  assert.match(map, /accessibilityTraits = enabled \? \.button : \[\]/)
  assert.match(map, /accessibilityLabel = enabled \? [\s\S]*? : nil/)
  assert.match(map, /func mapView\(_ mapView: MKMapView, didSelect view: MKAnnotationView\) \{[\s\S]*?guard markersEnabled else \{ return \}/)
  assert.match(map, /verifiedBounds = nil/)
  assert.match(map, /verifiedBounds = bounds/)
})

test('MapKit invalidates cover selection synchronously before any SwiftUI render on gesture start', () => {
  const start = map.indexOf('func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool)')
  const end = map.indexOf('func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool)', start)
  assert.ok(start > 0 && end > start)
  const gesture = map.slice(start, end)
  assert.match(gesture, /markersEnabled = false[\s\S]*?refreshVisibleCovers\(mapView\)[\s\S]*?onCameraWillChange\(\)/)
})

test('cloud MapKit cluster cover prefers an available verified member thumbnail over a missing first member', () => {
  const refreshed = map.indexOf('func refreshVisibleCovers(_ map: MKMapView)')
  const viewed = map.indexOf('func mapView(_ mapView: MKMapView,', refreshed)
  assert.ok(refreshed > 0 && viewed > refreshed)
  const relevant = map.slice(refreshed, map.indexOf('func mapView(_ mapView: MKMapView, didSelect view:', viewed))
  assert.equal((relevant.match(/members\.compactMap \{ coverImages\[\$0\.facet\.id\] \}\.first/g) || []).length, 2)
  assert.doesNotMatch(relevant, /members\.first\.flatMap/)
  assert.match(map, /for facet in XDriveIOSNativeOwnerMapSelectionPolicy[\s\S]*?\.prioritizedPhotoCovers\(result\.items\)/)
  assert.match(policy, /\.prefix\(maximumPhotoCovers\)/)
})

test('cloud map prioritizes largest canonical Owner photo clusters within the same 12-cover request cap', () => {
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy[\s\S]*?\.prioritizedPhotoCovers\(result\.items\)/)
  assert.match(policy, /static let maximumPhotoCovers = 12/)
  assert.match(policy, /guard places\.count <= XDriveIOSNativeOwnerMapOverviewPolicy\.maximumCells/)
  assert.match(policy, /guard Set\(ids\)\.count == ids\.count/)
  assert.match(policy, /places\.filter \{ canOpenPhotoRange\(\$0\) \}/)
  assert.match(policy, /if \$0\.item_count != \$1\.item_count \{[\s\S]*?return \$0\.item_count > \$1\.item_count/)
  assert.match(policy, /return \$0\.id < \$1\.id/)
  assert.match(policy, /\.prefix\(maximumPhotoCovers\)/)
  assert.doesNotMatch(policy, /cover_node_id/)
})

test('Owner cloud map thumbnail distinguishes 401/403 revocation from a bad derivative', () => {
  const start = reader.indexOf('func thumbnail(_ item: XDriveIOSNativeMediaItem)')
  const end = reader.indexOf('/// A short-lived, same-origin preview ticket', start)
  assert.ok(start > 0 && end > start)
  const thumbnail = reader.slice(start, end)
  assert.match(thumbnail, /guard let http = response as\? HTTPURLResponse else \{[\s\S]*?XDriveIOSNativeMediaReadFailure\.malformed/)
  assert.match(thumbnail, /guard http\.statusCode == 200 else \{[\s\S]*?throw XDriveIOSNativeMediaReadFailure\.response\(http\.statusCode\)/)
  assert.match(thumbnail, /guard bytes\.count <= 2 \* 1_048_576,[\s\S]*?Content-Type[\s\S]*?XDriveIOSNativeMediaReadFailure\.malformed/)
  assert.match(map, /catch let failure as XDriveIOSNativeMediaReadFailure \{[\s\S]*?case \.response\(let status\)[\s\S]*?status == 401 \|\| status == 403[\s\S]*?invalidate\(\)/)
})

test('short landscape Owner map retains verified camera, feedback, Sheet and accessible help', () => {
  assert.match(map, /@Environment\(\\\.dynamicTypeSize\) private var dynamicTypeSize/);
  assert.match(map, /GeometryReader \{ viewport in[\s\S]*?XDriveIOSNativePhotoMapPolicy\.compactViewport\(/);
  assert.match(map, /accessibilityText: dynamicTypeSize\.isAccessibilitySize/);
  assert.match(map, /VStack\(spacing: compactMap \? 4 : 8\)/);
  assert.match(map, /if !compactMap \{\s*Text\("当前 Server Owner/);
  assert.match(map, /if !compactMap \{\s*Text\("选择真实地点后/);
  assert.match(map, /\.alert\("云端照片地图说明", isPresented: \$showingMapHelp\)/);
  assert.match(map, /\.accessibilityIdentifier\("native-ios-owner-map-layout-help"\)/);
  assert.match(map, /Button\("刷新当前视窗"\)/);
  assert.match(map, /Button\(focused \? "显示底部导航" : "专注地图"\)/);
  assert.match(map, /if let overview \{[\s\S]*?if verifiedBounds != nil[\s\S]*?上次验证视窗有/);
  assert.match(map, /\.sheet\(item: \$selected, onDismiss:/);
  assert.doesNotMatch(map, /onChange\(of: compactMap\)|\.id\(compactMap\)/);
});
