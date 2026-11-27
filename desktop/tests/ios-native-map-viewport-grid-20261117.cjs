'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const map = fs.readFileSync(path.resolve(__dirname,
    '../../ios/XDriveIOS/NativeUnifiedSourcePhotoMap.swift'), 'utf8')
const shared = fs.readFileSync(path.resolve(__dirname,
    '../../ios/XDriveIOS/NativePhotoWallComponents.swift'), 'utf8')
const local = fs.readFileSync(path.resolve(__dirname,
    '../../ios/XDriveIOS/NativeLocalPhotoMap.swift'), 'utf8')
const owner = fs.readFileSync(path.resolve(__dirname,
    '../../ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift'), 'utf8')

test('unified map opens one verified current-viewport grid, not an unfiltered Gallery', () => {
  assert.match(map, /@State private var showingViewportGrid = false/)
  assert.match(map, /XDriveIOSNativePhotoMapGridAction\([\s\S]*?enabled: currentProof && !pins\.isEmpty/)
  assert.match(map, /guard currentProof, !pins\.isEmpty,[\s\S]*?pins\.allSatisfy\(\{ \$0\.count > 0 \}\)/)
  assert.match(map, /\.sheet\(isPresented: \$showingViewportGrid, onDismiss:/)
  assert.match(map, /let owner = provedOwner, let library = provedLibrary/)
  assert.match(map, /presence: presence, query: scopedQuery, pin: pins\[0\]/)
  assert.match(map, /sourceCoordinates: cachedCoordinates,[\s\S]*?sourceCursors: cachedCursors, viewportPins: pins/)
  assert.match(shared, /struct XDriveIOSNativePhotoMapGridAction: View/)
  assert.doesNotMatch(map, /showingViewportGrid[\s\S]{0,900}XDriveIOSNativeUnifiedPhotoGallery\(/)
})

test('viewport union uses precise GPS Cell keys and the existing bounded source cursor', () => {
  assert.match(map, /var viewportPins: \[XDriveIOSUnifiedSourceMapPin\]\? = nil/)
  assert.match(map, /viewportPins == nil \? pin\.firstCursor : \.init\(\)/)
  assert.match(map, /if let viewportPins \{[\s\S]*?viewportPins\.contains \{ cell in[\s\S]*?XDriveIOSUnifiedSourceMapPolicy\.member\(/)
  assert.match(map, /key: cell\.key, viewport: cell\.viewport/)
  assert.match(map, /load\(from: initialWallCursor\)/)
  assert.match(map, /for inspected in 0\.\.<XDriveIOSUnifiedSourceMapPolicy\.maximumWallSeekPages/)
  assert.match(map, /await model\.load\(from: from, filter: presence, login: login,[\s\S]*?query: query, library: library\)/)
  assert.match(map, /rows\.filter \{ row in[\s\S]*?matchesPlace\(/)
})

test('revocation, backgrounds, progress and labels cannot reuse an old viewport', () => {
  assert.match(map, /showingViewportGrid = false[\s\S]*?provedOwner = nil/)
  assert.match(map, /phase == \.active && selected == nil &&[\s\S]*?!showingViewportGrid && !busy/)
  assert.match(map, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/)
  assert.match(map, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent\(library\)/)
  assert.match(map, /viewportPins != nil \? "当前地图的照片"/)
  assert.match(map, /count: isNearbyExpansion \? nil :[\s\S]*?viewportPins\?\.reduce\(0\)/)
  assert.match(map, /guard viewportPins == nil, active, placeName == nil/)
  assert.match(map, /if !isNearbyExpansion && viewportPins == nil \{/)
})

test('current viewport Sheet does not trigger a false map-route exit or clear verified pins', () => {
  const lifecycle = map.slice(map.indexOf('.onDisappear {\n            // Date picker presentation'),
    map.indexOf('    private func invalidate(keepCoordinates:'))
  assert.match(lifecycle, /if selected == nil && !showingViewportGrid \{/)
  assert.match(lifecycle, /if currentProof \{ onSaveCamera\?\(camera\) \}/)
  assert.match(lifecycle, /photoChanges\.stop\(\)\s*invalidate\(\)/)
  assert.match(map, /\.sheet\(isPresented: \$showingViewportGrid, onDismiss: \{\s*if phase == \.active \{ reload\(\) \} else \{ invalidate\(\) \}/)
  assert.match(map, /\.onChange\(of: photoChanges\.change\) \{ _ in[\s\S]*?invalidate\(\)/)
  assert.match(map, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?invalidate\(\)/)
  assert.match(map, /showingViewportGrid = false[\s\S]*?provedOwner = nil/)
})

test('date, recent-trip and help sheets preserve mounted MapKit on transient disappearance', () => {
  const localMap = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoMapScreen: View'))
  const ownerMap = owner.slice(owner.indexOf('struct XDriveIOSNativeOwnerPhotoMapScreen: View'))
  const sourceMap = map.slice(map.indexOf('struct XDriveIOSNativeUnifiedSourcePhotoMapScreen: View'),
                              map.indexOf('private struct XDriveIOSNativeUnifiedSourceMapCellWall: View'))
  // Do not treat ordinary date/trip selections as map-route departure.
  assert.match(localMap, /\.onDisappear \{\s*\/\/ A calendar or recent-trip chooser[\s\S]*?guard !datePickerOpen && !showingRecentDaysAndTrips else \{ return \}/)
  assert.match(ownerMap, /\.onDisappear \{\s*\/\/ Date picker and help overlay[\s\S]*?guard !datePickerOpen && !showingMapHelp else \{ return \}/)
  assert.match(sourceMap, /\.onDisappear \{\s*\/\/ Date picker presentation[\s\S]*?guard !datePickerOpen else \{ return \}/)
  assert.match(localMap, /\.sheet\(isPresented: \$datePickerOpen\)/)
  assert.match(localMap, /\.sheet\(isPresented: \$showingRecentDaysAndTrips, onDismiss:/)
  assert.match(ownerMap, /\.sheet\(isPresented: \$datePickerOpen\)/)
  assert.match(sourceMap, /\.sheet\(isPresented: \$datePickerOpen\)/)
  assert.match(sourceMap, /if selected == nil && !showingViewportGrid \{/)
  // All three map routes still revoke actual Owner/PhotoKit scope changes.
  assert.match(localMap, /\.onChange\(of: changes\.revision\) \{ _ in[\s\S]*?invalidate\(\)/)
  assert.match(ownerMap, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?invalidate\(\)/)
  assert.match(sourceMap, /\.onChange\(of: login\.owner\) \{ _ in\s*invalidate\(\)/)
})
