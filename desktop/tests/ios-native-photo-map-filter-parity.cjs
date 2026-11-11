'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')

const gallery = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const maps = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const scanner = read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift')
const policy = read('ios/XDriveIOS/NativePhotoMediaFilterPolicy.swift')
const nativeChecks = read('ios/tests/NativePhotoMediaFilterChecks.swift')

test('local Gallery filter travels through both native map entry paths', () => {
  assert.match(gallery, /XDriveIOSNativeLocalPhotoMapScreen\([\s\S]*?onLibraryCameraChange: \{ next in mapCamera = next \},\s*mediaFilter: mediaFilter/)
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativePhotoMapsScreen\([\s\S]*?mediaFilter: localGalleryMediaFilter/)
  assert.match(maps, /var mediaFilter: XDriveIOSNativePhotoMediaFilter = \.all/)
  const route = maps.slice(maps.indexOf('struct XDriveIOSNativePhotoMapsScreen'),
    maps.indexOf('private final class XDriveIOSOwnerPlaceAnnotation'))
  assert.match(route, /case \.local:[\s\S]*?onFocusChange: onFocusChange,\s*mediaFilter: mediaFilter/)
  assert.doesNotMatch(route.slice(route.indexOf('case .cloud:')), /XDriveIOSNativeOwnerPhotoMapScreen\([\s\S]*?mediaFilter:/)
})

test('filtered maps reuse the Gallery PhotoKit predicate and typed fetch strategy', () => {
  assert.match(policy, /func applyPredicates\(to options: PHFetchOptions\)/)
  assert.match(scanner, /func startMap\(atOffset requestedOffset: Int = 0,[\s\S]*?mediaFilter: XDriveIOSNativePhotoMediaFilter,\s*captureRange: XDriveIOSNativePhotoMapCaptureRange\? = nil\) throws -> Int/)
  assert.match(scanner, /func startMap\([\s\S]*?PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized/)
  assert.match(scanner, /func startMap\([\s\S]*?reset\(\)\s*throw XDrivePhotoKitScanFailure\.notAuthorized/)
  assert.match(scanner, /album: album, mediaFilter: mediaFilter,\s*requireFullLibrary: true/)
  assert.match(scanner, /guard !requireFullLibrary \|\| status == \.authorized else \{/)
  assert.match(scanner, /mediaFilter\.applyPredicates\(to: options\)/)
  assert.match(scanner, /else if mediaFilter\.fetchKind == "image" \{\s*snapshot = PHAsset\.fetchAssets\(with: \.image, options: options\)/)
  assert.match(scanner, /else if mediaFilter\.fetchKind == "video" \{\s*snapshot = PHAsset\.fetchAssets\(with: \.video, options: options\)/)
  assert.match(scanner, /if let kind = mediaFilter\.fetchKind \{[\s\S]*?let typed = NSPredicate\(format: "mediaType == %d", mediaType\.rawValue\)/)
  assert.match(scanner, /NSCompoundPredicate\(\s*andPredicateWithSubpredicates: \[selected, typed\]/)
})

test('map Cells and their location photo wall use the same frozen filtered snapshot', () => {
  assert.match(local, /var mediaFilter: XDriveIOSNativePhotoMediaFilter = \.all/)
  assert.match(local, /worker\.startMap\(\s*atOffset: 0, album: album, mediaFilter: mediaFilter,\s*captureRange: activeCaptureRange,\s*filenameTerm: filenameTerm\s*\)/)
  assert.match(local, /scanner\.startMap\(\s*atOffset: 0, album: album, mediaFilter: selection\.mediaFilter,\s*captureRange: selection\.captureRange,\s*filenameTerm: selection.filenameTerm\s*\)/)
  assert.match(local, /let mediaFilter: XDriveIOSNativePhotoMediaFilter/)
  assert.match(local, /XDriveIOSMapSpatialSelection\(\s*cells: cells, viewport: globalViewport,\s*mediaFilter: mediaFilter,\s*captureRange: activeCaptureRange,\s*filenameTerm: filenameTerm\)/)
  assert.match(local, /XDriveIOSMapSpatialAlbum\(\s*selection: chosen, album: album,/)
  assert.match(local, /XDriveIOSMapSpatialAlbum\(\s*selection: chosen, album: nil, isNearbyExpansion: true/)
  assert.match(local, /let next = try await scanner\.nextLocatedPage\(\)/)
  // The second bounded PhotoKit read must never use only location proximity:
  // it must retain the exact trusted Cell keys AND original viewport.
  const window = local.slice(local.indexOf('private func readWindow('),
    local.indexOf('private func loadInitial()', local.indexOf('private func readWindow(')))
  assert.ok(window.includes('let selectedKeys = Set(selection.cells.map(\\.key))'))
  assert.match(window, /pending = next\.items\.filter \{ asset in[\s\S]*?Policy\.includes\(\s*selection\.viewport,[\s\S]*?selectedKeys\.contains\(key\)/)
})

test('changing the Gallery filter discards earlier map Cells and camera hints', () => {
  const screen = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoMapScreen: View'))
  assert.match(screen, /\.onChange\(of: mediaFilter\) \{ _ in[\s\S]*?onLibraryCameraChange\?\(nil\)[\s\S]*?scanFullLibrary\(\)[\s\S]*?refresh\(at: 0\)[\s\S]*?invalidate\(\)/)
  assert.match(screen, /\.navigationTitle\(album\.map[\s\S]*?mediaFilter\.isAll \? "地图" : "地图 · /)
  assert.match(screen, /guard globalComplete, !busy else \{ return false \}/)
})

test('backup scanner keeps original unfiltered full/limited access and stable resume', () => {
  assert.match(scanner, /func start\(atOffset requestedOffset: Int = 0,\s*requireStableResume: Bool = false,\s*album: XDriveLocalPhotoAlbumSummary\? = nil\) throws -> Int \{\s*try startConfigured/)
  assert.match(scanner, /requireStableResume: requireStableResume,\s*album: album, mediaFilter: \.all/)
  assert.match(scanner, /status == \.authorized \|\| \(!requireStableResume && album == nil && status == \.limited\)/)
  assert.match(scanner, /if requireStableResume \{[\s\S]*?stableBackupBoundaryIndices/)
  assert.match(scanner, /try ensureCurrent\(initialAuthorization\)/)
  assert.doesNotMatch(scanner, /UserDefaults|UploadSession|URLSession/)
})

test('live PhotoKit favorite and subtype edits cannot reopen filtered Viewer tiles', () => {
  assert.match(policy, /func includes\(asset: PHAsset\) -> Bool/)
  assert.match(policy, /switch asset\.mediaType \{[\s\S]*?case \.image: kind = "image"[\s\S]*?case \.video: kind = "video"/)
  assert.match(policy, /func includes\([\s\S]*?kind: String, isFavorite: Bool, isLive: Bool, isScreenshot: Bool/)
  assert.match(policy, /\(!requiresFavorite \|\| isFavorite\)/)
  assert.match(policy, /\(!requiresLive \|\| isLive\)/)
  assert.match(policy, /\(!requiresScreenshot \|\| isScreenshot\)/)
  assert.match(policy, /kind: kind, isFavorite: asset\.isFavorite,/)
  assert.match(policy, /isLive: asset\.mediaSubtypes\.contains\(\.photoLive\)/)
  assert.match(policy, /isScreenshot: asset\.mediaSubtypes\.contains\(\.photoScreenshot\)/)
  assert.match(nativeChecks, /precondition\(favoriteLive\.includes\(/)
  assert.match(nativeChecks, /precondition\(liveAndScreenshot\.includes\(/)
  assert.match(local, /private enum XDriveIOSMapCurrentPhotoKitAdmission \{[\s\S]*?PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized/)
  assert.match(local, /PHAsset\.fetchAssets\([\s\S]*?withLocalIdentifiers: \[candidate\.id\], options: nil/)
  assert.match(local, /guard candidate\.kind == kind && filter\.includes\(asset: asset\)/)
  assert.match(local, /XDriveIOSMapCurrentPhotoKitAdmission\.allows\(\s*candidate, filter: mediaFilter,\s*filenameTerm: filenameTerm\s*\)/)
  assert.match(local, /XDriveIOSMapCurrentPhotoKitAdmission\.allows\(\s*item, filter: selection.mediaFilter,\s*filenameTerm: selection.filenameTerm\s*\)/)
  assert.match(local, /XDriveIOSMapPhotoAlbum\(items: chosen\.items, mediaFilter: mediaFilter,\s*filenameTerm: filenameTerm\)/)
  assert.match(local, /selected\.allSatisfy\(\{\s*XDriveIOSMapCurrentPhotoKitAdmission\.allows/)
  assert.doesNotMatch(local, /UserDefaults|UploadSession|requestWhenInUseAuthorization\(/)
})
