'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const source = read('ios/XDriveIOS/NativeUnifiedSourcePhotoMap.swift')
const shared = read('ios/XDriveIOS/NativePhotoWallComponents.swift')

function bottomLeftOverlay(code, viewName) {
  const view = code.indexOf(viewName)
  assert.ok(view >= 0, 'expected native map view: ' + viewName)
  const start = code.indexOf('.overlay(alignment: .bottomLeading)', view)
  assert.ok(start > view, 'expected existing map progress overlay')
  return code.slice(start, start + 860)
}

test('all three Apple Photos-style maps expose only transient scan progress at bottom left', () => {
  for (const [code, name] of [
    [local, 'struct XDriveIOSNativeLocalPhotoMapScreen: View'],
    [owner, 'struct XDriveIOSNativeOwnerPhotoMapScreen: View'],
    [source, 'struct XDriveIOSNativeUnifiedSourcePhotoMapScreen: View']
  ]) {
    const overlay = bottomLeftOverlay(code, name)
    assert.match(overlay, /if busy \{[\s\S]*?ProgressView\(/)
    assert.doesNotMatch(overlay, /XDriveIOSNativePhotoMapStatusPill\(/)
    assert.doesNotMatch(overlay, /native-ios-(?:map-verified-count|owner-map-verified-count|unified-source-map-total)/)
  }
})

test('the verified summary is accessible without introducing a new map banner', () => {
  const grid = shared.slice(shared.indexOf('struct XDriveIOSNativePhotoMapGridAction: View'),
                            shared.indexOf('/// Photo-first, accessible location header'))
  assert.match(grid, /var verifiedSummary: String\? = nil/)
  assert.match(grid, /\.accessibilityValue\(verifiedSummary \?\? ""\)/)
  assert.match(grid, /\.accessibilityHint\("仅打开当前已核验地图范围内的照片"\)/)
  assert.match(local, /verifiedSummary: globalComplete && refinedViewportIsCurrent/)
  assert.match(owner, /verifiedSummary: mapMarkersEnabled && verifiedBounds != nil/)
  assert.match(source, /verifiedSummary: currentProof/)
  assert.match(local, /XDriveIOSNativePhotoMapPlaceHeader\(/)
  assert.match(source, /XDriveIOSNativePhotoMapPlaceHeader\(/)
})

test('the quieter map does not remove permission-scoped membership or emergency recovery', () => {
  assert.match(local, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(local, /runP0IndependentGPSAudit\(\)/)
  assert.match(local, /native-ios-map-full-library-scan-progress/)
  assert.match(owner, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.match(owner, /native-ios-owner-map-basemap-unavailable/)
  assert.match(source, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent/)
  assert.match(source, /native-ios-unified-source-map-retry/)
  for (const code of [local, owner, source]) {
    assert.match(code, /XDriveIOSNativePhotoMapGridAction\(/)
    assert.match(code, /XDriveIOSNativePhotoMapFloatingTools\(/)
  }
})
