'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const density = read('ios/XDriveIOS/NativePhotoWallDensityPolicy.swift')
const tile = source.slice(
  source.indexOf('private struct XDriveIOSNativeMediaWallTile: View'),
  source.indexOf('/// Fullscreen media View.')
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
  assert.match(tile, /if item\.isVideo \|\| item\.isLive/)
  assert.doesNotMatch(tile, /frame\(height: 112\)/)
  assert.doesNotMatch(tile, /Text\(item\.node\.name\)/)
})

test('cloud grid shares bounded three-step native PhotoKit density menu and pinch', () => {
  assert.match(wall, /@State private var wallDensity: XDriveIOSNativePhotoWallDensity = \.standard/)
  assert.match(wall, /ForEach\(XDriveIOSNativePhotoWallDensity\.allCases\)/)
  assert.match(wall, /native-ios-cloud-wall-density/)
  assert.match(wall, /minimum: wallDensity\.minimumCellWidth/)
  assert.match(wall, /maximum: wallDensity\.maximumCellWidth/)
  assert.match(wall, /MagnificationGesture\(minimumScaleDelta: 0\.14\)\.onEnded/)
  assert.match(wall, /wallDensity = wallDensity\.applyingPinch\(scale\)/)
  assert.match(wall, /guard phase == \.active, selected == nil, !model\.busy/)
  assert.match(density, /case compact, standard, large/)
  assert.match(density, /func applyingPinch\(/)
})

test('presentation-only density preserves exact Owner and Viewer/thumbnail generations', () => {
  assert.match(tile, /\.task\(id: "\\\(item\.id\)-\\\(item\.node\.revision\)-\\\(viewerActive\)"\)/)
  assert.doesNotMatch(tile, /task\(id:.*Density/)
  assert.match(wall, /viewerLoadedItems = model\.page\?\.items \?\? \[\]/)
  assert.match(wall, /viewerLoadedRange = model\.page/)
  assert.match(wall, /\.id\(XDriveIOSNativeMediaWallTileIdentity\(\s*item: item, owner: login\.owner/)
  assert.match(wall, /XDriveIOSNativeMediaWallModel\(\)/)
  assert.match(wall, /XDriveIOSNativeServerMediaPreview\(/)
  assert.match(wall, /onCrossRange: \{ previous, anchor, direction in/)
  assert.doesNotMatch(density, /URLSession|PHAsset|NodeReceipt|UploadSession|UserDefaults/)
  assert.doesNotMatch(wall, /UserDefaults|@AppStorage/)
})
