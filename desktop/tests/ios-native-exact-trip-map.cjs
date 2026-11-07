'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const api = read('internal/api/media_trip_exact.go')
const mapAPI = read('internal/api/media_trip_exact_map.go')
const routes = read('internal/api/router.go')
const manifest = read('internal/api/router_contract_test.go')
const reader = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const map = read('ios/XDriveIOS/NativeExactTripMap.swift')
const wall = read('ios/XDriveIOS/NativeExactTripGallery.swift')
const shared = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const camera = read('ios/XDriveIOS/NativeExactTripMapCameraPolicy.swift')
const cameraChecks = read('ios/tests/NativeExactTripMapCameraPolicyChecks.swift')
const workflow = read('.github/workflows/ios-unsigned-ipa.yml')

test('trip-only MapKit route and canonical place ranges remain under protected Owner API', () => {
  assert.match(routes, /authed\.GET\("\/media\/trips\/:tripID\/map", s\.listMediaExactTripMap\)/)
  assert.match(routes, /authed\.GET\("\/media\/trips\/:tripID\/items", s\.listMediaExactTripItems\)/)
  assert.match(manifest, /GET", path: "\/api\/v1\/media\/trips\/:tripID\/map", suite: "media"/)
  assert.match(mapAPI, /s\.resolveMediaExactTrip\([\s\S]*?c\.Param\("tripID"\)/)
  assert.match(mapAPI, /queryMediaExactTripSegments\(ctx, s\.DB, ownerID, zone\)/)
  assert.doesNotMatch(mapAPI, /queryMediaPlacesMapOverview\(|mediaPlacesBaseQuery\(/)
  assert.doesNotMatch(mapAPI, /WKWebView|Baidu|UploadSession|GPSUpload/)
})

test('bounded trip map count and each location count use the same exact v2 SQL predicate', () => {
  assert.match(mapAPI, /const mediaExactTripMapMaxPlaces = 64/)
  assert.match(mapAPI, /s\.mediaExactTripQuery\(ctx, ownerID, segment, zone\)/)
  assert.match(mapAPI, /Distinct\("xd_media_metadata\.node_id"\)\.Count\(&expected\)/)
  assert.match(mapAPI, /COUNT\(DISTINCT xd_media_metadata\.node_id\) AS item_count/)
  assert.match(mapAPI, /Group\(latCell \+ ", " \+ lonCell\)/)
  assert.match(mapAPI, /Limit\(mediaExactTripMapMaxPlaces \+ 1\)/)
  assert.match(mapAPI, /len\(rows\) > mediaExactTripMapMaxPlaces/)
  assert.match(mapAPI, /expected != overview\.TotalPhotoCount \|\| expected == 0/)
  assert.match(mapAPI, /ARRAY_AGG\(xd_media_metadata\.latitude ORDER BY xd_media_metadata\.node_id/)
  assert.match(mapAPI, /ARRAY_AGG\(xd_media_metadata\.longitude ORDER BY xd_media_metadata\.node_id/)
  assert.match(mapAPI, /CoordinateKind:\s+"grid_cell_center"/)
  assert.match(mapAPI, /Cache-Control", "no-store"/)
  assert.doesNotMatch(mapAPI, /SELECT \*.*100000|LIMIT 64.*OFFSET|whole.owner\/map/)
})

test('tapped place is intersected with verified trip, never resolved as ordinary global place', () => {
  const items = api.slice(api.indexOf('func (s *Server) listMediaExactTripItems('))
  assert.match(items, /s\.resolveMediaExactTrip\(/)
  assert.match(items, /s\.mediaExactTripQuery\(/)
  assert.match(items, /c\.Request\.URL\.Query\(\)\["place"\]/)
  assert.match(items, /len\(values\) != 1/)
  assert.match(items, /values\[0\] != mediaPlaceKey\(cell\)/)
  assert.match(items, /mediaExactTripPlaceCellQuery\(query, cell\)/)
  assert.match(items, /Distinct\("xd_media_metadata\.node_id"\)\.Count\(&count\)/)
  assert.match(items, /s\.materializeMediaItems\(/)
  assert.match(mapAPI, /CASE WHEN xd_media_metadata\.longitude = 180 THEN -180/)
})

test('existing TLS Owner Reader requests trip-only map and trip AND location page', () => {
  const start = reader.indexOf('func exactTripMap(')
  const end = reader.indexOf('/// Bounded WGS84 Owner map overview;', start)
  const snippet = reader.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(snippet, /endpoint\("\/api\/v1\/media\/trips\/\\\(trip\.id\)\/map"/)
  assert.match(snippet, /result\.total_photo_count == trip\.item_count/)
  assert.match(snippet, /XDriveIOSNativeOwnerMapOverviewPolicy\.valid\(result\)/)
  assert.match(snippet, /XDriveIOSNativeOwnerMapSelectionPolicy\.canOpenPhotoRange/)
  assert.match(snippet, /func exactTripPage\(/)
  assert.match(snippet, /place: XDriveIOSNativeOwnerMapFacet\? = nil/)
  assert.match(snippet, /let expectedTotal = place\?\.item_count \?\? trip\.item_count/)
  assert.match(snippet, /URLQueryItem\(name: "place", value: place\.id\)/)
  assert.match(snippet, /itemIDs: page\.items\.map\(\\\.id\), expectedTotal: expectedTotal/)
  assert.doesNotMatch(snippet, /reader\.page\(|media\/memories|URLSession\(|\/"\/api\/v1\/media\/places\/overview"/)
})

test('native trip MapKit uses only that Owner map and never the whole Owner overview', () => {
  assert.match(shared, /struct XDriveIOSOwnerMapSurface: UIViewRepresentable/)
  assert.match(map, /XDriveIOSOwnerMapSurface\(/)
  assert.match(map, /let result = try await reader\.exactTripMap\(/)
  assert.match(map, /overview = result/)
  assert.match(map, /result\.total_photo_count == trip\.item_count/)
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedFacet\(/)
  assert.match(map, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedCluster\(/)
  assert.match(map, /XDriveIOSNativePhotoOwnerScope\.matches\(\s*auth\.owner, expectedOwner\)/)
  assert.match(map, /onCameraWillChange: \{[\s\S]*?moving = true/)
  assert.match(map, /onCamera: \{ next in[\s\S]*?moving = false/)
  assert.match(map, /\.onChange\(of: login\.owner\)/)
  assert.match(map, /\.onChange\(of: phase\)/)
  assert.match(map, /native-ios-exact-trip-map-count/)
  assert.doesNotMatch(map, /reader\.mapOverview\(|endpoint\("\/api\/v1\/media\/places\/overview"|WKWebView|UserDefaults|UploadSession/)
})

test('trip photo MapKit pin opens a place-narrowed trip wall with exact Count and Viewer', () => {
  assert.match(wall, /NavigationLink \{\s*XDriveIOSNativeExactTripMapScreen\(/)
  assert.match(wall, /native-ios-trip-show-exact-map/)
  assert.match(wall, /var place: XDriveIOSNativeOwnerMapFacet\? = nil/)
  assert.match(wall, /private var expectedCount: Int \{ place\?\.item_count \?\? trip\.item_count \}/)
  assert.match(wall, /verifiedRange\.total_count == expectedCount/)
  assert.match(wall, /trip, offset: previous\.offset, timeZone: timeZone, place: place/)
  assert.match(wall, /trip, offset: origin\.offset, timeZone: timeZone, place: place/)
  assert.match(map, /XDriveIOSNativeExactTripWall\([\s\S]*?trip: trip, timeZone: timeZone, place: facet/)
  assert.match(map, /\.presentationDetents\(\[\.medium, \.large\]\)/)
  assert.match(map, /\.navigationTitle\("旅行中的地点"\)/)
})

test('trip MapKit covers require exact place page, three concurrent reads and 401 revocation', () => {
  assert.match(map, /reader\.exactTripPage\([\s\S]*?place: facet\)/)
  assert.match(map, /acceptsCoverPage\([\s\S]*?rangeTotal: page\.total_count, offset: page\.offset/)
  assert.match(map, /reader\.thumbnail\(first\)/)
  assert.match(map, /let maximumConcurrentCovers = 3/)
  assert.match(map, /withTaskGroup\(of: XDriveIOSExactTripCoverResult\.self\)/)
  assert.match(map, /case \.revoked:[\s\S]*?group\.cancelAll\(\)[\s\S]*?invalidate\(\)/)
  assert.match(map, /epoch == ticket, activeOwner/)
  assert.match(map, /selectedPlace == nil, selectedCluster == nil/)
})

test('bounded dateline camera has executable Foundation policy in IPA workflow', () => {
  assert.match(camera, /points\.count <= XDriveIOSNativeOwnerMapOverviewPolicy\.maximumCells/)
  assert.match(camera, /let wrappedSpan = shiftedMax - shiftedMin/)
  assert.match(camera, /let wrap = wrappedSpan < unwrappedSpan/)
  assert.match(camera, /longitudeSpan: min\(359, max\(0\.06, smallestSpan \* 1\.25\)\)/)
  assert.match(cameraChecks, /Point\(latitude: 10, longitude: 179\.8\)/)
  assert.match(cameraChecks, /Point\(latitude: 10, longitude: -179\.8\)/)
  assert.match(workflow, /ios\/tests\/NativeExactTripMapCameraPolicyChecks\.swift/)
  assert.match(workflow, /node --test desktop\/tests\/ios-native-exact-trip-map\.cjs/)
})

test('trip map fails closed on 64-place overflow and distinguishes stale trip from Owner revocation', () => {
  const response = map.slice(map.indexOf('catch let failure as XDriveIOSNativeMediaReadFailure'));
  assert.match(response, /case 401, 403:[\s\S]*?invalidate\(\)/);
  assert.match(response, /case 404:[\s\S]*?旅行已变化/);
  assert.match(response, /case 409:[\s\S]*?最多 64 个地点/);
  assert.match(response, /self\.error = "当前旅行地点过多或成员正在变化/);
  assert.doesNotMatch(response, /reader\.mapOverview\(|reader\.page\(offset:|allPhotos\(/);
});

test('trip map keeps camera on sheet dismissal and refresh while revoking stale pins', () => {
  assert.match(map, /private func reload\(preservingCamera: Bool = false\)/)
  const closures = [...map.matchAll(/\.sheet\(item: \$selected(?:Place|Cluster), onDismiss: \{/g)]
  assert.equal(closures.length, 2)
  assert.match(map, /if activeOwner \{ reload\(preservingCamera: true\) \} else \{ invalidate\(\) \}/)
  assert.match(map, /Button\("刷新"\) \{ reload\(preservingCamera: true\) \}/)
  assert.match(map, /Button\("重试旅行地图"\) \{ reload\(preservingCamera: true\) \}/)
  assert.match(map, /private func reload\([\s\S]*?invalidate\(\)[\s\S]*?reader\.exactTripMap\(/)
  assert.match(map, /if !preservingCamera \{[\s\S]*?fittedCamera = MKCoordinateRegion\([\s\S]*?fitRequestID = UUID\(\)/)
  assert.match(map, /coverImages = \[:\][\s\S]*?selectedPlace = nil[\s\S]*?selectedCluster = nil/)
});
