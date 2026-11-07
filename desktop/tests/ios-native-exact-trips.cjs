'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
const policy = read('ios/XDriveIOS/NativeExactTripPolicy.swift')
const reader = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const server = read('internal/api/media_trip_exact.go')
const route = read('internal/api/router.go')
const workflow = read('.github/workflows/ios-unsigned-ipa.yml')
const ui = read('ios/XDriveIOS/NativeExactTripGallery.swift')
const map = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')

test('native exact trip recognizes v2 only, bounds 100 trips and verifies 48-page Owner count', () => {
  assert.match(policy, /static let maximumTrips = 100/)
  assert.match(policy, /static let maximumMediaCount = 10_000_000/)
  assert.match(policy, /static let pageSize = 48/)
  assert.match(policy, /parts\.count == 5, parts\[0\] == "trip", parts\[1\] == "v2"/)
  assert.match(policy, /validDate\(String\(parts\[2\]\)\)/)
  assert.match(policy, /parts\[4\]\.utf8\.allSatisfy/)
  assert.match(policy, /trip\.start_date == String\(parts\[2\]\)/)
  assert.match(policy, /trip\.end_date == String\(parts\[3\]\)/)
  assert.match(policy, /responseTotal == expectedTotal/)
  assert.match(policy, /requestedOffset % pageSize == 0/)
  assert.match(policy, /requestedOffset < responseTotal/)
  assert.match(policy, /responseOffset == requestedOffset/)
  assert.match(policy, /responseLimit == pageSize/)
  assert.match(policy, /responseOffset \+ itemIDs\.count == responseTotal \|\|/)
  assert.match(policy, /Set\(itemIDs\)\.count == itemIDs\.count/)
  assert.doesNotMatch(policy, /trip:v1|@unchecked Sendable|UserDefaults|URLSession|WKWebView/)
})

