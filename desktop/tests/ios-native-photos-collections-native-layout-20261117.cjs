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
  assert.match(ui, /\.fullScreenCover\(isPresented: \$presentingUnifiedMap,[\s\S]*?\.safeAreaInset\(edge: \.bottom, spacing: 0\) \{\s*nativePhotosBottomBar/)
  assert.doesNotMatch(ui, /if tab == \.gallery && gallerySource != \.map/)
  assert.match(ui, /Section\("xDrive"\) \{[\s\S]*?Button\("文件"\) \{ tab = \.files \}/)
})
