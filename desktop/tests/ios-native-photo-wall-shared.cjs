'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')

const shared = read('ios/XDriveIOS/NativePhotoWallComponents.swift')
const local = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const album = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const map = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const cloud = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const cluster = read('ios/XDriveIOS/NativeOwnerMapClusterAlbum.swift')

test('one adaptive SwiftUI photo grid is wired into local, album, location and cloud walls', () => {
  assert.match(shared, /struct XDriveIOSNativePhotoWallGrid<Content: View>: View/)
  assert.match(shared, /LazyVGrid\(columns: \[GridItem\(\.adaptive\(/)
  assert.match(shared, /minimum: density\.minimumCellWidth/)
  assert.match(shared, /maximum: density\.maximumCellWidth/)
  assert.match(shared, /@ViewBuilder content: \(\) -> Content/)
  for (const [source, count] of [[local, 2], [album, 2], [map, 2],
    [cloud, 2], [cluster, 1]]) {
    assert.equal((source.match(/XDriveIOSNativePhotoWallGrid\(density:/g) || []).length,
      count, 'each expected wall and its placeholder must use shared grid')
  }
  assert.doesNotMatch(shared, /PHAsset|URLSession|Owner|UploadSession|UserDefaults|fetchAssets/)
})

test('local GPS photos reuse the canonical album square thumbnail without changing data source', () => {
  const localPage = map.slice(map.indexOf('private struct XDriveIOSMapPhotoAlbum: View'),
    map.indexOf('enum XDriveIOSNativeLocalMapScope'))
  const spatial = map.slice(map.indexOf('private struct XDriveIOSMapSpatialAlbum: View'),
    map.indexOf('/// One native map route'))
  for (const source of [localPage, spatial]) {
    assert.match(source, /XDriveIOSNativeSquarePhotoTile\(candidate: item\)/)
    assert.match(source, /@State private var wallDensity: XDriveIOSNativePhotoWallDensity = \.standard/)
    assert.match(source, /XDriveIOSNativePhotoWallGrid\(density: wallDensity\)/)
    assert.match(source, /wallDensity = wallDensity\.applyingPinch\(scale\)/)
    assert.doesNotMatch(source, /XDriveIOSLocalPhotoTile\(candidate: item\)/)
  }
  assert.match(map, /XDriveIOSMapCurrentPhotoKitAdmission\.allows\(/)
  assert.match(map, /XDriveIOSNativeMapViewerAdmission\.allows\(/)
  assert.match(spatial, /scanner\.startMap\([\s\S]*?album: album, mediaFilter: selection\.mediaFilter/)
  assert.match(spatial, /pendingLocated: \[XDrivePhotoKitLocatedCandidate\]/)
  assert.match(spatial, /while rows\.count < 48/)
  assert.match(spatial, /XDriveIOSNativeLocalPhotoDetail\(/)
})

test('cloud single place reuses Owner wall and clusters still enforce signed ranges', () => {
  const ownerMap = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
  assert.match(ownerMap, /XDriveIOSNativeServerMediaWall\([\s\S]*?placeID: place\.id/)
  assert.match(ownerMap, /XDriveIOSNativeOwnerMapClusterAlbum\(/)
  assert.match(cloud, /XDriveIOSNativeMediaGalleryReader\(/)
  assert.match(cloud, /pagePlaceID == placeID/)
  assert.match(cluster, /XDriveIOSNativePhotoWallGrid\(density: wallDensity\)/)
  assert.match(cluster, /XDriveIOSNativePhotoOwnerScope\.matches\(/)
  assert.match(cluster, /currentOldPage\.sameVisibleSnapshot\(as: departingPage\)/)
  assert.match(cluster, /Set\(fetched\.items\.map\(\\\.id\)\)\.count == fetched\.items\.count/)
  assert.match(cluster, /onCrossRange: \{ previous, anchor, direction in/)
})

test('location sheets keep exact paging, map camera, Viewer and visible sentinel', () => {
  assert.match(map, /\.presentationDetents\(\[\.medium, \.large\]\)/)
  assert.match(map, /\.presentationDragIndicator\(\.visible\)/)
  assert.match(map, /onLibraryCameraChange\?\(nil\)/)
  assert.match(map, /if hasNext \{[\s\S]*?scrollFootVisible = true/)
  assert.match(cluster, /if let next \{[\s\S]*?scrollFootVisible = true/)
  assert.match(map, /restoreViewerTile\(using: returnScroll\)/)
  assert.match(cluster, /returnScroll\.scrollTo\(anchor\.id, anchor: \.center\)/)
  assert.match(cluster, /\@State private var priorWindow: XDriveIOSNativeMediaRange\?/)
  assert.match(map, /\@State private var priorWindow: \[XDrivePhotoKitScanCandidate\] = \[\]/)
})
