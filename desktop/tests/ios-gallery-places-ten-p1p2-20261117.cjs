'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const swift = n => fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS', n+'.swift'), 'utf8')
const shared = swift('NativePhotoWallComponents')
const owner = swift('NativeOwnerMapClusterAlbum')
const source = swift('NativeUnifiedSourcePhotoMap')

test('common signed wall shell and bounded first paint', () => {
  for (const n of ['NativeOwnerMapClusterAlbum','NativeUnifiedSourcePhotoMap','NativeUnifiedPhotoGallery'])
    assert.match(swift(n), /XDriveIOSNativePhotoWallCollectionStack\s*\{/)
  assert.match(shared, /struct XDriveIOSNativePhotoWallSkeletonGrid: View/)
  assert.match(swift('NativeLocalContinuousGallery'), /count: min\(64, expectedTotal - offset\)/)
  assert.match(shared, /maximumSkeletonCount = 64/)
  assert.doesNotMatch(shared, /PHAsset|URLSession|verifiedAuthorization|accessToken/)
})
test('Owner Viewer and auto-append retain measured pixels only for current signed range', () => {
  assert.match(owner, /viewerOpeningCursor = cursor/)
  assert.match(owner, /viewerReturnViewport = visibleTileFrames\[String\(item\.id\)\]/)
  assert.match(owner, /sameVisibleRevision\(as: \$1\)/)
  assert.match(owner, /viewerOpeningCursor != cursor/)
  assert.match(owner, /viewerReturnViewport\?\.alignment\(/)
  assert.match(owner, /autoScrollReturnViewport\?\.alignment\(/)
  assert.match(owner, /priorWindowCursor\?\.offset/)
  assert.match(owner, /XDriveIOSNativePhotoOwnerScope\.matches/)
})
test('shared pinch callback captures a currently visible, unique authorized tile', () => {
  assert.match(shared, /onDensityChange\?\(changed\)[\s\S]*?density = changed/)
  for (const n of [owner, source]) {
    assert.match(n, /onDensityChange: \{ _ in/)
    assert.match(n, /visibleTileFrames[\s\S]*?\.min\(by:/)
    assert.match(n, /\.onChange\(of: (?:wallDensity|density)\)/)
    assert.match(n, /filter\(\{ \$0\.id == id \}\)\.count == 1/)
  }
})

test('local/cloud/source Viewer filmstrips share one inert scroll geometry', () => {
  assert.match(shared, /struct XDriveIOSNativePhotoWallViewerFilmstripScroll<Content: View>/)
  for (const n of ['NativeLocalPhotoViewerFilmstrip','NativeCloudPhotoAssetViewerFilmstrip','NativeUnifiedSourcePhotoMap'])
    assert.match(swift(n), /XDriveIOSNativePhotoWallViewerFilmstripScroll/)
  assert.match(swift('NativeLocalPhotoViewerFilmstrip'), /XDriveIOSNativeLocalFilmstripPolicy\.target/)
  assert.match(swift('NativeCloudPhotoAssetViewerFilmstrip'), /XDriveIOSNativeCloudFilmstripPolicy\.target/)
  assert.match(source, /private func admitViewerNeighbor\(/)
})
test('cloud PhotoAsset range retains bounded source-verified loading geometry', () => {
  const cloud = swift('NativeServerMediaGallery')
  assert.match(cloud, /count: min\(48, max\(0, expectedTotal - offset\)\)/)
  assert.match(cloud, /XDriveIOSNativePhotoWallSkeletonGrid\(/)
})

test('unified Gallery pinch and Viewer use transient verified tile geometry', () => {
  const main = swift('NativeUnifiedPhotoGallery')
  const tile = swift('NativeUnifiedPhotoWall')
  assert.match(tile, /\.xdrivePhotoWallMeasureTile\(/)
  assert.match(main, /viewerOpeningViewport = visibleTileFrames\[/)
  assert.match(main, /viewerOpeningViewport\?\.alignment\(/)
  assert.match(main, /pinchGeneration = wall\.generation/)
  assert.match(main, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(main, /pinchReturnViewport = nil/)
  assert.match(shared, /if !id\.isEmpty/)
})
test('backward place paging restores only a unique current-window tile', () => {
  assert.match(source, /backfillViewportAnchor\?\.alignment\(/)
  assert.match(source, /backfillViewportAnchor = visibleTileFrames\[oldAnchor\]\.map/)
  assert.match(source, /backfillViewportAnchor = visibleTileFrames\[anchor\]\.map/)
  assert.match(source, /filter\(\{ \$0\.id == anchor \}\)\.count == 1/)
})
