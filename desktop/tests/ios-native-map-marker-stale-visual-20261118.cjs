'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const policy = read('ios/XDriveIOS/NativeMapMarkerVisualPolicy.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const source = read('ios/XDriveIOS/NativeUnifiedSourceMapSurface.swift')

test('unverified MapKit marker never retains selected zoom, shadow or depth', () => {
  assert.match(policy, /static func updateSelection\(_ selected: Bool, view: MKAnnotationView,[\s\S]*?guard view\.isEnabled else \{\s*resetSelection\(view\)\s*return\s*\}/)
  assert.match(policy, /static func resetSelection\(_ view: MKAnnotationView\) \{[\s\S]*?view\.transform = \.identity[\s\S]*?view\.layer\.zPosition = 0[\s\S]*?view\.layer\.shadowOpacity = 0\.22/)
  assert.match(policy, /if animated && !UIAccessibility\.isReduceMotionEnabled/)
  for (const m of [local, owner, source]) {
    assert.match(m, /override func setSelected\(_ selected: Bool, animated: Bool\) \{[\s\S]*?XDriveIOSNativeMapMarkerVisualPolicy\.updateSelection\(/)
    assert.match(m, /XDriveIOSNativeMapMarkerVisualPolicy\.resetSelection\(self\)/)
  }
})

test('Owner and unified-source marker invalidation clears stale animation and VoiceOver activation', () => {
  for (const m of [owner, source]) {
    assert.match(m, /isEnabled = enabled\s*if !enabled \{ XDriveIOSNativeMapMarkerVisualPolicy\.resetSelection\(self\) \}/)
    assert.match(m, /isAccessibilityElement = enabled\s*accessibilityElementsHidden = !enabled\s*accessibilityTraits = enabled \? \.button : \[\]/)
  }
  assert.match(owner, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.match(source, /leaseRevokedUntilNewRevision/)
})

test('local PhotoKit camera gesture revokes previously selected pin synchronously', () => {
  assert.match(local, /cover\.isEnabled = canSelectCells\s*if !canSelectCells \{\s*XDriveIOSNativeMapMarkerVisualPolicy\.resetSelection\(cover\)\s*\}/)
  assert.match(local, /func mapView\(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool\)[\s\S]*?canSelectCells = false[\s\S]*?cover\.isEnabled = false\s*XDriveIOSNativeMapMarkerVisualPolicy\.resetSelection\(cover\)/)
  assert.match(local, /cover\.accessibilityElementsHidden = true/)
  assert.match(local, /guard canSelectCells else \{ return \}/)
  assert.match(local, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})
