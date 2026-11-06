'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const screen = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoMapScreen: View'))

test('local PhotoKit map uses native medium/large place sheets without dismissing MapKit canvas', () => {
  assert.match(screen, /\.sheet\(item: \$globalSelection, onDismiss:/)
  assert.match(screen, /XDriveIOSMapSpatialAlbum\(\s*selection: chosen, album: album,/)
  assert.match(screen, /\.presentationDetents\(\[\.medium, \.large\]\)\s*\.presentationDragIndicator\(\.visible\)/)
  assert.doesNotMatch(screen, /\.fullScreenCover\(item: \$globalSelection/)
  assert.match(screen, /XDriveIOSMapKitPhotoPage\([\s\S]*?canSelectCells: refinedViewportIsCurrent/)
})

test('local filtered legacy and Nearby location photo walls share the native drag affordance', () => {
  assert.match(screen, /\.sheet\(item: \$selection, onDismiss:[\s\S]*?XDriveIOSMapPhotoAlbum\(items: chosen\.items, mediaFilter: mediaFilter\)[\s\S]*?\.presentationDetents\(\[\.medium, \.large\]\)/)
  assert.match(screen, /\.sheet\(item: \$nearbySelection, onDismiss: \{[\s\S]*?\}\) \{ chosen in[\s\S]*?isNearbyExpansion: true[\s\S]*?\.presentationDetents\(\[\.medium, \.large\]\)/)
  assert.match(screen, /\.sheet\(item: \$nearbySelection, onDismiss:[\s\S]*?\.presentationDragIndicator\(\.visible\)/)
})

test('Nearby expansion still waits for the first place sheet to dismiss and checks Full Access', () => {
  const begin = screen.indexOf('.sheet(item: $globalSelection, onDismiss:')
  const end = screen.indexOf('}) { chosen in', begin)
  const dismissal = screen.slice(begin, end)
  assert.ok(begin >= 0 && end > begin)
  assert.ok(dismissal.indexOf('PHPhotoLibrary.authorizationStatus(for: .readWrite)') <
    dismissal.indexOf('guard let pending = pendingNearbySelection'),
    'Full Access must be rechecked even after ordinary swipe dismissal')
  assert.match(dismissal, /pendingNearbySelection = nil[\s\S]*?invalidate\(\)/)
  assert.match(screen, /\.sheet\(item: \$globalSelection, onDismiss: \{[\s\S]*?guard let pending = pendingNearbySelection else \{ return \}/)
  assert.match(screen, /guard phase == \.active,[\s\S]*?PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized[\s\S]*?nearbySelection = pending/)
  const nearbyBegin = screen.indexOf('.sheet(item: $nearbySelection, onDismiss:')
  const nearbyEnd = screen.indexOf('}) { chosen in', nearbyBegin)
  const nearbyDismissal = screen.slice(nearbyBegin, nearbyEnd)
  assert.ok(nearbyBegin >= 0 && nearbyEnd > nearbyBegin)
  assert.match(nearbyDismissal, /guard phase == \.active,[\s\S]*?PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized/)
  assert.match(nearbyDismissal, /onLibraryCameraChange\?\(nil\)[\s\S]*?clearReturnCamera\(\)[\s\S]*?invalidate\(\)/)
  assert.match(screen, /onShowNearby: album == nil \? nil : \{[\s\S]*?pendingNearbySelection = chosen/)
  assert.match(screen, /XDriveIOSMapSpatialSelection\([\s\S]*?mediaFilter: mediaFilter\)/)
})

test('a real single-image Viewer stays full-screen and the Owner map already uses matching native sheets', () => {
  assert.match(screen, /\.fullScreenCover\(item: \$singleViewer/)
  assert.match(owner, /\.sheet\(item: \$selected, onDismiss:/)
  assert.match(owner, /\.sheet\(item: \$selectedCluster, onDismiss:/)
  const ownerSheet = owner.slice(owner.indexOf('.sheet(item: $selected, onDismiss:'),
    owner.indexOf('.fullScreenCover(item: $singleViewer'))
  assert.equal((ownerSheet.match(/\.presentationDetents\(\[\.medium, \.large\]\)/g) || []).length, 2)
  assert.equal((ownerSheet.match(/\.presentationDragIndicator\(\.visible\)/g) || []).length, 2)
  assert.doesNotMatch(local, /WKWebView|UploadSession|UserDefaults/)
})
