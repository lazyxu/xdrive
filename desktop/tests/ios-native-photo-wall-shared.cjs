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
const unified = read('ios/XDriveIOS/NativeUnifiedPhotoWall.swift')
const unifiedGallery = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')

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


test('busy and empty feedback are one inert SwiftUI presentation, with source-owned conditions', () => {
  assert.match(shared, /struct XDriveIOSNativePhotoWallLoadingMessage: View/)
  assert.match(shared, /struct XDriveIOSNativePhotoWallStatusMessage: View/)
  assert.match(shared, /ProgressView\(message\)/)
  assert.match(shared, /\.accessibilityIdentifier\(accessibilityID\)/)
  assert.match(shared, /\.frame\(maxWidth: \.infinity, minHeight: minHeight, alignment: \.leading\)/)
  for (const surface of [local, album, map, cluster, cloud, unified]) {
    assert.match(surface, /XDriveIOSNativePhotoWallLoadingMessage\(/)
  }
  for (const surface of [local, map, unified]) {
    assert.match(surface, /XDriveIOSNativePhotoWallStatusMessage\(/)
  }
  assert.match(map, /if !busy && items\.isEmpty && priorWindow\.isEmpty && error == nil \{\s*XDriveIOSNativePhotoWallStatusMessage\(/)
  assert.match(unified, /if model\.rows\.isEmpty \{\s*XDriveIOSNativePhotoWallStatusMessage\(/)
  assert.match(unified, /accessibilityID: "native-ios-gallery-visible-proof"/)
  assert.doesNotMatch(shared, /PHAsset|PHPhotoLibrary|URLSession|login\.owner|Keychain|accessToken|loadNext\(|model\.load\(/)
})

test('Gallery, album and cloud retry UI retains the original scoped callbacks and guards', () => {
  assert.match(shared, /var systemImage: String\? = nil/)
  assert.match(shared, /Label\(message, systemImage: systemImage\)/)
  assert.match(unifiedGallery, /if let message = wall\.failure \?\? timeline\.notice \{\s*XDriveIOSNativePhotoWallRetryMessage\(/)
  assert.match(unifiedGallery, /canRetry: selected == nil && phase == \.active,[\s\S]*?systemImage: "info.circle"/)
  assert.match(unifiedGallery, /\) \{ reset\(\) \}/)
  assert.match(unified, /if let message = model\.notice \{\s*XDriveIOSNativePhotoWallRetryMessage\(/)
  assert.match(unified, /canRetry: visible && displayActive && wall\.failure == nil &&\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(unified, /\) \{ retry = UUID\(\) \}/)
  assert.match(local, /if let failure \{\s*XDriveIOSNativePhotoWallRetryMessage\(/)
  assert.match(local, /canRetry: authorized && phase == \.active && selected == nil &&\s*!actionBusy && !shareBusy/)
  assert.match(album, /canRetry: !loading && !albumActionBusy && !albumShareBusy &&\s*selected == nil && phase == \.active/)
  assert.match(album, /\) \{ savedOffset = 0; reload\(\) \}/)
  assert.match(cloud, /if let continuousFailure \{\s*XDriveIOSNativePhotoWallRetryMessage\(/)
  assert.match(cloud, /if let message = model\.error \{\s*XDriveIOSNativePhotoWallRetryMessage\(/)
  assert.match(cloud, /offset: model\.failedOffset \?\? model\.page\?\.offset \?\? 0/)
  assert.match(cloud, /model\.load\(login: login, albumID: album\?\.id, placeID: placeID,/)
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
  assert.match(cloud, /pagePlaceID == placeID/)
})

test('local, Owner place and unified Gallery share an inert video/Live badge without merging source permissions', () => {
  const unified = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')
  const localTile = local.slice(local.indexOf('struct XDriveIOSNativeSquarePhotoTile: View'),
    local.indexOf('/// Metadata-only virtual page.'))
  const cloudTile = cloud.slice(cloud.indexOf('private struct XDriveIOSNativeMediaWallTile: View'),
    cloud.indexOf('/// Fullscreen media View.'))

  assert.match(shared, /struct XDriveIOSNativePhotoWallMediaBadge: View/)
  assert.match(shared, /let isVideo: Bool/)
  assert.match(shared, /let isLive: Bool/)
  assert.match(shared, /var verifiedDuration: String\? = nil/)
  assert.match(shared, /if isVideo \{[\s\S]*?if let verifiedDuration \{\s*Text\(verifiedDuration\)\.monospacedDigit\(\)/)
  assert.match(shared, /Image\(systemName: "play.fill"\)/)
  assert.match(shared, /else if isLive \{\s*Image\(systemName: "livephoto"\)/)
  assert.match(shared, /\.accessibilityHidden\(true\)/)
  assert.match(shared, /struct XDriveIOSNativePhotoWallTileShell<Content: View>: View/)
  assert.match(shared, /XDriveIOSNativePhotoWallMediaBadge\(\s*isVideo: isVideo, isLive: isLive,\s*verifiedDuration: verifiedDuration/)
  assert.match(localTile, /XDriveIOSNativePhotoWallTileShell\(\s*isVideo: candidate\.kind == "video", isLive: candidate\.isLive,\s*verifiedDuration: durationLabel/)
  assert.match(localTile, /PHAsset\.fetchAssets\([\s\S]*?asset\.creationDate == candidate\.capturedAt,[\s\S]*?asset\.modificationDate == candidate\.modifiedAt/)
  assert.match(localTile, /seconds: asset\.duration/)
  assert.match(cloudTile, /XDriveIOSNativePhotoWallTileShell\(isVideo: item\.isVideo, isLive: item\.isLive/)
  assert.match(cloudTile, /model\.thumbnail\(item, login: login\)/)
  assert.match(cluster, /XDriveIOSNativePhotoWallTileShell\(isVideo: item\.isVideo, isLive: item\.isLive/)
  assert.match(unified, /XDriveIOSNativePhotoWallTileShell\(\s*isVideo: row\.isVideo, isLive: row\.isLive,\s*badgeAlignment: \.topTrailing/)
  assert.match(unified, /\.overlay\(alignment: \.bottomLeading\) \{\s*Label\(row\.presence\.title, systemImage: row\.presence\.symbol\)/)
  assert.match(unified, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.doesNotMatch(shared, /PHAsset|PHPhotoLibrary|URLSession|UploadSession|accessToken|verifiedAuthorization|Keychain/)
  assert.doesNotMatch(cloudTile, /PHAsset|allowICloud:/)
})
