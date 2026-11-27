'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

const localMap = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const ownerMap = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const sourceMap = read('ios/XDriveIOS/NativeUnifiedSourcePhotoMap.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const trip = read('ios/XDriveIOS/NativeLocalPhotoTripMembership.swift')
const photo = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const info = read('ios/XDriveIOS/NativeViewerQualityPanel.swift')
const writes = read('ios/XDriveIOS/NativeLocalPhotoActions.swift')

test('P0-01 single authorized local GPS cell resolves locality only for presentation', () => {
  assert.match(localMap, /selection\.cells\.count == 1/)
  assert.match(localMap, /let cell = selection\.cells\.first/)
  assert.match(localMap, /CLGeocoder\(\)/)
  assert.match(localMap, /reverseGeocodeLocation\(/)
  assert.match(localMap, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized/)
  assert.match(localMap, /placeName \?\? "此地点的照片"/)
  assert.match(localMap, /placeGeocoder\.cancelGeocode\(\)/)
  const start = localMap.indexOf('private func resolvePlaceName()')
  const section = localMap.slice(start, localMap.indexOf('private func cancelPlaceName()', start))
  assert.doesNotMatch(section, /URLSession|Upload|XDriveIOSNativeMediaGalleryReader/)
  assert.match(localMap, /loadInitial\(\)[\s\S]*?resolvePlaceName\(\)/)
})

test('P0-02 native Map top chrome has secondary nonintrusive overflow menus in all sources', () => {
  for (const [code, label] of [
    [localMap, 'native-ios-local-map-actions'],
    [ownerMap, 'native-ios-owner-map-actions'],
    [sourceMap, 'native-ios-unified-source-map-actions']
  ]) {
    assert.match(code, /\.overlay\(alignment: \.bottomLeading\)/)
    assert.ok(code.includes('accessibilityIdentifier("' + label + '")'))
    assert.match(code, /Label\("地图操作", systemImage: "ellipsis\.circle"\)/)
    assert.match(code, /\.labelStyle\(\.iconOnly\)/)
    assert.match(code, /frame\(width: 44, height: 44\)/)
    assert.match(code, /Label\("地图日期", systemImage: "calendar"\)/)
  }
  assert.match(ownerMap, /native-ios-map-source-selector/)
  assert.match(localMap, /native-ios-map-source-selector/)
  assert.match(ownerMap, /XDriveIOSNativeExactTripsScreen\(login: login\)/)
})

test('P0-03 MapKit source transition is animated without a second permanent Owner scanner', () => {
  assert.match(ownerMap, /let animatedSource = Binding<XDriveIOSNativePhotoMapSource>/)
  assert.match(ownerMap, /guard next != source, next != \.cloud \|\| cloudAllowed/)
  assert.match(ownerMap, /withAnimation\(\.easeInOut\(duration: 0\.22\)\)/)
  assert.match(ownerMap, /return ZStack \{[\s\S]*?switch source/)
  assert.match(ownerMap, /\.animation\(\.easeInOut\(duration: 0\.22\), value: source\)/)
  assert.ok((ownerMap.match(/\.transition\(\.opacity\)/g) || []).length >= 2)
  assert.match(ownerMap, /source == \.local else \{ return \}/)
  assert.match(ownerMap, /source == \.cloud, let expectedOwner/)
  assert.match(ownerMap, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.doesNotMatch(ownerMap, /@State.*bothMapsActive|Task\.detached.*mapSource/)
})

test('P1-04 real local days/trips and signed Owner exact Trips are distinct Collections', () => {
  for (const name of ['memories', 'trips', 'cloudTrips']) {
    assert.ok(dashboard.includes('case .' + name + ':'), name)
  }
  assert.match(dashboard, /collectionSection\("回忆", routes: \[\.memories\]\)/)
  assert.match(dashboard, /collectionSection\("旅行", routes: login\.owner == nil/)
  assert.match(dashboard, /XDriveIOSNativeLocalRecentDaysAndTrips\(/)
  assert.match(dashboard, /mode: \.memories/)
  assert.match(dashboard, /mode: \.trips/)
  assert.match(dashboard, /XDriveIOSNativeExactTripsScreen\(login: login\)/)
  assert.match(dashboard, /XDriveIOSNativePhotoMapCaptureRange\.day\(day\)/)
  assert.match(dashboard, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent\(trip\.libraryEpoch\)/)
  assert.match(dashboard, /inheritedTripScope: selectedLocalCollectionTrip/)
  assert.match(ownerMap, /inheritedTripScope: inheritedTripScope/)
  assert.match(localMap, /inheritedTripScope: XDriveIOSNativeLocalTripScope\?/)
  assert.match(localMap, /tripScope: chosenLocalTrip/)
  assert.match(trip, /cells: Set<XDriveIOSNativeLocalTripDayCell>/)
  assert.match(trip, /func contains\(_ capturedAt: Date\?, latitude: Double, longitude: Double/)
  assert.match(trip, /mode == \.memories \|\| \$0\.count >= 3|mode != \.memories \|\| \$0\.count >= 3/)
})

test('P1-04 a revoked or revised exact curated trip cannot widen to all photos', () => {
  assert.match(localMap, /if let trip = inheritedTripScope \{/)
  assert.match(localMap, /guard authorization == \.authorized, trip\.valid/)
  assert.match(localMap, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent\(trip\.libraryEpoch\)/)
  assert.match(localMap, /该精选集的照片位置已变化，请返回精选集重新核对/)
  assert.match(localMap, /invalidate\(\)/)
  assert.match(trip, /并非 Apple 私有的回忆精选|不是 Apple 的私有精选集/)
  assert.doesNotMatch(dashboard, /fakeAppleMemory|PHAsset\.fetchAssets.*fakeTrip/)
})

test('P1-05 photo info, current-photo nearby map and explicit local location adjustment', () => {
  assert.match(info, /var onAdjustLocation: \(\(\) -> Void\)\? = nil/)
  assert.match(info, /native-ios-viewer-adjust-location/)
  assert.match(info, /在地图中显示附近照片/)
  assert.match(photo, /private func requestPhotoLocationEdit\(\)/)
  assert.match(photo, /pendingLocationEditor = true/)
  assert.match(photo, /onDismiss: \{[\s\S]*?showingLocationEditor = true/)
  assert.match(photo, /XDriveIOSNativeLocalPhotoLocationEditor\(/)
  assert.match(photo, /MKLocalSearch\(request: request\)\.start\(\)/)
  assert.match(photo, /native-ios-local-location-search/)
  assert.match(photo, /native-ios-local-location-confirm/)
  assert.match(photo, /native-ios-local-location-remove/)
  assert.match(photo, /XDriveIOSNativeLocalPhotoSelectionActions\.setLocation\(/)
  assert.match(writes, /let assets = try verifiedAssets\(\[candidate\]\)/)
  assert.match(writes, /PHAssetChangeRequest\(for: assets\[0\]\)\.location = location/)
  assert.match(writes, /PHPhotoLibrary\.shared\(\)\.performChanges/)
  assert.doesNotMatch(writes, /URLSession|upload\(|accessToken/)
})

test('P1-05 metadata editor refuses stale selection and unrelated cloud writes', () => {
  assert.match(writes, /asset\.creationDate == expected\.capturedAt/)
  assert.match(writes, /asset\.modificationDate == expected\.modifiedAt/)
  assert.match(writes, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(photo, /guard currentPageAuthorized else/)
  assert.match(photo, /guard authorized, !writing/)
  assert.match(photo, /\.interactiveDismissDisabled\(writing\)/)
  assert.match(photo, /showRemoveConfirmation/)
  assert.match(photo, /searchTask\?\.cancel\(\)/)
})
