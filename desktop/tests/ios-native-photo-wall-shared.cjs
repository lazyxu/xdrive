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
  assert.doesNotMatch(shared, /PHAsset|URLSession|UploadSession|UserDefaults|fetchAssets|verifiedAuthorization|accessToken|PHPhotoLibrary/)
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


// New cases share only the inert decoration and keep all data/source guards.
test('local, album and cloud ranges share skeleton cells; only chronological pages show day headings', () => {
  assert.match(shared, /struct XDriveIOSNativePhotoWallPlaceholderTile: View/)
  assert.match(shared, /RoundedRectangle\(cornerRadius: 3\)/)
  assert.match(shared, /\.aspectRatio\(1, contentMode: \.fit\)/)
  assert.match(shared, /\.accessibilityHidden\(true\)/)
  assert.match(shared, /struct XDriveIOSNativePhotoWallDayHeader: View/)
  assert.match(shared, /\.accessibilityAddTraits\(\.isHeader\)/)
  for (const source of [local, album, cloud]) {
    assert.match(source, /XDriveIOSNativePhotoWallPlaceholderTile\(\)/)
  }
  assert.match(local, /XDriveIOSNativePhotoWallDayHeader\(\s*title: section.title, topPadding: 4/)
  assert.match(album, /XDriveIOSNativePhotoWallDayHeader\(title: section.title\)/)
  assert.doesNotMatch(map, /XDriveIOSNativePhotoWallDayHeader\(/)
  assert.doesNotMatch(cluster, /XDriveIOSNativePhotoWallDayHeader\(/)
})

test('all five Gallery/place surfaces use the same density options, retaining each source scope', () => {
  assert.match(shared, /func xdrivePhotoWallDensityButtons\(/)
  assert.match(shared, /density\.wrappedValue = option/)
  for (const [source, state, count] of [
    [local, 'density', 1], [album, 'density', 1], [map, 'wallDensity', 2],
    [cluster, 'wallDensity', 1], [cloud, 'wallDensity', 1]
  ]) {
    const calls = source.match(/xdrivePhotoWallDensityButtons\(\$\w+\)/g) || []
    assert.equal(calls.length, count)
    assert.ok(calls.every(s => s === 'xdrivePhotoWallDensityButtons($' + state + ')'))
    assert.doesNotMatch(source, /ForEach\(XDriveIOSNativePhotoWallDensity\.allCases\)/)
  }
  assert.match(map, /XDriveIOSMapCurrentPhotoKitAdmission\.allows\(/)
  assert.match(cluster, /XDriveIOSNativePhotoOwnerScope\.matches\(/)
  assert.match(cloud, /pagePlaceID == placeID/)
})


test('shared retry feedback preserves the current scope and exact caller action', () => {
  assert.match(shared, /struct XDriveIOSNativePhotoWallRetryMessage: View/)
  assert.match(shared, /if let accessibilityID \{/)
  assert.match(shared, /\.disabled\(!canRetry\)/)
  assert.doesNotMatch(shared, /PHPhotoLibrary|URLSession|login\.owner|accessToken|loadNext\(\)|model\.load\(/)
  for (const surface of [map, cluster, cloud]) {
    assert.match(surface, /XDriveIOSNativePhotoWallRetryMessage\(/)
  }
  assert.match(map, /canRetry: !busy && phase == \.active/)
  assert.match(map, /if worker != nil \{ loadNext\(\) \} else \{ loadInitial\(\) \}/)
  assert.match(cluster, /canRetry: !busy && activeOwner && viewing == nil/)
  assert.match(cluster, /\) \{\s*load\(cursor, history: earlier\)\s*\}/)
  assert.match(cloud, /canRetry: !model\.busy && !viewerActive/)
  assert.match(cloud, /model\.load\(login: login, albumID: albumID, placeID: placeID,/)
})


test('Gallery and albums share purely visual selection badges, never batch authority', () => {
  assert.match(shared, /struct XDriveIOSNativePhotoWallSelectionIndicator: View/)
  assert.match(shared, /Image\(systemName: selected \? "checkmark\.circle\.fill" : "circle"\)/)
  assert.match(shared, /\.symbolRenderingMode\(\.palette\)/)
  assert.match(shared, /\.foregroundStyle\(\.white, Color\.accentColor\)/)
  assert.match(shared, /\.foregroundStyle\(\.white\)/)
  assert.match(local, /if selectionMode \{\s*XDriveIOSNativePhotoWallSelectionIndicator\(\s*selected: selectedIDs\.contains\(candidate\.id\),\s*accented: true/)
  assert.match(album, /if selectionMode \{\s*XDriveIOSNativePhotoWallSelectionIndicator\(\s*selected: selectedIDs\.contains\(item\.id\)/)
  assert.match(local, /Button \{ onSelect\(candidate, page\) \}/)
  assert.match(album, /Button \{ onSelect\(item, page\) \}/)
  assert.doesNotMatch(map, /XDriveIOSNativePhotoWallSelectionIndicator\(/)
  assert.doesNotMatch(cluster, /XDriveIOSNativePhotoWallSelectionIndicator\(/)
  assert.doesNotMatch(shared, /PHAsset|PHPhotoLibrary|URLSession|UploadSession|verifiedAuthorization|accessToken|UserDefaults/)
})


test('cloud place sheet keeps Gallery wall but omits transport-only prose', () => {
  const wall = cloud.slice(cloud.indexOf('struct XDriveIOSNativeServerMediaWall: View'),
    cloud.indexOf('/// Server collection index is distinct'))
  assert.match(wall, /if !compactGallery && placeID == nil \{\s*Text\(album == nil/)
  assert.match(wall, /if !compactGallery && placeID == nil \{\s*Text\("连续滚动只读取附近的 48 项验证范围/)
  assert.doesNotMatch(wall, /Text\(placeID != nil \?/)
  assert.match(wall, /XDriveIOSNativeServerVirtualRange\([\s\S]*?placeID: placeID/)
  assert.match(wall, /model\.load\(login: login, albumID: album\?\.id, placeID: placeID/)
  assert.match(wall, /pagePlaceID == placeID/)
})
