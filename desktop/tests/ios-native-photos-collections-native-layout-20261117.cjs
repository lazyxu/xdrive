'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ui = fs.readFileSync(path.resolve(__dirname, '../../ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8')

const collections = ui.slice(
  ui.indexOf('private enum XDriveIOSNativePhotosCollectionDestination:'),
  ui.indexOf('/// Native Photos-style Gallery shell')
)
const cover = ui.slice(
  ui.indexOf('private struct XDriveIOSNativePhotosCollectionCover: View'),
  ui.indexOf('/// The native Collections surface')
)

test('native Collections has honest, horizontally grouped destinations and no fake Memories', () => {
  assert.match(collections, /ScrollView\(\.horizontal, showsIndicators: false\)/)
  assert.match(collections, /collectionSection\("最近的日子", routes: \[\.recentDays\]\)/)
  assert.match(collections, /collectionSection\("人物与宠物", routes: \[\.people\]\)/)
  assert.match(collections, /collectionSection\("相簿", routes: \[\.albums\]\)/)
  assert.match(collections, /collectionSection\("媒体类型", routes: \[\.videos, \.livePhotos\]\)/)
  assert.match(collections, /XDriveIOSNativeExactTripsScreen\(login: login\)/)
  assert.match(collections, /XDriveIOSNativeGalleryPeople\(login: login\)/)
  assert.match(collections, /XDriveIOSNativePhotoAlbumsScreen\(savedOffset: \$savedAlbumOffset\)/)
  assert.doesNotMatch(collections, /case memories|Button\("回忆"\)|randomElement\(\)/)
})

test('pin editing stores only whitelisted cosmetic route names, not media or Owner IDs', () => {
  assert.match(collections, /@AppStorage\("xdrive\.native\.photos\.pinned-collection-routes\.v1"\)/)
  assert.match(collections, /XDriveIOSNativePhotosCollectionDestination\(rawValue: String\(\$0\)\)/)
  assert.match(collections, /visited\.insert\(\$0\)\.inserted/)
  assert.match(collections, /updated\.map\(\\\.rawValue\)\.joined\(separator: ","\)/)
  assert.match(collections, /native-ios-collections-edit-pinned/)
  assert.match(collections, /native-ios-collections-pinned-strip/)
  assert.match(collections, /native-ios-collections-pinned-/)
  assert.doesNotMatch(collections, /localIdentifier|accessToken|owner\.id|gpsCoordinates|performChanges/)
})

test('Collections cards preserve current PhotoKit permission and request cancellation', () => {
  assert.match(cover, /\.aspectRatio\(1, contentMode: \.fit\)/)
  assert.match(cover, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(cover, /options\.fetchLimit = kind == \.livePhotos \? 96 : 1/)
  assert.match(cover, /onDisappear \{\s*changes\.stop\(\)\s*loader\.cancel\(\)/)
  assert.match(cover, /onChange\(of: phase\) \{ next in[\s\S]*?else \{ loader\.cancel\(\) \}/)
  assert.doesNotMatch(cover, /requestImageDataAndOrientation|performChanges|UploadSession|UserDefaults/)
})

test('Gallery still shows one bar and preserves real xDrive navigation routes', () => {
  assert.match(ui, /\.toolbar\(\.hidden, for: \.tabBar\)/)
  // One native Photos bar stays visible on Library, Collections and Map.
  // xDrive five-slot navigation only appears on non-Gallery modules.
  assert.match(ui, /if tab == \.gallery \{\s*nativePhotosBottomBar\s*\} else \{\s*nativeBottomBar/)
  assert.match(ui, /\.fullScreenCover\(isPresented: \$presentingUnifiedMap,[\s\S]*?VStack\(spacing: 0\) \{\s*NavigationStack \{[\s\S]*?XDriveIOSNativePhotoMapsScreen\([\s\S]*?\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)[\s\S]*?nativePhotosBottomBar/)
  assert.doesNotMatch(ui, /if tab == \.gallery && gallerySource != \.map/)
  assert.match(ui, /Section\("xDrive"\) \{[\s\S]*?Button\("文件"\) \{\s*showingGalleryOptions = false\s*tab = \.files\s*\}/)
  assert.match(ui, /Button \{\s*showingGalleryOptions = true\s*\} label:/)
  assert.match(ui, /\.sheet\(isPresented: \$showingGalleryOptions\) \{\s*galleryOptionsSheet\s*\}/)
  assert.match(ui, /native-ios-gallery-options-done/)
})

test('real Collections MapKit journey enters Gallery using current visible navigation', () => {
  const nativeUITest = fs.readFileSync(path.resolve(
    __dirname, '../../ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift'), 'utf8')
  const start = nativeUITest.indexOf('func testCollectionsUtilityOpensSameMapKitAndReturnsToCollections()')
  const end = nativeUITest.indexOf('func testAFirstTwoRealGPSPhotosOpenPlaceWallViewerAndReturnToSameMap()', start)
  assert.ok(start >= 0 && end > start, 'real Collections -> MapKit UI test must remain registered')
  const testBody = nativeUITest.slice(start, end)
  assert.match(testBody, /openNativeLauncher\(in: app\)[\s\S]*?native-ios-tab-gallery/)
  assert.match(testBody, /native-ios-gallery-more-menu[\s\S]*?app\.buttons\["全部照片"\]/)
  assert.match(testBody, /native-ios-photos-bottom-bar[\s\S]*?native-ios-photos-collections-tab/)
  assert.match(testBody, /native-ios-photos-return-tabs[\s\S]*?native-ios-collections-map/)
  assert.match(testBody, /native-ios-collections-map[\s\S]*?native-ios-local-map-actions/)
  assert.match(testBody, /native-ios-map-dismiss[\s\S]*?Closing a signed-out Collections Map must return to Collections/)
  assert.doesNotMatch(testBody, /-xdrive-ui-navigation-synthetic-owner|launchEnvironment\[|simctl privacy grant/)
})

test('Collections album card uses only a real currently authorized and bounded album thumbnail', () => {
  assert.match(collections, /case \.albums:\s*XDriveIOSNativePhotosCollectionCover\(kind: \.albums\)/)
  assert.match(cover, /case \.albums:\s*\/\/ Use one genuine/)
  assert.match(cover, /PHAssetCollection\.fetchAssetCollections\(\s*with: \.album, subtype: \.any, options: nil/)
  assert.match(cover, /for index in 0\.\.<min\(userAlbums\.count, 12\)/)
  assert.match(cover, /PHAsset\.fetchAssets\(in: album, options: options\)\.firstObject/)
  assert.match(cover, /loader\.load\(cover\.localIdentifier,/)
  assert.match(cover, /No actual authorized album image: retain the honest icon/)
  assert.doesNotMatch(cover, /PHAsset\.fetchAssets\(in: album.*?\)\.lastObject/)
})

test('signed-out native Library count is only presented after PhotoKit scan succeeds',()=>{
  const local = fs.readFileSync(path.resolve(
    __dirname, '../../ios/XDriveIOS/NativeLocalContinuousGallery.swift'), 'utf8')
  assert.match(local, /hasCompletedInitialRead\s*\?\s*\(mediaFilter\.isAll/)
  assert.match(local, /native-ios-photos-local-photo-count/)
  assert.match(local, /正在统计照片…/)
  assert.match(local, /hasCompletedInitialRead = true/)
  assert.doesNotMatch(local, /本机已授权\\\(mediaFilter\.title\) · 按日分组/)
})
