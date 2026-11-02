'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

const wall = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const density = read('ios/XDriveIOS/NativePhotoWallDensityPolicy.swift')
const viewer = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const page = wall.slice(
  wall.indexOf('private struct XDriveIOSNativeVirtualPhotoPage: View'),
  wall.indexOf('private final class XDriveIOSNativeVirtualWallChangeMonitor')
)
const square = wall.slice(0, wall.indexOf('/// Metadata-only virtual page.'))
const screen = wall.slice(wall.indexOf('struct XDriveIOSNativeLocalContinuousGalleryScreen: View'))

test('native Photos wall offers three square thumbnail densities, no change to other Gallery sources', () => {
  for (const item of ['case compact, standard, large', 'var minimumCellWidth: CGFloat',
    'var maximumCellWidth: CGFloat', 'func applyingPinch(', 'func zoomedIn()', 'func zoomedOut()']) {
    assert.ok(density.includes(item), 'missing density policy: ' + item)
  }
  assert.match(page, /let density: XDriveIOSNativePhotoWallDensity/)
  assert.match(page, /XDriveIOSNativeSquarePhotoTile\(candidate: candidate\)/)
  assert.equal((page.match(/minimum: density\.minimumCellWidth/g) || []).length, 2)
  assert.equal((page.match(/maximum: density\.maximumCellWidth/g) || []).length, 2)
  assert.match(square, /GeometryReader \{ geometry in/)
  assert.match(square, /\.frame\(width: geometry\.size\.width, height: geometry\.size\.height\)/)
  assert.match(square, /\.aspectRatio\(1, contentMode: \.fit\)/)
  assert.match(page, /private var placeholderTile: some View \{[\s\S]*?\.aspectRatio\(1, contentMode: \.fit\)/)
  assert.match(viewer, /struct XDriveIOSLocalPhotoTile: View/)
})

test('pinch and explicit density menu are bounded presentation-only controls', () => {
  assert.match(screen, /@State private var density: XDriveIOSNativePhotoWallDensity = \.standard/)
  assert.match(screen, /ForEach\(XDriveIOSNativePhotoWallDensity\.allCases\)/)
  assert.match(screen, /native-ios-local-wall-density/)
  assert.match(screen, /MagnificationGesture\(minimumScaleDelta: 0\.14\)\.onEnded/)
  assert.match(screen, /density = density\.applyingPinch\(value\)/)
  assert.match(screen, /guard authorized, phase == \.active, selected == nil/)
  assert.match(screen, /mediaFilter: mediaFilter, density: density,/)
  assert.match(density, /if magnification >= 1\.2 \{ return zoomedIn\(\) \}/)
  assert.match(density, /if magnification <= 0\.83 \{ return zoomedOut\(\) \}/)
  assert.doesNotMatch(density, /UserDefaults|AppStorage|Photos|Upload|URLSession|Node/)
})

test('changing density never changes PhotoKit identity, backup scans or UI item anchors', () => {
  assert.match(page, /\.task\(id: "\\\(generation\)-\\\(offset\)-\\\(mediaFilter\.rawValue\)"\)/)
  assert.doesNotMatch(page, /task\(id:.*density/)
  assert.match(page, /let count = try await reader\.start\(atOffset: offset, mediaFilter: mediaFilter\)/)
  assert.match(page, /loaded\.startOffset == offset/)
  assert.match(page, /\.onDisappear \{\s*page = nil/)
  assert.match(square, /\.task\(id: candidate\.id\)/)
  assert.match(square, /loader\.load\(candidate\.id, size: CGSize\(width: 420, height: 420\)\)/)
  assert.match(square, /loader\.cancel\(\)/)
  assert.match(page, /\.id\("photo:\/?\\\(candidate\.id\)"\)/)
  assert.match(page, /\.id\("page:\/?\\\(offset\)"\)/)
  assert.match(screen, /scroll\.scrollTo\("photo:\/?\\\(candidate\.id\)", anchor: \.center\)/)
  assert.doesNotMatch(wall, /uploadSession|PhotoSyncEncryptedLedger|PHAssetChangeRequest|allowICloudDownload: true.*loader/i)
})
