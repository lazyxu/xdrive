'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const density = read('ios/XDriveIOS/NativePhotoWallDensityPolicy.swift')
const shared = read('ios/XDriveIOS/NativePhotoWallComponents.swift')
const tile = source.slice(
  source.indexOf('private struct XDriveIOSNativeMediaWallTile: View'),
  source.indexOf('/// Fullscreen media View.')
)
const virtual = source.slice(
  source.indexOf('private struct XDriveIOSNativeServerVirtualRange: View'),
  source.indexOf('/// Root and album-specific media wall')
)
const wall = source.slice(
  source.indexOf('struct XDriveIOSNativeServerMediaWall: View'),
  source.indexOf('/// Server collection index is distinct')
)

test('native cloud tile has truly square aspect fill without extra filename labels', () => {
  assert.match(tile, /GeometryReader \{ square in/)
  assert.match(tile, /\.frame\(width: square\.size\.width, height: square\.size\.height\)/)
  assert.match(tile, /\.aspectRatio\(1, contentMode: \.fit\)/)
  assert.match(tile, /\.resizable\(\)\.scaledToFill\(\)/)
  assert.match(tile, /XDriveIOSNativePhotoWallMediaBadge\(\s*isVideo: item\.isVideo, isLive: item\.isLive/)
  assert.match(shared, /if isVideo \{[\s\S]*?Image\(systemName: "play.fill"\)/)
  assert.match(shared, /else if isLive \{\s*Image\(systemName: "livephoto"\)/)
  assert.match(tile, /model\.thumbnail\(item, login: login\)/)
  assert.doesNotMatch(shared, /PHAsset|PHPhotoLibrary|URLSession|UploadSession|verifiedAuthorization/)
  assert.doesNotMatch(tile, /frame\(height: 112\)/)
  assert.doesNotMatch(tile, /Text\(item\.node\.name\)/)
})

test('cloud grid shares bounded three-step native PhotoKit density menu and pinch', () => {
  assert.match(wall, /@State private var wallDensity: XDriveIOSNativePhotoWallDensity = \.standard/)
  assert.match(wall, /xdrivePhotoWallDensityButtons\(\$wallDensity\)/)
  assert.match(wall, /native-ios-cloud-wall-density/)
  assert.equal((virtual.match(/XDriveIOSNativePhotoWallGrid\(density: density\)/g) || []).length, 2)
  assert.match(shared, /minimum: density\.minimumCellWidth/)
  assert.match(shared, /maximum: density\.maximumCellWidth/)
  assert.match(wall, /MagnificationGesture\(minimumScaleDelta: 0\.14\)\.onEnded/)
  assert.match(wall, /wallDensity = wallDensity\.applyingPinch\(scale\)/)
  assert.match(wall, /guard phase == \.active, selected == nil, !model\.busy/)
  assert.match(density, /case compact, standard, large/)
  assert.match(density, /func applyingPinch\(/)
})

test('presentation-only density preserves exact Owner and Viewer/thumbnail generations', () => {
  assert.match(tile, /\.task\(id: "\\\(item\.id\)-\\\(item\.node\.revision\)-\\\(viewerActive\)"\)/)
  assert.doesNotMatch(tile, /task\(id:.*Density/)
  assert.match(wall, /viewerLoadedItems = verified\.items/)
  assert.match(wall, /viewerLoadedRange = verified/)
  assert.match(virtual, /\.id\(XDriveIOSNativeMediaWallTileIdentity\(\s*item: item, owner: login\.owner/)
  assert.match(wall, /XDriveIOSNativeMediaWallModel\(\)/)
  assert.match(wall, /XDriveIOSNativeServerMediaPreview\(/)
  assert.match(wall, /onCrossRange: \{ previous, anchor, direction in/)
  assert.doesNotMatch(density, /URLSession|PHAsset|NodeReceipt|UploadSession|UserDefaults/)
  assert.doesNotMatch(wall, /UserDefaults|@AppStorage/)
})
