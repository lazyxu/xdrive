'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const map = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const cloud = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const policy = read('ios/XDriveIOS/NativePhotoWallDensityPolicy.swift')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const places = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
const state = read('ui/shared/src/mui/MediaGalleryPhotoWallState.ts')
const tile = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')

test('PhotoKit GPS pages use one time/crop/pinch wall and still authorize the exact loaded Viewer window', () => {
  const one = map.slice(map.indexOf('private struct XDriveIOSMapPhotoAlbum: View'),
    map.indexOf('enum XDriveIOSNativeLocalMapScope'))
  const many = map.slice(map.indexOf('private struct XDriveIOSMapSpatialAlbum: View'),
    map.indexOf('/// One native map route'))
  for (const surface of [one, many]) {
    assert.match(surface, /xdriveIOSNativePhotoWallVisibleSections\(/)
    assert.match(surface, /XDriveIOSNativePhotoWallTimeScaleControls\(scale: \$wallTimeScale\)/)
    assert.match(surface, /xdrivePhotoWallFramingButtons\(\$wallFraming\)/)
    assert.match(surface, /XDriveIOSNativeSquarePhotoTile\(candidate: item, framing: wallFraming\)/)
    assert.match(surface, /\.xdrivePhotoWallPinch\(\s*density: \$wallDensity,/)
    assert.match(surface, /XDriveIOSNativeMapViewerAdmission\.allows\(/)
    assert.match(surface, /XDriveIOSMapCurrentPhotoKitAdmission\.allows\(/)
    assert.doesNotMatch(surface, /MagnificationGesture\(minimumScaleDelta:/)
    assert.doesNotMatch(surface, /PHAssetChangeRequest|UploadSession|deleteAssets\(/)
  }
  assert.match(tile, /framing == \.complete/)
  assert.match(map, /if hasNext \{[\s\S]*?scrollFootVisible = true[\s\S]*?advanceIfVisible\(\)/)
  assert.match(map, /priorWindow \+ items/)
  assert.match(map, /loadedWindow\(containing id: String\)/)
  assert.match(policy, /scale == \.all \? "all" : key\(item\)/)
  assert.match(policy, /result\[result\.count - 1\]\.key == groupKey/)
  assert.doesNotMatch(policy, /PHPhotoLibrary|PHAsset\.fetchAssets|URLSession/)
})

test('Owner cloud albums use verified 48-item-only time groups and common framing, never an unrestricted date index', () => {
  const range = cloud.slice(
    cloud.indexOf('private struct XDriveIOSNativeServerVirtualRange: View'),
    cloud.indexOf('/// Root and album-specific media wall'))
  const wall = cloud.slice(cloud.indexOf('struct XDriveIOSNativeServerMediaWall: View'),
    cloud.indexOf('/// Server collection index is distinct'))
  const cloudTile = cloud.slice(cloud.indexOf('private struct XDriveIOSNativeMediaWallTile: View'),
    cloud.indexOf('/// Fullscreen media View.'))
  assert.match(range, /verified\.items, scale: timeScale/)
  assert.match(range, /timeScale\.key\(forISO8601: \$0\.metadata\.captured_at\)/)
  assert.match(range, /if let verified = model\.page,[\s\S]*?verified\.offset == offset, verified\.total_count == expectedTotal/)
  assert.match(range, /XDriveIOSNativeMediaWallTile\([\s\S]*?framing: framing/)
  assert.match(range, /\.id\(XDriveIOSNativeMediaWallTileIdentity\(/)
  assert.match(wall, /XDriveIOSNativePhotoWallTimeScaleControls\(scale: \$wallTimeScale\)/)
  assert.match(wall, /xdrivePhotoWallFramingButtons\(\$wallFraming\)/)
  assert.match(wall, /density: wallDensity, timeScale: wallTimeScale,[\s\S]*?framing: wallFraming/)
  assert.match(cloudTile, /if framing == \.complete \{[\s\S]*?scaledToFit\(\)/)
  assert.match(cloudTile, /else \{[\s\S]*?scaledToFill\(\)/)
  // Switching crop/contain does not change thumbnail identity, Owner or revision.
  assert.match(cloudTile, /\.task\(id: "\\\(item\.id\)-\\\(item\.node\.revision\)-\\\(viewerActive\)"\)/)
  assert.match(cloudTile, /model\.thumbnail\(item, login: login\)/)
  assert.match(cloud, /XDriveIOSNativePhotoOwnerScope\.matches\(/)
  assert.match(cloud, /model\.suspendForViewer\(\)/)
  assert.doesNotMatch(range, /PHAssetChangeRequest|UploadSession/)
})

test('Web Gallery and trusted Places share cosmetic observer and UI-only return/date state', () => {
  for (const source of [gallery, places]) {
    assert.match(source, /useXDriveMediaGalleryMobileColumns\(/)
    assert.match(source, /useXDriveMediaGalleryTimelineJump</)
    assert.doesNotMatch(source, /xDriveObserveMobileGalleryColumns\(/)
  }
  assert.match(state, /xDriveObserveMobileGalleryColumns\(setColumns\)/)
  assert.match(state, /useState<T \| null>\(null\)/)
  assert.match(state, /setReturnAnchor\(null\)/)
  assert.match(state, /Math\.min\(XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MAX/)
  assert.match(places, /useEffect\(\(\) => resetTimelineJump\(\), \[timelineGroups, resetTimelineJump\]\)/)
  assert.match(gallery, /\[collectionKey, sortBy, sortDir, timeZone, logicalItemCount, resetTimelineJump\]/)
  assert.match(places, /onRangeChange: notifyRange/)
  assert.match(places, /onVisibleAnchorChange=\{captureVisibleAnchor\}/)
  assert.match(gallery, /xDriveMediaGalleryTimelineNearestDay\(dayGroupsForJump, day\)/)
  assert.match(places, /xDriveMediaGalleryTimelineNearestDay\(timelineGroups\.day, day\)/)
  assert.doesNotMatch(state, /fetch\(|URLSession|Owner|CellItems|accessToken|photo_url|localStorage\.setItem/)
})
