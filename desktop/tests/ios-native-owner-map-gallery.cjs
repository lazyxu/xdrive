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
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const clusterAlbum = read('ios/XDriveIOS/NativeOwnerMapClusterAlbum.swift')

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
  assert.match(wall, /XDriveIOSNativeServerMediaPreview\(\s*item: initial, login: login,\s*loadedItems: viewerLoadedItems,\s*loadedRange: viewerLoadedRange,\s*openedOwner: viewerOpenedOwner,\s*onNavigate: \{ next in/)
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

test('settled Owner map refresh keeps old covers inert until current GPS cells arrive', () => {
  const start = map.indexOf('private func reload() {')
  assert.ok(start >= 0)
  const reload = map.slice(start)
  const pending = reload.slice(0, reload.indexOf('let result = try await reader.mapOverview('))
  assert.match(pending, /verifiedBounds = nil[\s\S]*?requestedBounds = bounds[\s\S]*?busy = true/)
  assert.doesNotMatch(pending, /overview\s*=\s*nil/)
  assert.doesNotMatch(pending, /coverImages\s*=\s*\[:\]/)
  assert.doesNotMatch(pending, /revision\s*=\s*UUID\(\)/)
  assert.match(reload, /coverImages = \[:\][\s\S]*?overview = result[\s\S]*?verifiedBounds = bounds[\s\S]*?revision = UUID\(\)/)
  assert.match(reload, /\} catch \{[\s\S]*?overview = nil[\s\S]*?coverImages = \[:\][\s\S]*?revision = UUID\(\)/)
  assert.match(map, /private var mapMarkersEnabled: Bool \{[\s\S]*?!busy[\s\S]*?let verifiedBounds else \{ return false \}/)
  assert.match(map, /func mapView\(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool\) \{[\s\S]*?markersEnabled = false/)
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

test('cloud map prioritizes all 64 canonical Owner photo clusters without querying aggregates', () => {
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy[\s\S]*?\.prioritizedPhotoCovers\(result\.items\)/)
  assert.match(policy, /static let maximumPhotoCovers = XDriveIOSNativeOwnerMapOverviewPolicy\.maximumCells/)
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
  assert.match(map, /if !compactMap && dynamicTypeSize\.isAccessibilitySize \{\s*Text\("当前 Server Owner/);
  assert.match(map, /if !compactMap && dynamicTypeSize\.isAccessibilitySize \{\s*Text\("选择真实地点后/);
  assert.match(map, /\.alert\("云端照片地图说明", isPresented: \$showingMapHelp\)/);
  assert.match(map, /\.accessibilityIdentifier\("native-ios-owner-map-layout-help"\)/);
  assert.match(map, /Button\("刷新当前视窗"\)/);
  assert.match(map, /Button\(focused \? "显示底部导航" : "专注地图"\)/);
  assert.match(map, /if let overview \{[\s\S]*?if verifiedBounds != nil[\s\S]*?上次验证视窗有/);
  assert.match(map, /\.sheet\(item: \$selected, onDismiss:/);
  assert.doesNotMatch(map, /onChange\(of: compactMap\)|\.id\(compactMap\)/);
});

test('single native Gallery map entry exposes local and Owner cloud sources without dropping saved local map navigation', () => {
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativePhotoMapsScreen\(\s*login: login,\s*localMapScope: \$localMapScope,\s*localMapPageOffset: \$localMapPageOffset,\s*source: \$mapSource,\s*cloudMapCamera: \$cloudMapCamera,\s*localMapCamera: \$localMapCamera,\s*onFocusChange:/)
  assert.match(dashboard, /localMapScope = \.library/);
  assert.match(dashboard, /localMapPageOffset = 0/);
  assert.doesNotMatch(dashboard, /snapshot\.mapScope|snapshot\.mapPageOffset/);
  assert.match(map, /struct XDriveIOSNativePhotoMapsScreen: View \{[\s\S]*?@ObservedObject var login: XDriveIOSNativeOwnerLoginModel[\s\S]*?@Binding var localMapScope: XDriveIOSNativeLocalMapScope[\s\S]*?@Binding var localMapPageOffset: Int/)
  assert.match(map, /Picker\("地图照片来源", selection: \$source\)/)
  assert.match(map, /case \.local:\s*XDriveIOSNativeLocalPhotoMapScreen\(\s*mapScope: \$localMapScope,\s*offset: \$localMapPageOffset/)
  assert.match(map, /case \.cloud:\s*XDriveIOSNativeOwnerPhotoMapScreen\(\s*login: login, onFocusChange: onFocusChange,\s*cameraReturn: cloudMapCamera,\s*onCameraChange: \{ next in[\s\S]*?cloudMapCamera = next/)
  assert.match(map, /\.onChange\(of: source\) \{ _ in onFocusChange\?\(false\) \}/)
  assert.doesNotMatch(dashboard, /case \.map:\s*XDriveIOSNativeLocalPhotoMapScreen\(/)
  assert.doesNotMatch(map, /@State private var localMapScope|@State private var localMapPageOffset/)
})


test('cloud MapKit restores the same-Owner camera and selected map source after Gallery re-entry', () => {
  assert.match(dashboard, /@State private var mapSource: XDriveIOSNativePhotoMapSource = \.local/)
  assert.match(dashboard, /@State private var cloudMapCamera: MKCoordinateRegion\?/)
  assert.match(dashboard, /source: \$mapSource,\s*cloudMapCamera: \$cloudMapCamera/)
  assert.match(map, /@Binding var source: XDriveIOSNativePhotoMapSource/)
  assert.match(map, /@Binding var cloudMapCamera: MKCoordinateRegion\?/)
  assert.doesNotMatch(map, /@State private var source: XDriveIOSNativePhotoMapSource/)
  assert.match(map, /let expectedOwner = login\.owner[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\([\s\S]*?cloudMapCamera = next/)
  assert.match(map, /let initialCamera: MKCoordinateRegion/)
  const make = map.slice(map.indexOf('func makeUIView('), map.indexOf('func updateUIView('))
  assert.match(make, /map\.setRegion\(initialCamera, animated: false\)[\s\S]*?map\.delegate = context\.coordinator/)
  assert.match(map, /initialCamera: cameraReturn \?\? camera/)
  assert.match(map, /onCamera: \{ next in\s*camera = next\s*onCameraChange\?\(next\)/)
  assert.match(map, /\.onAppear \{\s*if let cameraReturn \{ camera = cameraReturn \}[\s\S]*?reload\(\)/)
  assert.match(dashboard, /mapSource = \.local\s*cloudMapCamera = nil/)
  assert.doesNotMatch(dashboard, /UserDefaults\.set\(cloudMapCamera|navigationRouteStore\.save\([^)]*cloudMapCamera/)
})


test('visual MapKit cluster opens only the current exact signed Owner place-ID union', () => {
  assert.match(map, /let facets = members\.compactMap/)
  assert.match(map, /members\.count == facets\.count, facets\.count >= 2/)
  assert.match(map, /onPlaces\(facets\.sorted/)
  assert.match(map, /mapView\.showAnnotations\(cluster\.memberAnnotations, animated: true\)/)
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedCluster\(/)
  assert.match(map, /facets, currentlyVisible: overview\.items/)
  assert.match(policy, /static func acceptsSelectedCluster\(/)
  assert.match(policy, /canOpenPhotoRange\(facet\)/)
  assert.match(policy, /facet\.item_count == signed\.item_count/)
  assert.match(policy, /facet\.coordinate_kind == signed\.coordinate_kind/)
  assert.match(map, /\.sheet\(item: \$selectedCluster, onDismiss:/)
  assert.match(map, /XDriveIOSNativeOwnerMapClusterAlbum\(/)
  assert.match(map, /selected == nil, selectedCluster == nil/)
  assert.match(map, /selectedCluster = nil[\s\S]*?invalidate\(\)/)
})

test('cluster album pages all real places with one verified 48-item Range and Viewer', () => {
  assert.match(clusterAlbum, /struct XDriveIOSNativeOwnerMapClusterAlbum: View/)
  assert.match(clusterAlbum, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selection\.owner\)/)
  assert.match(clusterAlbum, /login\.verifiedAuthorization\(\)/)
  assert.match(clusterAlbum, /reader\.page\(\s*offset: target\.offset, placeID: facet\.id\)/)
  assert.match(clusterAlbum, /fetched\.total_count == facet\.item_count/)
  assert.match(clusterAlbum, /XDriveIOSOwnerClusterCursor\(\s*placeIndex: target\.placeIndex \+ 1, offset: 0\)/)
  assert.match(clusterAlbum, /earlier = history[\s\S]*?next = following[\s\S]*?page = fetched/)
  assert.match(clusterAlbum, /XDriveIOSNativeServerMediaPreview\(/)
  assert.match(clusterAlbum, /loadedItems: page\?\.items \?\? \[\],\s*loadedRange: page,\s*openedOwner: selection\.owner/)
  assert.match(clusterAlbum, /for item in fetched\.items where item\.metadata\.has_thumbnail/)
  assert.match(clusterAlbum, /reader\.thumbnail\(item\)/)
  assert.doesNotMatch(clusterAlbum, /isNetworkAccessAllowed = true|POST|UploadSession|map-region:q:|URLSession\(/)
})


test('single exact Owner map place opens L3 after fresh Owner-scoped Range, not a one-item location sheet', () => {
  assert.match(map, /@State private var singleViewer: XDriveIOSNativeMediaItem\?/)
  assert.match(map, /@State private var singlePage: XDriveIOSNativeMediaRange\?/)
  assert.match(map, /if item\.item_count == 1,[\s\S]*?openSinglePhoto\(item, expected: expected, bounds: verifiedBounds\)/)
  assert.match(map, /private func openSinglePhoto\(/)
  assert.match(map, /login\.verifiedAuthorization\(\)/)
  assert.match(map, /reader\.page\(offset: 0, placeID: facet\.id\)/)
  assert.match(map, /result\.total_count == 1, result\.items\.count == 1/)
  assert.match(map, /if item\.supportsPreview \{[\s\S]*?singlePage = result[\s\S]*?singleOwner = expected[\s\S]*?singleViewer = item/)
  assert.match(map, /\.fullScreenCover\(item: \$singleViewer, onDismiss:/)
  assert.match(map, /XDriveIOSNativeServerMediaPreview\([\s\S]*?loadedItems: singlePage\?\.items \?\? \[\],[\s\S]*?loadedRange: singlePage,[\s\S]*?openedOwner: singleOwner/)
  assert.match(map, /singleTask\?\.cancel\(\)[\s\S]*?singleViewer = nil/)
  assert.match(map, /if selected == nil && selectedCluster == nil && singleViewer == nil/)
  assert.match(map, /XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/)
  assert.match(map, /if case \.response\(let status\) = failure,[\s\S]*?status == 401 \|\| status == 403/)
  assert.match(map, /selected = XDriveIOSOwnerMapChosenPlace\(id: facet\.id\)/)
  assert.doesNotMatch(map, /UploadSession|isNetworkAccessAllowed = true|UserDefaults\.set\(single/)
})


test('native map source uses one navigation menu instead of a permanently stacked picker row', () => {
  const root = map.slice(map.indexOf('struct XDriveIOSNativePhotoMapsScreen: View'),
                         map.indexOf('private final class XDriveIOSOwnerPlaceAnnotation:'))
  assert.match(root, /return Group \{\s*switch source \{/)
  assert.doesNotMatch(root, /return VStack\(spacing: 4\)|\.pickerStyle\(\.segmented\)/)
  assert.match(root, /\.toolbar \{[\s\S]*?if source == \.cloud \{\s*ToolbarItem\(placement: \.navigationBarLeading\) \{\s*Button\("完成"\)/)
  assert.match(root, /ToolbarItem\(placement: \.navigationBarTrailing\) \{\s*Menu \{/)
  assert.match(root, /Menu \{\s*Picker\("地图照片来源", selection: \$source\) \{/)
  assert.match(root, /ForEach\(XDriveIOSNativePhotoMapSource\.allCases, id: \\.self\)/)
  assert.match(root, /Label\(source\.label, systemImage: "square\.stack\.3d\.up"\)/)
  assert.match(root, /\.accessibilityLabel\("地图照片来源：\\\(source\.label\)"\)/)
  assert.match(root, /\.accessibilityIdentifier\("native-ios-map-source-selector"\)/)
  assert.match(root, /case \.local:\s*XDriveIOSNativeLocalPhotoMapScreen\([\s\S]*?mapScope: \$localMapScope,[\s\S]*?offset: \$localMapPageOffset/)
  assert.match(root, /case \.cloud:\s*XDriveIOSNativeOwnerPhotoMapScreen\([\s\S]*?cameraReturn: cloudMapCamera/)
  assert.match(root, /guard source == \.cloud, let expectedOwner,[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\([\s\S]*?cloudMapCamera = next/)
  assert.match(root, /\.onChange\(of: source\) \{ _ in onFocusChange\?\(false\) \}/)
})


test('cloud Owner map album advances on visible sentinel without waiting for every cover', () => {
  assert.match(clusterAlbum, /\.onAppear \{\s*scrollFootVisible = true\s*advanceIfVisible\(\)/)
  assert.match(clusterAlbum, /\.onChange\(of: busy\) \{ isBusy in[\s\S]*?if !isBusy \{ advanceIfVisible\(\) \}/)
  assert.match(clusterAlbum, /private func advanceIfVisible\(\)[\s\S]*?guard scrollFootVisible, activeOwner, !busy,[\s\S]*?viewing == nil, page != nil, error == nil, let next/)
  assert.match(clusterAlbum, /coverLoading = true[\s\S]*?defer \{[\s\S]*?coverLoading = false[\s\S]*?advanceIfVisible\(\)/)
  assert.match(clusterAlbum, /load\(next, history: earlier \+ \[cursor\], autoAdvance: true\)/)
  assert.doesNotMatch(clusterAlbum, /DragGesture\(minimumDistance: 12\)/)
  assert.doesNotMatch(clusterAlbum, /Button\("查看上一批照片"\)|Button\("继续浏览下一批照片"\)/)
})


test('Owner MapKit single-pin tap admits only the current signed facet, not an obsolete position', () => {
  const start = map.indexOf('onPlace: { item in')
  const end = map.indexOf('onPlaces: { facets in', start)
  assert.ok(start >= 0 && end > start)
  const admission = map.slice(start, end)
  assert.match(admission, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedFacet\(\s*item,\s*currentlyVisible: overview\.items/)
  assert.match(policy, /static func acceptsSelectedFacet\(/)
  assert.match(policy, /canOpenPhotoRange\(chosen\)/)
  assert.match(policy, /canOpenPhotoRange\(signed\)/)
  for (const field of ['item_count', 'coordinate_kind', 'latitude', 'longitude', 'sample_latitude', 'sample_longitude']) {
    assert.match(policy, new RegExp('chosen\\.' + field + ' == signed\\.' + field))
  }
})

test('Owner MapKit cover suppresses stale place counts before issuing a thumbnail', () => {
  const start = map.indexOf('private func loadCurrentOwnerCovers(')
  const end = map.indexOf('private func revokeCameraAuthorization()', start)
  assert.ok(start >= 0 && end > start)
  const cover = map.slice(start, end)
  assert.match(policy, /static func acceptsCurrentCoverPage\(/)
  assert.match(policy, /canOpenPhotoRange\(facet\)/)
  assert.match(policy, /returnedCount == facet\.item_count/)
  assert.match(cover, /reader\.page\(offset: 0, placeID: facet\.id\)[\s\S]*?acceptsCurrentCoverPage\(\s*facet,\s*returnedCount: page\.total_count,\s*hasPhoto: !page\.items\.isEmpty\s*\)[\s\S]*?let first = page\.items\.first[\s\S]*?reader\.thumbnail\(first\)/)
  assert.match(cover, /epoch == ticket[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
})
