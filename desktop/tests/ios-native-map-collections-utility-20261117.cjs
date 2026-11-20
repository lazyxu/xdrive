'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const dash = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const runtime = read('ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift')

test('Collections Utilities Map uses the existing Gallery MapKit route, never a second reader', () => {
  assert.match(dash, /private var mapUtilitySection: some View/)
  assert.match(dash, /Text\("实用工具"\)/)
  assert.match(dash, /Button\(action: onOpenMap\)/)
  assert.match(dash, /accessibilityIdentifier\("native-ios-collections-map"\)/)
  assert.match(dash, /collectionSection\("媒体类型", routes: \[\.videos, \.livePhotos\]\)\s*mapUtilitySection/)
  assert.match(dash, /login: login, savedAlbumOffset: \$localAlbumDirectoryOffset,\s*onOpenMap: \{[\s\S]*?selectedLocalCollectionTrip = nil[\s\S]*?openGallery\(\.map\)/)
  assert.match(dash, /onOpenLocalDayMap: \{ day in[\s\S]*?XDriveIOSNativePhotoMapCaptureRange\.day\(day\)[\s\S]*?openGallery\(\.map\)/)
  assert.match(dash, /onOpenLocalTripMap: \{ trip in[\s\S]*?XDriveIOSNativePhotoFingerprintIndex\.isCurrent\(trip\.libraryEpoch\)[\s\S]*?openGallery\(\.map\)/)
  const utility = dash.slice(dash.indexOf('private var mapUtilitySection: some View'),
    dash.indexOf('var body: some View', dash.indexOf('private var mapUtilitySection')))
  assert.doesNotMatch(utility, /PHAsset|PHPhotoLibrary|URLSession|GPS|OwnerScope|mapOverview|fetchAssets/)
})

test('signed-out Collections Map closes to Collections while cross-Owner return stays fenced', () => {
  assert.match(dash, /mapOpenedFromCollections = tab == \.gallery && gallerySource == \.albums/)
  assert.match(dash, /mapReturnOwnerScopeKey == ownerScopeKey\s*\? mapReturnGallerySource : nil/)
  assert.match(dash, /openGallery\(mapOpenedFromCollections \? \.albums : \(prior \?\? fallback\)\)/)
  assert.match(dash, /mapOpenedFromCollections = false[\s\S]*?mapReturnGallerySource = nil/)
  assert.match(runtime, /func testCollectionsUtilityOpensSameMapKitAndReturnsToCollections\(\)/)
  assert.match(runtime, /native-ios-collections-map/)
  assert.match(runtime, /native-ios-five-slot-bar/)
  assert.match(runtime, /Closing a signed-out Collections Map must return to Collections/)
})
