'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')

const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const shared = read('ios/XDriveIOS/NativePhotoWallComponents.swift')

for (const [name, source, screenIdentifier] of [
  ['PhotoKit local and album maps', local, 'native-ios-local-map-basemap'],
  ['verified cloud Owner map', owner, 'native-ios-owner-map-basemap'],
]) {
  test(name + ' offers explicit native standard/satellite basemap selection', () => {
    assert.match(source, /@State private var mapType: MKMapType = \.standard/)
    assert.match(source, /let mapType: MKMapType/)
    assert.match(source, /XDriveIOSNativePhotoMapFloatingTools\(/)
    assert.match(source, /satellite: mapType == \.satellite/)
    assert.match(source, /mapType = mapType == \.satellite \? \.standard : \.satellite/)
    assert.match(source, /onToggleStyle: \{/)
    assert.match(shared, /struct XDriveIOSNativePhotoMapFloatingTools: View/)
    assert.match(shared, /Button\(action: onToggleStyle\)/)
    // The 44pt floating UIKit control owns this ID, not the old Menu.
    assert.match(source, new RegExp('styleID: "' + screenIdentifier + '"'))
    assert.match(shared, /\.accessibilityIdentifier\(styleID\)/)
  })

  test(name + ' changes MapKit layer without invalidating photo pins or the camera', () => {
    assert.match(source, /map\.showsUserLocation = false\s+map\.mapType = mapType/)
    const update = source.slice(source.indexOf('func updateUIView(_ map: MKMapView, context: Context)'))
    assert.match(update, /if map\.mapType != mapType \{[\s\S]*?map\.delegate = nil\s*map\.mapType = mapType\s*map\.delegate = context\.coordinator\s*\}/)
    assert.ok(update.indexOf('if map.mapType != mapType') < update.indexOf('guard context.coordinator.revision != revision'))
    assert.doesNotMatch(source, /requestWhenInUseAuthorization\(|requestAlwaysAuthorization\(/)
  })
}

test('both native PhotoKit map paths receive the current basemap', () => {
  assert.match(local, /items: \[\], globalCells: globalComplete \? globalCells : provisionalCells,[\s\S]*?revision: mapRevision, mapType: mapType, cameraReturn: globalCamera/)
  assert.match(local, /items: page\.items, revision: mapRevision, mapType: mapType, cameraReturn: cameraReturn/)
})

test('cloud MapKit receives a basemap without changing its signed Owner scope', () => {
  assert.match(owner, /markersEnabled: mapMarkersEnabled,\s*revision: revision, mapType: mapType,\s*initialCamera:/)
  assert.match(owner, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(owner, /verifiedBounds/)
})
