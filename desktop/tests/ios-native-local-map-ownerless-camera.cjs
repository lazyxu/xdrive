'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const screen = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const local = screen.match(/case \.local:\s*XDriveIOSNativeLocalPhotoMapScreen\(([\s\S]*?)\n\s*case \.cloud:/)?.[1]
const cloud = screen.match(/case \.cloud:\s*XDriveIOSNativeOwnerPhotoMapScreen\(([\s\S]*?)\n\s*\}\s*\n\s*\}/)?.[1]

test('signed-out local PhotoKit map can update its transient map camera', () => {
  assert.ok(local, 'native local map source must exist')
  assert.match(local, /onLibraryCameraChange: \{ next in/)
  assert.match(local, /guard source == \.local else \{ return \}/)
  assert.match(local, /if let expectedOwner \{[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\([\s\S]*?login\.owner, expectedOwner/)
  assert.match(local, /else \{\s*guard login\.owner == nil else \{ return \}\s*\}/)
  assert.match(local, /localMapCamera = next/)
  assert.doesNotMatch(local, /guard source == \.local, let expectedOwner,/)
})

test('old local-map callback is rejected when login/Owner changes', () => {
  assert.ok(local)
  // When an Owner existed at presentation time, the exact same Owner is
  // required at callback time. When none existed, callback is accepted
  // only while the user remains signed out.
  assert.match(local, /if let expectedOwner \{\s*guard XDriveIOSNativePhotoOwnerScope\.matches\(/)
  assert.match(local, /login\.owner, expectedOwner/)
  assert.match(local, /guard login\.owner == nil else \{ return \}/)
  assert.match(screen, /onChange\(of: source\) \{ _ in onFocusChange\?\(false\) \}/)
})

test('cloud camera is still strictly bound to an authorized Server Owner', () => {
  assert.ok(cloud, 'native cloud map source must exist')
  assert.match(cloud, /onCameraChange: \{ next in/)
  assert.match(cloud, /guard source == \.cloud, let expectedOwner,/)
  assert.match(cloud, /XDriveIOSNativePhotoOwnerScope\.matches\([\s\S]*?login\.owner, expectedOwner/)
  assert.match(cloud, /cloudMapCamera = next/)
})

test('Dashboard always clears bounded camera hints on Owner switch and scene loss', () => {
  assert.match(dashboard, /onChange\(of: ownerScopeKey\) \{ _ in[\s\S]*?resetNavigation\(\)/)
  assert.match(dashboard, /private func resetNavigation\(\) \{[\s\S]*?cloudMapCamera = nil[\s\S]*?localMapCamera = nil/)
  assert.match(dashboard, /onChange\(of: phase\) \{ state in[\s\S]*?state == \.active else \{[\s\S]*?localMapCamera = nil/)
  assert.doesNotMatch(screen, /UserDefaults\.standard.*localMapCamera|localMapCamera.*UserDefaults\.standard/)
})
