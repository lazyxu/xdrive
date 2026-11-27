'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root=path.resolve(__dirname,'../..')
const local=fs.readFileSync(path.join(root,'ios/XDriveIOS/NativeLocalPhotoMap.swift'),'utf8')
const runtime=fs.readFileSync(path.join(root,'ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift'),'utf8')

test('real local MapKit grid stays above Photos native bottom chrome',()=>{
  const segment=local.slice(local.indexOf('.overlay(alignment: .bottomTrailing) {'),
                            local.indexOf('.overlay(alignment: .topLeading)',local.indexOf('.overlay(alignment: .bottomTrailing) {')))
  assert.match(segment,/XDriveIOSNativePhotoMapGridAction\([\s\S]*?accessibilityID: "native-ios-local-map-current-grid"/)
  assert.match(segment,/\) \{ openCurrentMapGrid\(\) \}[\s\S]*?\.padding\(\.trailing, 12\)\s*\.padding\(\.bottom, 74\)/)
  assert.match(segment,/enabled: canOpenCurrentMapGrid/)
  assert.match(local,/private func openCurrentMapGrid\(\) \{\s*guard canOpenCurrentMapGrid else \{ return \}[\s\S]*?XDriveIOSNativeLocalMapSpatialPolicy\.acceptsCellSelection\(/)
})

test('MapKit repeated real GPS Viewer journey rejects bottom-bar hit target overlap',()=>{
  const run=runtime.slice(runtime.indexOf('func testP0RapidPlaceWallViewerReturnKeepsMapAndGalleryMounted()'),
                          runtime.indexOf('func testZP0ExternallyRevokedPhotosRejectOldMapAndRecover()'))
  assert.match(run,/let currentGrid = element\("native-ios-local-map-current-grid", in: app\)/)
  assert.match(run,/XCTAssertFalse\(currentGrid\.frame\.intersects\(photosChrome\.frame\)/)
  assert.match(run,/XCTAssertTrue\(currentGrid\.isHittable/)
  assert.match(run,/currentGrid\.tap\(\)/)
  assert.match(run,/native-ios-map-photo-wall-tile/)
})

test('Owner dashboard and full-screen unified source use the appropriate grid clearance',()=>{
  const owner=fs.readFileSync(path.join(root,'ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift'),'utf8')
  const source=fs.readFileSync(path.join(root,'ios/XDriveIOS/NativeUnifiedSourcePhotoMap.swift'),'utf8')
  for(const [code,id,bottom] of [
    [owner,'native-ios-owner-map-current-grid',74],
    [source,'native-ios-unified-source-map-current-grid',62]
  ]){
    const start=code.indexOf('.overlay(alignment: .bottomTrailing) {')
    const end=code.indexOf('.overlay(alignment: .topLeading)',start)
    assert.ok(start>=0 && end>start)
    const grid=code.slice(start,end)
    assert.ok(grid.includes('accessibilityID: "'+id+'"'))
    assert.match(grid,/XDriveIOSNativePhotoMapGridAction\(/)
    assert.match(grid,new RegExp('\\.padding\\(\\.trailing, 12\\)\\s*\\.padding\\(\\.bottom, '+bottom+'\\)'))
  }
  assert.match(owner,/private func openCurrentMapGrid\(\)[\s\S]*?acceptsSelectedCluster\(/)
  assert.match(source,/guard currentProof, !pins\.isEmpty,[\s\S]*?pins\.allSatisfy\(\{ \$0\.count > 0 \}\)/)
})
