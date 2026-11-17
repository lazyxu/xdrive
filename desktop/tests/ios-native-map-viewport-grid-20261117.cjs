'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const map = fs.readFileSync(path.resolve(__dirname,
    '../../ios/XDriveIOS/NativeUnifiedSourcePhotoMap.swift'), 'utf8')
const shared = fs.readFileSync(path.resolve(__dirname,
    '../../ios/XDriveIOS/NativePhotoWallComponents.swift'), 'utf8')

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