test('native same-Owner Reader uses existing HTTPS session for trip list and exact Range', () => {
  const from = reader.indexOf('func exactTrips(timeZone:')
  const until = reader.indexOf('/// Bounded WGS84 Owner map overview;', from)
  assert.ok(from > 0 && until > from)
  const trips = reader.slice(from, until)
  assert.match(trips, /XDriveIOSNativeExactTripPolicy\.validTimeZone\(timeZone\)/)
  assert.match(trips, /endpoint\("\/api\/v1\/media\/trips"/)
  assert.match(trips, /read\(url, maximum: 128 \* 1_024\)/)
  assert.match(trips, /XDriveIOSNativeExactTripPolicy\.validTrips\(trips\)/)
  assert.match(trips, /func exactTripPage\(/)
  assert.match(trips, /endpoint\("\/api\/v1\/media\/trips\/\\\(trip\.id\)\/items"/)
  assert.match(trips, /URLQueryItem\(name: "range", value: "true"\)/)
  assert.match(trips, /URLQueryItem\(name: "limit", value: String\(Self\.pageSize\)\)/)
  assert.match(trips, /JSONDecoder\(\)\.decode\(XDriveIOSNativeMediaRange\.self/)
  assert.match(trips, /XDriveIOSNativeExactTripPolicy\.validWindow\(/)
  assert.match(trips, /itemIDs: page\.items\.map\(\\\.id\), expectedTotal: trip\.item_count/)
  assert.match(reader, /private func session\(\) -> URLSession \{[\s\S]*?XDriveIOSNativeMediaRejectRedirect\(\)/)
  assert.match(reader, /private func endpoint\(/)
  assert.match(reader, /let \(stream, response\) = try await client\.bytes\(for: request\)/)
  assert.doesNotMatch(trips, /media\/memories|UserDefaults|UploadSession|\.post\(|URLSession\(/)
})

test('Server v2 trip list, current Owner range and route use one exact GPS-cell selection', () => {
  assert.match(route, /authed\.GET\("\/media\/trips", s\.listMediaExactTrips\)/)
  assert.match(route, /authed\.GET\("\/media\/trips\/:tripID\/items", s\.listMediaExactTripItems\)/)
  assert.match(server, /queryMediaExactTripSegments\(/)
  assert.match(server, /s\.mediaItemsBaseQuery\(ctx, ownerID, mediaQueryOptions\{\}, ""\)/)
  assert.match(server, /FLOOR\(xd_media_metadata\.latitude \* 5\)::bigint = \?/)
  assert.match(server, /CASE WHEN xd_media_metadata\.longitude = 180 THEN -180/)
  assert.match(server, /mediaMemoryLocalMidnight\(value, location\)/)
  assert.match(server, /mediaMemoryLocalMidnight\(value\.AddDate\(0, 0, 1\), location\)/)
  assert.match(server, /if chosen == nil \{[\s\S]*?http\.StatusNotFound/)
  assert.match(server, /Distinct\("xd_media_metadata\.node_id"\)\.Count\(&count\)/)
  assert.match(server, /s\.materializeMediaItems\(/)
  assert.doesNotMatch(server, /mediaMemoryItemsBaseQuery\(|baidu.*Token|UploadSession|GPSUpload/)
})

test('iOS IPA workflow compiles executable policy and runs current source contract', () => {
  assert.match(workflow, /ios\/XDriveIOS\/NativeExactTripPolicy\.swift/)
  assert.match(workflow, /ios\/tests\/NativeExactTripPolicyChecks\.swift/)
  assert.match(workflow, /node --test desktop\/tests\/ios-native-exact-trips\.cjs/)
})

test('native Owner MapKit opens current verified Trips, not v1 Memory date ranges', () => {
  assert.match(map, /NavigationLink \{\s*XDriveIOSNativeExactTripsScreen\(login: login\)/)
  assert.match(map, /native-ios-owner-map-exact-trips/)
  assert.match(ui, /let reader = XDriveIOSNativeMediaGalleryReader\(/)
  assert.match(ui, /try await reader\.exactTrips\(timeZone: timeZone\)/)
  assert.match(ui, /XDriveIOSNativePhotoOwnerScope\.matches\(\s*auth\.owner, expected\)/)
  assert.match(ui, /XDriveIOSNativeExactTripWall\(/)
  assert.match(ui, /onChange\(of: login\.owner\)/)
  assert.match(ui, /loadTask\?\.cancel\(\)/)
  assert.doesNotMatch(ui, /trip:v1|media\/memories|WKWebView|UserDefaults|UploadSession/)
})

test('native exact-trip wall retains only two 48-item verified Range windows', () => {
  assert.match(ui, /@State private var page: XDriveIOSNativeMediaRange\?/)
  assert.match(ui, /@State private var previousPage: XDriveIOSNativeMediaRange\?/)
  assert.match(ui, /XDriveIOSNativePhotoWallGrid\(density: density\)/)
  assert.match(ui, /let reread = try await reader\.exactTripPage\(/)
  assert.match(ui, /reread\.sameVisibleSnapshot\(as: departing\)/)
  assert.match(ui, /let next = try await reader\.exactTripPage\(/)
  assert.match(ui, /!Set\(departing\.items\.map\(\\\.id\)\)\.isDisjoint/)
  assert.match(ui, /previousPage = autoAdvance \? departing : nil/)
  assert.match(ui, /page = next/)
  assert.match(ui, /scrollFootVisible = true[\s\S]*?advanceIfVisible\(\)/)
  assert.match(ui, /epoch = UUID\(\)[\s\S]*?task\?\.cancel\(\)/)
  assert.doesNotMatch(ui, /\.prefix\(100_000\)|\.allPhotos\(|fetchAll\(|loadEntireTrip/)
})

test('trip Viewer and thumbnails require live Owner, exact snapshot and restored anchor', () => {
  assert.match(ui, /private func openVerified\(/)
  assert.match(ui, /item\.supportsPreview/)
  assert.match(ui, /try await login\.verifiedAuthorization\(\)/)
  assert.match(ui, /reread\.sameVisibleSnapshot\(as: origin\)/)
  assert.match(ui, /XDriveIOSNativeServerMediaPreview\(/)
  assert.match(ui, /loadedRange: viewerPage/)
  assert.match(ui, /openedOwner: expectedOwner/)
  assert.match(ui, /viewerReturnID = item\.id/)
  assert.match(ui, /page\?\.items\.contains\(where: \{ \$0\.id == id \}\) == true/)
  assert.match(ui, /scroll\.scrollTo\(id, anchor: \.center\)/)
  assert.match(ui, /try await reader\.thumbnail\(item\)/)
  assert.match(ui, /\.task\(id: /)
  assert.match(ui, /item\.node\.revision/)
  assert.match(ui, /\.onDisappear \{ image = nil \}/)
})

test('trip Viewer crosses adjacent Owner ranges only after re-reading current exact trip snapshot', () => {
  const opening = ui.slice(ui.indexOf('.fullScreenCover(item: $selected, onDismiss:'));
  const crossing = opening.slice(opening.indexOf('onCrossRange: { previous, anchor, direction in'));
  const approved = crossing.slice(crossing.indexOf('onCrossedRange: { next, verifiedRange in'));
  assert.match(crossing, /viewerPage\?\.sameVisibleSnapshot\(as: previous\) == true/);
  assert.match(crossing, /XDriveIOSNativePhotoAssetRangeCursorPolicy\.adjacentOffset\(/);
  assert.match(crossing, /selectedIndex: currentIndex/);
  assert.match(crossing, /let auth = try await login\.verifiedAuthorization\(\)/);
  assert.match(crossing, /XDriveIOSNativePhotoOwnerScope\.matches\(\s*auth\.owner, expectedOwner/);
  const previousRead = crossing.indexOf('let reread = try await reader.exactTripPage(');
  const nextRead = crossing.indexOf('let next = try await reader.exactTripPage(');
  assert.ok(previousRead >= 0 && nextRead > previousRead);
  assert.match(crossing, /reread\.sameVisibleSnapshot\(as: previous\)/);
  assert.match(crossing, /next\.total_count == previous\.total_count/);
  assert.match(crossing, /next\.offset == targetOffset/);
  assert.match(crossing, /Set\(previous\.items\.map\(\\\.id\)\)\.isDisjoint\(/);
  assert.match(approved, /verifiedRange\.total_count == trip\.item_count/);
  assert.match(approved, /verifiedRange\.items\.contains\(where: \{\s*\$0\.sameVisibleRevision\(as: next\)/);
  assert.match(approved, /viewerPage = verifiedRange[\s\S]*?viewerReturnID = next\.id/);
  assert.doesNotMatch(crossing, /reader\.page\(offset:|media\/memories|Date\(\)\.addingTimeInterval/);
});

test('trip year navigation filters only verified Owner trip IDs, never broadens GPS members', () => {
  const list = ui.slice(ui.indexOf('struct XDriveIOSNativeExactTripsScreen: View {'),
    ui.indexOf('struct XDriveIOSNativeExactTripWall: View {'));
  assert.match(list, /@State private var selectedYear: String\?/);
  assert.match(list, /trips\.map \{ String\(\$0\.end_date\.prefix\(4\)\) \}/);
  assert.match(list, /Array\(Set\([\s\S]*?\)\)\.sorted\(by: >\)/);
  assert.match(list, /availableYears\.filter \{[\s\S]*?selectedYear == nil \|\| selectedYear == \$0/);
  assert.match(list, /ForEach\(trips\.filter \{[\s\S]*?\$0\.end_date\.hasPrefix\(year\)/);
  assert.match(list, /Button\("所有年份"\) \{ selectedYear = nil \}/);
  assert.match(list, /native-ios-exact-trips-year-filter/);
  assert.match(list, /onChange\(of: login\.owner\) \{ _ in[\s\S]*?selectedYear = nil[\s\S]*?invalidate\(\)/);
  assert.match(list, /loadedOwner = expected[\s\S]*?trips = items/);
  assert.match(list, /XDriveIOSNativeExactTripWall\(/);
  assert.doesNotMatch(list, /Calendar\.current\.dateComponents|allPhotos|media\/memories|Date\(\)\.addingTimeInterval/);
});

test('trip navigation keeps its verified Owner list while the child wall is pushed', () => {
  const list = ui.slice(ui.indexOf('struct XDriveIOSNativeExactTripsScreen: View {'),
    ui.indexOf('struct XDriveIOSNativeExactTripWall: View {'));
  assert.match(list, /NavigationLink \{[\s\S]*?XDriveIOSNativeExactTripWall\(/);
  assert.match(list, /\.onDisappear \{[\s\S]*?loadTask\?\.cancel\(\)[\s\S]*?if phase != \.active \|\| login\.owner == nil \{ invalidate\(\) \}/);
  assert.doesNotMatch(list, /\.onDisappear \{ invalidate\(\) \}/);
  assert.match(list, /\.onAppear \{[\s\S]*?if let loadedOwner,[\s\S]*?!XDriveIOSNativePhotoOwnerScope\.matches\([\s\S]*?login\.owner, loadedOwner\)[\s\S]*?invalidate\(\)/);
  assert.match(list, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?selectedYear = nil[\s\S]*?invalidate\(\)/);
  assert.match(list, /\.onChange\(of: phase\) \{ new in[\s\S]*?else \{ invalidate\(\) \}/);
});
