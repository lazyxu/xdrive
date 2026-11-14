'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = f => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8')
const local=read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const cloud=read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const location=read('ios/XDriveIOS/NativeMapUserLocationController.swift')

test('M15 basemap failure and success use real MKMapViewDelegate callbacks', ()=>{
  for (const src of [local, cloud]) {
    assert.match(src,/func mapViewDidFailLoadingMap\(/)
    assert.match(src,/func mapViewDidFinishLoadingMap\(/)
    assert.match(src,/onBasemapStatus\?\(true\)/)
    assert.match(src,/onBasemapStatus\?\(false\)/)
    assert.match(src,/\.onBasemapStatus = onBasemapStatus/)
    assert.doesNotMatch(src,/basemapUnavailable\s*\?\s*forceGrant/)
  }
  assert.match(local,/native-ios-local-map-basemap-unavailable/)
  assert.match(cloud,/native-ios-owner-map-basemap-unavailable/)
  assert.match(cloud,/XDriveIOSNativeOwnerMapSelectionPolicy\.isSameViewport/)
  assert.match(local,/PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})

test('M15 real CoreLocation timeout stays isolated from tile/load and photo access', ()=>{
  assert.match(location,/maximumLocationWait: TimeInterval = 15/)
  assert.match(location,/self\.manager === requestManager/)
  assert.match(location,/func cancel\([\s\S]*?stopLocateTimeout\(\)/)
  assert.match(location,/private func fail\([\s\S]*?stopLocateTimeout\(\)/)
  assert.doesNotMatch(location,/startUpdatingLocation\(|requestAlwaysAuthorization\(/)
})
