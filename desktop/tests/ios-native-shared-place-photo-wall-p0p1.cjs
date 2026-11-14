'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const sources = Object.freeze({
  map: read('ios/XDriveIOS/NativeLocalPhotoMap.swift'),
  owner: read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift'),
  cluster: read('ios/XDriveIOS/NativeOwnerMapClusterAlbum.swift'),
  cloud: read('ios/XDriveIOS/NativeServerMediaGallery.swift'),
  gallery: read('ios/XDriveIOS/NativeLocalContinuousGallery.swift'),
  album: read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift'),
  viewer: read('ios/XDriveIOS/NativeLocalPhotoGallery.swift'),
  filter: read('ios/XDriveIOS/NativePhotoMediaFilterPolicy.swift'),
  scanner: read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift'),
  shared: read('ios/XDriveIOS/NativePhotoWallComponents.swift'),
  density: read('ios/XDriveIOS/NativePhotoWallDensityPolicy.swift')
})
const fragment = (source, start, end) => {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first + start.length)
  assert.ok(first !== -1 && last > first, 'section must exist: ' + start)
  return source.slice(first, last)
}

test('P0-01: map sheets retain the camera and use the native medium/large photo drawer', () => {
  const { map, owner } = sources
  for (const label of ['$selection', '$globalSelection', '$nearbySelection']) {
    assert.ok(map.includes('.sheet(item: ' + label + ', onDismiss:'))
  }
  assert.match(map, /XDriveIOSMapSpatialAlbum\(\s*selection: chosen, album: album/)
  assert.match(map, /pendingNearbySelection = chosen/)
  assert.match(map, /\.presentationDetents\(\[\.medium, \.large\]\)/)
  assert.match(map, /\.presentationDragIndicator\(\.visible\)/)
  assert.match(map, /cameraReturn: MKCoordinateRegion\?/)
  assert.match(map, /cameraReturnOffset: Int\?/)
  assert.match(map, /clearReturnCamera\(\)/)
  assert.match(owner, /\.sheet\(item: \$selected, onDismiss: \{[\s\S]*?reload\(\)/)
  assert.match(owner, /\.sheet\(item: \$selectedCluster, onDismiss: \{[\s\S]*?reload\(\)/)
  assert.match(owner, /cameraReturn/)
  assert.match(owner, /XDriveIOSNativeServerMediaWall\(\s*login: login, album: nil, placeID: place\.id,\s*captureRange: activeCaptureRange\)/)
})

test('P0-02: revoked, deleted, edited and wrong-kind local assets never inherit Viewer authority', () => {
  const admission = fragment(sources.map,
    'private enum XDriveIOSNativeMapViewerAdmission',
    'private struct XDriveIOSMapPhotoAlbum')
  assert.match(admission, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(admission, /permission == \.authorized/)
  assert.match(admission, /PHAsset\.fetchAssets\(\s*withLocalIdentifiers: \[item\.id\]/)
  assert.match(admission, /loaded\.contains\(where: \{[\s\S]*?\$0\.modifiedAt == item\.modifiedAt/)
  assert.match(admission, /asset\.creationDate == item\.capturedAt/)
  assert.match(admission, /asset\.modificationDate == item\.modifiedAt/)
  assert.match(admission, /item\.isLive == asset\.mediaSubtypes\.contains\(\.photoLive\)/)
  assert.match(admission, /asset\.mediaType == \.video/)
  assert.match(sources.map, /photoLibraryDidChange\(_ [A-Za-z]+: PHChange\)/)
  assert.match(sources.map, /\.onChange\(of: changes\.revision\) \{ _ in[\s\S]*?retire\(\)/)
  assert.match(sources.map, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized/)
})

test('P0-03: Gallery media filters remain ANDed with the current GPS scope at scan and tap', () => {
  const { map, filter, gallery } = sources
  assert.match(map, /XDriveIOSMapCurrentPhotoKitAdmission\.allows\(/)
  assert.match(map, /guard candidate\.kind == kind && filter\.includes\(asset: asset\) else \{\s*return false\s*\}/)
  assert.match(map, /return filenameTerm\.isEmpty \|\| PHAssetResource\.assetResources\(for: asset\)[\s\S]*?originalFilename\.localizedStandardContains\(filenameTerm\)/)
  assert.match(map, /scanner\.startMap\([\s\S]*?album: album, mediaFilter: selection\.mediaFilter/)
  assert.match(map, /Policy\.includes\(\s*selection\.viewport,\s*latitude: asset\.latitude, longitude: asset\.longitude/)
  assert.match(map, /selectedKeys\.contains\(key\)/)
  assert.match(filter, /case photos, videos, favorites, livePhotos, screenshots/)
  assert.match(filter, /func includes\(\s*kind: String, isFavorite: Bool, isLive: Bool, isScreenshot: Bool/)
  assert.match(filter, /!requiresFavorite \|\| isFavorite/)
  assert.match(filter, /!requiresLive \|\| isLive/)
  assert.match(filter, /!requiresScreenshot \|\| isScreenshot/)
  assert.match(gallery, /mediaFilter: mediaFilter/)
})

test('P0-04: 64-slot source pages feed only 48 matching items without dropping pending hits', () => {
  const { map, scanner } = sources
  const reader = fragment(map, 'private func readWindow(', 'private func loadInitial()')
  assert.match(reader, /rows\.reserveCapacity\(48\)/)
  assert.match(reader, /while rows\.count < 48/)
  assert.match(reader, /if cursor < pending\.count \{[\s\S]*?pending\[cursor\]\.candidate[\s\S]*?cursor \+= 1/)
  assert.match(reader, /scanner\.nextLocatedPage\(\)/)
  assert.match(reader, /XDriveIOSNativePhotoMapPolicy\.validPage\(/)
  assert.match(reader, /next\.page\.startOffset == offset/)
  assert.match(reader, /pending = next\.items\.filter/)
  assert.match(reader, /offset = next\.page\.nextOffset/)
  assert.match(reader, /pendingIndex: cursor,[\s\S]*?nextOffset: offset/)
  assert.match(map, /priorWindow = departingItems[\s\S]*?autoScrollReturnID = departingItems\.last\?\.id[\s\S]*?items = result\.items/)
  assert.match(scanner, /nextLocatedPage\(/)
  assert.doesNotMatch(reader, /cacheAll|fetchAll|100_000\s*\]/)
})

test('P0-05: Owner switch, revoked scope, stale signed facet and Node revisions fail closed', () => {
  const { owner, cluster, cloud } = sources
  assert.match(owner, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedFacet\(/)
  assert.match(owner, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedCluster\(/)
  assert.match(owner, /XDriveIOSNativeOwnerMapSelectionPolicy\.isSameViewport\(/)
  assert.match(owner, /\.onChange\(of: login\.owner\)/)
  assert.match(cluster, /login\.verifiedAuthorization\(\)/)
  assert.match(cluster, /XDriveIOSNativePhotoOwnerScope\.matches\(\s*auth\.owner, selection\.owner/)
  assert.match(cluster, /currentOldPage\.sameVisibleSnapshot\(as: departingPage\)/)
  assert.match(cluster, /fetched\.total_count == facet\.item_count/)
  assert.match(cluster, /sameVisibleRevision\(as: item\)/)
  assert.match(cluster, /if !activeOwner \{ invalidate\(\) \}/)
  assert.match(cloud, /pagePlaceID == placeID/)
  assert.match(cloud, /pageAlbumID == albumID/)
  assert.match(cloud, /currentReader = nil/)
  assert.doesNotMatch(cluster, /URLSession\.shared|UserDefaults|UploadSession/)
})

test('P0-06: Viewer return restores exact visible tile, never stale PhotoKit or cloud item', () => {
  const { map, cluster, album, cloud } = sources
  assert.match(map, /restoreViewerTile\(using: returnScroll\)/)
  assert.match(map, /XDriveIOSNativeMapViewerAdmission\.allows\(\s*target, in: loaded, sceneActive: phase == \.active/)
  assert.match(map, /xdrivePhotoWallFocusVerifiedTile\(/)
  assert.match(map, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/)
  assert.match(map, /viewerReturnID = nil/)
  assert.match(cluster, /sameVisibleRevision\(as: anchor\)/)
  assert.match(cluster, /xdrivePhotoWallFocusVerifiedTile\(\s*anchor\.id, scroll: returnScroll, focus: \$focusedTileID/)
  assert.match(cluster, /load\(cursor, history: earlier\)/)
  assert.match(cluster, /pendingViewerCross = nil/)
  assert.match(cloud, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.cloudTarget\(/)
  assert.match(album, /restoreAfterViewer\(\)/)
  assert.match(cluster, /@AppStorage\("xdrive\.ios\.gallery\.photo-wall-framing\.v1"\)/)
  // Cosmetic framing is allowed; Owner identity, signed ranges and Viewer anchors are not stored.
  assert.doesNotMatch(cluster, /UserDefaults\.set|@AppStorage\("(?!xdrive\.ios\.gallery\.photo-wall-framing\.v1")[^"]+"/)
})

test('P1-07: continuous scroll, reserved placeholders and request cancellation stay bounded', () => {
  const { map, cluster, cloud, gallery } = sources
  assert.match(map, /if hasNext \{\s*Color\.clear[\s\S]*?scrollFootVisible = true[\s\S]*?advanceIfVisible\(\)/)
  assert.match(map, /private func advanceIfVisible\(\) \{[\s\S]*?guard XDriveIOSNativePhotoWallWindowPolicy\.shouldAdvance\(\s*footVisible: scrollFootVisible, hasNext: hasNext, busy: busy,[\s\S]*?failed: error != nil, viewerOpen: viewer != nil,[\s\S]*?scopeActive: phase == \.active/)
  assert.match(map, /readTask\?\.cancel\(\)/)
  assert.match(map, /await scanner\.reset\(\)/)
  assert.match(map, /priorWindow = departingItems/)
  assert.match(cluster, /if activeOwner, let next \{\s*Color\.clear[\s\S]*?advanceIfVisible\(\)/)
  assert.match(cluster, /loadTask\?\.cancel\(\)/)
  assert.match(cluster, /coverTask\?\.cancel\(\)/)
  assert.match(cluster, /priorWindow = departingPage/)
  assert.match(cloud, /Reserve the expected 48 grid slots/)
  assert.match(cloud, /model\.suspendForViewer\(\)/)
  assert.match(gallery, /loader\.cancel\(\)/)
})

test('P1-08: shared adaptive densities, landscape and pinch never change data-source identity', () => {
  const { shared, map, cluster, density, album, gallery, cloud } = sources
  assert.match(shared, /GridItem\(\.adaptive\(/)
  assert.match(shared, /minimum: density\.minimumCellWidth/)
  assert.match(shared, /maximum: density\.maximumCellWidth/)
  assert.match(density, /case compact, standard, large/)
  assert.match(density, /func applyingPinch\(/)
  for (const [name, source, expected] of [
    ['local gallery', gallery, 2], ['local album', album, 1],
    ['local location', map, 0], ['cloud gallery', cloud, 1],
    ['cloud cluster', cluster, 0]
  ]) {
    assert.equal((source.match(/XDriveIOSNativePhotoWallGrid\(density:/g) || []).length,
      expected, name)
  }
  assert.equal((map.match(/\.xdrivePhotoWallPinch\(/g) || []).length, 2)
  assert.equal((map.match(/XDriveIOSNativePhotoWallSectionList\(/g) || []).length, 2)
  assert.match(album, /XDriveIOSNativePhotoWallSectionList\(/)
  assert.match(cloud, /XDriveIOSNativePhotoWallSectionList\(/)
  assert.doesNotMatch(map, /MagnificationGesture\(minimumScaleDelta:/)
  assert.match(shared, /struct XDriveIOSNativePhotoWallPinchModifier: ViewModifier/)
  assert.match(shared, /density = density\.applyingPinch\(scale\)/)
  assert.match(cluster, /\.xdrivePhotoWallPinch\(/)
  assert.match(cluster, /density: \$wallDensity,/)
  assert.match(cluster, /enabled: activeOwner && !busy && viewing == nil/)
  assert.doesNotMatch(cluster, /MagnificationGesture\(minimumScaleDelta:/)
  assert.match(map, /@Environment\(\\\.dynamicTypeSize\)/)
  assert.match(album, /@Environment\(\\\.dynamicTypeSize\)/)
  assert.doesNotMatch(shared, /PHAsset\.fetchAssets|URLSession|UploadSession|\\.task\(/)
})

test('P1-09: videos, Live badges and date groups match Gallery; map cannot acquire album write controls', () => {
  const { map, cluster, gallery, album, shared } = sources
  const tile = fragment(gallery, 'struct XDriveIOSNativeSquarePhotoTile: View',
    '/// Metadata-only virtual page.')
  assert.match(tile, /XDriveIOSNativePhotoWallTileShell\(\s*isVideo: candidate\.kind == "video", isLive: candidate\.isLive,\s*verifiedDuration: durationLabel/)
  assert.match(shared, /if isVideo \{[\s\S]*?if let verifiedDuration \{\s*Text\(verifiedDuration\)\.monospacedDigit\(\)/)
  assert.match(tile, /PHAsset\.fetchAssets\(\s*withLocalIdentifiers: \[candidate\.id\], options: nil/)
  assert.match(tile, /asset\.creationDate == candidate\.capturedAt/)
  assert.match(tile, /asset\.modificationDate == candidate\.modifiedAt/)
  assert.match(tile, /asset\.mediaType == \.video/)
  assert.match(tile, /seconds: asset\.duration/)
  assert.match(shared, /else if isLive \{\s*Image\(systemName: "livephoto"\)/)
  assert.match(tile, /loader\.cancel\(\)/)
  assert.equal((map.match(/XDriveIOSNativeSquarePhotoTile\(\s*candidate: item, framing: wallFraming\s*\)/g) || []).length, 2)
  assert.equal((map.match(/XDriveIOSNativePhotoWallTimeScaleControls\(scale: \$wallTimeScale\)/g) || []).length, 2)
  assert.match(gallery, /XDriveIOSNativePhotoDayGroupingPolicy\.sections\(/)
  assert.match(album, /XDriveIOSNativePhotoDayGroupingPolicy\.sections\(/)
  assert.match(album, /@State private var selectionMode = false/)
  assert.match(album, /selectedCandidates: \[String: XDrivePhotoKitScanCandidate\]/)
  assert.match(cluster, /XDriveIOSNativePhotoWallTileShell\(isVideo: item\.isVideo, isLive: item\.isLive/)
  assert.match(shared, /\.accessibilityHidden\(true\)/)
  assert.doesNotMatch(shared, /PHAsset|PHPhotoLibrary|URLSession|UploadSession/)
  const place = fragment(map, 'private struct XDriveIOSMapSpatialAlbum: View', '/// One native map route')
  assert.doesNotMatch(place, /PHAssetChangeRequest|deleteAssets\(|removeAssets\(/)
  assert.doesNotMatch(cluster, /PHAssetChangeRequest|deleteAssets\(|removeAssets\(/)
})

test('P1-10: 100k metadata scans and rapid scene/Owner switches retire stale workers', () => {
  const { map, owner, cluster, gallery, scanner } = sources
  assert.match(map, /@State private var generation = UUID\(\)/)
  assert.match(map, /readTask\?\.cancel\(\)/)
  assert.match(map, /generation == ticket, phase == \.active/)
  assert.match(map, /if let worker \{ Task \{ await worker\.reset\(\) \} \}/)
  assert.match(map, /pendingLocated = \[\]/)
  assert.match(map, /priorWindow = \[\]/)
  assert.match(cluster, /generation = UUID\(\)/)
  assert.match(cluster, /guard generation == ticket, activeOwner/)
  assert.match(cluster, /\.onChange\(of: login\.owner\)/)
  assert.match(cluster, /loadTask\?\.cancel\(\)/)
  assert.match(owner, /cameraSettleTask\?\.cancel\(\)/)
  assert.match(owner, /coverTask\?\.cancel\(\)/)
  assert.match(gallery, /\.task\(id: "\\\(generation\)-\\\(offset\)-\\\(mediaFilter\.rawValue\)"\)/)
  assert.match(scanner, /nextLocatedPage\(/)
  assert.doesNotMatch(map, /cacheAllPhotos|globalPhotoIDs|UserDefaults\.set\(.*GPS/)
})
